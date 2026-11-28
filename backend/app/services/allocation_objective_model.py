"""Shared existing CP-SAT objective expressions and exact incumbent scoring.

No database access or policy selection. Callers supply canonical target membership,
fixed assignments, candidates and incompatibility. Opportunity rows must describe
one common candidate universe even when a caller fixes some decisions to zero.
"""

from collections import defaultdict
from dataclasses import dataclass
from typing import Callable
from uuid import UUID

from app.services.rota_safety import rule_for_slot
from app.services.allocation_equality import equality_terms
from app.services.allocation_fairness_policy import person_target
from app.services.allocation_covered_targets import enabled as covered_enabled


@dataclass
class ObjectiveTerms:
    tiers: list
    quality: Callable
    level_of: dict


def build_objectives(model, variables, candidates, slots, context, *, targets,
                     mandatory, coverage, mode, originals, preferences, weights,
                     holiday_dates, incompatible, enhance_equality=False):
    covered = enhance_equality and covered_enabled(context)
    by_person = defaultdict(list)
    for (sid, person), variable in variables.items():
        by_person[person].append((sid, variable))
    changes = sum((1 - variables.get((s, p), 0)) for s, p in originals.items())
    preference_cost = sum(v * preferences.get(f"{s}:{p}", 0) for (s, p), v in variables.items())
    # Convex load costs discourage concentrating assignments. Normalize by compatible
    # opportunities; missing historical coverage is handled neutrally by existing scoring.
    load_costs, weekend_costs, night_costs, holiday_costs = [], [], [], []
    # Equal duties within a call level (docs/limits_callevel_fairness_contract.md 2): the sum
    # of (month duties - call-level target)^2 over members, all campuses together. The n-th
    # extra duty adds 2(base+n) - 1 - 2*target (x100); campus plays no part here.
    equality_costs = []
    # A promotion may give one person candidates at several dated call levels.
    # Reuse canonical monthly membership instead of whichever slot was visited last.
    level_of = {str(p): level for p, level in (context.fairness_member_levels or {}).items()}
    for person, rows in by_person.items():
        for category, predicate, costs in [
            ("total", lambda s: True, load_costs),
            ("weekend", lambda s: s.duty_date.weekday() >= 5, weekend_costs),
            (
                "night",
                lambda s: (
                    s.is_24hr or s.starts_at.hour >= 18 or s.ends_at.date() > s.starts_at.date()
                ),
                night_costs,
            ),
            ("holiday", lambda s: str(s.duty_date) in holiday_dates, holiday_costs),
        ]:
            selected = [v for s, v in rows if predicate(slots[s])]
            base = sum(
                predicate(a.duty_slot) for a in context.assignments_by_person.get(UUID(person), [])
            )
            for n in range(1, len(selected) + 1):
                threshold = model.new_bool_var(f"load{person}{category}{n}")
                model.add(sum(selected) >= n).only_enforce_if(threshold)
                model.add(sum(selected) < n).only_enforce_if(threshold.Not())
                costs.append(
                    threshold * max(1, round((2 * (base + n) - 1) * 100 / max(1, len(rows))))
                )
                if category == "total" and not covered:
                    target = targets.get(level_of.get(person))
                    if enhance_equality:
                        target = person_target(context, person, target)
                    if target is None:
                        target = context.average_assignments
                    equality_costs.append(
                        threshold * round((2 * (base + n) - 1 - 2 * target) * 100)
                    )
    burden = sum(load_costs)
    weekends = sum(weekend_costs)
    nights = sum(night_costs)
    ranking = sum(
        v
        * (
            candidates[s][p]["score_parts"].get("burden", 0) * weights["burden"]
            + candidates[s][p]["score_parts"].get("historical_fairness", 0) * weights["history"]
            + candidates[s][p]["score_parts"].get("rest", 0) * weights["spacing"]
        )
        for (s, p), v in variables.items()
    )
    tiers = [("required_coverage", -mandatory), ("coverage", -coverage)]
    enhanced, enhanced_score = equality_terms(model, variables, slots, context, include_squared=covered) if enhance_equality else ([], None)
    if originals and not enhance_equality:
        tiers.append(("changes", changes))
    if mode == "preferences" and not enhance_equality:
        tiers.append(("preferences", preference_cost))
    spacing = []
    for person, rows in by_person.items():
        for i, (sid, var) in enumerate(rows):
            for tid, other in rows[i + 1 :]:
                days = abs((slots[sid].duty_date - slots[tid].duty_date).days)
                if 0 < days <= 7 and not incompatible(slots[sid], slots[tid], context.rules):
                    together = model.new_bool_var(f"space{len(spacing)}")
                    model.add(together <= var)
                    model.add(together <= other)
                    model.add(together >= var + other - 1)
                    spacing.append(together * (8 - days))
    equality_tiers = enhanced if covered else enhanced[:2] + [
        ("call_level_equality", sum(equality_costs)),
    ] + enhanced[2:]
    tiers += equality_tiers + [
        ("weekend_burden", weekends),
        ("night_burden", nights),
        ("holiday_burden", sum(holiday_costs)),
        ("workload", burden),
        ("spacing_history", ranking + sum(spacing) * weights["spacing"]),
    ]
    if mode != "preferences" or enhance_equality:
        tiers.append(("preferences", preference_cost))
    if originals and enhance_equality:
        tiers.append(("changes", changes))
    def quality(choices):
        categories = [
            lambda s: s.duty_date.weekday() >= 5,
            lambda s: s.is_24hr or s.starts_at.hour >= 18 or s.ends_at.date() > s.starts_at.date(),
            lambda s: str(s.duty_date) in holiday_dates,
            lambda s: True,
        ]
        costs = []
        for predicate in categories:
            cost = 0
            for person, rows in by_person.items():
                baseline = sum(
                    predicate(a.duty_slot)
                    for a in context.assignments_by_person.get(UUID(person), [])
                )
                count = sum(choices.get(s) == person and predicate(slots[s]) for s, _ in rows)
                cost += sum(
                    max(1, round((2 * (baseline + n) - 1) * 100 / max(1, len(rows))))
                    for n in range(1, count + 1)
                )
            costs.append(cost)
        required = sum(
            not rule_for_slot(slots[s], context.rules)
            or rule_for_slot(slots[s], context.rules).is_mandatory
            for s in choices
        )
        result = [-required, -len(choices)]
        if originals and not enhance_equality:
            result.append(sum(choices.get(s) != p for s, p in originals.items()))
        pref = sum(preferences.get(f"{s}:{p}", 0) for s, p in choices.items())
        if mode == "preferences" and not enhance_equality:
            result.append(pref)
        equality = 0
        for person, rows in ([] if covered else by_person.items()):
            target = targets.get(level_of.get(person))
            if enhance_equality:
                target = person_target(context, person, target)
            if target is None:
                target = context.average_assignments
            baseline = len(context.assignments_by_person.get(UUID(person), []))
            count = sum(choices.get(s) == person for s, _ in rows)
            equality += sum(
                round((2 * (baseline + n) - 1 - 2 * target) * 100) for n in range(1, count + 1)
            )
        extra_scores = enhanced_score(choices) if enhanced_score else []
        if covered:
            result.extend(extra_scores)
        else:
            result.extend(extra_scores[:2])
            result.append(equality)
            result.extend(extra_scores[2:])
        result.extend(costs)
        ranked = sum(
            candidates[s][p]["score_parts"].get("burden", 0) * weights["burden"]
            + candidates[s][p]["score_parts"].get("historical_fairness", 0) * weights["history"]
            + candidates[s][p]["score_parts"].get("rest", 0) * weights["spacing"]
            for s, p in choices.items()
        )
        for person, rows in by_person.items():
            chosen = [s for s, _ in rows if choices.get(s) == person]
            for i, s in enumerate(chosen):
                for t in chosen[i + 1 :]:
                    days = abs((slots[s].duty_date - slots[t].duty_date).days)
                    if 0 < days <= 7 and not incompatible(slots[s], slots[t], context.rules):
                        ranked += (8 - days) * weights["spacing"]
        result.append(ranked)
        if mode != "preferences" or enhance_equality:
            result.append(pref)
        if originals and enhance_equality:
            result.append(sum(choices.get(s) != p for s, p in originals.items()))
        return result

    return ObjectiveTerms(tiers, quality, level_of)
