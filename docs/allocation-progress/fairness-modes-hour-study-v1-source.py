"""Offline fixed-count hour exchanges; no persistence or server Apply token."""
from collections import Counter
from uuid import UUID


def study(state, official_moves, max_trials=128, max_inspections=20000):
    from app.services import balance_duties as bd

    planner = bd._Planner(state, max(bd.MAX_WORK, max_trials * bd.TRANSFER_COST))
    planner.touched.update(UUID(move['slot_id']) for move in official_moves)
    before_counts, before_extra = dict(state.duties), dict(state.extra_count)

    def hours():
        result = Counter()
        for row in state.rows.values():
            result[row['person']] += int((row['slot'].ends_at-row['slot'].starts_at).total_seconds())
        return result

    def weekends():
        return Counter(row['person'] for row in state.rows.values() if row['slot'].duty_date.weekday() >= 5)

    before_hours, before_weekends = hours(), weekends()
    trials = inspections = swaps = 0
    refusals = Counter()
    stopped = False
    while trials < max_trials and not planner.exhausted:
        totals = hours()
        improved = False
        def priority(level):
            values = [totals[p] for p in state.members_by_level[level]]
            return (-(max(values)-min(values)), bd._level_order(level))
        for level in sorted(state.levels(), key=priority):
            members = state.members_by_level[level]
            donors = sorted(members, key=lambda p: (-totals[p], state.person_key(p)))
            recipients = sorted(members, key=lambda p: (totals[p], state.person_key(p)))
            for donor in donors:
                for recipient in recipients:
                    if donor == recipient or totals[donor] <= totals[recipient]:
                        continue
                    left = [a for a in state.movable_rows(donor, planner.touched) if not state.rows[a]['extra']]
                    right = [a for a in state.movable_rows(recipient, planner.touched) if not state.rows[a]['extra']]
                    for first in left:
                        for second in right:
                            if inspections >= max_inspections:
                                stopped = True
                                break
                            inspections += 1
                            a, b = state.rows[first]['slot'], state.rows[second]['slot']
                            delta = int(((a.ends_at-a.starts_at)-(b.ends_at-b.starts_at)).total_seconds())
                            if not 0 < delta < totals[donor]-totals[recipient]:
                                continue
                            if (a.duty_date.weekday() >= 5) != (b.duty_date.weekday() >= 5):
                                continue
                            if planner.structural_ok(recipient, first) or planner.structural_ok(donor, second):
                                continue
                            trials += 1
                            ok, code, placed = planner.transfer([(first, recipient), (second, donor)])
                            if not ok:
                                refusals[code or 'no_safe_swap'] += 1
                                if trials >= max_trials or planner.exhausted:
                                    stopped = True
                                    break
                                continue
                            planner.touched.update(state.rows[aid]['slot'].id for aid, *_ in placed)
                            swaps += 1
                            improved = True
                            assert dict(state.duties) == before_counts
                            assert dict(state.extra_count) == before_extra
                            assert weekends() == before_weekends
                            assert sum(v*v for v in hours().values()) < sum(v*v for v in totals.values())
                            break
                        if improved or stopped:
                            break
                    if improved or stopped:
                        break
                if improved or stopped:
                    break
            if improved or stopped:
                break
        if not improved or stopped:
            break
    after = hours()
    return {'status': 'offline_study_only', 'swaps': swaps, 'trials': trials,
            'trial_limit': max_trials, 'inspections': inspections, 'inspection_limit': max_inspections,
            'limit_reached': stopped or trials >= max_trials or planner.exhausted,
            'refusals': dict(refusals), 'duty_counts_preserved': dict(state.duties) == before_counts,
            'extra_credits_preserved': dict(state.extra_count) == before_extra,
            'weekends_preserved': weekends() == before_weekends,
            'levels': [{'call_level': level,
                        'before_hour_gap': (max(before_hours[p] for p in people)-min(before_hours[p] for p in people))/3600,
                        'after_hour_gap': (max(after[p] for p in people)-min(after[p] for p in people))/3600}
                       for level in state.levels() for people in [state.members_by_level[level]]]}
