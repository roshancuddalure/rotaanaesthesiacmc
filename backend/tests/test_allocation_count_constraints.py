"""Independent subset arithmetic checks monthly quotas and fixed baselines."""

from collections import Counter
from datetime import date
from itertools import product
from types import SimpleNamespace
from uuid import UUID

from ortools.sat.python import cp_model
import pytest

from app.services.allocation_count_constraints import add_monthly_count_limits
from app.services.rota_rules import DutyRule, RotaPhaseOneRules


@pytest.mark.parametrize("limits", [
    {}, {"max_24hr_per_month": 0}, {"max_24hr_per_month": 2},
    {"max_weekend_24hr_per_month": 1}, {"max_same_group_per_month": 1},
    {"max_same_campus_per_month": 1},
    {"max_24hr_per_month": 3, "max_weekend_24hr_per_month": 2,
     "max_same_group_per_month": 2, "max_same_campus_per_month": 2},
])
def test_count_model_matches_explicit_subset_limits(limits):
    person = UUID(int=1)
    rules = RotaPhaseOneRules(duty_rules=[DutyRule(key=key, label=key, group=group, duration_hours=24)
        for key, group in (("A", "shared"), ("B", "shared"), ("C", "other"))])
    for key, value in limits.items():
        setattr(rules.duty_count_limits, key, value)
    # Explicit independent facts: day24h/weekend24h/group/campus.
    facts = [(True, True, "shared", "MAIN"), (True, False, "shared", "MAIN"),
             (False, False, "other", "SECOND"), (True, True, "other", None)]
    fixed = [(True, True, "shared", "MAIN"), (True, False, "shared", "SECOND")]
    def slot(fact, index):
        full, weekend, group, campus = fact
        return SimpleNamespace(is_24hr=full, duty_date=date(2026, 11, 7 if weekend else 9),
            duty_type=("A" if index % 2 else "B") if group == "shared" else "C",
            unit=SimpleNamespace(campus=campus) if campus else None)
    slots = {str(i): slot(fact, i) for i, fact in enumerate(facts)}
    context = SimpleNamespace(rules=rules, assignments_by_person={person:
        [SimpleNamespace(duty_slot=slot(fact, i)) for i, fact in enumerate(fixed)]})
    for selected in product((0, 1), repeat=4):
        picked = [fact for yes, fact in zip(selected, facts) if yes]
        expected = True
        for key, index in (("max_24hr_per_month", 0), ("max_weekend_24hr_per_month", 1)):
            if key in limits:
                expected &= sum(f[index] for f in picked) <= max(0, limits[key]-sum(f[index] for f in fixed))
        for key, index in (("max_same_group_per_month", 2), ("max_same_campus_per_month", 3)):
            if key in limits:
                old, new = Counter(f[index] for f in fixed), Counter(f[index] for f in picked)
                expected &= all(count <= max(0, limits[key]-old[label]) for label, count in new.items() if label is not None)
        model = cp_model.CpModel()
        variables = {(sid, str(person)): model.new_bool_var(sid) for sid in slots}
        for (sid, _), variable in variables.items():
            model.add(variable == selected[int(sid)])
        add_monthly_count_limits(model, variables, slots, context)
        solver = cp_model.CpSolver()
        solver.parameters.num_search_workers = 1
        assert (solver.solve(model) == cp_model.OPTIMAL) == expected, (limits, selected)
