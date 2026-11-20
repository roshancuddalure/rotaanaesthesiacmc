"""Identity-level OT reservation feasibility, independent of database writes.

One person must cover an entire configured band; adjacent/overlapping availability
intervals may be joined. Simultaneous roles cannot reserve the same person twice,
even across units or pooled call levels. Duty/rest/leave derivation belongs to the
shared scheduling context; pass its exact blocked intervals here.
"""

from datetime import datetime
from math import isfinite
from typing import Literal
from uuid import UUID

from ortools.sat.python import cp_model
from pydantic import Field, model_validator

from app.services.ot_calendar import CallLevel, ImmutableInput


class CapacityResourceLimit(ValueError):
    """Bounded work could not establish feasibility; never a staffing proof."""


class TimeInterval(ImmutableInput):
    starts_at: datetime
    ends_at: datetime

    @model_validator(mode="after")
    def validate_interval(self):
        if self.starts_at.tzinfo or self.ends_at.tzinfo or self.ends_at <= self.starts_at:
            raise ValueError("Availability must use increasing hospital-local wall times")
        return self


class CapacityWindow(TimeInterval):
    """Exact dated posting/call/qualification context for an availability interval."""

    unit_id: UUID
    call_level: CallLevel
    skills: tuple[str, ...] = Field(default=(), max_length=64)


class CapacityPerson(ImmutableInput):
    id: UUID
    unit_ids: tuple[UUID, ...] = Field(min_length=1, max_length=64)
    call_level: CallLevel
    skills: tuple[str, ...] = Field(default=(), max_length=64)
    available: tuple[TimeInterval, ...] = Field(default=(), max_length=256)
    blocked: tuple[TimeInterval, ...] = Field(default=(), max_length=256)
    windowed: bool = False
    windows: tuple[CapacityWindow, ...] = Field(default=(), max_length=4096)

    @model_validator(mode="after")
    def distinct_keys(self):
        if len(set(self.unit_ids)) != len(self.unit_ids) or len(set(self.skills)) != len(self.skills):
            raise ValueError("A person's units and skills must be distinct")
        return self


class CapacityReserve(TimeInterval):
    """A minimum-count predicate; same-unit overlapping predicates may share staff."""

    id: str = Field(min_length=1, max_length=255)
    unit_id: UUID
    call_levels: tuple[CallLevel, ...] = Field(min_length=1, max_length=6)
    minimum: int = Field(ge=0, le=2147483647)
    mode: Literal["included", "additional"]
    required_skills: tuple[str, ...] = ()

    @model_validator(mode="after")
    def distinct_pool(self):
        if len(set(self.call_levels)) != len(self.call_levels):
            raise ValueError("Reserve call levels must be distinct")
        return self


def overlaps(a, b):
    return a.starts_at < b.ends_at and b.starts_at < a.ends_at


def covers(intervals, requirement):
    cursor = requirement.starts_at
    for interval in sorted(intervals, key=lambda value: value.starts_at):
        if interval.starts_at > cursor:
            return False
        cursor = max(cursor, interval.ends_at)
        if cursor >= requirement.ends_at:
            return True
    return False


def eligible(person, requirement):
    if person.windowed:
        windows = [window for window in person.windows
                   if window.unit_id == requirement.unit_id
                   and window.call_level in requirement.call_levels
                   and set(requirement.required_skills).issubset(window.skills)]
        return covers(windows, requirement) and not any(overlaps(block, requirement) for block in person.blocked)
    return (
        requirement.unit_id in person.unit_ids
        and person.call_level in requirement.call_levels
        and set(requirement.required_skills).issubset(person.skills)
        and covers(person.available, requirement)
        and not any(overlaps(block, requirement) for block in person.blocked)
    )


def reserve_segments(reserves, requirements, people, *, boundaries=()):
    """Minimum counts may hand over when availability changes; OT roles stay whole."""
    if not reserves:
        return []
    beginning, ending = min(r.starts_at for r in reserves), max(r.ends_at for r in reserves)
    events = {r.starts_at for r in (*requirements, *reserves)} | {r.ends_at for r in (*requirements, *reserves)}
    events.update(instant for instant in boundaries if beginning < instant < ending)
    for person in people:
        for span in (*person.available, *person.blocked, *person.windows):
            if beginning < span.starts_at < ending:
                events.add(span.starts_at)
            if beginning < span.ends_at < ending:
                events.add(span.ends_at)
    events = sorted(events)
    segments = []
    for index, reserve in enumerate(reserves):
        points = [instant for instant in events if reserve.starts_at <= instant <= reserve.ends_at]
        for start, end in zip(points, points[1:]):
            segments.append((index, reserve.model_copy(update={"starts_at": start, "ends_at": end})))
            if len(segments) > 16384:
                raise CapacityResourceLimit("OT reserve interval count exceeds supported dimensions")
    return segments


