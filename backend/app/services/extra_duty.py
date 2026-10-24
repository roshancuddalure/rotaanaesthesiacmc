"""Extra-duty layer: fill the month's still-open draft slots, never breaking a strict rule.

Built to docs/extra_duty_contract.md (sections 1-3). Stage order: Build template ->
Autoassign members -> **Extra-duty layer** -> Review -> Publish.

* ``strict_blockers`` is the single strict check (contract 1.1): active member, posted to the
  candidate unit, ``rota_eligibility.eligibility`` (call level + groups, unchanged), every
  active-status leave, same-day block / time overlap, previous-day and next-day 24h blocks,
  the 24h rest gap in both directions (across month boundaries) and slot capacity. Provisional
  assignments placed earlier in the same plan count.
* Rules the layer may break (contract 1.2) are read from ``validate_assignment`` run against
  the plan state (so the codes are exactly the ones manual assignment shows) and recorded in
  the justice ledger (``ExtraDutyRecord``) when any was broken.
* ``plan_extra_duties`` is deterministic: hardest slot first, home unit then fallback units,
  people ranked by the justice key (contract 1.3.4). The ledger only affects this layer.
* ``apply`` re-plans under an advisory lock, refuses a stale preview, writes everything in
  one transaction and re-checks the new assignments before committing.

Services raise ``ExtraDutyError``; the HTTP layer maps it to ``{detail: {code, message, ...}}``.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
from calendar import monthrange
from collections import Counter, defaultdict
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app.models import (
    DutyAssignment,
    DutySlot,
    ExtraDutyBatch,
    ExtraDutyRecord,
    MonthlyGenerationScope,
    Person,
    PersonCallClusterMembership,
    RotaComputeJob,
    RotaPeriod,
    Unit,
    UnitFallback,
)
from app.services.history_fairness import unique_assignments
from app.services.leave import ACTIVE_LEAVE_STATUSES, BLOCKING_LEAVE_STATUSES, month_bounds
from app.services.reference_registry import lock_namespace
from app.services.rota_assignment import validate_assignment
from app.services.rota_eligibility import (
    call_level_missing_message,
    eligibility,
    eligibility_issue_code,
    required_call_levels,
)
from app.services.rota_rules import RotaPhaseOneRules, get_phase_one_rules
from app.services.rota_safety import (
    ACTIVE_ASSIGNMENT_STATUSES,
    SAFETY_HARD_BLOCK,
    MemberContext,
    assignments_for_month,
    duty_blocks_same_day,
    leaves_by_day_and_person,
    member_contexts_for_day,
    postings_for_month,
    previous_day_24hr_blocks,
    rule_for_slot,
    rules_groups,
    slot_leave_blocks,
    slot_safety,
)
from app.services.rota_setup import SCOPE_INCLUDED
from app.services.rota_template import rule_applies_to_unit, template_slots_for_period

EXTRA_DUTY_SOURCE = "extra_duty_layer"

# Contract 1.1 — never broken.
STRICT_CODES = {
    "inactive_member",
    "not_in_unit",
    "call_level_mismatch",
    "call_level_unresolved",
    "call_subgroup_mismatch",
    "leave",
    "same_day_duty",
    "post_24hr_rest",
    "pre_24hr_rest",
    "rest_gap",
    "slot_full",
    "unit_rule",
}
# Not a rota rule: the (slot, person) pair already has a non-active row and the database
# allows one row per pair, so the layer cannot add a second one. Only checked for new choices.
EXISTING_ROW_CODE = "existing_assignment_row"

# Contract 1.2 — may be broken; recorded in the ledger. Fairness is never a validation code.
OVERRIDABLE_CODES = {
    "unit_safety_hard_block",
    "unit_safety_review",
    "monthly_24hr_limit",
    "monthly_weekend_24hr_limit",
    "monthly_same_group_limit",
    "monthly_same_campus_limit",
}

# Not validation codes: special allocations that always earn a ledger record. Appended after
# the validate_assignment codes. Covering a duty from a fallback unit is one (owner decision).
FALLBACK_UNIT_CODE = "fallback_unit"
# Fill-all ("all_units" mode, docs/extra_duty_fill_all_contract.md section 3) adds three more.
ANY_UNIT_CODE = "any_unit"
OUTSIDE_SCOPE_CODE = "outside_scope_unit"
UNPOSTED_CODE = "unposted_member"
# docs/superadmin_override_contract.md: a superadmin allocation counts in the justice ledger.
SUPERADMIN_SOURCE = "superadmin_allocation"
SUPERADMIN_CODE = "superadmin_allocation"
# docs/limits_callevel_fairness_contract.md 1: a confirmed superadmin call-level crossing.
SUPERADMIN_CROSS_LEVEL_CODE = "superadmin_cross_level"
# docs/balance_extra_duties_contract.md 1/2: an extra duty Balance duties passed on to a holder
# who triggers no other override code.
REBALANCED_CODE = "rebalanced_extra_duty"
LEDGER_ONLY_CODES = {
    FALLBACK_UNIT_CODE,
    ANY_UNIT_CODE,
    OUTSIDE_SCOPE_CODE,
    UNPOSTED_CODE,
    SUPERADMIN_CODE,
    SUPERADMIN_CROSS_LEVEL_CODE,
    REBALANCED_CODE,
}
LEDGER_CODES = OVERRIDABLE_CODES | LEDGER_ONLY_CODES
LEDGER_CODE_LABELS = {
    FALLBACK_UNIT_CODE: "Covered a duty for another unit",
    ANY_UNIT_CODE: "Covered from another unit",
    OUTSIDE_SCOPE_CODE: "Covered from a unit outside this month's scope",
    UNPOSTED_CODE: "Member has no posting this month",
    SUPERADMIN_CODE: "Superadmin allocation",
    SUPERADMIN_CROSS_LEVEL_CODE: "Call level crossed by superadmin",
    REBALANCED_CODE: "Extra duty passed on by Balance duties",
}
# Strict checks a superadmin allocation may override (superadmin contract §1); leave, rest,
# overlap and capacity still apply to it.
SUPERADMIN_EXEMPT_CODES = frozenset(
    {
        "inactive_member",
        "not_in_unit",
        "call_level_mismatch",
        "call_level_unresolved",
        "call_subgroup_mismatch",
        "unit_rule",
    }
)

# The individual duty limits (may be exceeded, always reported).
LIMIT_CODES = (
    "monthly_24hr_limit",
    "monthly_weekend_24hr_limit",
    "monthly_same_group_limit",
    "monthly_same_campus_limit",
)
LIMIT_LABELS = {
    "monthly_24hr_limit": "24-hour",
    "monthly_weekend_24hr_limit": "Weekend 24-hour",
    "monthly_same_group_limit": "Same duty type",
    "monthly_same_campus_limit": "Same campus",
}

# Modes (fill-all contract section 2) and the all-units candidate tiers (section 3), in order.
MODE_STANDARD = "standard"
MODE_ALL_UNITS = "all_units"
MODES = (MODE_STANDARD, MODE_ALL_UNITS)
TIERS = ("home", "fallback", "same_campus", "any_unit", "outside_scope", "unposted")
TIER_CODES = {
    "fallback": FALLBACK_UNIT_CODE,
    "same_campus": FALLBACK_UNIT_CODE,
    "any_unit": ANY_UNIT_CODE,
    "outside_scope": OUTSIDE_SCOPE_CODE,
    "unposted": UNPOSTED_CODE,
}
CROSS_UNIT_TIERS = {"fallback", "same_campus", "any_unit", "outside_scope"}

# Why a slot stays open (fill-all contract section 4).
CAUSE_LABELS = {
    "no_member_at_level": "No active member of this call level and group",
    "unit_rule": "The duty's unit rules exclude every unit with suitable members",
    "all_on_leave": "Every suitable member is on leave",
    "all_resting": "Every suitable member is resting around a 24-hour duty",
    "all_double_booked": "Every suitable member is already on duty that day",
    "other": "Suitable members are busy or cannot be reached",
}
CAUSE_ORDER = list(CAUSE_LABELS)

STRICT_ORDER = [
    "inactive_member",
    "not_in_unit",
    "call_level_mismatch",
    "call_level_unresolved",
    "call_subgroup_mismatch",
    "unit_rule",
    "leave",
    "same_day_duty",
    "post_24hr_rest",
    "pre_24hr_rest",
    "rest_gap",
    "slot_full",
    EXISTING_ROW_CODE,
]

STRICT_LABELS = {
    "inactive_member": "Member is not active",
    "not_in_unit": "Not posted to this unit on the duty date",
    "call_level_mismatch": "Wrong call level for this duty",
    "call_level_unresolved": "This duty has no call level; set one in Rota Rules",
    "call_subgroup_mismatch": "Not in the duty's eligibility group",
    "unit_rule": "Duty not allowed for this unit",
    "leave": "On leave",
    "same_day_duty": "Already on another duty that day",
    "post_24hr_rest": "Resting after a 24-hour duty the day before",
    "pre_24hr_rest": "Has a duty the next day (this 24-hour duty blocks it)",
    "rest_gap": "Too little rest around a 24-hour duty",
    "slot_full": "The slot is already full",
    EXISTING_ROW_CODE: "Already has an earlier entry on this slot",
}

# Short words for the "cannot be filled" reason ("UNIT I: 3 on leave, 2 resting after 24h").
REASON_WORDS = {
    "inactive_member": "inactive",
    "not_in_unit": "not posted",
    "call_level_mismatch": "wrong call level",
    "call_level_unresolved": "duty has no call level",
    "call_subgroup_mismatch": "not in the duty's group",
    "unit_rule": "duty not allowed in this unit",
    "leave": "on leave",
    "same_day_duty": "already on duty that day",
    "post_24hr_rest": "resting after 24h",
    "pre_24hr_rest": "on duty the next day",
    "rest_gap": "short rest around a 24h duty",
    "slot_full": "slot full",
    EXISTING_ROW_CODE: "already listed on this slot",
}

LEDGER_MONTHS = 12
STALE_PROPOSAL_AGE = timedelta(hours=2)  # same expiry as rota_compute.create_job
HISTORY_DAYS_BACK = 35  # for the "rest since previous duty" justice key


class ExtraDutyError(Exception):
    """A contract error (section 4 table). ``extra`` is merged into the HTTP detail."""

    def __init__(
        self, code: str, message: str, status_code: int = 409, extra: dict | None = None
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.extra = dict(extra or {})


# --------------------------------------------------------------------------------------------
# Context and the strict check
# --------------------------------------------------------------------------------------------


@dataclass
class _Entry:
    """One active assignment (saved or provisional) reduced to what the strict check needs."""

    assignment_id: UUID | None
    person_id: UUID
    slot_id: UUID
    duty_date: date
    duty_type: str
    starts_at: datetime
    ends_at: datetime
    is_24hr: bool
    unit_id: UUID | None
    blocks_same_day: bool
    blocks_next_day: bool
    provisional: bool = False

    @property
    def key(self) -> tuple:
        return (self.person_id, self.duty_date, self.duty_type, self.starts_at, self.ends_at)


def _block_flags(rules: RotaPhaseOneRules, slot, cache: dict | None = None) -> tuple[bool, bool]:
    """``(duty_blocks_same_day, previous_day_24hr_blocks)`` for ``slot``; both depend only on
    ``(duty_type, is_24hr)`` and the rules, so ``cache`` (per context) memoises them."""
    key = (slot.duty_type, bool(slot.is_24hr))
    if cache is not None and key in cache:
        return cache[key]
    flags = (duty_blocks_same_day(slot, rules), previous_day_24hr_blocks(slot, rules))
    if cache is not None:
        cache[key] = flags
    return flags


def _entry(rules, slot, person_id, assignment_id, unit_id, provisional=False, cache=None) -> _Entry:
    blocks_same_day, blocks_next_day = _block_flags(rules, slot, cache)
    return _Entry(
        assignment_id=assignment_id,
        person_id=person_id,
        slot_id=slot.id,
        duty_date=slot.duty_date,
        duty_type=slot.duty_type,
        starts_at=slot.starts_at,
        ends_at=slot.ends_at,
        is_24hr=bool(slot.is_24hr),
        unit_id=unit_id,
        blocks_same_day=blocks_same_day,
        blocks_next_day=blocks_next_day,
        provisional=provisional,
    )


class ExtraDutyContext:
    """Everything the strict check needs for one month, loaded with a handful of queries.

    ``slots`` are the month's template slots; ``entries_by_person`` holds active assignments
    from ``HISTORY_DAYS_BACK`` days before the month to the rest window after it.
    """

    def __init__(
        self,
        *,
        month: str,
        rules: RotaPhaseOneRules,
        postings: list,
        leaves: dict,
        assignments: Iterable[DutyAssignment],
        slots: list[DutySlot],
        units: dict[UUID, Unit],
    ) -> None:
        self.month = month
        self.starts_on, self.ends_on = month_bounds(month)
        self.rules = rules
        self.groups = rules_groups(rules)
        self.rule_by_key = rules.duty_rules_by_key  # rule_for_slot rebuilds this dict per call
        self.flag_cache: dict = {}
        self.min_gap_hours = float(rules.rest_rules.minimum_gap_after_24hr_hours)
        self.postings = postings
        self.leaves = leaves
        self.slots = slots
        self.slot_by_id = {slot.id: slot for slot in slots}
        self.units = units
        self.persons: dict[UUID, Person] = {}
        for posting in postings:
            self.persons.setdefault(posting.person_id, posting.person)
        self.entries_by_person: dict[UUID, list[_Entry]] = defaultdict(list)
        for assignment in assignments:
            self.persons.setdefault(assignment.person_id, assignment.person)
            slot = assignment.duty_slot
            self.entries_by_person[assignment.person_id].append(
                _entry(rules, slot, assignment.person_id, assignment.id, slot.unit_id, cache=self.flag_cache)
            )
        self.slot_active: Counter = Counter()
        self.slot_rows: dict[UUID, set[UUID]] = defaultdict(set)
        for slot in slots:
            for assignment in slot.assignments:
                self.slot_rows[slot.id].add(assignment.person_id)
                self.persons.setdefault(assignment.person_id, assignment.person)
                if assignment.status.lower() in ACTIVE_ASSIGNMENT_STATUSES:
                    self.slot_active[slot.id] += 1
        self._day_units: dict[date, dict[UUID, dict[UUID, list]]] = {}
        self._day_people: dict[date, dict[UUID, set[UUID]]] = {}
        self._eligibility: dict[tuple, tuple[str, str | None] | None] = {}
        self._unit_rule: dict[tuple, bool] = {}
        # Every active member (``load_people``); the fill-all "unposted" tier and the
        # unfilled-cause diagnosis draw from it.
        self.active_people: dict[UUID, Person] = {}

    def _day(self, day: date) -> None:
        if day in self._day_units:
            return
        by_unit: dict = defaultdict(lambda: defaultdict(list))
        people: dict[UUID, set[UUID]] = defaultdict(set)
        for context in member_contexts_for_day(self.postings, day):
            by_unit[context.unit_id][context.person.id].append(context)
            people[context.person.id].add(context.unit_id)
        self._day_units[day] = by_unit
        self._day_people[day] = people

    def unit_contexts(self, day: date, unit_id: UUID | None) -> dict[UUID, list]:
        """``person_id -> [MemberContext]`` for people posted to ``unit_id`` on ``day``."""
        if unit_id is None:
            return {}
        self._day(day)
        return self._day_units[day].get(unit_id, {})

    def person_units(self, day: date) -> dict[UUID, set[UUID]]:
        """``person_id -> {unit ids}`` the (active) person is posted to on ``day``."""
        self._day(day)
        return self._day_people[day]

    def load_people(self, db: Session) -> None:
        """Every active member, with what eligibility reads preloaded (one query)."""
        if self.active_people:
            return
        rows = db.scalars(
            select(Person)
            .where(Person.active_status == "active")
            .options(
                selectinload(Person.call_level_changes),
                selectinload(Person.call_cluster_memberships).selectinload(
                    PersonCallClusterMembership.cluster
                ),
            )
        )
        for person in rows:
            self.active_people[person.id] = person
            self.persons.setdefault(person.id, person)

    def eligibility_block(
        self, person_id: UUID, slot, unit_id: UUID | None, allow_unposted: bool = False
    ) -> tuple[str, str | None] | None:
        """``None`` when the person may do the duty in ``unit_id`` (call level and groups);
        ``("not_in_unit", None)`` without a usable posting; else ``(code, label)``.

        ``allow_unposted``: a member with no posting at all on the date is judged on their own
        call level (as if posted to ``unit_id``). Memoised per (person, unit, duty, day)."""
        day = slot.duty_date
        key = (person_id, unit_id, allow_unposted, slot.duty_type, slot.call_level, day)
        if key in self._eligibility:
            return self._eligibility[key]
        contexts = self.unit_contexts(day, unit_id).get(person_id, [])
        if not contexts and allow_unposted:
            person = self.persons.get(person_id)
            if (
                person is not None
                and person.active_status == "active"
                and person_id not in self.person_units(day)
            ):
                contexts = [
                    MemberContext(
                        person=person, unit_id=unit_id, posting_type=person.call_level or "", day=day
                    )
                ]
        if not contexts:
            result: tuple[str, str | None] | None = ("not_in_unit", None)
        else:
            rule = self.rule_by_key.get(slot.duty_type)  # == rule_for_slot(slot, rules)
            decisions = [eligibility(context, slot, rule, self.groups) for context in contexts]
            if any(decision.eligible for decision in decisions):
                result = None
            else:
                first = decisions[0]
                code = eligibility_issue_code(first)
                result = (code, f"{first.reason}." if first.reason else None)
        self._eligibility[key] = result
        return result

    def unit_rule_blocks(self, slot, unit_id: UUID | None) -> bool:
        """The duty's unit rules (``allowed_units``/``excluded_units``) refuse ``unit_id``."""
        key = (slot.duty_type, unit_id)
        cached = self._unit_rule.get(key)
        if cached is None:
            rule = self.rule_by_key.get(slot.duty_type)
            if rule is None or not (rule.allowed_units or rule.excluded_units):
                cached = False
            else:
                unit = self.units.get(unit_id) if unit_id is not None else None
                cached = unit is None or not rule_applies_to_unit(rule, unit)
            self._unit_rule[key] = cached
        return cached

    def add_plan_assignment(self, slot, person_id: UUID, unit_id: UUID | None) -> None:
        self.entries_by_person[person_id].append(
            _entry(self.rules, slot, person_id, None, unit_id, provisional=True, cache=self.flag_cache)
        )
        self.slot_active[slot.id] += 1
        self.slot_rows[slot.id].add(person_id)


