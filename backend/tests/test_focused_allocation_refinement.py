"""Forced search exhaustion exercises real candidates and the complete safety checker."""
from collections import Counter
from datetime import date
from time import perf_counter

import pytest
from sqlalchemy import select

from app.models import DutyAssignment, DutySlot, LeaveRequest, Person, MemberCallLevelChange, PersonPosting
from app.services import rota_optimizer as optimizer
from app.services.allocation_refinement import refine_incumbent, fairness_summary
from app.services.rota_candidates import candidate_context, slot_candidates_with_context
from tests.test_rota_auto_fill import create_slot
from tests.test_rota_compute import compute_db as compute_db
from tests.test_ot_assignment_integration import environment as environment  # noqa: F401


def concentrated_candidates(monkeypatch, favored):
    original = optimizer.slot_candidates_with_context
    def ranked(db, *, slot, context):
        row = original(db, slot=slot, context=context)
        row['candidates'].sort(key=lambda c: (c['person_id'] != str(favored.id), c['person_id']))
        return row
    monkeypatch.setattr(optimizer, 'slot_candidates_with_context', ranked)
    monkeypatch.setattr(optimizer.cp_model.CpSolver, 'solve', lambda *args: optimizer.cp_model.UNKNOWN)


def test_exhausted_solver_still_balances_real_safe_month(compute_db, monkeypatch, record_property):
    db, _ = compute_db
    db.query(LeaveRequest).delete()
    source = db.scalar(select(DutySlot).where(DutySlot.call_level == '1ST_CALL'))
    for day in (7, 10, 13, 16, 19, 22):
        create_slot(db, source.unit, date(2026, 5, day))
    db.commit()
    slots = {str(s.id): s for s in db.scalars(select(DutySlot).where(DutySlot.call_level == '1ST_CALL'))}
    favored = db.scalar(select(Person).where(Person.canonical_name == 'Safe Member'))
    concentrated_candidates(monkeypatch, favored)
    context = candidate_context(db, '2026-05')
    result = optimizer.solve_month(db, context, slots, seconds=20)
    loads = sorted(Counter(result['choices'].values()).values())
    assert result['uncovered'] == 0
    assert loads == [2, 2, 2, 2]
    assert result['refinement']['transfers'] == 6
    assert result['fairness'][0]['gap'] == 0
    assert optimizer.validate_plan(db, context, slots, result['choices']) == []
    assert not any(o['proven'] for o in result['objectives'] if o['name'] == 'call_level_equality')
    assert all(o['proven'] for o in result['objectives'][:2])
    assert db.query(DutyAssignment).count() == 0
    record_property('before_loads', '8,0,0,0')
    record_property('after_loads', ','.join(map(str, loads)))


@pytest.mark.parametrize('block', ['leave', 'rest', 'wrong_level'])
def test_refinement_uses_full_validator_even_for_forged_candidate(block, compute_db):
    db, _ = compute_db
    db.query(LeaveRequest).delete()
    source = db.scalar(select(DutySlot).where(DutySlot.call_level == '1ST_CALL'))
    donor = db.scalar(select(Person).where(Person.canonical_name == 'Safe Member'))
    recipient = db.scalar(select(Person).where(Person.canonical_name == 'Spare One'))
    slots = {str(s.id): s for s in [source, *[
        create_slot(db, source.unit, date(2026, 5, day)) for day in (8, 14, 20)]]}
    if block == 'leave':
        db.add(LeaveRequest(person=recipient, leave_type='ANNUAL_LEAVE', leave_slot='FULL_DAY',
                            starts_on=date(2026, 5, 1), ends_on=date(2026, 5, 31), status='approved'))
    elif block == 'rest':
        for day in (1,):
            db.add(DutyAssignment(duty_slot=create_slot(db, source.unit, date(2026, 5, day)),
                                  person=recipient, status='assigned'))
    else:
        recipient.call_level = '2ND_CALL'
        for posting in recipient.postings:
            posting.posting_type = '2ND_CALL'
    db.commit()
    context = candidate_context(db, '2026-05')
    choices = {sid: str(donor.id) for sid in slots}
    candidates = {sid: {str(donor.id): {}} for sid in slots}
    candidates[str(source.id)][str(recipient.id)] = {}
    result, evidence = refine_incumbent(
        choices, candidates, slots, context,
        quality=lambda c: [sum(p == str(donor.id) for p in c.values())],
        validate=lambda c: optimizer.validate_plan(db, context, slots, c),
        incompatible=optimizer.incompatible, deadline=perf_counter()+5)
    assert result == choices
    assert evidence['improved'] is False
    assert evidence['checks'] >= 1


