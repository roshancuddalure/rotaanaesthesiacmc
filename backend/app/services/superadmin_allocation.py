"""Superadmin allocation: put any active member on a specific slot (docs/superadmin_override_contract.md §1).

Only the superadmin may do this (the router enforces ``require_superadmin``). The allocation
may override call level, eligibility groups, the duty's unit rules, posting, individual limits,
unit staffing and fairness; each bypassed rule is listed in ``overrides`` and recorded in the
justice ledger. Crossing call level needs an explicit ``confirm_cross_level`` (409
``cross_level_confirmation_required`` otherwise) and adds the ledger code ``superadmin_cross_level``
(docs/limits_callevel_fairness_contract.md section 1). It never breaks:

* leave (every active status: ``ACTIVE_LEAVE_STATUSES``),
* rest after a 24-hour duty (the next-day block both ways and the minimum gap, any month),
* overlapping or same-day double duty.

These strict checks read the same preloaded month state as the independent checker
(``extra_duty_verify.load_month_state``) and mirror its rest logic, but word the reasons for
people ("On approved leave 12 Jun", "Resting after 24-hour duty on 11 Jun").

Writes (``allocate``) happen under the extra-duty month lock: the slot's current holders are
cancelled (status ``cancelled``; their ledger records voided as "replaced"), the new assignment
gets ``source="superadmin_allocation"``, and an ``ExtraDutyBatch`` (summary mode
``superadmin_allocation``) plus one ``ExtraDutyRecord`` are written. The batch's
``before_image`` keeps the cancelled holders so ``undo`` (this module; the planner's undo
refuses these batches because the assignment source is not the planner's) restores them.

Services raise ``SuperadminAllocationError``; the HTTP layer maps it to
``{detail: {code, message, ...}}``.
"""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    DutyAssignment,
    DutySlot,
    ExtraDutyBatch,
    ExtraDutyRecord,
    Person,
    PersonCallClusterMembership,
    RotaPeriod,
)
from app.services.extra_duty_hooks import void_extra_duty_records
from app.services.extra_duty_verify import MonthState, check_state, load_month_state
from app.services.leave import BLOCKING_LEAVE_STATUSES
from app.services.reference_registry import audit, lock_namespace
from app.services.rota_eligibility import (
    CODE_CALL_LEVEL,
    CODE_CALL_LEVEL_UNRESOLVED,
    CODE_EXCLUDED_GROUP,
    describe_level,
    eligibility,
    member_call_level,
    describe_levels,
    required_call_levels,
)
from app.services.rota_safety import (
    ACTIVE_ASSIGNMENT_STATUSES,
    SAFETY_HARD_BLOCK,
    SAFETY_WARNING,
    MemberContext,
    slot_leave_blocks,
)
from app.services.rota_template import rule_applies_to_unit

SUPERADMIN_SOURCE = "superadmin_allocation"
LEDGER_CODE = "superadmin_allocation"
LEDGER_LABEL = "Superadmin allocation"
# Strict call level (docs/limits_callevel_fairness_contract.md section 1): only a superadmin may
# cross call level, after an explicit confirmation; the ledger record and batch carry this code.
CROSS_LEVEL_CODE = "superadmin_cross_level"
CROSS_LEVEL_LABEL = "Call level crossed by superadmin"
BATCH_MODE = "superadmin_allocation"
CANCELLED_STATUS = "cancelled"
ALLOWED_PERIOD_STATUSES = {"draft", "published"}
REASON_MIN, REASON_MAX = 5, 500

STRICT_LABELS = {
    "on_leave": "On leave",
    "rest_after_24hr": "Resting after a 24-hour duty",
    "overlapping_duty": "Already on duty",
}
OVERRIDE_LABELS = {
    "call_level_mismatch": "Call level does not match the duty",
    "not_in_group": "Not in the duty's eligibility group",
    "excluded_group": "In a group excluded from this duty",
    "unit_rule": "Duty not allowed for this unit",
    "not_posted": "Not posted to the duty's unit",
    "monthly_24hr_limit": "Over monthly 24-hour limit",
    "monthly_weekend_24hr_limit": "Over weekend 24-hour limit",
    "monthly_same_group_limit": "Over monthly limit for this duty type",
    "monthly_same_campus_limit": "Over monthly limit for this campus",
    "unit_safety_hard_block": "Unit short-staffed (hard block)",
    "unit_safety_review": "Unit staffing warning",
    "fairness": "More duties than the call-level average",
}
OVERRIDE_ORDER = list(OVERRIDE_LABELS)


class SuperadminAllocationError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400, extra: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.extra = extra or {}


