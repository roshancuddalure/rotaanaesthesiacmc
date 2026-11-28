"""Canonical checks and restoration for hypothetical joint night refinements."""
from collections import Counter, defaultdict
from app.services import balance_duties as bd
from app.services.rota_optimizer import incompatible

def snapshot(state):
    return {aid: (row['person'], state.slot_unit[row['slot'].id]) for aid, row in state.rows.items()}

def measures(state, people, holders=None, aids=None):
    values = {p: Counter() for p in people}
    chosen = {aid: holders[i] for i, aid in enumerate(aids)} if holders is not None else {}
    for aid, row in state.rows.items():
        p = chosen.get(aid, row['person'])
        if p not in values:
            continue
        slot = row['slot']
        values[p].update(duties=1, minutes=round((slot.ends_at-slot.starts_at).total_seconds()/60),
                         night=int(slot.is_24hr or slot.starts_at.hour >= 18 or slot.ends_at.date() > slot.starts_at.date()),
                         weekend=int(slot.duty_date.weekday() >= 5))
    return {key: dict(gap=max(v[key] for v in values.values())-min(v[key] for v in values.values()),
                      squares=sum(v[key]**2 for v in values.values()))
            for key in ('duties', 'minutes', 'night', 'weekend')}

def temporal_cut(state, aids, rows, holders):
    by_person = defaultdict(list)
    # Earlier draft moves use provisional entries with assignment_id=None.
    # The unique person/slot identity still identifies each replaced baseline row.
    selected = {(state.rows[aid]['slot'].id, state.rows[aid]['person']) for aid in aids}
    for p, entries in state.ctx.entries_by_person.items():
        for entry in entries:
            if (entry.slot_id, p) not in selected:
                by_person[p].append((None, entry))
    for i, aid in enumerate(aids):
        by_person[holders[i]].append((i, state.rows[aid]['slot']))
    for p in sorted(by_person, key=str):
        duties = by_person[p]
        for offset, (i, first) in enumerate(duties):
            for j, second in duties[offset+1:]:
                changed = [k for k in (i, j) if k is not None and holders[k] != rows[k]['original']]
                if changed and incompatible(first, second, state.rules):
                    return max(changed), p
    return None

def audit_holders(state):
    for aid, row in list(state.rows.items()):
        person, unit = row['person'], state.slot_unit[row['slot'].id]
        state.remove(aid)
        try:
            actual_unit, code = state.place_check(person, row['slot'], allow_unposted=bool(row.get('extra')))
        finally:
            state.add(aid, person, unit)
        if actual_unit != unit or code is not None:
            return code or 'unit_mismatch'
    return None

def place_witness(state, people, aids, holders, original, credits, before, max_changed, planner=None):
    """One hypothetical atomic trial; normal refusal and final-check errors restore."""
    changed = [i for i in holders if holders[i] != original[aids[i]][0]]
    if not changed or len(changed) > max_changed:
        return False, 'changed_row_bound', []
    if any(not state.rows[aids[i]]['movable'] or state.rows[aids[i]].get('extra') for i in changed):
        return False, 'protected_holder', []
    proposed = measures(state, people, holders, aids)
    if (proposed['duties']['gap'] > before['duties']['gap']
            or proposed['duties']['squares'] > before['duties']['squares']
            or proposed['night']['gap'] > 2
            or any(proposed[k][m] > before[k][m] for k in ('minutes', 'weekend') for m in ('gap', 'squares'))):
        return False, 'burden_bound', []
    immutable = {aid for aid, row in state.rows.items() if row['person'] not in people
                 or not row['movable'] or row.get('extra')}
    planner = planner if planner is not None else bd._Planner(state, bd.MAX_WORK)
    if planner.exhausted or planner.work+bd.TRANSFER_COST > planner.max_work:
        return False, 'work_budget', []
    pairs = sorted(((aids[i], holders[i]) for i in changed),
                   key=lambda pair: (state.rows[pair[0]]['slot'].starts_at, str(pair[0])))
    ok, code, placed = planner.transfer(pairs)
    if not ok:
        assert snapshot(state) == original and dict(state.extra_count) == credits
        return False, code, []

    def restore():
        current = snapshot(state)
        planner._raw([(aid, person, unit) for aid, (person, unit) in original.items()
                      if current[aid] != (person, unit)])
        state.invalidate_safety(state.slots)
        assert snapshot(state) == original and dict(state.extra_count) == credits

    try:
        current = snapshot(state)
        code = ('protected_or_outside_level_changed' if any(current[a] != original[a] for a in immutable)
                else audit_holders(state))
        if not code and dict(state.extra_count) != credits:
            code = 'extra_credit_changed'
    except Exception:
        restore()
        raise
    if code:
        restore()
        return False, code, []
    return True, None, placed
