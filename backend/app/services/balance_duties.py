"""Balance duties: equal duty totals within each call level, after autofill.

Built to docs/call_level_pool_and_balance_contract.md section 2. Stage order: Build template ->
Autoassign members -> **Balance duties** -> Extra-duty layer -> Review -> Publish.

Shares (``shares``)
-------------------
For every call level L of the draft month:

* ``avail_i`` = days of the month member *i* is posted (any unit) and active, minus days with an
  active-status leave (``ACTIVE_LEAVE_STATUSES``; any leave on a day takes the whole day). A member
  with no posting in the month who holds a duty (the extra-duty "unposted" tier) is available on
  every day without leave.
* A member's level is the level they hold on their first posted day (as ``fairness_targets``).
* ``slots(L)`` = the month's *filled* duties of L: every active assignment on a non-excluded
  template slot. A duty needing one level counts 1 for it; a *pool* duty (several levels, see
  ``rota_eligibility.required_call_levels``) is split across its levels in proportion to each
  level's member count (as ``fairness_targets``). Open slots are left out: balancing only moves
  duties that exist; filling open slots is the extra-duty layer's job.
* ``share_i = slots(L) * avail_i / sum(avail)``; ``goal_i = round(share_i)``.
* A level is balanced when every member is within ``allowed_gap``
  (``fairness_rules.max_gap_within_call_level``) of their goal **and** the spread of
  ``duties - share`` is within ``allowed_gap`` (with equal availability that is "max - min").

Moves (``plan_balance``)
------------------------
Repeatedly the member furthest above their share (donor) gives one *movable* duty to the member
furthest below theirs (recipient), when that strictly improves the balance
(``dev_donor - dev_recipient > 1``). A move must:

* pass ``extra_duty.strict_blockers`` for the slot as it would be placed (active, posted to the
  unit, call level / pool and groups via ``rota_eligibility.eligibility``, the duty's unit
  rules, every active leave, same-day / overlap, rest after 24h in both directions, capacity);
* not take the recipient past an individual limit (``duty_count_limits``);
* not make any slot of an affected (unit, day) ``unit_safety_hard_block`` (``slot_safety``)
  that was not already: this covers the recipient's unit and "the donor's unit no worse".

A recipient posted to another unit takes the slot into their unit (as the extra-duty fallback
does); only in-scope units allowed by the duty's unit rules qualify. For extra-duty rows only, a
recipient with no posting at all on the date may take the duty in the slot's current unit (the
owner-approved fill-all ``unposted_member`` tier; the record then carries that code and the
independent checker waives the posting check). Ordinary rows always need a posted recipient.
Structural refusals (posting, level / pool, groups, unit rule, leave) are memoised and pruned
before any costly check, at no work cost; the budget is ``max(MAX_WORK, WORK_PER_SLOT * slots)``. When no direct move works
for a donor, a *swap* (donor duty X <-> recipient duty Y on different days) is tried together
with a move of another donor duty Z, as one atomic change that must pass every check (depth 1,
bounded by ``SWAP_RECIPIENTS``, ``SWAP_DONORS_PER_ROUND`` and ``MAX_SWAP_TRIALS``). The whole
search is bounded by a deterministic work counter (``MAX_WORK``), never by the clock, so preview
and apply always produce the same plan. A slot is moved at most once per plan.

Movable = an active (``assigned``/``draft``) assignment on a non-excluded template slot whose
source is in ``MOVABLE_SOURCES`` or ``balance_duties`` (an earlier balance; a later run keeps
refining), or ``extra_duty_layer`` backed by exactly one active ``ExtraDutyRecord`` held by the
same person (docs/balance_extra_duties_contract.md section 1). Never: manual,
``superadmin_allocation``, an extra-duty row with no / a void / a duplicate record, or
``confirmed`` rows. Donors give extra-duty rows first.

Extra duties (option 2): the ledger record moves with the duty inside the apply transaction:
``person_id`` -> recipient, ``assigned_unit_id`` -> the slot's unit after the move,
``fallback_used`` = unit after != record home unit, ``overridden_rules`` = the codes the new
holder triggers (``unit_safety_review`` / ``unit_safety_hard_block`` from ``slot_safety`` and
the individual limit codes, as ``validate_assignment`` reports them, against the final plan
state; plus the tier code by the holder's relation to the record's home unit), or
``rebalanced_extra_duty`` when none. ``justice`` becomes a new snapshot for the recipient with
the old snapshot kept in ``justice["transfers"]``. The assignment keeps source
``extra_duty_layer`` with override reason "Extra-duty layer: <codes> · balanced from X". The
batch ``before_image`` keeps the full record state before and after, so undo restores it
exactly (and refuses when the record was voided, transferred again or changed since).

Unit staffing ("no (unit, day) worse than now"): a move may not make a slot hard blocked that
was not, and on a slot that is already hard blocked (and stays in its unit) it may not raise
the number of unavailable members.

Apply re-plans under locks (``balance:<month>`` -> ``extra-duty:<month>`` ->
``rota-compute:<month>``), refuses a stale preview, rewrites the moved rows in place (person,
unit, source ``balance_duties``, override reason "Balanced: from X to Y"), records an
``ExtraDutyBatch`` with ``summary.mode = "balance"`` (no justice-ledger records), runs the
independent checker on the touched rows and rolls back on any violation.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    DutyAssignment,
    DutySlot,
    ExtraDutyBatch,
    ExtraDutyRecord,
    Person,
    RotaPeriod,
    Unit,
    UnitFallback,
)
from app.services import extra_duty as ed
from app.services.fairness_targets import split_pool_demand
from app.services.leave import ACTIVE_LEAVE_STATUSES, month_bounds
from app.services.reference_registry import lock_namespace
from app.services.rota_eligibility import CALL_LEVEL_ORDER, call_level_label, eligibility, member_call_level
from app.services.rota_rules import RotaPhaseOneRules, get_phase_one_rules
from app.services.rota_safety import (
    ACTIVE_ASSIGNMENT_STATUSES,
    SAFETY_HARD_BLOCK,
    SAFETY_WARNING,
    MemberContext,
    person_blockers,
    safety_status,
    slot_leave_blocks,
    slot_safety,
    unit_minimum_for_required_calls,
)
from app.services.rota_setup import SCOPE_INCLUDED

BALANCE_SOURCE = "balance_duties"
BALANCE_MODE = "balance"
# Automatic generation sources whose rows may be moved (contract section 2, "Movable"):
#   safe_auto_fill_draft   - rota_auto_fill (Autoassign members)
#   reviewed_compute_draft - rota_compute save path (CPU/GPU proposals, optimiser, template compute)
MOVABLE_SOURCES = frozenset({"safe_auto_fill_draft", "reviewed_compute_draft"})
MOVABLE_STATUSES = frozenset({"assigned", "draft"})  # "confirmed" rows are locked
# docs/balance_extra_duties_contract.md section 1: earlier balance rows move again, and
# extra-duty rows with exactly one active ledger record move with their record.
EXTRA_SOURCE = ed.EXTRA_DUTY_SOURCE
REBALANCED_CODE = ed.REBALANCED_CODE  # "rebalanced_extra_duty" (labelled in extra_duty)
EPS = 1e-9
SWAP_RECIPIENTS = 3
SWAP_DONORS_PER_ROUND = 8
MAX_SWAP_TRIALS = 3000  # deterministic cap on trial swaps per plan
# Deterministic work budget (never wall-clock: a time cut could make preview and apply differ
# and turn every apply into stale_preview). One uncached placement check costs 1, one full
# transfer (placement + unit staffing) costs ``TRANSFER_COST``. When the budget runs out the
# search stops at exactly the same point in preview and apply; ``summary.work_exhausted`` says so.
TRANSFER_COST = 10
MAX_WORK = 15_000  # minimum budget: about 1,500 full transfers
# The budget grows with the month (deterministic: the template slot count): max(MAX_WORK,
# WORK_PER_SLOT * slots). Structural refusals cost nothing (``_State.structural_block``).
WORK_PER_SLOT = 40
DEFAULT_ALLOWED_GAP = 1

REFUSAL_LABELS = {
    **ed.STRICT_LABELS,
    "individual_limit": "Over an individual duty limit",
    "unit_safety_hard_block": "Unit short-staffed (hard block)",
    "no_unit": "No usable unit for the recipient",
}


class BalanceError(ed.ExtraDutyError):
    """Contract errors; the HTTP layer maps them to ``{detail: {code, message, ...}}``."""


# --------------------------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------------------------


def enabled() -> bool:
    """``BALANCE_DUTIES_ENABLED`` (settings field when present, else the env var), default true."""
    from app.core.config import settings

    value = getattr(settings, "balance_duties_enabled", None)
    if value is None:
        raw = os.getenv("BALANCE_DUTIES_ENABLED", "true").strip().lower()
        value = raw not in {"0", "false", "no", "off"}
    return bool(value)


def _ensure_enabled() -> None:
    if not enabled():
        raise BalanceError("disabled", "Balance duties is turned off.", 503)


def allowed_gap(rules: Any) -> int:
    value = getattr(getattr(rules, "fairness_rules", None), "max_gap_within_call_level", None)
    return DEFAULT_ALLOWED_GAP if value is None else int(value)


def _level_order(level: str) -> tuple:
    return (CALL_LEVEL_ORDER.index(level) if level in CALL_LEVEL_ORDER else 99, level)


def _slot_levels(slot, rule, groups) -> set[str]:
    """The duty's level set (pool aware); ``rota_eligibility`` is the single source of truth."""
    from app.services import rota_eligibility as re_

    fn = getattr(re_, "required_call_levels", None) or re_.required_call_levels_for
    return set(fn(slot, rule, groups) or ())


def _active(assignment) -> bool:
    return str(assignment.status).lower() in ACTIVE_ASSIGNMENT_STATUSES


