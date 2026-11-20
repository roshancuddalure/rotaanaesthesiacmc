"""Batch projection equals canonical import semantics without preview mutations."""

from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import event, select

from app.core.config import settings
from app.models import LeaveRequest, OtCalendar
from app.services.leave_import_ot_impact import proposed_set, review_import, validate_review
from app.services.leave_ot_impact import compare_month
from app.services.rota_rules import get_phase_one_rules
from tests.test_ot_assignment_context import environment as environment, save_calendar


def imported_row(
    person,
    *,
    identity=None,
    status="approved",
    start="2026-11-19",
    end=None,
    key="CSV:2",
    action="create",
):
    return {
        "key": key,
        "issues": [],
        "target_id": str(identity) if identity else None,
        "action": action,
        "after": {
            "person_id": str(person.id),
            "starts_on": start,
            "ends_on": end or start,
            "leave_slot": "FULL_DAY",
            "status": status,
        },
    }


def saved(
    db, person, *, source="normalized_import", start=date(2026, 11, 19), end=None, status="approved"
):
    row = LeaveRequest(
        person=person,
        starts_on=start,
        ends_on=end or start,
        leave_slot="FULL_DAY",
        status=status,
        leave_type="CASUAL_LEAVE",
        source=source,
        notes="PRIVATE",
    )
    db.add(row)
    db.commit()
    return row


def prepare(db, unit, monkeypatch):
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    get_phase_one_rules(db)
    db.commit()
    save_calendar(db, unit)


def test_append_batch_is_readonly_and_matches_actual_approved_import(environment, monkeypatch):
    db, unit, person, _ = environment
    prepare(db, unit, monkeypatch)
    statements = []

    def observe(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.lstrip().split(None, 1)[0].upper())

    event.listen(db.get_bind(), "before_cursor_execute", observe)
    try:
        report, authority = review_import(db, "2026-11", "append", [imported_row(person)], [])
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", observe)
    (month,) = report["months"]
    assert month["before"]["status"] == "feasible" and month["after"]["status"] == "infeasible"
    assert month["after"]["mandatory_covered"] == month["before"]["mandatory_covered"] - 1
    assert authority["selected_keys"] == ["CSV:2"]
    assert not {"INSERT", "UPDATE", "DELETE"}.intersection(statements)
    assert not db.new and not db.dirty and not list(db.scalars(select(LeaveRequest)))
    assert "PRIVATE" not in str(report)
    saved(db, person)
    actual = compare_month(db, "2026-11", ())
    assert actual["before"]["mandatory_covered"] == month["after"]["mandatory_covered"]


@pytest.mark.parametrize("status", ["cancelled", "rejected", "imported_pending_review"])
def test_update_replaces_only_canonical_identity_and_preserves_pending_semantics(
    environment, monkeypatch, status
):
    db, unit, person, _ = environment
    prepare(db, unit, monkeypatch)
    original = saved(db, person)
    other = saved(db, person, start=date(2026, 11, 20), source="manual")
    row = imported_row(person, identity=original.id, status=status, action="update")
    report, _ = review_import(db, "2026-11", "update_matching", [row], [])
    assert (
        report["months"][0]["after"]["mandatory_covered"]
        == report["months"][0]["before"]["mandatory_covered"] + 1
    )
    assert original.status == "approved" and other.status == "approved"
    values, _ = proposed_set(db, "2026-11", "update_matching", [row])
    assert len(values) == 1 and values[0].id == original.id


def test_replace_preserves_cross_month_remnants_and_manual_records(environment, monkeypatch):
    db, unit, person, _ = environment
    prepare(db, unit, monkeypatch)
    original = saved(db, person, start=date(2026, 10, 30), end=date(2026, 12, 2))
    manual = saved(db, person, start=date(2026, 11, 20), source="manual")
    replacement = imported_row(person, status="cancelled")
    projections, _ = proposed_set(db, "2026-11", "replace_month", [replacement])
    assert not any(value.id == manual.id for value in projections)
    left = next(value for value in projections if str(value.id).endswith(":left"))
    right = next(value for value in projections if str(value.id).endswith(":right"))
    assert (left.starts_on, left.ends_on) == (date(2026, 10, 30), date(2026, 10, 31))
    assert (right.starts_on, right.ends_on) == (date(2026, 12, 1), date(2026, 12, 2))
    report, _ = review_import(db, "2026-11", "replace_month", [replacement], [])
    (month,) = report["months"]
    assert month["month"] == "2026-11"
    assert month["after"]["mandatory_covered"] == month["before"]["mandatory_covered"] + 29
    assert original.starts_on == date(2026, 10, 30) and original.ends_on == date(2026, 12, 2)
    assert manual.status == "approved"


def test_exclusions_and_ot_calendar_edits_invalidate_review(environment, monkeypatch):
    db, unit, person, _ = environment
    prepare(db, unit, monkeypatch)
    rows = [imported_row(person), imported_row(person, key="CSV:3", start="2026-11-20")]
    _, authority = review_import(db, "2026-11", "append", rows, ["CSV:3"])
    batch = SimpleNamespace(settings={"ot_review": authority})
    validate_review(db, batch, rows[:1])
    with pytest.raises(HTTPException) as error:
        validate_review(db, batch, rows)
    assert error.value.status_code == 409
    db.scalar(select(OtCalendar)).revision = "b" * 64
    db.commit()
    with pytest.raises(HTTPException) as error:
        validate_review(db, batch, rows[:1])
    assert error.value.status_code == 409


def test_invalid_included_rows_are_unknown_not_partially_evaluated(environment, monkeypatch):
    db, unit, person, _ = environment
    prepare(db, unit, monkeypatch)
    bad = imported_row(person, key="CSV:3")
    bad["issues"] = ["Unresolved identity"]
    report, _ = review_import(db, "2026-11", "append", [imported_row(person), bad], [])
    assert report["status"] == "not_evaluated" and report["months"] == []
    assert "Resolve all included" in report["basis"]
    report, _ = review_import(db, "2026-11", "append", [imported_row(person), bad], ["CSV:3"])
    assert report["status"] == "evaluated"


def test_disabled_legacy_and_flag_changes_require_honest_review(environment, monkeypatch):
    db, _, person, _ = environment
    monkeypatch.setattr(settings, "ot_calendar_enabled", False)
    report, authority = review_import(db, "2026-11", "append", [imported_row(person)], [])
    assert report["status"] == "disabled"
    validate_review(db, SimpleNamespace(settings={}), [imported_row(person)])
    monkeypatch.setattr(settings, "ot_calendar_enabled", True)
    for metadata in ({}, {"ot_review": authority}):
        with pytest.raises(HTTPException) as error:
            validate_review(db, SimpleNamespace(settings=metadata), [imported_row(person)])
        assert error.value.status_code == 409


def test_unchanged_manual_target_is_preserved_in_replacement(environment):
    db, _, person, _ = environment
    original = saved(db, person, source="manual")
    values, previous = proposed_set(
        db,
        "2026-11",
        "replace_month",
        [imported_row(person, identity=original.id, action="unchanged")],
    )
    assert values == previous == ()
