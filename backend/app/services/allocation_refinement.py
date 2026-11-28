"""Bounded incumbent repair; every accepted change passes the complete safety checker.

This is a local improvement, never a proof of infeasibility or global fairness.
Coverage and the caller's complete lexicographic quality order are preserved.
"""
from collections import Counter, defaultdict
from time import perf_counter
from uuid import UUID
from app.services.allocation_fairness_policy import AVAILABILITY, fairness_mode, person_target
from app.services.allocation_covered_targets import exact_targets


def refine_incumbent(choices, candidates, slots, context, *, quality, validate,
                     incompatible, deadline, forbidden=(), max_checks=96):
    current = dict(choices)
    initial_quality = quality(current)
    current_quality = initial_quality
    checks = moves = fills = 0
    forbidden = tuple(forbidden or ())
    exhausted = False
    while perf_counter() < deadline and checks < max_checks:
        counts = Counter(current.values())
        counts.update({str(p): len(rows) for p, rows in context.assignments_by_person.items()})
        rows_by_person = defaultdict(list)
        for sid, person in current.items():
            rows_by_person[person].append(sid)
        improved = False
        # First recover holes, including a single displaced duty. No duty is dropped.
        for sid in sorted(set(slots) - set(current), key=lambda s: (len(candidates[s]), s)):
            for person in sorted(candidates[sid], key=lambda p: (counts[p], p)):
                conflicts = [s for s in rows_by_person[person]
                             if incompatible(slots[sid], slots[s], context.rules)]
                if len(conflicts) > 1:
                    continue
                trials = []
                if not conflicts:
                    trials.append({**current, sid: person})
                else:
                    other = conflicts[0]
                    for replacement in sorted(candidates[other], key=lambda p: (counts[p], p)):
                        if replacement == person or any(
                            incompatible(slots[other], slots[s], context.rules)
                            for s in rows_by_person[replacement] if s != other
                        ):
                            continue
                        trials.append({**current, sid: person, other: replacement})
                for trial in trials:
                    if perf_counter() >= deadline or checks >= max_checks:
                        exhausted = True
                        break
                    score = quality(trial)
                    if score >= current_quality or trial in forbidden:
                        continue
                    checks += 1
                    if validate(trial):
                        continue
                    current, current_quality = trial, score
                    fills += 1
                    improved = True
                    break
                if improved or exhausted:
                    break
            if improved or exhausted:
                break
        if improved:
            continue
        # A transfer is considered only when it reduces the same monthly squared
        # equality cost used by CP-SAT. Dated eligibility comes from candidates.
        targets = context.fairness_targets or {}
        levels = context.fairness_member_levels or {}
        personal = exact_targets(context, current, slots)
        def deviation(person):
            level = levels.get(UUID(person), levels.get(person))
            return counts[person] - personal.get(person, person_target(context, person, targets.get(level, context.average_assignments)))
        for sid, donor in sorted(current.items(), key=lambda row: (-deviation(row[1]), row[0])):
            recipients = sorted(candidates[sid], key=lambda p: (deviation(p), p))
            for recipient in recipients:
                if donor == recipient or deviation(donor) - deviation(recipient) <= 1 + 1e-9:
                    continue
                if perf_counter() >= deadline or checks >= max_checks:
                    exhausted = True
                    break
                if any(incompatible(slots[sid], slots[s], context.rules)
                       for s in rows_by_person[recipient] if s != sid):
                    continue
                trial = {**current, sid: recipient}
                score = quality(trial)
                if score >= current_quality or trial in forbidden:
                    continue
                checks += 1
                if validate(trial):
                    continue
                current, current_quality = trial, score
                moves += 1
                improved = True
                break
            if improved or exhausted:
                break
        if not improved:
            break
    return current, {
        'checks': checks, 'transfers': moves, 'additional_covered': fills,
        'improved': current_quality < initial_quality,
        'limit_reached': exhausted or checks >= max_checks or perf_counter() >= deadline,
        'global_optimum_proven': False,
    }


def fairness_summary(context, choices, slots=None):
    counts = Counter(choices.values())
    counts.update({str(p): len(rows) for p, rows in context.assignments_by_person.items()})
    by_level = defaultdict(list)
    adjusted = defaultdict(list)
    personal = exact_targets(context, choices, slots) if slots is not None else {}
    for person, level in (context.fairness_member_levels or {}).items():
        by_level[level].append(counts[str(person)])
        adjusted[level].append(counts[str(person)]-personal.get(str(person), person_target(context, person, 0)))
    return [dict(call_level=level, members=len(loads), minimum=min(loads), maximum=max(loads),
                 gap=max(loads)-min(loads), within_one=max(loads)-min(loads) <= 1,
                 within_two=max(loads)-min(loads) <= 2,
                 adjusted_gap=max(adjusted[level])-min(adjusted[level]),
                 policy=fairness_mode(getattr(context, 'rules', None)),
                 policy_within_two=(max(adjusted[level])-min(adjusted[level]) <= 2+1e-9
                     if fairness_mode(getattr(context, 'rules', None)) == AVAILABILITY
                     else max(loads)-min(loads) <= 2),
                 basis='Raw monthly duties including fixed duties; partial availability can explain a larger gap.')
            for level, loads in sorted(by_level.items()) if loads]
