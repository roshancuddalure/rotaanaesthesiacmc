"""Authenticated frozen import OT evidence, application and retry consistency."""

import json
from datetime import date
from uuid import UUID

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models import LeaveRequest, OtCalendar, Person, PersonPosting, Unit
from app.services.leave_ot_impact import compare_month
from app.services.rota_rules import get_phase_one_rules
from tests.test_normalization_registry import registry as registry
from tests.test_operational_import import seed
from tests.test_ot_assignment_context import save_calendar


def setup(registry, monkeypatch):
    client, factory, _ = registry
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    person_id, unit_id = seed(factory)
    with factory() as db:
        person = db.get(Person, UUID(person_id))
        person.call_level = "3RD_CALL"
        unit = db.get(Unit, UUID(unit_id))
        unit.minimum_free_people = 0
        db.add(
            PersonPosting(
                person=person, unit=unit, posting_type="3RD_CALL", starts_on=date(2026, 10, 1)
            )
        )
        get_phase_one_rules(db)
        db.commit()
        save_calendar(db, unit)
    return client, factory, person_id


def preview(client, *, mode="append", excluded=(), status="approved", two=False):
    content = f"member_name,starts_on,status\nAsha AJ,2026-11-19,{status}\n"
    if two:
        content += f"Asha AJ,2026-11-20,{status}\n"
    response = client.post(
        "/api/v1/import-review/leave/preview",
        data={
            "month": "2026-11",
            "mode": mode,
            "settings_json": json.dumps({"excluded": list(excluded)}),
        },
        files={"file": ("leave.csv", content, "text/csv")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_real_import_review_matches_final_ot_and_retry_is_idempotent(registry, monkeypatch):
    client, factory, _ = setup(registry, monkeypatch)
    review = preview(client)
    report = review["ot_impact"]["months"][0]
    assert report["before"]["status"] == "feasible" and report["after"]["status"] == "infeasible"
    with factory() as db:
        assert not list(db.scalars(select(LeaveRequest)))
    path = f"/api/v1/import-review/{review['id']}/apply"
    result = client.post(path, json={})
    assert result.status_code == 200, result.text
    with factory() as db:
        actual = compare_month(db, "2026-11", ())
        assert actual["before"]["mandatory_covered"] == report["after"]["mandatory_covered"]
        db.scalar(select(OtCalendar)).revision = "b" * 64
        db.commit()
    assert client.post(path, json={}).json() == result.json()
    with factory() as db:
        assert db.query(LeaveRequest).count() == 1


def test_changed_inclusion_requires_refresh_and_exact_included_report(registry, monkeypatch):
    client, factory, _ = setup(registry, monkeypatch)
    review = preview(client, two=True)
    response = client.post(
        f"/api/v1/import-review/{review['id']}/apply", json={"excluded": ["CSV:3"]}
    )
    assert response.status_code == 409, response.text
    review = preview(client, two=True, excluded=["CSV:3"])
    month = review["ot_impact"]["months"][0]
    assert month["before"]["mandatory_covered"] - month["after"]["mandatory_covered"] == 1
    applied = client.post(
        f"/api/v1/import-review/{review['id']}/apply", json={"excluded": ["CSV:3"]}
    )
    assert applied.status_code == 200, applied.text
    with factory() as db:
        assert db.query(LeaveRequest).count() == 1


def test_calendar_edit_invalidates_frozen_import_without_creating_leave(registry, monkeypatch):
    client, factory, _ = setup(registry, monkeypatch)
    review = preview(client)
    with factory() as db:
        db.scalar(select(OtCalendar)).revision = "b" * 64
        db.commit()
    response = client.post(f"/api/v1/import-review/{review['id']}/apply", json={})
    assert response.status_code == 409, response.text
    with factory() as db:
        assert db.query(LeaveRequest).count() == 0


@pytest.mark.parametrize("mode", ["update_matching", "replace_month"])
def test_real_edit_or_replacement_matches_projection_and_retains_manual_and_remnants(
    registry, monkeypatch, mode
):
    client, factory, person_id = setup(registry, monkeypatch)
    with factory() as db:
        person = db.get(Person, UUID(person_id))
        original = LeaveRequest(
            person=person,
            starts_on=date(2026, 10, 30) if mode == "replace_month" else date(2026, 11, 19),
            ends_on=date(2026, 12, 2) if mode == "replace_month" else date(2026, 11, 19),
            status="approved",
            leave_slot="FULL_DAY",
            leave_type="ANNUAL_LEAVE",
            source="normalized_import",
        )
        manual = LeaveRequest(
            person=person,
            starts_on=date(2026, 11, 20),
            ends_on=date(2026, 11, 20),
            status="approved",
            leave_slot="FULL_DAY",
            leave_type="ANNUAL_LEAVE",
            source="manual",
        )
        db.add_all([original, manual])
        db.commit()
        manual_id = manual.id
    review = preview(client, mode=mode, status="cancelled")
    assert not review["rows"][0]["issues"], review
    predicted = review["ot_impact"]["months"][0]["after"]["mandatory_covered"]
    response = client.post(
        f"/api/v1/import-review/{review['id']}/apply", json={"acknowledge_warnings": True}
    )
    assert response.status_code == 200, response.text
    with factory() as db:
        actual = compare_month(db, "2026-11", ())
        assert actual["before"]["mandatory_covered"] == predicted
        assert db.get(LeaveRequest, manual_id).status == "approved"
        if mode == "replace_month":
            approved = list(
                db.scalars(
                    select(LeaveRequest).where(
                        LeaveRequest.source == "normalized_import",
                        LeaveRequest.status == "approved",
                    )
                )
            )
            assert {(row.starts_on, row.ends_on) for row in approved} == {
                (date(2026, 10, 30), date(2026, 10, 31)),
                (date(2026, 12, 1), date(2026, 12, 2)),
            }
