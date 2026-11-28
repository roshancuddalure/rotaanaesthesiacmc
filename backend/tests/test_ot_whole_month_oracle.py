"""Thirty-day real optimizer against an independent finite-state staffing oracle.

Fixture-specific oracle: four interchangeable seniors, one daily 24h duty,
24h subsequent rest, daily OT needing three identities. It intentionally does
not call canonical availability, duty windows, matching, or objective helpers.
"""

from collections import Counter
from datetime import date
from itertools import permutations
from uuid import UUID

import pytest

from app.models import DutyAssignment, LeaveRequest
from app.services.rota_candidates import candidate_context
from app.services.rota_optimizer import solve_month, validate_plan
from app.services.rota_setup import monthly_setup
from tests.test_ot_assignment_integration import environment as environment, slot  # noqa: F401


def independent_optima(leave, prior, *, duty_people=None, ot_people=None, ot_roles=None,
                       return_vectors=False):
    # State retains every count vector at each last-duty identity, rather than
    # assuming a greedy alternating template attains the monthly best.
    states = {(prior, (0, 0, 0, 0))}
    # Check Dec1 as well: Nov30 duty/rest may consume a uniquely qualified role.
    for day in range(1, 32):
        next_states = set()
        matching = {}
        for previous, counts in states:
            for current in ((None,) if day == 31 else (None, 0, 1, 2, 3)):
                allowed = duty_people.get(day, set(range(4))) if duty_people else set(range(4))
                if current is not None and (current == previous or current in leave.get(day, set()) or current not in allowed):
                    continue
                # Each 08:00-08:00 duty overlaps the next date's full-day leave.
                # Enumerate this approved physical constraint independently of
                # the application's leave helper and candidate filter.
                if current is not None and current in leave.get(day+1, set()):
                    continue
                blocked = {p for p in (previous, current) if p is not None} | leave.get(day, set())
                pool = ot_people.get(day, set(range(4))) if ot_people else set(range(4))
                if len(pool - blocked) < 3:
                    continue
                if ot_roles:
                    available = frozenset(pool - blocked)
                    if available not in matching:
                        roles = ot_roles[day]
                        matching[available] = any(all(person in role for person, role in zip(assignment, roles))
                            for assignment in permutations(available, len(roles)))
                    if not matching[available]:
                        continue
                updated = tuple(n + (p == current) for p, n in enumerate(counts))
                next_states.add((current, updated))
        states = next_states
    coverage = max(sum(counts) for _, counts in states)
    square_load = min(sum(n*n for n in counts) for _, counts in states if sum(counts) == coverage)
    if return_vectors:
        return coverage, square_load, {counts for _, counts in states if sum(counts) == coverage}
    return coverage, square_load


@pytest.mark.parametrize("boundary_leave,reverse", [(False, False), (True, False), (True, True)])
@pytest.mark.parametrize('policy', ['availability', 'equal_counts'])
def test_real_month_optimizer_matches_independent_coverage_and_fairness(environment, boundary_leave, reverse, policy, record_property):
    db, unit, people, existing_slot = environment
    assert existing_slot.duty_date == date(2026, 11, 19)
    rows = [existing_slot if day == 19 else slot(db, unit, date(2026, 11, day)) for day in range(1, 31)]
    prior, leave = None, {}
    preserved = None
    if boundary_leave:
        before = slot(db, unit, date(2026, 10, 31))
        # The shared helper defaults every slot to November. This saved duty
        # belongs to October even though its rest crosses the month boundary.
        before.rota_period = monthly_setup(db, "2026-10")[0]
        preserved = DutyAssignment(person=people[0], duty_slot=before, status="assigned")
        db.add(preserved)
        db.add(LeaveRequest(person=people[1], starts_on=date(2026, 11, 3), ends_on=date(2026, 11, 7),
            status="approved", leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY"))
        db.commit()
        prior, leave = 0, {day: {1} for day in range(3, 8)}
    expected_coverage, expected_square_load, vectors = independent_optima(leave, prior, return_vectors=True)
    # Owner-approved availability targets use achieved coverage under shortage.
    available = [30-sum(i in absent for absent in leave.values()) for i in range(4)]
    targets = [expected_coverage*a/sum(available) for a in available] if policy == 'availability' else [7.5]*4
    scale = 1000 if policy == 'availability' else 1

    def policy_cost(counts):
        deviations = [n*scale-(round(t*scale) if scale > 1 else 0)
                      for n, t in zip(counts, targets)]
        return (max(deviations)-min(deviations),
                (sum(d*d for d in deviations) if policy == 'availability' else
                 sum(round((2*k-1-2*t)*100)
                     for n, t in zip(counts, targets) for k in range(1, n+1))))

    expected_policy = min(map(policy_cost, vectors))
    context = candidate_context(db, "2026-11")
    context.rules.fairness_rules.allocation_mode = policy
    assert context.rules.rest_rules.minimum_gap_after_24hr_hours == 24
    if preserved:
        assert preserved.id in {a.id for rows in context.nearby_assignments.values() for a in rows}
        assert preserved.id not in {a.id for rows in context.assignments_by_person.values() for a in rows}
    if reverse:
        rows.reverse()
    slots = {str(row.id): row for row in rows}
    result = solve_month(db, context, slots, seconds=45)
    choices = result["choices"]
    assert len(choices) == expected_coverage, result
    assert validate_plan(db, context, slots, choices) == []
    assert result["ot_reservations"]["status"] == "modeled"
    indices = {str(person.id): i for i, person in enumerate(people)}
    counts = Counter(indices[person] for person in choices.values())
    actual_counts = tuple(counts[i] for i in range(4))
    for key, value in {"oracle_coverage": expected_coverage, "actual_coverage": len(choices),
                       'allocation_mode': policy, 'target_demand_basis': 'covered_duties' if policy == 'availability' else 'full_template_30',
                       'oracle_selected_policy': str(expected_policy),
                       'actual_selected_policy': str(policy_cost(actual_counts)),
                       "oracle_square_load": expected_square_load,
                       "actual_square_load": sum(counts[i]**2 for i in range(4)),
                       "member_loads": str([counts[i] for i in range(4)]),
                       "optimizer_status": result["status"], "cuts": result["cuts"],
                       "elapsed_ms": result["elapsed_ms"],
                       "objective_receipts": str(result["objectives"])}.items():
        record_property(key, value)
    assert policy_cost(actual_counts) == expected_policy, result
    if policy == 'equal_counts':
        # With common targets, sum-of-squares remains an independent exact order.
        assert sum(counts[i]**2 for i in range(4)) == expected_square_load, result
    chosen_days = {slots[sid].duty_date.day: indices[person] for sid, person in choices.items()}
    previous = prior
    for day in range(1, 32):
        current = chosen_days.get(day)
        assert current is None or current not in leave.get(day+1, set())
        assert current is None or current != previous
        assert current is None or current not in leave.get(day, set())
        blocked = {p for p in (previous, current) if p is not None} | leave.get(day, set())
        assert len(blocked) <= 1, (day, previous, current, leave.get(day))
        previous = current
    assert all(UUID(person) in {p.id for p in people} for person in choices.values())
    assert db.query(DutyAssignment).count() == int(boundary_leave)
    if preserved:
        db.refresh(preserved)
        assert preserved.status == "assigned" and preserved.person_id == people[0].id
