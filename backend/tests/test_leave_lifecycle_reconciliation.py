"""N25 canonical import/profile/calendar/OT/safety lifecycle reconciliation."""

import json
from datetime import date
from uuid import UUID

from sqlalchemy import select

from app.models import LeaveRequest, Person, PersonAlias
from app.services.ot_assignment_context import load_assignment_guard
from app.services.rota_rules import read_phase_one_rules
from app.services.rota_safety import leaves_by_day_and_person
from tests.test_leave_import_ot_api import preview, setup
from tests.test_normalization_registry import registry as registry


def reconciled(client, factory, person_id, *, approved_hours, pending_hours, days, status):
    params = {"year": 2026, "month": 11, "as_of": "2026-12-01T00:00:00"}
    response = client.get(
        f"/api/v1/admin/member-workspace/{person_id}/leave-statistics", params=params
    )
    assert response.status_code == 200, response.text
    stats = response.json()
    assert stats["approved"]["whole_period"]["clock_hours"] == approved_hours
    assert stats["pending"]["whole_period"]["clock_hours"] == pending_hours
    profile = client.get(f"/api/v1/admin/member-workspace/{person_id}/leave")
    assert profile.status_code == 200, profile.text
    (row,) = profile.json()["rows"]
    assert row["status"] == status
    calendar = client.get("/api/v1/leave/calendar?month=2026-11")
    assert calendar.status_code == 200, calendar.text
    actual = {
        day
        for day, entries in calendar.json()["days"].items()
        if any(entry["person_id"] == person_id for entry in entries)
    }
    assert actual == set(days)
    with factory() as db:
        (saved,) = list(
            db.scalars(select(LeaveRequest).where(LeaveRequest.person_id == UUID(person_id)))
        )
        assert str(saved.id) == row["id"] and saved.status == status
        safety = leaves_by_day_and_person(db, "2026-11")
        assert {str(day) for day, people in safety.items() if UUID(person_id) in people} == set(
            days
        )
        rules = read_phase_one_rules(db)
        guard = load_assignment_guard(db, "2026-11", rules)
        report = guard.check((), rules)
        assert report["status"] == ("infeasible" if approved_hours else "feasible"), report
        # No other absent members: mandatory role-band shortage is one per
        # approved full-day absence, independently of duplicate record counts.
        assert (
            report["capacity"]["mandatory_required"] - report["capacity"]["mandatory_covered"]
            == approved_hours // 24
        )
    assert "PRIVATE" not in json.dumps(stats) and "PRIVATE" not in json.dumps(profile.json())
    return row["id"]


def test_import_approve_amend_cancel_reconciles_all_canonical_consumers(registry, monkeypatch):
    client, factory, person_id = setup(registry, monkeypatch)
    imported = preview(client, status="imported_pending_review")
    endpoint = f"/api/v1/import-review/{imported['id']}/apply"
    applied = client.post(endpoint, json={})
    assert applied.status_code == 200, applied.text
    assert client.post(endpoint, json={}).json() == applied.json()
    leave_id = reconciled(
        client,
        factory,
        person_id,
        approved_hours=0,
        pending_hours=24,
        days=["2026-11-19"],
        status="imported_pending_review",
    )
    duplicate = preview(client, status="imported_pending_review")
    assert duplicate["rows"][0]["action"] == "unchanged", duplicate
    replay = client.post(f"/api/v1/import-review/{duplicate['id']}/apply", json={})
    assert replay.status_code == 200, replay.text
    assert replay.json()["created"] == 0 and replay.json()["unchanged"] == 1
    reviewed = client.post("/api/v1/leave/approval-preview", json={"month": "2026-11"})
    assert reviewed.status_code == 200, reviewed.text
    approved = client.post(
        "/api/v1/leave/approve-month",
        json={"month": "2026-11", "review_token": reviewed.json()["review_token"]},
    )
    assert approved.status_code == 200, approved.text
    assert (
        reconciled(
            client,
            factory,
            person_id,
            approved_hours=24,
            pending_hours=0,
            days=["2026-11-19"],
            status="approved",
        )
        == leave_id
    )
    values = {
        "person_id": person_id,
        "starts_on": "2026-11-20",
        "ends_on": "2026-11-21",
        "leave_type": "ANNUAL_LEAVE",
        "leave_slot": "FULL_DAY",
        "status": "approved",
        "change_reason": "Fixture amendment",
        "notes": "PRIVATE",
    }
    review = client.post(
        "/api/v1/normalization/records/leave/preview", json={"values": values, "identity": leave_id}
    )
    # The editor uses an identity field; keep this request aligned with its
    # canonical endpoint rather than mutating the saved record in the fixture.
    assert review.status_code == 200, review.text
    saved = client.post(
        "/api/v1/normalization/records/leave/save",
        json={
            "values": values,
            "identity": leave_id,
            "review_token": review.json()["review_token"],
        },
    )
    assert saved.status_code == 200, saved.text
    assert (
        reconciled(
            client,
            factory,
            person_id,
            approved_hours=48,
            pending_hours=0,
            days=["2026-11-20", "2026-11-21"],
            status="approved",
        )
        == leave_id
    )
    cancelled = client.post(
        f"/api/v1/leave/requests/{leave_id}/cancel", json={"reason": "Fixture cancellation"}
    )
    assert cancelled.status_code == 200, cancelled.text
    assert (
        reconciled(
            client,
            factory,
            person_id,
            approved_hours=0,
            pending_hours=0,
            days=[],
            status="cancelled",
        )
        == leave_id
    )
    history = client.get(f"/api/v1/leave/requests/{leave_id}/history")
    assert history.status_code == 200, history.text
    body = history.json()
    assert any(source["filename"] == "leave.csv" for source in body["sources"])
    actions = {event["action"] for event in body["events"]}
    assert {"leave_imported", "leave_bulk_approved", "leave_updated", "leave_cancelled"}.issubset(
        actions
    ), actions
    assert "PRIVATE" not in json.dumps(body)
    with factory() as db:
        assert db.query(LeaveRequest).count() == 1


