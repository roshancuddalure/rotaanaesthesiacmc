"""Real canonical calendar transfer duplicate and raw mapping-writer races."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from time import monotonic

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.core.config import settings
from app.models import AdminMapping, OtCalendarVersion, Unit, UserAccount
from app.services import ot_calendar_store as store, ot_calendar_transfer as transfer
from tests.test_import_concurrency import postgres_client as postgres_client  # noqa: F401
from tests.test_ot_calendar_api import configuration


def seed(factory):
    with factory() as db:
        unit = Unit(code="TRANSFER_IV", name="Transfer unit IV")
        other = Unit(code="TRANSFER_OTHER", name="Other transfer unit")
        db.add_all([unit, other])
        db.flush()
        db.add(AdminMapping(mapping_type="unit_label", source_label="Review file unit",
                            target_key=unit.code, target_label=unit.name, status="reviewed", source="manual"))
        user = db.scalar(select(UserAccount))
        store.save(db, unit.id, store.SaveCalendar(base_revision=store.EMPTY_REVISION,
            configuration=store.CalendarConfiguration.model_validate(configuration(unit.id))), user)
        exported = transfer.export_month(db, unit.id, "2026-11")
        exported["document"]["unit_label"] = "Review file unit"
        next(r for r in exported["document"]["rows"] if r["state"] == "open")["bands"][0]["minimum"] = 3
        payload = transfer.TransferRequest.model_validate({"filename": "PG reviewed.json",
            "base_revision": exported["base_revision"], "document": exported["document"]})
        review = transfer.preview(db, unit.id, payload, user)
        apply = transfer.ApplyTransfer.model_validate({**payload.model_dump(), "review_hash": review["review_hash"]})
        return unit.id, other.id, user.id, apply


def test_parallel_same_review_is_one_canonical_save(postgres_client, monkeypatch):
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    _, factory, _ = postgres_client
    unit_id, _, user_id, payload = seed(factory)
    barrier = Barrier(2)
    def apply():
        with factory() as db:
            barrier.wait(10)
            return transfer.apply(db, unit_id, payload, db.get(UserAccount, user_id))["already_applied"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: apply(), range(2)))
    assert sorted(results) == [False, True]
    with factory() as db:
        assert db.query(OtCalendarVersion).count() == 2


def test_mapping_edit_committed_before_apply_refuses_file(postgres_client, monkeypatch):
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    _, factory, _ = postgres_client
    unit_id, other_id, user_id, payload = seed(factory)
    with factory() as db:
        mapping = db.scalar(select(AdminMapping))
        mapping.target_key = db.get(Unit, other_id).code
        db.commit()
    with factory() as db:
        with pytest.raises(HTTPException) as failure:
            transfer.apply(db, unit_id, payload, db.get(UserAccount, user_id))
        assert failure.value.status_code in {409, 422}
        assert db.query(OtCalendarVersion).count() == 1


def test_apply_lock_holds_raw_mapping_writer_then_retry_refuses_changed_mapping(postgres_client, monkeypatch):
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    _, factory, _ = postgres_client
    unit_id, other_id, user_id, payload = seed(factory)
    ready, release, pid_ready = Event(), Event(), Event()
    pids = []
    original = store.save
    def held_save(*args, **kwargs):
        ready.set()
        assert release.wait(12)
        return original(*args, **kwargs)
    monkeypatch.setattr(store, "save", held_save)
    def apply():
        with factory() as db:
            return transfer.apply(db, unit_id, payload, db.get(UserAccount, user_id))["already_applied"]
    def writer():
        assert ready.wait(12)
        with factory() as db:
            db.execute(text("SET LOCAL lock_timeout = '10s'"))
            mapping = db.scalar(select(AdminMapping))
            mapping.target_key = db.get(Unit, other_id).code
            with db.no_autoflush:
                pids.append(db.scalar(text("SELECT pg_backend_pid()")))
            pid_ready.set()
            db.commit()
    with ThreadPoolExecutor(max_workers=2) as pool:
        allocation, edit = pool.submit(apply), pool.submit(writer)
        try:
            assert ready.wait(12) and pid_ready.wait(12)
            waiting = False
            deadline = monotonic() + 4
            with factory() as observer:
                while monotonic() < deadline:
                    waiting = observer.scalar(text(
                        "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=:pid AND NOT granted)"), {"pid": pids[0]})
                    if waiting:
                        break
                    Event().wait(.025)
            assert waiting and not edit.done()
        finally:
            release.set()
        assert allocation.result(timeout=20) is False
        edit.result(timeout=20)
    with factory() as db:
        with pytest.raises(HTTPException):
            transfer.apply(db, unit_id, payload, db.get(UserAccount, user_id))
        assert db.query(OtCalendarVersion).count() == 2
