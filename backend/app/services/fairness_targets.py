"""Equal duties within a call level (docs/limits_callevel_fairness_contract.md section 2).

``call_level_targets`` says how many duties each member of a call level should do in a month:
the level's duty slots divided by its members. ``call_level_spread`` compares that target with
what the month actually holds (all campuses together) and explains any gap above the allowed
gap (``fairness_rules.max_gap_within_call_level``).

Who counts as a member of a level for the month (documented choice, contract 2):

* every *active* member with a posting overlapping the month (any unit, any campus), at the
  call level they hold on the first posted day of the month, who has at least one posted day
  not covered by leave; plus
* every active member who holds an active duty of that level in the month without any posting
  (the extra-duty "unposted" tier), so the people actually used are always counted.

Members on leave or posted for the whole month are left out of the target (they cannot do a
duty), but members with partial availability are kept: their reduced availability is the
explanation the spread gives when they end up below the others.

A *slot* of a level is a non-excluded template slot of the month whose required level set
(``rota_eligibility.required_call_levels``) is exactly that level. Duties with no level at all
(unresolved) are not counted.

Pool slots (docs/call_level_pool_and_balance_contract.md section 1): a duty whose Rota Rules list
several levels may be taken by any member of those levels. Its demand is split across the pool's
levels in proportion to each level's member count for the month (``split_pool_demand``): with 30
3rd-call and 10 4th-call members, each pool slot adds 0.75 to 3rd call and 0.25 to 4th call. If
none of the pool's levels has members the slot is split evenly. Targets stay per level, so a
level's ``slots`` may be fractional (reported to 2 decimals). An unposted member holding a pool
duty is counted at their own level when it is in the pool.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import RotaPeriod
from app.services.leave import month_bounds
from app.services.rota_call_levels import normalize_call_level
from app.services.rota_eligibility import (
    CALL_LEVEL_ORDER,
    call_level_label,
    member_call_level,
    required_call_levels,
)
from app.services.rota_safety import (
    ACTIVE_ASSIGNMENT_STATUSES,
    MemberContext,
    assignments_for_month,
    leaves_by_day_and_person,
    postings_for_month,
    rule_for_slot,
    rules_groups,
)

# Duties placed by these sources are "extra" for the spread (reported separately).
EXTRA_SOURCES = {"extra_duty_layer", "superadmin_allocation"}
DEFAULT_ALLOWED_GAP = 1


def allowed_gap(rules: Any) -> int:
    fairness = getattr(rules, "fairness_rules", None)
    value = getattr(fairness, "max_gap_within_call_level", DEFAULT_ALLOWED_GAP)
    return DEFAULT_ALLOWED_GAP if value is None else int(value)


def _level_order(level: str) -> tuple:
    return (CALL_LEVEL_ORDER.index(level) if level in CALL_LEVEL_ORDER else 99, level)


def split_pool_demand(levels, member_counts) -> dict[str, float]:
    """One pool slot's demand per level: proportional to ``member_counts[level]`` (members of the
    level available in the month); an even split when none of the levels has members. A single
    level gets the whole slot."""
    levels = sorted(set(levels), key=_level_order)
    if not levels:
        return {}
    if len(levels) == 1:
        return {levels[0]: 1.0}
    counts = {level: max(0, int(member_counts.get(level, 0) or 0)) for level in levels}
    total = sum(counts.values())
    if total == 0:
        return {level: 1.0 / len(levels) for level in levels}
    return {level: counts[level] / total for level in levels if counts[level]}


def _num(value: float) -> float | int:
    return int(round(value)) if abs(value - round(value)) < 1e-9 else round(value, 2)


def _days(first: date, last: date):
    day = first
    while day <= last:
        yield day
        day += timedelta(days=1)


def _period(db: Session, starts_on: date, ends_on: date) -> RotaPeriod | None:
    """The month's period without creating one (reads must not write)."""
    return db.scalar(
        select(RotaPeriod)
        .where(RotaPeriod.starts_on == starts_on, RotaPeriod.ends_on == ends_on)
        .order_by(RotaPeriod.created_at)
    )