def _movable(assignment, slot, single_record: bool = False) -> bool:
    """``single_record``: the row is backed by exactly one active ledger record of its holder
    (``_single_records``); only then is an extra-duty row movable."""
    if str(assignment.status).lower() not in MOVABLE_STATUSES or slot.template_status == "excluded":
        return False
    if assignment.source in MOVABLE_SOURCES or assignment.source == BALANCE_SOURCE:
        return True
    return assignment.source == EXTRA_SOURCE and single_record


def _single_records(db: Session, assignments: Iterable) -> dict[UUID, ExtraDutyRecord]:
    """``{assignment id: record}`` for extra-duty rows with exactly one active ledger record,
    held by the row's own person. A row with no active record (void) or a duplicate is left out."""
    rows = {a.id: a for a in assignments if a.source == EXTRA_SOURCE}
    if not rows:
        return {}
    found: dict[UUID, list[ExtraDutyRecord]] = defaultdict(list)
    ids = list(rows)
    for start in range(0, len(ids), 500):
        for record in db.scalars(
            select(ExtraDutyRecord).where(
                ExtraDutyRecord.assignment_id.in_(ids[start:start + 500]),
                ExtraDutyRecord.status == "active",
            )
        ):
            found[record.assignment_id].append(record)
    return {
        aid: records[0]
        for aid, records in found.items()
        if len(records) == 1 and records[0].person_id == rows[aid].person_id
    }


def _record_state(record: ExtraDutyRecord) -> dict[str, Any]:
    """The record fields a ledger transfer changes, JSON-shaped (before / after images)."""
    return json.loads(_canonical({
        "record_id": str(record.id),
        "status": record.status,
        "person_id": str(record.person_id),
        "assigned_unit_id": str(record.assigned_unit_id) if record.assigned_unit_id else None,
        "fallback_used": bool(record.fallback_used),
        "overridden_rules": list(record.overridden_rules or []),
        "justice": dict(record.justice or {}),
    }))


def _canonical(data: Any) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)


def _user_name(user) -> str | None:
    return ed._user_name(user)


def _draft(db: Session, month: str):
    period, scope = ed._period_and_scope(db, month)
    if period is None:
        raise BalanceError("scope_unlocked", "Set up the month, lock its unit scope and build the template first.")
    if period.status.lower() != "draft":
        raise BalanceError("not_draft", "Only an unpublished draft month can be balanced.")
    if scope is None or not scope.is_locked:
        raise BalanceError("scope_unlocked", "Lock the month's unit scope and build the template first.")
    return period, scope


# --------------------------------------------------------------------------------------------
# Month state
# --------------------------------------------------------------------------------------------