# ------------------------------------------------------------------------------------ wording


def _day(value: date) -> str:
    return f"{value.day} {value.strftime('%b')}"


def _hm(value: datetime) -> str:
    return value.strftime("%H:%M")


def _duty_label(state: MonthState, slot) -> str:
    rule = state._slot_flags(slot)[0]
    return rule.label if rule is not None and getattr(rule, "label", None) else slot.duty_type


def _user_name(user) -> str | None:
    return (getattr(user, "display_name", None) or getattr(user, "username", None)) if user else None


def _active(assignment: DutyAssignment) -> bool:
    return (assignment.status or "").lower() in ACTIVE_ASSIGNMENT_STATUSES


# ------------------------------------------------------------------------------------ loading


def _load_slot(db: Session, slot_id: UUID) -> DutySlot:
    slot = db.scalar(
        select(DutySlot)
        .where(DutySlot.id == slot_id)
        .options(
            selectinload(DutySlot.assignments).selectinload(DutyAssignment.person),
            selectinload(DutySlot.unit),
            selectinload(DutySlot.rota_period),
        )
    )
    if slot is None:
        raise SuperadminAllocationError("slot_not_found", "Duty slot not found.", 404)
    return slot


def _month_of(slot: DutySlot) -> str:
    return slot.duty_date.strftime("%Y-%m")


def _load_state(db: Session, slot: DutySlot) -> tuple[MonthState, dict[UUID, Person]]:
    """The checker's month state plus every active person (eligibility data preloaded)."""
    state = load_month_state(db, _month_of(slot))
    active = {
        person.id: person
        for person in db.scalars(
            select(Person)
            .where(Person.active_status == "active")
            .options(
                selectinload(Person.call_level_changes),
                selectinload(Person.call_cluster_memberships).selectinload(PersonCallClusterMembership.cluster),
            )
        )
    }
    for person_id, person in active.items():
        state.persons.setdefault(person_id, person)
    return state, active


def _state_slot(state: MonthState, slot: DutySlot) -> DutySlot:
    return next((s for s in state.slots if s.id == slot.id), slot)


# ------------------------------------------------------------------------------- strict rules


def strict_blocks(state: MonthState, person_id: UUID, slot) -> list[dict[str, str]]:
    """Leave, rest after 24-hour duty and double duty for ``person_id`` taking ``slot``.

    ``[{code, label, detail}]``; ``[]`` = allowed. Duties on ``slot`` itself are ignored (the
    current holders are being replaced, and the person may already hold it). Mirrors
    ``MonthState.blockers``: next-day block after a previous-day duty, next-day block of this
    duty, and the minimum gap after any 24-hour duty in both directions (neighbouring months
    included).
    """
    found: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(code: str, detail: str) -> None:
        if detail in seen:
            return
        seen.add(detail)
        found.append({"code": code, "label": STRICT_LABELS[code], "detail": detail})

    day = slot.duty_date
    for leave in state.leaves_by_person.get(person_id, []):
        if leave.starts_on <= day <= leave.ends_on:
            if not slot_leave_blocks(leave, slot):
                continue
            status = (leave.status or "").lower()
            kind = "approved leave" if status in BLOCKING_LEAVE_STATUSES else "leave pending review"
            span = _day(day) if leave.starts_on == leave.ends_on else f"{_day(leave.starts_on)}–{_day(leave.ends_on)}"
            part = "" if (leave.leave_slot or "FULL_DAY").upper() == "FULL_DAY" else f" ({leave.leave_slot})"
            leave_type = f" – {leave.leave_type}" if leave.leave_type else ""
            add("on_leave", f"On {kind} {span}{part}{leave_type}")

    _rule, slot_same_day, slot_next_day = state._slot_flags(slot)
    gap_needed = state.min_gap_hours
    for other in sorted(state.duties_by_person.get(person_id, []), key=lambda d: (d.slot.starts_at, str(d.key))):
        o = other.slot
        if o.id == slot.id:
            continue
        _o_rule, o_same_day, o_next_day = state._slot_flags(o)
        name = f"{_duty_label(state, o)} {_hm(o.starts_at)}–{_hm(o.ends_at)}"
        overlap = o.starts_at < slot.ends_at and slot.starts_at < o.ends_at
        if o.duty_date == day and (slot_same_day or o_same_day or overlap):
            add("overlapping_duty", f"Already on {name} that day")
        elif overlap:
            add("overlapping_duty", f"Already on {name} on {_day(o.duty_date)}, which overlaps this duty")
        if o.duty_date == day - timedelta(days=1) and o_next_day:
            add("rest_after_24hr", f"Resting after 24-hour duty on {_day(o.duty_date)} ({_duty_label(state, o)})")
        if slot_next_day and o.duty_date == day + timedelta(days=1):
            add("rest_after_24hr", f"This 24-hour duty needs rest the next day, but they are on {_duty_label(state, o)} on {_day(o.duty_date)}")
        if overlap:
            continue
        if o.is_24hr and o.ends_at <= slot.starts_at:
            gap = (slot.starts_at - o.ends_at).total_seconds() / 3600
            if gap < gap_needed:
                add("rest_after_24hr", f"Only {gap:g} h of rest after the 24-hour duty on {_day(o.duty_date)} ({_duty_label(state, o)}); needs {gap_needed:g} h")
        if slot.is_24hr and slot.ends_at <= o.starts_at:
            gap = (o.starts_at - slot.ends_at).total_seconds() / 3600
            if gap < gap_needed:
                add("rest_after_24hr", f"Only {gap:g} h of rest before {_duty_label(state, o)} on {_day(o.duty_date)} after this 24-hour duty; needs {gap_needed:g} h")
    order = {"on_leave": 0, "rest_after_24hr": 1, "overlapping_duty": 2}
    found.sort(key=lambda item: order[item["code"]])
    return found


