"""Retrieve every retained evidence row beyond overview limits, including UUID ties."""

import base64
import json
from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pytest

from app.models import DeletedRecord, ImportBatch, ImportSourceRecord, MemberMerge, NormalizationEvent
from app.services.leave_history import MAX_EVENTS, MAX_RECORDS, history
from tests.test_normalization_registry import registry as registry


@pytest.mark.parametrize("category", ["audit", "imports", "recycle", "merges"])
def test_all_evidence_categories_page_beyond_overview_with_equal_timestamps(registry, category):
    client, sessions, operator = registry
    leave_id = uuid4()
    count = MAX_EVENTS + 5
    fixed = datetime(2026, 11, 10, 9)
    with sessions() as db:
        batch = ImportBatch(source_filename="Original source.csv", import_kind="leave_upload", status="completed",
                            source_metadata={"actor_id": str(operator.id)})
        for number in reversed(range(count)):
            key = UUID(int=1000 + number)
            if category == "audit":
                db.add(NormalizationEvent(id=key, entity_id=leave_id, operator_id=operator.id,
                                          operator_name=operator.display_name, action="leave_updated",
                                          created_at=fixed, details={"after": {"status": "approved", "notes": "PRIVATE"}}))
            elif category == "imports":
                db.add(ImportSourceRecord(id=key, batch=batch, normalized_table="leave_requests",
                                          normalized_id=leave_id, created_at=fixed, record_type="leave_upload",
                                          cleaned_value=json.dumps({"status": "approved", "notes": "PRIVATE"})))
            elif category == "recycle":
                db.add(DeletedRecord(id=key, kind="leave", entity_id=leave_id, batch_id=uuid4(),
                                     label="PRIVATE", payload={"private": "PRIVATE"}, deleted_at=fixed,
                                     purge_after=fixed + timedelta(days=30)))
            else:
                db.add(MemberMerge(id=key, target_id=uuid4(), target_name="PRIVATE", source_ids=[],
                                   source_names=[], operator_name="Recorded Operator", merged_at=fixed,
                                   payload={"steps": [{"table": "leave_requests", "action": "move",
                                                       "pk": {"id": str(leave_id)},
                                                       "before": {"notes": "PRIVATE"}, "changes": {}}]}))
        db.commit()
    overview = client.get(f"/api/v1/leave/requests/{leave_id}/history")
    assert overview.status_code == 200, overview.text
    assert len(overview.json()["events"]) == MAX_EVENTS
    assert len(overview.json()["evidence_pages"]) == 4
    cursor, observed = None, []
    for _ in range(10):
        params = {"category": category, "limit": 37}
        if cursor:
            params["cursor"] = cursor
        response = client.get(f"/api/v1/leave/requests/{leave_id}/history/page", params=params)
        assert response.status_code == 200, response.text
        body = response.json()
        assert "PRIVATE" not in json.dumps(body)
        assert len(body["events"]) <= 37
        observed.extend(e["id"] for e in body["events"])
        cursor = body["pagination"]["next_cursor"]
        assert body["pagination"]["has_more"] is bool(cursor)
        if cursor is None:
            break
    else:
        pytest.fail("Pagination did not terminate")
    assert len(observed) == len(set(observed)) == count
    actual_keys = [UUID(event_id.split(":")[1]).int for event_id in observed]
    assert actual_keys == list(range(1000, 1000 + count))


def test_cursors_reject_cross_record_cross_category_and_invalid_values(registry):
    client, sessions, operator = registry
    leave_id = uuid4()
    with sessions() as db:
        for _ in range(2):
            db.add(NormalizationEvent(entity_id=leave_id, operator_id=operator.id,
                                      operator_name=operator.display_name, action="leave_created", details={}))
        db.commit()
    url = f"/api/v1/leave/requests/{leave_id}/history/page"
    response = client.get(url, params={"category": "audit", "limit": 1})
    cursor = response.json()["pagination"]["next_cursor"]
    assert cursor
    assert client.get(url, params={"category": "imports", "cursor": cursor}).status_code == 422
    assert client.get(f"/api/v1/leave/requests/{uuid4()}/history/page",
                      params={"category": "audit", "cursor": cursor}).status_code == 422
    invalid_shape = base64.urlsafe_b64encode(json.dumps({"v": 1, "record": str(leave_id),
        "category": "audit", "after": ["2026-11-10T00:00:00", str(uuid4())]}).encode()).decode()
    for invalid in ["", "not-base64!", "x" * 2049, invalid_shape]:
        assert client.get(url, params={"category": "audit", "cursor": invalid}).status_code == 422
    for limit in [0, 201, "bad"]:
        assert client.get(url, params={"category": "audit", "limit": limit}).status_code == 422
    assert client.get(url, params={"category": "unknown"}).status_code == 422
    operator.role = "hod"
    assert client.get(url, params={"category": "audit"}).status_code == 403