class _State:
    """The month, loaded once; moves are applied to it in memory (never to the ORM)."""

    def __init__(self, db: Session, month: str, period: RotaPeriod, scope, rules: RotaPhaseOneRules):
        self.db = db
        self.month = month
        self.rules = rules
        self.gap = allowed_gap(rules)
        self.ctx = ed.build_context(db, month, period, rules)
        ctx = self.ctx
        self.starts_on, self.ends_on = ctx.starts_on, ctx.ends_on
        self.month_days = (self.ends_on - self.starts_on).days + 1
        self.units = ctx.units
        self.included = (
            {item.unit_id for item in scope.units if item.status == SCOPE_INCLUDED}
            if scope is not None
            else set(self.units)
        )
        self.postings_by_unit: dict[UUID, list] = defaultdict(list)
        for posting in ctx.postings:
            if posting.unit_id is not None:
                self.postings_by_unit[posting.unit_id].append(posting)

        # Template slots (non-excluded) and their current unit in the plan.
        self.slots = [s for s in ctx.slots if s.template_status != "excluded"]
        self.slot_by_id = {s.id: s for s in self.slots}
        self.slots_by_day: dict[date, list] = defaultdict(list)
        for slot in self.slots:
            self.slots_by_day[slot.duty_date].append(slot)
        self.slot_unit: dict[UUID, UUID | None] = {s.id: s.unit_id for s in self.slots}
        self.levels_of: dict[UUID, set[str]] = {}
        for slot in self.slots:
            rule = ctx.rule_by_key.get(slot.duty_type)
            self.levels_of[slot.id] = _slot_levels(slot, rule, ctx.groups)

        # Holders: assignment rows on the slots (active only), and which are movable.
        self.rows: dict[UUID, dict[str, Any]] = {}  # assignment id -> {slot, person, movable}
        self.duties: Counter = Counter()
        active_rows = [
            (slot, a)
            for slot in self.slots
            for a in sorted(slot.assignments, key=lambda a: str(a.id))
            if _active(a)
        ]
        # Extra-duty rows with exactly one active ledger record (they move with the record).
        self.records: dict[UUID, ExtraDutyRecord] = _single_records(db, (a for _s, a in active_rows))
        for slot, a in active_rows:
            self.rows[a.id] = {
                "slot": slot,
                "person": a.person_id,
                "movable": _movable(a, slot, a.id in self.records),
                "source": a.source,
                "extra": a.id in self.records,
            }
            self.duties[a.person_id] += 1
        # Active ledger records of the month per person (extra_before / extra_after).
        self.extra_count: Counter = Counter(
            pid for pid in db.scalars(
                select(ExtraDutyRecord.person_id).where(
                    ExtraDutyRecord.month == month, ExtraDutyRecord.status == "active"
                )
            )
        )
        self._fallbacks: dict[UUID, set[UUID]] | None = None
        self._structural: dict[tuple, str | None] = {}
        self._batch_modes: dict[UUID, str] = {}
        # (person, day) -> active entries (strict-check entries), kept in step with the plan.
        self.by_day: dict[tuple, list] = defaultdict(list)
        for pid, entries in self.ctx.entries_by_person.items():
            for entry in entries:
                self.by_day[(pid, entry.duty_date)].append(entry)

        self._members()
        self._shares()
        # Unit safety cache: slot id -> hard blocked (current plan state); and the static part
        # of each (slot, unit) safety check.
        self._safety: dict[UUID, bool] = {}
        self._static_safety: dict[tuple, tuple] = {}
        self._index_memo: dict | None = None

    # ---- members and shares ------------------------------------------------------------------

    def _members(self) -> None:
        ctx = self.ctx
        leave_days: dict[UUID, set[date]] = defaultdict(set)
        for day, people in ctx.leaves.items():
            if self.starts_on <= day <= self.ends_on:
                for pid in people:
                    leave_days[pid].add(day)
        posted: dict[UUID, set[date]] = defaultdict(set)
        first: dict[UUID, Any] = {}
        persons: dict[UUID, Person] = {}
        for posting in ctx.postings:
            person = posting.person
            if posting.unit_id is None or person is None or person.active_status != "active":
                continue
            # Only days posted to a unit in this month's scope count: a member posted only to an
            # excluded unit cannot legally take any of this month's duties, so has no share.
            if posting.unit_id not in self.included:
                continue
            lo = max(posting.starts_on, self.starts_on)
            hi = min(posting.ends_on or self.ends_on, self.ends_on)
            if lo > hi:
                continue
            day = lo
            while day <= hi:
                posted[person.id].add(day)
                day += timedelta(days=1)
            persons[person.id] = person
            current = first.get(person.id)
            key = (lo, posting.posting_type or "", str(posting.unit_id))
            if current is None or key < current[0]:
                first[person.id] = (key, posting)
        self.level: dict[UUID, str] = {}
        self.unit_of: dict[UUID, UUID | None] = {}
        self.avail: dict[UUID, int] = {}
        self.persons = persons
        for pid, days in posted.items():
            (lo, _ptype, _unit), posting = first[pid]
            self.level[pid] = member_call_level(
                MemberContext(person=posting.person, unit_id=posting.unit_id,
                              posting_type=posting.posting_type, day=lo)
            )
            self.unit_of[pid] = posting.unit_id
            self.avail[pid] = len(days - leave_days.get(pid, set()))
        # Unposted members holding a duty this month: available on every day without leave.
        for row in self.rows.values():
            pid = row["person"]
            if pid in self.level:
                continue
            person = ctx.persons.get(pid)
            if person is None or person.active_status != "active":
                continue
            self.level[pid] = member_call_level(
                MemberContext(person=person, unit_id=None, posting_type=person.call_level or "",
                              day=row["slot"].duty_date)
            )
            self.unit_of[pid] = None
            self.avail[pid] = self.month_days - len(leave_days.get(pid, set()))
            persons[pid] = person
        self.members_by_level: dict[str, list[UUID]] = defaultdict(list)
        for pid, level in self.level.items():
            if self.avail.get(pid, 0) > 0 or self.duties.get(pid, 0) > 0:
                self.members_by_level[level].append(pid)
        for level in self.members_by_level:
            self.members_by_level[level].sort(key=self.person_key)

    def person_key(self, pid: UUID) -> tuple:
        person = self.persons.get(pid) or self.ctx.persons.get(pid)
        return ((person.canonical_name if person else "").lower(), str(pid))

    def name(self, pid: UUID | None) -> str | None:
        if pid is None:
            return None
        person = self.persons.get(pid) or self.ctx.persons.get(pid)
        return person.canonical_name if person else str(pid)

    def unit_name(self, unit_id: UUID | None) -> str | None:
        unit = self.units.get(unit_id) if unit_id else None
        return unit.name if unit else None

    def _shares(self) -> None:
        counts = {lvl: len(pids) for lvl, pids in self.members_by_level.items()}
        self.level_slots: dict[str, float] = defaultdict(float)
        for row in self.rows.values():
            # Pool duties are split as fairness_targets does (single source: split_pool_demand).
            for lvl, part in split_pool_demand(self.levels_of.get(row["slot"].id, set()), counts).items():
                self.level_slots[lvl] += part
        self.share: dict[UUID, float] = {}
        self.goal: dict[UUID, int] = {}
        for level, pids in self.members_by_level.items():
            total_avail = sum(self.avail.get(pid, 0) for pid in pids)
            slots = self.level_slots.get(level, 0.0)
            for pid in pids:
                share = slots * self.avail.get(pid, 0) / total_avail if total_avail else 0.0
                self.share[pid] = share
                self.goal[pid] = int(round(share))

    def levels(self) -> list[str]:
        return sorted(
            (lvl for lvl in self.members_by_level if self.level_slots.get(lvl, 0) > 0 or any(
                self.duties.get(pid, 0) for pid in self.members_by_level[lvl])),
            key=_level_order,
        )

    def dev(self, pid: UUID) -> float:
        return self.duties.get(pid, 0) - self.share.get(pid, 0.0)

    def level_ok(self, level: str, duties: dict | None = None) -> bool:
        duties = self.duties if duties is None else duties
        pids = self.members_by_level.get(level, [])
        if not pids:
            return True
        devs = [duties.get(pid, 0) - self.share.get(pid, 0.0) for pid in pids]
        if max(devs) - min(devs) > self.gap + EPS:
            return False
        return all(abs(duties.get(pid, 0) - self.goal.get(pid, 0)) <= self.gap for pid in pids)

    def spread(self, level: str, duties: dict | None = None) -> dict[str, int]:
        duties = self.duties if duties is None else duties
        totals = [duties.get(pid, 0) for pid in self.members_by_level.get(level, [])]
        low, high = (min(totals), max(totals)) if totals else (0, 0)
        return {"min": low, "max": high, "gap": high - low}

    # ---- plan state changes ------------------------------------------------------------------

    def movable_rows(self, pid: UUID, touched: set[UUID]) -> list[UUID]:
        out = [
            aid for aid, row in self.rows.items()
            if row["person"] == pid and row["movable"] and row["slot"].id not in touched
        ]
        # Extra-duty rows first: they broke equality, and moving them spreads the ledger too.
        out.sort(key=lambda aid: (
            0 if self.rows[aid].get("extra") else 1, ed._slot_order(self.rows[aid]["slot"]), str(aid)
        ))
        return out

    def remove(self, aid: UUID) -> None:
        row = self.rows[aid]
        slot, pid = row["slot"], row["person"]
        entries = self.ctx.entries_by_person.get(pid, [])
        for index, entry in enumerate(entries):
            if entry.slot_id == slot.id:
                del entries[index]
                day_list = self.by_day.get((pid, entry.duty_date), [])
                if entry in day_list:
                    day_list.remove(entry)
                break
        self.ctx.slot_active[slot.id] -= 1
        self.ctx.slot_rows[slot.id].discard(pid)
        self.duties[pid] -= 1

    def add(self, aid: UUID, pid: UUID, unit_id: UUID | None) -> None:
        row = self.rows[aid]
        slot = row["slot"]
        self.ctx.add_plan_assignment(slot, pid, unit_id)
        entry = self.ctx.entries_by_person[pid][-1]
        self.by_day[(pid, entry.duty_date)].append(entry)
        row["person"] = pid
        self.slot_unit[slot.id] = unit_id
        self.duties[pid] += 1

    # ---- checks ------------------------------------------------------------------------------

    def candidate_units(self, pid: UUID, slot) -> list[UUID]:
        """Where ``pid`` could do ``slot``: its current unit if they are posted there that day,
        otherwise their in-scope posted units that day (by name)."""
        current = self.slot_unit.get(slot.id)
        if pid in self.ctx.unit_contexts(slot.duty_date, current):
            return [current]
        units = self.ctx.person_units(slot.duty_date).get(pid, set())
        usable = [
            uid for uid in units
            if uid in self.included and uid in self.units
            and (self.units[uid].active_status or "active") == "active"
        ]
        return sorted(usable, key=lambda uid: (self.unit_name(uid) or "", str(uid)))

    def over_limit(self, pid: UUID, slot, unit_id: UUID | None) -> bool:
        """Would doing ``slot`` in ``unit_id`` take ``pid`` past an individual limit?"""
        return bool(self.limit_codes(pid, slot, unit_id, first_only=True))

    def limit_codes(self, pid: UUID, slot, unit_id: UUID | None, *, first_only: bool = False,
                    exclude_slot: UUID | None = None) -> list[str]:
        """The individual-limit codes (``extra_duty.LIMIT_CODES``, as ``duty_count_issues``
        names them) doing ``slot`` in ``unit_id`` would break for ``pid``; ``exclude_slot``
        leaves that slot out of their current duties (for a holder already on it)."""
        limits = self.rules.duty_count_limits
        if all(getattr(limits, f) is None for f in (
            "max_24hr_per_month", "max_weekend_24hr_per_month", "max_same_group_per_month",
            "max_same_campus_per_month",
        )):
            return []
        seen: set[tuple] = set()
        month = []
        for e in self.ctx.entries_by_person.get(pid, []):
            if not (self.starts_on <= e.duty_date <= self.ends_on) or e.key in seen:
                continue
            if exclude_slot is not None and e.slot_id == exclude_slot:
                continue
            seen.add(e.key)
            month.append(e)
        rules = self.rules

        def group(duty_type: str) -> str:
            rule = rules.duty_rules_by_key.get(duty_type)
            return rule.group if rule else duty_type

        def campus(unit_id):
            unit = self.units.get(unit_id) if unit_id else None
            return unit.campus if unit else None

        codes: list[str] = []
        if slot.is_24hr and limits.max_24hr_per_month is not None:
            if sum(1 for e in month if e.is_24hr) + 1 > limits.max_24hr_per_month:
                codes.append("monthly_24hr_limit")
                if first_only:
                    return codes
        if slot.is_24hr and slot.duty_date.weekday() >= 5 and limits.max_weekend_24hr_per_month is not None:
            if sum(1 for e in month if e.is_24hr and e.duty_date.weekday() >= 5) + 1 > limits.max_weekend_24hr_per_month:
                codes.append("monthly_weekend_24hr_limit")
                if first_only:
                    return codes
        if limits.max_same_group_per_month is not None:
            g = group(slot.duty_type)
            if sum(1 for e in month if group(e.duty_type) == g) + 1 > limits.max_same_group_per_month:
                codes.append("monthly_same_group_limit")
                if first_only:
                    return codes
        c = campus(unit_id)
        if c and limits.max_same_campus_per_month is not None:
            if sum(1 for e in month if campus(e.unit_id) == c) + 1 > limits.max_same_campus_per_month:
                codes.append("monthly_same_campus_limit")
        return codes

    def unposted_on(self, pid: UUID, day: date) -> bool:
        """``pid`` has no posting at all on ``day`` (the fill-all ``unposted_member`` tier)."""
        return pid not in self.ctx.person_units(day)

    def structural_block(self, pid: UUID, slot, allow_unposted: bool = False) -> str | None:
        """The plan-independent part of the placement check, free of work cost: active, a
        usable posting on the date (or, with ``allow_unposted`` - extra-duty rows only - no
        posting at all that day), call level / pool and groups (``eligibility_block``), the
        duty's unit rules and leave. ``None`` when the costly checks (rest, overlap, capacity,
        limits, staffing) are worth running. Memoised per (person, slot, slot unit)."""
        key = (pid, slot.id, self.slot_unit.get(slot.id), allow_unposted)
        if key in self._structural:
            return self._structural[key]
        ctx = self.ctx
        code: str | None = None
        person = ctx.persons.get(pid)
        if person is None or person.active_status != "active":
            code = "inactive_member"
        else:
            units = self.candidate_units(pid, slot)
            unposted = False
            if not units:
                if allow_unposted and self.unposted_on(pid, slot.duty_date):
                    units, unposted = [self.slot_unit.get(slot.id)], True
                else:
                    code = "not_in_unit"
            if code is None:
                first: str | None = None
                usable = False
                for unit_id in units:
                    blocked = ctx.eligibility_block(pid, slot, unit_id, unposted)
                    if blocked is not None:
                        first = first or blocked[0]
                        continue
                    if ctx.unit_rule_blocks(slot, unit_id):
                        first = first or "unit_rule"
                        continue
                    usable = True
                    break
                code = None if usable else (first or "not_in_unit")
            if code is None:
                for leave in ctx.leaves.get(slot.duty_date, {}).get(pid, []):
                    if leave.status.lower() in ACTIVE_LEAVE_STATUSES and slot_leave_blocks(leave, slot):
                        code = "leave"
                        break
        self._structural[key] = code
        return code

    def place_check(self, pid: UUID, slot, free_one: bool = False,
                    allow_unposted: bool = False) -> tuple[UUID | None, str | None]:
        """``(unit, None)`` when ``pid`` may take ``slot`` now, else ``(None, refusal code)``.
        Strict rules (``extra_duty.strict_blockers``), then individual limits. ``free_one``
        judges capacity as if the slot's current holder had already given it up.
        ``allow_unposted`` (extra-duty rows only): a member with no posting at all on the date
        may take the duty in the slot's current unit (the fill-all unposted tier)."""
        if free_one:
            self.ctx.slot_active[slot.id] -= 1
        try:
            units = self.candidate_units(pid, slot)
            if not units:
                # Not posted anywhere usable: strict_blockers names the reason on the slot's unit.
                current = self.slot_unit.get(slot.id)
                unposted = allow_unposted and self.unposted_on(pid, slot.duty_date)
                blockers = ed.strict_blockers(self.ctx, pid, slot, current, first_only=True,
                                              allow_unposted=unposted)
                if blockers:
                    return None, blockers[0]["code"]
                if not unposted or current is None:
                    return None, "no_unit"
                if self.over_limit(pid, slot, current):
                    return None, "individual_limit"
                return current, None
            first_code = None
            for unit_id in units:
                blockers = ed.strict_blockers(self.ctx, pid, slot, unit_id, first_only=True)
                if blockers:
                    first_code = first_code or blockers[0]["code"]
                    continue
                if self.over_limit(pid, slot, unit_id):
                    first_code = first_code or "individual_limit"
                    continue
                return unit_id, None
            return None, first_code
        finally:
            if free_one:
                self.ctx.slot_active[slot.id] += 1

    def _blocker_indexes(self, unit_id: UUID, day: date) -> tuple[dict, dict]:
        """``(same_day, previous_day)`` for people posted to ``unit_id`` on ``day``, shaped like
        ``rota_safety.assignment_indexes`` for that day, from the plan state."""
        same_day: dict[UUID, list] = {}
        previous: dict[UUID, list] = {}
        yesterday = day - timedelta(days=1)
        for pid in self.ctx.unit_contexts(day, unit_id):
            for e in self.by_day.get((pid, day), ()):
                if e.blocks_same_day:
                    item = SimpleNamespace(duty_slot_id=e.slot_id, duty_slot=SimpleNamespace(duty_type=e.duty_type))
                    same_day.setdefault(pid, []).append(item)
            for e in self.by_day.get((pid, yesterday), ()):
                if e.blocks_next_day:
                    item = SimpleNamespace(duty_slot_id=e.slot_id, duty_slot=SimpleNamespace(duty_type=e.duty_type))
                    previous.setdefault(pid, []).append(item)
        return same_day, previous

    def _view(self, slot, unit_id: UUID):
        return slot if unit_id == slot.unit_id else ed._slot_view(slot, self.units[unit_id])

    def slot_safety_reference(self, slot) -> dict[str, Any]:
        """``rota_safety.slot_safety`` for the slot in its plan unit, against the plan state
        (the reference ``_slot_hard_blocked`` must agree with; see the tests)."""
        unit_id = self.slot_unit.get(slot.id)
        same_day, previous = self._blocker_indexes(unit_id, slot.duty_date)
        return slot_safety(
            slot=self._view(slot, unit_id),
            rules=self.rules,
            postings=self.postings_by_unit.get(unit_id, []),
            leaves=self.ctx.leaves,
            same_day_assignments={slot.duty_date: same_day},
            previous_day_assignments={slot.duty_date: previous},
        )

    def _slot_hard_blocked(self, slot) -> bool:
        """``slot_safety(...)["safety_status"] == hard_blocked`` for the slot in its plan unit."""
        return self._slot_status(slot)[0] == SAFETY_HARD_BLOCK

    def _slot_status(self, slot) -> tuple[str | None, int]:
        """``(safety status, unavailable members)`` of the slot in its plan unit.

        Same computation as ``rota_safety.slot_safety`` with its static part (the unit's eligible
        member contexts, required levels and minimum) cached per (slot, unit); the dynamic part
        uses the same ``person_blockers`` and ``safety_status``."""
        unit_id = self.slot_unit.get(slot.id)
        if unit_id is None or unit_id not in self.units:
            return None, 0
        key = (slot.id, unit_id)
        static = self._static_safety.get(key)
        if static is None:
            view = self._view(slot, unit_id)
            rule = self.ctx.rule_by_key.get(slot.duty_type)
            groups = self.ctx.groups
            contexts = [c for items in self.ctx.unit_contexts(slot.duty_date, unit_id).values() for c in items]
            eligible = [c for c in contexts if eligibility(c, view, rule, groups).eligible]
            required = _slot_levels(view, rule, groups)
            minimum = unit_minimum_for_required_calls(self.units[unit_id], required, self.rules)
            static = (view, eligible, minimum)
            self._static_safety[key] = static
        view, eligible, minimum = static
        memo = self._index_memo
        if memo is None:
            same_day, previous = self._blocker_indexes(unit_id, slot.duty_date)
        else:
            if (unit_id, slot.duty_date) not in memo:
                memo[(unit_id, slot.duty_date)] = self._blocker_indexes(unit_id, slot.duty_date)
            same_day, previous = memo[(unit_id, slot.duty_date)]
        day_leaves = self.ctx.leaves.get(slot.duty_date, {})
        hard = warning = available = 0
        for context in eligible:
            blocked, warnings = person_blockers(
                person_id=context.person.id,
                slot=view,
                day_leaves=day_leaves,
                same_day_assignments=same_day,
                previous_day_assignments=previous,
            )
            if blocked:
                hard += 1
            else:
                available += 1
                if warnings:
                    warning += 1
        status, _reasons = safety_status(
            eligible_members=len(eligible),
            available_members=available,
            hard_blocked_members=hard,
            warning_members=warning,
            rules=self.rules,
            minimum_available_count=minimum,
        )
        return status, hard

    def affected_slots(self, placed: list[tuple]) -> list:
        """Template slots whose staffing safety a set of transfers can change:
        ``placed`` = [(aid, from, unit before, to, unit after)]. Safety of a slot on (unit, day)
        reads the duties of members posted to that unit on that day and the day before, so the
        pairs are both people's posted units and the slot's units, on the duty day and the next
        day; the moved slots themselves are always included."""
        pairs, moved = self.affected_pairs(placed)
        units_of_day: dict[date, set] = defaultdict(set)
        for uid, day in pairs:
            units_of_day[day].add(uid)
        # Every moved slot's day is in ``units_of_day``, so it is picked up below.
        return [
            s
            for day, uids in sorted(units_of_day.items())
            for s in self.slots_by_day.get(day, [])
            if s.id in moved or self.slot_unit.get(s.id) in uids
        ]

    def affected_pairs(self, placed: list[tuple]) -> tuple[set, set]:
        """``({(unit, day)}, {moved slot ids})`` for ``affected_slots``."""
        pairs: set[tuple[UUID | None, date]] = set()
        moved: set[UUID] = set()
        for aid, frm, before, to, after in placed:
            slot = self.rows[aid]["slot"]
            moved.add(slot.id)
            for day in (slot.duty_date, slot.duty_date + timedelta(days=1)):
                units = {before, after}
                for pid in (frm, to):
                    units |= set(self.ctx.person_units(day).get(pid, set()))
                for uid in units:
                    pairs.add((uid, day))
        return pairs, moved

    def hard_blocked_ids(self, slots: Iterable, cached: bool) -> dict[UUID, int]:
        """``{slot id: unavailable members}`` for the hard-blocked slots among ``slots``."""
        result: dict[UUID, int] = {}
        self._index_memo = {}  # (unit, day) blocker indexes, valid for this call's state only
        try:
            for slot in slots:
                if cached and slot.id in self._safety:
                    blocked = self._safety[slot.id]
                else:
                    status, hard = self._slot_status(slot)
                    blocked = hard if status == SAFETY_HARD_BLOCK else None
                    if cached:
                        self._safety[slot.id] = blocked
                if blocked is not None:
                    result[slot.id] = blocked
        finally:
            self._index_memo = None
        return result

    def invalidate_safety(self, slots: Iterable) -> None:
        for slot in slots:
            self._safety.pop(slot.id, None)

    # ---- extra duties: the codes the new holder triggers --------------------------------------

    def fallback_units_of(self, unit_id: UUID | None) -> set[UUID]:
        if self._fallbacks is None:
            self._fallbacks = defaultdict(set)
            for row in self.db.scalars(select(UnitFallback)):
                self._fallbacks[row.unit_id].add(row.fallback_unit_id)
        return self._fallbacks.get(unit_id, set())

    def batch_mode(self, batch_id: UUID) -> str:
        if batch_id not in self._batch_modes:
            batch = self.db.get(ExtraDutyBatch, batch_id)
            mode = (batch.summary or {}).get("mode") if batch is not None else None
            self._batch_modes[batch_id] = mode or ed.MODE_STANDARD
        return self._batch_modes[batch_id]

    def tier_code(self, record: ExtraDutyRecord, pid: UUID, slot, unit_id: UUID | None) -> str | None:
        """The extra-duty tier code of ``pid`` doing ``slot`` in ``unit_id``, by their relation
        to the record's home unit (as the extra-duty planner assigns them): unposted ->
        ``unposted_member``; home -> none; standard-mode batches -> ``fallback_unit``; all-units
        batches -> ``outside_scope_unit`` (unit not in scope), ``fallback_unit`` (an explicit
        fallback of the home unit or the same campus) or ``any_unit``."""
        if pid not in self.ctx.unit_contexts(slot.duty_date, unit_id):
            return ed.UNPOSTED_CODE
        home = record.home_unit_id
        if unit_id == home:
            return None
        if self.batch_mode(record.batch_id) != ed.MODE_ALL_UNITS:
            return ed.FALLBACK_UNIT_CODE
        if unit_id not in self.included:
            return ed.OUTSIDE_SCOPE_CODE
        home_unit = self.units.get(home) if home else None
        unit = self.units.get(unit_id) if unit_id else None
        if unit_id in self.fallback_units_of(home) or (
            home_unit is not None and unit is not None and home_unit.campus and unit.campus == home_unit.campus
        ):
            return ed.FALLBACK_UNIT_CODE
        return ed.ANY_UNIT_CODE

    def holder_codes(self, aid: UUID) -> list[str]:
        """``overridden_rules`` for the current holder of extra-duty row ``aid`` in the plan
        state: the overridable codes ``validate_assignment`` would report (unit staffing review /
        hard block from the slot's safety, individual limits), then the tier code; or
        ``rebalanced_extra_duty`` when the holder triggers none."""
        row = self.rows[aid]
        slot, pid = row["slot"], row["person"]
        unit_id = self.slot_unit.get(slot.id)
        codes: list[str] = []
        status, _hard = self._slot_status(slot)
        if status == SAFETY_WARNING:
            codes.append("unit_safety_review")
        elif status == SAFETY_HARD_BLOCK:
            codes.append("unit_safety_hard_block")
        for code in self.limit_codes(pid, slot, unit_id, exclude_slot=slot.id):
            if code not in codes:
                codes.append(code)
        tier = self.tier_code(self.records[aid], pid, slot, unit_id)
        if tier and tier not in codes:
            codes.append(tier)
        return codes or [REBALANCED_CODE]

    def justice_snapshot(self, aid: UUID, ledger: dict, lookback: int, earlier: int) -> dict[str, Any]:
        """The recipient's justice keys at transfer time (the extra-duty planner's shape):
        ledger count (saved ledger in the look-back window plus ``earlier`` transfers to them in
        this batch), their month duties / 24h duties / rest before the slot without it, and the
        pro-rata share as the call-level target."""
        row = self.rows[aid]
        slot, pid = row["slot"], row["person"]
        base = ledger.get(pid) or {"count": 0, "last_date": None}
        entries = [e for e in self.ctx.entries_by_person.get(pid, []) if e.slot_id != slot.id]
        month_entries = [e for e in entries if self.starts_on <= e.duty_date <= self.ends_on]
        previous = [slot.starts_at - e.ends_at for e in entries if e.ends_at <= slot.starts_at]
        share = self.share.get(pid)
        last = base["last_date"]
        return {
            "ledger_count": int(base["count"]) + earlier,
            "last_extra_date": last.isoformat() if last else None,
            "month_duties": len(month_entries),
            "month_24hr": sum(1 for e in month_entries if e.is_24hr),
            "rest_hours": round(min(previous).total_seconds() / 3600, 2) if previous else None,
            "call_level_target": None if share is None else round(share, 2),
            "target_distance": None if share is None else round(len(month_entries) - share, 2),
            "source": BALANCE_SOURCE,
        }


