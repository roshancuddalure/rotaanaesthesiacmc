"""Bounded night exchanges preserving duty counts, weekends, credits and hours quality."""
from collections import Counter


def _refine(state, *, planner, max_trials=256, max_inspections=20000):
    from app.services import balance_duties as bd
    target_extremes = True
    shared_planner = True
    counts, credits = dict(state.duties), dict(state.extra_count)

    def night(slot):
        return int(slot.is_24hr or slot.starts_at.hour >= 18 or slot.ends_at.date() > slot.starts_at.date())

    def measures():
        hours, nights, weekends = Counter(), Counter(), Counter()
        for row in state.rows.values():
            slot, person = row['slot'], row['person']
            hours[person] += int((slot.ends_at-slot.starts_at).total_seconds())
            nights[person] += night(slot)
            weekends[person] += int(slot.duty_date.weekday() >= 5)
        return hours, nights, weekends

    before_hours, before_nights, before_weekends = measures()
    trials = inspections = swaps = 0
    refused = Counter()
    while trials < max_trials and inspections < max_inspections and not planner.exhausted:
        hours, nights, _ = measures()
        movable = {person: [aid for aid in state.movable_rows(person, planner.touched)
                            if not state.rows[aid]['extra']]
                   for members in state.members_by_level.values() for person in members}
        improved = False
        for level in sorted(state.levels(), key=lambda level: (
                -(max(nights[p] for p in state.members_by_level[level])
                  -min(nights[p] for p in state.members_by_level[level])), bd._level_order(level))):
            members = state.members_by_level[level]
            highest, lowest = max(nights[p] for p in members), min(nights[p] for p in members)
            if target_extremes and highest-lowest <= 2:
                continue
            for donor in sorted(members, key=lambda p: (-nights[p], state.person_key(p))):
                if target_extremes and nights[donor] != highest:
                    continue
                for recipient in sorted(members, key=lambda p: (nights[p], state.person_key(p))):
                    if target_extremes and nights[recipient] != lowest:
                        continue
                    if nights[donor]-nights[recipient] < 2:
                        continue
                    for first in movable[donor]:
                        a = state.rows[first]['slot']
                        if not night(a):
                            continue
                        for second in movable[recipient]:
                            if inspections >= max_inspections or trials >= max_trials or planner.exhausted:
                                break
                            inspections += 1
                            b = state.rows[second]['slot']
                            if night(b) or (a.duty_date.weekday() >= 5) != (b.duty_date.weekday() >= 5):
                                continue
                            delta = int(((a.ends_at-a.starts_at)-(b.ends_at-b.starts_at)).total_seconds())
                            if ((hours[donor]-delta)**2+(hours[recipient]+delta)**2
                                    > hours[donor]**2+hours[recipient]**2):
                                continue
                            proposed = [hours[p] for p in members if p not in (donor, recipient)]
                            proposed += [hours[donor]-delta, hours[recipient]+delta]
                            if max(proposed)-min(proposed) > max(hours[p] for p in members)-min(hours[p] for p in members):
                                continue
                            if planner.structural_ok(recipient, first) or planner.structural_ok(donor, second):
                                continue
                            if planner.work + bd.TRANSFER_COST > planner.max_work:
                                planner.exhausted = True
                                break
                            trials += 1
                            ok, code, placed = planner.transfer([(first, recipient), (second, donor)])
                            if not ok:
                                refused[code or 'no_safe_swap'] += 1
                                continue
                            if shared_planner:
                                first_move = len(planner.moves)
                                planner.record('swap', placed)
                                planner.swaps += 1
                                for move in planner.moves[first_move:]:
                                    move['reason'] = ('Exchange night and daytime duties to reduce the night-duty gap; '
                                                      'individual counts, weekends and extra credits preserved; '
                                                      'recorded hours inequality does not increase.')
                            else:
                                planner.touched.update(state.rows[aid]['slot'].id for aid, *_ in placed)
                            swaps += 1
                            improved = True
                            after_hours, after_nights, after_weekends = measures()
                            assert dict(state.duties) == counts and dict(state.extra_count) == credits
                            assert after_weekends == before_weekends
                            assert sum(v*v for v in after_nights.values()) < sum(v*v for v in nights.values())
                            assert sum(v*v for v in after_hours.values()) <= sum(v*v for v in hours.values())
                            break
                        if improved:
                            break
                    if improved:
                        break
                if improved:
                    break
            if improved:
                break
        if not improved:
            break
    hours, nights, weekends = measures()
    return {'status': 'proposal_refinement', 'allows_revisiting_base_plan_rows': not shared_planner,
            'shares_existing_work_budget': shared_planner,
            'target_extremes_only': target_extremes,
            'swaps': swaps, 'trials': trials, 'trial_limit': max_trials,
            'inspections': inspections, 'inspection_limit': max_inspections,
            'refusals': dict(refused), 'duty_counts_preserved': dict(state.duties) == counts,
            'extra_credits_preserved': dict(state.extra_count) == credits,
            'weekends_preserved': weekends == before_weekends,
            'limit_reached': trials >= max_trials or inspections >= max_inspections or planner.exhausted,
            'levels': [{'call_level': level,
                        'before_night_gap': max(before_nights[p] for p in people)-min(before_nights[p] for p in people),
                        'after_night_gap': max(nights[p] for p in people)-min(nights[p] for p in people),
                        'before_hour_gap': (max(before_hours[p] for p in people)-min(before_hours[p] for p in people))/3600,
                        'after_hour_gap': (max(hours[p] for p in people)-min(hours[p] for p in people))/3600}
                       for level, people in state.members_by_level.items()]}


def refine_nights(state, *, planner, max_trials=256, max_inspections=20000):
    """Allow revisiting ordinary draft rows, then compose unique original-to-final moves.

    The same planner retains work counters, clinical validators and staffing context.
    Its existing touched set is restored after this stage. Extra rows never move here.
    """
    from app.services.allocation_net_moves import compose
    base_moves = list(planner.moves)
    previous_touched = planner.touched
    planner.touched = set()
    try:
        result = _refine(state, planner=planner, max_trials=max_trials, max_inspections=max_inspections)
        later = planner.moves[len(base_moves):]
        planner.moves = compose(base_moves, later)
        result['composed_assignments'] = len({m['assignment_id'] for m in later})
        result['unique_final_moves'] = len(planner.moves)
        result['allows_revisiting_base_plan_rows'] = True
        return result
    finally:
        planner.touched.update(previous_touched)