def add_reservation_variables(model, requirements, people, *, reserves=(), boundaries=()):
    """Add the canonical reservation graph to an existing CP-SAT model.

    The caller chooses its objective and whether minima must be fully satisfied.
    Optional duty boundaries allow reserve handover at actual planned-duty edges;
    OT bands still require one person for their complete interval.
    """
    if len(requirements) > 4096 or len(reserves) > 1024 or len(people) > 2048 \
            or (len(requirements) + len(reserves)) * len(people) > 2000000:
        raise CapacityResourceLimit("OT capacity input exceeds supported dimensions")
    if len({row.id for row in requirements}) != len(requirements):
        raise ValueError("OT requirement identifiers must be distinct")
    if len({person.id for person in people}) != len(people):
        raise ValueError("A person may appear only once, including across units")
    if len({row.id for row in reserves}) != len(reserves):
        raise ValueError("OT reserve identifiers must be distinct")
    ordered = sorted(requirements, key=lambda row: row.id)
    reserves = sorted(reserves, key=lambda row: row.id)
    people = sorted(people, key=lambda person: str(person.id))
    boundaries = tuple(boundaries)
    if len(boundaries) > 8192:
        raise CapacityResourceLimit("OT planned-duty boundary count exceeds supported dimensions")
    segments = reserve_segments(reserves, ordered, people, boundaries=boundaries)
    choices, reserve_choices, eligibility_cache, entries_by_person = {}, {}, {}, {}
    credits = []

    def compatible(person, requirement):
        key = (person.id, requirement.unit_id, requirement.starts_at, requirement.ends_at,
               tuple(sorted(requirement.call_levels)), tuple(sorted(requirement.required_skills)))
        if key not in eligibility_cache:
            if len(eligibility_cache) >= 2000000:
                raise CapacityResourceLimit("OT eligibility work exceeds supported dimensions")
            eligibility_cache[key] = eligible(person, requirement)
        return eligibility_cache[key]

    for index, requirement in enumerate(ordered):
        variables = []
        for person in people:
            if requirement.target and compatible(person, requirement):
                var = model.new_bool_var(f"ot_{index}_{person.id}")
                choices[index, person.id] = var
                variables.append(var)
                entries_by_person.setdefault(person.id, []).append((requirement, var, False))
        count = sum(variables)
        model.add(count <= requirement.target)
        credit = model.new_int_var(0, requirement.minimum, f"minimum_{index}")
        model.add_min_equality(credit, [count, requirement.minimum])
        credits.append(credit)

    for index, (_, reserve) in enumerate(segments):
        variables = []
        for person in people:
            if reserve.minimum and compatible(person, reserve):
                var = model.new_bool_var(f"reserve_{index}_{person.id}")
                reserve_choices[index, person.id] = var
                variables.append(var)
                entries_by_person.setdefault(person.id, []).append((reserve, var, True))
        count = sum(variables)
        model.add(count <= reserve.minimum)
        credits.append(count)
    if len(choices) + len(reserve_choices) > 200000:
        raise CapacityResourceLimit("OT reservation edge count exceeds supported dimensions")

    # At each person's relevant interval start, OT roles are exclusive. Reserve
    # predicates may share a same-unit person, but can never share across units.
    # An additional reserve is disjoint from OT even within the same unit.
    work = 0
    for person in people:
        entries = entries_by_person.get(person.id, [])
        for instant in sorted({row.starts_at for row, _, _ in entries}):
            work += len(entries)
            if work > 10000000:
                raise CapacityResourceLimit("OT simultaneous-reservation work exceeds supported dimensions")
            active = [(row, var, reserve) for row, var, reserve in entries if row.starts_at <= instant < row.ends_at]
            ot = [var for _, var, reserve in active if not reserve]
            if len(ot) > 1:
                model.add(sum(ot) <= 1)
            units = {}
            for row, var, reserve in active:
                units.setdefault(row.unit_id, []).append((row, var, reserve))
            presence = []
            for unit_entries in units.values():
                variables = [var for _, var, _ in unit_entries]
                if len(units) > 1:
                    present = model.new_bool_var(f"unit_{len(model.proto.variables)}")
                    model.add_max_equality(present, variables)
                    presence.append(present)
                additional = [var for row, var, reserve in unit_entries if reserve and row.mode == "additional"]
                occupied = [var for _, var, reserve in unit_entries if not reserve]
                if additional and occupied:
                    spare = model.new_bool_var(f"spare_{len(model.proto.variables)}")
                    model.add_max_equality(spare, additional)
                    model.add(spare + sum(occupied) <= 1)
            if presence:
                model.add(sum(presence) <= 1)

    return {"requirements": ordered, "reserves": reserves, "people": people,
            "segments": segments, "choices": choices, "reserve_choices": reserve_choices,
            "credits": credits}


