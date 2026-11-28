"""All ninety equal-count partitions, independently scored across burden tiers."""
from collections import Counter
from datetime import datetime, timedelta
from itertools import product
from types import SimpleNamespace
from uuid import UUID

import pytest
from ortools.sat.python import cp_model

from app.services.allocation_objective_model import build_objectives
from app.services.rota_rules import FairnessRules


@pytest.mark.parametrize('policy', ['availability', 'equal_counts'])
@pytest.mark.parametrize('mode', ['balanced', 'preferences', 'repair'])
def test_all_equal_count_partitions_respect_burden_before_preferences(policy, mode):
    people = [str(UUID(int=i+1)) for i in range(3)]
    # Separate dates avoid rest/spacing interactions. This is an objective oracle,
    # not a claim to independently verify the clinical candidate builder.
    dates = [datetime(2026, 1, 3), datetime(2026, 1, 18), datetime(2026, 2, 2),
             datetime(2026, 2, 17), datetime(2026, 3, 4), datetime(2026, 3, 19)]
    hours = [24, 12, 8, 4, 12, 8]
    slots = {}
    for i, (start, duration) in enumerate(zip(dates, hours)):
        if i in (2, 5):
            start = start.replace(hour=20)
        slots[str(i)] = SimpleNamespace(id=str(i), duty_date=start.date(),
            duty_type='ORACLE', starts_at=start, ends_at=start+timedelta(hours=duration),
            is_24hr=duration == 24)
    context = SimpleNamespace(
        rules=SimpleNamespace(fairness_rules=FairnessRules(allocation_mode=policy),
                              duty_rules_by_key={}),
        fairness_member_levels={UUID(p): '1ST_CALL' for p in people},
        fairness_person_targets={UUID(p): 2 for p in people},
        assignments_by_person={}, optimizer_extra_slots={'0', '2', '4'},
        average_assignments=2)
    model = cp_model.CpModel()
    variables = {(sid, p): model.new_bool_var(f'{sid}:{p}') for sid in slots for p in people}
    for sid in slots:
        model.add(sum(variables[sid, p] for p in people) == 1)
    for p in people:
        model.add(sum(variables[sid, p] for sid in slots) == 2)
    candidates = {sid: {p: {'score_parts': {}} for p in people} for sid in slots}
    preferences = {f'{sid}:{p}': (-1000000 if p == people[int(sid) % 3] else 0)
                   for sid in slots for p in people}
    originals = {sid: people[int(sid) % 3] for sid in slots} if mode == 'repair' else {}
    holidays = {str(dates[i].date()) for i in (1, 3, 4)}
    coverage = sum(variables.values())
    terms = build_objectives(model, variables, candidates, slots, context,
        targets={'1ST_CALL': 2}, mandatory=coverage, coverage=coverage, mode=mode,
        originals=originals, preferences=preferences,
        weights={'burden': 0, 'history': 0, 'spacing': 0}, holiday_dates=holidays,
        incompatible=lambda *_: False, enhance_equality=True)

    def oracle(sequence):
        minutes = [sum(hours[i]*60 for i, q in enumerate(sequence) if q == p) for p in people]
        extras = [sum(i in (0, 2, 4) for i, q in enumerate(sequence) if q == p) for p in people]
        result = [-6, -6, 0, 0, -1200,
                  sum(n*n for n in minutes), sum(n*n for n in extras)]
        # The existing workload policy normalizes by all six compatible slots.
        # Check its integer marginal costs independently, including their rounding.
        for category in ('weekend', 'night', 'holiday', 'total'):
            counts = Counter()
            for i, p in enumerate(sequence):
                start, end = slots[str(i)].starts_at, slots[str(i)].ends_at
                qualifies = {'weekend': start.weekday() >= 5,
                    'night': hours[i] == 24 or start.hour >= 18 or end.date() > start.date(),
                    'holiday': str(start.date()) in holidays, 'total': True}[category]
                counts[p] += int(qualifies)
            result.append(sum(sum(max(1, round((2*k-1)*100/6))
                                  for k in range(1, counts[p]+1)) for p in people))
        result += [0, sum(preferences[f'{i}:{p}'] for i, p in enumerate(sequence))]
        if originals:
            result.append(sum(originals[str(i)] != p for i, p in enumerate(sequence)))
        return result

    partitions = [seq for seq in product(people, repeat=6)
                  if all(seq.count(p) == 2 for p in people)]
    assert len(partitions) == 90
    expected = min(map(oracle, partitions))
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    for _, expression in terms.tiers:
        model.minimize(expression)
        assert solver.solve(model) == cp_model.OPTIMAL
        model.add(expression == solver.value(expression))
    chosen = {sid: p for (sid, p), variable in variables.items() if solver.value(variable)}
    actual = tuple(chosen[str(i)] for i in range(6))
    assert oracle(actual) == expected
    assert terms.quality(chosen) == expected
    assert [solver.value(expression) for _, expression in terms.tiers] == expected
