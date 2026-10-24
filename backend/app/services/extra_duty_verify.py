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
                                                                  (exempt: active ledger record
                                                                  with ``unposted_member`` AND no
                                                                  posting at all on the date)
Duty allowed for unit ``unit_rule``                               ``rota_template.rule_applies_to_unit``
                                                                  for the slot's final unit
Call level and groups ``call_level_mismatch``,                    ``rota_eligibility.eligibility``
                      ``call_level_unresolved``,                  (strict: the member's level must
                      ``call_subgroup_mismatch``                  be in the duty's level set; a
                                                                  pool allows each of its levels)
Leave respected       ``leave``                                   no active-status leave blocking
No double booking     ``same_day_duty``                           same-day block / time overlap
Rest after 24-hour    ``post_24hr_rest``, ``pre_24hr_rest``,      next-day blocks both ways and
duty                  ``rest_gap``                                the 24h minimum gap (any month)
Slot capacity         ``slot_full``                               active <= ``max_assignees``
====================  ==========================================  ==============================

Superadmin allocations (``source == "superadmin_allocation"``, docs/superadmin_override_contract.md
§1) are exempt from the call level and groups, duty-allowed-for-unit, posted-to-unit and
active-member checks. They are NOT exempt from leave, rest, double booking or slot capacity.
The exempted count is reported as ``superadmin_exempt``. Superadmin allocations that cross call
level are not hidden: they are listed as ``superadmin_cross_level`` (with
``superadmin_cross_level_count``); every other source must hold a level inside the duty's level
set (docs/call_level_pool_and_balance_contract.md section 1).

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
    Unit,
)
from app.models.extra_duty import ExtraDutyRecord
from app.services.leave import ACTIVE_LEAVE_STATUSES, month_bounds
from app.services.rota_eligibility import (
    eligibility,
    eligibility_issue_code,
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
from app.services.rota_template import rule_applies_to_unit

ACTIVE_ASSIGNMENT_STATUSES = {"assigned", "draft", "confirmed"}
# Ledger code that exempts an assignment from the posted-to-unit check only (fill-all contract §3).
UNPOSTED_LEDGER_CODE = "unposted_member"
# Assignment source of a superadmin allocation (superadmin override contract §1).
SUPERADMIN_SOURCE = "superadmin_allocation"
# Checks a superadmin allocation is exempt from. Leave, rest, double booking and capacity stay.
SUPERADMIN_EXEMPT_CODES = frozenset(
    {
        "inactive_member",
        "not_in_unit",
        "unit_rule",
        "call_level_mismatch",
        "call_level_unresolved",
        "call_subgroup_mismatch",
    }
)
CALL_LEVEL_CODES = frozenset({"call_level_mismatch", "call_level_unresolved"})
# Periods whose slots count as recorded duties for neighbouring-month rest checks.
_CONTEXT_PERIOD_STATUSES = {"draft", "historical", "approved", "published", "finalized"}
_PHASE4_SOURCE = "phase4_template"

CHECKS: list[tuple[str, tuple[str, ...]]] = [
    ("Leave respected", ("leave",)),
    ("Rest after 24-hour duty", ("post_24hr_rest", "pre_24hr_rest", "rest_gap")),
    ("No double booking", ("same_day_duty",)),
    ("Call level and groups", ("call_level_mismatch", "call_level_unresolved", "call_subgroup_mismatch")),
    ("Posted to the duty's unit", ("not_in_unit",)),
    ("Duty allowed for unit", ("unit_rule",)),
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
    units: dict[UUID, Unit] = field(default_factory=dict)
    # Assignment ids backed by an active ledger record whose overridden_rules has ``unposted_member``.
    unposted_assignment_ids: set = field(default_factory=set)
    # Assignment ids whose source is a superadmin allocation (exempt per SUPERADMIN_EXEMPT_CODES).
    superadmin_assignment_ids: set = field(default_factory=set)
    _flags: dict = field(default_factory=dict)

    def _slot_flags(self, slot: DutySlot) -> tuple[Any, bool, bool]:
        """(rule, blocks same day, blocks next day) per duty type and 24h flag, memoised."""
        key = (slot.duty_type, bool(slot.is_24hr))
        flags = self._flags.get(key)
        if flags is None:
            flags = self._flags[key] = (
                rule_for_slot(slot, self.rules),
                duty_blocks_same_day(slot, self.rules),
                previous_day_24hr_blocks(slot, self.rules),
            )
        return flags

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
        unposted_ok: bool = False,
        superadmin: bool = False,
    ) -> list[tuple[str, str]]:
        """Strict blockers for ``person`` taking ``slot`` in ``unit_id`` -> [(code, message)].

        ``exclude_key`` is the person's own assignment on ``slot`` when checking an existing one.
        ``unposted_ok`` (a ledgered ``unposted_member`` placement) waives the posted-to-unit
        check only, and only while the member has no posting at all covering the date; every
        other check still applies.
        ``superadmin`` (a superadmin allocation) drops ``SUPERADMIN_EXEMPT_CODES`` from the
        result; leave, rest, double booking and capacity still apply.
        """
        if superadmin:
            return [
                item
                for item in self.blockers(
                    person_id, slot, unit_id, exclude_key=exclude_key,
                    check_capacity=check_capacity, unposted_ok=unposted_ok,
                )
                if item[0] not in SUPERADMIN_EXEMPT_CODES
            ]
        problems: list[tuple[str, str]] = []
        person = self.persons.get(person_id)
        day = slot.duty_date
        if person is None or (person.active_status or "").lower() != "active":
            problems.append(("inactive_member", "The member is not active."))

        # Posting and eligibility.
        contexts = self.contexts(person_id, day)
        in_unit = [c for c in contexts if unit_id is not None and c.unit_id == unit_id]
        if not in_unit:
            if not unposted_ok:
                problems.append(("not_in_unit", f"Not posted to the duty's unit on {day.isoformat()}."))
            elif contexts:
                problems.append(("not_in_unit", f"Recorded as having no posting, but posted to another unit on {day.isoformat()}."))

        # Unit rules of the duty (allowed / excluded units), on the slot's final unit.
        rule = self._slot_flags(slot)[0]
        if rule is not None and (rule.allowed_units or rule.excluded_units):
            unit = self.units.get(unit_id) if unit_id is not None else None
            if unit is None:
                problems.append(("unit_rule", "Duty not allowed for this unit: the duty has unit rules but no known unit."))
            elif not rule_applies_to_unit(rule, unit):
                problems.append(("unit_rule", f"Duty not allowed for this unit: {rule.label} is not allowed in {unit.name}."))
        if person is not None:
            context = in_unit[0] if in_unit else (
                contexts[0] if contexts else MemberContext(person=person, unit_id=unit_id, posting_type=person.call_level or "", day=day)
            )
            decision = eligibility(context, slot, self._slot_flags(slot)[0], self.groups)
            if not decision.eligible:
                code = eligibility_issue_code(decision)
                problems.append((code, decision.reason or "Not eligible for this duty."))

        # Leave (every active status is a strict block).
        for leave in self.leaves_by_person.get(person_id, []):
            if leave.starts_on <= day <= leave.ends_on and slot_leave_blocks(leave, slot):
                problems.append(
                    ("leave", f"On {leave.leave_type} ({leave.status}, {leave.leave_slot}) {leave.starts_on}–{leave.ends_on}.")
                )

        # Other active duties of the person.
        _rule, slot_same_day, slot_next_day = self._slot_flags(slot)
        for other in self.duties_by_person.get(person_id, []):
            if other.slot.id == slot.id or (exclude_key is not None and other.key == exclude_key):
                continue
            o = other.slot
            label = f"{o.duty_type} on {o.duty_date.isoformat()}"
            overlap = o.starts_at < slot.ends_at and slot.starts_at < o.ends_at
            _o_rule, o_same_day, o_next_day = self._slot_flags(o)
            if o.duty_date == day and (slot_same_day or o_same_day):
                problems.append(("same_day_duty", f"Also on {label} the same day."))
            elif overlap:
                problems.append(("same_day_duty", f"Time overlaps {label}."))
            if o.duty_date == day - timedelta(days=1) and o_next_day:
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
        units = {unit.id: unit for unit in db.scalars(select(Unit))}
        month_assignment_ids = {a.id for a in month_assignments}
        unposted_ids: set = set()
        if month_assignment_ids:
            for record in db.scalars(
                select(ExtraDutyRecord).where(ExtraDutyRecord.month == month, ExtraDutyRecord.status == "active")
            ):
                if record.assignment_id in month_assignment_ids and UNPOSTED_LEDGER_CODE in (record.overridden_rules or []):
                    unposted_ids.add(record.assignment_id)

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
        units=units,
        unposted_assignment_ids=unposted_ids,
        superadmin_assignment_ids={a.id for a in month_assignments if a.source == SUPERADMIN_SOURCE},
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
        for code, message in state.blockers(
            a.person_id, slot, slot.unit_id, exclude_key=a.id, check_capacity=False,
            unposted_ok=a.id in state.unposted_assignment_ids,
            superadmin=a.id in state.superadmin_assignment_ids,
        ):
            violations.append(_violation(slot, a.person_id, person, code, message))

    # Superadmin allocations that cross call level: exempt, but counted and listed.
    cross_level = []
    for a in targets:
        if a.id not in state.superadmin_assignment_ids:
            continue
        slot = a.duty_slot
        for code, message in state.blockers(
            a.person_id, slot, slot.unit_id, exclude_key=a.id, check_capacity=False
        ):
            if code in CALL_LEVEL_CODES:
                item = _violation(slot, a.person_id, state.persons.get(a.person_id), code, message)
                item.update(code="superadmin_cross_level", check="Call level crossed by superadmin",
                            assignment_id=str(a.id))
                cross_level.append(item)
                break
    cross_level.sort(key=lambda v: (v["duty_date"], v["duty_type"], v["slot_id"], v["person_id"] or ""))

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
        "unposted_exempt": sum(1 for a in targets if a.id in state.unposted_assignment_ids),
        "superadmin_exempt": sum(1 for a in targets if a.id in state.superadmin_assignment_ids),
        "superadmin_cross_level": cross_level,
        "superadmin_cross_level_count": len(cross_level),
    }


def check_month(
    db: Session,
    month: str,
    assignment_ids: Iterable[UUID] | None = None,
    rules: RotaPhaseOneRules | None = None,
) -> dict[str, Any]:
    """Check every active assignment of ``month`` against the strict rules (contract 1.1).

    Returns ``{month, ok, checked, violations: [{slot_id, person_id, person_name, duty_date,
    duty_type, code, check, message}], checks: [{name, passed, checked, violations}],
    unposted_exempt: int, superadmin_exempt: int, superadmin_cross_level: [violation-shaped
    items with code ``superadmin_cross_level`` and ``assignment_id``],
    superadmin_cross_level_count: int}`` (assignments waived from the posted-to-unit check only,
    and superadmin allocations waived from the call level/groups, unit rule, posting and
    active-member checks; those crossing call level are listed, not hidden).
    Read-only.
    """
    return check_state(load_month_state(db, month, rules), assignment_ids)
