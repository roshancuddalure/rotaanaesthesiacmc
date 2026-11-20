"""Final-plan reservation checks: temporal safety, proof reuse and scope honesty."""

from dataclasses import FrozenInstanceError, replace
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.services.ot_assignment_guard import OtAssignmentGuard
from app.services.ot_calendar import OtRequirement
from app.services.ot_capacity import CapacityPerson, CapacityReserve, CapacityResourceLimit, TimeInterval
from app.services.rota_rules import RotaPhaseOneRules

UNIT = UUID(int=17)
DAY = datetime(2026, 12, 1)


def roster(count=2):
    return tuple(CapacityPerson(id=UUID(int=i + 1), unit_ids=(UNIT,), call_level="3RD_CALL",
        available=(TimeInterval(starts_at=DAY, ends_at=DAY + timedelta(days=6)),)) for i in range(count))


def need(**changes):
    values = dict(id="ot", unit_id=UNIT, area_key="theatre", band_key="senior",
                  starts_at=DAY + timedelta(hours=8), ends_at=DAY + timedelta(hours=16),
                  call_levels=("3RD_CALL",), minimum=1, target=2)
    values.update(changes)
    return OtRequirement(**values)


def duty(person, *, start=DAY + timedelta(hours=9), hours=2, is_24hr=False, status="assigned"):
    slot = SimpleNamespace(starts_at=start, ends_at=start + timedelta(hours=hours),
                           duty_date=start.date(), duty_type="TEST", is_24hr=is_24hr)
    return SimpleNamespace(person_id=person.id, duty_slot=slot, status=status)


def guard(count=2, **changes):
    return OtAssignmentGuard((need(),), roster(count), reviewed_complete=True, **changes)


def test_unknown_or_partial_demand_cannot_be_certified_as_reviewed_zero():
    rules = RotaPhaseOneRules(duty_rules=[])
    assert OtAssignmentGuard((), ()).check((), rules)["status"] == "not_evaluated"
    assert OtAssignmentGuard((), (), reviewed_complete=True).check((), rules)["status"] == "feasible"
    assert guard(unresolved=("Missing Thursday theatre demand",)).check((), rules)["status"] == "not_evaluated"


def test_complete_final_set_protects_ot_without_optional_target_becoming_mandatory():
    context, rules = guard(), RotaPhaseOneRules(duty_rules=[])
    assert context.check((duty(context.people[0]),), rules)["status"] == "feasible"
    assert context.check(tuple(duty(person) for person in context.people), rules)["status"] == "infeasible"
    assert not any(person.blocked for person in context.people)


def test_month_end_duty_and_long_rest_protect_future_ot_until_exact_boundary():
    rules = RotaPhaseOneRules(duty_rules=[])
    rules.rest_rules.minimum_gap_after_24hr_hours = 72
    person = roster(1)[0]
    previous = duty(person, start=datetime(2026, 11, 30, 8), hours=24, is_24hr=True)
    guard_before = OtAssignmentGuard((need(starts_at=datetime(2026, 12, 4, 7),
        ends_at=datetime(2026, 12, 4, 9)),), (person,), reviewed_complete=True)
    assert guard_before.check((previous,), rules)["status"] == "infeasible"
    guard_after = OtAssignmentGuard((need(starts_at=datetime(2026, 12, 4, 8),
        ends_at=datetime(2026, 12, 4, 10)),), (person,), reviewed_complete=True)
    assert guard_after.check((previous,), rules)["status"] == "feasible"


def test_removed_and_cancelled_duties_are_not_retained_in_the_proposed_final_state():
    context, rules = guard(1), RotaPhaseOneRules(duty_rules=[])
    assert context.check((duty(context.people[0]),), rules)["status"] == "infeasible"
    assert context.check((), rules)["status"] == "feasible"
    assert context.check((duty(context.people[0], status="cancelled"),), rules)["status"] == "feasible"


