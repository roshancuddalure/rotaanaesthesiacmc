"""N20: request records, identity counts and clock-time unions stay distinct."""

import json
from datetime import date
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.session import Base
from app.models import LeaveRequest, Person
from app.services.leave import leave_pressure, leave_summary
from app.services.leave_accounting import interval_coverage


def record(person, slot="FULL_DAY", status="approved", first=10, last=None):
    return SimpleNamespace(id=uuid4(), person_id=person, leave_slot=slot, status=status,
                           starts_on=date(2026, 11, first), ends_on=date(2026, 11, last or first),
                           notes="PRIVATE medical detail")


def coverage(rows):
    return interval_coverage(rows, date(2026, 11, 1), date(2026, 11, 30))


def test_n18_worked_records_keep_request_counts_separate_from_union_hours():
    person = uuid4()
    rows = [record(person, "AM"), record(person, "AM"),
            record(person, status="requested", first=11, last=12),
            record(person, first=20, last=21), record(person, status="cancelled"),
            record(person, status="rejected"), record(person, status="aproved")]
    result = coverage(rows)
    groups = result["groups"]
    assert result["status_record_counts"] == {
        "approved": 3, "requested": 1, "cancelled": 1, "rejected": 1, "aproved": 1}
    assert groups["approved"]["record_count"] == 3
    assert groups["approved"]["clock_hours"] == 60
    assert groups["approved"]["person_calendar_dates"] == 3
    assert groups["pending"]["clock_hours"] == 48
    assert groups["active"]["clock_hours"] == 108
    assert groups["active"]["person_calendar_dates"] == 5
    assert result["unrecognized_status_record_ids"] == [str(rows[-1].id)]
    assert coverage(reversed(rows)) == result
    assert result["attendance_verified"] is False
    assert result["working_days"] is None and result["entitlement_balance"] is None
    assert "PRIVATE" not in json.dumps(result)


def test_pending_overlap_is_not_additional_approved_time_and_people_never_share_a_union():
    first, second = uuid4(), uuid4()
    rows = [record(first, "AM"), record(first, status="requested"), record(second)]
    result = coverage(rows)["groups"]
    assert result["approved"]["clock_hours"] == 36
    assert result["pending"]["clock_hours"] == 24
    assert result["active"]["clock_hours"] == 48  # Not 36 + 24.
    assert result["active"]["people_with_records"] == 2
    assert result["active"]["person_calendar_dates"] == 2
    same = record(first, "NIGHT")
    assert coverage([same, same])["groups"]["approved"]["record_count"] == 1
    assert coverage([same, same])["groups"]["approved"]["clock_hours"] == 14


def test_unknown_session_exposes_known_lower_bound_without_charging_safety_fallback():
    person = uuid4()
    unknown = record(person, "CUSTOM")
    result = coverage([unknown, record(person, "AM")])["groups"]["approved"]
    assert result["precise"] is False
    assert result["clock_hours"] is None and result["person_calendar_dates"] is None
    assert result["known_clock_hours"] == 12
    assert result["known_person_calendar_dates"] == 1
    assert result["unresolved_record_ids"] == [str(unknown.id)]


def test_leap_clipping_and_stored_date_night_anchor():
    row = record(uuid4())
    row.starts_on, row.ends_on = date(2028, 2, 28), date(2028, 3, 1)
    february = interval_coverage([row], date(2028, 2, 1), date(2028, 2, 29))
    march = interval_coverage([row], date(2028, 3, 1), date(2028, 3, 31))
    assert february["groups"]["approved"]["clock_hours"] == 48
    assert march["groups"]["approved"]["clock_hours"] == 24
    assert row.starts_on == date(2028, 2, 28) and row.ends_on == date(2028, 3, 1)
    night = record(uuid4(), "NIGHT", first=30)
    assert coverage([night])["groups"]["approved"]["clock_hours"] == 14
    assert interval_coverage([night], date(2026, 12, 1), date(2026, 12, 31))["groups"]["active"]["clock_hours"] == 0


def test_accounting_rejects_invalid_scope_and_unidentified_rows():
    with pytest.raises(ValueError, match="precedes"):
        interval_coverage([], date(2026, 11, 2), date(2026, 11, 1))
    row = record(uuid4())
    row.id = None
    with pytest.raises(ValueError, match="canonical"):
        coverage([row])
    inverted = record(uuid4(), first=12, last=10)
    result = coverage([inverted])
    assert result["invalid_date_record_ids"] == [str(inverted.id)]
    assert result["groups"]["approved"]["clock_hours"] is None


def test_pressure_counts_distinct_people_but_keeps_every_source_record():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            first = Person(canonical_name="Disposable first", call_level="3RD_CALL")
            second = Person(canonical_name="Disposable second", call_level="2ND_CALL")
            for person, slot, status, day in [
                (first, "AM", "approved", 10), (first, "AM", "approved", 10),
                (first, "PM", "requested", 10), (second, "FULL_DAY", "requested", 10),
                (second, "FULL_DAY", "approved", 11),
            ]:
                db.add(LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot=slot,
                                    status=status, starts_on=date(2026, 11, day), ends_on=date(2026, 11, day)))
            db.commit()
            summary = leave_summary(db, "2026-11")
            assert summary["total_requests"] == 5
            assert summary["total_leave_days"] == 5  # Explicit legacy request-days, not union dates.
            assert summary["busiest_day"] == {"date": "2026-11-10", "count": 2}
            assert summary["interval_coverage"]["groups"]["approved"]["clock_hours"] == 36
            assert summary["interval_coverage"]["groups"]["active"]["person_calendar_dates"] == 3
            pressure = leave_pressure(db, "2026-11")
            first_day, second_day = pressure["days"]
            assert (first_day["total_people"], first_day["blocking_people"]) == (2, 1)
            assert len(first_day["entries"]) == 4
            assert first_day["unit_counts"] == {"Unknown unit": 2}
            assert first_day["call_level_counts"] == {"3RD_CALL": 1, "2ND_CALL": 1}
            assert (second_day["total_people"], second_day["blocking_people"]) == (1, 1)
            assert pressure["unit_totals"] == {"Unknown unit": 3}
            assert pressure["call_level_totals"] == {"3RD_CALL": 1, "2ND_CALL": 2}
            assert len(pressure["blockers"]) == 5
    finally:
        engine.dispose()
