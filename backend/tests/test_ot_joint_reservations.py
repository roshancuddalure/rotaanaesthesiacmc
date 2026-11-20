"""Joint reservation constraints agree with independent final-set checks."""

from dataclasses import replace
from datetime import timedelta
from itertools import product
from uuid import UUID

from ortools.sat.python import cp_model
import pytest

from app.services.ot_assignment_guard import OtAssignmentGuard
from app.services.ot_capacity import CapacityReserve, CapacityResourceLimit
from app.services.ot_joint_reservations import add_joint_reservations
from app.services.rota_rules import RotaPhaseOneRules
from tests.test_ot_assignment_guard import DAY, UNIT, duty, guard, need, roster


def solve(context, proposed, *, fixed=(), rules=None):
    model = cp_model.CpModel()
    slots = {str(i): row.duty_slot for i, row in enumerate(proposed)}
    choices = {(str(i), row.person_id): model.new_bool_var(f"duty_{i}") for i, row in enumerate(proposed)}
    for variable in choices.values():
        model.add(variable == 1)
    stats = add_joint_reservations(model, context, fixed, slots, choices,
                                   rules or RotaPhaseOneRules(duty_rules=[]))
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    return solver.solve(model), stats


def test_two_individually_safe_duties_cannot_consume_the_same_ot_reserve():
    context = guard(2)
    proposed = tuple(duty(person) for person in context.people)
    assert solve(context, proposed[:1])[0] == cp_model.OPTIMAL
    result, stats = solve(context, proposed)
    assert result == cp_model.INFEASIBLE and stats["couplings"] == 2
    assert not any(person.blocked for person in context.people)


@pytest.mark.parametrize("mode, expected", [("included", cp_model.OPTIMAL), ("additional", cp_model.INFEASIBLE)])
def test_joint_duty_cannot_share_included_or_additional_reserve_staff(mode, expected):
    reserve = CapacityReserve(id="reserve", unit_id=UNIT, starts_at=DAY + timedelta(hours=8),
        ends_at=DAY + timedelta(hours=16), call_levels=("3RD_CALL",), minimum=1, mode=mode)
    context = guard(2, reserves=(reserve,))
    assert solve(context, (duty(context.people[0]),))[0] == expected


def test_reserve_can_handover_at_planned_duty_boundary_but_ot_band_cannot():
    people = roster(2)
    reserve = CapacityReserve(id="reserve", unit_id=UNIT, starts_at=DAY + timedelta(hours=8),
        ends_at=DAY + timedelta(hours=16), call_levels=("3RD_CALL",), minimum=1, mode="included")
    proposed = (duty(people[0], start=DAY + timedelta(hours=8), hours=4),
                duty(people[1], start=DAY + timedelta(hours=12), hours=4))
    context = OtAssignmentGuard((), people, reserves=(reserve,), reviewed_complete=True)
    status, stats = solve(context, proposed)
    assert status == cp_model.OPTIMAL and stats["reserve_segments"] == 2
    assert context.check(proposed, RotaPhaseOneRules(duty_rules=[]))["status"] == "feasible"
    assert solve(guard(2), proposed)[0] == cp_model.INFEASIBLE


def test_fixed_duties_and_unrelated_existing_deficits_are_handled_consistently():
    context = guard(2)
    assert solve(context, (duty(context.people[0]),), fixed=(duty(context.people[1]),))[0] == cp_model.INFEASIBLE
    unrelated = need(id="unrelated", unit_id=UUID(int=99))
    context = replace(context, requirements=(*context.requirements, unrelated))
    assert solve(context, (duty(context.people[0]),))[0] == cp_model.OPTIMAL


def test_missing_context_and_out_of_horizon_proposal_never_become_zero_demand():
    context = guard(1)
    with pytest.raises(CapacityResourceLimit, match="reviewed"):
        solve(replace(context, reviewed_complete=False), (duty(context.people[0]),))
    context = replace(context, horizon_start=DAY, horizon_end=DAY + timedelta(days=1))
    with pytest.raises(CapacityResourceLimit, match="horizon"):
        solve(context, (duty(context.people[0], start=DAY + timedelta(days=2)),))


def test_joint_reservations_include_full_post_duty_rest_at_exact_boundary():
    rules = RotaPhaseOneRules(duty_rules=[])
    rules.rest_rules.minimum_gap_after_24hr_hours = 72
    person = roster(1)[0]
    proposed = (duty(person, start=DAY + timedelta(hours=8), hours=24, is_24hr=True),)
    before = OtAssignmentGuard((need(starts_at=DAY + timedelta(days=4, hours=7),
        ends_at=DAY + timedelta(days=4, hours=9)),), (person,), reviewed_complete=True)
    after = OtAssignmentGuard((need(starts_at=DAY + timedelta(days=4, hours=8),
        ends_at=DAY + timedelta(days=4, hours=10)),), (person,), reviewed_complete=True)
    assert solve(before, proposed, rules=rules)[0] == cp_model.INFEASIBLE
    assert solve(after, proposed, rules=rules)[0] == cp_model.OPTIMAL


def test_joint_model_matches_independent_guard_over_generated_final_sets():
    rules = RotaPhaseOneRules(duty_rules=[])
    for minimum, count in product((1, 2), (2, 3)):
        context = OtAssignmentGuard((need(minimum=minimum, target=minimum),
            need(id="tomorrow", starts_at=DAY + timedelta(days=1, hours=8),
                 ends_at=DAY + timedelta(days=1, hours=16), minimum=minimum, target=minimum)),
            roster(count), reviewed_complete=True)
        for first, second in product(context.people, repeat=2):
            # The existing planner supplies duty/duty incompatibility. Here the
            # duties are on separate dates, so one person may legitimately do both.
            proposed = (duty(first), duty(second, start=DAY + timedelta(days=1, hours=9)))
            actual, _stats = solve(context, proposed)
            expected = context.check_affected(proposed, proposed, rules)["status"]
            assert (actual == cp_model.OPTIMAL) == (expected == "feasible")
