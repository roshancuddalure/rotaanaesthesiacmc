"""Exact minimum squared total counts under the diagnostic night-gap bounds.

Only a necessary-condition bound. Omitting clinical interactions cannot certify
a safe rota; a proven cost bound can rule out preserving a higher objective.
"""
from collections import Counter
from time import perf_counter

from ortools.graph.python import min_cost_flow


def analyze(rows, counts, *, count_bounds, gap=2, seconds=20,
            prefer_original=False, witness=None):
    assert gap >= 0 and seconds > 0 and counts
    assert Counter(row['original'] for row in rows) == Counter(counts)
    assert set(counts) == set(count_bounds)
    assert all(0 <= lower <= counts[p] <= upper for p, (lower, upper) in count_bounds.items())
    assert all(row['original'] in row['allowed'] and set(row['allowed']) <= set(counts) for row in rows)
    allowed = [[row['original']] if row.get('fixed') else sorted(set(row['allowed']), key=str)
               for row in rows]
    people = sorted(counts, key=str)
    nodes = {p: 2 + len(rows) + 3 * i for i, p in enumerate(people)}
    super_source = 2 + len(rows) + 3 * len(people)
    super_sink = super_source + 1
    maximum_low = min(upper for lower, upper in count_bounds.values())
    started = perf_counter()
    attempts, best, best_counts, best_nights = [], None, None, None
    best_changes, best_holders = None, None
    scale = len(rows) + 1 if prefer_original else 1
    complete = True
    for low in range(maximum_low + 1):
        if perf_counter()-started >= seconds:
            complete = False
            break
        flow = min_cost_flow.SimpleMinCostFlow()
        balance = Counter()
        arcs = []

        def edge(source, target, lower, upper, cost=0):
            assert 0 <= lower <= upper
            balance[source] -= lower
            balance[target] += lower
            return flow.add_arc_with_capacity_and_unit_cost(source, target, upper-lower, cost)

        for i, row in enumerate(rows):
            duty = 2 + i
            edge(0, duty, 1, 1)
            for p in allowed[i]:
                arc = edge(duty, nodes[p]+int(not row['night']), 0, 1,
                           int(p != row['original']) if prefer_original else 0)
                arcs.append((i, p, arc))
        baseline_cost = 0
        for p in people:
            lower, upper = count_bounds[p]
            node = nodes[p]
            edge(node, node+2, low, min(upper, low+gap))
            edge(node+1, node+2, 0, upper)
            edge(node+2, 1, lower, lower)
            baseline_cost += lower*lower
            # Convex count^2: the n-th optional unit has marginal cost 2n-1.
            for n in range(lower+1, upper+1):
                edge(node+2, 1, 0, 1, (2*n-1)*scale)
        edge(1, 0, 0, len(rows))
        required = sum(n for n in balance.values() if n > 0)
        for node, amount in balance.items():
            if amount > 0:
                flow.add_arc_with_capacity_and_unit_cost(super_source, node, amount, 0)
            elif amount < 0:
                flow.add_arc_with_capacity_and_unit_cost(node, super_sink, -amount, 0)
        flow.add_arc_with_capacity_and_unit_cost(super_source, super_sink, 0, 0)
        flow.set_node_supply(super_source, required)
        flow.set_node_supply(super_sink, -required)
        status = flow.solve()
        if status == flow.INFEASIBLE:
            attempts.append(dict(minimum_nights=low, feasible=False))
            continue
        if status != flow.OPTIMAL:
            complete = False
            break
        cost = baseline_cost + flow.optimal_cost() // scale
        holders = {i: p for i, p, arc in arcs if flow.flow(arc)}
        actual = Counter(holders.values())
        assert len(holders) == len(rows)
        assert all(lower <= actual[p] <= upper for p, (lower, upper) in count_bounds.items())
        assert all(not row.get('fixed') or holders[i] == row['original'] for i, row in enumerate(rows))
        assert cost == sum(actual[p]**2 for p in people)
        changes = sum(p != rows[i]['original'] for i, p in holders.items())
        assert flow.optimal_cost() == (cost-baseline_cost)*scale + (changes if prefer_original else 0)
        nights = Counter(holders[i] for i, row in enumerate(rows) if row['night'])
        assert max(nights[p] for p in people)-min(nights[p] for p in people) <= gap
        attempts.append(dict(minimum_nights=low, feasible=True, minimum_squared_counts=cost))
        if best is None or (cost, changes if prefer_original else 0) < (best, best_changes if prefer_original else 0):
            best, best_counts, best_nights = cost, sorted(actual[p] for p in people), sorted(nights[p] for p in people)
            best_changes, best_holders = changes, holders
    if witness is not None:
        witness.clear()
        if best_holders is not None:
            witness.update(best_holders)
    original_cost = sum(n*n for n in counts.values())
    return dict(status=('necessary_condition_feasible' if best is not None else
                        'infeasible_in_relaxed_model' if complete else 'unknown'),
                solver_status='EXACT_LOWER_BOUNDED_MIN_COST_FLOW', gap=gap,
                members=len(counts), duties=len(rows), original_squared_counts=original_cost,
                minimum_squared_counts=best, count_cost_proven=complete,
                changed_assignments=best_changes, retention_tie_break=prefer_original,
                retention_cost_proven=complete and prefer_original,
                can_preserve_count_cost=(best <= original_cost if best is not None and (complete or best <= original_cost) else None),
                anonymous_total_counts=best_counts, anonymous_night_counts=best_nights,
                tested_minimum_nights=attempts, solve_seconds=perf_counter()-started,
                solve_limit_seconds=seconds, operational_writes=0,
                clinical_feasibility_proved=False,
                scope='Same call-level rows, structural eligibility, protected/extra holders and declared count bounds. Minimum count-square cost across every possible night band.',
                omitted_constraints=['rest', 'overlap', 'staffing/OT', 'weekends', 'hours', 'other quotas'],
                inference='At fixed covered demand with uniform equal-count targets, count-square and count-deviation objectives differ by a constant. A higher proven minimum rules out preserving that objective within this diagnostic family. A feasible result remains clinically unverified.')