# --------------------------------------------------------------------------------------------
# Planning
# --------------------------------------------------------------------------------------------


class _Planner:
    """The search (module docstring). Bounded only by deterministic caps (``MAX_WORK``,
    ``MAX_SWAP_TRIALS``), never by the clock, so the same month always gives the same plan."""

    def __init__(self, state: _State, max_work: int = MAX_WORK):
        self.s = state
        self.max_work = max_work
        self.work = 0
        self.exhausted = False
        # (unit, day) -> version, bumped by every committed transfer touching it; a transfer
        # refused by unit staffing stays refused while its pairs and both people are unchanged.
        self.pair_version: Counter = Counter()
        self.staffing_failed: dict[tuple, tuple] = {}
        self.touched: set[UUID] = set()
        self.moves: list[dict[str, Any]] = []
        self.swaps = 0
        self.swap_trials = 0
        self.swap_capped = False
        self.refusals: dict[str, dict[str, set]] = defaultdict(lambda: defaultdict(set))
        self.version: Counter = Counter()  # per person, bumped on every change
        self.place_cache: dict[tuple, tuple] = {}
        self.swap_failed: dict[tuple, tuple] = {}

    # ---- primitive transfer with all checks --------------------------------------------------

    def precheck(self, pid: UUID, aid: UUID) -> tuple[UUID | None, str | None]:
        """Could ``pid`` take row ``aid``'s slot if its holder gave it up? Cached per the
        person's version (the result depends only on their own duties and the slot)."""
        slot = self.s.rows[aid]["slot"]
        key = (pid, slot.id)
        hit = self.place_cache.get(key)
        if hit is not None and hit[0] == self.version[pid]:
            return hit[1]
        self.spend(1)
        result = self.s.place_check(pid, slot, free_one=True, allow_unposted=self.unposted_ok(aid))
        self.place_cache[key] = (self.version[pid], result)
        return result

    def unposted_ok(self, aid: UUID) -> bool:
        """Only extra-duty rows may go to a member with no posting on the date (the owner
        approved that fill-all tier; the record then carries ``unposted_member``)."""
        return bool(self.s.rows[aid].get("extra"))

    def structural_ok(self, pid: UUID, aid: UUID) -> str | None:
        """``None`` or the structural refusal code (``_State.structural_block``); costs no work."""
        slot = self.s.rows[aid]["slot"]
        if self.s.level.get(pid) not in self.s.levels_of.get(slot.id, set()):
            return "call_level_mismatch"
        return self.s.structural_block(pid, slot, self.unposted_ok(aid))

    def spend(self, amount: int) -> None:
        self.work += amount
        if self.work >= self.max_work:
            self.exhausted = True

    def _staffing_key(self, pairs: list[tuple[UUID, UUID]]) -> tuple:
        return tuple(pairs)

    def _staffing_refused(self, pairs: list[tuple[UUID, UUID]]) -> bool:
        hit = self.staffing_failed.get(self._staffing_key(pairs))
        if hit is None:
            return False
        people, snapshot = hit
        return people == self._people_stamp(pairs) and all(
            self.pair_version[pair] == ver for pair, ver in snapshot
        )

    def _people_stamp(self, pairs) -> tuple:
        s = self.s
        return tuple((self.version[s.rows[aid]["person"]], self.version[to]) for aid, to in pairs)

    def _raw(self, items: list[tuple[UUID, UUID, UUID | None]]) -> None:
        """Set each row ``aid`` to ``(person, unit)`` without checks."""
        s = self.s
        for aid, _pid, _unit in items:
            s.remove(aid)
        for aid, pid, unit in items:
            s.add(aid, pid, unit)

    def transfer(self, pairs: list[tuple[UUID, UUID]]) -> tuple[bool, str | None, list]:
        """Move each ``(assignment id, to person)`` together: all rows are freed first, then each
        is placed with the strict and limit checks, and finally no slot on an affected (unit,
        day) may become hard blocked by staffing. On failure nothing changes. Returns ``(ok,
        refusal code, placed)`` with ``placed`` = [(aid, from, unit before, to, unit after)]."""
        s = self.s
        if self._staffing_refused(pairs):
            return False, "unit_safety_hard_block", []
        self.spend(TRANSFER_COST)
        original = [(aid, s.rows[aid]["person"], s.slot_unit[s.rows[aid]["slot"].id]) for aid, _to in pairs]
        for aid, _to in pairs:
            s.remove(aid)
        placed = []
        failure = None
        for (aid, to), (_aid, frm, unit_before) in zip(pairs, original):
            unit_id, code = s.place_check(to, s.rows[aid]["slot"], allow_unposted=self.unposted_ok(aid))
            if unit_id is None:
                failure = code or "no_unit"
                break
            s.add(aid, to, unit_id)
            placed.append((aid, frm, unit_before, to, unit_id))
        if failure is not None:
            for aid, *_rest in reversed(placed):
                s.remove(aid)
            for aid, frm, unit in original:
                s.add(aid, frm, unit)
            return False, failure, []
        slots = s.affected_slots(placed)
        unit_days, _moved = s.affected_pairs(placed)
        blocked_after = s.hard_blocked_ids(slots, cached=False)
        self._raw(original)
        blocked_before = s.hard_blocked_ids(slots, cached=True)
        # "No (unit, day) worse than now" (balance_extra_duties contract section 1): no slot may
        # become hard blocked, and a slot already hard blocked may not lose an available member
        # (compared only while the slot stays in its unit; a moved slot is judged in its new
        # unit by the first rule).
        relocated = {s.rows[aid]["slot"].id for aid, _frm, ub, _to, ua in placed if ub != ua}
        worse = any(
            sid not in blocked_before
            or (sid not in relocated and hard > blocked_before[sid])
            for sid, hard in blocked_after.items()
        )
        if worse:
            self.staffing_failed[self._staffing_key(pairs)] = (
                self._people_stamp(pairs),
                tuple((pair, self.pair_version[pair]) for pair in sorted(unit_days, key=str)),
            )
            return False, "unit_safety_hard_block", []
        self._raw([(aid, to, ua) for aid, _frm, _ub, to, ua in placed])
        s.invalidate_safety(slots)
        for pair in unit_days:
            self.pair_version[pair] += 1
        for _aid, frm, _ub, to, _ua in placed:
            self.version[frm] += 1
            self.version[to] += 1
        return True, None, placed

    # ---- search ------------------------------------------------------------------------------

    def improving(self, donor: UUID, recipient: UUID) -> bool:
        return self.s.dev(donor) - self.s.dev(recipient) > 1 + EPS

    def pool_ok(self, donor: UUID, recipient: UUID) -> bool:
        """A pool move to another level must not unbalance the recipient's level."""
        s = self.s
        level_d, level_r = s.level.get(donor), s.level.get(recipient)
        if level_d == level_r:
            return True
        duties = dict(s.duties)
        duties[recipient] = duties.get(recipient, 0) + 1
        duties[donor] = duties.get(donor, 0) - 1
        before = self._dev_spread(level_r, s.duties)
        after = self._dev_spread(level_r, duties)
        return after <= max(before, s.gap) + EPS

    def _dev_spread(self, level, duties) -> float:
        pids = self.s.members_by_level.get(level, [])
        if not pids:
            return 0.0
        devs = [duties.get(pid, 0) - self.s.share.get(pid, 0.0) for pid in pids]
        return max(devs) - min(devs)

    def recipients_for(self, donor: UUID, slot_levels: set[str]) -> list[UUID]:
        s = self.s
        pids = {pid for lvl in slot_levels for pid in s.members_by_level.get(lvl, [])}
        out = [pid for pid in pids if pid != donor and self.improving(donor, pid)]
        out.sort(key=lambda pid: (s.dev(pid), *s.person_key(pid)))
        return out

    def _refuse(self, donor: UUID, recipient: UUID, aid: UUID, code: str | None) -> None:
        level = self.s.level.get(donor)
        self.refusals[level][code or "no_unit"].add((recipient, self.s.rows[aid]["slot"].id))

    def _levels_of_rows(self, rows: list[UUID]) -> set[str]:
        levels: set[str] = set()
        for aid in rows:
            levels |= self.s.levels_of.get(self.s.rows[aid]["slot"].id, set())
        return levels

    def try_direct(self, donor: UUID) -> bool:
        s = self.s
        rows = s.movable_rows(donor, self.touched)
        if not rows:
            return False
        for recipient in self.recipients_for(donor, self._levels_of_rows(rows)):
            if not self.pool_ok(donor, recipient):
                continue
            for aid in rows:
                slot = s.rows[aid]["slot"]
                if s.level.get(recipient) not in s.levels_of.get(slot.id, set()):
                    continue
                # Structural refusals (posting, level / pool, groups, unit rule, leave) are
                # pruned before any costly check and cost no work.
                code = self.structural_ok(recipient, aid)
                if code is not None:
                    self._refuse(donor, recipient, aid, code)
                    continue
                if self.exhausted:
                    return False
                unit_id, code = self.precheck(recipient, aid)
                if unit_id is None:
                    self._refuse(donor, recipient, aid, code)
                    continue
                ok, code, placed = self.transfer([(aid, recipient)])
                if not ok:
                    self._refuse(donor, recipient, aid, code)
                    continue
                self.record("move", placed)
                return True
        return False

    def try_swap(self, donor: UUID) -> bool:
        """Swap donor duty X with recipient duty Y (different days) together with a direct move
        of another donor duty Z, as one atomic change: the swap alone keeps totals, and it is
        only kept when it unlocks Z (typically Y was what blocked the recipient from X and Z).
        Bounded by ``SWAP_RECIPIENTS`` and ``MAX_SWAP_TRIALS``."""
        s = self.s
        rows_d = s.movable_rows(donor, self.touched)
        if len(rows_d) < 2:
            return False
        for recipient in self.recipients_for(donor, self._levels_of_rows(rows_d))[:SWAP_RECIPIENTS]:
            key = (donor, recipient)
            stamp = (self.version[donor], self.version[recipient], len(self.touched))
            if self.swap_failed.get(key) == stamp or not self.pool_ok(donor, recipient):
                continue
            level_d, level_r = s.level.get(donor), s.level.get(recipient)
            rows_r = s.movable_rows(recipient, self.touched)
            # Structural pruning (free): only rows each side could take at all are combined.
            x_ok = [x for x in rows_d if self.structural_ok(recipient, x) is None]
            if len(x_ok) < 2:
                self.swap_failed[key] = (self.version[donor], self.version[recipient], len(self.touched))
                continue
            for y in rows_r:
                slot_y = s.rows[y]["slot"]
                if level_d not in s.levels_of.get(slot_y.id, set()) or self.structural_ok(donor, y) is not None:
                    continue
                for x in x_ok:
                    slot_x = s.rows[x]["slot"]
                    if slot_x.duty_date == slot_y.duty_date or level_r not in s.levels_of.get(slot_x.id, set()):
                        continue
                    for z in x_ok:
                        if z == x or level_r not in s.levels_of.get(s.rows[z]["slot"].id, set()):
                            continue
                        if self.swap_trials >= MAX_SWAP_TRIALS or self.exhausted:
                            return False
                        if self.work >= self.max_work // 2:
                            # Swaps may use at most half the budget, so the search ends on
                            # "no improving move" rather than at the work limit.
                            self.swap_capped = True
                            return False
                        self.swap_trials += 1
                        ok, _code, placed = self.transfer([(x, recipient), (y, donor), (z, recipient)])
                        if not ok:
                            continue
                        self.record("swap", placed[:2])
                        self.record("move", placed[2:])
                        self.swaps += 1
                        return True
            self.swap_failed[key] = (self.version[donor], self.version[recipient], len(self.touched))
        return False

    def record(self, kind: str, placed) -> None:
        s = self.s
        pair = [str(s.rows[aid]["slot"].id) for aid, *_rest in placed]
        for aid, frm, ub, to, ua in placed:
            slot = s.rows[aid]["slot"]
            self.touched.add(slot.id)
            cross = ub != ua
            if kind == "swap":
                reason = (
                    f"Swapped between {s.name(frm)} and {s.name(to)} so that a further duty can move; "
                    "their totals do not change."
                )
            else:
                reason = (
                    f"{s.name(frm)} had {s.duties[frm] + 1} duties (goal {s.goal.get(frm, 0)}); "
                    f"{s.name(to)} had {s.duties[to] - 1} (goal {s.goal.get(to, 0)})."
                )
            if cross:
                reason += f" The duty moves from {s.unit_name(ub)} to {s.unit_name(ua)}."
            record = s.records.get(aid) if s.rows[aid].get("extra") else None
            if record is not None:
                reason += f" Extra duty: the justice-ledger credit moves to {s.name(to)}."
            self.moves.append({
                "kind": kind,
                "slot_id": str(slot.id),
                "assignment_id": str(aid),
                "duty_date": slot.duty_date.isoformat(),
                "duty_type": slot.duty_type,
                "duty_label": ed._duty_label(s.rules, slot.duty_type),
                "call_level": s.level.get(to),
                "from_person_id": str(frm),
                "from_person": s.name(frm),
                "from_unit_id": str(ub) if ub else None,
                "from_unit": s.unit_name(ub),
                "to_person_id": str(to),
                "to_person": s.name(to),
                "to_unit_id": str(ua) if ua else None,
                "to_unit": s.unit_name(ua),
                "cross_unit": cross,
                "swap_with": [p for p in pair if p != str(slot.id)] if kind == "swap" else [],
                **self._swap_partner(kind, placed, aid),
                "reason": reason,
                # docs/balance_extra_duties_contract.md section 1: the ledger record follows.
                "extra_duty": record is not None,
                "record_id": str(record.id) if record is not None else None,
                "ledger_from": s.name(frm) if record is not None else None,
                "ledger_to": s.name(to) if record is not None else None,
                "old_overridden_rules": list(record.overridden_rules or []) if record is not None else [],
                "new_overridden_rules": [],  # set after the search, from the final plan state
            })

    def _swap_partner(self, kind: str, placed, aid) -> dict[str, Any]:
        """For a swap entry: the other duty of the pair (``swap_duty_date``/``swap_duty_label``)."""
        if kind != "swap":
            return {"swap_duty_date": None, "swap_duty_label": None}
        other = next((self.s.rows[a]["slot"] for a, *_r in placed if a != aid), None)
        if other is None:
            return {"swap_duty_date": None, "swap_duty_label": None}
        return {"swap_duty_date": other.duty_date.isoformat(),
                "swap_duty_label": ed._duty_label(self.s.rules, other.duty_type)}

    def run(self) -> None:
        s = self.s
        while not self.exhausted:
            levels = s.levels()
            unbalanced = {lvl for lvl in levels if not s.level_ok(lvl)}
            if not unbalanced:
                break
            donors = [pid for lvl in sorted(unbalanced, key=_level_order) for pid in s.members_by_level.get(lvl, [])]
            donors.sort(key=lambda pid: (-s.dev(pid), *s.person_key(pid)))
            low = min((s.dev(pid) for lvl in levels for pid in s.members_by_level.get(lvl, [])), default=0.0)
            moved = False
            for donor in donors:
                if s.dev(donor) - low <= 1 + EPS:
                    break
                if self.try_direct(donor):
                    moved = True
                    break
            if not moved:
                for donor in donors[:SWAP_DONORS_PER_ROUND]:
                    if s.dev(donor) - low <= 1 + EPS:
                        break
                    if self.try_swap(donor):
                        moved = True
                        break
            if not moved:
                break


