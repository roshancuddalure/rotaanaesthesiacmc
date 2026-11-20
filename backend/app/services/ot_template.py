"""Read-only OT/strict-duty capacity proof for a proposed unit template.

This is an existence check, not a person allocator or fairness optimizer. Person
witnesses are private and never saved. Normal monthly limits, preferences and
departmental acceptance still belong to the later reviewed allocation stages.
"""

from collections import defaultdict
from copy import deepcopy
from time import perf_counter
from types import SimpleNamespace
from uuid import UUID, uuid5, NAMESPACE_URL

from ortools.sat.python import cp_model
from pydantic import ValidationError
from sqlalchemy import select

from app.models import Unit
from app.services.extra_duty import ExtraDutyContext, strict_blockers
from app.services.ot_capacity import CapacityResourceLimit
from app.services.ot_joint_reservations import add_joint_reservations
from app.services.rota_candidates import candidate_context
from app.services.rota_optimizer import incompatible
from app.services.rota_safety import ACTIVE_ASSIGNMENT_STATUSES


def slot_signature(slot):
    return (str(slot.duty_date), slot.duty_type, str(slot.unit_id or ""),
            slot.starts_at.isoformat(), slot.ends_at.isoformat(), bool(slot.is_24hr),
            str(slot.call_level or ""), int(slot.max_assignees or 1))


