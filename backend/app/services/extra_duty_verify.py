"""Independent strict-rule checker for a month's rota (docs/extra_duty_contract.md, sections 1.1 and 7).

Written only from the contract text, NOT from ``app/services/extra_duty.py`` — it is a second,
independent implementation so the 360° report and the invariant tests can catch planner bugs.
It reuses only the shared primitives (eligibility, leave overlap, same-day/next-day block
predicates); the way they are combined is this module's own.

``check_month(db, month)`` checks every active assignment (``assigned``/``draft``/``confirmed``)
on the month's rota-period slots against the strict rules:

====================  ==========================================  ==============================
Check                 Codes                                       Rule (contract 1.1)
====================  ==========================================  ==============================
Active members        ``inactive_member``                         person is active
Posted to the ...     ``not_in_unit``                             posting to slot unit on date
Call level and groups ``call_level_mismatch``,                    ``rota_eligibility.eligibility``
                      ``call_subgroup_mismatch``
Leave respected       ``leave``                                   no active-status leave blocking
No double booking     ``same_day_duty``                           same-day block / time overlap
Rest after 24-hour    ``post_24hr_rest``, ``pre_24hr_rest``,      next-day blocks both ways and
duty                  ``rest_gap``                                the 24h minimum gap (any month)
Slot capacity         ``slot_full``                               active <= ``max_assignees``
====================  ==========================================  ==============================

Pure read-only: everything is preloaded with a handful of queries inside ``no_autoflush``; nothing
is added, flushed or committed (rules are loaded without ``get_phase_one_rules``' first-run writes).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    DutyAssignment,
    DutySlot,
    LeaveRequest,
    Person,
    PersonCallClusterMembership,
    PersonPosting,
    RotaPeriod,
)
from app.services.leave import ACTIVE_LEAVE_STATUSES, month_bounds
from app.services.rota_eligibility import (
    CODE_CALL_LEVEL,
    eligibility,
    load_groups_by_key,
)
from app.services.rota_rules import RotaPhaseOneRules
from app.services.rota_safety import (
    MemberContext,
    duty_blocks_same_day,
    previous_day_24hr_blocks,
    rule_for_slot,
    rules_groups,
    slot_leave_blocks,
)

ACTIVE_ASSIGNMENT_STATUSES = {"assigned", "draft", "confirmed"}
# Periods whose slots count as recorded duties for neighbouring-month rest checks.
_CONTEXT_PERIOD_STATUSES = {"draft", "historical", "approved", "published", "finalized"}
_PHASE4_SOURCE = "phase4_template"

CHECKS: list[tuple[str, tuple[str, ...]]] = [
    ("Leave respected", ("leave",)),
    ("Rest after 24-hour duty", ("post_24hr_rest", "pre_24hr_rest", "rest_gap")),
    ("No double booking", ("same_day_duty",)),
    ("Call level and groups", ("call_level_mismatch", "call_subgroup_mismatch")),
    ("Posted to the duty's unit", ("not_in_unit",)),
    ("Slot capacity", ("slot_full",)),
    ("Active members", ("inactive_member",)),
]
CHECK_FOR_CODE = {code: name for name, codes in CHECKS for code in codes}
STRICT_CODES = frozenset(CHECK_FOR_CODE)


# --------------------------------------------------------------------------------------- rules


def load_rules_read_only(db: Session) -> RotaPhaseOneRules:
    """The phase-one rules exactly as ``get_phase_one_rules`` would return them, without writes.

    ``get_phase_one_rules`` creates the rule version, setting and default groups on first use
    (and commits). When all of those exist it is a pure read and is used directly; otherwise the
    same merge is reproduced in memory.
    """
    from app.models import CallCluster, ReferenceValue, RuleSetting, RuleVersion
    from app.services import rota_rules as rr
    from app.services.call_clusters import DEFAULT_CALL_CLUSTERS

    version = db.scalar(select(RuleVersion).where(RuleVersion.name == rr.PHASE_ONE_RULE_VERSION_NAME))
    setting = (
        db.scalar(
            select(RuleSetting).where(
                RuleSetting.rule_version_id == version.id,
                RuleSetting.key == rr.PHASE_ONE_SETTING_KEY,
            )
        )
        if version is not None
        else None
    )
    cluster_keys = set(db.scalars(select(CallCluster.key)))
    if setting is not None and all(item["key"] in cluster_keys for item in DEFAULT_CALL_CLUSTERS):
        return rr.get_phase_one_rules(db)[1]

    rules = (
        rr.RotaPhaseOneRules.model_validate(setting.value)
        if setting is not None
        else rr.default_phase_one_rules()
    )
    defaults = rr.default_phase_one_rules()
    existing = {rule.key for rule in rules.duty_rules}
    rules.duty_rules.extend(rule for rule in defaults.duty_rules if rule.key not in existing)
    for value in db.scalars(select(ReferenceValue).where(ReferenceValue.kind == "duty_type")):
        configured = rr.DutyRule.model_validate(
            {**value.behavior, "key": value.key, "label": value.label, "active": value.active}
        )
        rules.duty_rules = [r for r in rules.duty_rules if r.key != value.key]
        rules.duty_rules.append(configured)
    for rule in rules.duty_rules:
        if rule.key in rr.INACTIVE_PAC_DUTY_KEYS:
            rule.active = False
    groups = load_groups_by_key(db)
    rr.attach_groups(rules, groups)
    return rules


# --------------------------------------------------------------------------------------- state


@dataclass
class _Duty:
    """A (possibly hypothetical) active duty of a person, detached from the session."""

    key: Any  # assignment id, or a synthetic key for hypothetical placements
    slot: DutySlot
    person_id: UUID
    in_month: bool


@dataclass
class MonthState:
    """Preloaded data for strict checks of one month. Build with ``load_month_state``."""

    month: str
    starts_on: date
    ends_on: date
    rules: RotaPhaseOneRules
    groups: dict
    min_gap_hours: float
    period: RotaPeriod | None
    slots: list[DutySlot]
    persons: dict[UUID, Person]
    postings_by_person: dict[UUID, list[PersonPosting]]
    leaves_by_person: dict[UUID, list[LeaveRequest]]
    duties_by_person: dict[UUID, list[_Duty]] = field(default_factory=dict)
    active_by_slot: dict[UUID, list[_Duty]] = field(default_factory=dict)
    month_assignments: list[DutyAssignment] = field(default_factory=list)

    # -- mutation for hypothetical plans (tests replay a planner's decisions) -----------------

    def add_duty(self, person_id: UUID, slot: DutySlot, key: Any) -> None:
        duty = _Duty(key=key, slot=slot, person_id=person_id, in_month=True)
        self.duties_by_person.setdefault(person_id, []).append(duty)
        self.active_by_slot.setdefault(slot.id, []).append(duty)

    # -- primitives -------------------------------------------------------------------------

    def contexts(self, person_id: UUID, day: date) -> list[MemberContext]:
        """Postings of the person covering ``day`` (person status ignored; checked separately)."""
        out: list[MemberContext] = []
        seen: set[UUID] = set()
        person = self.persons.get(person_id)
        for posting in self.postings_by_person.get(person_id, []):
            if posting.unit_id is None or posting.unit_id in seen:
                continue
            if posting.starts_on > day or (posting.ends_on is not None and posting.ends_on < day):
                continue
            seen.add(posting.unit_id)
            out.append(MemberContext(person=person, unit_id=posting.unit_id, posting_type=posting.posting_type, day=day))
        return out

    def blockers(
        self,
        person_id: UUID,
        slot: DutySlot,
        unit_id: UUID | None,
        *,
        exclude_key: Any = None,
        check_capacity: bool = True,
    ) -> list[tuple[str, str]]:
        """Strict blockers for ``person`` taking ``slot`` in ``unit_id`` -> [(code, message)].

        ``exclude_key`` is the person's own assignment on ``slot`` when checking an existing one.
        """
        problems: list[tuple[str, str]] = []
        person = self.persons.get(person_id)
        day = slot.duty_date
        if person is None or (person.active_status or "").lower() != "active":
            problems.append(("inactive_member", "The member is not active."))

        # Posting and eligibility.
        contexts = self.contexts(person_id, day)
        in_unit = [c for c in contexts if unit_id is not None and c.unit_id == unit_id]
        if not in_unit:
            problems.append(("not_in_unit", f"Not posted to the duty's unit on {day.isoformat()}."))
        if person is not None:
            context = in_unit[0] if in_unit else (
                contexts[0] if contexts else MemberContext(person=person, unit_id=unit_id, posting_type=person.call_level or "", day=day)
            )
            decision = eligibility(context, slot, rule_for_slot(slot, self.rules), self.groups)
            if not decision.eligible:
                code = "call_level_mismatch" if decision.code == CODE_CALL_LEVEL else "call_subgroup_mismatch"
                problems.append((code, decision.reason or "Not eligible for this duty."))

        # Leave (every active status is a strict block).
        for leave in self.leaves_by_person.get(person_id, []):
            if leave.starts_on <= day <= leave.ends_on and slot_leave_blocks(leave, slot):
                problems.append(
                    ("leave", f"On {leave.leave_type} ({leave.status}, {leave.leave_slot}) {leave.starts_on}–{leave.ends_on}.")
                )

        # Other active duties of the person.
        slot_same_day = duty_blocks_same_day(slot, self.rules)
        slot_next_day = previous_day_24hr_blocks(slot, self.rules)
        for other in self.duties_by_person.get(person_id, []):
            if other.slot.id == slot.id or (exclude_key is not None and other.key == exclude_key):
                continue
            o = other.slot
            label = f"{o.duty_type} on {o.duty_date.isoformat()}"
            overlap = o.starts_at < slot.ends_at and slot.starts_at < o.ends_at
            if o.duty_date == day and (slot_same_day or duty_blocks_same_day(o, self.rules)):
                problems.append(("same_day_duty", f"Also on {label} the same day."))
            elif overlap:
                problems.append(("same_day_duty", f"Time overlaps {label}."))
            if o.duty_date == day - timedelta(days=1) and previous_day_24hr_blocks(o, self.rules):
                problems.append(("post_24hr_rest", f"Resting after {label}."))
            if slot_next_day and o.duty_date == day + timedelta(days=1):
                problems.append(("pre_24hr_rest", f"This duty blocks the next day, but they have {label}."))
            if overlap:
                continue
            if o.is_24hr and o.ends_at <= slot.starts_at:
                gap = (slot.starts_at - o.ends_at).total_seconds() / 3600
                if gap < self.min_gap_hours:
                    problems.append(("rest_gap", f"Only {gap:g} h after the 24-hour {label}; needs {self.min_gap_hours:g} h."))
            if slot.is_24hr and slot.ends_at <= o.starts_at:
                gap = (o.starts_at - slot.ends_at).total_seconds() / 3600
                if gap < self.min_gap_hours:
                    problems.append(("rest_gap", f"Only {gap:g} h before {label} after this 24-hour duty; needs {self.min_gap_hours:g} h."))

        if check_capacity:
            active = [d for d in self.active_by_slot.get(slot.id, []) if d.key != exclude_key]
            if len(active) >= int(slot.max_assignees or 1):
                problems.append(("slot_full", f"Slot already has {len(active)} of {slot.max_assignees} people."))
        return problems

    def feasible(self, person_id: UUID, slot: DutySlot, unit_id: UUID | None) -> bool:
        return not self.blockers(person_id, slot, unit_id)


def _is_active(assignment: DutyAssignment) -> bool:
    return (assignment.status or "").lower() in ACTIVE_ASSIGNMENT_STATUSES


def load_month_state(db: Session, month: str, rules: RotaPhaseOneRules | None = None) -> MonthState:
    """Preload slots, assignments (with neighbouring-month context), people, postings and leave."""
    starts_on, ends_on = month_bounds(month)
    with db.no_autoflush:
        rules = rules or load_rules_read_only(db)
        groups = rules_groups(rules) or load_groups_by_key(db)
        gap = float(rules.rest_rules.minimum_gap_after_24hr_hours)
        pad = timedelta(days=int(gap // 24) + 3)
        window_start, window_end = starts_on - pad, ends_on + pad

        period = db.scalar(
            select(RotaPeriod)
            .where(RotaPeriod.starts_on == starts_on, RotaPeriod.ends_on == ends_on)
            .order_by(RotaPeriod.created_at, RotaPeriod.id)
        )
        month_slots: list[DutySlot] = (
            list(
                db.scalars(
                    select(DutySlot)
                    .where(DutySlot.rota_period_id == period.id)
                    .options(selectinload(DutySlot.assignments))
                    .order_by(DutySlot.duty_date, DutySlot.starts_at, DutySlot.duty_type, DutySlot.slot_label)
                )
            )
            if period is not None
            else []
        )
        month_slot_ids = {s.id for s in month_slots}
        context_slots = list(
            db.scalars(
                select(DutySlot)
                .outerjoin(DutySlot.rota_period)
                .where(
                    DutySlot.duty_date >= window_start,
                    DutySlot.duty_date <= window_end,
                    or_(DutySlot.source == _PHASE4_SOURCE, RotaPeriod.status.in_(_CONTEXT_PERIOD_STATUSES)),
                )
                .options(selectinload(DutySlot.assignments))
            )
        )

        month_assignments = [a for s in month_slots for a in s.assignments if _is_active(a)]
        context_assignments = [
            a for s in context_slots if s.id not in month_slot_ids for a in s.assignments if _is_active(a)
        ]
        person_ids = {a.person_id for a in month_assignments} | {a.person_id for a in context_assignments}
        posted_ids = set(
            db.scalars(
                select(PersonPosting.person_id).where(
                    PersonPosting.starts_on <= window_end,
                    or_(PersonPosting.ends_on.is_(None), PersonPosting.ends_on >= window_start),
                )
            )
        )
        person_ids |= posted_ids
        persons = (
            {
                p.id: p
                for p in db.scalars(
                    select(Person)
                    .where(Person.id.in_(person_ids))
                    .options(
                        selectinload(Person.call_level_changes),
                        selectinload(Person.call_cluster_memberships).selectinload(PersonCallClusterMembership.cluster),
                    )
                )
            }
            if person_ids
            else {}
        )
        postings_by_person: dict[UUID, list[PersonPosting]] = defaultdict(list)
        for posting in db.scalars(
            select(PersonPosting)
            .where(
                PersonPosting.starts_on <= window_end,
                or_(PersonPosting.ends_on.is_(None), PersonPosting.ends_on >= window_start),
            )
            .order_by(PersonPosting.starts_on, PersonPosting.created_at, PersonPosting.id)
        ):
            postings_by_person[posting.person_id].append(posting)
        leaves_by_person: dict[UUID, list[LeaveRequest]] = defaultdict(list)
        for leave in db.scalars(
            select(LeaveRequest).where(LeaveRequest.starts_on <= ends_on, LeaveRequest.ends_on >= starts_on)
        ):
            if (leave.status or "").lower() in ACTIVE_LEAVE_STATUSES:
                leaves_by_person[leave.person_id].append(leave)

    state = MonthState(
        month=month,
        starts_on=starts_on,
        ends_on=ends_on,
        rules=rules,
        groups=groups,
        min_gap_hours=gap,
        period=period,
        slots=month_slots,
        persons=persons,
        postings_by_person=dict(postings_by_person),
        leaves_by_person=dict(leaves_by_person),
        month_assignments=month_assignments,
    )
    for a in month_assignments:
        duty = _Duty(key=a.id, slot=a.duty_slot, person_id=a.person_id, in_month=True)
        state.duties_by_person.setdefault(a.person_id, []).append(duty)
        state.active_by_slot.setdefault(a.duty_slot_id, []).append(duty)
    # Neighbouring context: one copy per (person, date, type, times); a historical copy of a
    # duty that is also in this month's period is not a second duty.
    own = {(a.person_id, a.duty_slot.duty_date, a.duty_slot.duty_type, a.duty_slot.starts_at, a.duty_slot.ends_at) for a in month_assignments}
    for a in context_assignments:
        s = a.duty_slot
        key = (a.person_id, s.duty_date, s.duty_type, s.starts_at, s.ends_at)
        if key in own:
            continue
        own.add(key)
        state.duties_by_person.setdefault(a.person_id, []).append(
            _Duty(key=a.id, slot=s, person_id=a.person_id, in_month=False)
        )
    return state


# --------------------------------------------------------------------------------------- check


def _violation(slot: DutySlot, person_id: UUID | None, person: Person | None, code: str, message: str) -> dict:
    return {
        "slot_id": str(slot.id),
        "person_id": str(person_id) if person_id else None,
        "person_name": person.canonical_name if person is not None else None,
        "duty_date": slot.duty_date.isoformat(),
        "duty_type": slot.duty_type,
        "code": code,
        "check": CHECK_FOR_CODE[code],
        "message": message,
    }


def check_state(state: MonthState, assignment_ids: Iterable[UUID] | None = None) -> dict[str, Any]:
    """Check the state's active month assignments (optionally only ``assignment_ids``)."""
    only = {UUID(str(i)) for i in assignment_ids} if assignment_ids is not None else None
    targets = [a for a in state.month_assignments if only is None or a.id in only]
    violations: list[dict] = []
    for a in targets:
        slot = a.duty_slot
        person = state.persons.get(a.person_id)
        for code, message in state.blockers(a.person_id, slot, slot.unit_id, exclude_key=a.id, check_capacity=False):
            violations.append(_violation(slot, a.person_id, person, code, message))

    # Capacity, once per slot: the latest assignment(s) over the limit are named.
    checked_slots = {a.duty_slot_id: a.duty_slot for a in targets}
    for slot_id, slot in checked_slots.items():
        active = sorted(
            (a for a in state.month_assignments if a.duty_slot_id == slot_id),
            key=lambda a: (a.created_at or datetime.min, str(a.id)),
        )
        limit = int(slot.max_assignees or 1)
        for extra in active[limit:]:
            violations.append(
                _violation(slot, extra.person_id, state.persons.get(extra.person_id), "slot_full",
                           f"Slot has {len(active)} active people; the limit is {limit}.")
            )

    violations.sort(key=lambda v: (v["duty_date"], v["duty_type"], v["slot_id"], v["person_id"] or "", v["code"], v["message"]))
    checks = []
    for name, codes in CHECKS:
        count = sum(1 for v in violations if v["code"] in codes)
        checked = len(checked_slots) if name == "Slot capacity" else len(targets)
        checks.append({"name": name, "passed": count == 0, "checked": checked, "violations": count})
    return {
        "month": state.month,
        "ok": not violations,
        "checked": len(targets),
        "violations": violations,
        "checks": checks,
    }


def check_month(
    db: Session,
    month: str,
    assignment_ids: Iterable[UUID] | None = None,
    rules: RotaPhaseOneRules | None = None,
) -> dict[str, Any]:
    """Check every active assignment of ``month`` against the strict rules (contract 1.1).

    Returns ``{month, ok, checked, violations: [{slot_id, person_id, person_name, duty_date,
    duty_type, code, check, message}], checks: [{name, passed, checked, violations}]}``.
    Read-only.
    """
    return check_state(load_month_state(db, month, rules), assignment_ids)