def _level_rows(state: _State, before: dict, refusals: dict | None = None,
                has_movable: dict | None = None, exhausted: bool = False) -> list[dict[str, Any]]:
    rows = []
    for level in state.levels():
        pids = state.members_by_level.get(level, [])
        goals = [state.goal.get(pid, 0) for pid in pids]
        ok_before = state.level_ok(level, before)
        ok_after = state.level_ok(level)
        reason = None
        if not ok_after:
            parts = []
            if exhausted:
                parts.append("the search reached its work limit (run Balance duties again to continue)")
            above = [pid for pid in pids if state.dev(pid) > state.gap - EPS]
            if has_movable is not None and above and not any(has_movable.get(pid) for pid in above):
                parts.append("the members above their goal hold no movable duties (manual, superadmin, unledgered extra or confirmed)")
            counts = {code: len(items) for code, items in ((refusals or {}).get(level) or {}).items()}
            if counts:
                top = ", ".join(
                    f"{REFUSAL_LABELS.get(code, code).lower()} ({n})"
                    for code, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:4]
                )
                parts.append(f"the remaining moves would break a hard rule: {top}")
            reason = (
                "Not balanced: " + "; ".join(parts) + "."
                if parts else "Not balanced: no further move improves the totals without breaking a hard rule."
            )
        rows.append({
            "call_level": level,
            "label": call_level_label(level),
            "members": len(pids),
            "slots": round(state.level_slots.get(level, 0.0), 2),
            "goal_range": [min(goals), max(goals)] if goals else [0, 0],
            "allowed_gap": state.gap,
            "before": state.spread(level, before),
            "after": state.spread(level),
            "ok_before": ok_before,
            "ok_after": ok_after,
            "reason_if_not": reason,
        })
    return rows


