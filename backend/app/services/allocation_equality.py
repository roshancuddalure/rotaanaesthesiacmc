"""Exact worst-gap and time-burden terms over the canonical monthly roster.

Members with no candidates still count. Fixed duties count, and no eligibility or
safety constraint is relaxed here. Model terms and incumbent scores use integers.
"""
from collections import Counter, defaultdict
from uuid import UUID
from time import perf_counter

from ortools.sat.python import cp_model
from app.services.allocation_fairness_policy import AVAILABILITY, SCALE, fairness_mode, person_target
from app.services.allocation_covered_targets import CoveredTargets, enabled as covered_enabled


def deviation_scale(context):
    return SCALE if (getattr(context, 'fairness_person_targets', None)
                     and fairness_mode(getattr(context, 'rules', None)) == AVAILABILITY) else 1


def duration_minutes(slot):
    return max(0, round((slot.ends_at - slot.starts_at).total_seconds() / 60))


def equality_terms(model, variables, slots, context, *, include_squared=False):
    members = {str(p): level for p, level in (context.fairness_member_levels or {}).items()}
    rows = defaultdict(list)
    for (sid, person), value in variables.items():
        rows[person].append((sid, value))
    baselines = {p: context.assignments_by_person.get(UUID(p), []) for p in members}
    groups = defaultdict(list)
    scale = deviation_scale(context)
    covered = CoveredTargets(context, slots) if covered_enabled(context) else None
    dynamic_offsets = covered.add_model(model, variables) if covered else {}
    offsets = {p: round(person_target(context, p, 0) * scale) if scale > 1 else 0 for p in members}
    bound = (sum(len(baselines[p])+len(rows[p]) for p in members)*scale
             + max(offsets.values(), default=0))
    if covered:
        bound += covered.maximum * scale
    counts = {}
    hours_costs, extra_costs, squared_costs = [], [], []
    extra_slots = getattr(context, 'optimizer_extra_slots', set())
    for p, level in members.items():
        fixed = baselines[p]
        count = model.new_int_var(len(fixed), len(fixed)+len(rows[p]), f'month_count:{p}')
        model.add(count == len(fixed)+sum(v for _, v in rows[p]))
        counts[p] = count
        deviation = model.new_int_var(-bound, bound, f'deviation:{p}')
        model.add(deviation == count*scale-dynamic_offsets.get(p, offsets[p]))
        groups[level].append(deviation)
        if covered and include_squared:
            square = model.new_int_var(0, bound*bound, f'count_deviation_square:{p}')
            model.add_multiplication_equality(square, [deviation, deviation])
            squared_costs.append(square)
        for name, measure, costs in [
            ('minutes', duration_minutes, hours_costs),
            ('extra', lambda s: int(str(s.id) in extra_slots), extra_costs),
        ]:
            base = (sum(a.source == 'extra_duty_layer' for a in fixed) if name == 'extra'
                    else sum(measure(a.duty_slot) for a in fixed))
            increments = [(measure(slots[s]), v) for s, v in rows[p]]
            upper = base+sum(n for n, _ in increments)
            total = model.new_int_var(base, upper, f'{name}:{p}')
            square = model.new_int_var(base*base, upper*upper, f'{name}_square:{p}')
            model.add(total == base+sum(n*v for n, v in increments))
            model.add_multiplication_equality(square, [total, total])
            costs.append(square-base*base)
    gaps = []
    for level, values in groups.items():
        low = model.new_int_var(-bound, bound, f'minimum:{level}')
        high = model.new_int_var(-bound, bound, f'maximum:{level}')
        model.add_min_equality(low, values)
        model.add_max_equality(high, values)
        gaps.append(high-low)
    maximum = 2*bound
    worst = model.new_int_var(0, maximum, 'worst_call_gap')
    if gaps:
        model.add_max_equality(worst, gaps)
    else:
        model.add(worst == 0)

    def score(choices):
        loads = defaultdict(list)
        minutes_cost = extras_cost = 0
        actual_offsets = covered.scaled(choices) if covered else offsets
        for p, level in members.items():
            chosen = [slots[s] for s, q in choices.items() if q == p]
            loads[level].append((len(baselines[p])+len(chosen))*scale-actual_offsets[p])
            base = sum(duration_minutes(a.duty_slot) for a in baselines[p])
            minutes_cost += (base+sum(duration_minutes(s) for s in chosen))**2-base**2
            base_extra = sum(a.source == 'extra_duty_layer' for a in baselines[p])
            extras_cost += (base_extra+sum(str(s.id) in extra_slots for s in chosen))**2-base_extra**2
        ranges = [max(v)-min(v) for v in loads.values()]
        squared = [sum(n*n for values in loads.values() for n in values)] if covered and include_squared else []
        return [max(ranges, default=0), sum(ranges), *squared, minutes_cost, extras_cost]

    squared = [('call_level_equality', sum(squared_costs))] if covered and include_squared else []
    return [('worst_call_gap', worst), ('call_gap_total', sum(gaps)), *squared,
            ('hours_burden', sum(hours_costs)), ('extra_burden', sum(extra_costs))], score