def _hours(delta: timedelta) -> float:
    return delta.total_seconds() / 3600


def strict_blockers(
    ctx: ExtraDutyContext,
    person_id: UUID,
    slot,
    unit_id: UUID | None,
    *,
    exclude_assignment_id: UUID | None = None,
    first_only: bool = False,
    allow_unposted: bool = False,
) -> list[dict[str, str]]:
    """Strict rules (contract 1.1) person ``person_id`` breaks by doing ``slot`` in ``unit_id``.

    ``[]`` means strictly feasible. Each item is ``{code, label}``, in the contract's order, one
    per code. ``exclude_assignment_id`` checks an existing assignment (``verify_month``): that
    assignment (and its de-duplicated twin) is left out, and capacity allows it.
    ``allow_unposted`` (fill-all tier 6 and its ledgered assignments) waives the posted-to-unit
    check for a member with no posting at all on the date; everything else still applies,
    including ``unit_rule`` (the duty's allowed/excluded units on ``unit_id``).
    """
    found: list[dict[str, str]] = []

    def add(code: str, label: str | None = None) -> bool:
        if all(item["code"] != code for item in found):
            found.append({"code": code, "label": label or STRICT_LABELS[code]})
        return first_only

    person = ctx.persons.get(person_id)
    if person is None or person.active_status != "active":
        if add("inactive_member"):
            return found
    blocked = ctx.eligibility_block(person_id, slot, unit_id, allow_unposted)
    if blocked is not None:
        if add(blocked[0], blocked[1]):
            return found
    if ctx.unit_rule_blocks(slot, unit_id):
        if add("unit_rule"):
            return found
    for leave in ctx.leaves.get(slot.duty_date, {}).get(person_id, []):
        if leave.status.lower() in ACTIVE_LEAVE_STATUSES and slot_leave_blocks(leave, slot):
            label = (
                "On approved leave"
                if leave.status.lower() in BLOCKING_LEAVE_STATUSES
                else "Leave pending review (still blocks)"
            )
            if add("leave", label):
                return found
            break

    own_key = None
    if exclude_assignment_id is not None:
        own_key = (person_id, slot.duty_date, slot.duty_type, slot.starts_at, slot.ends_at)
    slot_blocks_same_day, slot_blocks_next_day = _block_flags(ctx.rules, slot, ctx.flag_cache)
    codes: set[str] = set()
    previous_day = slot.duty_date - timedelta(days=1)
    next_day = slot.duty_date + timedelta(days=1)
    for other in ctx.entries_by_person.get(person_id, []):
        if other.slot_id == slot.id:
            continue
        if exclude_assignment_id is not None and (
            other.assignment_id == exclude_assignment_id or other.key == own_key
        ):
            continue
        if other.duty_date == slot.duty_date and (slot_blocks_same_day or other.blocks_same_day):
            codes.add("same_day_duty")
        if other.starts_at < slot.ends_at and other.ends_at > slot.starts_at:
            codes.add("same_day_duty")
        if other.duty_date == previous_day and other.blocks_next_day:
            codes.add("post_24hr_rest")
        if slot_blocks_next_day and other.duty_date == next_day:
            codes.add("pre_24hr_rest")
        if other.is_24hr and other.ends_at <= slot.starts_at:
            if _hours(slot.starts_at - other.ends_at) < ctx.min_gap_hours:
                codes.add("rest_gap")
        if slot.is_24hr and slot.ends_at <= other.starts_at:
            if _hours(other.starts_at - slot.ends_at) < ctx.min_gap_hours:
                codes.add("rest_gap")
    for code in ("same_day_duty", "post_24hr_rest", "pre_24hr_rest", "rest_gap"):
        if code in codes and add(code):
            return found

    active = ctx.slot_active.get(slot.id, 0) - (1 if exclude_assignment_id is not None else 0)
    if active >= int(slot.max_assignees or 1):
        if add("slot_full"):
            return found
    if exclude_assignment_id is None and person_id in ctx.slot_rows.get(slot.id, set()):
        add(EXISTING_ROW_CODE)
    return found