def _member_rows(state: _State, before: dict, moves: list[dict] | None = None) -> list[dict[str, Any]]:
    extra_delta: Counter = Counter()
    for move in moves or []:
        if move.get("extra_duty"):
            extra_delta[UUID(move["from_person_id"])] -= 1
            extra_delta[UUID(move["to_person_id"])] += 1
    rows = []
    for level in state.levels():
        for pid in state.members_by_level.get(level, []):
            rows.append({
                "person_id": str(pid),
                "name": state.name(pid),
                "call_level": level,
                "unit": state.unit_name(state.unit_of.get(pid)),
                "before": before.get(pid, 0),
                "after": state.duties.get(pid, 0),
                "goal": state.goal.get(pid, 0),
                "share": round(state.share.get(pid, 0.0), 2),
                "avail_days": state.avail.get(pid, 0),
                # Active justice-ledger records of the month, before and after the plan.
                "extra_before": state.extra_count.get(pid, 0),
                "extra_after": state.extra_count.get(pid, 0) + extra_delta.get(pid, 0),
            })
    return rows


def _load(db: Session, month: str, rules: RotaPhaseOneRules | None = None) -> _State:
    period, scope = _draft(db, month)
    if rules is None:
        _version, rules = get_phase_one_rules(db)
    return _State(db, month, period, scope, rules)


def plan_balance(db: Session, month: str, *, max_work: int | None = None) -> dict[str, Any]:
    """The deterministic plan (contract section 2). Writes nothing."""
    return _plan(db, month, max_work=max_work)[0]


