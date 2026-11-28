"""Independent exhaustive oracle and real-engine fairness/safety simulations."""
from collections import Counter
from datetime import datetime, timedelta
from itertools import product
import random
from time import perf_counter
from types import SimpleNamespace
from uuid import UUID

import pytest
from ortools.sat.python import cp_model

from app.services.allocation_equality import equality_terms, probe_gap_limits


def slot(index, hours=8):
    start = datetime(2026, 11, 1)+timedelta(days=index*3)
    return SimpleNamespace(id=str(index), starts_at=start, ends_at=start+timedelta(hours=hours))


@pytest.mark.parametrize('seed', range(40))
def test_random_months_match_independent_complete_enumeration(seed):
    rng = random.Random(seed)
    people = [str(UUID(int=i+1)) for i in range(3)]
    slots = {str(i): slot(i, rng.choice([4, 7.5, 8, 12, 24])) for i in range(5)}
    fixed = {UUID(p): [SimpleNamespace(duty_slot=slot(9+i, 8), source='extra_duty_layer')
                       for i in range(rng.randrange(3))] for p in people}
    context = SimpleNamespace(fairness_member_levels={UUID(p): '1ST_CALL' for p in people},
                              assignments_by_person=fixed, optimizer_extra_slots={'0', '3'})
    model = cp_model.CpModel()
    allowed = {s: [p for p in people if rng.random() > .35] for s in slots}
    variables = {(s, p): model.new_bool_var(f'{s}:{p}') for s in slots for p in allowed[s]}
    for s in slots:
        model.add(sum(v for (t, _), v in variables.items() if s == t) <= 1)
    # A deliberately sparse rest-conflict graph and a two-new-duty quota.
    for p in people:
        model.add(sum(v for (_, q), v in variables.items() if q == p) <= 2)
        for i in range(4):
            if (str(i), p) in variables and (str(i+1), p) in variables:
                model.add(variables[str(i), p]+variables[str(i+1), p] <= 1)
    terms, score = equality_terms(model, variables, slots, context)

    def independent(sequence):
        counts = [len(fixed[UUID(p)])+sequence.count(p) for p in people]
        minutes = extras = 0
        for p in people:
            base = 480*len(fixed[UUID(p)])
            new = sum(int((slots[str(i)].ends_at-slots[str(i)].starts_at).total_seconds()/60)
                      for i, q in enumerate(sequence) if q == p)
            minutes += (base+new)**2-base**2
            base_extra = len(fixed[UUID(p)])
            extra = sum(q == p and i in (0, 3) for i, q in enumerate(sequence))
            extras += (base_extra+extra)**2-base_extra**2
        gap = max(counts)-min(counts)
        return [-sum(p is not None for p in sequence), gap, gap, minutes, extras]

    feasible = []
    for sequence in product(*[(None, *allowed[s]) for s in slots]):
        if any(sequence.count(p) > 2 for p in people):
            continue
        if any(sequence[i] is not None and sequence[i] == sequence[i+1] for i in range(4)):
            continue
        feasible.append(independent(sequence))
    expected = min(feasible)
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    for expression in [-sum(variables.values()), *(v for _, v in terms)]:
        model.minimize(expression)
        assert solver.solve(model) == cp_model.OPTIMAL
        model.add(expression == solver.value(expression))
    chosen = {s: p for (s, p), v in variables.items() if solver.value(v)}
    assert [-len(chosen), *score(chosen)] == expected
    assert [solver.value(v) for _, v in terms] == score(chosen)


def probe_fixture(fixed_count=0, validation=lambda _: []):
    a, b = str(UUID(int=1)), str(UUID(int=2))
    slots = {str(i): slot(i) for i in range(3)}
    context = SimpleNamespace(fairness_member_levels={UUID(a): '1ST_CALL', UUID(b): '1ST_CALL'},
                              assignments_by_person={UUID(a): [SimpleNamespace(duty_slot=slot(9), source='manual')]*fixed_count})
    model = cp_model.CpModel()
    variables = {(s, p): model.new_bool_var(s+p) for s in slots for p in (a, b)}
    for s in slots:
        model.add(sum(v for (t, _), v in variables.items() if s == t) <= 1)
    terms, score = equality_terms(model, variables, slots, context)
    def quality(choices):
        return [-len(choices), -len(choices), *score(choices)]
    return model, variables, terms[0][1], a, b, quality, validation


