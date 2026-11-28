"""Bounded joint temporal/burden refinement, followed by canonical placement.

Existing required duty rows and the normal reviewed Apply path remain authoritative.
Unit choices, quotas and staffing remain subject to canonical final
checks. Rejected full witnesses receive no-goods, never a safety override.
"""
from collections import Counter, defaultdict
from itertools import combinations
from math import gcd
from time import perf_counter

from ortools.sat.python import cp_model

from app.services.allocation_fairness_policy import fairness_mode
from app.services.rota_optimizer import incompatible
from app.services import allocation_joint_night_checks as clinical
from app.services.allocation_flow_count_bound import analyze as relaxed_count_bound


def conflict_cliques(edges):
    """Exact edge cover: every output clique contains only original conflicts."""
    remaining = {tuple(sorted(edge)) for edge in edges}
    adjacent = defaultdict(set)
    for a, b in remaining:
        assert a != b
        adjacent[a].add(b)
        adjacent[b].add(a)
    result = []
    while remaining:
        a, b = min(remaining)
        clique = [a, b]
        common = adjacent[a] & adjacent[b]
        while common:
            node = min(common)
            clique.append(node)
            common &= adjacent[node]
        remaining.difference_update(combinations(sorted(clique), 2))
        result.append(tuple(clique))
    return result


