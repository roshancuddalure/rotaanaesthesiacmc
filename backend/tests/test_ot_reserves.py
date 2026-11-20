"""Joint reserve/OT feasibility: interval identity counts, not independent subtraction."""

from datetime import timedelta
from itertools import product
import random

import pytest

from app.services.ot_capacity import CapacityReserve, evaluate_capacity
from app.services.ot_capacity_verify import verify_witness
from tests.test_ot_capacity import MIDNIGHT, OTHER, UNIT, interval, person, requirement


def reserve(index=1, **changes):
    return CapacityReserve(**{
        "id": f"reserve-{index}", "unit_id": UNIT,
        "starts_at": MIDNIGHT + timedelta(hours=8), "ends_at": MIDNIGHT + timedelta(hours=16),
        "call_levels": ("3RD_CALL",), "minimum": 1, "mode": "included", **changes,
    })


def test_included_reserve_can_share_same_unit_ot_but_additional_cannot():
    needs, roster = (requirement(),), (person(),)
    assert evaluate_capacity(needs, roster, reserves=(reserve(),))["status"] == "feasible"
    result = evaluate_capacity(needs, roster, reserves=(reserve(mode="additional"),))
    assert result["status"] == "infeasible"
    assert evaluate_capacity(needs, (person(1), person(2)), reserves=(reserve(mode="additional"),))["status"] == "feasible"


def test_reserve_larger_than_ot_coverage_is_not_lost_in_included_mode():
    result = evaluate_capacity((requirement(),), (person(),), reserves=(reserve(minimum=2),))
    assert result["status"] == "infeasible"
    assert result["reserves"][0]["minimum_shortage"] == 1


def test_overlapping_same_unit_pool_minima_are_not_blindly_added():
    third, fourth = person(1), person(2, call_level="4TH_CALL")
    reserves = (reserve(1, call_levels=("3RD_CALL", "4TH_CALL"), minimum=2), reserve(2))
    result = evaluate_capacity((), (third, fourth), reserves=reserves)
    assert result["status"] == "feasible"
    assert not verify_witness((), (third, fourth), reserves, result)


def test_shared_identity_cannot_be_reserve_in_two_units_or_ot_in_other_unit():
    shared = person(unit_ids=(UNIT, OTHER))
    assert evaluate_capacity((), (shared,), reserves=(reserve(1), reserve(2, unit_id=OTHER)))["status"] == "infeasible"
    assert evaluate_capacity((requirement(unit_id=OTHER),), (shared,), reserves=(reserve(),))["status"] == "infeasible"


def test_reserve_may_handover_at_availability_boundary_without_splitting_ot_role():
    roster = (person(1, available=(interval(8, 12),)), person(2, available=(interval(12, 16),)))
    result = evaluate_capacity((), roster, reserves=(reserve(),))
    assert result["status"] == "feasible"
    assert len(result["reserves"][0]["intervals"]) == 2
    # Neither person covers a full OT band, even though the minimum count can hand over.
    assert evaluate_capacity((requirement(),), roster, reserves=(reserve(),))["status"] == "infeasible"


def test_additional_reserve_staff_can_change_between_nonoverlapping_ot_bands():
    needs = (requirement(1, ends_at=MIDNIGHT + timedelta(hours=12)),
             requirement(2, starts_at=MIDNIGHT + timedelta(hours=12)))
    result = evaluate_capacity(needs, (person(1), person(2)), reserves=(reserve(mode="additional"),))
    assert result["status"] == "feasible"
    assert not verify_witness(needs, (person(1), person(2)), (reserve(mode="additional"),), result)


def test_optional_target_cannot_consume_mandatory_additional_reserve():
    need = requirement(minimum=1, target=2)
    result = evaluate_capacity((need,), (person(1), person(2)), reserves=(reserve(mode="additional"),))
    assert result["status"] == "feasible" and result["target_covered"] == 1


def test_independent_verifier_rejects_forged_sharing_and_missing_intervals():
    need, policy, roster = requirement(), reserve(mode="additional"), (person(1), person(2))
    result = evaluate_capacity((need,), roster, reserves=(policy,))
    result["reserves"][0]["intervals"][0]["matched_person_ids"] = result["requirements"][0]["matched_person_ids"]
    assert any("reused" in error for error in verify_witness((need,), roster, (policy,), result))
    result["reserves"][0]["intervals"] = []
    assert verify_witness((need,), roster, (policy,), result)


@pytest.mark.parametrize("mode", ["included", "additional"])
def test_joint_feasibility_matches_independent_small_exhaustive_oracle(mode):
    rng = random.Random(185)
    for _ in range(20):
        roster = tuple(person(i + 1, call_level=rng.choice(("3RD_CALL", "4TH_CALL"))) for i in range(3))
        needs = (requirement(1), requirement(2, call_levels=("3RD_CALL", "4TH_CALL")))
        policies = (reserve(call_levels=("3RD_CALL", "4TH_CALL"), minimum=2, mode=mode),)
        feasible = False
        for allocation in product((-1, 0, 1, 2), repeat=2):
            if -1 in allocation or len(set(allocation)) != 2:
                continue
            if roster[allocation[0]].call_level != "3RD_CALL":
                continue
            remaining = 3 if mode == "included" else 3 - len(set(allocation))
            if remaining >= 2:
                feasible = True
        result = evaluate_capacity(needs, roster, reserves=policies)
        assert (result["status"] == "feasible") == feasible
        assert not verify_witness(needs, roster, policies, result)


def test_cross_unit_joint_feasibility_matches_exhaustive_identity_booking_oracle():
    rng = random.Random(341)
    for _ in range(35):
        roster = tuple(person(i + 1, unit_ids=rng.choice(((UNIT,), (OTHER,), (UNIT, OTHER))),
                              call_level=rng.choice(("3RD_CALL", "4TH_CALL"))) for i in range(3))
        needs = (requirement(1), requirement(2, unit_id=OTHER, call_levels=("3RD_CALL", "4TH_CALL")))
        policies = (reserve(1, mode=rng.choice(("included", "additional"))),
                    reserve(2, unit_id=OTHER, call_levels=("3RD_CALL", "4TH_CALL"), mode=rng.choice(("included", "additional"))))
        feasible = False
        for assignment in product(range(3), repeat=4):
            demands = (*needs, *policies)
            if any(demand.unit_id not in roster[index].unit_ids or roster[index].call_level not in demand.call_levels
                   for demand, index in zip(demands, assignment)):
                continue
            valid = True
            for a in range(4):
                for b in range(a + 1, 4):
                    if assignment[a] != assignment[b]:
                        continue
                    if demands[a].unit_id != demands[b].unit_id or (a < 2 and b < 2) \
                            or (a < 2 <= b and policies[b - 2].mode == "additional"):
                        valid = False
            feasible |= valid
        computed = evaluate_capacity(needs, roster, reserves=policies)
        assert (computed["status"] == "feasible") == feasible