def test_feasibility_probe_can_improve_a_concentrated_incumbent_without_dropping_duties():
    model, variables, gap, a, b, quality, validate = probe_fixture()
    choices = {s: a for s, _ in variables}
    receipts, better = probe_gap_limits(model, variables, gap, choices=choices, quality=quality,
        validate=validate, deadline=perf_counter()+3, required=sum(variables.values()))
    assert all(row['status'] == 'feasible' for row in receipts)
    assert len(better) == 3 and max(Counter(better.values()).values()) == 2
    assert quality(better) < quality(choices) and len(choices) == 3


def test_infeasible_fixed_load_and_timeout_are_distinct():
    model, variables, gap, a, b, quality, validate = probe_fixture(fixed_count=8)
    choices = {s: b for s, _ in variables}
    receipts, _ = probe_gap_limits(model, variables, gap, choices=choices, quality=quality,
        validate=validate, deadline=perf_counter()+3, required=sum(variables.values()))
    assert [r['status'] for r in receipts] == ['infeasible_in_candidate_model']*2
    receipts, retained = probe_gap_limits(model, variables, gap, choices=choices, quality=quality,
        validate=validate, deadline=perf_counter()-1, required=sum(variables.values()))
    assert [r['status'] for r in receipts] == ['unknown']*2 and retained == choices


def test_invalid_witnesses_are_never_reported_feasible():
    model, variables, gap, a, b, quality, _ = probe_fixture()
    receipts, retained = probe_gap_limits(model, variables, gap, choices={s: a for s, _ in variables},
        quality=quality, validate=lambda _: [{'code': 'independent_safety_failure'}],
        deadline=perf_counter()+3, required=sum(variables.values()))
    assert all(r['status'] == 'infeasible_in_candidate_model' for r in receipts)
    assert set(retained.values()) == {a}


def test_gap_receipts_are_unknown_when_the_required_coverage_has_no_witness():
    model, variables, gap, a, b, quality, _ = probe_fixture()
    receipts, retained = probe_gap_limits(model, variables, gap, choices={}, quality=quality,
        validate=lambda _: pytest.fail('Coverage was not established'), deadline=perf_counter()+3,
        required=sum(variables.values()), coverage_established=False)
    assert retained == {}
    assert all(r['status'] == 'unknown' and r['reason'] == 'required_coverage_not_established' for r in receipts)


def test_outlier_evidence_reports_actual_restrictions_without_inventing_a_proof():
    from app.services.allocation_equality import explain_count_outliers
    a, b = UUID(int=1), UUID(int=2)
    context = SimpleNamespace(fairness_member_levels={a: '1ST_CALL', b: '1ST_CALL'},
        assignments_by_person={a: [object()]*3},
        people={a: SimpleNamespace(canonical_name='A'), b: SimpleNamespace(canonical_name='B')})
    rejected = {'x': [{'person_id': str(b), 'issues': [{'code': 'leave'}, {'code': 'rest_after_24hr'}]}]}
    evidence = explain_count_outliers(context, {}, {'x': {str(a): {}}}, rejected)
    assert evidence[0]['gap'] == 3
    outlier = next(p for p in evidence[0]['outliers'] if p['person_id'] == str(b))
    assert outlier['initial_candidate_restrictions'] == {'leave': 1, 'rest_after_24hr': 1}
    assert outlier['clear_candidate_duties'] == 0 and 'do not prove' in evidence[0]['basis']
    assert explain_count_outliers(context, {'x': str(b)}, {}, rejected) == []
