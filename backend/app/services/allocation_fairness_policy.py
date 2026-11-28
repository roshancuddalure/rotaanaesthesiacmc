"""Shared fairness policy; eligibility and clinical safety are independent of this choice."""

AVAILABILITY = "availability"
EQUAL_COUNTS = "equal_counts"
SCALE = 1000  # CP-SAT deviation precision: one thousandth of a duty.


def fairness_mode(rules):
    return getattr(getattr(rules, "fairness_rules", None), "allocation_mode", AVAILABILITY)


def personal_shares(demand, members, available_days, mode):
    """Same roster and demand in both modes; only the target weights change."""
    weights = {p: (1 if mode == EQUAL_COUNTS else max(0, available_days.get(p, 0)))
               for p in members}
    total = sum(weights.values())
    return {p: demand * weights[p] / total if total else 0.0 for p in members}


def person_target(context, person, fallback=None):
    from uuid import UUID

    return (getattr(context, "fairness_person_targets", None) or {}).get(UUID(str(person)), fallback)