# ---------------------------------------------------------------------------------- overrides


def _month_duties(state: MonthState, person_id: UUID, exclude_slot_id: UUID | None = None) -> list:
    """The person's unique active duties dated in the month (other slots only)."""
    seen: set = set()
    out = []
    for duty in state.duties_by_person.get(person_id, []):
        s = duty.slot
        if s.id == exclude_slot_id or not (state.starts_on <= s.duty_date <= state.ends_on):
            continue
        key = (s.duty_date, s.duty_type, s.starts_at, s.ends_at)
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def _rule_group(state: MonthState, slot) -> str:
    rule = state._slot_flags(slot)[0]
    return rule.group if rule is not None and getattr(rule, "group", None) else slot.duty_type


def _campus(state: MonthState, slot) -> str | None:
    unit = state.units.get(slot.unit_id) if slot.unit_id else None
    return unit.campus if unit is not None else None


def _member_context(state: MonthState, person: Person, slot) -> tuple[MemberContext, bool]:
    """The person's context for ``slot`` (their posting in the slot's unit, else as if posted
    there with their current posting type) and whether they are posted to the slot's unit."""
    contexts = state.contexts(person.id, slot.duty_date)
    in_unit = [c for c in contexts if slot.unit_id is not None and c.unit_id == slot.unit_id]
    if in_unit:
        return in_unit[0], True
    return (
        MemberContext(
            person=person,
            unit_id=slot.unit_id,
            posting_type=(contexts[0].posting_type if contexts else person.call_level or ""),
            day=slot.duty_date,
        ),
        False,
    )


def cross_level(state: MonthState, person: Person, slot) -> dict[str, Any] | None:
    """``None`` when ``person``'s level is in the slot's level set (a pool allows each of its
    levels, docs/call_level_pool_and_balance_contract.md section 1); otherwise
    ``{required_call_level, required_call_levels, person_call_level, warning}``. A duty with
    no level at all is a crossing for everyone. ``required_call_level`` is display only (the
    single level, or ``None`` for a pool or unresolved duty)."""
    rule = state._slot_flags(slot)[0]
    required = required_call_levels(slot, rule, state.groups)
    context, _posted = _member_context(state, person, slot)
    level = member_call_level(context)
    if level in required:
        return None
    name = person.canonical_name
    if not required:
        warning = f"Different call level: this duty has no call level, {name} is {describe_level(level)}"
    else:
        warning = f"Different call level: needs {describe_levels(required)}, {name} is {describe_level(level)}"
    return {
        "required_call_level": next(iter(required)) if len(required) == 1 else None,
        "required_call_levels": sorted(required),
        "person_call_level": level,
        "warning": warning,
    }


