"""Compose continuous ordinary draft changes into one original-to-final change."""
from copy import deepcopy


def compose(base_moves, later_moves):
    """Collapse continuous draft chains while retaining the real original holder.

    Extra-duty rows are deliberately outside this refinement. A caller must still
    validate the final combined rota and prove protected rows were not changed.
    """
    order, by_assignment, changed = [], {}, set()
    for move in base_moves:
        aid = move['assignment_id']
        if aid in by_assignment:
            raise ValueError('Base plan already contains duplicate assignments')
        order.append(aid)
        by_assignment[aid] = deepcopy(move)
    for move in later_moves:
        if move.get('extra_duty') or move.get('record_id') is not None:
            raise ValueError('Night study cannot compose ledger-bearing rows')
        aid = move['assignment_id']
        if aid in by_assignment:
            original = by_assignment[aid]
            if original.get('extra_duty') or original.get('record_id') is not None:
                raise ValueError('Night study cannot revisit ledger-bearing rows')
            if (original['slot_id'] != move['slot_id']
                    or original['to_person_id'] != move['from_person_id']
                    or original['to_unit_id'] != move['from_unit_id']):
                raise ValueError('Draft changes are not a continuous assignment chain')
            for key in ('to_person_id', 'to_person', 'to_unit_id', 'to_unit'):
                original[key] = move[key]
        else:
            order.append(aid)
            by_assignment[aid] = deepcopy(move)
        changed.add(aid)
    result = []
    changed_slots = {by_assignment[aid]['slot_id'] for aid in changed}
    for aid in order:
        move = by_assignment[aid]
        if (move['from_person_id'], move['from_unit_id']) == (move['to_person_id'], move['to_unit_id']):
            continue
        # A partner may have been removed or recomposed. Do not advertise the
        # original pair as a surviving atomic swap; Apply's batch is still atomic.
        if aid in changed or changed_slots.intersection(move.get('swap_with', ())):
            move.update(kind='move', swap_with=[], swap_duty_date=None, swap_duty_label=None,
                        reason='Night-duty refinement: original holder to final holder; duty counts, weekends and extra credits are preserved.')
        move['cross_unit'] = move['from_unit_id'] != move['to_unit_id']
        result.append(move)
    assert len(result) == len({move['assignment_id'] for move in result})
    return result
