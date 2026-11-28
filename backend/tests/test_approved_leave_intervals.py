"""Approved any-overlap policy exercised through real allocation validators."""
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.models import LeaveRequest
from app.services.extra_duty import build_context, strict_blockers
from app.services.extra_duty_verify import load_month_state
from app.services.leave_semantics import leave_blocks_slot, leaves_for_slot

from app.services.rota_assignment import validate_assignment
from app.services.rota_candidates import candidate_context, slot_candidates_with_context
from app.services.rota_optimizer import validate_plan
from app.services.rota_rules import DutyRule, read_phase_one_rules
from app.services.superadmin_allocation import strict_blocks
from tests.test_balance_duties import db as db  # noqa: F401
from tests.test_balance_duties import edit_rules, make_slot, make_unit, member, relaxed, setup_month

def test_person_leave_lookup_preserves_boundary_rows_without_visiting_other_people():
    from uuid import uuid4

    person, other = uuid4(), uuid4()
    before, after = date(2026, 5, 31), date(2026, 6, 1)
    first, second = SimpleNamespace(id=uuid4()), SimpleNamespace(id=uuid4())

    class UnrelatedRows:
        def __iter__(self):
            raise AssertionError('Single-person lookup traversed unrelated leaves')

    index = {before: {person: [first], other: UnrelatedRows()},
             after: {person: [first, second], other: UnrelatedRows()}}
    slot = SimpleNamespace(duty_date=before, starts_at=datetime(2026, 5, 31, 18),
                           ends_at=datetime(2026, 6, 1, 8))
    assert leaves_for_slot(index, slot, person) == {person: [first, second]}
    assert leaves_for_slot(index, slot, uuid4()) == {}
    clean = {day: {person: rows[person], other: [SimpleNamespace(id=uuid4())]}
             for day, rows in index.items()}
    assert leaves_for_slot(clean, slot, person)[person] == leaves_for_slot(clean, slot)[person]


@pytest.mark.parametrize('start,band,leave_offset,day', [
    (10, 'PM', 0, 3), (13, 'NIGHT', 0, 3), (18, 'AM', 1, 3),
    (18, 'AM', 1, 31),
])
@pytest.mark.parametrize('status,ordinary_block,strict_block', [
    ('approved', True, True), ('requested', False, True),
    ('imported_pending_review', False, True), ('cancelled', False, False),
])
def test_overlap_is_consistent_across_real_consumers(db, start, band, leave_offset,
                                                    day, status, ordinary_block, strict_block):
    def configure(rules):
        relaxed(rules)
        rules.duty_rules.append(DutyRule(key='INTERVAL_POLICY_TEST', label='Interval duty',
            group='audit', duration_hours=8, start_time=f'{start:02}:00',
            end_time=f'{(start+8)%24:02}:00', allowed_call_levels=['1ST_CALL']))
    edit_rules(db, configure)
    unit = make_unit(db, 'INTERVAL_POLICY_TEST')
    person = member(db, 'Interval worker', unit)
    setup_month(db, [unit])
    duty_day = date(2026, 5, day)
    leave_day = duty_day + timedelta(days=leave_offset)
    db.add(LeaveRequest(person=person, leave_type='ANNUAL_LEAVE', leave_slot=band,
                       starts_on=leave_day, ends_on=leave_day, status=status))
    slot = make_slot(db, unit, duty_day, duty_type='INTERVAL_POLICY_TEST', hours=8, start_hour=start)
    db.commit()
    context = candidate_context(db, '2026-05')
    result = validate_assignment(db, slot=slot, person=person, replace_existing=True, context=context)
    assert any(x['code'] == 'leave' and x['severity'] == 'error' for x in result['issues']) is ordinary_block
    row = next(c for c in slot_candidates_with_context(db, slot=slot, context=context)['candidates']
               if c['person_id'] == str(person.id))
    assert any(x['code'] == 'leave' and x['severity'] == 'error' for x in row['validation_issues']) is ordinary_block
    # Automated proposals already require clear validation, including no warnings.
    assert bool(validate_plan(db, context, {str(slot.id): slot}, {str(slot.id): str(person.id)})) is strict_block
    rules = read_phase_one_rules(db)
    extra = build_context(db, '2026-05', slot.rota_period, rules)
    assert any(x['code'] == 'leave' for x in strict_blockers(extra, person.id, slot, unit.id)) is strict_block
    state = load_month_state(db, '2026-05', rules)
    assert any(code == 'leave' for code, _ in state.blockers(person.id, slot, unit.id)) is strict_block
    assert any(x['code'] == 'on_leave' for x in strict_blocks(state, person.id, slot)) is strict_block


@pytest.mark.parametrize('day,start,hours,band,leave_day,blocked', [
    (date(2026, 5, 3), 4, 8, 'PM', date(2026, 5, 3), False),
    (date(2026, 5, 3), 12, 8, 'AM', date(2026, 5, 3), False),
    (date(2026, 5, 31), 16, 8, 'AM', date(2026, 6, 1), False),
    (date(2026, 12, 31), 18, 8, 'AM', date(2027, 1, 1), True),
])
def test_half_open_boundaries_and_year_edge(day, start, hours, band, leave_day, blocked):
    begins = datetime.combine(day, datetime.min.time()) + timedelta(hours=start)
    slot = SimpleNamespace(duty_date=day, starts_at=begins,
                           ends_at=begins+timedelta(hours=hours), is_24hr=False)
    leave = SimpleNamespace(starts_on=leave_day, ends_on=leave_day, leave_slot=band)
    assert leave_blocks_slot(leave, slot) is blocked


def test_next_month_leave_is_part_of_current_duty_snapshot(db):
    from app.services.scheduling_snapshot import capture
    edit_rules(db, relaxed)
    unit = make_unit(db,'BOUNDARY_SNAPSHOT')
    person = member(db,'Boundary snapshot worker',unit)
    setup_month(db,[unit])
    make_slot(db,unit,date(2026,5,31),hours=8,start_hour=18)
    db.commit()
    original = capture(db).digest
    db.add(LeaveRequest(person=person,leave_type='ANNUAL_LEAVE',leave_slot='AM',
                       starts_on=date(2026,6,1),ends_on=date(2026,6,1),status='approved'))
    db.commit()
    assert capture(db).digest != original
    context = candidate_context(db,'2026-05')
    assert date(2026,6,1) in context.leaves
