"""Whole-month CP-SAT planning. The independent assignment validator remains authoritative.

Immutable inputs, lexicographic objectives, explicit unknowns and bounded search.
No operational writes occur in this module.
"""

from collections import defaultdict
from dataclasses import replace
from time import perf_counter
from uuid import UUID

from ortools.sat.python import cp_model

from app.services.rota_assignment import validate_assignment, rule_group_for_slot, campus_for_slot
from app.services.rota_candidates import add_provisional_assignment, slot_candidates_with_context
from app.services.rota_safety import assignment_indexes, rule_for_slot


def without_slots(context, slot_ids):
    """Copy mutable indexes while retaining ORM objects; never mutate saved assignments."""
    removed = {str(s) for s in slot_ids}
    nearby = defaultdict(
        list,
        {
            person: [a for a in rows if str(a.duty_slot_id) not in removed]
            for person, rows in context.nearby_assignments.items()
        },
    )
    monthly = [a for a in context.assignments if str(a.duty_slot_id) not in removed]
    by_person = defaultdict(list)
    for a in monthly:
        by_person[a.person_id].append(a)
    same, previous = assignment_indexes(
        [a for rows in nearby.values() for a in rows], context.rules
    )
    return replace(
        context,
        assignments=list(monthly),
        assignments_by_person=by_person,
        nearby_assignments=nearby,
        same_day_assignments=same,
        previous_day_assignments=previous,
        timings=dict(context.timings),
    )


def validate_plan(db, base, slots, choices):
    """Validate against the complete final schedule, not just earlier choices."""
    context = without_slots(base, [])
    for sid, person in choices.items():
        add_provisional_assignment(context, slots[sid], UUID(person))
    failures = []
    for sid, person in choices.items():
        result = validate_assignment(
            db,
            slot=slots[sid],
            person=context.people[UUID(person)],
            replace_existing=True,
            context=context,
        )
        if result["status"] != "clear":
            failures.append({"slot_id": sid, "person_id": person, "issues": result["issues"]})
    return failures


def incompatible(a, b, rules):
    if a.starts_at < b.ends_at and b.starts_at < a.ends_at:
        return True
    if a.duty_date == b.duty_date:
        ar, br = rule_for_slot(a, rules), rule_for_slot(b, rules)
        if (
            a.is_24hr
            or b.is_24hr
            or (ar and ar.blocks_elective_same_day)
            or (br and br.blocks_elective_same_day)
        ):
            return True
    for earlier, later in [(a, b), (b, a)]:
        if earlier.ends_at <= later.starts_at and earlier.is_24hr:
            if (
                later.starts_at - earlier.ends_at
            ).total_seconds() < rules.rest_rules.minimum_gap_after_24hr_hours * 3600:
                return True
        rule = rule_for_slot(earlier, rules)
        if (later.duty_date - earlier.duty_date).days == 1 and (
            earlier.is_24hr or (rule and rule.blocks_elective_next_day)
        ):
            return True
    return False


