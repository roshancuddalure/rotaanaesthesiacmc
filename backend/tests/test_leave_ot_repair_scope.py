"""OT-only scope includes another person's commitment, without automatic repair."""

from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.services.leave_ot_repair_scope import candidate_components
from app.services.ot_assignment_guard import OtAssignmentGuard
from app.services.ot_capacity import TimeInterval
from app.services.rota_rules import RotaPhaseOneRules
from tests.test_ot_assignment_guard import DAY, duty, need, roster


def scenario():
    people = roster(3)
    span = TimeInterval(starts_at=DAY, ends_at=DAY+timedelta(days=1))
    current_people = (people[0].model_copy(update={'blocked': (span,)}), *people[1:])
    before = OtAssignmentGuard((need(minimum=2),), people, reviewed_complete=True)
    current = replace(before, people=current_people)
    assignment = duty(people[1])
    assignment.id = UUID(int=99)
    leave = SimpleNamespace(person_id=people[0].id, starts_on=DAY.date(), ends_on=DAY.date(), leave_slot='FULL_DAY')
    return current, before, [assignment], [leave], RotaPhaseOneRules(duty_rules=[])


def test_ot_only_candidate_is_other_person_and_removal_restores_joint_feasibility():
    current, before, assignments, leaves, rules = scenario()
    assert before.check(assignments, rules)['status'] == 'feasible'
    assert current.check(assignments, rules)['status'] == 'infeasible'
    result = candidate_components(current, before, assignments, leaves, rules)
    assert result['status'] == 'evaluated'
    assert result['assignment_ids'] == [str(assignments[0].id)]
    assert assignments[0].person_id != leaves[0].person_id
    assert result['components'][0]['mandatory_required'] == 2
    assert result['components'][0]['mandatory_covered'] == 1
    assert current.check((), rules)['status'] == 'feasible'
    assert assignments[0].status == 'assigned'


def test_unrelated_deficit_is_not_used_to_broaden_repair_scope():
    current, before, assignments, leaves, rules = scenario()
    unrelated = need(id='later', starts_at=DAY+timedelta(days=3,hours=8),
                     ends_at=DAY+timedelta(days=3,hours=16), minimum=4, target=4)
    current = replace(current, requirements=(need(minimum=1), unrelated))
    before = replace(before, requirements=current.requirements)
    assert current.check(assignments, rules)['status'] == 'infeasible'
    result = candidate_components(current, before, assignments, leaves, rules)
    assert result['status'] == 'evaluated' and result['assignment_ids'] == []


@pytest.mark.parametrize('change', ['unknown', 'incomplete', 'different_demands', 'too_many_assignments'])
def test_unknown_or_excessive_work_does_not_authorize_partial_candidates(change):
    current, before, assignments, leaves, rules = scenario()
    if change == 'unknown':
        current = replace(current, unresolved=('Missing calendar',))
    elif change == 'incomplete':
        before = replace(before, reviewed_complete=False)
    elif change == 'different_demands':
        before = replace(before, requirements=(need(id='different'),))
    else:
        assignments *= 5001
    result = candidate_components(current, before, assignments, leaves, rules)
    assert result['status'] == 'not_evaluated'
    assert result['assignment_ids'] == [] and result['components'] == []


def test_cancelled_and_temporally_unrelated_duties_are_not_candidates():
    current, before, assignments, leaves, rules = scenario()
    cancelled = duty(current.people[2], status='cancelled')
    cancelled.id = UUID(int=100)
    later = duty(current.people[2], start=DAY+timedelta(days=2,hours=9))
    later.id = UUID(int=101)
    result = candidate_components(current, before, [*assignments,cancelled,later], leaves, rules)
    assert result['assignment_ids'] == [str(assignments[0].id)]


def test_previous_day_rest_consuming_another_person_is_a_candidate():
    current, before, _, leaves, rules = scenario()
    assignment = duty(current.people[1], start=DAY-timedelta(hours=16), hours=24, is_24hr=True)
    assignment.id = UUID(int=99)
    assert candidate_components(current,before,[assignment],leaves,rules)['assignment_ids'] == [str(assignment.id)]


def test_transitive_shared_person_component_includes_competing_other_unit():
    current,before,assignments,leaves,rules=scenario()
    other_unit=UUID(int=18)
    people=tuple(person.model_copy(update={'unit_ids':(*person.unit_ids,other_unit)}) for person in before.people)
    requirements=(need(minimum=1),need(id='other-unit',unit_id=other_unit,minimum=2))
    before=replace(before,requirements=requirements,people=people)
    current=replace(current,requirements=requirements,people=(
        people[0].model_copy(update={'blocked':current.people[0].blocked}),*people[1:]))
    result=candidate_components(current,before,assignments,leaves,rules)
    assert result['status']=='evaluated'
    assert result['components'][0]['requirement_ids']==['ot','other-unit']
    assert result['assignment_ids']==[str(assignments[0].id)]


def test_solver_unknown_never_leaks_partial_candidates(monkeypatch):
    current,before,assignments,leaves,rules=scenario()
    monkeypatch.setattr(OtAssignmentGuard,'check',lambda *args,**kwargs:{'status':'not_evaluated'})
    result=candidate_components(current,before,assignments,leaves,rules)
    assert result['status']=='not_evaluated' and not result['assignment_ids']


def test_oversized_candidate_result_is_unknown_instead_of_a_truncated_scope():
    current,before,assignments,leaves,rules=scenario()
    duties=[SimpleNamespace(**{**vars(assignments[0]),'id':UUID(int=index+100)}) for index in range(2001)]
    result=candidate_components(current,before,duties,leaves,rules)
    assert result['status']=='not_evaluated' and result['assignment_ids']==[]
    assert '2000 candidate' in result['reasons'][0]
