"""Independent exhaustive matching checks for diagnostic inference boundaries."""
from collections import Counter
from itertools import product
from pathlib import Path
import random
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from study_night_gap_relaxation import analyze
import study_night_gap_relaxation


def exhaustive(rows, counts, gap, bounds=None):
    for holders in product(*([r['original']] if r.get('fixed') else r['allowed'] for r in rows)):
        actual = Counter(holders)
        if (actual != Counter(counts) if bounds is None else
                any(not lower <= actual[p] <= upper for p, (lower, upper) in bounds.items())):
            continue
        nights = Counter(p for p, row in zip(holders, rows) if row['night'])
        values = [nights[p] for p in counts]
        if max(values)-min(values) <= gap:
            return True
    return False


@pytest.mark.parametrize('flexible', [False, True])
def test_relaxation_matches_independent_exhaustive_assignment_enumeration(flexible):
    randomizer = random.Random(9271)
    observed = set()
    for index in range(48):
        original = [0, 0, 1, 1, 2, 2]
        rows = [dict(original=p, allowed=[q for q in range(3) if q == p or randomizer.random() < .45],
                     night=randomizer.random() < .5, fixed=randomizer.random() < .2) for p in original]
        gap = index % 3
        bounds = {p: (1, 3) for p in range(3)} if flexible else None
        possible = exhaustive(rows, {0: 2, 1: 2, 2: 2}, gap, bounds)
        result = analyze(rows, {0: 2, 1: 2, 2: 2}, gap=gap, seconds=2, count_bounds=bounds)
        assert (result['status'] == 'necessary_condition_feasible') == possible
        assert result['status'] != 'unknown'
        assert result['clinical_feasibility_proved'] is False
        reversed_rows = [{**r, 'allowed': list(reversed(r['allowed']))} for r in reversed(rows)]
        assert analyze(reversed_rows, {2: 2, 1: 2, 0: 2}, gap=gap, count_bounds=bounds)['status'] == result['status']
        observed.add(possible)
    assert observed == {False, True}


def test_protected_holder_cannot_be_reassigned_to_manufacture_a_gap_certificate():
    rows = [dict(original=p, allowed=[0, 1], night=p == 0, fixed=True) for p in (0, 0, 1, 1)]
    assert analyze(rows, {0: 2, 1: 2}, gap=0)['status'] == 'infeasible_in_relaxed_model'
    for row in rows:
        row['fixed'] = False
    assert analyze(rows, {0: 2, 1: 2}, gap=0)['status'] == 'necessary_condition_feasible'


def test_inconsistent_baseline_refuses_to_issue_a_proof():
    with pytest.raises(AssertionError):
        analyze([dict(original=0, allowed=[1], night=True)], {0: 1, 1: 0})


def test_zero_duties_and_duplicate_candidate_rows_do_not_create_false_infeasibility():
    assert analyze([], {0: 0, 1: 0})['status'] == 'necessary_condition_feasible'
    rows = [dict(original=0, allowed=[0, 0, 1], night=True),
            dict(original=1, allowed=[0, 1, 1], night=False)]
    assert analyze(rows, {0: 1, 1: 1}, gap=1)['status'] == 'necessary_condition_feasible'


def test_observation_deadline_is_unknown_and_never_an_infeasibility_certificate(monkeypatch):
    clock = iter([0, 100, 100])
    monkeypatch.setattr(study_night_gap_relaxation, 'perf_counter', lambda: next(clock))
    rows = [dict(original=0, allowed=[0], night=True)]
    result = analyze(rows, {0: 1}, seconds=1)
    assert result['status'] == 'unknown'
    assert result['all_minima_exhausted'] is False
    assert result['tested_minimum_nights'] == []


def test_variable_totals_can_escape_fixed_count_night_infeasibility():
    rows = [dict(original=0, allowed=[0, 1], night=True) for _ in range(4)]
    rows += [dict(original=1, allowed=[1], night=False, fixed=True) for _ in range(2)]
    assert analyze(rows, {0: 4, 1: 2}, gap=2)['status'] == 'infeasible_in_relaxed_model'
    result = analyze(rows, {0: 4, 1: 2}, gap=2, count_bounds={0: (2, 4), 1: (2, 4)})
    assert result['status'] == 'necessary_condition_feasible'
    assert result['night_gap'] <= 2 and result['clinical_feasibility_proved'] is False