def _included_units(db: Session, period) -> set[UUID] | None:
    """Unit ids included in the period's generation scope; ``None`` when there is no scope."""
    from app.models import MonthlyGenerationScope

    if period is None:
        return None
    scope = db.scalar(
        select(MonthlyGenerationScope).where(MonthlyGenerationScope.rota_period_id == period.id)
    )
    if scope is None or not scope.units:
        return None
    return {item.unit_id for item in scope.units if item.status == "included"}


class _Month:
    """Everything the targets and the spread need, loaded once."""

    def __init__(self, db: Session, month: str, rules: Any = None, postings=None, leaves=None):
        from app.services.rota_rules import get_phase_one_rules
        from app.services.rota_template import template_slots_for_period

        if rules is None:
            _version, rules = get_phase_one_rules(db)
        self.rules = rules
        self.month = month
        self.starts_on, self.ends_on = month_bounds(month)
        self.month_days = (self.ends_on - self.starts_on).days + 1
        period = _period(db, self.starts_on, self.ends_on)
        slots = template_slots_for_period(db, period.id) if period is not None else []
        groups = None
        # Single-level slots by id; ``slot_levels`` holds every counted slot's level set
        # (pools included). ``slots_by_level`` may become fractional once pools are split.
        self.slot_level: dict[UUID, str] = {}
        self.slot_levels: dict[UUID, set[str]] = {}
        self.slots_by_level: dict[str, float] = defaultdict(int)
        pool_slots: list[set[str]] = []
        # Open (unassigned) slots per (level, unit): they explain members left below target.
        # An open pool slot counts for each of its levels.
        self.open_slots: dict[tuple[str, UUID | None], int] = defaultdict(int)
        for slot in slots:
            if slot.template_status == "excluded":
                continue
            if groups is None:
                groups = rules_groups(rules, slot)
            levels = required_call_levels(slot, rule_for_slot(slot, rules), groups)
            if not levels:
                continue
            self.slot_levels[slot.id] = levels
            if len(levels) == 1:
                level = next(iter(levels))
                self.slot_level[slot.id] = level
                self.slots_by_level[level] += 1
            else:
                pool_slots.append(levels)
            if not any(
                str(a.status).lower() in ACTIVE_ASSIGNMENT_STATUSES for a in slot.assignments
            ):
                for level in levels:
                    self.open_slots[(level, slot.unit_id)] += 1

        if leaves is None:
            leaves = leaves_by_day_and_person(db, month)
        self.leave_days: dict[UUID, int] = defaultdict(int)
        leave_sets: dict[UUID, set[date]] = defaultdict(set)
        for day, people in leaves.items():
            for pid in people:
                leave_sets[pid].add(day)

        posted_days: dict[UUID, set[date]] = defaultdict(set)
        first_posting: dict[UUID, Any] = {}
        self.persons: dict[UUID, Any] = {}
        if postings is None:
            postings = postings_for_month(db, self.starts_on, self.ends_on)
        # Only postings to units in this month's scope count: a member posted only to an excluded
        # unit cannot take any of this month's duties (same rule as balance_duties shares).
        included = _included_units(db, period)
        for posting in postings:
            person = posting.person
            if posting.unit_id is None or person is None or person.active_status != "active":
                continue
            if included is not None and posting.unit_id not in included:
                continue
            first = max(posting.starts_on, self.starts_on)
            last = min(posting.ends_on or self.ends_on, self.ends_on)
            if first > last:
                continue
            posted_days[person.id].update(_days(first, last))
            self.persons[person.id] = person
            current = first_posting.get(person.id)
            if current is None or first < max(current.starts_on, self.starts_on):
                first_posting[person.id] = posting

        self.level_of: dict[UUID, str] = {}
        self.available_days: dict[UUID, int] = {}
        self.posted_days: dict[UUID, int] = {}
        self.unit_of: dict[UUID, UUID | None] = {}
        for pid, days in posted_days.items():
            posting = first_posting[pid]
            self.unit_of[pid] = posting.unit_id
            day = max(posting.starts_on, self.starts_on)
            self.level_of[pid] = member_call_level(
                MemberContext(
                    person=posting.person,
                    unit_id=posting.unit_id,
                    posting_type=posting.posting_type,
                    day=day,
                )
            )
            self.posted_days[pid] = len(days)
            self.leave_days[pid] = len(days & leave_sets.get(pid, set()))
            self.available_days[pid] = len(days - leave_sets.get(pid, set()))

        self.duties: dict[UUID, int] = defaultdict(int)
        self.extra: dict[UUID, int] = defaultdict(int)
        seen: set[UUID] = set()
        for assignment in assignments_for_month(db, self.starts_on, self.ends_on):
            if assignment.id in seen or str(assignment.status).lower() not in ACTIVE_ASSIGNMENT_STATUSES:
                continue
            seen.add(assignment.id)
            pid = assignment.person_id
            self.duties[pid] += 1
            if assignment.source in EXTRA_SOURCES:
                self.extra[pid] += 1
            person = assignment.person
            if pid not in self.level_of and person is not None and person.active_status == "active":
                # Unposted tier: counted at the level of the duty they hold (for a pool duty,
                # their own level when it is in the pool).
                level = self.slot_level.get(assignment.duty_slot_id)
                pool = self.slot_levels.get(assignment.duty_slot_id) or set()
                if level is None and len(pool) > 1:
                    own = normalize_call_level(person.call_level)
                    level = own if own in pool else None
                if level is not None:
                    self.level_of[pid] = level
                    self.persons[pid] = person
                    self.posted_days[pid] = 0
                    self.leave_days[pid] = len(leave_sets.get(pid, set()))
                    self.available_days[pid] = self.month_days - self.leave_days[pid]

        self.members_by_level: dict[str, list[UUID]] = defaultdict(list)
        for pid, level in self.level_of.items():
            if self.available_days.get(pid, 0) > 0 or self.duties.get(pid, 0) > 0:
                self.members_by_level[level].append(pid)

        # Pool demand, split by each pool level's member count (see the module docstring).
        counts = {level: len(pids) for level, pids in self.members_by_level.items()}
        self.pool_slots_by_level: dict[str, float] = defaultdict(float)
        for levels in pool_slots:
            for level, share in split_pool_demand(levels, counts).items():
                self.slots_by_level[level] += share
                self.pool_slots_by_level[level] += share

    def levels(self) -> list[str]:
        return sorted(set(self.slots_by_level), key=_level_order)

    def target(self, level: str) -> dict[str, Any]:
        slots = self.slots_by_level.get(level, 0)
        members = len(self.members_by_level.get(level, []))
        target = round(slots / members, 2) if members else None
        exact = round(slots / members, 9) if members else None
        return {
            "call_level": level,
            "label": call_level_label(level),
            "slots": _num(slots),
            "pool_slots": _num(self.pool_slots_by_level.get(level, 0.0)),
            "members": members,
            "target": target,
            "min_expected": math.floor(exact) if members else None,
            "max_expected": math.ceil(exact) if members else None,
        }


