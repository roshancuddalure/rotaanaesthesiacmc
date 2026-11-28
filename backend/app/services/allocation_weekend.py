"""Bounded count-preserving weekend exchanges through existing transfer checks."""
from collections import Counter


def refine_weekends(state, *, planner=None, max_trials=128, max_inspections=20000,
                    record_moves=True):
    from app.services import balance_duties as bd

    if planner is None:
        planner = bd._Planner(state, max_work=max(bd.MAX_WORK, max_trials*bd.TRANSFER_COST))
    before_counts = dict(state.duties)
    before_extra = dict(state.extra_count)
    trials = swaps = inspections = 0
    stopped = False
    refusals = Counter()

    def profile(row):
        slot = row['slot']
        return (slot.duty_type, (slot.ends_at-slot.starts_at).total_seconds(),
                bool(slot.is_24hr), slot.starts_at.time(), slot.ends_at.time())

    def weekends():
        return Counter(row['person'] for row in state.rows.values()
                       if row['slot'].duty_date.weekday() >= 5)

    before = weekends()
    while trials < max_trials and not planner.exhausted:
        counts = weekends()
        improved = False
        # Spend the bounded clinical search on the worst cohort before further
        # polishing an earlier cohort already within the requested gap of two.
        def priority(level):
            values = [counts[p] for p in state.members_by_level[level]]
            return (-(max(values)-min(values)), bd._level_order(level))
        for level in sorted(state.levels(), key=priority):
            members = state.members_by_level[level]
            donors = sorted(members, key=lambda p: (-counts[p], state.person_key(p)))
            recipients = sorted(members, key=lambda p: (counts[p], state.person_key(p)))
            for donor in donors:
                for recipient in recipients:
                    if counts[donor]-counts[recipient] < 2:
                        continue
                    left = [a for a in state.movable_rows(donor, planner.touched)
                            if not state.rows[a].get('extra')
                            and state.rows[a]['slot'].duty_date.weekday() >= 5]
                    right = [a for a in state.movable_rows(recipient, planner.touched)
                             if not state.rows[a].get('extra')
                             and state.rows[a]['slot'].duty_date.weekday() < 5]
                    for a in left:
                        for b in right:
                            if inspections >= max_inspections or planner.exhausted:
                                stopped = True
                                break
                            inspections += 1
                            if profile(state.rows[a]) != profile(state.rows[b]):
                                continue
                            if any(planner.structural_ok(p, aid) is not None
                                   for aid, p in [(a, recipient), (b, donor)]):
                                continue
                            if trials >= max_trials or planner.exhausted:
                                stopped = True
                                break
                            trials += 1
                            ok, code, placed = planner.transfer([(a, recipient), (b, donor)])
                            if not ok:
                                refusals[code or 'unknown'] += 1
                                continue
                            # No ledgered row participates. Matching duty type,
                            # duration and window profile preserves each person's
                            # hours, flagged24h/night counts and total duty count.
                            assert dict(state.duties) == before_counts
                            assert dict(state.extra_count) == before_extra
                            if record_moves:
                                first = len(planner.moves)
                                planner.record('swap', placed)
                                planner.swaps += 1
                                for move in planner.moves[first:]:
                                    move['reason'] = (
                                        'Exchanged a weekend and weekday duty to share weekends more evenly; '
                                        'individual duty totals, recorded hours and extra-duty credits are unchanged.')
                            else:
                                planner.touched.update(state.rows[aid]['slot'].id for aid, *_ in placed)
                            swaps += 1
                            improved = True
                            break
                        if improved or stopped:
                            break
                    if improved or stopped:
                        break
                if improved or stopped:
                    break
            if improved or stopped:
                break
        if not improved:
            break
    after = weekends()
    groups = []
    for level in state.levels():
        people = state.members_by_level[level]
        def values(counter):
            return [counter[p] for p in people]
        old, new = values(before), values(after)
        groups.append(dict(call_level=level, before_gap=max(old)-min(old),
                           after_gap=max(new)-min(new),
                           before_squares=sum(n*n for n in old), after_squares=sum(n*n for n in new)))
    return dict(status='proposal_refinement' if record_moves else 'offline_study_only', swaps=swaps, trials=trials,
                trial_limit=max_trials, inspections=inspections, inspection_limit=max_inspections,
                limit_reached=(trials >= max_trials or inspections >= max_inspections or planner.exhausted),
                refusals=dict(refusals), levels=groups,
                duty_counts_preserved=dict(state.duties) == before_counts,
                extra_ledger_counts_preserved=dict(state.extra_count) == before_extra,
                clinical_checks='Existing atomic transfer checks; final independent verification still required.',
                limitations='Bounded same-profile ordinary-row swaps; no global optimum, holiday fairness or infeasibility proof. Reviewed Apply and independent final validation are required.')
