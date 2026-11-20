"""Specialized preview evidence is read before a waiting input edit commits."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Event
from time import monotonic

import pytest
from sqlalchemy import select, text

from app.models import DutyAssignment, ExtraDutyBatch, Unit, UserAccount
from app.services import balance_duties as bd, extra_duty as ed, rota_compute as compute
from tests.test_balance_duties import make_slot, two_member_month
from tests.test_import_concurrency import postgres_client as postgres_client  # noqa: F401


@pytest.mark.parametrize("kind", ["balance", "extra"])
def test_specialized_preview_serializes_input_edit_without_operational_writes(postgres_client, monkeypatch, kind):
    _, factory, _ = postgres_client
    with factory() as db:
        context = two_member_month(db)
        if kind == "extra":
            make_slot(db, context["unit"], date(2026, 5, 20))
        db.commit()
        unit_id = context["unit"].id
        user_id = db.scalar(select(UserAccount.id))
        initial_assignments = db.query(DutyAssignment).count()
    loaded, release, pid_ready = Event(), Event(), Event()
    pids = []
    service = bd if kind == "balance" else ed
    name = "_plan" if kind == "balance" else "_build_plan"
    original = getattr(service, name)

    def hold(*args, **kwargs):
        result = original(*args, **kwargs)
        loaded.set()
        assert release.wait(12)
        return result

    monkeypatch.setattr(service, name, hold)

    def preview():
        with factory() as db:
            result = service.preview(db, "2026-05", db.get(UserAccount, user_id))
            db.commit()
            return result

    def edit():
        assert loaded.wait(12)
        with factory() as db:
            db.execute(text("SET LOCAL lock_timeout = '10s'"))
            unit = db.get(Unit, unit_id)
            pids.append(db.scalar(text("SELECT pg_backend_pid()")))
            pid_ready.set()
            unit.minimum_free_people += 1
            db.commit()

    with ThreadPoolExecutor(max_workers=2) as pool:
        proposal, writer = pool.submit(preview), pool.submit(edit)
        try:
            assert loaded.wait(12) and pid_ready.wait(12)
            waiting = False
            deadline = monotonic() + 4
            with factory() as observer:
                while monotonic() < deadline:
                    waiting = observer.scalar(text(
                        "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=:pid AND NOT granted)"), {"pid": pids[0]})
                    if waiting or writer.done():
                        break
                    Event().wait(0.025)
            assert waiting and not writer.done()
        finally:
            release.set()
        result = proposal.result(timeout=20)
        writer.result(timeout=20)
    with factory() as db:
        assert result["context_hash"] != compute.context_hash(db)
        assert db.query(DutyAssignment).count() == initial_assignments
        assert db.query(ExtraDutyBatch).count() == 0
        with pytest.raises(ed.ExtraDutyError) as failure:
            service.apply(db, "2026-05", result["token"], result["plan_hash"], db.get(UserAccount, user_id))
        assert failure.value.code == "stale_preview"
        assert db.query(DutyAssignment).count() == initial_assignments
        assert db.query(ExtraDutyBatch).count() == 0
