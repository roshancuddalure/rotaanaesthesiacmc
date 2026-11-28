"""Contract-based cross-consumer fixtures, with independently enumerated boundaries."""

from datetime import date, datetime, timedelta
from itertools import combinations
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.api.v1.member_workspace import section
from app.models import LeaveRequest
from app.services.extra_duty import build_context, strict_blockers
from app.services.extra_duty_verify import load_month_state
from app.services.leave import leave_day_entries
from app.services.leave_semantics import known_slot, leave_intervals, union_intervals
from app.services.ot_availability import canonical_availability
from app.services.rota_assignment import validate_assignment
from app.services.rota_candidates import candidate_context, slot_candidates_with_context
from app.services.rota_rules import read_phase_one_rules
from app.services.rota_safety import leaves_by_day_and_person, person_blockers, slot_leave_blocks
from app.services.rota_template import leave_blocks_rule
from tests.test_ot_assignment_integration import environment as environment
from tests.test_ot_availability import requirement


@pytest.mark.parametrize("code,hour,full,expected", [
    ("AM", 7, False, True), ("AM", 11, False, True), ("AM", 12, False, False),
    ("PM", 11, False, True), ("PM", 12, False, True), ("PM", 23, False, True),
    ("NIGHT", 7, False, True), ("NIGHT", 8, False, False), ("NIGHT", 17, False, True),
    ("NIGHT", 18, False, True), ("NIGHT", 23, False, True),
    ("AM", 18, True, True), ("PM", 8, True, True), ("NIGHT", 12, True, True),
    ("FULL_DAY", 12, False, True), ("CUSTOM", 12, False, True), ("unexpected", 8, False, True),
])
def test_duty_and_template_follow_approved_interval_boundary_table(code, hour, full, expected):
    day = date(2026, 11, 19)
    hours = 24 if full else 8
    begins = datetime(2026, 11, 19, hour)
    leave = SimpleNamespace(leave_slot=code, starts_on=day, ends_on=day)
    slot = SimpleNamespace(is_24hr=full, duty_date=day, starts_at=begins,
                           ends_at=begins+timedelta(hours=hours))
    rule = SimpleNamespace(is_24hr=full, start_time=f"{hour:02d}:00",
                           end_time=f"{(hour+hours)%24:02d}:00",duration_hours=hours)
    assert slot_leave_blocks(leave, slot) is expected
    assert leave_blocks_rule(code, rule) is expected


def test_all_partial_combinations_match_independent_minute_union_and_duplicate_invariance():
    day = date(2028, 2, 29)
    midnight = datetime(2028, 2, 29)
    # Explicit contract sets: independent minute enumeration, not production merge logic.
    minutes = {"AM": set(range(720)), "PM": set(range(720, 1440)),
               "NIGHT": set(range(480)) | set(range(1080, 1440)), "FULL_DAY": set(range(1440))}
    for length in range(5):
        for codes in combinations(minutes, length):
            expected = set().union(*(minutes[code] for code in codes))
            spans = [span for code in codes for span in leave_intervals(
                SimpleNamespace(leave_slot=code, starts_on=day, ends_on=day), day, day)]
            merged = union_intervals(spans + spans)
            assert merged == union_intervals(reversed(spans))
            observed = {minute for minute in range(1440) if any(
                span.starts_at <= midnight + timedelta(minutes=minute) < span.ends_at for span in merged)}
            assert observed == expected
            assert sum((span.ends_at - span.starts_at).total_seconds() for span in merged) == len(expected) * 60


def test_unknown_slot_safety_fallback_is_not_precise_accounting_and_night_stays_on_date():
    last = date(2026, 11, 30)
    row = SimpleNamespace(leave_slot="CUSTOM", starts_on=last, ends_on=last)
    assert not known_slot(row.leave_slot)
    assert leave_intervals(row, last, last, conservative_unknown=False) == ()
    span, = leave_intervals(row, last, last)
    assert (span.starts_at, span.ends_at) == (datetime(2026, 11, 30), datetime(2026, 12, 1))
    row.leave_slot = "NIGHT"
    spans = leave_intervals(row, last, last)
    assert [(s.starts_at, s.ends_at) for s in spans] == [
        (datetime(2026, 11, 30), datetime(2026, 11, 30, 8)),
        (datetime(2026, 11, 30, 18), datetime(2026, 12, 1))]
    assert leave_intervals(row, date(2026, 12, 1), date(2026, 12, 31)) == ()


@pytest.mark.parametrize("status,approved,pending", [
    ("approved", True, False), ("APPROVED", True, False),
    ("requested", False, True), ("REQUESTED", False, True),
    ("imported_pending_review", False, True), ("cancelled", False, False),
    ("rejected", False, False), ("aproved", False, False), ("approved ", False, False),
])
def test_same_canonical_record_reconciles_calendar_profile_ot_normal_and_strict_consumers(
        environment, status, approved, pending):
    db, unit, people, target = environment
    person = people[0]
    row = LeaveRequest(person=person, leave_type="ANNUAL_LEAVE", leave_slot="AM",
                       starts_on=target.duty_date, ends_on=target.duty_date, status=status)
    db.add(row)
    db.commit()
    rows = list(db.scalars(select(LeaveRequest)))
    calendar = leave_day_entries(db, rows, "2026-11")
    assert bool(calendar.get(str(target.duty_date))) is (approved or pending)
    assert len(section(person.id, "leave", db)["rows"]) == 1  # History retains every state.
    day_leaves = leaves_by_day_and_person(db, "2026-11").get(target.duty_date, {})
    hard, warnings = person_blockers(person_id=person.id, slot=target, day_leaves=day_leaves,
                                     same_day_assignments={}, previous_day_assignments={})
    assert bool(hard) is approved
    assert bool(warnings) is pending
    context = candidate_context(db, "2026-11")
    validation = validate_assignment(db, slot=target, person=person, replace_existing=True, context=context)
    leave_issues = [item for item in validation["issues"] if item["code"] == "leave"]
    assert {item["severity"] for item in leave_issues} == (
        {"error"} if approved else {"warning"} if pending else set())
    candidates = slot_candidates_with_context(db, slot=target, context=context)
    candidate = next(candidate for candidate in candidates["candidates"] if candidate["person_id"] == str(person.id))
    assert {item["severity"] for item in candidate["validation_issues"] if item["code"] == "leave"} == (
        {"error"} if approved else {"warning"} if pending else set())
    rules = read_phase_one_rules(db)
    for stress, expected in [(False, approved), (True, approved or pending)]:
        available = canonical_availability(db, (requirement(unit),), rules, include_pending=stress)
        member = next(member for member in available["people"] if member.id == person.id)
        assert sum((span.ends_at - span.starts_at).total_seconds() / 3600 for span in member.blocked) == (
            12 if expected else 0)
    strict_context = build_context(db, "2026-11", target.rota_period, rules)
    strict = strict_blockers(strict_context, person.id, target, unit.id)
    assert any(item["code"] == "leave" for item in strict) is (approved or pending)
    independent = load_month_state(db, "2026-11", rules)
    assert any(code == "leave" for code, _ in independent.blockers(person.id, target, unit.id)) is (approved or pending)
