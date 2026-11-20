"""Actual PostgreSQL history projection and canonical writer ordering."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from threading import Event
from time import monotonic, sleep
from uuid import UUID, uuid4

from sqlalchemy import select, text

from app.models import DeletedRecord, ImportBatch, ImportSourceRecord, LeaveRequest, NormalizationEvent, Person, UserAccount
from tests.test_import_concurrency import postgres_client as postgres_client


def test_history_keeps_canonical_state_and_audit_coherent_during_cancellation(postgres_client, monkeypatch):
    from app.services import leave_history, reference_registry

    client, factory, headers = postgres_client
    with factory() as db:
        person_id = str(db.scalar(select(Person.id)))
    created = client.post("/api/v1/leave/requests", headers=headers, json={
        "person_id": person_id, "leave_type": "ANNUAL_LEAVE", "leave_slot": "AM",
        "starts_on": "2026-10-20", "ends_on": "2026-10-20", "status": "requested"})
    assert created.status_code == 200, created.text
    leave_id = created.json()["id"]
    url = f"/api/v1/leave/requests/{leave_id}"
    loaded, release, writer_started = Event(), Event(), Event()
    writer_pid = []
    original_snapshot = leave_history.snapshot
    original_lock = reference_registry.lock_namespace

    def gated_snapshot(value):
        if isinstance(value, LeaveRequest) and not release.is_set():
            loaded.set()
            assert release.wait(15), "History test gate was not released"
        return original_snapshot(value)

    def traced_writer_lock(db, namespace):
        if namespace == "normalization-edit":
            writer_pid.append(db.scalar(text("select pg_backend_pid()")))
            writer_started.set()
        return original_lock(db, namespace)

    monkeypatch.setattr(leave_history, "snapshot", gated_snapshot)
    # Cancel imports this helper inside its handler; the reader uses its existing API alias.
    monkeypatch.setattr(reference_registry, "lock_namespace", traced_writer_lock)
    with ThreadPoolExecutor(max_workers=2) as pool:
        reader = pool.submit(client.get, url + "/history", headers=headers)
        try:
            assert loaded.wait(10)
            writer = pool.submit(client.post, url + "/cancel", headers=headers,
                                 json={"reason": "Concurrent reviewed cancellation"})
            assert writer_started.wait(10)
            blocked = False
            deadline = monotonic() + 5
            while monotonic() < deadline:
                with factory() as db:
                    blocked = bool(db.scalar(text(
                        "select exists(select 1 from pg_locks where pid=:pid "
                        "and locktype='advisory' and not granted)"), {"pid": writer_pid[0]}))
                if blocked:
                    break
                sleep(0.02)
            assert blocked, "Must observe the actual writer waiting on the reader's lock"
        finally:
            release.set()
        observed = reader.result(timeout=15)
        changed = writer.result(timeout=15)
    assert observed.status_code == changed.status_code == 200
    body = observed.json()
    assert body["current"]["status"] == "requested"
    assert [e["action"] for e in body["events"]] == ["leave_created"]
    latest = client.get(url + "/history", headers=headers)
    assert latest.status_code == 200, latest.text
    body = latest.json()
    assert body["current"]["status"] == "cancelled"
    assert body["events"][-1]["reason"] == "Concurrent reviewed cancellation"


def test_postgres_seek_paging_and_explicit_merge_source_links(postgres_client):
    from app.services.member_merge import run_merge, undo_merge

    client, factory, headers = postgres_client
    with factory() as db:
        original = db.scalar(select(Person))
        operator = db.scalar(select(UserAccount))
        kept = Person(canonical_name="Kept history identity")
        row = LeaveRequest(person=original, starts_on=date(2026, 10, 20), ends_on=date(2026, 10, 20),
                           leave_type="ANNUAL_LEAVE", leave_slot="AM", status="approved", source="import")
        survivor = LeaveRequest(person=kept, starts_on=row.starts_on, ends_on=row.ends_on,
                                leave_type=row.leave_type, leave_slot=row.leave_slot, status="approved")
        db.add_all([kept, row, survivor])
        db.flush()
        leave_id, survivor_id = row.id, survivor.id
        original_id, target_id = original.id, kept.id
        author_id = operator.id
        fixed = datetime(2026, 10, 20)
        for number in range(205):
            db.add(NormalizationEvent(id=UUID(int=1000 + number), entity_id=leave_id,
                                      operator_id=author_id, operator_name="Audit Admin",
                                      action="leave_updated", created_at=fixed, details={}))
        batch = ImportBatch(source_filename="Original-PG.csv", import_kind="leave_upload", status="completed",
                            source_metadata={"actor_id": str(author_id)})
        for number in range(3):
            db.add(ImportSourceRecord(batch=batch, normalized_table="leave_requests", normalized_id=leave_id,
                                      record_type="leave_upload", created_at=fixed, row_index=number + 2))
        bin_batch = uuid4()
        db.add(DeletedRecord(kind="leave", entity_id=leave_id, batch_id=bin_batch, label="Not exposed",
                             deleted_at=fixed, purge_after=fixed + timedelta(days=30)))
        db.add(NormalizationEvent(entity_id=leave_id, operator_id=author_id, operator_name="Audit Admin",
                                  action="leave_deleted", created_at=fixed + timedelta(seconds=1),
                                  details={"batch_id": str(bin_batch)}))
        db.commit()
    url = f"/api/v1/leave/requests/{leave_id}/history/page"
    cursor, ids = None, []
    for _ in range(10):
        params = {"category": "audit", "limit": 37}
        if cursor:
            params["cursor"] = cursor
        response = client.get(url, headers=headers, params=params)
        assert response.status_code == 200, response.text
        body = response.json()
        ids.extend(event["id"] for event in body["events"])
        cursor = body["pagination"]["next_cursor"]
        if cursor is None:
            break
    assert len(ids) == len(set(ids)) == 206
    source_page = client.get(url, headers=headers, params={"category": "imports", "limit": 2})
    assert source_page.status_code == 200, source_page.text
    assert len(source_page.json()["sources"]) == 2
    next_page = client.get(url, headers=headers, params={"category": "imports", "limit": 2,
        "cursor": source_page.json()["pagination"]["next_cursor"]})
    assert len(next_page.json()["sources"]) == 1
    bins = client.get(url, headers=headers, params={"category": "recycle"})
    assert bins.status_code == 200, bins.text
    assert bins.json()["events"] == []  # JSON batch equality prevents an audit/bin duplicate.
    with factory() as db:
        result = run_merge(db, target_id, [original_id], operator=db.get(UserAccount, author_id))
        db.commit()
    view = client.get(f"/api/v1/leave/requests/{survivor_id}/history", headers=headers)
    assert view.status_code == 200, view.text
    body = view.json()
    assert str(leave_id) in body["lineage_ids"]
    assert any(source["filename"] == "Original-PG.csv" for source in body["sources"])
    merged, = [event for event in body["events"] if event["action"] == "leave_identity_merged"]
    assert merged["record_id"] == str(leave_id)
    assert merged["survivor_leave_id"] == str(survivor_id)
    with factory() as db:
        undo_merge(db, UUID(result["merge_id"]), operator=db.get(UserAccount, author_id))
        db.commit()
    restored = client.get(f"/api/v1/leave/requests/{leave_id}/history", headers=headers)
    assert restored.status_code == 200, restored.text
    assert restored.json()["current"]["person_id"] == str(original_id)