def probe_gap_limits(model, variables, worst_gap, *, choices, quality, validate, deadline, required,
                     coverage_established=True, gap_scale=1, fairness_policy='equal_counts', gap_check=None,
                     rounding_slack=1):
    """Separate feasibility search at the achieved coverage, before soft-tier fixes.

An infeasible result concerns this fixed layout/candidate model only. A timeout
is unknown. Every positive solver witness passes the independent final checker.
    A safer, better witness may improve the draft; no operational write occurs.
"""
    results = []
    best = dict(choices)
    if gap_scale > 1 and gap_check is None:
        raise ValueError('Scaled fairness probes require exact personal-target validation')
    if not coverage_established:
        return [dict(limit=limit, policy=fairness_policy, status='unknown', reason='required_coverage_not_established')
                for limit in (1, 2)], best
    achieved = quality(choices)[:2]
    for limit in (1, 2):
        if (gap_check(best, limit) if gap_check else quality(best)[2] <= limit*gap_scale):
            results.append(dict(limit=limit, policy=fairness_policy, status='feasible', proof='validated_incumbent',
                                coverage=len(choices)))
            continue
        if perf_counter() >= deadline:
            results.append(dict(limit=limit, policy=fairness_policy, status='unknown', reason='time_budget_exhausted'))
            continue
        trial_model = model.clone()
        # Include the rounding boundary, then independently reject witnesses
        # outside the exact target. A scaled objective cannot certify an exact gap.
        trial_model.add(worst_gap <= limit*gap_scale + (rounding_slack if gap_scale > 1 else 0))
        # The first two scores are negative required and total coverage. Keeping
        # both prevents a smaller gap being obtained by silently dropping duties.
        trial_model.add(sum(variables.values()) == -achieved[1])
        trial_model.add(required == -achieved[0])
        solver = cp_model.CpSolver()
        solver.parameters.num_search_workers = 1
        solver.parameters.random_seed = 17
        status = 'unknown'
        cuts = 0
        tier_deadline = min(deadline, perf_counter()+max(0, deadline-perf_counter())/(3-limit))
        while perf_counter() < tier_deadline:
            solver.parameters.max_time_in_seconds = max(.001, tier_deadline-perf_counter())
            solved = solver.solve(trial_model)
            if solved == cp_model.INFEASIBLE:
                status = 'infeasible_in_candidate_model'
                break
            if solved == cp_model.MODEL_INVALID:
                raise RuntimeError('Equality feasibility model is invalid')
            if solved not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                break
            witness = {s: p for (s, p), v in variables.items() if solver.value(v)}
            if (gap_check is None or gap_check(witness, limit)) and not validate(witness):
                status = 'feasible'
                if quality(witness) < quality(best) or (quality(witness) == quality(best)
                        and gap_check is not None and not gap_check(best, limit)):
                    best = witness
                break
            selected = [variables[s, p] for s, p in witness.items()]
            if not selected:
                break
            trial_model.add(sum(selected) <= len(selected)-1)
            cuts += 1
        results.append(dict(limit=limit, policy=fairness_policy, status=status, coverage=len(choices), validation_cuts=cuts,
                            scope='Fixed units, dated candidates, protected duties and achieved coverage; not all possible unit layouts.'))
    return results, best


def explain_count_outliers(context, choices, candidates, rejected):
    """Concrete initial-context restrictions; never label them a necessity proof."""
    groups = defaultdict(list)
    blocked = defaultdict(Counter)
    for rows in rejected.values():
        for row in rows:
            for issue in row['issues']:
                blocked[row['person_id']][issue['code']] += 1
    for pid, level in (context.fairness_member_levels or {}).items():
        person = str(pid)
        fixed = len(context.assignments_by_person.get(UUID(person), []))
        count = fixed+sum(p == person for p in choices.values())
        groups[level].append(dict(person_id=person, duties=count, fixed_duties=fixed,
            person_name=(context.people[UUID(person)].canonical_name if UUID(person) in context.people else person),
            clear_candidate_duties=sum(person in pool for pool in candidates.values()),
            initial_candidate_restrictions=dict(blocked[person])))
    result = []
    for level, rows in sorted(groups.items()):
        low, high = min(r['duties'] for r in rows), max(r['duties'] for r in rows)
        if high-low > 2:
            result.append(dict(call_level=level, minimum=low, maximum=high, gap=high-low,
                outliers=[r for r in rows if r['duties'] in {low, high}],
                basis='Actual fixed duties and rejected/clear candidates in the initial context. Restrictions may interact; these counts do not prove the gap unavoidable.'))
    return result
