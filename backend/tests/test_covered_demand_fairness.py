"""Independent shortage oracle: unfilled template demand cannot skew targets."""
from datetime import datetime, timedelta
from itertools import product
from types import SimpleNamespace
from uuid import UUID
import random

import pytest

from ortools.sat.python import cp_model

from app.services.allocation_covered_targets import CoveredTargets
from app.services.allocation_equality import equality_terms
from app.services.rota_rules import DutyRule


def fixture():
    a, b = str(UUID(int=1)), str(UUID(int=2))
    rule = DutyRule(key='COVERED_TEST', label='Covered test', group='audit',
                    duration_hours=8, allowed_call_levels=['1ST_CALL'])
    rules = SimpleNamespace(duty_rules_by_key={rule.key: rule},
                            fairness_rules=SimpleNamespace(allocation_mode='availability'))
    context = SimpleNamespace(rules=rules, fairness_member_levels={UUID(a): '1ST_CALL', UUID(b): '1ST_CALL'},
        fairness_available_days={UUID(a): 30, UUID(b): 15},
        fairness_person_targets={UUID(a): 8, UUID(b): 4}, assignments_by_person={})
    start = datetime(2026, 5, 1, 13)
    slots = {str(i): SimpleNamespace(id=str(i), duty_type=rule.key, call_level='1ST_CALL',
             duty_date=(start+timedelta(days=i)).date(), starts_at=start+timedelta(days=i),
             ends_at=start+timedelta(days=i,hours=8), is_24hr=False) for i in range(12)}
    return a, b, context, slots


def test_shortage_solver_and_independent_exhaustive_oracle_use_six_covered_duties():
    a, b, context, slots = fixture()
    model = cp_model.CpModel()
    variables = {(sid, p): model.new_bool_var(f'{sid}:{p}') for sid in list(slots)[:6] for p in (a,b)}
    for sid in list(slots)[:6]:
        model.add(sum(variables[sid,p] for p in (a,b)) == 1)
    terms, score = equality_terms(model, variables, slots, context, include_squared=True)
    # Independent arithmetic: six covered, not twelve planned; weights30:15 ->4:2.
    oracle = []
    for people in product((a,b), repeat=6):
        ca, cb = people.count(a), people.count(b)
        gap = abs((ca-4)-(cb-2))
        oracle.append((gap, (ca-4)**2+(cb-2)**2, people))
    expected = min((gap, square) for gap,square,_ in oracle)
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    for _, term in terms:
        model.minimize(term)
        assert solver.solve(model) == cp_model.OPTIMAL
        model.add(term == solver.value(term))
    chosen = {sid:p for (sid,p),v in variables.items() if solver.value(v)}
    ca, cb = list(chosen.values()).count(a), list(chosen.values()).count(b)
    assert (abs((ca-4)-(cb-2)),(ca-4)**2+(cb-2)**2) == expected == (0,0)
    assert (ca,cb) == (4,2)
    spec = CoveredTargets(context, slots)
    assert spec.exact(chosen) == {a:4,b:2}
    assert score(chosen)[:3] == [0,0,0]


def test_pooled_covered_demand_keeps_existing_proportional_call_level_split():
    a,b,context,slots = fixture()
    c = str(UUID(int=3))
    context.fairness_member_levels[UUID(c)] = '2ND_CALL'
    context.fairness_available_days = {UUID(p):30 for p in (a,b,c)}
    rule = context.rules.duty_rules_by_key['COVERED_TEST']
    rule.allowed_call_levels = ['1ST_CALL','2ND_CALL']
    for slot in slots.values():
        slot.call_level = None
    target = CoveredTargets(context,slots).exact({'0':a,'1':c})
    from fractions import Fraction
    assert target == {p:Fraction(2,3) for p in (a,b,c)}
    assert sum(target.values()) == 2


@pytest.mark.parametrize('seed',range(12))
def test_random_shortages_match_independent_capacity_and_fairness_oracle(seed):
    a,b,context,all_slots = fixture()
    c = str(UUID(int=3))
    context.fairness_member_levels[UUID(c)] = '1ST_CALL'
    context.fairness_available_days = {UUID(a):30,UUID(b):15,UUID(c):15}
    context.fairness_person_targets[UUID(c)] = 4
    slots = dict(list(all_slots.items())[:5])
    rng = random.Random(seed)
    people = (a,b,c)
    pools = {s:[p for p in people if rng.random()>.4] for s in slots}
    model = cp_model.CpModel()
    variables = {(s,p):model.new_bool_var(f'{s}:{p}') for s in slots for p in pools[s]}
    for s in slots:
        model.add(sum(v for (sid,_),v in variables.items() if sid==s)<=1)
    for p in people:
        model.add(sum(v for (_,person),v in variables.items() if person==p)<=3)
    terms,score = equality_terms(model,variables,slots,context,include_squared=True)

    def oracle(seq):
        covered = sum(p is not None for p in seq)
        counts = [seq.count(p) for p in people]
        # Shares2:1:1; calculate independently from actual coverage, not the helper.
        deviations = [1000*n-covered*weight for n,weight in zip(counts,(500,250,250))]
        gap = max(deviations)-min(deviations)
        return (-covered,gap,gap,sum(d*d for d in deviations),sum((n*480)**2 for n in counts),0)

    expected = min(oracle(seq) for seq in product(*[(None,*pools[s]) for s in slots])
                   if all(seq.count(p)<=3 for p in people))
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    for _,term in [('coverage',-sum(variables.values())),*terms]:
        model.minimize(term)
        assert solver.solve(model)==cp_model.OPTIMAL
        model.add(term==solver.value(term))
    chosen = {s:p for (s,p),v in variables.items() if solver.value(v)}
    seq = [chosen.get(s) for s in slots]
    assert oracle(seq)==expected
    assert tuple([-len(chosen),*score(chosen)])==expected
