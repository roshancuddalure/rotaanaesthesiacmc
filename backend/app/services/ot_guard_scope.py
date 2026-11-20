"""Conservative temporal/person components for affected reservation proofs."""

from app.services.ot_capacity import CapacityResourceLimit, eligible, overlaps


def reservation_components(requirements, reserves, people):
    demands = (*requirements, *reserves)
    if len(demands) * len(people) > 2000000:
        raise CapacityResourceLimit("OT scope eligibility exceeds supported dimensions")
    potentials = []
    for index, demand in enumerate(demands):
        if not demand.minimum:
            potentials.append(frozenset())
            continue
        if index < len(requirements):
            potentials.append(frozenset(person.id for person in people if eligible(person, demand)))
        else:
            # Reserve predicates may hand over. Whole-band eligibility would miss
            # a person needed for only one subinterval. Ignore leave here to form
            # a conservative superset; the exact checker applies all blocks.
            potentials.append(frozenset(person.id for person in people if (
                any(window.unit_id == demand.unit_id and window.call_level in demand.call_levels
                    and set(demand.required_skills).issubset(window.skills) and overlaps(window, demand)
                    for window in person.windows) if person.windowed else
                demand.unit_id in person.unit_ids and person.call_level in demand.call_levels
                and set(demand.required_skills).issubset(person.skills)
                and any(overlaps(window, demand) for window in person.available))))
    parent = list(range(len(demands)))

    def root(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    active, work = [], 0
    for index in sorted(range(len(demands)), key=lambda i: demands[i].starts_at):
        active = [other for other in active if demands[other].ends_at > demands[index].starts_at]
        work += len(active)
        if work > 2000000:
            raise CapacityResourceLimit("OT scope overlap work exceeds supported dimensions")
        for other in active:
            if potentials[index].intersection(potentials[other]):
                parent[root(index)] = root(other)
        active.append(index)
    groups = {}
    for index in range(len(demands)):
        groups.setdefault(root(index), []).append(index)
    return tuple(tuple(group) for group in groups.values()), tuple(potentials)