class _Overrides:
    """Per-slot data for listing the rules an allocation bypasses (computed once per request)."""

    def __init__(self, db: Session, state: MonthState, slot: DutySlot, active: dict[UUID, Person]):
        self.state = state
        self.slot = slot
        rule = state._slot_flags(slot)[0]
        self.rule = rule
        unit = state.units.get(slot.unit_id) if slot.unit_id else None
        self.unit_rule_blocks = bool(
            rule is not None
            and (rule.allowed_units or rule.excluded_units)
            and (unit is None or not rule_applies_to_unit(rule, unit))
        )
        self.safety = self._slot_safety_status(db, slot)
        # Fairness: the average month duties per call level among active members.
        totals: dict[str, list[int]] = {}
        for person_id, person in active.items():
            totals.setdefault(person.call_level or "", []).append(len(_month_duties(state, person_id, slot.id)))
        self.level_mean = {level: sum(v) / len(v) for level, v in totals.items() if v}

    @staticmethod
    def _slot_safety_status(db: Session, slot: DutySlot) -> str | None:
        try:
            from app.services.rota_assignment import slot_safety_for_assignment

            return str(slot_safety_for_assignment(db, slot).get("safety_status"))
        except Exception:  # noqa: BLE001 - safety is advisory here; never block the dialog
            return None

    def for_person(self, person: Person) -> list[dict[str, str]]:
        state, slot = self.state, self.slot
        codes: dict[str, str] = {}
        context, posted = _member_context(state, person, slot)
        if not posted:
            codes["not_posted"] = OVERRIDE_LABELS["not_posted"]
        decision = eligibility(context, slot, self.rule, state.groups)
        if decision.code in {CODE_CALL_LEVEL, CODE_CALL_LEVEL_UNRESOLVED}:
            codes["call_level_mismatch"] = decision.reason or OVERRIDE_LABELS["call_level_mismatch"]
            # Groups are checked after call level; list them too.
            decision = eligibility(context, slot, self.rule, state.groups, check_call_level=False)
        if not decision.eligible:
            code = "excluded_group" if decision.code == CODE_EXCLUDED_GROUP else "not_in_group"
            codes[code] = decision.reason or OVERRIDE_LABELS[code]
        if self.unit_rule_blocks:
            codes["unit_rule"] = OVERRIDE_LABELS["unit_rule"]

        limits = state.rules.duty_count_limits
        prospective = _month_duties(state, person.id, slot.id) + [slot]
        n24 = sum(1 for s in prospective if s.is_24hr)
        if limits.max_24hr_per_month is not None and n24 > limits.max_24hr_per_month:
            codes["monthly_24hr_limit"] = f"Would be {n24} 24-hour duties this month (limit {limits.max_24hr_per_month})"
        weekend = sum(1 for s in prospective if s.is_24hr and s.duty_date.weekday() >= 5)
        if limits.max_weekend_24hr_per_month is not None and weekend > limits.max_weekend_24hr_per_month:
            codes["monthly_weekend_24hr_limit"] = f"Would be {weekend} weekend 24-hour duties (limit {limits.max_weekend_24hr_per_month})"
        group = _rule_group(state, slot)
        same_group = sum(1 for s in prospective if _rule_group(state, s) == group)
        if limits.max_same_group_per_month is not None and same_group > limits.max_same_group_per_month:
            codes["monthly_same_group_limit"] = f"Would be {same_group} {group} duties (limit {limits.max_same_group_per_month})"
        campus = _campus(state, slot)
        if campus:
            same_campus = sum(1 for s in prospective if _campus(state, s) == campus)
            if limits.max_same_campus_per_month is not None and same_campus > limits.max_same_campus_per_month:
                codes["monthly_same_campus_limit"] = f"Would be {same_campus} duties at {campus} (limit {limits.max_same_campus_per_month})"

        if self.safety == SAFETY_HARD_BLOCK:
            codes["unit_safety_hard_block"] = OVERRIDE_LABELS["unit_safety_hard_block"]
        elif self.safety == SAFETY_WARNING:
            codes["unit_safety_review"] = OVERRIDE_LABELS["unit_safety_review"]

        mean = self.level_mean.get(person.call_level or "")
        current = len(prospective) - 1
        if mean is not None and current > mean:
            codes["fairness"] = f"Already {current} duties this month; the {person.call_level or 'call-level'} average is {mean:.1f}"
        return [{"code": code, "label": codes[code]} for code in OVERRIDE_ORDER if code in codes]


# ------------------------------------------------------------------------------------ options


def _person_unit(state: MonthState, person_id: UUID, slot) -> tuple[UUID | None, str | None]:
    contexts = state.contexts(person_id, slot.duty_date)
    chosen = next((c for c in contexts if c.unit_id == slot.unit_id), contexts[0] if contexts else None)
    if chosen is None:
        return None, None
    unit = state.units.get(chosen.unit_id)
    return chosen.unit_id, unit.name if unit is not None else None


