"""N19: read actual canonical writes and retained provenance, without private payloads."""

import json
from datetime import date, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.models import (
    DeletedRecord, ImportBatch, ImportSourceRecord, LeaveRequest, MemberMerge,
    NormalizationEvent, Person,
)
from app.services.leave_history import history
from tests.test_normalization_registry import registry as registry


def seed(sessions):
    with sessions() as db:
        person = Person(canonical_name="History Fixture Member", active_status="active")
        db.add(person)
        db.commit()
        return str(person.id)


def values(person_id, **extra):
    return {"person_id": person_id, "leave_type": "ANNUAL_LEAVE", "leave_slot": "AM",
            "starts_on": "2026-11-10", "ends_on": "2026-11-10", "status": "requested",
            "notes": "PRIVATE medical text", **extra}


def test_manual_edit_approval_cancel_reconstructs_actual_actor_and_states(registry):
    client, sessions, operator = registry
    person_id = seed(sessions)
    created = client.post("/api/v1/leave/requests", json=values(person_id))
    assert created.status_code == 200, created.text
    leave_id = created.json()["id"]
    edited = client.put(f"/api/v1/leave/requests/{leave_id}",
                        json=values(person_id, leave_slot="PM", change_reason=" Corrected requested session "))
    assert edited.status_code == 200, edited.text
    review = client.post("/api/v1/leave/approval-preview", json={"month": "2026-11"})
    assert review.status_code == 200, review.text
    approved = client.post("/api/v1/leave/approve-month", json={
        "month": "2026-11", "review_token": review.json()["review_token"], "reason": " Reviewed monthly requests "})
    assert approved.status_code == 200, approved.text
    assert client.post(f"/api/v1/leave/requests/{leave_id}/cancel").status_code == 200
    response = client.get(f"/api/v1/leave/requests/{leave_id}/history")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["current"]["status"] == "cancelled"
    events = body["events"]
    assert [e["action"] for e in events] == [
        "leave_created", "leave_updated", "leave_bulk_approved", "leave_cancelled"]
    assert {e["actor"]["id"] for e in events} == {str(operator.id)}
    assert events[1]["before"]["leave_slot"] == "AM"
    assert events[1]["after"]["leave_slot"] == "PM"
    assert events[1]["reason"] == "Corrected requested session"
    assert events[2]["before"]["status"] == "requested"
    assert events[2]["after"]["status"] == "approved"
    assert events[2]["reason"] == "Reviewed monthly requests"
    assert all(e["record_id"] == leave_id and e["recorded_at"].endswith("+00:00") for e in events)
    assert "PRIVATE" not in json.dumps(body)
    assert body["coverage"]["complete"] is False


def test_upload_then_manual_correction_retains_original_file_reference(registry):
    client, sessions, operator = registry
    person_id = seed(sessions)
    content = b"Name,From,To,Type,Status\nHistory Fixture Member,2026-11-10,2026-11-10,Annual Leave,Approved\n"
    preview = client.post("/api/v1/leave/import-preview?month=2026-11",
                          files={"file": ("original.csv", content, "text/csv")})
    assert preview.status_code == 200, preview.text
    applied = client.post("/api/v1/leave/import-apply?month=2026-11",
                          files={"file": ("original.csv", content, "text/csv")},
                          data={"preview_hash": preview.json()["preview_hash"]})
    assert applied.status_code == 200, applied.text
    with sessions() as db:
        leave_id = str(db.scalar(select(LeaveRequest.id)))
    updated = client.put(f"/api/v1/leave/requests/{leave_id}",
                         json=values(person_id, status="approved", leave_slot="PM"))
    assert updated.status_code == 200, updated.text
    body = client.get(f"/api/v1/leave/requests/{leave_id}/history").json()
    assert body["current"]["source"] == "import"
    source, = body["sources"]
    assert source["filename"] == "original.csv"
    assert source["row"] == 2
    assert source["actor"]["id"] == str(operator.id)
    assert source["record_id"] == leave_id
    assert {e["action"] for e in body["events"]} == {"leave_source_recorded", "leave_updated"}
    assert "PRIVATE" not in json.dumps(body)
    assert "raw_value" not in json.dumps(body)