def test_hole_repair_preserves_every_other_duty_and_rejects_unsafe_trials(compute_db):
    db, _ = compute_db
    db.query(LeaveRequest).delete()
    source = db.scalar(select(DutySlot).where(DutySlot.call_level == '1ST_CALL'))
    other = create_slot(db, source.unit, date(2026, 5, 3))
    db.commit()
    context = candidate_context(db, '2026-05')
    people = [str(p.id) for p in context.people.values()]
    a, b = people[:2]
    slots = {str(source.id): source, str(other.id): other}
    choices = {str(source.id): a}
    candidates = {str(source.id): {a: {}, b: {}}, str(other.id): {a: {}}}
    result, evidence = refine_incumbent(
        choices, candidates, slots, context, quality=lambda c: [-len(c)],
        validate=lambda c: optimizer.validate_plan(db, context, slots, c),
        incompatible=optimizer.incompatible, deadline=perf_counter()+5)
    assert result == {str(source.id): b, str(other.id): a}
    assert evidence['additional_covered'] == 1
    assert optimizer.validate_plan(db, context, slots, result) == []
    assert db.query(DutyAssignment).count() == 0


def test_expired_refinement_does_no_search_and_summary_includes_zero_members(compute_db):
    db, _ = compute_db
    context = candidate_context(db, '2026-05')
    people = list(context.people)
    context.fairness_member_levels = {p: '1ST_CALL' for p in people}
    choices = {'a': str(people[0]), 'b': str(people[0]), 'c': str(people[0])}
    result, evidence = refine_incumbent(choices, {}, {}, context, quality=lambda c: [-len(c)],
        validate=lambda c: pytest.fail('expired search validated a trial'),
        incompatible=optimizer.incompatible, deadline=perf_counter()-1)
    assert result == choices and evidence['checks'] == 0
    row = fairness_summary(context, choices)[0]
    assert row['minimum'] == 0 and row['gap'] == 3 and row['within_two'] is False


@pytest.mark.parametrize('minimum', ['minimum_coverage', 'minimum_required'])
def test_refinement_does_not_replace_an_infeasible_requested_minimum_with_partial_plan(environment, minimum):
    from tests.test_ot_assignment_integration import slot
    db, unit, _people, first = environment
    second = slot(db, unit, first.duty_date)
    context = candidate_context(db, '2026-11')
    slots = {str(s.id): s for s in (first, second)}
    result = optimizer.solve_month(db, context, slots, seconds=5, **{minimum: 2})
    assert result['status'] == 'infeasible'
    assert result['choices'] == {}
    assert result['refinement']['additional_covered'] == 0
    assert db.query(DutyAssignment).count() == 0


def test_local_hole_repair_cannot_bypass_monthly_quota(compute_db):
    db, _ = compute_db
    source = db.scalar(select(DutySlot).where(DutySlot.call_level == '1ST_CALL'))
    context = candidate_context(db, '2026-05')
    context.rules.duty_count_limits.max_24hr_per_month = 0
    person = str(db.scalar(select(Person).where(Person.canonical_name == 'Safe Member')).id)
    slots = {str(source.id): source}
    result, evidence = refine_incumbent({}, {str(source.id): {person: {}}}, slots, context,
        quality=lambda c: [-len(c)], validate=lambda c: optimizer.validate_plan(db, context, slots, c),
        incompatible=optimizer.incompatible, deadline=perf_counter()+5)
    assert result == {} and evidence['checks'] == 1


