"""Independent finite arithmetic audit of every shared objective expression.

Scores arbitrary selections, not clinical feasibility. Explicit cumulative cost
tables and a closed-form equality calculation avoid reusing builder arithmetic.
"""

from datetime import date, datetime, timedelta
from itertools import product
from types import SimpleNamespace
from uuid import UUID

from ortools.sat.python import cp_model
import pytest

from app.services.allocation_objective_model import build_objectives
from app.services.rota_rules import DutyRule, RotaPhaseOneRules


@pytest.mark.parametrize("mode,repair", [("balanced", False), ("preferences", False), ("balanced", True), ("preferences", True)])
def test_shared_model_and_incumbent_scores_match_independent_arithmetic(mode, repair):
    a, b = str(UUID(int=1)), str(UUID(int=2))
    rules = RotaPhaseOneRules(duty_rules=[DutyRule(key=key, label=key, group="audit", duration_hours=8,
        is_mandatory=mandatory) for key, mandatory in (("AUDIT_REQUIRED", True), ("AUDIT_OPTIONAL", False))])
    def slot(day, *, night=False, mandatory=True):
        start = datetime(2026, 5, day, 18 if night else 8)
        return SimpleNamespace(duty_date=date(2026, 5, day), starts_at=start, ends_at=start+timedelta(hours=8),
            is_24hr=False, duty_type="AUDIT_REQUIRED" if mandatory else "AUDIT_OPTIONAL")
    slots = {"0": slot(2), "1": slot(6, night=True, mandatory=False), "2": slot(10)}
    fixed_a = slot(2, night=True)
    fixed_b = slot(3)
    context = SimpleNamespace(rules=rules, assignments_by_person={UUID(a): [SimpleNamespace(duty_slot=fixed_a)],
        UUID(b): [SimpleNamespace(duty_slot=fixed_b)]}, fairness_member_levels={UUID(a): "3RD_CALL", UUID(b): "4TH_CALL"},
        average_assignments=.75)
    targets = {"3RD_CALL": 1.25, "4TH_CALL": 2.5}
    candidates = {sid: {a: {"score_parts": {"burden": 2, "historical_fairness": -3, "rest": 4}},
                        b: {"score_parts": {"burden": 3, "historical_fairness": -2, "rest": 1}}} for sid in slots}
    preferences = {f"{sid}:{person}": (-100 if person == a else 7) for sid in slots for person in (a, b)}
    originals = {"0": a} if repair else {}
    # Each person has three candidate opportunities. Values are cumulative
    # rounded marginal costs for baselines zero and one, respectively.
    zero, one = (0, 33, 133, 300), (0, 100, 267, 500)
    for sequence in product((None, a, b), repeat=3):
        choices = {str(i): person for i, person in enumerate(sequence) if person is not None}
        model = cp_model.CpModel()
        variables = {(sid, person): model.new_bool_var(f"{sid}:{person}") for sid in slots for person in (a, b)}
        for (sid, person), variable in variables.items():
            model.add(variable == int(choices.get(sid) == person))
        terms = build_objectives(model, variables, candidates, slots, context, targets=targets,
            mandatory=sum(v for (sid, _), v in variables.items() if sid != "1"), coverage=sum(variables.values()),
            mode=mode, originals=originals, preferences=preferences, weights={"burden": 2, "history": 3, "spacing": 5},
            holiday_dates={"2026-05-02"}, incompatible=lambda *_: False)
        counts = {person: sequence.count(person) for person in (a, b)}
        required = sum(sequence[i] is not None for i in (0, 2))
        pref = -100*counts[a]+7*counts[b]
        equality = round(100*sum((1+counts[p]-target)**2-(1-target)**2 for p, target in ((a, 1.25), (b, 2.5))))
        weekend = sum(one[sum(sequence[i] == p for i in (0, 2))] for p in (a, b))
        night = one[int(sequence[1] == a)]+zero[int(sequence[1] == b)]
        holiday = one[int(sequence[0] == a)]+zero[int(sequence[0] == b)]
        workload = one[counts[a]]+one[counts[b]]
        ranking = 15*counts[a]+5*counts[b]
        ranking += 20*sum(sequence[i] is not None and sequence[i] == sequence[i+1] for i in (0, 1))
        expected = [-required, -len(choices)]
        if repair:
            expected.append(int(sequence[0] != a))
        if mode == "preferences":
            expected.append(pref)
        expected.extend([equality, weekend, night, holiday, workload, ranking])
        if mode != "preferences":
            expected.append(pref)
        solver = cp_model.CpSolver()
        solver.parameters.num_search_workers = 1
        assert solver.solve(model) == cp_model.OPTIMAL
        expressions = [solver.value(value) if not isinstance(value, int) else value for _, value in terms.tiers]
        assert expressions == terms.quality(choices) == expected, (mode, repair, sequence)