def test_retained_delete_restore_and_merge_evidence_without_live_record(registry):
    _, sessions, operator = registry
    leave_id, person_id = uuid4(), uuid4()
    with sessions() as db:
        deletion = datetime(2026, 11, 12, 9)
        db.add(DeletedRecord(kind="leave", entity_id=leave_id, batch_id=uuid4(), label="Private label",
                             deleted_by_id=operator.id, deleted_by_name=operator.display_name,
                             deleted_at=deletion, purge_after=deletion + timedelta(days=30),
                             restored_at=deletion + timedelta(hours=1), restored_by_name="Restore Operator",
                             payload={"private": "PRIVATE"}))
        db.add(MemberMerge(target_id=uuid4(), target_name="Kept", source_ids=[str(person_id)],
                           source_names=["Original"], operator_id=operator.id,
                           operator_name=operator.display_name, merged_at=deletion + timedelta(hours=2),
                           undone_at=deletion + timedelta(hours=3), undone_by_name="Undo Operator",
                           payload={"steps": [{"table": "leave_requests", "action": "move",
                                               "pk": {"id": str(leave_id)},
                                               "before": {"person_id": str(person_id), "notes": "PRIVATE"},
                                               "changes": {"person_id": str(uuid4())}}]}))
        db.commit()
        body = history(db, leave_id)
        assert body["record_present"] is False
        assert body["current"] is None
        assert [e["action"] for e in body["events"]] == [
            "leave_deleted", "leave_restored", "leave_identity_merged", "leave_identity_merge_undone"]
        assert body["events"][2]["before"]["person_id"] == str(person_id)
        assert body["events"][1]["actor"]["id"] is None  # Existing bin stores restore name only.
        assert "PRIVATE" not in json.dumps(body)
        assert "Private label" not in json.dumps(body)


def test_missing_history_is_explicit_and_read_does_not_flush_or_create_events(registry):
    _, sessions, _ = registry
    person_id = seed(sessions)
    with sessions() as db:
        row = LeaveRequest(person_id=UUID(person_id), starts_on=date(2026, 11, 10),
                           ends_on=date(2026, 11, 10), status="approved", leave_type="ANNUAL_LEAVE")
        db.add(row)
        db.commit()
        leave_id = row.id  # Load expired PK before introducing a dirty draft.
        row.notes = "Unsaved private draft"
        body = history(db, leave_id)
        assert "no_attributable_lifecycle_events" in body["coverage"]["warnings"]
        assert body["events"] == []
        assert row in db.dirty
        assert history(db, uuid4()) is None
        assert len(db.new) == 0
        db.rollback()


def test_lineage_uses_exact_ids_and_projections_tolerate_malformed_legacy_details(registry):
    _, sessions, operator = registry
    parent, child = uuid4(), uuid4()
    with sessions() as db:
        batch = ImportBatch(source_filename="ancestor.csv", import_kind="leave_upload", status="completed",
                            source_metadata={"actor_id": str(operator.id)})
        db.add(ImportSourceRecord(batch=batch, normalized_table="leave_requests", normalized_id=parent,
                                  raw_value="PRIVATE", cleaned_value="PRIVATE", record_type="leave_upload"))
        db.add(NormalizationEvent(operator_id=operator.id, operator_name=operator.display_name,
                                  entity_id=child, action="leave_split",
                                  details={"parent_leave_id": str(parent), "before": "malformed", "after": []}))
        db.add(NormalizationEvent(operator_id=operator.id, operator_name=operator.display_name,
                                  entity_id=parent, action="leave_created", details="legacy malformed"))
        db.commit()
        body = history(db, child)
        assert set(body["lineage_ids"]) == {str(parent), str(child)}
        assert body["sources"][0]["record_id"] == str(parent)
        assert all(e.get("before") is None for e in body["events"])
        assert "PRIVATE" not in json.dumps(body)


def test_history_role_and_unknown_record(registry):
    client, _, operator = registry
    url = f"/api/v1/leave/requests/{uuid4()}/history"
    assert client.get(url).status_code == 404
    operator.role = "hod"
    assert client.get(url).status_code == 403
    operator.role = "computer_admin"
    assert client.get("/api/v1/leave/requests/invalid/history").status_code == 422


