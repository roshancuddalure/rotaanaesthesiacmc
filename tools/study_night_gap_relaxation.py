"""Necessary-condition night-gap proof; never a clinical schedule or Apply plan.

An infeasible result rules out only count-preserving reallocations within the
selected current call-level rows and protected holders. A feasible result is
not safe: rest, overlap, staffing, hours and other quotas are intentionally
absent from this diagnostic relaxation, never from operational allocation.
"""
from collections import Counter
from time import perf_counter

from ortools.graph.python import max_flow


def analyze(rows, counts, *, gap=2, seconds=20, count_bounds=None):
    assert gap >= 0 and seconds > 0 and counts
    assert all(isinstance(n, int) and n >= 0 for n in counts.values())
    people = set(counts)
    assert sum(counts.values()) == len(rows)
    assert Counter(row['original'] for row in rows) == Counter(counts)
    bounds = count_bounds or {p: (n, n) for p, n in counts.items()}
    assert set(bounds) == people
    assert all(0 <= lower <= counts[p] <= upper for p, (lower, upper) in bounds.items())
    for row in rows:
        assert row['original'] in row['allowed'] and set(row['allowed']) <= people
    started = perf_counter()
    ordered = sorted(people, key=str)
    person_node = {p: 2 + len(rows) + 3 * i for i, p in enumerate(ordered)}
    super_source = 2 + len(rows) + 3 * len(people)
    super_sink = super_source + 1
    allowed = [[row['original']] if row.get('fixed') else sorted(set(row['allowed']), key=str)
               for row in rows]
    outcome, witness, attempts = 'infeasible_in_relaxed_model', None, []
    # If night gap <= G, some integer L <= min(total duties) bounds every
    # person's nights in [L,L+G]. Enumerate every possible L exactly.
    highest_minimum = min(upper for lower, upper in bounds.values())
    for low in range(highest_minimum + 1):
        if perf_counter() - started >= seconds:
            outcome = 'unknown'
            break
        flow = max_flow.SimpleMaxFlow()
        balance = Counter()
        arcs = []

        def edge(source, target, lower, upper):
            assert 0 <= lower <= upper
            balance[source] -= lower
            balance[target] += lower
            return flow.add_arc_with_capacity(source, target, upper - lower)

        # Lower-bounded circulation: source->duty=1; choose one eligible
        # person/day-or-night node; night quota; person's exact total; return.
        for i, row in enumerate(rows):
            duty = 2 + i
            edge(0, duty, 1, 1)
            for person in allowed[i]:
                branch = person_node[person] + int(not row['night'])
                arc = edge(duty, branch, 0, 1)
                arcs.append((i, person, arc))
        for person, (lower, upper) in bounds.items():
            node = person_node[person]
            edge(node, node + 2, low, min(upper, low + gap))
            edge(node + 1, node + 2, 0, upper)
            edge(node + 2, 1, lower, upper)
        edge(1, 0, 0, len(rows))
        required = sum(n for n in balance.values() if n > 0)
        for node, amount in balance.items():
            if amount > 0:
                flow.add_arc_with_capacity(super_source, node, amount)
            elif amount < 0:
                flow.add_arc_with_capacity(node, super_sink, -amount)
        # Ensure both supernodes exist even for a zero-duty roster.
        flow.add_arc_with_capacity(super_source, super_sink, 0)
        status = flow.solve(super_source, super_sink)
        if status != flow.OPTIMAL:
            outcome = 'unknown'
            break
        possible = flow.optimal_flow() == required
        attempts.append(dict(minimum_nights=low, required_flow=required,
                             maximum_flow=flow.optimal_flow(), feasible=possible))
        if possible:
            holders = {i: person for i, person, arc in arcs if flow.flow(arc)}
            actual = Counter(holders.values())
            assert len(holders) == len(rows)
            assert all(lower <= actual[p] <= upper for p, (lower, upper) in bounds.items())
            assert all(not row.get('fixed') or holders[i] == row['original'] for i, row in enumerate(rows))
            nights = Counter(holders[i] for i, row in enumerate(rows) if row['night'])
            witness = [nights[p] for p in ordered]
            assert max(witness) - min(witness) <= gap
            outcome = 'necessary_condition_feasible'
            break
    result = dict(status=outcome, solver_status='EXACT_LOWER_BOUNDED_MAX_FLOW', gap=gap,
                  members=len(counts), duties=len(rows), candidate_edges=sum(map(len, allowed)),
                  fixed_rows=sum(bool(row.get('fixed')) for row in rows),
                  solve_seconds=perf_counter()-started, solve_limit_seconds=seconds,
                  tested_minimum_nights=attempts, all_minima_exhausted=(
                      outcome == 'infeasible_in_relaxed_model' and len(attempts) == highest_minimum + 1),
                  operational_writes=0, clinical_feasibility_proved=False,
                  scope=('Same current call-level duty rows; protected and extra holders fixed; '
                         + ('bounded variable person totals.' if count_bounds is not None else 'exact current person totals.')),
                  total_count_bounds=sorted([list(pair) for pair in bounds.values()]),
                  omitted_constraints=['rest', 'overlap', 'staffing/OT', 'weekends', 'hours', 'other individual quotas'],
                  inference='INFEASIBLE rules out only the declared row/eligibility/count-bound/protected-holder family, even before omitted safety constraints. FEASIBLE is not a clinical proposal or safety certificate.')
    if witness is not None:
        result['anonymous_night_counts'] = sorted(witness)
        result['night_gap'] = max(witness)-min(witness)
        totals = [actual[p] for p in ordered]
        result['anonymous_total_counts'] = sorted(totals)
        result['total_gap'] = max(totals)-min(totals)
    return result


def study(state, *, level='3RD_CALL', gap=2, seconds=20, flexible_counts=False,
          minimize_count_cost=False):
    people = set(state.members_by_level.get(level, []))
    rows = []
    for row in state.rows.values():
        if row['person'] not in people:
            continue
        slot = row['slot']
        fixed = not row['movable'] or bool(row.get('extra'))
        allowed = [row['person']] if fixed else [p for p in people if state.structural_block(p, slot) is None]
        rows.append(dict(original=row['person'], allowed=allowed, fixed=fixed,
                         night=bool(slot.is_24hr or slot.starts_at.hour >= 18
                                    or slot.ends_at.date() > slot.starts_at.date())))
    counts = {p: state.duties.get(p, 0) for p in people}
    bounds = None
    if flexible_counts:
        from app.services.allocation_fairness_policy import fairness_mode
        assert fairness_mode(state.rules) == 'equal_counts'
        lowest, highest = min(counts.values()), max(counts.values())
        assert highest-lowest <= 2
        # Keep the current raw count band and the existing saved personal-target
        # tolerance, rather than silently widening either fairness condition.
        bounds = {p: (max(lowest, state.goal[p]-state.gap, 0),
                      min(highest, state.goal[p]+state.gap)) for p in people}
    if minimize_count_cost:
        assert flexible_counts and len({state.share[p] for p in people}) == 1
        import hashlib
        from pathlib import Path
        import study_night_count_cost
        result = study_night_count_cost.analyze(rows, counts, gap=gap, seconds=seconds, count_bounds=bounds)
        result['minimum_cost_implementation_sha256'] = hashlib.sha256(
            Path(study_night_count_cost.__file__).read_bytes()).hexdigest()
    else:
        result = analyze(rows, counts, gap=gap, seconds=seconds, count_bounds=bounds)
    result['call_level'] = level
    result['eligibility_basis'] = 'Existing dated posting, call/group, unit and active-leave structural checks; no new membership or exception.'
    return result