def _slot_payload(state: MonthState, slot: DutySlot) -> dict[str, Any]:
    unit = state.units.get(slot.unit_id) if slot.unit_id else None
    current = sorted(
        (
            {
                "assignment_id": str(a.id),
                "person_id": str(a.person_id),
                "person_name": a.person.canonical_name if a.person is not None else str(a.person_id),
            }
            for a in slot.assignments
            if _active(a)
        ),
        key=lambda row: (row["person_name"].lower(), row["assignment_id"]),
    )
    return {
        "id": str(slot.id),
        "duty_date": slot.duty_date.isoformat(),
        "duty_type": slot.duty_type,
        "duty_label": _duty_label(state, slot),
        "unit_id": str(slot.unit_id) if slot.unit_id else None,
        "unit_name": unit.name if unit is not None else None,
        "call_level": slot.call_level,
        "is_24hr": bool(slot.is_24hr),
        "starts_at": slot.starts_at.isoformat(),
        "ends_at": slot.ends_at.isoformat(),
        "max_assignees": int(slot.max_assignees or 1),
        "period_status": (slot.rota_period.status if slot.rota_period is not None else None),
        "current": current,
    }


def options(db: Session, slot_id: UUID) -> dict[str, Any]:
    """Every active member for ``slot_id`` with strict blocks and the rules they would override.

    ``{slot: {...}, people: [{person_id, person_name, call_level, unit_id, unit_name,
    status: "available"|"cross_level"|"blocked", warning, blocked: [{code, label, detail}],
    overrides: [{code, label}], month_duties, note}]}``; available first, then cross_level
    (a different call level: allowed only with ``confirm_cross_level``), then blocked (leave,
    rest and overlap win over cross_level), each by name. Read-only.
    """
    slot = _load_slot(db, slot_id)
    state, active = _load_state(db, slot)
    s = _state_slot(state, slot)
    overrides = _Overrides(db, state, s, active)
    holders = {a.person_id for a in slot.assignments if _active(a)}
    people: list[dict[str, Any]] = []
    for person_id, person in active.items():
        blocked = strict_blocks(state, person_id, s)
        crossing = cross_level(state, person, s)
        unit_id, unit_name = _person_unit(state, person_id, s)
        people.append(
            {
                "person_id": str(person_id),
                "person_name": person.canonical_name,
                "call_level": person.call_level,
                "unit_id": str(unit_id) if unit_id else None,
                "unit_name": unit_name,
                "status": "blocked" if blocked else "cross_level" if crossing else "available",
                "warning": crossing["warning"] if crossing else None,
                "blocked": blocked,
                "overrides": [] if blocked else overrides.for_person(person),
                "month_duties": len(_month_duties(state, person_id)),
                "note": "Already on this duty" if person_id in holders else None,
            }
        )
    status_order = {"available": 0, "cross_level": 1, "blocked": 2}
    people.sort(key=lambda row: (status_order[row["status"]], (row["person_name"] or "").lower(), row["person_id"]))
    return {"slot": _slot_payload(state, slot), "people": people}


# ----------------------------------------------------------------------------------- allocate


def _clean_reason(reason: str | None) -> str:
    text = (reason or "").strip()
    if not REASON_MIN <= len(text) <= REASON_MAX:
        raise SuperadminAllocationError(
            "invalid_reason", f"Give a reason of {REASON_MIN} to {REASON_MAX} characters.", 422
        )
    return text


def _period_for(db: Session, slot: DutySlot) -> RotaPeriod:
    period = slot.rota_period
    if period is None:
        raise SuperadminAllocationError("no_period", "This duty is not part of a month's rota.", 409)
    if (period.status or "").lower() not in ALLOWED_PERIOD_STATUSES:
        raise SuperadminAllocationError(
            "period_locked", f"This month is {period.status}; only draft or published months can be changed.", 409
        )
    return period


def _justice(db: Session, state: MonthState, person_id: UUID) -> dict[str, Any]:
    from app.services.extra_duty import ledger_balance

    balance = ledger_balance(db, [person_id], state.starts_on).get(person_id, {"count": 0, "last_date": None})
    duties = _month_duties(state, person_id)
    return {
        "ledger_count": int(balance.get("count") or 0),
        "last_extra_date": balance["last_date"].isoformat() if balance.get("last_date") else None,
        "month_duties": len(duties),
        "month_24hr": sum(1 for s in duties if s.is_24hr),
        "rest_hours": None,
    }