def test_real_identity_merge_and_undo_keep_leave_accounting_and_import_sources(
    registry, monkeypatch
):
    client, factory, person_id = setup(registry, monkeypatch)
    imported = preview(client, status="approved")
    response = client.post(f"/api/v1/import-review/{imported['id']}/apply", json={})
    assert response.status_code == 200, response.text
    with factory() as db:
        source = db.get(Person, UUID(person_id))
        source.aliases.append(PersonAlias(alias="Fixture old spelling", source="manual"))
        target = Person(canonical_name="Fixture kept identity", call_level="3RD_CALL")
        db.add(target)
        db.commit()
        target_id = str(target.id)
        leave_id = str(db.scalar(select(LeaveRequest.id)))
    body = {"target_person_id": target_id, "source_person_ids": [person_id]}
    previewed = client.post("/api/v1/admin/members/merge/preview", json=body)
    assert previewed.status_code == 200, previewed.text
    merged = client.post(
        "/api/v1/admin/members/merge",
        json={**body, "preview_token": previewed.json()["preview_token"]},
    )
    assert merged.status_code == 200, merged.text
    assert (
        reconciled(
            client,
            factory,
            target_id,
            approved_hours=24,
            pending_hours=0,
            days=["2026-11-19"],
            status="approved",
        )
        == leave_id
    )
    history = client.get(f"/api/v1/leave/requests/{leave_id}/history").json()
    assert any(source["filename"] == "leave.csv" for source in history["sources"])
    assert any(event["action"] == "leave_identity_merged" for event in history["events"])
    undone = client.post(f"/api/v1/admin/members/merges/{merged.json()['merge_id']}/undo")
    assert undone.status_code == 200, undone.text
    assert (
        reconciled(
            client,
            factory,
            person_id,
            approved_hours=24,
            pending_hours=0,
            days=["2026-11-19"],
            status="approved",
        )
        == leave_id
    )
    history = client.get(f"/api/v1/leave/requests/{leave_id}/history").json()
    assert any(event["action"] == "leave_identity_merge_undone" for event in history["events"])
    assert "PRIVATE" not in json.dumps(history)


def test_archiving_identity_retains_leave_history_but_removes_current_ot_capacity(
    registry, monkeypatch
):
    client, factory, person_id = setup(registry, monkeypatch)
    imported = preview(client, status="approved")
    result = client.post(f"/api/v1/import-review/{imported['id']}/apply", json={})
    assert result.status_code == 200, result.text
    profile = client.get(f"/api/v1/admin/member-workspace/{person_id}").json()["member"]
    archived = client.put(
        f"/api/v1/admin/member-workspace/{person_id}",
        json={**profile, "active_status": "archived", "aliases": [], "designations": []},
    )
    assert archived.status_code == 200, archived.text
    report = client.get(
        f"/api/v1/admin/member-workspace/{person_id}/leave-statistics",
        params={"year": 2026, "month": 11, "as_of": "2026-12-01T00:00:00"},
    )
    assert report.status_code == 200, report.text
    assert report.json()["approved"]["whole_period"]["clock_hours"] == 24
    with factory() as db:
        leave_id = str(db.scalar(select(LeaveRequest.id)))
        guard = load_assignment_guard(db, "2026-11", read_phase_one_rules(db))
        assert not any(str(person.id) == person_id for person in guard.people)
    history = client.get(f"/api/v1/leave/requests/{leave_id}/history")
    assert history.status_code == 200, history.text
    assert history.json()["current"]["person_id"] == person_id
    assert any(source["filename"] == "leave.csv" for source in history.json()["sources"])
    calendar = client.get("/api/v1/leave/calendar?month=2026-11").json()
    assert any(row["leave_id"] == leave_id for row in calendar["days"]["2026-11-19"])


