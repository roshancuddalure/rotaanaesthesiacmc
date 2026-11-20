"""Canonical existing monthly count constraints shared by planning models.

Inputs are the caller's active monthly fixed assignments and eligible choices.
Boundary duties belong to separate safety constraints, not these monthly totals.
Existing excess consumes all remaining capacity; no new exception is granted.
"""

from collections import defaultdict
from uuid import UUID

from app.services.rota_assignment import campus_for_slot, rule_group_for_slot


def add_monthly_count_limits(model, variables, slots, context):
    by_person = defaultdict(list)
    for (sid, person), variable in variables.items():
        by_person[person].append((sid, variable))
    constraint_count = 0
    for person, rows in by_person.items():
        existing = [a.duty_slot for a in context.assignments_by_person.get(UUID(person), [])]
        limits = context.rules.duty_count_limits
        predicates = [
            (limits.max_24hr_per_month, lambda s: s.is_24hr),
            (limits.max_weekend_24hr_per_month, lambda s: s.is_24hr and s.duty_date.weekday() >= 5),
        ]
        for group in {rule_group_for_slot(slots[s], context.rules) for s, _ in rows}:
            predicates.append(
                (
                    limits.max_same_group_per_month,
                    lambda s, g=group: rule_group_for_slot(s, context.rules) == g,
                )
            )
        for campus in {campus_for_slot(slots[s]) for s, _ in rows} - {None}:
            predicates.append(
                (limits.max_same_campus_per_month, lambda s, c=campus: campus_for_slot(s) == c)
            )
        for limit, predicate in predicates:
            if limit is not None:
                model.add(
                    sum(v for s, v in rows if predicate(slots[s]))
                    <= max(0, limit - sum(predicate(s) for s in existing))
                )
        constraint_count += sum(limit is not None for limit, _ in predicates)
    return {"people": len(by_person), "constraints": constraint_count}
