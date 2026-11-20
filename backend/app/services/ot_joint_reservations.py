"""Couple existing planner duty variables to the canonical OT reservation graph.

The planner owns duty eligibility, duty/duty conflicts and objective order. This
adapter adds affected OT/reserve minima and forbids reserving someone during a
selected duty/rest/elective interval. Final independent validation is still required.
No database access, assignment mutation, policy exceptions or objective changes.
"""

from collections import defaultdict
from uuid import UUID

from app.services.ot_availability import duty_windows, merge_intervals
from app.services.ot_capacity import CapacityResourceLimit, add_reservation_variables, overlaps
from app.services.ot_guard_scope import reservation_components
from app.services.rota_safety import ACTIVE_ASSIGNMENT_STATUSES


def add_joint_reservations(model, guard, assignments, slots, choices, rules):
    """Add constraints to a caller-owned model; discard the model if this raises.

    choices maps (slot key, person UUID/string) to existing Boolean duty variables.
    assignments is the complete preserved duty set after authorized replacements.
    Scope matches affected-component validation: unrelated saved deficits cannot
    veto every edit, while all competing requirements in touched components stay.
    """
    if guard.unresolved or not guard.reviewed_complete:
        raise CapacityResourceLimit("Joint OT context has not been reviewed completely")
    if len(slots) > 4096 or len(choices) > 200000:
        raise CapacityResourceLimit("Joint duty/OT model exceeds supported dimensions")
    spans = {key: duty_windows(slots[key], rules) for key in {key for key, _ in choices}}
    if guard.horizon_start is not None and any(
            span.starts_at < guard.horizon_start or span.ends_at > guard.horizon_end
            for windows in spans.values() for span in windows):
        raise CapacityResourceLimit("Proposed duty/rest exceeds the reviewed joint OT horizon")
    groups, potentials = reservation_components(guard.requirements, guard.reserves, guard.people)
    demands = (*guard.requirements, *guard.reserves)
    by_person = defaultdict(set)
    for index, identities in enumerate(potentials):
        for person_id in identities:
            by_person[person_id].add(index)
    touched, work = set(), 0
    normalized = []
    for (key, person_id), variable in choices.items():
        person_id = UUID(str(person_id))
        normalized.append((key, person_id, variable))
        work += len(by_person[person_id])
        if work > 10000000:
            raise CapacityResourceLimit("Joint OT scope work exceeds supported dimensions")
        touched.update(index for index in by_person[person_id]
                       if any(overlaps(span, demands[index]) for span in spans[key]))
    selected = {index for group in groups if touched.intersection(group) for index in group}
    if not selected:
        return {"components": 0, "requirements": 0, "reserve_segments": 0, "couplings": 0}

    identities = {person.id for person in guard.people}
    blocks = defaultdict(list)
    for assignment in assignments:
        if assignment.person_id in identities and assignment.status.lower() in ACTIVE_ASSIGNMENT_STATUSES:
            blocks[assignment.person_id].extend(duty_windows(assignment.duty_slot, rules))
    people = tuple(person.model_copy(update={"blocked": merge_intervals(
        (*person.blocked, *blocks[person.id]))}) for person in guard.people)
    if any(len(person.blocked) > 256 for person in people):
        raise CapacityResourceLimit("Joint OT fixed duty intervals exceed supported dimensions")
    requirements = tuple(demands[i] for i in sorted(selected) if i < len(guard.requirements))
    reserves = tuple(demands[i] for i in sorted(selected) if i >= len(guard.requirements))
    boundaries = {instant for windows in spans.values() for span in windows
                  for instant in (span.starts_at, span.ends_at)}
    graph = add_reservation_variables(model, requirements, people, reserves=reserves, boundaries=boundaries)
    entries = defaultdict(list)
    counts = defaultdict(list)
    reserve_counts = defaultdict(list)
    for (index, person_id), variable in graph["choices"].items():
        entries[person_id].append((graph["requirements"][index], variable))
        counts[index].append(variable)
    for index, requirement in enumerate(graph["requirements"]):
        model.add(sum(counts[index]) >= requirement.minimum)
    for (index, person_id), variable in graph["reserve_choices"].items():
        entries[person_id].append((graph["segments"][index][1], variable))
        reserve_counts[index].append(variable)
    for index, (_, reserve) in enumerate(graph["segments"]):
        model.add(sum(reserve_counts[index]) >= reserve.minimum)

    couplings = 0
    for key, person_id, duty_variable in normalized:
        work += len(entries[person_id])
        if work > 10000000:
            raise CapacityResourceLimit("Joint duty/reservation coupling exceeds supported dimensions")
        for requirement, reservation_variable in entries[person_id]:
            if any(overlaps(span, requirement) for span in spans[key]):
                model.add(duty_variable + reservation_variable <= 1)
                couplings += 1
    return {"components": sum(bool(touched.intersection(group)) for group in groups),
            "requirements": len(requirements), "reserve_segments": len(graph["segments"]),
            "couplings": couplings}
