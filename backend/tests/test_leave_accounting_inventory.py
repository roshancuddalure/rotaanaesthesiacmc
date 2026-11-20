"""N18 characterization: real scheduling bands versus legacy request-day totals.

These are reporting integration anchors, not proof that profile statistics exist.
"""

from datetime import date, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.v1.member_workspace import section
from app.db.session import Base
from app.models import LeaveRequest, Person
from app.services.leave import leave_summary
from app.services.ot_availability import leave_windows, merge_intervals
from app.services.rota_safety import slot_leave_blocks


@pytest.mark.parametrize(
    "slots,expected",
    [
        (["AM", "AM"], [(0, 12)]),
        (["AM", "PM"], [(0, 24)]),
        (["AM", "NIGHT"], [(0, 12), (18, 24)]),
        (["FULL_DAY", "AM"], [(0, 24)]),
        (["AM", "PM", "NIGHT"], [(0, 24)]),
        (["NIGHT"], [(0, 8), (18, 24)]),
    ],
)
def test_partial_leave_union_is_identity_time_not_request_count(slots, expected):
    day = date(2026, 11, 10)
    spans = [span for slot in slots for span in leave_windows(
        LeaveRequest(leave_slot=slot, starts_on=day, ends_on=day), day, day)]
    merged = merge_intervals(spans)
    midnight = datetime(2026, 11, 10)
    actual = [((row.starts_at - midnight).total_seconds() / 3600,
               (row.ends_at - midnight).total_seconds() / 3600) for row in merged]
    assert actual == expected


def test_leap_day_and_month_clipping_preserve_stored_dates():
    row = LeaveRequest(leave_slot="FULL_DAY", starts_on=date(2028, 2, 28),
                       ends_on=date(2028, 3, 1))
    feb = merge_intervals(leave_windows(row, date(2028, 2, 1), date(2028, 2, 29)))
    march = merge_intervals(leave_windows(row, date(2028, 3, 1), date(2028, 3, 31)))
    assert [(s.starts_at, s.ends_at) for s in feb] == [
        (datetime(2028, 2, 28), datetime(2028, 3, 1))]
    assert [(s.starts_at, s.ends_at) for s in march] == [
        (datetime(2028, 3, 1), datetime(2028, 3, 2))]
    assert row.starts_on == date(2028, 2, 28)
    assert row.ends_on == date(2028, 3, 1)


def test_short_duty_start_hour_policy_is_separate_from_ot_interval_overlap():
    day = date(2026, 11, 10)
    leave = LeaveRequest(leave_slot="PM", starts_on=day, ends_on=day)
    duty = SimpleNamespace(is_24hr=False, starts_at=datetime(2026, 11, 10, 11),
                           ends_at=datetime(2026, 11, 10, 15))
    # Preserve the explicit legacy start-hour policy: N20 cannot silently replace it.
    assert slot_leave_blocks(leave, duty) is False
    span, = leave_windows(leave, day, day)
    assert duty.starts_at < span.ends_at and duty.ends_at > span.starts_at
    duty.is_24hr = True
    assert slot_leave_blocks(leave, duty) is True


def test_legacy_summary_counts_request_days_not_elapsed_approved_union():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            person = Person(canonical_name="Disposable accounting member", call_level="3RD_CALL")
            for slot, status, first, last in [
                ("AM", "approved", 10, 10), ("AM", "approved", 10, 10),
                ("FULL_DAY", "requested", 11, 12),
                ("FULL_DAY", "approved", 20, 21),
                ("FULL_DAY", "cancelled", 10, 12),
                ("FULL_DAY", "rejected", 10, 12),
            ]:
                db.add(LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot=slot,
                                    status=status, starts_on=date(2026, 11, first),
                                    ends_on=date(2026, 11, last)))
            db.commit()
            summary = leave_summary(db, "2026-11")
            assert summary["total_requests"] == 4
            assert summary["blocking_requests"] == 3
            assert summary["people_on_leave"] == 1
            # 2 duplicate AM request-days + 2 pending days + 2 future-approved days.
            # This existing field must not be relabeled as actual approved leave taken.
            assert summary["total_leave_days"] == 6
            assert summary["status_counts"] == {"approved": 3, "requested": 1}
    finally:
        engine.dispose()


def test_workspace_reuses_complete_canonical_leave_list_without_private_notes():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            person = Person(canonical_name="Disposable complete history member")
            records = [LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot="AM",
                                   starts_on=date(2026, 10, day), ends_on=date(2026, 10, day),
                                   status="approved", source="import", notes="Private medical note")
                       for day in range(1, 32)]
            db.add_all(records)
            db.commit()
            rows = section(person.id, "leave", db)["rows"]
            assert len(rows) == 31  # Full workspace is not the 30-row recent profile summary.
            assert {row["id"] for row in rows} == {str(record.id) for record in records}
            assert {row["slot"] for row in rows} == {"AM"}
            assert {row["source"] for row in rows} == {"import"}
            assert all("notes" not in row and "raw_person_name" not in row for row in rows)
    finally:
        engine.dispose()