def allocate(
    db: Session,
    *,
    slot_id: UUID,
    person_id: UUID,
    reason: str,
    user,
    replace_existing: bool = True,
    confirm_cross_level: bool = False,
) -> dict[str, Any]:
    """Allocate ``person_id`` to ``slot_id`` (superadmin). See the module docstring.

    A person on a different call level (or any person for a duty with no call level)
    needs ``confirm_cross_level=True``; otherwise 409 ``cross_level_confirmation_required``.
    """
    reason = _clean_reason(reason)
    slot = _load_slot(db, slot_id)
    person = db.get(Person, person_id)
    if person is None:
        raise SuperadminAllocationError("person_not_found", "Department member not found.", 404)
    if (person.active_status or "").lower() != "active":
        raise SuperadminAllocationError("inactive_member", f"{person.canonical_name} is not an active member.", 422)
    period = _period_for(db, slot)
    month = _month_of(slot)
    lock_namespace(db, f"extra-duty:{month}")
    db.refresh(slot)
    db.refresh(period)
    period = _period_for(db, slot)
    post_publish = (period.status or "").lower() == "published"

    try:
        state, active = _load_state(db, slot)
        s = _state_slot(state, slot)
        blocked = strict_blocks(state, person.id, s)
        if blocked:
            raise SuperadminAllocationError(
                "strict_blocked",
                f"{person.canonical_name} cannot take this duty: " + "; ".join(item["detail"] for item in blocked) + ".",
                409,
                {"blocked": blocked},
            )
        holders = [a for a in slot.assignments if _active(a)]
        others = [a for a in holders if a.person_id != person.id]
        own_row = next((a for a in slot.assignments if a.person_id == person.id), None)
        if not replace_existing:
            staying = len(others) + 1
            if staying > int(slot.max_assignees or 1):
                raise SuperadminAllocationError(
                    "slot_full",
                    "This duty is already full. Allocate with replace to change who holds it.",
                    409,
                    {"blocked": [{"code": "slot_full", "label": "Duty already full",
                                  "detail": f"{len(others)} of {slot.max_assignees} places taken"}]},
                )
        crossing = cross_level(state, person, s)
        if crossing and not confirm_cross_level:
            raise SuperadminAllocationError(
                "cross_level_confirmation_required",
                f"{crossing['warning']}. Confirm the call-level crossing to allocate.",
                409,
                crossing,
            )
        override_list = _Overrides(db, state, s, active).for_person(person)
        override_codes = [item["code"] for item in override_list]
        ledger_codes = [LEDGER_CODE, *([CROSS_LEVEL_CODE] if crossing else []), *override_codes]
        justice = _justice(db, state, person.id)
        home_unit_id, home_unit_name = _person_unit(state, person.id, s)
        duty_label = _duty_label(state, s)
        unit = state.units.get(slot.unit_id) if slot.unit_id else None

        rows_before = sorted(str(a.id) for a in slot.assignments)
        cancelled: list[dict[str, Any]] = []
        if replace_existing:
            void_extra_duty_records(db, [a.id for a in others], "replaced")
            for a in others:
                cancelled.append(
                    {
                        "assignment_id": str(a.id),
                        "person_id": str(a.person_id),
                        "person_name": a.person.canonical_name if a.person is not None else None,
                        "status_before": a.status,
                    }
                )
                a.status = CANCELLED_STATUS
        override_reason = f"Superadmin allocation: {reason}"
        reused: dict[str, Any] | None = None
        if own_row is not None:
            reused = {
                "assignment_id": str(own_row.id),
                "status_before": own_row.status,
                "source_before": own_row.source,
                "override_reason_before": own_row.override_reason,
            }
            if _active(own_row):
                void_extra_duty_records(db, [own_row.id], "replaced")
            own_row.status = "assigned"
            own_row.source = SUPERADMIN_SOURCE
            own_row.override_reason = override_reason
            assignment = own_row
        else:
            assignment = DutyAssignment(
                duty_slot=slot, person=person, status="assigned", source=SUPERADMIN_SOURCE,
                override_reason=override_reason,
            )
            db.add(assignment)
        db.flush()

        decision = {
            "slot_id": str(slot.id),
            "action": "superadmin_allocation",
            "person_id": str(person.id),
            "person_name": person.canonical_name,
            "duty_date": slot.duty_date.isoformat(),
            "duty_type": slot.duty_type,
            "duty_label": duty_label,
            "starts_at": slot.starts_at.isoformat(),
            "ends_at": slot.ends_at.isoformat(),
            "unit_id": str(slot.unit_id) if slot.unit_id else None,
            "unit_name": unit.name if unit is not None else None,
            "home_unit_id": str(home_unit_id) if home_unit_id else None,
            "home_unit_name": home_unit_name,
            "assigned_unit_id": str(slot.unit_id) if slot.unit_id else None,
            "overridden_rules": ledger_codes,
            "overrides": override_list,
            "cross_level": bool(crossing),
            "cross_level_warning": crossing["warning"] if crossing else None,
            "ledger": True,
            "justice": justice,
            "reason": reason,
            "replaced": [{k: v for k, v in item.items() if k != "status_before"} for item in cancelled],
            "post_publish": post_publish,
            "alternatives": [],
        }
        seed = f"{BATCH_MODE}|{slot.id}|{person.id}|{uuid4()}"
        batch = ExtraDutyBatch(
            rota_period_id=period.id,
            month=month,
            status="applied",
            plan_hash=hashlib.sha256(seed.encode()).hexdigest(),
            context_hash=hashlib.sha256(f"{seed}|context".encode()).hexdigest(),
            rules_revision=None,
            summary={
                "mode": BATCH_MODE,
                "filled": 1,
                "fallback": 0,
                "ledger_records": 1,
                "unfilled": 0,
                "slots_considered": 1,
                "replaced": len(cancelled),
                "by": _user_name(user),
                "reason": reason,
                "post_publish": post_publish,
                "cross_level": bool(crossing),
                "codes": ledger_codes,
            },
            decisions=[decision],
            before_image=[
                {
                    "slot_id": str(slot.id),
                    "unit_id_before": str(slot.unit_id) if slot.unit_id else None,
                    "unit_id_after": str(slot.unit_id) if slot.unit_id else None,
                    "assignment_ids_before": rows_before,
                    "assignment_id": str(assignment.id),
                    "person_id": str(person.id),
                    "source": SUPERADMIN_SOURCE,
                    "cancelled_assignments": cancelled,
                    "reused_row": reused,
                }
            ],
            created_by_id=getattr(user, "id", None),
            created_by_name=_user_name(user),
        )
        db.add(batch)
        db.flush()
        db.add(
            ExtraDutyRecord(
                batch_id=batch.id,
                person_id=person.id,
                assignment_id=assignment.id,
                slot_id=slot.id,
                month=month,
                duty_date=slot.duty_date,
                duty_type=slot.duty_type,
                home_unit_id=home_unit_id,
                assigned_unit_id=slot.unit_id,
                fallback_used=False,
                overridden_rules=ledger_codes,
                justice=justice,
                reason=f"{LEDGER_LABEL} by {_user_name(user) or 'superadmin'}: {reason}",
                status="active",
            )
        )
        audit(
            db,
            user,
            "superadmin_allocation",
            assignment.id,
            {
                "batch_id": str(batch.id),
                "slot_id": str(slot.id),
                "month": month,
                "duty_date": slot.duty_date.isoformat(),
                "duty_type": slot.duty_type,
                "person_id": str(person.id),
                "person_name": person.canonical_name,
                "overrides": override_codes,
                "cross_level": crossing,
                "replaced": decision["replaced"],
                "reason": reason,
                "post_publish": post_publish,
            },
        )
        db.flush()
        # Post-write check with the independent checker: the new assignment must not break
        # leave, rest, double booking or capacity (it is exempt from the rest by source).
        db.expire_all()
        check = check_state(load_month_state(db, month, state.rules), [assignment.id])
        if not check["ok"]:
            raise SuperadminAllocationError(
                "verification_failed",
                "A post-write check found a strict-rule problem; nothing was saved.",
                500,
                {"violations": check["violations"]},
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {
        "assignment_id": str(assignment.id),
        "batch_id": str(batch.id),
        "slot_id": str(slot.id),
        "person_id": str(person.id),
        "person_name": person.canonical_name,
        "overrides": override_list,
        "replaced": decision["replaced"],
        "post_publish": post_publish,
        "cross_level": bool(crossing),
        "warning": crossing["warning"] if crossing else None,
    }


# --------------------------------------------------------------------------------------- undo


def undo(db: Session, batch_id: UUID, user, dry_run: bool = False) -> dict[str, Any]:
    """Undo one superadmin allocation: remove (or revert) its assignment, void its ledger record
    ("undone") and restore the cancelled holders to their earlier status.

    Refuses with 409 ``undo_conflict`` when the allocation was changed since, or a holder can
    no longer be restored (row gone, reactivated, or now blocked by leave/rest/double duty).
    Allowed on draft and published months (a published undo is itself a post-publish change).
    """
    batch = db.get(ExtraDutyBatch, batch_id)
    if batch is None or (batch.summary or {}).get("mode") != BATCH_MODE:
        raise SuperadminAllocationError("not_found", "Superadmin allocation not found.", 404)
    lock_namespace(db, f"extra-duty:{batch.month}")
    db.refresh(batch)
    if batch.status == "undone":
        return {"batch_id": str(batch.id), "restored": 0, "removed": 0, "conflicts": [], "dry_run": dry_run,
                "already_undone": True}
    period = db.get(RotaPeriod, batch.rota_period_id)
    if period is None or (period.status or "").lower() not in ALLOWED_PERIOD_STATUSES:
        raise SuperadminAllocationError("period_locked", "This month can no longer be changed.", 409)

    conflicts: list[dict[str, Any]] = []
    items = list(batch.before_image or [])
    work: list[tuple[dict, DutyAssignment | None, list[tuple[dict, DutyAssignment]]]] = []
    for item in items:
        slot = db.get(DutySlot, UUID(item["slot_id"]))
        assignment = db.get(DutyAssignment, UUID(item["assignment_id"]))

        def conflict(code: str, message: str) -> None:
            conflicts.append({"slot_id": item["slot_id"], "code": code, "message": message, "reason": message})

        if slot is None:
            conflict("slot_missing", "The duty slot no longer exists.")
            continue
        if (
            assignment is None
            or not _active(assignment)
            or str(assignment.person_id) != item.get("person_id")
            or assignment.source != SUPERADMIN_SOURCE
        ):
            conflict("assignment_changed", "The superadmin allocation was cleared or changed since.")
        restores: list[tuple[dict, DutyAssignment]] = []
        state = None
        for holder in item.get("cancelled_assignments") or []:
            row = db.get(DutyAssignment, UUID(holder["assignment_id"]))
            who = holder.get("person_name") or holder["person_id"]
            if row is None:
                conflict("holder_missing", f"{who}'s earlier assignment no longer exists.")
                continue
            if (row.status or "").lower() != CANCELLED_STATUS:
                conflict("holder_changed", f"{who}'s earlier assignment was changed since.")
                continue
            if state is None:
                state = load_month_state(db, batch.month)
            s = next((x for x in state.slots if x.id == slot.id), slot)
            for block in strict_blocks(state, row.person_id, s):
                conflict("holder_blocked", f"{who} cannot be put back: {block['detail']}.")
            # Strict call level: a restore must not create a crossing (e.g. after a promotion).
            holder_person = state.persons.get(row.person_id) or row.person
            if row.source != SUPERADMIN_SOURCE and holder_person is not None:
                crossing = cross_level(state, holder_person, s)
                if crossing:
                    conflict("holder_call_level", f"{who} cannot be put back: {crossing['warning']}.")
            restores.append((holder, row))
        others = [
            a for a in slot.assignments
            if _active(a) and str(a.id) != item["assignment_id"]
            and str(a.id) not in {h["assignment_id"] for h in item.get("cancelled_assignments") or []}
        ]
        if restores and len(others) + len(restores) > int(slot.max_assignees or 1):
            conflict("slot_has_new_assignments", "Other members were assigned to this duty since.")
        work.append((item, assignment, restores))

    restored = sum(len(r) for _i, _a, r in work)
    if dry_run:
        return {"batch_id": str(batch.id), "restored": 0 if conflicts else restored, "would_restore": restored,
                "conflicts": conflicts, "dry_run": True}
    if conflicts:
        raise SuperadminAllocationError(
            "undo_conflict", "This allocation changed since; undo would not be exact.", 409, {"conflicts": conflicts}
        )
    try:
        removed_ids: list[UUID] = []
        for item, assignment, restores in work:
            void_extra_duty_records(db, [assignment.id], "undone")
            reused = item.get("reused_row")
            if reused:
                assignment.status = reused.get("status_before") or "assigned"
                assignment.source = reused.get("source_before") or assignment.source
                assignment.override_reason = reused.get("override_reason_before")
            else:
                removed_ids.append(assignment.id)
                db.delete(assignment)
            db.flush()
            for holder, row in restores:
                row.status = holder.get("status_before") or "assigned"
        batch.status = "undone"
        batch.undone_at = datetime.utcnow()
        batch.undone_by_name = _user_name(user)
        audit(db, user, "superadmin_allocation_undo", batch.id,
              {"batch_id": str(batch.id), "month": batch.month, "restored": restored,
               "removed_assignment_ids": [str(i) for i in removed_ids]})
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"batch_id": str(batch.id), "restored": restored, "removed": len(removed_ids), "conflicts": [],
            "dry_run": False}


__all__ = [
    "SUPERADMIN_SOURCE",
    "LEDGER_CODE",
    "LEDGER_LABEL",
    "CROSS_LEVEL_CODE",
    "cross_level",
    "SuperadminAllocationError",
    "allocate",
    "options",
    "strict_blocks",
    "undo",
]