class TemplateOtCapacity:
    def __init__(self, db, month, prospective_slots):
        with db.no_autoflush:
            self.base = candidate_context(db, month, prospective_slots=prospective_slots)
            self.units = {unit.id: unit for unit in db.scalars(select(Unit))}
            self.fixed = tuple(a for rows in self.base.nearby_assignments.values() for a in rows
                               if a.status.lower() in ACTIVE_ASSIGNMENT_STATUSES)
            self.physical = self._physical(self.fixed)
        self.guard = self.base.ot_guard
        self.cache = {}
        self.candidates = {}
        self.hints = {}

    def _physical(self, assignments):
        # Private input-only strict checker; OT is coupled jointly below and
        # independently rechecked once over the final witness, not per person.
        return ExtraDutyContext(month=self.base.month, rules=self.base.rules,
            postings=self.base.postings, leaves=self.base.leaves, assignments=assignments,
            slots=[], units=self.units)

    @staticmethod
    def report(status, count, reason):
        return {"status": status, "scope": "ot_and_strict_duty_capacity", "planned_duties": count,
                "reason": reason}

    def check(self, slots, *, seconds=5.0):
        """Prove all unit-assigned, unfilled slots together with preserved duties."""
        ordered = sorted(slots, key=slot_signature)
        count = len(ordered)
        if count > 512:
            return self.report("not_evaluated", count, "Template capacity exceeds the supported duty count.")
        if self.guard is None or self.guard.unresolved or not self.guard.reviewed_complete:
            return self.report("not_evaluated", count, "Reviewed OT demand and dated availability are incomplete.")
        if any(slot.unit_id is None for slot in ordered):
            return self.report("not_evaluated", count, "An unallocated duty has no unit capacity to verify.")
        if not any(row.minimum for row in (*self.guard.requirements, *self.guard.reserves)):
            return self.report("feasible", count, "Reviewed OT and reserve demand is zero.")
        signature = tuple(slot_signature(slot) for slot in ordered)
        if signature in self.cache:
            return deepcopy(self.cache[signature])
        deadline = perf_counter() + seconds
        model = cp_model.CpModel()
        slot_map = {str(index): SimpleNamespace(
            id=slot.id or uuid5(NAMESPACE_URL, f"template-slot:{index}:{slot_signature(slot)}"),
            **{name: getattr(slot, name) for name in ("unit_id", "duty_date", "duty_type",
                "starts_at", "ends_at", "is_24hr", "call_level", "max_assignees")})
            for index, slot in enumerate(ordered)}
        choices, by_person = {}, defaultdict(list)
        try:
            for key, slot in slot_map.items():
                if perf_counter() >= deadline:
                    return self.report("not_evaluated", count, "Template OT capacity reached its work budget.")
                fingerprint = slot_signature(slot)
                if fingerprint not in self.candidates:
                    if len(self.candidates) >= 2048:
                        self.candidates.pop(next(iter(self.candidates)))
                    if len(self.physical._eligibility) >= 200000:
                        self.physical._eligibility.clear()
                    self.candidates[fingerprint] = tuple(sorted((person_id for person_id in
                        self.physical.unit_contexts(slot.duty_date, slot.unit_id)
                        if not strict_blockers(self.physical, person_id, slot, slot.unit_id)), key=str))
                variables = []
                for person_id in self.candidates[fingerprint]:
                    if len(choices) >= 200000:
                        raise CapacityResourceLimit("Template duty choices exceed supported dimensions")
                    variable = model.new_bool_var(f"duty_{key}_{person_id}")
                    choices[key, str(person_id)] = variable
                    by_person[person_id].append((key, variable))
                    variables.append(variable)
                model.add(sum(variables) == 1)
            if len(choices) > 200000:
                raise CapacityResourceLimit("Template duty choices exceed supported dimensions")
            work = 0
            for rows in by_person.values():
                for index, (key, variable) in enumerate(rows):
                    for other_key, other in rows[index + 1:]:
                        work += 1
                        if work > 2000000:
                            raise CapacityResourceLimit("Template duty conflict work exceeds supported dimensions")
                        if incompatible(slot_map[key], slot_map[other_key], self.base.rules):
                            model.add(variable + other <= 1)
            add_joint_reservations(model, self.guard, self.fixed, slot_map, choices, self.base.rules)
            for (key, person_id), variable in choices.items():
                model.add_hint(variable, int(self.hints.get(slot_signature(slot_map[key])) == person_id))
            solver = cp_model.CpSolver()
            solver.parameters.num_search_workers = 1
            solver.parameters.random_seed = 0
            for _ in range(64):
                remaining = deadline - perf_counter()
                if remaining <= 0:
                    break
                solver.parameters.max_time_in_seconds = remaining
                status = solver.solve(model)
                if status == cp_model.INFEASIBLE:
                    result = self.report("infeasible", count, "No compatible duty/OT reservation witness covers this unit layout.")
                    self._remember(signature, result)
                    return result
                if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                    break
                selected = {(key, person_id): variable for (key, person_id), variable in choices.items()
                            if solver.value(variable)}
                proposed = tuple(SimpleNamespace(id=uuid5(NAMESPACE_URL, f"template-capacity:{key}"),
                    person_id=UUID(person_id), duty_slot_id=slot_map[key].id,
                    duty_slot=slot_map[key], person=self.base.people[UUID(person_id)], status="assigned")
                    for key, person_id in selected)
                final = (*self.fixed, *proposed)
                physical = self._physical(final)
                clear = all(not strict_blockers(physical, row.person_id, row.duty_slot,
                    row.duty_slot.unit_id, exclude_assignment_id=row.id) for row in proposed)
                remaining = deadline - perf_counter()
                if remaining <= 0:
                    break
                checked = self.guard.check_affected(final, proposed, self.base.rules, seconds=min(remaining, 30))
                if checked["status"] == "not_evaluated":
                    break
                if clear and checked["status"] == "feasible":
                    self.hints = {slot_signature(row.duty_slot): str(row.person_id) for row in proposed}
                    result = self.report("feasible", count, "A joint duty/OT capacity witness was independently checked.")
                    self._remember(signature, result)
                    return result
                model.add(sum(selected.values()) <= len(selected) - 1)
        except (CapacityResourceLimit, ValidationError) as exc:
            return self.report("not_evaluated", count, str(exc))
        return self.report("not_evaluated", count, "Template OT capacity could not be established within its work budget.")

    def _remember(self, signature, result):
        if len(self.cache) >= 128:
            self.cache.pop(next(iter(self.cache)))
        self.cache[signature] = deepcopy(result)