def call_level_targets(db: Session, month: str, rules: Any = None) -> list[dict[str, Any]]:
    """Per call level: ``{call_level, label, slots, pool_slots, members, target, min_expected,
    max_expected}`` (``target`` = slots / members to 2 decimals; ``None`` when the level has no
    members). ``slots`` includes the level's share of pool slots (``pool_slots``)."""
    data = _Month(db, month, rules)
    return [data.target(level) for level in data.levels()]


def target_by_level(
    db: Session, month: str, rules: Any = None, *, postings=None, leaves=None
) -> dict[str, float]:
    """``{call_level: exact slots/members}`` for ranking (levels without members are absent).
    ``postings`` / ``leaves`` may be passed preloaded (``postings_for_month`` /
    ``leaves_by_day_and_person`` shapes) to avoid reloading them."""
    data = _Month(db, month, rules, postings=postings, leaves=leaves)
    return {
        level: data.slots_by_level[level] / len(data.members_by_level[level])
        for level in data.levels()
        if data.members_by_level.get(level)
    }


def call_level_spread(db: Session, month: str, rules: Any = None) -> list[dict[str, Any]]:
    """Per call level: target, the min/max duty totals (all campuses), the gap, the allowed gap
    and whether it holds, every member's totals, and plain reasons when it does not."""
    data = _Month(db, month, rules)
    allowed = allowed_gap(data.rules)
    rows: list[dict[str, Any]] = []
    for level in data.levels():
        target = data.target(level)
        exact = (
            data.slots_by_level[level] / target["members"] if target["members"] else 0.0
        )
        members = []
        for pid in data.members_by_level.get(level, []):
            person = data.persons.get(pid)
            duties = data.duties.get(pid, 0)
            members.append({
                "person_id": str(pid),
                "name": person.canonical_name if person else str(pid),
                "duties": duties,
                "extra_duties": data.extra.get(pid, 0),
                "diff_from_target": round(duties - exact, 2),
                "available_days": data.available_days.get(pid, 0),
                "leave_days": data.leave_days.get(pid, 0),
                "posted_days": data.posted_days.get(pid, 0),
                "unit_id": str(data.unit_of[pid]) if data.unit_of.get(pid) else None,
                "unit_open_slots": data.open_slots.get((level, data.unit_of.get(pid)), 0),
            })
        members.sort(key=lambda m: (m["duties"], m["name"], m["person_id"]))
        totals = [m["duties"] for m in members]
        low = min(totals) if totals else 0
        high = max(totals) if totals else 0
        gap = high - low
        ok = gap <= allowed
        reasons: list[dict[str, Any]] = []
        explained = ok
        if not ok:
            normal = [m["duties"] - m["extra_duties"] for m in members]
            normal_gap = max(normal) - min(normal)
            extra_total = sum(m["extra_duties"] for m in members)
            if extra_total and normal_gap <= allowed:
                reasons.append({
                    "code": "extra_duties",
                    "message": (
                        f"{extra_total} duties placed by the extra-duty layer or a superadmin make "
                        f"the totals uneven (without them the gap is {normal_gap})."
                    ),
                })
                explained = True
            else:
                # Members below the level's highest total minus the allowed gap.
                short = [m for m in members if m["duties"] < high - allowed]
                limited = [m for m in short if m["available_days"] < data.month_days]
                for m in limited:
                    parts = []
                    if m["leave_days"]:
                        parts.append(f"on leave {m['leave_days']} day(s)")
                    if m["posted_days"] and m["posted_days"] < data.month_days:
                        parts.append(f"posted {m['posted_days']} of {data.month_days} days")
                    reasons.append({
                        "code": "limited_availability",
                        "person_id": m["person_id"],
                        "message": f"{m['name']} has {m['duties']} duties: "
                        + (", ".join(parts) or "available fewer days")
                        + ".",
                    })
                unfilled = [
                    m for m in short if m not in limited and m["unit_open_slots"] > 0
                ]
                if unfilled:
                    open_total = sum(
                        count for (lvl, _unit), count in data.open_slots.items() if lvl == level
                    )
                    reasons.append({
                        "code": "open_slots",
                        "message": (
                            f"{open_total} duties of this level are still open (for example a unit "
                            f"hard blocked by staffing), so {len(unfilled)} member(s) in those units "
                            "are below the others; the extra-duty layer can fill them."
                        ),
                    })
                if short and len(limited) + len(unfilled) == len(short):
                    explained = True
                else:
                    reasons.append({
                        "code": "uneven",
                        "message": (
                            "Totals are uneven without a leave or extra-duty reason: rest after "
                            "24-hour duties, other blocks or manual changes. Re-run auto-fill or "
                            "review the members below the target."
                        ),
                    })
        rows.append({
            "call_level": level,
            "label": target["label"],
            "slots": target["slots"],
            "member_count": target["members"],
            "target": target["target"],
            "min": low,
            "max": high,
            "gap": gap,
            "allowed_gap": allowed,
            "ok": ok,
            "explained": explained,
            "reason": " ".join(r["message"] for r in reasons) or None,
            "reasons": reasons,
            "members": members,
        })
    return rows