# --------------------------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------------------------


def _period_and_scope(db: Session, month: str) -> tuple[RotaPeriod | None, MonthlyGenerationScope | None]:
    starts_on, ends_on = month_bounds(month)
    period = db.scalar(
        select(RotaPeriod).where(RotaPeriod.starts_on == starts_on, RotaPeriod.ends_on == ends_on)
    )
    if period is None:
        return None, None
    scope = db.scalar(
        select(MonthlyGenerationScope).where(MonthlyGenerationScope.rota_period_id == period.id)
    )
    return period, scope


def _draft_period(db: Session, month: str) -> tuple[RotaPeriod, MonthlyGenerationScope]:
    period, scope = _period_and_scope(db, month)
    if period is None:
        raise ExtraDutyError(
            "scope_unlocked", "Set up the month, lock its unit scope and build the template first."
        )
    if period.status.lower() != "draft":
        raise ExtraDutyError(
            "not_draft", "Only an unpublished draft month can use the extra-duty layer."
        )
    if scope is None or not scope.is_locked:
        raise ExtraDutyError(
            "scope_unlocked", "Lock the month's unit scope and build the template first."
        )
    return period, scope


def _rest_window_days(rules: RotaPhaseOneRules) -> int:
    return math.ceil((rules.rest_rules.minimum_gap_after_24hr_hours + 48) / 24) + 2


def build_context(
    db: Session,
    month: str,
    period: RotaPeriod,
    rules: RotaPhaseOneRules,
    *,
    postings: list | None = None,
    leaves: dict | None = None,
) -> ExtraDutyContext:
    """Preload the month for ``strict_blockers`` (no per-slot queries)."""
    starts_on, ends_on = month_bounds(month)
    if postings is None:
        postings = postings_for_month(db, starts_on, ends_on)
    if leaves is None:
        leaves = leaves_by_day_and_person(db, month)
    window = _rest_window_days(rules)
    assignments = unique_assignments(
        a
        for a in assignments_for_month(
            db,
            starts_on - timedelta(days=max(HISTORY_DAYS_BACK, window)),
            ends_on + timedelta(days=window),
        )
        if a.status.lower() in ACTIVE_ASSIGNMENT_STATUSES
    )
    slots = template_slots_for_period(db, period.id)
    units = {unit.id: unit for unit in db.scalars(select(Unit))}
    return ExtraDutyContext(
        month=month,
        rules=rules,
        postings=postings,
        leaves=leaves,
        assignments=assignments,
        slots=slots,
        units=units,
    )


# --------------------------------------------------------------------------------------------
# Ledger helpers
# --------------------------------------------------------------------------------------------


def _months_before(day: date, months: int) -> date:
    index = day.year * 12 + day.month - 1 - months
    year, month = index // 12, index % 12 + 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))


def lookback_months(rules: Any) -> int:
    """``extra_duty_rules.justice_lookback_months`` (Limits), default 12."""
    value = getattr(getattr(rules, "extra_duty_rules", None), "justice_lookback_months", None)
    return LEDGER_MONTHS if value is None else int(value)


def ledger_balance(
    db: Session,
    person_ids: Iterable[UUID],
    before: date,
    months: int | None = None,
    *,
    rules: Any = None,
) -> dict[UUID, dict[str, Any]]:
    """Active ledger records with ``duty_date`` in ``[before - months, before)`` per person:
    ``{person_id: {count, last_date}}`` (every requested person is present). Without
    ``months`` the look-back is the Limits setting ``justice_lookback_months`` (default 12),
    read from ``rules`` or the saved rules."""
    ids = list(dict.fromkeys(person_ids))
    result: dict[UUID, dict[str, Any]] = {pid: {"count": 0, "last_date": None} for pid in ids}
    if not ids:
        return result
    if months is None:
        if rules is None:
            _version, rules = get_phase_one_rules(db)
        months = lookback_months(rules)
    since = _months_before(before, months)
    rows = db.execute(
        select(ExtraDutyRecord.person_id, ExtraDutyRecord.duty_date).where(
            ExtraDutyRecord.person_id.in_(ids),
            ExtraDutyRecord.status == "active",
            ExtraDutyRecord.duty_date >= since,
            ExtraDutyRecord.duty_date < before,
        )
    )
    for person_id, duty_date in rows:
        row = result.setdefault(person_id, {"count": 0, "last_date": None})
        row["count"] += 1
        if row["last_date"] is None or duty_date > row["last_date"]:
            row["last_date"] = duty_date
    return result


def void_records_for_assignments(db: Session, assignment_ids: Iterable[UUID | str], reason: str) -> int:
    """Void the active ledger records of these assignments (no commit). Idempotent: returns how
    many records changed now."""
    ids = list({UUID(str(item)) for item in assignment_ids if item is not None})
    if not ids:
        return 0
    result = db.execute(
        update(ExtraDutyRecord)
        .where(ExtraDutyRecord.assignment_id.in_(ids), ExtraDutyRecord.status == "active")
        .values(status="void", void_reason=reason, voided_at=datetime.utcnow())
        .execution_options(synchronize_session="fetch")
    )
    return int(result.rowcount or 0)