def test_optional_cancellation_reason_is_attributed_and_old_clients_still_work(registry):
    client, sessions, operator = registry
    person_id = seed(sessions)
    leave_id = client.post("/api/v1/leave/requests", json=values(person_id)).json()["id"]
    url = f"/api/v1/leave/requests/{leave_id}/cancel"
    assert client.post(url, json={"reason": "x" * 2001}).status_code == 422
    response = client.post(url, json={"reason": "  Requested dates changed  "})
    assert response.status_code == 200, response.text
    body = client.get(f"/api/v1/leave/requests/{leave_id}/history").json()
    event = body["events"][-1]
    assert event["action"] == "leave_cancelled"
    assert event["reason"] == "Requested dates changed"
    assert event["actor"]["id"] == str(operator.id)
    assert client.post(url, json={}).status_code == 200


def test_actual_reviewed_month_split_links_original_import_source(registry):
    client, sessions, operator = registry
    person_id = seed(sessions)
    with sessions() as db:
        original = LeaveRequest(person_id=UUID(person_id), leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY",
                                starts_on=date(2026, 10, 28), ends_on=date(2026, 12, 3),
                                status="approved", source="import", raw_person_name="Original imported spelling")
        db.add(original)
        db.flush()
        parent_id = original.id
        batch = ImportBatch(source_filename="first-source.csv", import_kind="leave_upload", status="completed",
                            source_metadata={"actor_id": str(operator.id)})
        db.add(ImportSourceRecord(batch=batch, normalized_table="leave_requests", normalized_id=parent_id,
                                  record_type="leave_upload", row_index=2, sheet_name="CSV"))
        db.commit()
    content = b"member_name,starts_on,ends_on,leave_type,leave_slot,status\nHistory Fixture Member,2026-11-09,2026-11-09,Annual Leave,FULL_DAY,approved\n"
    review = client.post("/api/v1/import-review/leave/preview",
                         data={"month": "2026-11", "mode": "replace_month"},
                         files={"file": ("replacement.csv", content, "text/csv")})
    assert review.status_code == 200, review.text
    applied = client.post(f"/api/v1/import-review/{review.json()['id']}/apply",
                          json={"acknowledge_warnings": True})
    assert applied.status_code == 200, applied.text
    with sessions() as db:
        leaves = list(db.scalars(select(LeaveRequest).order_by(LeaveRequest.starts_on)))
        assert [(row.starts_on, row.ends_on) for row in leaves] == [
            (date(2026, 10, 28), date(2026, 10, 31)),
            (date(2026, 11, 9), date(2026, 11, 9)),
            (date(2026, 12, 1), date(2026, 12, 3))]
        child = leaves[-1]
        assert child.raw_person_name == "Original imported spelling"
        body = history(db, child.id)
        assert set(body["lineage_ids"]) == {str(parent_id), str(child.id)}
        assert any(s["filename"] == "first-source.csv" and s["record_id"] == str(parent_id)
                   for s in body["sources"])
        split, = [e for e in body["events"] if e["action"] == "leave_split"]
        assert split["parent_leave_id"] == str(parent_id)
        assert split["actor"]["id"] == str(operator.id)
        replacement = history(db, leaves[1].id)
        assert replacement["sources"][0]["filename"] == "replacement.csv"
        assert replacement["events"][0]["action"] == "leave_imported"


def test_actual_delete_restore_remains_attributed_after_bin_payload_removed(registry):
    from app.services.recycle_bin import move_to_bin, restore

    client, sessions, operator = registry
    person_id = seed(sessions)
    leave_id = UUID(client.post("/api/v1/leave/requests", json=values(person_id)).json()["id"])
    with sessions() as db:
        batch_id = move_to_bin(db, operator, "leave", [leave_id])
        db.commit()
        body = history(db, leave_id)
        deleted = [e for e in body["events"] if e["action"] == "leave_deleted"]
        assert len(deleted) == 1  # Audit plus recovery payload must not double-count the event.
        assert deleted[0]["before"]["person_id"] == person_id
        assert deleted[0]["actor"]["id"] == str(operator.id)
        assert body["record_present"] is False
        result = restore(db, operator, batch_id)
        assert result["restored"] == 1 and result["failed"] == []
        body = history(db, leave_id)
        assert body["record_present"] is True
        assert len([e for e in body["events"] if e["action"] == "leave_restored"]) == 1
        # Model the existing retention purge, without altering that retention policy.
        for row in db.scalars(select(DeletedRecord).where(DeletedRecord.batch_id == batch_id)):
            db.delete(row)
        db.commit()
        body = history(db, leave_id)
        assert {e["action"] for e in body["events"]} == {"leave_created", "leave_deleted", "leave_restored"}
        assert "PRIVATE" not in json.dumps(body)


