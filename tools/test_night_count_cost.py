"""Independent exhaustive objective values for the necessary-condition bound."""
from collections import Counter
from itertools import product
from pathlib import Path
import random
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from study_night_count_cost import analyze
import study_night_count_cost


def exhaustive_cost(rows, counts, bounds, gap, retain=False):
    costs = []
    for holders in product(*([r['original']] if r.get('fixed') else r['allowed'] for r in rows)):
        totals = Counter(holders)
        if any(not lower <= totals[p] <= upper for p, (lower, upper) in bounds.items()):
            continue
        nights = Counter(p for p, row in zip(holders, rows) if row['night'])
        if max(nights[p] for p in counts)-min(nights[p] for p in counts) <= gap:
            costs.append((sum(totals[p]**2 for p in counts),
                          sum(p != row['original'] for p, row in zip(holders, rows))))
    return (min(costs) if retain else min(costs)[0]) if costs else None


def test_minimum_count_cost_matches_all_exhaustive_assignment_costs():
    rng = random.Random(4161)
    bounds = {p: (1, 3) for p in range(3)}
    counts = {p: 2 for p in range(3)}
    observed = set()
    for index in range(48):
        rows = [dict(original=p, allowed=[q for q in range(3) if q == p or rng.random() < .45],
                     night=rng.random() < .5, fixed=rng.random() < .15) for p in (0, 0, 1, 1, 2, 2)]
        expected = exhaustive_cost(rows, counts, bounds, index % 3)
        result = analyze(rows, counts, count_bounds=bounds, gap=index % 3)
        assert result['count_cost_proven'] is True
        assert result['minimum_squared_counts'] == expected
        observed.add(expected is not None)
        reversed_result = analyze(list(reversed(rows)), {2: 2, 1: 2, 0: 2}, count_bounds=bounds, gap=index % 3)
        assert reversed_result['minimum_squared_counts'] == expected
        assert result['clinical_feasibility_proved'] is False
    assert observed == {False, True}


def test_night_improvement_can_require_worse_total_count_equality():
    rows = [dict(original=p, allowed=[0, 1], night=True) for p in (0, 0, 0, 0, 0, 1)]
    rows += [dict(original=1, allowed=[1], night=False, fixed=True) for _ in range(4)]
    result = analyze(rows, {0: 5, 1: 5}, count_bounds={0: (4, 6), 1: (4, 6)}, gap=2)
    assert result['status'] == 'necessary_condition_feasible'
    assert result['original_squared_counts'] == 50
    assert result['minimum_squared_counts'] == 52
    assert result['can_preserve_count_cost'] is False and result['count_cost_proven'] is True


def test_deadline_cannot_prove_that_count_equality_must_worsen(monkeypatch):
    clock = iter([0, 100, 100])
    monkeypatch.setattr(study_night_count_cost, 'perf_counter', lambda: next(clock))
    result = analyze([dict(original=0, allowed=[0], night=True)], {0: 1},
                     count_bounds={0: (1, 1)}, seconds=1)
    assert result['status'] == 'unknown'
    assert result['count_cost_proven'] is False
    assert result['can_preserve_count_cost'] is None


def test_retention_is_secondary_to_count_equality_and_witness_stays_local():
    rng = random.Random(2058)
    bounds, counts = {p: (1, 3) for p in range(3)}, {p: 2 for p in range(3)}
    for index in range(24):
        rows = [dict(original=p, allowed=[q for q in range(3) if q == p or rng.random() < .5],
                     night=rng.random() < .5, fixed=rng.random() < .1) for p in (0, 0, 1, 1, 2, 2)]
        expected = exhaustive_cost(rows, counts, bounds, index % 3, retain=True)
        witness = {'stale': 'must clear'}
        result = analyze(rows, counts, count_bounds=bounds, gap=index % 3,
                         prefer_original=True, witness=witness)
        assert result['retention_cost_proven']
        if expected is None:
            assert not witness and result['minimum_squared_counts'] is None
        else:
            assert (result['minimum_squared_counts'], result['changed_assignments']) == expected
            assert len(witness) == len(rows)
            assert sum(p != rows[i]['original'] for i, p in witness.items()) == expected[1]
            assert 'witness' not in result  # Private IDs never enter aggregate JSON.
