"""Whole-month CP-SAT planning. The independent assignment validator remains authoritative.

Immutable inputs, lexicographic objectives, explicit unknowns and bounded search.
No operational writes occur in this module.
"""

from collections import defaultdict
from dataclasses import replace
from time import perf_counter
from uuid import UUID

from ortools.sat.python import cp_model

from app.services.rota_assignment import validate_assignment
from app.services.rota_candidates import (
    add_provisional_assignment,
    slot_candidates_with_context,
    candidate_context,
    context_targets,
)
from app.services.rota_safety import assignment_indexes, rule_for_slot
from app.services.allocation_objectives import describe_objectives
from app.services.allocation_objective_model import build_objectives
from app.services.allocation_count_constraints import add_monthly_count_limits


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
    result = replace(
        context,
        assignments=list(monthly),
        assignments_by_person=by_person,
        nearby_assignments=nearby,
        same_day_assignments=same,
        previous_day_assignments=previous,
        timings=dict(context.timings),
    )
    result.optimizer_removed_slots = getattr(context, "optimizer_removed_slots", set()) | removed
    return result


def fixed_snapshots(db, base):
    """Cache baseline checks for fixed duties, including the next month's first day."""
    if hasattr(base, "optimizer_fixed_snapshots"):
        return base.optimizer_fixed_snapshots
    removed = getattr(base, "optimizer_removed_slots", set())
    original = candidate_context(db, base.month) if removed else base
    contexts = [(original, base, list(base.assignments))]
    future_months = {
        str(a.duty_slot.duty_date)[:7]
        for rows in base.nearby_assignments.values()
        for a in rows
        if (a.duty_slot.duty_date - base.ends_on).days == 1
        and a.status.lower() in {"assigned", "confirmed", "draft"}
    }
    for month in sorted(future_months):
        before = candidate_context(db, month)
        after = without_slots(before, removed)
        assignments = [
            a for a in after.assignments if (a.duty_slot.duty_date - base.ends_on).days == 1
        ]
        contexts.append((before, after, assignments))
    snapshots = []
    for before, after, assignments in contexts:
        rows = []
        for assignment in assignments:
            check = validate_assignment(
                db,
                slot=assignment.duty_slot,
                person=assignment.person,
                replace_existing=True,
                context=before,
            )
            rows.append((assignment, check))
        snapshots.append((after, rows))
    base.optimizer_fixed_snapshots = snapshots
    return snapshots


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
    if choices:
        for fixed_base, rows in fixed_snapshots(db, base):
            final = without_slots(fixed_base, [])
            for sid, person in choices.items():
                assignment = add_provisional_assignment(final, slots[sid], UUID(person))
                if not final.starts_on <= slots[sid].duty_date <= final.ends_on:
                    final.assignments.remove(assignment)
                    final.assignments_by_person[UUID(person)].remove(assignment)
            for assignment, before in rows:
                after = validate_assignment(
                    db,
                    slot=assignment.duty_slot,
                    person=assignment.person,
                    replace_existing=True,
                    context=final,
                )
                old = {(i["code"], i["severity"]) for i in before["issues"]}
                extra = [i for i in after["issues"] if (i["code"], i["severity"]) not in old]
                worsened = (
                    before["status"] != "clear"
                    and after["slot_safety"]["available_members"]
                    < before["slot_safety"]["available_members"]
                )
                if extra or worsened:
                    failures.append(
                        {
                            "slot_id": str(assignment.duty_slot_id),
                            "person_id": str(assignment.person_id),
                            "issues": extra or after["issues"],
                            "preserved_conflict": True,
                        }
                    )
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
    seed_choices=None,
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
    add_monthly_count_limits(model, variables, slots, context)
    for previous in forbidden or []:
        chosen = set(previous.items())
        model.add(sum(v if k in chosen else -v for k, v in variables.items()) <= len(chosen) - 1)
    joint_reservations = None
    if getattr(context, "ot_guard", None) is not None:
        from app.services.ot_capacity import CapacityResourceLimit
        from app.services.ot_joint_reservations import add_joint_reservations
        try:
            joint_reservations = add_joint_reservations(model, context.ot_guard,
                (a for rows in context.nearby_assignments.values() for a in rows),
                slots, variables, context.rules)
        except CapacityResourceLimit as exc:
            # An incomplete model is not a search space or a safety exception.
            return {"choices": {}, "candidates": candidates, "rejected": rejected,
                    "status": "time_limited", "objectives": [], "cuts": 0,
                    "baseline_retained": False, "quality": [],
                    "elapsed_ms": round((perf_counter() - started) * 1000, 2),
                    "uncovered": len(slots), "mode": mode, "holiday_dates": sorted(holiday_dates),
                    "warnings": [str(exc)], "ot_reservations": {"status": "unresolved", "reason": str(exc)},
                    "history_window": {"start": str(context.history["start"]),
                        "end": str(context.history["end"]), "observed_months": context.history["months"]}}
    mandatory = sum(
        v
        for (s, _), v in variables.items()
        if not rule_for_slot(slots[s], context.rules)
        or rule_for_slot(slots[s], context.rules).is_mandatory
    )
    coverage = sum(variables.values())
    model.add(coverage >= minimum_coverage)
    model.add(mandatory >= minimum_required)
    targets = context_targets(db, context)
    terms = build_objectives(model, variables, candidates, slots, context,
        targets=targets, mandatory=mandatory, coverage=coverage, mode=mode,
        originals=originals, preferences=preferences, weights=weights,
        holiday_dates=holiday_dates, incompatible=incompatible)
    tiers, quality, level_of = terms.tiers, terms.quality, terms.level_of
    # Seed with a validated, scarcity-aware greedy draft. A short search must never
    # replace that draft with an equally covered but needlessly concentrated incumbent.
    seed_context = without_slots(context, [])
    seed = {}
    for sid, slot in sorted(
        slots.items(), key=lambda pair: (pair[1].duty_date, len(candidates[pair[0]]), pair[0])
    ):
        row = slot_candidates_with_context(db, slot=slot, context=seed_context)
        eligible = [
            c
            for c in row["candidates"]
            if c["validation_status"] == "clear"
            and c["candidate_status"] == "eligible"
            and not c["requires_override"]
            and c["person_id"] in candidates[sid]
        ]
        eligible.sort(key=lambda c: (c["person_id"] != originals.get(sid), c["person_id"] != (seed_choices or {}).get(sid)))
        if eligible:
            seed[sid] = eligible[0]["person_id"]
            add_provisional_assignment(seed_context, slot, UUID(seed[sid]))
    while seed:
        failures = validate_plan(db, context, slots, seed)
        if not failures:
            break
        old_size = len(seed)
        for failure in failures:
            seed.pop(failure["slot_id"], None)
        if len(seed) == old_size:
            seed.pop(next(reversed(seed)))
    for (sid, person), variable in variables.items():
        model.add_hint(variable, int(seed.get(sid) == person))

    seed_valid = (
        len(seed) >= minimum_coverage
        and -quality(seed)[0] >= minimum_required
        and not any(seed == previous for previous in forbidden or [])
    )
    seed_valid = seed_valid and all(
        not incompatible(slots[s], slots[t], context.rules)
        for i, (s, p) in enumerate(seed.items())
        for t, q in list(seed.items())[i + 1 :]
        if p == q
    )
    possible = [s for s in slots if candidates[s]]
    bounds = {
        "required_coverage": -sum(
            not rule_for_slot(slots[s], context.rules)
            or rule_for_slot(slots[s], context.rules).is_mandatory
            for s in possible
        ),
        "coverage": -len(possible),
        "changes": sum((s, p) not in variables for s, p in originals.items()),
    }
    full_coverage = seed_valid and len(seed) == len(possible)
    category_bounds = []
    for predicate in [
        lambda s: s.duty_date.weekday() >= 5,
        lambda s: s.is_24hr or s.starts_at.hour >= 18 or s.ends_at.date() > s.starts_at.date(),
        lambda s: str(s.duty_date) in holiday_dates,
        lambda s: True,
    ]:
        lower = 0
        if full_coverage:
            for s in possible:
                if predicate(slots[s]):
                    lower += min(
                        max(
                            1,
                            round(
                                (
                                    2
                                    * (
                                        sum(
                                            predicate(a.duty_slot)
                                            for a in context.assignments_by_person.get(UUID(p), [])
                                        )
                                        + 1
                                    )
                                    - 1
                                )
                                * 100
                                / max(1, len(by_person[p]))
                            ),
                        )
                        for p in candidates[s]
                    )
        category_bounds.append(lower)
    bounds.update(
        zip(["weekend_burden", "night_burden", "holiday_burden", "workload"], category_bounds)
    )
    rank_lower = 0
    pref_lower = 0
    for s in possible:
        ranks = [
            c["score_parts"].get("burden", 0) * weights["burden"]
            + c["score_parts"].get("historical_fairness", 0) * weights["history"]
            + c["score_parts"].get("rest", 0) * weights["spacing"]
            for c in candidates[s].values()
        ]
        if full_coverage:
            rank_lower += min(ranks)
        costs = [preferences.get(f"{s}:{p}", 0) for p in candidates[s]]
        pref_lower += min(costs if full_coverage else [0, *costs])
    bounds["spacing_history"] = rank_lower
    # Equality tier lower bound: with every possible slot covered, each duty costs at least
    # the cheapest candidate's first-duty increment (increments only grow with n).
    equality_lower = None
    if full_coverage:
        equality_lower = 0
        for s in possible:
            increments = []
            for p in candidates[s]:
                target = targets.get(level_of.get(p))
                if target is None:
                    target = context.average_assignments
                base = len(context.assignments_by_person.get(UUID(p), []))
                increments.append(round((2 * (base + 1) - 1 - 2 * target) * 100))
            equality_lower += min(increments)
    bounds["call_level_equality"] = equality_lower
    bounds["preferences"] = pref_lower
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 17
    choices, objectives = (dict(seed) if seed_valid else {}), []
    all_optimal = True
    cuts = 0
    last_status = None
    # Final-state staffing can depend on several assignments together. Validator-guided
    # no-good cuts retain exact semantics instead of approximating those rules silently.
    for tier_index, (name, expression) in enumerate(tiers):
        # A validated incumbent attaining an independent lower bound proves this
        # tier optimal. This avoids searching interchangeable-member permutations.
        incumbent_valid = seed_valid or bool(choices)
        if incumbent_valid and quality(choices)[tier_index] == bounds[name]:
            value = bounds[name]
            objectives.append(
                {"name": name, "value": value, "proven": True, "proof": "independent_lower_bound"}
            )
            model.add(expression == value)
            continue
        tier_proven = False
        tier_found = False
        remaining = max(0, deadline - perf_counter())
        tier_deadline = min(deadline, perf_counter() + remaining / max(1, len(tiers) - tier_index))
        while perf_counter() < tier_deadline:
            solver.parameters.max_time_in_seconds = max(0.01, tier_deadline - perf_counter())
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
            tier_found = True
            value = solver.value(expression) if not isinstance(expression, int) else expression
            tier_proven = status == cp_model.OPTIMAL
            objectives.append({"name": name, "value": value, "proven": tier_proven})
            model.add(expression == value)
            break
        if not tier_proven:
            all_optimal = False
        if not tier_found:
            break
    baseline_retained = seed_valid and (
        (not choices and bool(seed)) or quality(seed) < quality(choices)
    )
    if baseline_retained:
        choices = seed
        all_optimal = False
        objectives = [
            {"name": name, "value": value, "proven": False}
            for (name, _), value in zip(tiers, quality(choices))
        ]
    recorded = {o["name"] for o in objectives}
    objectives.extend(
        {"name": name, "value": value, "proven": False}
        for (name, _), value in zip(tiers, quality(choices))
        if name not in recorded
    )
    failures = validate_plan(db, context, slots, choices)
    if failures:
        raise RuntimeError("Optimizer returned an invalid proposal")
    return {
        "choices": choices,
        **({"ot_reservations": {"status": "modeled", **joint_reservations}} if joint_reservations is not None else {}),
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
        "objective_basis": describe_objectives(mode, targets),
        "cuts": cuts,
        "baseline_retained": baseline_retained,
        "quality": quality(choices),
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
