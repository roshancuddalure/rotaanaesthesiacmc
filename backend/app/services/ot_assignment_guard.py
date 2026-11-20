"""Reusable reservation proof over immutable roster inputs and a final duty set.

The caller loads leave/posting/qualification availability with assignments=().
Each check overlays the complete proposed duty set, including preserved duties.
No database reads, writes, permission exceptions or guessed missing demand occur
here. Entry-point integration must supply a reviewed, complete demand horizon.
"""

from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
from math import isfinite
from time import perf_counter

from pydantic import ValidationError

from app.services.ot_availability import duty_windows, merge_intervals
from app.services.ot_capacity import CapacityResourceLimit, eligible, evaluate_capacity
from app.services.ot_capacity_verify import verify_witness
from app.services.rota_safety import ACTIVE_ASSIGNMENT_STATUSES


@dataclass(frozen=True)
class OtAssignmentGuard:
    requirements: tuple
    people: tuple
    reserves: tuple = ()
    unresolved: tuple[str, ...] = ()
    reviewed_complete: bool = False
    cache_limit: int = 64
    horizon_start: datetime | None = None
    horizon_end: datetime | None = None
    _proofs: dict = field(default_factory=dict, init=False, compare=False, repr=False)
    _scopes: dict = field(default_factory=dict, init=False, compare=False, repr=False)

    def __post_init__(self):
        if (self.horizon_start is None) != (self.horizon_end is None) or (
                self.horizon_start is not None and self.horizon_start >= self.horizon_end):
            raise ValueError("OT reviewed horizon needs ordered start and end bounds")
        if not 1 <= self.cache_limit <= 256:
            raise ValueError("OT proof cache must hold between 1 and 256 entries")
        # Safety checks reserve only mandatory roles. Optional targets must not
        # make an otherwise safe duty infeasible or unnecessarily tie up people.
        object.__setattr__(self, "requirements", tuple(
            row.model_copy(update={"target": row.minimum}) for row in self.requirements))
        object.__setattr__(self, "people", tuple(self.people))
        object.__setattr__(self, "reserves", tuple(self.reserves))
        object.__setattr__(self, "unresolved", tuple(self.unresolved))

    def check_affected(self, assignments, effects, rules, *, seconds=5.0):
        """Prove complete components touched by proposed people's duty blocks.

        Existing unrelated deficits remain visible to whole-plan checks but cannot
        block every scoped edit. Whole OT bands connect all competing overlapping
        requirements transitively, even beyond a proposed duty's own interval.
        Unknown context is never scoped away by assuming no compatible people.
        """
        self._validate_budget(seconds)
        deadline = perf_counter() + seconds
        if self.unresolved or not self.reviewed_complete:
            return self.check((), rules, seconds=seconds)
        effects = tuple(effects)
        if self.horizon_start is not None:
            try:
                if any(span.starts_at < self.horizon_start or span.ends_at > self.horizon_end
                       for effect in effects for span in duty_windows(effect.duty_slot, rules)):
                    return {"status": "not_evaluated", "code": "ot_context_unresolved",
                            "reasons": ["Proposed duty/rest extends beyond the reviewed OT horizon; reload scheduling context"],
                            "capacity": None}
            except ValidationError:
                return {"status": "not_evaluated", "code": "ot_context_unresolved",
                        "reasons": ["Invalid proposed duty/rest interval"], "capacity": None}
        from app.services.ot_guard_scope import reservation_components

        try:
            if "index" not in self._scopes:
                self._scopes["index"] = reservation_components(self.requirements, self.reserves, self.people)
            groups, potentials = self._scopes["index"]
        except CapacityResourceLimit as exc:
            return self._unresolved(exc)
        demands = (*self.requirements, *self.reserves)
        touched = set()
        try:
            for effect in effects:
                for span in duty_windows(effect.duty_slot, rules):
                    touched.update(index for index, demand in enumerate(demands)
                                   if effect.person_id in potentials[index]
                                   and span.starts_at < demand.ends_at and span.ends_at > demand.starts_at)
        except ValidationError:
            return {"status": "not_evaluated", "code": "ot_context_unresolved",
                    "reasons": ["Invalid proposed duty/rest interval"], "capacity": None}
        assignments, reports = tuple(assignments), []
        for group in groups:
            if not touched.intersection(group):
                continue
            if group not in self._scopes:
                if len(self._scopes) >= 257:
                    self._scopes.pop(next(key for key in self._scopes if key != "index"))
                self._scopes[group] = OtAssignmentGuard(
                    tuple(demands[i] for i in group if i < len(self.requirements)), self.people,
                    tuple(demands[i] for i in group if i >= len(self.requirements)), reviewed_complete=True,
                    cache_limit=self.cache_limit)
            remaining = deadline - perf_counter()
            if remaining <= 0:
                return self._unresolved(CapacityResourceLimit("OT affected-component check reached its time budget"))
            report = self._scopes[group].check(assignments, rules, seconds=min(remaining, 30.0))
            reports.append(report)
            if report["status"] != "feasible":
                return {**report, "scope": "affected_components", "components_checked": len(reports)}
        return {"status": "feasible", "code": "ot_affected_reservations_clear",
                "scope": "affected_components", "components_checked": len(reports)}

    def check(self, assignments, rules, *, seconds=5.0):
        self._validate_budget(seconds)
        if self.unresolved or not self.reviewed_complete:
            return {"status": "not_evaluated", "code": "ot_context_unresolved",
                    "reasons": list(self.unresolved) or ["Demand horizon has not been reviewed completely"],
                    "capacity": None}
        if not self.requirements and not self.reserves:
            # Empty alone cannot prove closure: the loader must attest completeness
            # by leaving unresolved empty only for reviewed demand/closures.
            return {"status": "feasible", "code": "ot_reviewed_zero",
                    "capacity": None, "proof_source": "reviewed_context"}
        demands = (*self.requirements, *self.reserves)
        beginning = min(row.starts_at for row in demands)
        ending = max(row.ends_at for row in demands)
        identities = {person.id for person in self.people}
        blocks = defaultdict(list)
        for assignment in assignments:
            if assignment.person_id not in identities \
                    or assignment.status.lower() not in ACTIVE_ASSIGNMENT_STATUSES:
                continue
            for span in duty_windows(assignment.duty_slot, rules):
                if span.starts_at < ending and span.ends_at > beginning:
                    blocks[assignment.person_id].append(span)
        try:
            people = tuple(person.model_copy(update={"blocked": merge_intervals(
                (*person.blocked, *blocks[person.id]))}) for person in self.people)
            # model_copy intentionally skips validation; retain model limits even
            # when an unusually fragmented final plan is supplied by the caller.
            if any(len(person.blocked) > 256 for person in people):
                raise CapacityResourceLimit("OT duty/rest interval count exceeds supported dimensions")
        except ValidationError:
            return {"status": "not_evaluated", "code": "ot_context_unresolved",
                    "reasons": ["Invalid duty/rest intervals"], "capacity": None}
        except CapacityResourceLimit as exc:
            return self._unresolved(exc)
        key = tuple((person.id, tuple((span.starts_at, span.ends_at) for span in person.blocked))
                    for person in people)
        cached = self._proofs.get(key)
        if cached is not None:
            # Results returned to callers never expose the private cached object.
            return self._result(cached, "exact_cache")
        # A duty affecting somebody outside a previous witness often needs no CP
        # solve. Recheck that witness against ALL final blocks independently.
        for proof in reversed(tuple(self._proofs.values())):
            if proof["status"] == "feasible" and not verify_witness(
                    self.requirements, people, self.reserves, proof):
                proof = deepcopy(proof)
                required = {row.id: row for row in self.requirements}
                for row in proof["requirements"]:
                    row["eligible_person_ids"] = [str(person.id) for person in people
                                                  if eligible(person, required[row["id"]])]
                proof.update(proven=False, solver_status="WITNESS_RECHECKED", wall_time_ms=0)
                self._remember(key, proof)
                return self._result(proof, "rechecked_witness")
        try:
            capacity = evaluate_capacity(self.requirements, people, reserves=self.reserves, seconds=seconds)
        except CapacityResourceLimit as exc:
            return self._unresolved(exc)
        if capacity["status"] in {"feasible", "infeasible"}:
            self._remember(key, capacity)
        return self._result(capacity, "solver")

    def _remember(self, key, capacity):
        if key in self._proofs:
            self._proofs.pop(key)
        while len(self._proofs) >= self.cache_limit:
            self._proofs.pop(next(iter(self._proofs)))
        self._proofs[key] = deepcopy(capacity)

    @staticmethod
    def _validate_budget(seconds):
        if type(seconds) not in (int, float) or not isfinite(seconds) or not 0 < seconds <= 30:
            raise ValueError("OT feasibility budget must be finite and between zero and 30 seconds")

    @staticmethod
    def _result(capacity, source):
        return {"status": capacity["status"], "code": "ot_reservation_check",
                "capacity": deepcopy(capacity), "proof_source": source}

    @staticmethod
    def _unresolved(exc):
        return {"status": "not_evaluated", "code": "ot_capacity_unresolved",
                "reasons": [str(exc)], "capacity": None}