def _plan(db: Session, month: str, *, max_work: int | None = None) -> tuple[dict[str, Any], _State]:
    """``(plan, final plan state)``; apply uses the state for the ledger transfers."""
    from app.services.rota_compute import context_hash
    from app.services.rota_rules_admin import rules_revision

    started = time.monotonic()
    state = _load(db, month)
    if not any(row["movable"] for row in state.rows.values()):
        raise BalanceError("nothing_to_balance", "There are no automatically assigned duties to move.")
    before = dict(state.duties)
    if all(state.level_ok(level) for level in state.levels()):
        raise BalanceError("nothing_to_balance", "Duties are already balanced within every call level.")
    has_movable = defaultdict(bool)
    for row in state.rows.values():
        if row["movable"]:
            has_movable[row["person"]] = True
    budget = max(MAX_WORK, WORK_PER_SLOT * len(state.slots)) if max_work is None else max_work
    planner = _Planner(state, budget)
    planner.run()
    moves = planner.moves
    for move in moves:
        if move["extra_duty"]:
            move["new_overridden_rules"] = state.holder_codes(UUID(move["assignment_id"]))
    levels = _level_rows(state, before, planner.refusals, has_movable, planner.exhausted)
    summary = {
        "mode": BALANCE_MODE,
        "moves": sum(1 for m in moves if m["kind"] == "move"),
        "swaps": planner.swaps,
        "cross_unit": sum(1 for m in moves if m["cross_unit"]),
        "extra_moves": sum(1 for m in moves if m["extra_duty"]),
        "levels_balanced_before": sum(1 for row in levels if row["ok_before"]),
        "levels_balanced_after": sum(1 for row in levels if row["ok_after"]),
        "levels": len(levels),
        "elapsed_ms": int((time.monotonic() - started) * 1000),  # informational; not in plan_hash
        "work": planner.work,
        "work_budget": budget,
        "work_exhausted": planner.exhausted,
        "swap_capped": planner.swap_capped,
    }
    identity = [
        {k: m[k] for k in ("kind", "slot_id", "assignment_id", "from_person_id", "to_person_id", "to_unit_id",
                           "extra_duty", "record_id", "new_overridden_rules")}
        for m in moves
    ]
    plan_hash = hashlib.sha256(_canonical({"mode": BALANCE_MODE, "moves": identity}).encode()).hexdigest()
    return {
        "month": month,
        "plan_hash": plan_hash,
        "context_hash": context_hash(db),
        "rules_revision": rules_revision(state.rules),
        "summary": summary,
        "levels": levels,
        "moves": moves,
        "members": _member_rows(state, before, moves),
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }, state


# --------------------------------------------------------------------------------------------
# Shares and status (for publish, the report and the UI status line)
# --------------------------------------------------------------------------------------------


def shares(db: Session, month: str, rules: RotaPhaseOneRules | None = None) -> list[dict[str, Any]]:
    """Per call level of the month's saved state: ``{call_level, label, members, slots,
    goal_range, allowed_gap, min, max, gap, ok, movable, members_detail: [{person_id, name,
    unit, avail_days, share, goal, duties}]}``. ``[]`` when the month has no template.
    Read-only; works for any period status."""
    period, scope = ed._period_and_scope(db, month)
    if period is None:
        return []
    if rules is None:
        _version, rules = get_phase_one_rules(db)
    state = _State(db, month, period, scope, rules)
    movable_by_person: Counter = Counter(
        row["person"] for row in state.rows.values() if row["movable"]
    )
    out = []
    for level in state.levels():
        pids = state.members_by_level.get(level, [])
        goals = [state.goal.get(pid, 0) for pid in pids]
        out.append({
            "call_level": level,
            "label": call_level_label(level),
            "members": len(pids),
            "slots": round(state.level_slots.get(level, 0.0), 2),
            "goal_range": [min(goals), max(goals)] if goals else [0, 0],
            "allowed_gap": state.gap,
            **state.spread(level),
            "ok": state.level_ok(level),
            "movable": sum(movable_by_person[pid] for pid in pids),
            "members_detail": [
                {
                    "person_id": str(pid),
                    "name": state.name(pid),
                    "unit": state.unit_name(state.unit_of.get(pid)),
                    "avail_days": state.avail.get(pid, 0),
                    "share": round(state.share.get(pid, 0.0), 2),
                    "goal": state.goal.get(pid, 0),
                    "duties": state.duties.get(pid, 0),
                }
                for pid in pids
            ],
        })
    return out


def movable_count(db: Session, month: str) -> int:
    """Active automatic-source assignments on the month's non-excluded template slots."""
    period, _scope = ed._period_and_scope(db, month)
    if period is None:
        return 0
    from app.services.rota_template import template_slots_for_period

    pairs = [(slot, a) for slot in template_slots_for_period(db, period.id) for a in slot.assignments]
    records = _single_records(db, (a for _slot, a in pairs if _active(a)))
    return sum(1 for slot, a in pairs if _movable(a, slot, a.id in records))


def _batch_row(batch: ExtraDutyBatch) -> dict[str, Any]:
    return {
        "id": str(batch.id),
        "status": batch.status,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
        "created_by_name": batch.created_by_name,
        "undone_at": batch.undone_at.isoformat() if batch.undone_at else None,
        "undone_by_name": batch.undone_by_name,
        "summary": batch.summary or {},
    }


def balance_batches(db: Session, month: str) -> list[ExtraDutyBatch]:
    rows = db.scalars(
        select(ExtraDutyBatch).where(ExtraDutyBatch.month == month).order_by(ExtraDutyBatch.created_at.desc())
    )
    return [b for b in rows if (b.summary or {}).get("mode") == BALANCE_MODE]


def status(db: Session, month: str) -> dict[str, Any]:
    """``{month, enabled, balanced, levels: [shares rows without members_detail], batches}``."""
    month_bounds(month)
    levels = [{k: v for k, v in row.items() if k != "members_detail"} for row in shares(db, month)]
    return {
        "month": month,
        "enabled": enabled(),
        "balanced": all(row["ok"] for row in levels),
        "levels": levels,
        "batches": [_batch_row(b) for b in balance_batches(db, month)],
    }


# --------------------------------------------------------------------------------------------
# Preview / apply / undo
# --------------------------------------------------------------------------------------------


def _refuse_active_proposal(db: Session, month: str, user) -> None:
    try:
        ed._refuse_active_proposal(db, month, user)
    except ed.ExtraDutyError as exc:
        raise BalanceError(
            exc.code,
            "A rota proposal is open for this month. Resume or cancel it before balancing duties.",
            exc.status_code,
            exc.extra,
        ) from exc


def preview(db: Session, month: str, user) -> dict[str, Any]:
    _ensure_enabled()
    month_bounds(month)
    _refuse_active_proposal(db, month, user)
    plan = plan_balance(db, month)
    plan["token"] = ed.make_token(plan["plan_hash"], plan["context_hash"], month, user, BALANCE_MODE)
    return plan


def apply(db: Session, month: str, token: str, plan_hash: str, user) -> dict[str, Any]:
    _ensure_enabled()
    month_bounds(month)
    if not plan_hash or not ed._token_valid(token, plan_hash, month, user, BALANCE_MODE):
        raise BalanceError("bad_token", "This preview token does not match. Preview again.", 403)

    from app.services.extra_duty_verify import check_month
    from app.services.rota_compute import lock_operational_inputs

    lock_namespace(db, f"balance:{month}")
    lock_namespace(db, f"extra-duty:{month}")
    lock_namespace(db, f"rota-compute:{month}")
    lock_operational_inputs(db)
    existing = next(
        (b for b in balance_batches(db, month) if b.plan_hash == plan_hash and b.status == "applied"),
        None,
    )
    if existing is not None:
        summary = dict(existing.summary or {})
        return {
            "month": month,
            "plan_hash": existing.plan_hash,
            "context_hash": existing.context_hash,
            "summary": {k: v for k, v in summary.items() if k != "levels_detail"},
            "levels": summary.get("levels_detail", []),
            "moves": existing.decisions or [],
            "members": [],
            "batch_id": str(existing.id),
            "already_applied": True,
        }
    _refuse_active_proposal(db, month, user)
    try:
        plan, state = _plan(db, month)
    except BalanceError as exc:
        if exc.code == "nothing_to_balance":
            raise BalanceError("stale_preview", "The month changed since the preview. Preview again.", 409) from exc
        raise
    if plan["plan_hash"] != plan_hash:
        raise BalanceError("stale_preview", "The month changed since the preview. Preview again.", 409,
                           {"plan_hash": plan["plan_hash"]})
    if not plan["moves"]:
        raise BalanceError("nothing_to_balance", "No move can balance the duties without breaking a hard rule.")

    period, _scope = _draft(db, month)
    stale = BalanceError("stale_preview", "The month changed since the preview. Preview again.", 409)
    try:
        persons = {
            p.id: p for p in db.scalars(select(Person).where(Person.id.in_(
                {UUID(m["to_person_id"]) for m in plan["moves"]} | {UUID(m["from_person_id"]) for m in plan["moves"]}
            )))
        }
        result = {k: plan[k] for k in ("month", "plan_hash", "context_hash", "summary", "levels", "moves", "members")}
        batch = ExtraDutyBatch(
            rota_period_id=period.id,
            month=month,
            status="applied",
            plan_hash=plan["plan_hash"],
            context_hash=plan["context_hash"],
            rules_revision=plan.get("rules_revision"),
            summary={**plan["summary"], "levels_detail": plan["levels"]},
            decisions=plan["moves"],
            before_image=[],
            created_by_id=getattr(user, "id", None),
            created_by_name=_user_name(user),
        )
        db.add(batch)
        db.flush()
        # Justice snapshots of the extra-duty recipients: the saved ledger before the month,
        # plus their active records this month, plus what this batch already passed to them.
        lookback = ed.lookback_months(state.rules)
        recipients = [UUID(m["to_person_id"]) for m in plan["moves"] if m["extra_duty"]]
        ledger = ed.ledger_balance(db, recipients, state.starts_on, lookback) if recipients else {}
        received: Counter = Counter()
        transfer_at = datetime.utcnow().isoformat() + "Z"
        # Final effect per assignment row (a row moves at most once per plan).
        before_image: list[dict[str, Any]] = []
        touched: list[UUID] = []
        for move in plan["moves"]:
            assignment = db.get(DutyAssignment, UUID(move["assignment_id"]))
            slot = db.get(DutySlot, UUID(move["slot_id"]))
            record = db.get(ExtraDutyRecord, UUID(move["record_id"])) if move["extra_duty"] else None
            if (
                assignment is None or slot is None or not _active(assignment)
                or str(assignment.person_id) != move["from_person_id"]
                or not _movable(assignment, slot, record is not None)
                or (not move["extra_duty"] and assignment.source == EXTRA_SOURCE)
            ):
                raise stale
            if move["extra_duty"] and (
                record is None or record.status != "active" or record.assignment_id != assignment.id
                or str(record.person_id) != move["from_person_id"]
            ):
                raise stale
            item = {
                "slot_id": move["slot_id"],
                "assignment_id": move["assignment_id"],
                "kind": move["kind"],
                "person_id_before": move["from_person_id"],
                "person_id_after": move["to_person_id"],
                "unit_id_before": str(slot.unit_id) if slot.unit_id else None,
                "unit_id_after": move["to_unit_id"],
                "source_before": assignment.source,
                "status_before": assignment.status,
                "override_reason_before": assignment.override_reason,
            }
            to_person = persons[UUID(move["to_person_id"])]
            assignment.person_id = to_person.id
            assignment.person = to_person
            if move["to_unit_id"] and str(slot.unit_id) != move["to_unit_id"]:
                unit = db.get(Unit, UUID(move["to_unit_id"]))
                slot.unit_id = unit.id
                slot.unit = unit
            if record is not None:
                # Ledger transfer (balance_extra_duties contract section 1): the record follows
                # the duty; the old snapshot is kept in justice["transfers"].
                codes = list(move["new_overridden_rules"]) or [REBALANCED_CODE]
                item["record"] = _record_state(record)
                old_justice = dict(record.justice or {})
                transfers = list(old_justice.pop("transfers", None) or [])
                transfers.append({
                    "from_person_id": move["from_person_id"],
                    "from_person_name": move["from_person"],
                    "to_person_id": move["to_person_id"],
                    "to_person_name": move["to_person"],
                    "balance_batch_id": str(batch.id),
                    "at": transfer_at,
                    "old_overridden_rules": list(record.overridden_rules or []),
                    "old_assigned_unit_id": str(record.assigned_unit_id) if record.assigned_unit_id else None,
                    "old_justice": old_justice,
                })
                snapshot = state.justice_snapshot(
                    assignment.id, ledger, lookback,
                    state.extra_count.get(to_person.id, 0) + received[to_person.id],
                )
                received[to_person.id] += 1
                record.person_id = to_person.id
                record.assigned_unit_id = slot.unit_id
                record.fallback_used = slot.unit_id != record.home_unit_id
                record.overridden_rules = codes
                record.justice = {**snapshot, "transfers": transfers}
                assignment.override_reason = (
                    f"Extra-duty layer: {', '.join(codes)} · balanced from {move['from_person']}"
                )
                item["record_after"] = _record_state(record)
            else:
                assignment.source = BALANCE_SOURCE
                assignment.override_reason = f"Balanced: from {move['from_person']} to {move['to_person']}"
            item["source_after"] = assignment.source
            item["override_reason_after"] = assignment.override_reason
            before_image.append(item)
            touched.append(assignment.id)
        batch.before_image = before_image
        db.flush()
        check = check_month(db, month, assignment_ids=touched)
        if not check["ok"]:
            db.rollback()
            raise BalanceError(
                "verification_failed",
                "A post-write check found a strict-rule problem; nothing was saved.",
                500,
                {"violations": check["violations"]},
            )
        db.commit()
    except BalanceError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    return {**result, "batch_id": str(batch.id), "already_applied": False}