def evaluate_capacity(requirements, people, *, reserves=(), seconds=5.0):
    """Maximize mandatory coverage first, then optional target coverage.

    A timeout without complete mandatory coverage is unresolved, not proof of
    infeasibility. Returned reservations are feasibility evidence, never saved duties.
    Empty demand is not evaluated here; callers distinguish reviewed closures from
    missing input using resolve_day.configured.
    """
    if type(seconds) not in (int, float) or not isfinite(seconds) or not 0 < seconds <= 30:
        raise ValueError("OT feasibility budget must be finite and between zero and 30 seconds")
    model = cp_model.CpModel()
    graph = add_reservation_variables(model, requirements, people, reserves=reserves)
    if not requirements and not reserves:
        return {"status": "not_evaluated", "mandatory_required": 0, "mandatory_covered": 0,
                "target_covered": 0, "requirements": [], "reserves": [], "proven": False}
    ordered, reserves, people = graph["requirements"], graph["reserves"], graph["people"]
    segments, choices = graph["segments"], graph["choices"]
    reserve_choices, credits = graph["reserve_choices"], graph["credits"]

    target_bound = sum(row.target for row in ordered)
    model.maximize(sum(credits) * (target_bound + 1) + sum(choices.values()))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(seconds)
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0
    result = solver.solve(model)
    if result == cp_model.MODEL_INVALID:
        raise ValueError("Invalid OT reservation model")
    has_solution = result in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    rows = []
    for index, requirement in enumerate(ordered):
        matched = [str(person.id) for person in people
                   if (index, person.id) in choices and has_solution
                   and solver.value(choices[index, person.id])]
        rows.append({
            "id": requirement.id, "unit_id": str(requirement.unit_id),
            "area_key": requirement.area_key, "band_key": requirement.band_key,
            "minimum": requirement.minimum, "target": requirement.target,
            "matched_person_ids": matched, "eligible_person_ids": [
                str(person.id) for person in people if (index, person.id) in choices],
            "minimum_shortage": max(0, requirement.minimum - len(matched)),
            "target_shortage": max(0, requirement.target - len(matched)),
            "source_reference": requirement.source_reference,
        })
    required = sum(row.minimum for row in ordered)
    covered = sum(min(row["minimum"], len(row["matched_person_ids"])) for row in rows)
    reserve_rows = []
    for original_index, reserve in enumerate(reserves):
        intervals = []
        for index, (parent, segment) in enumerate(segments):
            if parent != original_index:
                continue
            matched = [str(person.id) for person in people if (index, person.id) in reserve_choices
                       and has_solution and solver.value(reserve_choices[index, person.id])]
            intervals.append({"starts_at": segment.starts_at.isoformat(), "ends_at": segment.ends_at.isoformat(),
                              "matched_person_ids": matched})
        shortage = max((max(0, reserve.minimum - len(interval["matched_person_ids"])) for interval in intervals), default=reserve.minimum)
        reserve_rows.append({"id": reserve.id, "unit_id": str(reserve.unit_id), "mode": reserve.mode,
                             "call_levels": list(reserve.call_levels),
                             "minimum": reserve.minimum, "minimum_shortage": shortage, "intervals": intervals})
    reserves_clear = all(row["minimum_shortage"] == 0 for row in reserve_rows)
    status = ("feasible" if has_solution and covered == required and reserves_clear else
              "infeasible" if result == cp_model.OPTIMAL else "time_limited")
    report = {
        "status": status, "mandatory_required": required, "mandatory_covered": covered,
        "target_covered": sum(len(row["matched_person_ids"]) for row in rows),
        "requirements": rows, "reserves": reserve_rows, "proven": result == cp_model.OPTIMAL,
        "solver_status": solver.status_name(result),
        "wall_time_ms": round(solver.wall_time * 1000, 3),
    }
    if has_solution:
        from app.services.ot_capacity_verify import verify_witness
        failures = verify_witness(ordered, people, reserves, report)
        if failures:
            raise ValueError("OT reservation witness failed independent verification: " + "; ".join(failures[:3]))
    return report