def test_witness_is_independently_rechecked_and_reused_without_another_solve(monkeypatch):
    context, rules = guard(), RotaPhaseOneRules(duty_rules=[])
    first = context.check((), rules)
    used = first["capacity"]["requirements"][0]["matched_person_ids"][0]
    unused = next(person for person in context.people if str(person.id) != used)
    def no_solve(*args, **kwargs):
        pytest.fail("An intact reservation witness must not start another CP solve")
    monkeypatch.setattr("app.services.ot_assignment_guard.evaluate_capacity", no_solve)
    second = context.check((duty(unused),), rules)
    assert second["status"] == "feasible" and second["proof_source"] == "rechecked_witness"
    assert second["capacity"]["requirements"][0]["eligible_person_ids"] == [used]
    assert second["capacity"]["solver_status"] == "WITNESS_RECHECKED"
    # Mutating any returned object must not poison the private cache.
    second["capacity"]["requirements"][0]["matched_person_ids"].clear()
    third = context.check((duty(unused),), rules)
    assert third["proof_source"] == "exact_cache"
    assert third["capacity"]["requirements"][0]["matched_person_ids"] == [used]


def test_stale_witness_is_replaced_with_a_fresh_feasible_reservation():
    context, rules = guard(), RotaPhaseOneRules(duty_rules=[])
    first = context.check((), rules)
    chosen = first["capacity"]["requirements"][0]["matched_person_ids"][0]
    selected = next(person for person in context.people if str(person.id) == chosen)
    second = context.check((duty(selected),), rules)
    assert second["status"] == "feasible" and second["proof_source"] == "solver"
    assert chosen not in second["capacity"]["requirements"][0]["matched_person_ids"]


def test_additional_reserve_and_preserved_duty_are_checked_together():
    requirement = need()
    reserve = CapacityReserve(id="reserve", unit_id=UNIT, starts_at=requirement.starts_at,
        ends_at=requirement.ends_at, call_levels=("3RD_CALL",), minimum=1, mode="additional")
    context = OtAssignmentGuard((requirement,), roster(), reserves=(reserve,), reviewed_complete=True)
    rules = RotaPhaseOneRules(duty_rules=[])
    assert context.check((), rules)["status"] == "feasible"
    assert context.check((duty(context.people[0]),), rules)["status"] == "infeasible"


def test_resource_limit_is_unresolved_and_never_cached_as_staffing_infeasibility(monkeypatch):
    context, rules = guard(), RotaPhaseOneRules(duty_rules=[])
    def limit(*args, **kwargs):
        raise CapacityResourceLimit("test bound")
    monkeypatch.setattr("app.services.ot_assignment_guard.evaluate_capacity", limit)
    result = context.check((), rules)
    assert result["status"] == "not_evaluated" and result["code"] == "ot_capacity_unresolved"
    assert not context._proofs


def test_snapshot_is_frozen_replace_preserves_inputs_and_cache_is_bounded():
    context, rules = guard(cache_limit=2), RotaPhaseOneRules(duty_rules=[])
    with pytest.raises(FrozenInstanceError):
        context.people = ()
    assert replace(context).people == context.people
    for hour in (9, 10, 11):
        context.check((duty(context.people[0], start=DAY + timedelta(hours=hour)),), rules)
    assert len(context._proofs) == 2
    # A new snapshot must not inherit answers to different requirements.
    changed = replace(context, requirements=(need(minimum=2, target=2),))
    assert not changed._proofs
    assert changed.check((duty(changed.people[0]),), rules)["status"] == "infeasible"


def test_leave_and_new_duty_overlap_never_mutate_or_double_subtract_people():
    people = roster()
    absent = people[0].model_copy(update={"blocked": (TimeInterval(starts_at=DAY, ends_at=DAY + timedelta(days=1)),)})
    context = OtAssignmentGuard((need(),), (absent, people[1]), reviewed_complete=True)
    result = context.check((duty(absent),), RotaPhaseOneRules(duty_rules=[]))
    assert result["status"] == "feasible"
    assert result["capacity"]["requirements"][0]["matched_person_ids"] == [str(people[1].id)]
