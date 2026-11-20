"""Thirty-day dated skill competition against independent injective role matching."""

from collections import Counter
from datetime import date, datetime
from itertools import permutations

import pytest

from app.models import CallCluster, DutyAssignment, OtCalendar, PersonCallClusterMembership
from app.services.ot_calendar_store import CalendarConfiguration, canonical, revision
from app.services.ot_capacity import eligible
from app.services.rota_candidates import candidate_context
from app.services.rota_optimizer import solve_month, validate_plan
from tests.test_ot_assignment_integration import environment as environment, slot  # noqa: F401
from tests.test_ot_whole_month_oracle import independent_optima


@pytest.mark.parametrize("expires,reverse", [(False, False), (True, False), (True, True)])
def test_dated_skills_preserve_distinct_ot_roles_and_best_monthly_load(environment, expires, reverse, record_property):
    db, unit, people, existing_slot = environment
    rows = [existing_slot if day == 19 else slot(db, unit, date(2026, 11, day)) for day in range(1, 31)]
    cardiac = CallCluster(key="synthetic_cardiac", name="Synthetic cardiac source", call_level="3RD_CALL", active=True)
    neuro = CallCluster(key="synthetic_neuro", name="Synthetic neuro source", call_level="3RD_CALL", active=True)
    db.add_all([cardiac, neuro])
    db.flush()
    db.add_all([
        PersonCallClusterMembership(person=people[0], cluster=cardiac, effective_from=date(2026, 10, 1),
            effective_to=date(2026, 11, 15) if expires else None),
        PersonCallClusterMembership(person=people[2], cluster=cardiac, effective_from=date(2026, 11, 16)),
        *(PersonCallClusterMembership(person=person, cluster=neuro, effective_from=date(2026, 10, 1)) for person in people[:2]),
    ])
    calendar = db.query(OtCalendar).filter_by(unit_id=unit.id).one()
    configuration = dict(calendar.configuration)
    configuration["qualification_bindings"] = [
        {"skill_key": "cardiac", "group_keys": [cardiac.key]},
        {"skill_key": "neuro", "group_keys": [neuro.key]},
    ]
    configuration["weekly"] = [{**row, "bands": [
        {**row["bands"][0], "key": key, "required_skills": skills, "minimum": 1, "target": 1}
        for key, skills in (("cardiac", ["cardiac"]), ("neuro", ["neuro"]), ("general", []))
    ]} for row in configuration["weekly"]]
    configuration = canonical(CalendarConfiguration.model_validate(configuration))
    calendar.configuration, calendar.revision = configuration, revision(configuration)
    db.commit()
    # Explicit role lists from the fixture, not inferred by canonical eligibility.
    # One multi-skilled person cannot occupy the two simultaneous specialist roles.
    roles = {day: ({0} if day < 16 else ({2} if expires else {0, 2}), {0, 1}, {0, 1, 2, 3})
             for day in range(1, 32)}
    expected_coverage, expected_square_load = independent_optima({}, None, ot_roles=roles)
    context = candidate_context(db, "2026-11")
    guard = context.ot_guard
    assert guard.reviewed_complete and not guard.unresolved
    by_id = {person.id: person for person in guard.people}
    for day in (15, 16):
        needs = {need.band_key: need for need in guard.requirements if need.starts_at == datetime(2026, 11, day, 8)}
        for role, key in enumerate(("cardiac", "neuro", "general")):
            assert {i for i, person in enumerate(people) if eligible(by_id[person.id], needs[key])} == roles[day][role]
    slots = {str(row.id): row for row in (reversed(rows) if reverse else rows)}
    result = solve_month(db, context, slots, seconds=45)
    choices = result["choices"]
    assert len(choices) == expected_coverage, result
    assert validate_plan(db, context, slots, choices) == []
    assert result["ot_reservations"]["status"] == "modeled"
    counts = Counter(choices.values())
    square_load = sum(counts[str(person.id)]**2 for person in people)
    assert square_load == expected_square_load, result
    indices = {str(person.id): i for i, person in enumerate(people)}
    chosen_days = {slots[sid].duty_date.day: indices[person] for sid, person in choices.items()}
    previous = None
    for day in range(1, 32):
        current = chosen_days.get(day)
        assert current is None or current != previous
        remaining = set(range(4)) - {p for p in (previous, current) if p is not None}
        assert any(all(person in role for person, role in zip(assignment, roles[day]))
                   for assignment in permutations(remaining, 3)), (day, current, previous)
        previous = current
    for key, value in {"oracle_coverage": expected_coverage, "actual_coverage": len(choices),
                       "oracle_square_load": expected_square_load, "actual_square_load": square_load,
                       "member_loads": str([counts[str(p.id)] for p in people]),
                       "optimizer_status": result["status"], "cuts": result["cuts"],
                       "elapsed_ms": result["elapsed_ms"], "objective_receipts": str(result["objectives"])}.items():
        record_property(key, value)
    assert db.query(DutyAssignment).count() == 0
