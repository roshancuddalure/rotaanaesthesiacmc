"""Affected proofs must retain whole-role competitors and isolate unrelated deficits."""

from datetime import datetime, timedelta
import random
from types import SimpleNamespace
from uuid import UUID

from app.services.ot_assignment_guard import OtAssignmentGuard
from app.services.ot_calendar import OtRequirement
from app.services.ot_capacity import CapacityPerson, CapacityReserve, TimeInterval
from app.services.rota_rules import RotaPhaseOneRules

DAY = datetime(2026, 11, 19)
UNIT, OTHER = UUID(int=1), UUID(int=2)
RULES = RotaPhaseOneRules(duty_rules=[])


def need(key, unit=UNIT, start=8, end=16, minimum=1):
    return OtRequirement(id=key, unit_id=unit, area_key="main", band_key="senior",
        starts_at=DAY + timedelta(hours=start), ends_at=DAY + timedelta(hours=end),
        call_levels=("3RD_CALL",), minimum=minimum, target=minimum)


def person(key, units=(UNIT,), start=0, end=48):
    return CapacityPerson(id=UUID(int=key), unit_ids=units, call_level="3RD_CALL",
        available=(TimeInterval(starts_at=DAY + timedelta(hours=start), ends_at=DAY + timedelta(hours=end)),))


def effect(member, start=9, end=10):
    slot = SimpleNamespace(duty_date=(DAY + timedelta(hours=start)).date(),
        starts_at=DAY + timedelta(hours=start), ends_at=DAY + timedelta(hours=end),
        duty_type="TEST", is_24hr=False)
    return SimpleNamespace(person_id=member.id, status="assigned", duty_slot=slot)


def test_unrelated_unit_shortage_is_not_a_veto_but_whole_plan_still_reports_it():
    members = person(10), person(11)
    guard = OtAssignmentGuard((need("safe"), need("short", OTHER)), members, reviewed_complete=True)
    change = effect(members[0])
    assert guard.check((change,), RULES)["status"] == "infeasible"
    scoped = guard.check_affected((change,), (change,), RULES)
    assert scoped["status"] == "feasible" and scoped["components_checked"] == 1


def test_shared_identity_connects_simultaneous_units_so_scoping_cannot_hide_shortage():
    members = person(10, (UNIT, OTHER)), person(11, (UNIT, OTHER))
    guard = OtAssignmentGuard((need("one"), need("two", OTHER)), members, reviewed_complete=True)
    change = effect(members[0])
    assert guard.check_affected((change,), (change,), RULES)["status"] == "infeasible"


def test_transitive_whole_band_competition_extends_beyond_changed_interval():
    # Blocking 09:00 removes a person from the entire first band. Its replacement
    # would consume the second band, whose replacement would consume the third.
    members = person(10, start=8, end=12), person(11, start=8, end=15), person(12, start=11, end=18)
    guard = OtAssignmentGuard((need("early", start=8, end=12), need("middle", start=11, end=15),
        need("late", start=14, end=18)), members, reviewed_complete=True)
    change = effect(members[0], start=9, end=10)
    assert guard.check((), RULES)["status"] == "feasible"
    assert guard.check_affected((change,), (change,), RULES)["status"] == "infeasible"


def test_disjoint_time_shortage_does_not_block_a_safe_same_unit_edit():
    members = person(10), person(11)
    guard = OtAssignmentGuard((need("today"), need("tomorrow", start=32, end=40, minimum=3)),
                              members, reviewed_complete=True)
    change = effect(members[0])
    assert guard.check_affected((change,), (change,), RULES)["status"] == "feasible"


def test_reserve_partial_handover_people_are_not_lost_by_whole_band_scoping():
    morning, afternoon = person(10, start=8, end=12), person(11, start=12, end=16)
    reserve = CapacityReserve(id="reserve", unit_id=UNIT, starts_at=DAY + timedelta(hours=8),
        ends_at=DAY + timedelta(hours=16), call_levels=("3RD_CALL",), minimum=1, mode="included")
    guard = OtAssignmentGuard((), (morning, afternoon), reserves=(reserve,), reviewed_complete=True)
    change = effect(morning)
    assert guard.check((), RULES)["status"] == "feasible"
    assert guard.check_affected((change,), (change,), RULES)["status"] == "infeasible"


def test_unreviewed_context_cannot_be_scoped_away_with_empty_eligibility():
    guard = OtAssignmentGuard((), (), unresolved=("Missing OT Wednesday",))
    change = effect(person(10))
    assert guard.check_affected((change,), (change,), RULES)["status"] == "not_evaluated"


def test_scoped_safety_matches_whole_schedule_after_changes_to_feasible_generated_cases():
    rng = random.Random(1714)
    checked = 0
    for _ in range(40):
        members = tuple(person(10 + index, units=rng.choice(((UNIT,), (OTHER,), (UNIT, OTHER))))
                        for index in range(4))
        needs = tuple(need(str(index), unit=rng.choice((UNIT, OTHER)),
                           start=start, end=start + rng.choice((2, 4, 6)))
                      for index, start in enumerate(rng.sample((8, 10, 12, 14, 16), 3)))
        guard = OtAssignmentGuard(needs, members, reviewed_complete=True)
        if guard.check((), RULES)["status"] != "feasible":
            continue
        change = effect(rng.choice(members), start=9, end=11)
        whole = guard.check((change,), RULES)
        scoped = guard.check_affected((change,), (change,), RULES)
        assert scoped["status"] == whole["status"]
        checked += 1
    assert checked >= 15