def test_local_hole_repair_cannot_consume_joint_ot_reservation(environment):
    from tests.test_ot_assignment_integration import slot
    db, unit, people, first = environment
    second = slot(db, unit, first.duty_date)
    context = candidate_context(db, '2026-11')
    a, b = map(lambda p: str(p.id), people[:2])
    slots = {str(s.id): s for s in (first, second)}
    choices = {str(first.id): a}
    assert optimizer.validate_plan(db, context, slots, choices) == []
    result, evidence = refine_incumbent(choices,
        {str(first.id): {a: {}}, str(second.id): {b: {}}}, slots, context,
        quality=lambda c: [-len(c)], validate=lambda c: optimizer.validate_plan(db, context, slots, c),
        incompatible=optimizer.incompatible, deadline=perf_counter()+5)
    assert result == choices and evidence['checks'] == 1
    assert optimizer.validate_plan(db, context, slots, result) == []
    assert db.query(DutyAssignment).count() == 0


def test_local_refinement_keeps_distinct_alternative_contract(compute_db):
    db, _ = compute_db
    source = db.scalar(select(DutySlot).where(DutySlot.call_level == '1ST_CALL'))
    context = candidate_context(db, '2026-05')
    people = [str(p.id) for p in db.scalars(select(Person).where(Person.canonical_name.in_(['Safe Member', 'Spare One'])))]
    a, b = sorted(people)
    sid = str(source.id)
    slots = {sid: source}
    result, _ = refine_incumbent({}, {sid: {a: {}, b: {}}}, slots, context,
        quality=lambda c: [-len(c)], validate=lambda c: optimizer.validate_plan(db, context, slots, c),
        incompatible=optimizer.incompatible, deadline=perf_counter()+5, forbidden=[{sid: a}])
    assert result == {sid: b}
    assert optimizer.validate_plan(db, context, slots, result) == []


@pytest.mark.parametrize('policy', ['availability', 'equal_counts'])
def test_promotion_candidate_target_matches_monthly_optimizer_basis_without_relaxing_eligibility(compute_db, policy):
    from tests.test_balance_duties import edit_rules
    db, _ = compute_db
    edit_rules(db, lambda rules: setattr(rules.fairness_rules, 'allocation_mode', policy))
    db.query(LeaveRequest).delete()
    source = db.scalar(select(DutySlot).where(DutySlot.call_level == '1ST_CALL'))
    promoted = db.scalar(select(Person).where(Person.canonical_name == 'Safe Member'))
    unit = source.unit
    colleague = Person(canonical_name='Stable second call', call_level='2ND_CALL')
    db.add_all([colleague,
        MemberCallLevelChange(person=promoted, call_level='2ND_CALL', effective_from=date(2026, 5, 16)),
        PersonPosting(person=colleague, unit=unit, posting_type='2ND_CALL', starts_on=date(2026, 5, 1), source='unit_board')])
    after = create_slot(db, unit, date(2026, 5, 20), call_level='2ND_CALL', duty_type='MAIN_2ND_24HR')
    db.commit()
    context = candidate_context(db, '2026-05')
    row = slot_candidates_with_context(db, slot=after, context=context)
    candidate = next(c for c in row['candidates'] if c['person_id'] == str(promoted.id))
    assert candidate['call_level'] == '2ND_CALL'
    assert candidate['fairness_call_level'] == '1ST_CALL'
    assert context.fairness_member_levels[promoted.id] == '1ST_CALL'
    if policy == 'equal_counts':
        assert context.fairness_targets['1ST_CALL'] != context.fairness_targets['2ND_CALL']
    else:
        assert context.fairness_targets['1ST_CALL'] == context.fairness_targets['2ND_CALL'] == 0
    assert candidate['call_level_target'] == round(context.fairness_targets['1ST_CALL'], 2)
    assert candidate['validation_status'] == 'clear'
    before = slot_candidates_with_context(db, slot=source, context=context)
    assert next(c for c in before['candidates'] if c['person_id'] == str(promoted.id))['call_level'] == '1ST_CALL'
    assert db.query(DutyAssignment).count() == 0