@pytest.mark.parametrize("duplicate", [False, True])
def test_actual_identity_merge_and_undo_preserve_original_leave_evidence(registry, duplicate):
    from app.services.member_merge import run_merge, undo_merge

    _, sessions, operator = registry
    with sessions() as db:
        original = Person(canonical_name="Original identity")
        kept = Person(canonical_name="Surviving identity")
        row = LeaveRequest(person=original, leave_type="ANNUAL_LEAVE", leave_slot="AM",
                           starts_on=date(2026, 11, 10), ends_on=date(2026, 11, 10),
                           status="approved", source="import")
        db.add_all([original, kept, row])
        if duplicate:
            db.add(LeaveRequest(person=kept, leave_type="ANNUAL_LEAVE", leave_slot="AM",
                                starts_on=row.starts_on, ends_on=row.ends_on, status="approved"))
        db.flush()
        source_person_id, target_person_id, leave_id = original.id, kept.id, row.id
        batch = ImportBatch(source_filename="identity-source.csv", import_kind="leave_upload", status="completed")
        db.add(ImportSourceRecord(batch=batch, normalized_table="leave_requests", normalized_id=leave_id,
                                  record_type="leave_upload", cleaned_value=json.dumps({
                                      "person_id": str(source_person_id), "status": "approved", "notes": "PRIVATE"})))
        db.commit()
        result = run_merge(db, target_person_id, [source_person_id], operator=operator)
        db.commit()
        body = history(db, leave_id)
        merged, = [e for e in body["events"] if e["action"] == "leave_identity_merged"]
        assert merged["before"]["person_id"] == str(source_person_id)
        assert merged["actor"]["id"] == str(operator.id)
        assert body["sources"][0]["filename"] == "identity-source.csv"
        assert body["record_present"] is (not duplicate)
        if duplicate:
            assert merged["survivor_leave_id"] is not None
            recovery = db.get(MemberMerge, UUID(result["merge_id"]))
            assert recovery.payload["leave_survivors"][str(leave_id)] == merged["survivor_leave_id"]
            assert all("survivor_id" not in step for step in recovery.payload["steps"])
            assert "merge_duplicate_survivor_link_unavailable" not in body["coverage"]["warnings"]
            survivor_history = history(db, UUID(merged["survivor_leave_id"]))
            assert any(source["filename"] == "identity-source.csv" for source in survivor_history["sources"])
            assert len([event for event in survivor_history["events"]
                        if event["action"] == "leave_identity_merged"]) == 1
        else:
            assert body["current"]["person_id"] == str(target_person_id)
        assert "PRIVATE" not in json.dumps(body)
        undo_merge(db, UUID(result["merge_id"]), operator=operator)
        db.commit()
        body = history(db, leave_id)
        assert body["current"]["person_id"] == str(source_person_id)
        assert any(e["action"] == "leave_identity_merge_undone" for e in body["events"])


def test_history_discloses_event_limit_without_modifying_retained_evidence(registry):
    from app.services.leave_history import MAX_EVENTS

    _, sessions, operator = registry
    leave_id = uuid4()
    with sessions() as db:
        for number in range(MAX_EVENTS + 1):
            db.add(NormalizationEvent(entity_id=leave_id, operator_id=operator.id,
                                      operator_name=operator.display_name, action="leave_updated",
                                      details={"after": {"status": "approved", "notes": "PRIVATE"}},
                                      created_at=datetime(2026, 11, 10) + timedelta(seconds=number)))
        db.commit()
        body = history(db, leave_id)
        assert len(body["events"]) == MAX_EVENTS
        assert "audit_events_truncated" in body["coverage"]["warnings"]
        assert "PRIVATE" not in json.dumps(body)
        assert len(list(db.scalars(select(NormalizationEvent)))) == MAX_EVENTS + 1