def solve_month(
    db,
    context,
    slots,
    *,
    mode="balanced",
    seconds=30,
    originals=None,
    preferences=None,
    forbidden=None,
    weights=None,
    holiday_dates=None,
    minimum_coverage=0,
    minimum_required=0,
):
    started = perf_counter()
    deadline = started + seconds
    originals, preferences = originals or {}, preferences or {}
    holiday_dates = set(holiday_dates or [])
    weights = weights or {"burden": 1, "spacing": 1, "history": 1}
    model = cp_model.CpModel()
    variables, candidates, rejected = {}, {}, {}
    for sid, slot in slots.items():
        row = slot_candidates_with_context(db, slot=slot, context=context)
        valid = [
            c
            for c in row["candidates"]
            if c["validation_status"] == "clear"
            and c["candidate_status"] == "eligible"
            and not c["requires_override"]
        ]
        candidates[sid] = {c["person_id"]: c for c in valid}
        rejected[sid] = [
            {"person_name": c["person_name"], "issues": c["validation_issues"]}
            for c in row["candidates"]
            if c not in valid
        ]
        for c in valid:
            variables[sid, c["person_id"]] = model.new_bool_var(f"x{len(variables)}")
        model.add(sum(v for (s, _), v in variables.items() if s == sid) <= 1)
    by_person = defaultdict(list)
    for (sid, person), var in variables.items():
        by_person[person].append((sid, var))
    for person, rows in by_person.items():
        for i, (sid, var) in enumerate(rows):
            for tid, other in rows[i + 1 :]:
                if incompatible(slots[sid], slots[tid], context.rules):
                    model.add(var + other <= 1)
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
    for previous in forbidden or []:
        chosen = set(previous.items())
        model.add(sum(v if k in chosen else -v for k, v in variables.items()) <= len(chosen) - 1)
    mandatory = sum(
        v
        for (s, _), v in variables.items()
        if not rule_for_slot(slots[s], context.rules)
        or rule_for_slot(slots[s], context.rules).is_mandatory
    )
    coverage = sum(variables.values())
    model.add(coverage >= minimum_coverage)
    model.add(mandatory >= minimum_required)
    changes = sum((1 - variables.get((s, p), 0)) for s, p in originals.items())
    preference_cost = sum(v * preferences.get(f"{s}:{p}", 0) for (s, p), v in variables.items())
    # Convex load costs discourage concentrating assignments. Normalize by compatible
    # opportunities; missing historical coverage is handled neutrally by existing scoring.
    load_costs, weekend_costs, night_costs, holiday_costs = [], [], [], []
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
    if originals:
        tiers.append(("changes", changes))
    if mode == "preferences":
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
    tiers += [
        ("weekend_burden", weekends),
        ("night_burden", nights),
        ("holiday_burden", sum(holiday_costs)),
        ("workload", burden),
        ("spacing_history", ranking + sum(spacing) * weights["spacing"]),
    ]
    if mode != "preferences":
        tiers.append(("preferences", preference_cost))
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 17
    choices, objectives = {}, []
    all_optimal = True
    cuts = 0
    last_status = None
    # Final-state staffing can depend on several assignments together. Validator-guided
    # no-good cuts retain exact semantics instead of approximating those rules silently.
    for name, expression in tiers:
        tier_proven = False
        while perf_counter() < deadline:
            solver.parameters.max_time_in_seconds = max(0.01, deadline - perf_counter())
            model.minimize(expression)
            status = solver.solve(model)
            last_status = status
            if status == cp_model.MODEL_INVALID:
                raise RuntimeError("The scheduling optimization model is invalid")
            if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                all_optimal = False
                break
            trial = {s: p for (s, p), v in variables.items() if solver.value(v)}
            failures = validate_plan(db, context, slots, trial)
            if failures:
                selected = [variables[s, p] for s, p in trial.items()]
                if not selected:
                    break
                model.add(sum(selected) <= len(selected) - 1)
                cuts += 1
                continue
            choices = trial
            value = solver.value(expression) if not isinstance(expression, int) else expression
            tier_proven = status == cp_model.OPTIMAL
            objectives.append({"name": name, "value": value, "proven": tier_proven})
            if tier_proven:
                model.add(expression == value)
            break
        if not tier_proven:
            all_optimal = False
            break
    failures = validate_plan(db, context, slots, choices)
    if failures:
        raise RuntimeError("Optimizer returned an invalid proposal")
    return {
        "choices": choices,
        "candidates": candidates,
        "rejected": rejected,
        "status": "optimal"
        if all_optimal
        else (
            "feasible"
            if choices
            else ("infeasible" if last_status == cp_model.INFEASIBLE else "time_limited")
        ),
        "objectives": objectives,
        "cuts": cuts,
        "elapsed_ms": round((perf_counter() - started) * 1000, 2),
        "uncovered": len(slots) - len(choices),
        "mode": mode,
        "holiday_dates": sorted(holiday_dates),
        "warnings": []
        if holiday_dates
        else ["No holiday dates configured; holiday balancing was not evaluated."],
        "history_window": {
            "start": str(context.history["start"]),
            "end": str(context.history["end"]),
            "observed_months": context.history["months"],
        },
    }