def _record_row(record: ExtraDutyRecord, persons: dict, units: dict) -> dict[str, Any]:
    person = persons.get(record.person_id)
    home = units.get(record.home_unit_id)
    assigned = units.get(record.assigned_unit_id)
    return {
        "id": str(record.id),
        "batch_id": str(record.batch_id),
        "person_id": str(record.person_id),
        "person_name": person.canonical_name if person else None,
        "assignment_id": str(record.assignment_id),
        "slot_id": str(record.slot_id),
        "month": record.month,
        "duty_date": record.duty_date.isoformat(),
        "duty_type": record.duty_type,
        "home_unit_id": str(record.home_unit_id) if record.home_unit_id else None,
        "home_unit": home.name if home else None,
        "assigned_unit_id": str(record.assigned_unit_id) if record.assigned_unit_id else None,
        "assigned_unit": assigned.name if assigned else None,
        "fallback_used": bool(record.fallback_used),
        "overridden_rules": list(record.overridden_rules or []),
        "justice": dict(record.justice or {}),
        "reason": record.reason,
        "status": record.status,
        "void_reason": record.void_reason,
        "voided_at": record.voided_at.isoformat() if record.voided_at else None,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


def _ledger_rows(db: Session, records: list[ExtraDutyRecord]) -> list[dict[str, Any]]:
    person_ids = {r.person_id for r in records}
    unit_ids = {u for r in records for u in (r.home_unit_id, r.assigned_unit_id) if u}
    persons = (
        {p.id: p for p in db.scalars(select(Person).where(Person.id.in_(person_ids)))}
        if person_ids
        else {}
    )
    units = {u.id: u for u in db.scalars(select(Unit).where(Unit.id.in_(unit_ids)))} if unit_ids else {}
    return [_record_row(record, persons, units) for record in records]


def _with_transfers(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """docs/balance_extra_duties_contract.md 2: ledger rows gain ``transfers`` (from
    ``justice.transfers``, oldest first, each with a display ``text``) and ``rebalanced``."""
    for row in rows:
        raw = (row.get("justice") or {}).get("transfers")
        transfers = []
        for item in raw if isinstance(raw, list) else []:
            if not isinstance(item, dict):
                continue
            try:
                when = datetime.fromisoformat(str(item["at"])) if item.get("at") else None
            except ValueError:
                when = None
            name = item.get("from_person_name") or "another member"
            text = f"Passed on from {name} by Balance duties" + (f" on {when.day} {when:%b}" if when else "")
            transfers.append({
                "from_person_id": item.get("from_person_id"),
                "from_person_name": item.get("from_person_name"),
                "to_person_id": item.get("to_person_id"),
                "to_person_name": item.get("to_person_name"),
                "balance_batch_id": item.get("balance_batch_id"),
                "at": item.get("at"),
                "old_overridden_rules": list(item.get("old_overridden_rules") or []),
                "text": text,
            })
        row["transfers"] = transfers
        row["rebalanced"] = bool(transfers) or REBALANCED_CODE in (row.get("overridden_rules") or [])
    return rows


def person_ledger(db: Session, person_id: UUID) -> list[dict[str, Any]]:
    """All of a person's ledger rows (active and void), newest duty first."""
    records = list(
        db.scalars(
            select(ExtraDutyRecord)
            .where(ExtraDutyRecord.person_id == person_id)
            .order_by(ExtraDutyRecord.duty_date.desc(), ExtraDutyRecord.created_at.desc())
        )
    )
    return _with_transfers(_ledger_rows(db, records))


def month_ledger(db: Session, month: str) -> list[dict[str, Any]]:
    """The month's ledger rows (active and void), by duty date."""
    month_bounds(month)
    records = list(
        db.scalars(
            select(ExtraDutyRecord)
            .where(ExtraDutyRecord.month == month)
            .order_by(ExtraDutyRecord.duty_date, ExtraDutyRecord.duty_type, ExtraDutyRecord.created_at)
        )
    )
    return _with_transfers(_ledger_rows(db, records))


# --------------------------------------------------------------------------------------------
# Planning helpers
# --------------------------------------------------------------------------------------------


def _slot_view(slot: DutySlot, unit: Unit):
    """The slot as it would be in ``unit`` (fallback), without touching the ORM object."""
    return SimpleNamespace(
        id=slot.id,
        rota_period_id=slot.rota_period_id,
        rota_period=slot.rota_period,
        unit_id=unit.id,
        unit=unit,
        duty_date=slot.duty_date,
        duty_type=slot.duty_type,
        call_level=slot.call_level,
        slot_label=slot.slot_label,
        starts_at=slot.starts_at,
        ends_at=slot.ends_at,
        is_24hr=slot.is_24hr,
        max_assignees=slot.max_assignees,
        source=slot.source,
        template_status=slot.template_status,
        assignments=slot.assignments,
    )


def _duty_label(rules: RotaPhaseOneRules | None, duty_type: str) -> str:
    rule = rules.duty_rules_by_key.get(duty_type) if rules is not None else None
    return rule.label if rule is not None else duty_type


def _slot_order(slot) -> tuple:
    return (slot.duty_date, slot.starts_at, slot.duty_type, slot.slot_label, str(slot.id))


def _overridden_codes(validation: dict) -> list[str]:
    codes: list[str] = []
    for item in validation.get("issues", []):
        code = item.get("code") if isinstance(item, dict) else None
        if code in OVERRIDABLE_CODES and code not in codes:
            codes.append(code)
    return codes


def _canonical(data: Any) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)


def _plan_hash(decisions: list[dict], mode: str = MODE_STANDARD) -> str:
    """The plan's identity: the decisions and the mode (fill-all contract section 2)."""
    payload = {"mode": mode, "decisions": decisions}
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


def _active(assignment) -> bool:
    return assignment.status.lower() in ACTIVE_ASSIGNMENT_STATUSES


def _check_mode(mode: str | None) -> str:
    mode = mode or MODE_STANDARD
    if mode not in MODES:
        raise ExtraDutyError("invalid_mode", f"Mode must be one of: {', '.join(MODES)}.", 422)
    return mode


def _month_label(month: str) -> str:
    starts_on, _ends_on = month_bounds(month)
    return starts_on.strftime("%B %Y")


# --------------------------------------------------------------------------------------------
# Individual limits (fill-all contract section 4; shared with publish and the report)
# --------------------------------------------------------------------------------------------


def _limit_breaches(
    rules: RotaPhaseOneRules,
    assignments_by_person: dict[UUID, list],
    persons: dict[UUID, Any],
    home_unit_names: dict[UUID, str | None],
) -> list[dict[str, Any]]:
    """Members above any individual duty limit, counted the way ``duty_count_issues`` counts
    (unique duties, all units, ``count > limit``). Sorted by name."""
    from app.services.rota_assignment import campus_for_slot, rule_group_for_slot

    limits = rules.duty_count_limits
    if all(getattr(limits, field) is None for field in (
        "max_24hr_per_month", "max_weekend_24hr_per_month", "max_same_group_per_month",
        "max_same_campus_per_month",
    )):
        return []
    rows: list[dict[str, Any]] = []
    for person_id, assignments in assignments_by_person.items():
        slots = [a.duty_slot for a in unique_assignments(assignments)]
        if not slots:
            continue
        breaches: list[dict[str, Any]] = []
        total_24hr = sum(1 for slot in slots if slot.is_24hr)
        if limits.max_24hr_per_month is not None and total_24hr > limits.max_24hr_per_month:
            breaches.append({"code": "monthly_24hr_limit", "label": LIMIT_LABELS["monthly_24hr_limit"],
                             "limit": limits.max_24hr_per_month, "actual": total_24hr})
        weekend = sum(1 for slot in slots if slot.is_24hr and slot.duty_date.weekday() >= 5)
        if limits.max_weekend_24hr_per_month is not None and weekend > limits.max_weekend_24hr_per_month:
            breaches.append({"code": "monthly_weekend_24hr_limit",
                             "label": LIMIT_LABELS["monthly_weekend_24hr_limit"],
                             "limit": limits.max_weekend_24hr_per_month, "actual": weekend})
        if limits.max_same_group_per_month is not None:
            groups = Counter(rule_group_for_slot(slot, rules) for slot in slots)
            for group, count in sorted(groups.items()):
                if count > limits.max_same_group_per_month:
                    breaches.append({"code": "monthly_same_group_limit",
                                     "label": f"{LIMIT_LABELS['monthly_same_group_limit']} ({group})",
                                     "limit": limits.max_same_group_per_month, "actual": count})
        if limits.max_same_campus_per_month is not None:
            campuses = Counter(c for c in (campus_for_slot(slot) for slot in slots) if c)
            for campus, count in sorted(campuses.items()):
                if count > limits.max_same_campus_per_month:
                    breaches.append({"code": "monthly_same_campus_limit",
                                     "label": f"{LIMIT_LABELS['monthly_same_campus_limit']} ({campus})",
                                     "limit": limits.max_same_campus_per_month, "actual": count})
        if not breaches:
            continue
        person = persons.get(person_id)
        if person is None:
            person = next((getattr(a, "person", None) for a in assignments if getattr(a, "person", None)), None)
        rows.append({
            "person_id": str(person_id),
            "person_name": person.canonical_name if person is not None else str(person_id),
            "call_level": person.call_level if person is not None else None,
            "home_unit_name": home_unit_names.get(person_id),
            "month_duties": len(slots),
            "month_24hr": total_24hr,
            "limits": breaches,
        })
    return sorted(rows, key=lambda row: (str(row["person_name"]).lower(), row["person_id"]))


def _home_unit_names(postings: Iterable) -> dict[UUID, str | None]:
    names: dict[UUID, str | None] = {}
    for posting in sorted(
        (p for p in postings if p.unit_id is not None),
        key=lambda p: (p.starts_on, p.posting_type or "", str(p.unit_id)),
    ):
        if posting.person_id not in names and posting.unit is not None:
            names[posting.person_id] = posting.unit.name
    return names


def individual_limit_breaches(
    db: Session, month: str, rules: RotaPhaseOneRules | None = None
) -> list[dict[str, Any]]:
    """Every member above an individual duty limit in the month's saved state (all active
    assignments, not only extra duties): ``[{person_id, person_name, call_level,
    home_unit_name, month_duties, month_24hr, limits: [{code, label, limit, actual}]}]``,
    sorted by name. Read-only (pass ``rules`` to avoid ``get_phase_one_rules``)."""
    starts_on, ends_on = month_bounds(month)
    if rules is None:
        _version, rules = get_phase_one_rules(db)
    by_person: dict[UUID, list] = defaultdict(list)
    for assignment in unique_assignments(
        a for a in assignments_for_month(db, starts_on, ends_on) if _active(a)
    ):
        by_person[assignment.person_id].append(assignment)
    persons = {
        pid: person
        for pid, items in by_person.items()
        for person in [items[0].person]
        if person is not None
    }
    return _limit_breaches(rules, by_person, persons, _home_unit_names(postings_for_month(db, starts_on, ends_on)))


# --------------------------------------------------------------------------------------------
# Planning
# --------------------------------------------------------------------------------------------


@dataclass
class _Plan:
    result: dict
    period: RotaPeriod
    rules: RotaPhaseOneRules
    ctx: ExtraDutyContext


_CAUSE_OF_CODE = {
    "leave": "all_on_leave",
    "post_24hr_rest": "all_resting",
    "pre_24hr_rest": "all_resting",
    "rest_gap": "all_resting",
    "same_day_duty": "all_double_booked",
}


def _build_plan(db: Session, month: str, mode: str = MODE_STANDARD) -> _Plan:
    from app.services.rota_assignment import duty_count_issues
    from app.services.rota_candidates import add_provisional_assignment, candidate_context
    from app.services.rota_compute import context_hash
    from app.services.rota_eligibility import (
        active_group_keys_on,
        describe_levels,
        member_call_level,
        required_call_levels_for,
    )
    from app.services.rota_rules_admin import rules_revision

    mode = _check_mode(mode)
    all_units = mode == MODE_ALL_UNITS
    period, scope = _draft_period(db, month)
    template = template_slots_for_period(db, period.id)
    if not template:
        raise ExtraDutyError("scope_unlocked", "Build the month's duty template first.")
    open_slots = [
        slot
        for slot in template
        if slot.template_status != "excluded" and not any(_active(a) for a in slot.assignments)
    ]
    if not open_slots:
        raise ExtraDutyError("nothing_to_fill", "Every duty this month already has a member.")

    # The same preloaded month as candidate ranking; validate_assignment reads it for the
    # overridable codes (provisional plan assignments are added to it as we go).
    candidates = candidate_context(db, month)
    rules = candidates.rules
    ctx = build_context(
        db, month, period, rules, postings=candidates.postings, leaves=candidates.leaves
    )
    ctx.load_people(db)
    starts_on, ends_on = ctx.starts_on, ctx.ends_on
    units = ctx.units
    postings_by_unit: dict[UUID, list] = defaultdict(list)
    for posting in candidates.postings:
        postings_by_unit[posting.unit_id].append(posting)
    included = sorted(
        (item.unit for item in scope.units if item.status == SCOPE_INCLUDED and item.unit),
        key=lambda unit: (unit.name, str(unit.id)),
    )
    included_ids = {unit.id for unit in included}
    outside = sorted(
        (
            unit
            for unit in units.values()
            if unit.id not in included_ids and (unit.active_status or "active") == "active"
        ),
        key=lambda unit: (unit.name, str(unit.id)),
    )
    explicit: dict[UUID, list[UUID]] = defaultdict(list)
    for row in db.scalars(
        select(UnitFallback).order_by(UnitFallback.unit_id, UnitFallback.position, UnitFallback.id)
    ):
        explicit[row.unit_id].append(row.fallback_unit_id)

    owned: Counter = Counter(
        (slot.unit_id, slot.duty_type) for slot in template if slot.template_status != "excluded"
    )
    receipts: Counter = Counter()
    order_cache: dict[tuple, list[tuple[int, Unit]]] = {}

    def usable_for(slot):
        rule = rule_for_slot(slot, rules)

        def usable(unit: Unit | None) -> bool:
            return (
                unit is not None
                and unit.id != slot.unit_id
                and (unit.active_status or "active") == "active"
                and (rule is None or rule_applies_to_unit(rule, unit))
            )

        return usable

    def fallback_tiers(slot) -> list[tuple[int, Unit]]:
        """Standard mode (contract 1.4, changed by docs/superadmin_override_contract.md section 4):
        ``(tier index, unit)`` - the explicit fallback list first (tier 1), then same-campus
        in-scope units (tier 2), then the other in-scope units (tier 3); within a tier by the
        fewest same-duty slots owned, the fewest receipts, then name. The explicit list is the
        first preference, not the only one."""
        key = (slot.unit_id, slot.duty_type)
        if key in order_cache:
            return order_cache[key]
        home = units.get(slot.unit_id)
        usable = usable_for(slot)
        ordered: list[tuple[int, Unit]] = []
        seen: set[UUID] = set()
        for uid in dict.fromkeys(explicit.get(slot.unit_id, [])):
            unit = units.get(uid)
            if usable(unit) and unit.id not in seen:
                seen.add(unit.id)
                ordered.append((1, unit))
        home_campus = home.campus if home else None
        rest = sorted(
            (unit for unit in included if usable(unit) and unit.id not in seen),
            key=lambda unit: (
                0 if home_campus and unit.campus == home_campus else 1,
                owned[(unit.id, slot.duty_type)],
                receipts[unit.id],
                unit.name,
                str(unit.id),
            ),
        )
        ordered.extend((2 if home_campus and unit.campus == home_campus else 3, unit) for unit in rest)
        order_cache[key] = ordered
        return ordered

    def fallback_units(slot) -> list[Unit]:
        return [unit for _tier, unit in fallback_tiers(slot)]

    tier_cache: dict[tuple, list[tuple[int, UUID, bool]]] = {}

    def tier_sources(slot) -> list[tuple[int, UUID, bool]]:
        """All-units mode (fill-all contract 3): ``(tier index, unit id, unposted)`` in tier order."""
        key = (slot.unit_id, slot.duty_type)
        cached = tier_cache.get(key)
        if cached is not None:
            return cached
        usable = usable_for(slot)
        home = units.get(slot.unit_id)
        home_campus = home.campus if home else None
        out: list[tuple[int, UUID, bool]] = []
        seen: set[UUID] = set()

        def take(tier: int, unit: Unit | None) -> None:
            if usable(unit) and unit.id not in seen:
                seen.add(unit.id)
                out.append((tier, unit.id, False))

        if slot.unit_id is not None:
            seen.add(slot.unit_id)
            out.append((0, slot.unit_id, False))
        for uid in dict.fromkeys(explicit.get(slot.unit_id, [])):
            take(1, units.get(uid))
        for unit in included:
            if home_campus and unit.campus == home_campus:
                take(2, unit)
        for unit in included:
            take(3, unit)
        for unit in outside:
            take(4, unit)
        if slot.unit_id is not None:
            out.append((5, slot.unit_id, True))
        tier_cache[key] = out
        return out

    # Per (duty, call level, day): active members with no posting on the day who pass call
    # level and groups. The unposted tier only runs the remaining strict checks on them.
    unposted_pools: dict[tuple, list[UUID]] = {}
    active_ids = sorted(ctx.active_people, key=str)

    def unposted_pool(slot) -> list[UUID]:
        key = (slot.duty_type, slot.call_level, slot.duty_date, slot.unit_id)
        pool = unposted_pools.get(key)
        if pool is None:
            posted = ctx.person_units(slot.duty_date)
            pool = [
                pid
                for pid in active_ids
                if pid not in posted
                and ctx.eligibility_block(pid, slot, slot.unit_id, True) is None
            ]
            unposted_pools[key] = pool
        return pool

    feasible_cache: dict[tuple, set[UUID]] = {}
    holders: dict[UUID, set[tuple]] = defaultdict(set)

    def feasible(slot, unit_id: UUID | None, unposted: bool = False) -> set[UUID]:
        if unit_id is None:
            return set()
        key = (slot.id, unit_id, unposted)
        cached = feasible_cache.get(key)
        if cached is None:
            pool = unposted_pool(slot) if unposted else ctx.unit_contexts(slot.duty_date, unit_id)
            cached = {
                pid
                for pid in pool
                if not strict_blockers(
                    ctx, pid, slot, unit_id, first_only=True, allow_unposted=unposted
                )
            }
            feasible_cache[key] = cached
            for pid in cached:
                holders[pid].add(key)
        return cached

    lookback = lookback_months(rules)
    base_ledger = ledger_balance(db, list(ctx.persons), starts_on, lookback)
    plan_ledger: Counter = Counter()
    plan_last: dict[UUID, date] = {}

    # Equal duties within a call level (docs/limits_callevel_fairness_contract.md 2): every
    # candidate holds one of the slot's levels; a pool slot (call_level_pool_and_balance
    # contract 1) uses the target of the candidate's own level.
    from app.services.rota_candidates import context_targets
    from app.services.rota_call_levels import normalize_call_level

    level_targets = context_targets(db, candidates)
    slot_levels: dict[UUID, set[str]] = {}

    def slot_target(slot, pid: UUID | None = None) -> float | None:
        if slot.id not in slot_levels:
            slot_levels[slot.id] = required_call_levels(slot, rule_for_slot(slot, rules), ctx.groups)
        levels = slot_levels[slot.id]
        if len(levels) == 1:
            return level_targets.get(next(iter(levels)))
        person = ctx.persons.get(pid) if pid is not None else None
        level = normalize_call_level(person.call_level) if person is not None else None
        return level_targets.get(level) if level in levels else None

    def justice(pid: UUID, slot) -> dict[str, Any]:
        base = base_ledger.get(pid) or {"count": 0, "last_date": None}
        last = base["last_date"]
        if pid in plan_last and (last is None or plan_last[pid] > last):
            last = plan_last[pid]
        entries = ctx.entries_by_person.get(pid, [])
        month_entries = [e for e in entries if starts_on <= e.duty_date <= ends_on]
        previous = [slot.starts_at - e.ends_at for e in entries if e.ends_at <= slot.starts_at]
        target = slot_target(slot, pid)
        return {
            "ledger_count": int(base["count"]) + plan_ledger[pid],
            "last_extra_date": last.isoformat() if last else None,
            "month_duties": len(month_entries),
            "month_24hr": sum(1 for e in month_entries if e.is_24hr),
            "rest_hours": round(_hours(min(previous)), 2) if previous else None,
            "call_level_target": None if target is None else round(target, 2),
            "target_distance": None if target is None else round(len(month_entries) - target, 2),
        }

    def justice_key(pid: UUID, keys: dict[str, Any], tier: int = 0, campus: int = 0) -> tuple:
        """Ranking (docs/limits_callevel_fairness_contract.md 2), after *not tight*: the justice
        ledger count, the distance below the call-level target then the fewest month duties
        (all campuses), the home unit as a tie-break, campus (``campus`` is 0 unless the
        candidate is tight), then the oldest last extra duty, fewest 24h, longest rest and a
        stable name/id. The tier (fallback / same campus / any unit) no longer outranks
        equality; it is kept for reporting."""
        last = keys["last_extra_date"]
        rest = keys["rest_hours"]
        distance = keys.get("target_distance")
        person = ctx.persons.get(pid)
        return (
            keys["ledger_count"],
            keys["month_duties"] if distance is None else distance,
            keys["month_duties"],
            0 if tier == 0 else 1,
            campus,
            (0, "") if last is None else (1, last),
            keys["month_24hr"],
            -(math.inf if rest is None else rest),
            person.canonical_name if person else "",
            str(pid),
        )

    def campus_rank(slot, unit_id: UUID | None) -> int:
        """0 when ``unit_id`` is on the slot's home campus (or is the home unit), else 1."""
        if unit_id == slot.unit_id:
            return 0
        home = units.get(slot.unit_id) if slot.unit_id else None
        unit = units.get(unit_id) if unit_id else None
        if home is not None and unit is not None and home.campus and unit.campus == home.campus:
            return 0
        return 1

    def unit_name(unit_id: UUID | None) -> str | None:
        unit = units.get(unit_id) if unit_id else None
        return unit.name if unit else None

    def view_in(slot, unit_id: UUID):
        return slot if unit_id == slot.unit_id else _slot_view(slot, units[unit_id])

    def over_limit(slot, unit_id: UUID, pid: UUID) -> bool:
        issues = duty_count_issues(
            db=db, slot=view_in(slot, unit_id), person=ctx.persons[pid], rules=rules,
            replace_existing=False, context=candidates,
        )
        return any(item.get("code") in LIMIT_CODES for item in issues)

    def unit_hard_blocked(slot, unit_id: UUID) -> bool:
        """The staffing check ``validate_assignment`` reports as ``unit_safety_hard_block``,
        for the slot as it would be in ``unit_id``, against the current plan state."""
        if unit_id is None or unit_id not in units:
            return False
        safety = slot_safety(
            slot=view_in(slot, unit_id),
            rules=rules,
            postings=postings_by_unit.get(unit_id, []),
            leaves=candidates.leaves,
            same_day_assignments=candidates.same_day_assignments,
            previous_day_assignments=candidates.previous_day_assignments,
        )
        return safety["safety_status"] == SAFETY_HARD_BLOCK

    def base_decision(slot) -> dict[str, Any]:
        return {
            "slot_id": str(slot.id),
            "duty_date": slot.duty_date.isoformat(),
            "duty_type": slot.duty_type,
            "duty_label": _duty_label(rules, slot.duty_type),
            "slot_label": slot.slot_label,
            "starts_at": slot.starts_at.isoformat(),
            "is_24hr": bool(slot.is_24hr),
            "home_unit_id": str(slot.unit_id) if slot.unit_id else None,
            "home_unit_name": unit_name(slot.unit_id),
        }

    month_label = _month_label(month)

    def diagnose(slot) -> tuple[str, str, Counter]:
        """Why nobody can do ``slot`` (fill-all contract 4): ``(cause, fix, category counts)``.
        Looks at every active member in every unit they are posted to (or, unposted, at the
        slot's own unit), whatever the mode, so the fix names the real obstacle."""
        rule = rule_for_slot(slot, rules)
        posted = ctx.person_units(slot.duty_date)
        eligible_any = usable_any = False
        counts: Counter = Counter()
        for pid in active_ids:
            unit_ids = posted.get(pid)
            placements = (
                [(uid, False) for uid in sorted(unit_ids, key=str)]
                if unit_ids
                else ([(slot.unit_id, True)] if slot.unit_id else [])
            )
            best: str | None = None
            for uid, unposted in placements:
                if ctx.eligibility_block(pid, slot, uid, unposted) is not None:
                    continue
                eligible_any = True
                unit = units.get(uid)
                if (
                    unit is None
                    or (unit.active_status or "active") != "active"
                    or ctx.unit_rule_blocks(slot, uid)
                ):
                    continue
                usable_any = True
                blockers = strict_blockers(ctx, pid, slot, uid, first_only=True, allow_unposted=unposted)
                category = _CAUSE_OF_CODE.get(blockers[0]["code"], "other") if blockers else "free"
                if best is None or category == "free":
                    best = category
            if best is not None:
                counts[best] += 1
        if not eligible_any:
            if not required_call_levels(slot, rule, ctx.groups):
                # Strict call level (call_level_pool_and_balance_contract section 1): only a
                # duty with no level at all is unresolved; a pool is filled normally.
                label = rule.label if rule is not None else slot.duty_type
                return "no_member_at_level", call_level_missing_message(label), counts
            levels = describe_levels(required_call_levels_for(slot, rule, ctx.groups)) or "suitable"
            fix = f"Add or activate {levels} members in Member management"
            allowed = list(rule.allowed_cluster_keys or []) if rule is not None else []
            if allowed:
                names = [ctx.groups[key].name if key in ctx.groups else key for key in allowed]
                fix += f", or add members to {', '.join(names)}"
            return "no_member_at_level", fix, counts
        if not usable_any:
            return "unit_rule", "Review the duty's unit rules in Rota rules (Who can do it)", counts
        busy = {category for category in counts if category != "free"}
        if counts.get("free"):
            if all_units:
                return "other", "Review this duty's slot (it may already be full)", counts
            return (
                "other",
                f"Suitable members are free in other units or have no {month_label} posting: "
                f"enter {month_label} postings or use Fill remaining duties",
                counts,
            )
        if len(busy) == 1:
            cause = next(iter(busy))
            fixes = {
                "all_on_leave": "Review leave for this date",
                "all_resting": "Move a nearby 24-hour duty so someone is rested",
                "all_double_booked": "Free a member from another duty that day",
                "other": "Review this duty's slot (it may already be full)",
            }
            return cause, fixes[cause], counts
        return "other", "Review leave, rest and other duties on this date", counts

    cause_words = {
        "all_on_leave": "on leave",
        "all_resting": "resting around a 24h duty",
        "all_double_booked": "already on duty that day",
        "other": "otherwise blocked",
    }

    def unfilled(slot) -> dict[str, Any]:
        cause, fix, counts = diagnose(slot)
        if all_units:
            words = ", ".join(
                f"{counts[key]} {cause_words[key]}" for key in cause_words if counts.get(key)
            )
            reason = f"{CAUSE_LABELS[cause]}" + (f" ({words})" if words else "") + f". {fix}."
        else:
            parts: list[str] = []
            unit_ids = ([slot.unit_id] if slot.unit_id else []) + [u.id for u in fallback_units(slot)]
            nobody: list[str] = []
            for unit_id in unit_ids:
                people = ctx.unit_contexts(slot.duty_date, unit_id)
                name = unit_name(unit_id) or "Unknown unit"
                if not people:
                    nobody.append(name)
                    continue
                tally: Counter = Counter()
                for pid in people:
                    blockers = strict_blockers(ctx, pid, slot, unit_id, first_only=True)
                    tally[blockers[0]["code"] if blockers else "slot_full"] += 1
                words = ", ".join(
                    f"{tally[code]} {REASON_WORDS[code]}" for code in STRICT_ORDER if tally[code]
                )
                parts.append(f"{name}: {words}")
            if nobody:
                parts.append(f"nobody posted in {', '.join(nobody)}")
            reason = "; ".join(parts) if parts else "No unit to draw from."
        return {
            **base_decision(slot),
            "action": "unfilled",
            "person_id": None,
            "person_name": None,
            "assigned_unit_id": None,
            "assigned_unit_name": None,
            "overridden_rules": [],
            "ledger": False,
            "justice": None,
            "reason": reason,
            "alternatives": [],
            "tier": None,
            "over_limit": False,
            "tight": False,
            "cause": cause,
            "cause_label": CAUSE_LABELS[cause],
            "fix": fix,
        }

    def rank_candidates(slot, pools) -> list[tuple]:
        """Both modes (docs/limits_callevel_fairness_contract.md section 2): ``(tight, justice
        key)`` - see ``justice_key``. A candidate is *tight* when placing them would exceed an
        individual limit or their unit is hard blocked by staffing safety
        (``unit_safety_hard_block``), so a non-tight member in any unit beats a tight one at
        home or on the same campus; campus preference applies only among tight candidates.
        The checks run lazily, only until four non-tight members are found. Rows: ``(pid,
        keys, tier, unit_id, unposted, over_limit, tight)``."""
        entries = []
        for tier, unit_id, unposted, people in pools:
            for pid in people:
                keys = justice(pid, slot)
                entries.append(((justice_key(pid, keys, tier), tier), pid, keys, tier, unit_id, unposted))
        entries.sort(key=lambda item: item[0])
        hard_cache: dict[UUID, bool] = {}

        def hard_blocked(unit_id: UUID) -> bool:
            if unit_id not in hard_cache:
                hard_cache[unit_id] = unit_hard_blocked(slot, unit_id)
            return hard_cache[unit_id]

        loose: list[tuple] = []
        tight: list[tuple] = []
        done: set[UUID] = set()
        for _key, pid, keys, tier, unit_id, unposted in entries:
            if pid in done:
                continue
            row = (pid, keys, tier, unit_id, unposted)
            if hard_blocked(unit_id):
                tight.append((*row, None, True))
                continue
            if over_limit(slot, unit_id, pid):
                tight.append((*row, True, True))
            else:
                loose.append((*row, False, False))
                done.add(pid)
                if len(loose) >= 4:
                    break
        # Among tight candidates the campus is considered (contract 2, step 5).
        tight.sort(
            key=lambda row: (
                justice_key(row[0], row[1], row[2], campus_rank(slot, row[3])),
                row[2],
            )
        )
        ranked: list[tuple] = []
        seen: set[UUID] = set()
        for row in loose + tight:
            if row[0] not in seen:
                seen.add(row[0])
                ranked.append(row)
        # The limit flag is only needed for the rows shown (the choice and 3 alternatives).
        for index, row in enumerate(ranked[:4]):
            if row[5] is None:
                ranked[index] = (*row[:5], over_limit(slot, row[3], row[0]), row[6])
        return ranked

    decisions: list[dict[str, Any]] = []
    remaining = sorted(open_slots, key=_slot_order)
    order_of = {slot.id: _slot_order(slot) for slot in remaining}
    # Only duties within this many days of a placement can change strictly (same day,
    # overlap, next/previous-day blocks, the 24h rest gap); farther feasibility stays valid.
    window = _rest_window_days(rules)
    # All-units mode: each slot's pools, recomputed only after a placement touched them.
    slot_pools: dict[UUID, tuple[int, list]] = {}
    dirty: set[UUID] = set()
    while remaining:
        best = None
        still: list[DutySlot] = []
        for slot in remaining:
            if all_units:
                cached_pools = slot_pools.get(slot.id)
                if cached_pools is not None and slot.id not in dirty:
                    total, pools = cached_pools
                else:
                    pools = []
                    total = 0
                    for tier, unit_id, unposted in tier_sources(slot):
                        people = feasible(slot, unit_id, unposted)
                        if people:
                            pools.append((tier, unit_id, unposted, people))
                            total += len(people)
                    slot_pools[slot.id] = (total, pools)
                    dirty.discard(slot.id)
            else:
                # Hardest slot first: the home count, falling back to the first usable unit's
                # count (contract 1.3.3). The full pools are built for the chosen slot below.
                people = feasible(slot, slot.unit_id)
                if not people:
                    for unit in fallback_units(slot):
                        people = feasible(slot, unit.id)
                        if people:
                            break
                total = len(people)
                pools = None
            if not total:
                decisions.append(unfilled(slot))
                continue
            still.append(slot)
            key = (total, *order_of[slot.id])
            if best is None or key < best[0]:
                best = (key, slot, pools)
        remaining = still
        if best is None:
            break
        _key, slot, pools = best
        remaining.remove(slot)

        if not all_units:
            # Superadmin contract section 4: home and every usable in-scope unit, ranked together.
            pools = []
            for tier_index, pool_unit_id in [(0, slot.unit_id)] + [
                (t, unit.id) for t, unit in fallback_tiers(slot)
            ]:
                people = feasible(slot, pool_unit_id)
                if people:
                    pools.append((tier_index, pool_unit_id, False, people))
        ranked = rank_candidates(slot, pools)
        chosen, chosen_keys, tier, unit_id, unposted, _exceeds, chosen_tight = ranked[0]
        tier_name = TIERS[tier]
        moved = unit_id != slot.unit_id
        person = ctx.persons[chosen]
        view = view_in(slot, unit_id)
        # validate_assignment and slot_safety only use the contexts of people posted to the
        # slot's unit on the slot date; narrowing the postings gives identical issues, faster.
        validation = validate_assignment(
            db,
            slot=view,
            person=person,
            replace_existing=False,
            context=replace(candidates, postings=postings_by_unit.get(unit_id, [])),
        )
        overridden = _overridden_codes(validation)
        tier_code = TIER_CODES.get(tier_name) if all_units else (FALLBACK_UNIT_CODE if moved else None)
        if tier_code and tier_code not in overridden:
            overridden.append(tier_code)
        ledger = bool(overridden)
        exceeds = any(code in LIMIT_CODES for code in overridden)

        add_provisional_assignment(candidates, view, chosen)
        ctx.add_plan_assignment(view, chosen, unit_id)
        for key in list(holders[chosen]):
            other = ctx.slot_by_id.get(key[0])
            if other is not None and abs((other.duty_date - slot.duty_date).days) > window:
                continue
            if other is None or strict_blockers(
                ctx, chosen, other, key[1], first_only=True, allow_unposted=key[2]
            ):
                feasible_cache[key].discard(chosen)
                holders[chosen].discard(key)
                dirty.add(key[0])
        if ledger:
            plan_ledger[chosen] += 1
            if chosen not in plan_last or slot.duty_date > plan_last[chosen]:
                plan_last[chosen] = slot.duty_date
        if moved:
            receipts[unit_id] += 1
            owned[(slot.unit_id, slot.duty_type)] -= 1
            owned[(unit_id, slot.duty_type)] += 1
            order_cache.clear()

        reason = (
            f"{chosen_keys['ledger_count']} extra duties in the last {lookback} months · "
            f"{chosen_keys['month_duties']} duties this month"
        )
        home_name = unit_name(slot.unit_id) or "the home unit"
        if not all_units:
            if moved and any(row[3] == slot.unit_id and not row[6] for row in ranked):
                reason = (
                    f"Covered from {unit_name(unit_id)} for {home_name} (fewer duties than the "
                    f"members free in {home_name}: equal duties within the call level come "
                    f"before the home unit). " + reason
                )
            elif moved and any(pool[0] == 0 for pool in pools):
                reason = (
                    f"Covered from {unit_name(unit_id)} for {home_name} (members free in "
                    f"{home_name} were over a limit or the unit was short-staffed). " + reason
                )
            elif moved:
                reason = f"Nobody free in {home_name}; covered from {unit_name(unit_id)}. " + reason
        else:
            if tier_name == "unposted":
                reason = f"No posting on this date; the duty stays in {home_name}. " + reason
            elif tier_name == "outside_scope":
                reason = f"Covered from {unit_name(unit_id)}, a unit outside this month's scope. " + reason
            elif moved:
                reason = f"Covered from {unit_name(unit_id)} for {home_name}. " + reason
            if exceeds:
                reason += " · over an individual limit (nobody suitable was within their limits)"
        decision = {
            **base_decision(slot),
            "action": "assign_fallback" if moved else "assign",
            "person_id": str(chosen),
            "person_name": person.canonical_name,
            "assigned_unit_id": str(unit_id),
            "assigned_unit_name": unit_name(unit_id),
            "overridden_rules": overridden,
            "ledger": ledger,
            "justice": chosen_keys,
            "reason": reason,
            "alternatives": [
                {
                    "person_id": str(pid),
                    "person_name": ctx.persons[pid].canonical_name,
                    "justice": keys,
                    # Both modes (superadmin contract section 4): where the alternative is and
                    # whether it was tight. Standard mode names the tier as the decision does.
                    "tier": TIERS[alt_tier] if all_units else ("home" if alt_unit == slot.unit_id else "fallback"),
                    "unit_id": str(alt_unit),
                    "unit_name": unit_name(alt_unit),
                    "over_limit": bool(alt_over),
                    "tight": bool(alt_tight),
                }
                for pid, keys, alt_tier, alt_unit, _alt_unposted, alt_over, alt_tight in ranked[1:4]
            ],
            "tier": tier_name if all_units else ("fallback" if moved else "home"),
            "over_limit": exceeds,
            "tight": bool(chosen_tight),
        }
        decisions.append(decision)

    assigned = [d for d in decisions if d["action"] != "unfilled"]

    # Unfilled causes, grouped by (cause, fix).
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    for d in decisions:
        if d["action"] != "unfilled":
            continue
        group = groups.setdefault(
            (d["cause"], d["fix"]),
            {"cause": d["cause"], "label": CAUSE_LABELS[d["cause"]], "count": 0, "fix": d["fix"], "examples": []},
        )
        group["count"] += 1
        if len(group["examples"]) < 5:
            group["examples"].append({
                "slot_id": d["slot_id"], "duty_date": d["duty_date"],
                "duty_label": d["duty_label"], "unit_name": d["home_unit_name"],
            })
    unfilled_causes = sorted(
        groups.values(), key=lambda g: (-g["count"], CAUSE_ORDER.index(g["cause"]), g["fix"])
    )

    # Who has no posting this month (the board can fix postings instead).
    posted_this_month = {p.person_id for p in candidates.postings if p.unit_id is not None}
    by_level: Counter = Counter()
    by_group: Counter = Counter()
    for pid in active_ids:
        if pid in posted_this_month:
            continue
        person = ctx.active_people[pid]
        context = MemberContext(person=person, unit_id=None, posting_type=person.call_level or "", day=starts_on)
        by_level[member_call_level(context)] += 1
        for key in active_group_keys_on(person, starts_on):
            by_group[key] += 1
    diagnostics = {
        "unposted_by_level": dict(sorted(by_level.items())),
        "unposted_by_group": dict(sorted(by_group.items())),
    }

    # Individual limits after the plan: every active assignment of the month + the plan.
    over_limit_people = _limit_breaches(
        rules, candidates.assignments_by_person, ctx.persons, _home_unit_names(candidates.postings)
    )

    summary = {
        "mode": mode,
        "filled": len(assigned),
        "fallback": sum(1 for d in assigned if d["action"] == "assign_fallback"),
        "ledger_records": sum(1 for d in assigned if d["ledger"]),
        "unfilled": len(decisions) - len(assigned),
        "slots_considered": len(open_slots),
        "over_limit_people": len(over_limit_people),
        "cross_unit": sum(1 for d in assigned if d["action"] == "assign_fallback"),
        "unposted_used": sum(1 for d in assigned if d["tier"] == "unposted"),
    }
    result = {
        "month": month,
        "mode": mode,
        "period_id": str(period.id),
        "plan_hash": _plan_hash(decisions, mode),
        "context_hash": context_hash(db),
        "rules_revision": rules_revision(rules),
        "decisions": decisions,
        "summary": summary,
        "over_limit_people": over_limit_people,
        "unfilled_causes": unfilled_causes,
        "diagnostics": diagnostics,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
    return _Plan(result=result, period=period, rules=rules, ctx=ctx)


def plan_extra_duties(db: Session, month: str, mode: str = MODE_STANDARD) -> dict[str, Any]:
    """The deterministic plan (contract 1.3; fill-all contract 3 for ``mode="all_units"``):
    ``{month, mode, plan_hash, context_hash, decisions, summary, over_limit_people,
    unfilled_causes, diagnostics, generated_at}``. Writes nothing operational."""
    return _build_plan(db, month, mode).result


# --------------------------------------------------------------------------------------------
# Preview / apply
# --------------------------------------------------------------------------------------------


def _ensure_enabled() -> None:
    from app.core.config import settings

    if not settings.extra_duty_layer_enabled:
        raise ExtraDutyError("disabled", "The extra-duty layer is turned off.", 503)


def _secret() -> bytes:
    from app.core.config import settings

    explicit = getattr(settings, "secret_key", None) or getattr(settings, "app_secret", None)
    material = explicit or f"extra-duty-preview:{settings.database_url}:{settings.app_name}"
    return hashlib.sha256(str(material).encode("utf-8")).digest()


def _signature(plan_hash: str, context_hash: str, month: str, user, mode: str = MODE_STANDARD) -> str:
    message = f"{plan_hash}|{context_hash}|{month}|{getattr(user, 'id', None)}"
    if mode != MODE_STANDARD:  # standard tokens keep their original form
        message += f"|{mode}"
    return hmac.new(_secret(), message.encode("utf-8"), hashlib.sha256).hexdigest()


def make_token(plan_hash: str, context_hash: str, month: str, user, mode: str = MODE_STANDARD) -> str:
    """``<context_hash>.<HMAC(plan_hash|context_hash|month|user.id[|mode])>`` (opaque to clients)."""
    return f"{context_hash}.{_signature(plan_hash, context_hash, month, user, mode)}"


def _token_valid(token: str | None, plan_hash: str, month: str, user, mode: str = MODE_STANDARD) -> bool:
    if not token or "." not in token:
        return False
    context, _, signature = token.partition(".")
    expected = _signature(plan_hash, context, month, user, mode)
    return hmac.compare_digest(signature, expected)


def _user_name(user) -> str | None:
    if user is None:
        return None
    return getattr(user, "display_name", None) or getattr(user, "username", None)


def _refuse_active_proposal(db: Session, month: str, user) -> None:
    from app.services.rota_compute import ACTIVE, conflict_summary

    jobs = db.scalars(
        select(RotaComputeJob)
        .where(RotaComputeJob.month == month, RotaComputeJob.status.in_(ACTIVE))
        .order_by(RotaComputeJob.created_at.desc())
    )
    now = datetime.utcnow()
    for job in jobs:
        if job.updated_at is not None and now - job.updated_at > STALE_PROPOSAL_AGE:
            continue  # expired; rota_compute.create_job retires it on the next run
        raise ExtraDutyError(
            "proposal_active",
            "A rota proposal is open for this month. Resume or cancel it before adding extra duties.",
            409,
            conflict_summary(db, job, user),
        )


def preview(db: Session, month: str, user, mode: str = MODE_STANDARD) -> dict[str, Any]:
    """The plan plus a token binding it to this user, month, mode and context."""
    _ensure_enabled()
    mode = _check_mode(mode)
    _refuse_active_proposal(db, month, user)
    plan = plan_extra_duties(db, month, mode)
    return {**plan, "token": make_token(plan["plan_hash"], plan["context_hash"], month, user, mode)}


def _batch_result(
    batch: ExtraDutyBatch, *, already_applied: bool, extras: dict[str, Any] | None = None
) -> dict[str, Any]:
    summary = batch.summary or {}
    extras = extras or {}
    return {
        "batch_id": str(batch.id),
        "month": batch.month,
        "mode": summary.get("mode", MODE_STANDARD),
        "status": batch.status,
        "plan_hash": batch.plan_hash,
        "summary": summary,
        "decisions": batch.decisions or [],
        "over_limit_people": extras.get("over_limit_people", []),
        "unfilled_causes": extras.get("unfilled_causes", []),
        "diagnostics": extras.get("diagnostics", {"unposted_by_level": {}, "unposted_by_group": {}}),
        "already_applied": already_applied,
    }


def apply(
    db: Session, month: str, token: str, plan_hash: str, user, mode: str = MODE_STANDARD
) -> dict[str, Any]:
    """Apply a previewed plan (contract 3). Idempotent for the same month + plan_hash.
    ``mode`` must be the preview's mode; a token from another mode is ``stale_preview``."""
    _ensure_enabled()
    month_bounds(month)
    mode = _check_mode(mode)
    if not plan_hash or not _token_valid(token, plan_hash, month, user, mode):
        if plan_hash and any(
            _token_valid(token, plan_hash, month, user, other) for other in MODES if other != mode
        ):
            raise ExtraDutyError(
                "stale_preview",
                "This preview was made for a different fill mode. Preview again.",
                409,
            )
        raise ExtraDutyError("bad_token", "This preview token does not match. Preview again.", 403)

    from app.services.rota_compute import lock_operational_inputs

    lock_namespace(db, f"extra-duty:{month}")
    lock_namespace(db, f"rota-compute:{month}")
    lock_operational_inputs(db)
    existing = db.scalar(
        select(ExtraDutyBatch)
        .where(
            ExtraDutyBatch.month == month,
            ExtraDutyBatch.plan_hash == plan_hash,
            ExtraDutyBatch.status == "applied",
        )
        .order_by(ExtraDutyBatch.created_at.desc())
    )
    if existing is not None:
        return _batch_result(
            existing,
            already_applied=True,
            extras={"over_limit_people": individual_limit_breaches(db, month)},
        )
    _refuse_active_proposal(db, month, user)
    try:
        plan = _build_plan(db, month, mode)
    except ExtraDutyError as exc:
        if exc.code == "nothing_to_fill":
            raise ExtraDutyError(
                "stale_preview", "The month changed since the preview. Preview again.", 409
            ) from exc
        raise
    result = plan.result
    if result["plan_hash"] != plan_hash:
        raise ExtraDutyError(
            "stale_preview",
            "The month changed since the preview. Preview again.",
            409,
            {"plan_hash": result["plan_hash"]},
        )

    ctx = plan.ctx
    try:
        batch = ExtraDutyBatch(
            rota_period_id=plan.period.id,
            month=month,
            status="applied",
            plan_hash=result["plan_hash"],
            context_hash=result["context_hash"],
            rules_revision=result["rules_revision"],
            summary=result["summary"],
            decisions=result["decisions"],
            before_image=[],
            created_by_id=getattr(user, "id", None),
            created_by_name=_user_name(user),
        )
        db.add(batch)
        db.flush()
        before_image: list[dict[str, Any]] = []
        new_ids: list[UUID] = []
        for decision in result["decisions"]:
            if decision["action"] == "unfilled":
                continue
            slot = ctx.slot_by_id[UUID(decision["slot_id"])]
            person_id = UUID(decision["person_id"])
            unit_id = UUID(decision["assigned_unit_id"])
            unit_before = slot.unit_id
            rows_before = sorted(str(a.id) for a in slot.assignments)
            if decision["action"] == "assign_fallback":
                slot.unit_id = unit_id
                slot.unit = ctx.units[unit_id]
            overridden = decision["overridden_rules"]
            assignment = DutyAssignment(
                duty_slot=slot,
                person_id=person_id,
                status="assigned",
                source=EXTRA_DUTY_SOURCE,
                override_reason=(
                    "Extra-duty layer: " + ", ".join(overridden) if decision["ledger"] else None
                ),
            )
            db.add(assignment)
            db.flush()
            new_ids.append(assignment.id)
            before_image.append(
                {
                    "slot_id": decision["slot_id"],
                    "unit_id_before": str(unit_before) if unit_before else None,
                    "unit_id_after": str(unit_id),
                    "assignment_ids_before": rows_before,
                    "assignment_id": str(assignment.id),
                    "person_id": decision["person_id"],
                }
            )
            if decision["ledger"]:
                db.add(
                    ExtraDutyRecord(
                        batch_id=batch.id,
                        person_id=person_id,
                        assignment_id=assignment.id,
                        slot_id=slot.id,
                        month=month,
                        duty_date=slot.duty_date,
                        duty_type=slot.duty_type,
                        home_unit_id=UUID(decision["home_unit_id"]) if decision["home_unit_id"] else None,
                        assigned_unit_id=unit_id,
                        fallback_used=decision["action"] == "assign_fallback",
                        overridden_rules=list(overridden),
                        justice=dict(decision["justice"] or {}),
                        reason=decision["reason"],
                        status="active",
                    )
                )
        batch.before_image = before_image
        db.flush()
        check = verify_month(db, month, assignment_ids=new_ids, rules=plan.rules)
        if not check["ok"]:
            db.rollback()
            raise ExtraDutyError(
                "verification_failed",
                "A post-write check found a strict-rule problem; nothing was saved.",
                500,
                {"violations": check["violations"]},
            )
        db.commit()
    except ExtraDutyError:
        raise
    except Exception:
        db.rollback()
        raise
    return _batch_result(batch, already_applied=False, extras=result)


# --------------------------------------------------------------------------------------------
# Undo
# --------------------------------------------------------------------------------------------


def undo(db: Session, batch_id: UUID, user, dry_run: bool = False) -> dict[str, Any]:
    """Remove a batch's assignments, restore slot units and void its records (contract 3)."""
    batch = db.get(ExtraDutyBatch, batch_id)
    if batch is None:
        raise ExtraDutyError("not_found", "Extra-duty batch not found.", 404)
    if (batch.summary or {}).get("mode") == "balance":
        # docs/call_level_pool_and_balance_contract.md section 2: balance batches have their own undo.
        raise ExtraDutyError(
            "balance_batch",
            "This batch was made by Balance duties; undo it from Balance duties.",
            409,
            {"undo_path": f"/api/v1/balance-duties/batches/{batch.id}/undo"},
        )
    lock_namespace(db, f"extra-duty:{batch.month}")
    db.refresh(batch)
    if batch.status == "undone":
        return {"batch_id": str(batch.id), "restored": 0, "conflicts": [], "dry_run": dry_run,
                "already_undone": True}
    period = db.get(RotaPeriod, batch.rota_period_id)
    if period is None or period.status.lower() != "draft":
        raise ExtraDutyError("not_draft", "Undo is only possible while the month is a draft.")

    _version, rules = get_phase_one_rules(db)
    names = {
        p.id: p.canonical_name
        for p in db.scalars(
            select(Person).where(
                Person.id.in_([UUID(i["person_id"]) for i in batch.before_image or [] if i.get("person_id")])
            )
        )
    }
    conflicts: list[dict[str, Any]] = []
    plan: list[tuple[dict, DutySlot | None, DutyAssignment | None]] = []
    for item in batch.before_image or []:
        slot = db.get(DutySlot, UUID(item["slot_id"]))
        assignment = db.get(DutyAssignment, UUID(item["assignment_id"])) if item.get("assignment_id") else None
        plan.append((item, slot, assignment))

        def conflict(code: str, message: str) -> None:
            person_id = item.get("person_id")
            conflicts.append(
                {
                    "slot_id": item["slot_id"],
                    "duty_date": slot.duty_date.isoformat() if slot is not None else None,
                    "duty_type": slot.duty_type if slot is not None else None,
                    "duty_label": _duty_label(rules, slot.duty_type) if slot is not None else None,
                    "person_name": names.get(UUID(person_id)) if person_id else None,
                    "reason": message,
                    "code": code,
                    "message": message,
                }
            )

        if slot is None:
            conflict("slot_missing", "The duty slot no longer exists.")
            continue
        label = f"{slot.duty_date.isoformat()} {slot.duty_type}"
        if assignment is None or not _active(assignment):
            conflict("assignment_removed", f"{label}: the extra-duty assignment was cleared or cancelled.")
        elif (
            str(assignment.person_id) != item.get("person_id")
            or assignment.duty_slot_id != slot.id
            or assignment.source != EXTRA_DUTY_SOURCE
        ):
            # docs/balance_extra_duties_contract.md section 1: Balance duties passed it on.
            passed_on = assignment.source == EXTRA_DUTY_SOURCE and any(
                (record.justice or {}).get("transfers")
                for record in db.scalars(
                    select(ExtraDutyRecord).where(
                        ExtraDutyRecord.assignment_id == assignment.id, ExtraDutyRecord.status == "active"
                    )
                )
            )
            conflict(
                "assignment_changed",
                f"{label}: Balance duties passed this extra duty on to another member. Undo Balance duties first."
                if passed_on
                else f"{label}: the extra-duty assignment was changed.",
            )
        if item.get("unit_id_after") and str(slot.unit_id) != item["unit_id_after"]:
            conflict("unit_changed", f"{label}: the slot was moved to another unit since.")
        others = [
            a for a in slot.assignments
            if _active(a) and str(a.id) != item.get("assignment_id")
        ]
        if others:
            conflict("slot_has_new_assignments", f"{label}: the slot has other members assigned since.")

    if dry_run:
        return {
            "batch_id": str(batch.id),
            "restored": 0 if conflicts else len(plan),
            "would_restore": len(plan),
            "conflicts": conflicts,
            "dry_run": True,
        }
    if conflicts:
        raise ExtraDutyError(
            "undo_conflict",
            "Balance duties passed some of these extra duties on since. Undo Balance duties first."
            if any("Undo Balance duties first" in c["message"] for c in conflicts)
            else "Some extra duties changed after they were applied; undo would not be exact.",
            409,
            {"conflicts": conflicts},
        )
    assignment_ids = []
    for item, slot, assignment in plan:
        assignment_ids.append(assignment.id)
        db.delete(assignment)
    db.flush()
    for item, slot, _assignment in plan:
        before = item.get("unit_id_before")
        slot.unit_id = UUID(before) if before else None
        slot.unit = db.get(Unit, slot.unit_id) if slot.unit_id else None
    void_records_for_assignments(db, assignment_ids, "undone")
    batch.status = "undone"
    batch.undone_at = datetime.utcnow()
    batch.undone_by_name = _user_name(user)
    db.commit()
    return {"batch_id": str(batch.id), "restored": len(plan), "conflicts": [], "dry_run": False}


# --------------------------------------------------------------------------------------------
# Verification
# --------------------------------------------------------------------------------------------


def verify_month(
    db: Session,
    month: str,
    *,
    assignment_ids: Iterable[UUID] | None = None,
    rules: RotaPhaseOneRules | None = None,
) -> dict[str, Any]:
    """Check every active assignment on the month's template slots (or only
    ``assignment_ids``) with ``strict_blockers``: ``{ok, checked, violations}``."""
    period, _scope = _period_and_scope(db, month)
    if period is None:
        return {"ok": True, "checked": 0, "violations": []}
    if rules is None:
        _version, rules = get_phase_one_rules(db)
    wanted = {UUID(str(item)) for item in assignment_ids} if assignment_ids is not None else None
    ctx = build_context(db, month, period, rules)
    # Fill-all contract 3: an assignment backed by an active ``unposted_member`` record is
    # exempt from the posted-to-unit check (only while the member has no posting that day).
    unposted_ids = {
        record.assignment_id
        for record in db.scalars(
            select(ExtraDutyRecord).where(
                ExtraDutyRecord.month == month, ExtraDutyRecord.status == "active"
            )
        )
        if UNPOSTED_CODE in (record.overridden_rules or [])
    }
    violations: list[dict[str, Any]] = []
    checked = 0
    superadmin_exempt = 0
    for slot in ctx.slots:
        for assignment in slot.assignments:
            if not _active(assignment) or (wanted is not None and assignment.id not in wanted):
                continue
            checked += 1
            blockers = strict_blockers(
                ctx,
                assignment.person_id,
                slot,
                slot.unit_id,
                exclude_assignment_id=assignment.id,
                allow_unposted=assignment.id in unposted_ids,
            )
            # Superadmin contract §1/§2: a superadmin allocation may override call level and
            # groups, unit rule, posting and the active-member check, never leave, rest,
            # overlap or capacity.
            if getattr(assignment, "source", None) == SUPERADMIN_SOURCE:
                superadmin_exempt += 1
                blockers = [b for b in blockers if b["code"] not in SUPERADMIN_EXEMPT_CODES]
            for blocker in blockers:
                violations.append(
                    {
                        "slot_id": str(slot.id),
                        "assignment_id": str(assignment.id),
                        "person_id": str(assignment.person_id),
                        "code": blocker["code"],
                        "message": blocker["label"],
                    }
                )
    result: dict[str, Any] = {"ok": not violations, "checked": checked, "violations": violations}
    if superadmin_exempt:
        result["superadmin_exempt"] = superadmin_exempt
    return result