def test_deep_ancestry_can_be_followed_without_losing_source_identity(registry):
    client, sessions, operator = registry
    keys = [uuid4() for _ in range(MAX_RECORDS + 6)]
    with sessions() as db:
        for child, parent in zip(keys, keys[1:]):
            db.add(NormalizationEvent(entity_id=child, operator_id=operator.id,
                                      operator_name=operator.display_name, action="leave_split",
                                      details={"parent_leave_id": str(parent)}))
        db.add(NormalizationEvent(entity_id=keys[-1], operator_id=operator.id,
                                  operator_name=operator.display_name, action="leave_created", details={}))
        db.commit()
    body = client.get(f"/api/v1/leave/requests/{keys[0]}/history").json()
    assert "lineage_truncated" in body["coverage"]["warnings"]
    unvisited, = body["unvisited_record_ids"]
    rest = client.get(f"/api/v1/leave/requests/{unvisited}/history").json()
    assert set(body["lineage_ids"]) | set(rest["lineage_ids"]) == set(map(str, keys))


def test_legacy_merge_with_no_survivor_remains_explicit_and_empty_pages_can_advance(registry):
    client, sessions, _ = registry
    key = uuid4()
    with sessions() as db:
        for number in range(2):
            db.add(MemberMerge(id=UUID(int=100 + number), target_id=uuid4(), target_name="Kept",
                               source_ids=[], source_names=[], operator_name="Recorded operator",
                               merged_at=datetime(2026, 11, 10), payload={
                                   "unrelated_reference": str(key), "steps": []}))
        db.add(MemberMerge(id=UUID(int=102), target_id=uuid4(), target_name="Kept",
                           source_ids=[], source_names=[], operator_name="Recorded operator",
                           merged_at=datetime(2026, 11, 10), payload={"steps": [{
                               "table": "leave_requests", "action": "drop", "pk": {"id": str(key)},
                               "before": {}, "changes": {}}]}))
        db.commit()
        assert "merge_duplicate_survivor_link_unavailable" in history(db, key)["coverage"]["warnings"]
    cursor = None
    observed = []
    for _ in range(3):
        params = {"category": "merges", "limit": 1}
        if cursor:
            params["cursor"] = cursor
        body = client.get(f"/api/v1/leave/requests/{key}/history/page", params=params).json()
        observed.extend(body["events"])
        cursor = body["pagination"]["next_cursor"]
    assert len(observed) == 1
    assert observed[0]["action"] == "leave_identity_merged"
    assert cursor is None


def test_reviewed_leave_reason_is_bound_to_review_and_retained_without_private_notes(registry):
    from tests.test_leave_history import seed, values

    client, sessions, _ = registry
    person_id = seed(sessions)
    proposed = values(person_id, change_reason=" Corrected imported session ")
    review = client.post("/api/v1/normalization/records/leave/preview", json={"values": proposed})
    assert review.status_code == 200, review.text
    token = review.json()["review_token"]
    changed = client.post("/api/v1/normalization/records/leave/save", json={
        "values": {**proposed, "change_reason": "Different explanation"}, "review_token": token})
    assert changed.status_code == 409, changed.text
    saved = client.post("/api/v1/normalization/records/leave/save", json={"values": proposed, "review_token": token})
    assert saved.status_code == 200, saved.text
    body = client.get(f"/api/v1/leave/requests/{saved.json()['id']}/history").json()
    event, = body["events"]
    assert event["reason"] == "Corrected imported session"
    assert "PRIVATE" not in json.dumps(body)
    bad = client.post("/api/v1/normalization/records/leave/preview", json={
        "values": {**proposed, "change_reason": "x" * 2001}})
    assert bad.status_code == 422


def test_empty_category_does_not_claim_whole_lifecycle_is_missing(registry):
    from tests.test_leave_history import seed, values

    client, sessions, _ = registry
    person_id = seed(sessions)
    created = client.post("/api/v1/leave/requests", json=values(person_id))
    assert created.status_code == 200, created.text
    response = client.get(f"/api/v1/leave/requests/{created.json()['id']}/history/page",
                          params={"category": "imports"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["events"] == [] and body["sources"] == []
    assert body["pagination"]["has_more"] is False
    assert "no_attributable_lifecycle_events" not in body["coverage"]["warnings"]


def test_parent_link_beyond_overview_cap_remains_retrievable(registry):
    client, sessions, operator = registry
    child, parent = uuid4(), uuid4()
    with sessions() as db:
        for number in range(MAX_EVENTS):
            db.add(NormalizationEvent(entity_id=child, operator_id=operator.id,
                                      operator_name=operator.display_name, action="leave_updated", details={},
                                      created_at=datetime(2026, 11, 10) + timedelta(seconds=number)))
        db.add(NormalizationEvent(entity_id=child, operator_id=operator.id,
                                  operator_name=operator.display_name, action="leave_split",
                                  details={"parent_leave_id": str(parent)}, created_at=datetime(2026, 11, 11)))
        batch = ImportBatch(source_filename="Parent original.csv", import_kind="leave_upload", status="completed")
        db.add(ImportSourceRecord(batch=batch, normalized_table="leave_requests", normalized_id=parent,
                                  record_type="leave_upload"))
        db.commit()
    overview = client.get(f"/api/v1/leave/requests/{child}/history").json()
    assert str(parent) not in overview["lineage_ids"]
    url = f"/api/v1/leave/requests/{child}/history/page"
    first = client.get(url, params={"category": "audit"}).json()
    second = client.get(url, params={"category": "audit", "cursor": first["pagination"]["next_cursor"]}).json()
    assert second["related_record_ids"] == [str(parent)]
    assert second["events"][0]["parent_leave_id"] == str(parent)
    source = client.get(f"/api/v1/leave/requests/{parent}/history").json()
    assert source["sources"][0]["filename"] == "Parent original.csv"