def common_floor(total, members, gap):
    """Necessary integer bounds when fixed total loads all lie in [L,L+gap]."""
    return max(0, (total+members-1)//members-gap), total//members


def admissible_night_floors(rows, counts, bounds, cost_cap, seconds=5):
    low, high = common_floor(sum(r['night'] for r in rows), len(counts), 2)
    possible = set(range(low, high+1))
    result = relaxed_count_bound(rows, counts, count_bounds=bounds, seconds=seconds)
    excluded = []
    for item in result['tested_minimum_nights']:
        floor = item['minimum_nights']
        if floor in possible and (not item['feasible'] or item['minimum_squared_counts'] > cost_cap):
            possible.remove(floor)
            excluded.append(dict(floor=floor, relaxation_feasible=item['feasible'],
                                 minimum_count_cost=item.get('minimum_squared_counts')))
    return sorted(possible), excluded


def build(state, people, before, max_changed=64, exact_relaxation=False):
    aids = sorted((aid for aid, row in state.rows.items() if row['person'] in people),
                  key=lambda aid: (state.rows[aid]['slot'].starts_at,
                                   state.rows[aid]['slot'].duty_type, str(aid)))
    rows = [state.rows[aid] for aid in aids]
    replaced = {(row['slot'].id, row['person']) for row in rows}
    external = {p: [e for e in state.ctx.entries_by_person.get(p, [])
                    if (e.slot_id, p) not in replaced] for p in people}
    counts = {p: state.duties.get(p, 0) for p in sorted(people, key=str)}
    low, high = min(counts.values()), max(counts.values())
    assert high-low <= 2
    bounds = {p: (max(low, state.goal[p]-state.gap, 0), min(high, state.goal[p]+state.gap)) for p in people}
    durations = [round((r['slot'].ends_at-r['slot'].starts_at).total_seconds()/60) for r in rows]
    quantum = gcd(*durations)
    assert quantum > 0 and min(durations) > 0
    units = [n//quantum for n in durations]
    model = cp_model.CpModel()
    variables, by_person, by_row = {}, defaultdict(list), defaultdict(list)
    fixed_edges = 0
    for i, row in enumerate(rows):
        candidates = ([row['person']] if not row['movable'] or row.get('extra') else
                      sorted((p for p in people if state.structural_block(p, row['slot']) is None), key=str))
        admitted = []
        for p in candidates:
            if any(incompatible(row['slot'], e, state.rules) for e in external[p]):
                fixed_edges += 1
                continue
            v = model.new_bool_var(f'row:{i}:person:{p}')
            variables[i, p] = v
            by_person[p].append((i, v))
            by_row[i].append(p)
            admitted.append(v)
            model.add_hint(v, int(p == row['person']))
        model.add(sum(admitted) == 1)
    pair_cache = {}
    temporal_pairs = 0
    clique_count = 0
    for options in by_person.values():
        conflicts = set()
        by_index = dict(options)
        for offset, (i, v) in enumerate(options):
            for j, other in options[offset+1:]:
                key = (min(i, j), max(i, j))
                if key not in pair_cache:
                    pair_cache[key] = incompatible(rows[i]['slot'], rows[j]['slot'], state.rules)
                if pair_cache[key]:
                    conflicts.add(key)
                    temporal_pairs += 1
        for clique in conflict_cliques(conflicts):
            model.add_at_most_one(by_index[i] for i in clique)
            clique_count += 1
    ceiling = max(upper for lower, upper in bounds.values())
    nights_total = sum(r['slot'].is_24hr or r['slot'].starts_at.hour >= 18
                       or r['slot'].ends_at.date() > r['slot'].starts_at.date() for r in rows)
    weekends_total = sum(r['slot'].duty_date.weekday() >= 5 for r in rows)
    night_low = model.new_int_var(*common_floor(nights_total, len(people), 2), 'night_floor')
    excluded_floors = []
    if all(row['person'] in by_row[i] for i, row in enumerate(rows)):
        relaxed_rows = [dict(original=r['person'], allowed=by_row[i],
            fixed=not r['movable'] or bool(r.get('extra')),
            night=bool(r['slot'].is_24hr or r['slot'].starts_at.hour >= 18
                       or r['slot'].ends_at.date() > r['slot'].starts_at.date())) for i, r in enumerate(rows)]
        floors, excluded_floors = admissible_night_floors(relaxed_rows, counts, bounds, before['duties']['squares'],
            seconds=float('inf') if exact_relaxation else 5)
        model.add_allowed_assignments([night_low], [[floor] for floor in floors])
    weekend_low = model.new_int_var(*common_floor(weekends_total, len(people), before['weekend']['gap']), 'weekend_floor')
    max_units = ceiling * max(units)
    assert max_units <= 10000, 'Diagnostic hour lattice too large'
    hour_low = model.new_int_var(*common_floor(sum(units), len(people), before['minutes']['gap']//quantum), 'hour_floor')
    count_squares, hour_squares, weekend_squares = [], [], []
    for p in sorted(people, key=str):
        options = by_person[p]
        lower, upper = bounds[p]
        total = model.new_int_var(lower, upper, f'count:{p}')
        model.add(total == sum(v for i, v in options))
        model.add_hint(total, counts[p])
        square = model.new_int_var(lower*lower, upper*upper, f'count_square:{p}')
        model.add_element(total, [n*n for n in range(upper+1)], square)
        count_squares.append(square)
        model.add_hint(square, counts[p]**2)
        nights = sum(v for i, v in options if rows[i]['slot'].is_24hr
                     or rows[i]['slot'].starts_at.hour >= 18
                     or rows[i]['slot'].ends_at.date() > rows[i]['slot'].starts_at.date())
        model.add(nights >= night_low)
        model.add(nights <= night_low+2)
        weekend = model.new_int_var(0, upper, f'weekend:{p}')
        model.add(weekend == sum(v for i, v in options if rows[i]['slot'].duty_date.weekday() >= 5))
        model.add(weekend >= weekend_low)
        model.add(weekend <= weekend_low+before['weekend']['gap'])
        ws = model.new_int_var(0, upper*upper, f'weekend_square:{p}')
        model.add_element(weekend, [n*n for n in range(upper+1)], ws)
        weekend_squares.append(ws)
        old_weekends = sum(r['person'] == p and r['slot'].duty_date.weekday() >= 5 for r in rows)
        model.add_hint(weekend, old_weekends)
        model.add_hint(ws, old_weekends**2)
        hours = model.new_int_var(0, max_units, f'hour_units:{p}')
        model.add(hours == sum(units[i]*v for i, v in options))
        model.add(hours >= hour_low)
        model.add(hours <= hour_low+before['minutes']['gap']//quantum)
        hs = model.new_int_var(0, max_units*max_units, f'hour_square:{p}')
        model.add_element(hours, [n*n for n in range(max_units+1)], hs)
        hour_squares.append(hs)
        old_units = sum(units[i] for i, r in enumerate(rows) if r['person'] == p)
        model.add_hint(hours, old_units)
        model.add_hint(hs, old_units**2)
    model.add(sum(count_squares) <= before['duties']['squares'])
    model.add(sum(weekend_squares) <= before['weekend']['squares'])
    model.add(sum(hour_squares) <= before['minutes']['squares']//(quantum*quantum))
    changes = sum(v for (i, p), v in variables.items() if p != rows[i]['person'])
    model.add(changes <= max_changed)
    model.minimize(sum(count_squares)*(len(rows)+1)+changes)
    return model, variables, aids, dict(candidate_edges=len(variables),
        temporal_conflict_pairs=temporal_pairs, temporal_clique_constraints=clique_count,
        relaxed_count_excluded_floors=excluded_floors,
        fixed_temporal_edges_removed=fixed_edges,
        hour_quantum_minutes=quantum, count_bounds=sorted([list(x) for x in bounds.values()]))


def study(state, *, level='3RD_CALL', max_seconds=45, max_candidates=8, max_changed=64,
          deterministic_units=40, planner=None):
    assert fairness_mode(state.rules) == 'equal_counts'
    people = set(state.members_by_level.get(level, []))
    assert people and len({state.share[p] for p in people}) == 1
    original, credits = clinical.snapshot(state), dict(state.extra_count)
    before = clinical.measures(state, people)
    started = perf_counter()
    observations, refused = [], Counter()
    deterministic_spent = 0.0
    accepted, changed, stop = False, 0, 'candidate_limit'
    if max_candidates <= 0 or max_seconds <= 0 or before['night']['gap'] <= 2:
        return dict(status='joint_night_refinement', accepted=False, stop='not_needed_or_budget',
                    before=before, after=before, candidates=0, operational_writes=0)
    model, variables, aids, stats = build(state, people, before, max_changed=max_changed,
        exact_relaxation=deterministic_units is not None)
    model_seconds = perf_counter()-started
    model_error = model.validate()
    assert not model_error, model_error
    for index in range(max_candidates):
        remaining = max_seconds-(perf_counter()-started)
        if remaining <= 0 and deterministic_units is None:
            stop = 'observation_budget'
            break
        if deterministic_units is not None and deterministic_spent >= deterministic_units:
            stop = 'deterministic_budget'
            break
        solver = cp_model.CpSolver()
        solver.parameters.num_search_workers = 1
        solver.parameters.random_seed = 0
        solver.parameters.stop_after_first_solution = True
        solver.parameters.repair_hint = True
        solver.parameters.hint_conflict_limit = 10000
        if deterministic_units is not None:
            assert deterministic_units > 0
            solver.parameters.max_deterministic_time = deterministic_units - deterministic_spent
        else:
            solver.parameters.max_time_in_seconds = remaining
        status = solver.solve(model)
        deterministic_spent += solver.response_proto.deterministic_time
        row = dict(candidate=index+1, solver_status=solver.status_name(status),
                   solver_stats=solver.response_stats())
        observations.append(row)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            stop = 'no_witness_in_current_model' if status == cp_model.INFEASIBLE else 'solver_unknown'
            break
        holders = {i: p for (i, p), v in variables.items() if solver.value(v)}
        assert len(holders) == len(aids)
        proposed = clinical.measures(state, people, holders, aids)
        row.update(count_cost=proposed['duties']['squares'],
                   changes=sum(holders[i] != original[aid][0] for i, aid in enumerate(aids)))
        assert clinical.temporal_cut(state, aids,
            [dict(original=original[aid][0]) for aid in aids], holders) is None
        ok, code, placed = clinical.place_witness(state, people, aids, holders, original,
                                                credits, before, max_changed, planner=planner)
        if ok:
            accepted, changed, stop = True, len(placed), 'canonical_placement_and_all_holders_passed'
            break
        row['canonical_refusal'] = code
        refused[code or 'unknown'] += 1
        model.add(sum(variables[i, p] for i, p in holders.items()) <= len(aids)-1)
    if not accepted:
        assert clinical.snapshot(state) == original and dict(state.extra_count) == credits
    return dict(status='joint_night_refinement', accepted=accepted, changed_rows=changed,
                before=before, after=clinical.measures(state, people), stop=stop,
                candidates=len(observations), candidate_limit=max_candidates, observations=observations,
                elapsed_seconds=perf_counter()-started, model_seconds=model_seconds,
                observation_limit_seconds=max_seconds, model=stats, refusals=dict(refused),
                deterministic_work_units=deterministic_units,
                deterministic_work_used=deterministic_spent,
                operational_writes=0, final_independent_validation_required=True,
                limitations='Model includes temporal/count/hour/weekend bounds; unit choice, quotas and staffing are canonical final checks. No-goods and time limits restrict evidence. No Apply token or production architecture activation.')



def refine_joint_nights(state, *, planner, deterministic_units=40):
    """Bounded equal-count fallback; only accepted effects join the reviewed plan."""
    from app.services.allocation_net_moves import compose
    from app.services import balance_duties as bd
    if fairness_mode(state.rules) != 'equal_counts' or planner.exhausted:
        return dict(status='not_run', reason='policy_or_existing_work_budget', levels=[])
    remaining = deterministic_units
    results = []
    for level in sorted(state.levels(), key=bd._level_order):
        people = set(state.members_by_level[level])
        before = clinical.measures(state, people)
        if before['night']['gap'] <= 2:
            continue
        if (len(people) > 100 or before['duties']['gap'] > 2
                or len({state.share[p] for p in people}) != 1):
            results.append(dict(call_level=level, accepted=False, stop='unsupported_group_bounds'))
            continue
        group_rows = [r for r in state.rows.values() if r['person'] in people]
        durations = [round((r['slot'].ends_at-r['slot'].starts_at).total_seconds()/60) for r in group_rows]
        quantum = gcd(*durations) if durations else 0
        if (len(group_rows) > 800 or quantum <= 0 or min(durations) <= 0
                or max(state.duties.get(p, 0) for p in people)*max(durations)//quantum > 10000):
            results.append(dict(call_level=level, accepted=False, stop='model_resource_bounds'))
            continue
        if remaining <= 0 or planner.exhausted or planner.work+bd.TRANSFER_COST > planner.max_work:
            results.append(dict(call_level=level, accepted=False, stop='work_budget'))
            break
        original = clinical.snapshot(state)
        base_moves = list(planner.moves)
        result = study(state, level=level, deterministic_units=remaining, max_candidates=4,
                       max_changed=64, planner=planner)
        remaining -= result.get('deterministic_work_used', 0)
        result['call_level'] = level
        if result['accepted']:
            placed = [(aid, person, unit, state.rows[aid]['person'],
                       state.slot_unit[state.rows[aid]['slot'].id])
                      for aid, (person, unit) in original.items()
                      if (state.rows[aid]['person'], state.slot_unit[state.rows[aid]['slot'].id]) != (person, unit)]
            planner.record('move', sorted(placed, key=lambda item: str(item[0])))
            planner.moves = compose(base_moves, planner.moves[len(base_moves):])
            changed = {str(aid) for aid, *_ in placed}
            for move in planner.moves:
                if move['assignment_id'] in changed:
                    move['reason'] = ('Joint night refinement: original to final holder. '
                        'Individual totals may change; call-level duty equality, hours, '
                        'weekend balance and extra-duty credits do not worsen. '
                        'Dated eligibility, leave, rest, staffing and quotas are checked.')
        else:
            assert clinical.snapshot(state) == original
        results.append(result)
    return dict(status='proposal_refinement', levels=results,
                accepted_levels=sum(bool(r.get('accepted')) for r in results),
                changed_rows=sum(r.get('changed_rows', 0) for r in results),
                deterministic_work_limit=deterministic_units,
                deterministic_work_used=deterministic_units-remaining,
                individual_counts_preserved=False,
                extra_credits_preserved=True,
                limitations='Bounded solver plus canonical checks, not a global optimum or infeasibility proof.')


def replay_joint_nights(state, *, planner, reviewed_plan):
    """Revalidate a server-stored witness without repeating the long solver search.

    The caller must bind this server-owned plan to its original context/token.
    No client-supplied move list is accepted by the public Balance API.
    """
    from copy import deepcopy
    from uuid import UUID
    from app.models import DutyAssignment
    from app.services.allocation_net_moves import compose
    summary = deepcopy(reviewed_plan['summary']['joint_night_refinement'])
    # A net-zero composition is absent from final moves: its final holder is
    # the actual saved original, which may differ from this intermediate draft.
    targets = {}
    for aid in state.rows:
        assignment = state.db.get(DutyAssignment, aid)
        if assignment is None:
            raise ValueError('Reviewed assignment disappeared')
        targets[aid] = (assignment.person_id, assignment.duty_slot.unit_id)
    targets.update({UUID(m['assignment_id']): (UUID(m['to_person_id']),
                    UUID(m['to_unit_id']) if m['to_unit_id'] else None) for m in reviewed_plan['moves']})
    for result in summary['levels']:
        if not result.get('accepted'):
            continue
        people = set(state.members_by_level.get(result['call_level'], []))
        before = clinical.measures(state, people)
        if before != result['before']:
            raise ValueError('Reviewed joint baseline changed')
        original, credits = clinical.snapshot(state), dict(state.extra_count)
        aids = sorted((aid for aid, r in state.rows.items() if r['person'] in people), key=str)
        holders = {i: targets.get(aid, original[aid])[0] for i, aid in enumerate(aids)}
        if any(p not in people for p in holders.values()):
            raise ValueError('Reviewed witness leaves its call-level group')
        base_moves = list(planner.moves)
        ok, code, placed = clinical.place_witness(state, people, aids, holders, original, credits,
                                                before, 64, planner=planner)
        if not ok:
            raise ValueError('Reviewed witness failed current canonical checks: ' + str(code))
        if (clinical.measures(state, people) != result['after']
                or any((state.rows[aid]['person'], state.slot_unit[state.rows[aid]['slot'].id]) != targets[aid]
                       for aid in aids if aid in targets)):
            # This hypothetical state must never reach an operational write.
            current = clinical.snapshot(state)
            planner._raw([(aid, person, unit) for aid, (person, unit) in original.items()
                          if current[aid] != (person, unit)])
            state.invalidate_safety(state.slots)
            raise ValueError('Reviewed witness final result changed')
        planner.record('move', sorted(placed, key=lambda item: str(item[0])))
        planner.moves = compose(base_moves, planner.moves[len(base_moves):])
        changed = {str(aid) for aid, *_ in placed}
        for move in planner.moves:
            if move['assignment_id'] in changed:
                move['reason'] = ('Joint night refinement: checked original-to-final placement; '
                                  'individual totals may change without worsening higher fairness bounds.')
    summary['reviewed_witness_revalidated'] = True
    return summary