def test_lifecycle_read_privacy_and_existing_admin_authority(registry, monkeypatch):
    client, factory, person_id = setup(registry, monkeypatch)
    imported = preview(client, status="approved")
    applied = client.post(f"/api/v1/import-review/{imported['id']}/apply", json={})
    assert applied.status_code == 200, applied.text
    with factory() as db:
        record = db.scalar(select(LeaveRequest))
        record.notes = "PRIVATE clinical fixture"
        db.commit()
        leave_id = str(record.id)
    _, _, operator = registry
    operator.role = "rota_board_member"
    history = client.get(f"/api/v1/leave/requests/{leave_id}/history")
    assert history.status_code == 403
    assert (
        client.post(
            "/api/v1/admin/members/merge/preview",
            json={"target_person_id": person_id, "source_person_ids": []},
        ).status_code
        == 403
    )
    profile = client.get(f"/api/v1/admin/member-workspace/{person_id}")
    assert profile.status_code == 200, profile.text
    assert "PRIVATE" not in json.dumps(profile.json())
    assert (
        client.put(
            f"/api/v1/admin/member-workspace/{person_id}",
            json={
                **profile.json()["member"],
                "active_status": "archived",
                "aliases": [],
                "designations": [],
            },
        ).status_code
        == 403
    )
    statistics = client.get(
        f"/api/v1/admin/member-workspace/{person_id}/leave-statistics",
        params={"year": 2026, "month": 11},
    )
    assert statistics.status_code == 200, statistics.text
    assert "PRIVATE" not in json.dumps(statistics.json())
    with factory() as db:
        assert (
            db.query(LeaveRequest).count() == 1
            and db.get(Person, UUID(person_id)).active_status == "active"
        )


def test_duplicate_leave_merge_keeps_one_interval_and_transitive_import_provenance(
    registry, monkeypatch
):
    client, factory, source_id = setup(registry, monkeypatch)
    reviewed = preview(client, status="approved")
    response = client.post(f"/api/v1/import-review/{reviewed['id']}/apply", json={})
    assert response.status_code == 200, response.text
    with factory() as db:
        original = db.scalar(select(LeaveRequest))
        original_id = str(original.id)
        target = Person(canonical_name="Fixture duplicate survivor", call_level="3RD_CALL")
        db.add(target)
        db.flush()
        duplicate = LeaveRequest(
            person=target,
            starts_on=date(2026, 11, 19),
            ends_on=date(2026, 11, 19),
            leave_type="ANNUAL_LEAVE",
            leave_slot="FULL_DAY",
            status="approved",
            source="manual",
        )
        db.add(duplicate)
        db.commit()
        target_id, survivor_id = str(target.id), str(duplicate.id)
    body = {"target_person_id": target_id, "source_person_ids": [source_id]}
    review = client.post("/api/v1/admin/members/merge/preview", json=body)
    assert review.status_code == 200, review.text
    merged = client.post(
        "/api/v1/admin/members/merge",
        json={**body, "preview_token": review.json()["preview_token"]},
    )
    assert merged.status_code == 200, merged.text
    assert (
        reconciled(
            client,
            factory,
            target_id,
            approved_hours=24,
            pending_hours=0,
            days=["2026-11-19"],
            status="approved",
        )
        == survivor_id
    )
    with factory() as db:
        assert (
            db.query(LeaveRequest).count() == 1 and db.get(LeaveRequest, UUID(original_id)) is None
        )
    history = client.get(f"/api/v1/leave/requests/{survivor_id}/history")
    assert history.status_code == 200, history.text
    assert original_id in history.json()["lineage_ids"]
    assert any(source["filename"] == "leave.csv" for source in history.json()["sources"])
    undone = client.post(f"/api/v1/admin/members/merges/{merged.json()['merge_id']}/undo")
    assert undone.status_code == 200, undone.text
    assert (
        reconciled(
            client,
            factory,
            source_id,
            approved_hours=24,
            pending_hours=0,
            days=["2026-11-19"],
            status="approved",
        )
        == original_id
    )
    with factory() as db:
        assert db.query(LeaveRequest).count() == 2
        assert db.get(LeaveRequest, UUID(survivor_id)).person_id == UUID(target_id)
