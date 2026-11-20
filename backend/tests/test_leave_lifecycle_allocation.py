"""N25 actual assignment validation follows canonical imported leave lifecycle."""

import json
from uuid import UUID

from sqlalchemy import select

from app.core.config import settings
from app.models import DutyAssignment, LeaveRequest, Person
from app.services import rota_compute as compute
from app.services.rota_assignment import validate_assignment
from tests.test_leave_repair import api as api
from tests.test_rota_compute import compute_db as compute_db


def test_imported_pending_approval_amendment_and_cancel_reach_actual_assignment_validator(
    api, monkeypatch
):
    client, db, _, _ = api
    monkeypatch.setattr(settings, "ot_calendar_enabled", False)
    compute.candidate_context(db, "2026-05")
    period, _ = compute.monthly_setup(db, "2026-05")
    slot = next(
        row
        for row in compute.open_slots_for_period(db, period.id)
        if str(row.duty_date) == "2026-05-02"
    )
    safe = db.scalar(select(Person).where(Person.canonical_name == "Safe Member"))
    response = client.post(
        "/api/v1/import-review/leave/preview",
        data={"month": "2026-05", "settings_json": json.dumps({})},
        files={
            "file": (
                "leave.csv",
                b"member_name,starts_on,status\nSafe Member,2026-05-02,imported_pending_review\n",
                "text/csv",
            )
        },
    )
    assert response.status_code == 200, response.text
    applied = client.post(f"/api/v1/import-review/{response.json()['id']}/apply", json={})
    assert applied.status_code == 200, applied.text
    row = db.scalar(select(LeaveRequest).where(LeaveRequest.person_id == safe.id))
    assert row is not None

    def issues():
        return [
            issue
            for issue in validate_assignment(db, slot=slot, person=safe, replace_existing=False)[
                "issues"
            ]
            if issue["code"] == "leave"
        ]

    pending = issues()
    assert pending and all(issue["severity"] == "warning" for issue in pending), pending
    approved = client.put(
        f"/api/v1/leave/requests/{row.id}",
        json={
            "person_id": str(safe.id),
            "starts_on": "2026-05-02",
            "ends_on": "2026-05-02",
            "leave_type": "ANNUAL_LEAVE",
            "leave_slot": "FULL_DAY",
            "status": "approved",
        },
    )
    assert approved.status_code == 200, approved.text
    blocking = issues()
    assert blocking and any(issue["severity"] == "error" for issue in blocking), blocking
    amended = client.put(
        f"/api/v1/leave/requests/{row.id}",
        json={
            "person_id": str(safe.id),
            "starts_on": "2026-05-04",
            "ends_on": "2026-05-04",
            "leave_type": "ANNUAL_LEAVE",
            "leave_slot": "FULL_DAY",
            "status": "approved",
            "change_reason": "Corrected date",
        },
    )
    assert amended.status_code == 200, amended.text
    assert issues() == []
    other = next(
        value
        for value in compute.open_slots_for_period(db, period.id)
        if str(value.duty_date) == "2026-05-04"
    )
    assert any(
        issue["code"] == "leave" and issue["severity"] == "error"
        for issue in validate_assignment(db, slot=other, person=safe, replace_existing=False)[
            "issues"
        ]
    )
    cancelled = client.post(
        f"/api/v1/leave/requests/{row.id}/cancel", json={"reason": "No longer needed"}
    )
    assert cancelled.status_code == 200, cancelled.text
    assert not any(
        issue["code"] == "leave"
        for issue in validate_assignment(db, slot=other, person=safe, replace_existing=False)[
            "issues"
        ]
    )
    db.refresh(row)
    assert row.status == "cancelled" and row.person_id == UUID(str(safe.id))
    assert db.query(DutyAssignment).count() == 0