def undo(db: Session, batch_id: UUID, user, dry_run: bool = False) -> dict[str, Any]:
    """Exact restore of a balance batch: person, source, override reason and slot unit."""
    batch = db.get(ExtraDutyBatch, UUID(str(batch_id)))
    if batch is None or (batch.summary or {}).get("mode") != BALANCE_MODE:
        raise BalanceError("not_found", "Balance batch not found.", 404)
    lock_namespace(db, f"balance:{batch.month}")
    lock_namespace(db, f"extra-duty:{batch.month}")
    db.refresh(batch)
    if batch.status == "undone":
        return {"batch_id": str(batch.id), "restored": 0, "conflicts": [], "dry_run": dry_run,
                "already_undone": True}
    period = db.get(RotaPeriod, batch.rota_period_id)
    if period is None or period.status.lower() != "draft":
        raise BalanceError("not_draft", "Undo is only possible while the month is a draft.")
    _version, rules = get_phase_one_rules(db)
    items = list(batch.before_image or [])
    names = {
        p.id: p.canonical_name
        for p in db.scalars(select(Person).where(Person.id.in_(
            {UUID(i["person_id_before"]) for i in items} | {UUID(i["person_id_after"]) for i in items}
        )))
    } if items else {}
    conflicts: list[dict[str, Any]] = []
    plan: list[tuple[dict, DutySlot, DutyAssignment, ExtraDutyRecord | None]] = []
    # Rows a later, still-applied balance batch moved again (undo that batch first).
    later = {
        other_item["assignment_id"]
        for other in balance_batches(db, batch.month)
        if other.id != batch.id and other.status == "applied"
        and other.created_at is not None and batch.created_at is not None and other.created_at > batch.created_at
        for other_item in other.before_image or []
    }
    for item in items:
        slot = db.get(DutySlot, UUID(item["slot_id"]))
        assignment = db.get(DutyAssignment, UUID(item["assignment_id"]))

        def conflict(code: str, message: str) -> None:
            conflicts.append({
                "slot_id": item["slot_id"],
                "duty_date": slot.duty_date.isoformat() if slot is not None else None,
                "duty_type": slot.duty_type if slot is not None else None,
                "duty_label": ed._duty_label(rules, slot.duty_type) if slot is not None else None,
                "person_name": names.get(UUID(item["person_id_after"])),
                "code": code,
                "reason": message,
                "message": message,
            })

        if slot is None:
            conflict("slot_missing", "The duty slot no longer exists.")
            continue
        label = f"{slot.duty_date.isoformat()} {slot.duty_type}"
        if assignment is None or not _active(assignment):
            conflict("assignment_removed", f"{label}: the balanced assignment was cleared or cancelled.")
            continue
        if (
            str(assignment.person_id) != item["person_id_after"]
            or assignment.duty_slot_id != slot.id
            or assignment.source != item.get("source_after", BALANCE_SOURCE)
        ):
            if item["assignment_id"] in later:
                conflict("assignment_changed",
                         f"{label}: a later Balance duties run moved this duty again. Undo that run first.")
            else:
                conflict("assignment_changed", f"{label}: the balanced assignment was changed.")
            continue
        if item.get("unit_id_after") and str(slot.unit_id) != item["unit_id_after"]:
            conflict("unit_changed", f"{label}: the slot was moved to another unit since.")
            continue
        record = None
        if item.get("record"):
            # The ledger record must be exactly as this batch left it.
            record = db.get(ExtraDutyRecord, UUID(item["record"]["record_id"]))
            if record is None:
                conflict("record_missing", f"{label}: the extra duty's ledger record no longer exists.")
                continue
            if record.status != "active":
                conflict("record_voided", f"{label}: the extra duty's ledger record was voided since.")
                continue
            if _canonical(_record_state(record)) != _canonical(item.get("record_after")):
                conflict("record_changed",
                         f"{label}: the extra duty's ledger record was transferred again or changed since.")
                continue
        if any(
            str(a.person_id) == item["person_id_before"] and a.id != assignment.id for a in slot.assignments
        ):
            conflict("slot_has_new_assignments",
                     f"{label}: {names.get(UUID(item['person_id_before']))} has another row on this duty now.")
            continue
        plan.append((item, slot, assignment, record))
    if dry_run:
        return {"batch_id": str(batch.id), "restored": 0 if conflicts else len(plan),
                "would_restore": len(plan), "conflicts": conflicts, "dry_run": True}
    if conflicts:
        raise BalanceError("undo_conflict", "Some balanced duties changed after they were applied; undo would not be exact.",
                           409, {"conflicts": conflicts})
    from app.services.extra_duty_verify import check_month

    try:
        restored_ids = []
        for item, slot, assignment, record in plan:
            person = db.get(Person, UUID(item["person_id_before"]))
            assignment.person_id = person.id
            assignment.person = person
            assignment.source = item.get("source_before") or "safe_auto_fill_draft"
            assignment.status = item.get("status_before") or assignment.status
            assignment.override_reason = item.get("override_reason_before")
            before = item.get("unit_id_before")
            slot.unit_id = UUID(before) if before else None
            slot.unit = db.get(Unit, slot.unit_id) if slot.unit_id else None
            if record is not None:
                # Exact restore of the ledger record (its transfer entry goes with the justice).
                old = item["record"]
                record.person_id = UUID(old["person_id"])
                record.assigned_unit_id = UUID(old["assigned_unit_id"]) if old["assigned_unit_id"] else None
                record.fallback_used = bool(old["fallback_used"])
                record.overridden_rules = list(old["overridden_rules"])
                record.justice = dict(old["justice"])
            restored_ids.append(assignment.id)
        db.flush()
        check = check_month(db, batch.month, assignment_ids=restored_ids)
        if not check["ok"]:
            db.rollback()
            raise BalanceError(
                "undo_conflict",
                "Undo would break a hard rule because the month changed since; nothing was restored.",
                409,
                {"conflicts": [
                    {"slot_id": v["slot_id"], "duty_date": v.get("duty_date"), "duty_type": v.get("duty_type"),
                     "person_name": v.get("person_name"), "code": v["code"], "reason": v["message"],
                     "message": v["message"]}
                    for v in check["violations"]
                ]},
            )
        batch.status = "undone"
        batch.undone_at = datetime.utcnow()
        batch.undone_by_name = _user_name(user)
        db.commit()
    except BalanceError:
        raise
    except Exception:
        db.rollback()
        raise
    return {"batch_id": str(batch.id), "restored": len(plan), "conflicts": [], "dry_run": False}
