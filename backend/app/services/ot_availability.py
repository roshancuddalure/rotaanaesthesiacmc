"""Canonical dated posting/leave/duty/rest -> identity-level OT availability.

No duty assignment is written. Normal approved leave and explicit pending-leave
stress mode are distinct. Skills are supplied through a reviewed mapping; group
names or designation strings are never guessed to be qualifications.
"""

from collections import defaultdict
from datetime import datetime, time, timedelta
from functools import lru_cache

from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.models import DutyAssignment, DutySlot, LeaveRequest, RotaPeriod
from app.services.history_fairness import OFFICIAL_STATUSES
from app.services.leave import ACTIVE_LEAVE_STATUSES, BLOCKING_LEAVE_STATUSES, date_range
from app.services.leave_semantics import is_active, known_slot, leave_intervals, status_key, union_intervals
from app.services.leave_projection import indexed_projections
from app.services.ot_capacity import CapacityPerson, CapacityWindow, TimeInterval
from app.services.rota_eligibility import active_group_keys_on, member_call_level
from app.services.rota_safety import (
    ACTIVE_ASSIGNMENT_STATUSES, MemberContext, rule_for_slot,
    postings_for_month,
)
from app.services.rota_template import PHASE4_SLOT_SOURCE


def merge_intervals(intervals):
    """Union overlapping/adjacent blocks; duplicate causes never subtract twice."""
    return tuple(TimeInterval(starts_at=row.starts_at, ends_at=row.ends_at)
                 for row in union_intervals(intervals))


def leave_windows(leave, first, last):
    """Existing AM/PM/NIGHT anchors, expressed as actual daily OT intervals.

    NIGHT includes early morning and evening on each stored inclusive leave date.
    The duty validator's extra rule that any partial leave blocks a 24h duty remains
    separate; an elective OT band is checked by its own actual overlap.
    """
    return tuple(TimeInterval(starts_at=row.starts_at, ends_at=row.ends_at)
                 for row in leave_intervals(leave, first, last))


def duty_windows(slot, rules):
    """All elective-work blocks induced by a saved or proposed duty, without I/O."""
    # Values, never ORM/rules identities: speculative edits and changed rule flags
    # must take effect immediately. Cached values are immutable and contain no
    # person, authorization, availability or reservation-proof information.
    rule = rule_for_slot(slot, rules)
    return _duty_windows(slot.starts_at, slot.ends_at, slot.duty_date, slot.is_24hr,
        rules.rest_rules.minimum_gap_after_24hr_hours,
        bool(slot.is_24hr or (rule and rule.blocks_elective_same_day)),
        bool(slot.is_24hr or (rule and rule.blocks_elective_next_day)))


@lru_cache(maxsize=2048)
def _duty_windows(starts_at, ends_at, duty_date, is_24hr, gap_hours, same_day, next_day):
    spans = [TimeInterval(starts_at=starts_at, ends_at=ends_at)]
    if is_24hr and gap_hours > 0:
        spans.append(TimeInterval(starts_at=ends_at,
            ends_at=ends_at + timedelta(hours=gap_hours)))
    if same_day:
        spans.append(TimeInterval(starts_at=datetime.combine(duty_date, time.min),
            ends_at=datetime.combine(duty_date + timedelta(days=1), time.min)))
    if next_day:
        spans.append(TimeInterval(starts_at=datetime.combine(duty_date + timedelta(days=1), time.min),
            ends_at=datetime.combine(duty_date + timedelta(days=2), time.min)))
    return merge_intervals(spans)


def canonical_availability(db, requirements, rules, *, assignments=None, skills_by_person=None,
                           qualification_groups_by_unit=None, include_pending=False, horizon_days=35,
                           leave_projections=()):
    # Replace only explicitly identified records. A changed person/date can move
    # a request into or out of this context; unrelated canonical leave survives.
    proposed = indexed_projections(leave_projections)
    if type(horizon_days) is not int or not 1 <= horizon_days <= 45:
        raise ValueError("OT availability horizon must be between 1 and 45 days")
    if not requirements:
        return {"people": (), "facts": [], "warnings": [], "pending_stress": include_pending}
    beginning = min(row.starts_at for row in requirements)
    ending = max(row.ends_at for row in requirements)
    if ending - beginning > timedelta(days=horizon_days):
        raise ValueError(f"OT availability horizon cannot exceed {horizon_days} days")
    first, last = beginning.date(), (ending - timedelta(microseconds=1)).date()
    required_units = {row.unit_id for row in requirements}
    postings = [row for row in postings_for_month(db, first, last) if row.unit_id in required_units]
    identities = {row.person_id: row.person for row in postings if row.person.active_status == "active"}
    # The shared posting loader batches both workspace and legacy HOD timelines.
    windows = defaultdict(list)
    facts, warnings = [], []
    if skills_by_person is None:
        missing = {(str(row.unit_id), skill) for row in requirements if row.target > 0
                   for skill in row.required_skills
                   if skill not in (qualification_groups_by_unit or {}).get(row.unit_id, {})}
        if missing:
            warnings.append({"code": "ot_qualifications_unconfigured", "missing": sorted(missing)})
    for day in date_range(first, last):
        by_posting = defaultdict(list)
        for posting in postings:
            if posting.person_id in identities and posting.unit_id is not None \
                    and posting.starts_on <= day <= (posting.ends_on or last):
                by_posting[posting.person_id, posting.unit_id].append(posting)
        for (person_id, unit_id), rows in by_posting.items():
            levels = {member_call_level(MemberContext(row.person, unit_id, row.posting_type, day))
                      for row in rows}
            if len(levels) != 1 or not levels.issubset({"1ST_CALL", "2ND_CALL", "3RD_CALL", "4TH_CALL", "CO_4TH_CALL", "5TH_CALL"}):
                warnings.append({"code": "ot_call_context_unresolved", "person_id": str(person_id),
                                 "unit_id": str(unit_id), "day": str(day)})
                continue
            start, end = datetime.combine(day, time.min), datetime.combine(day + timedelta(days=1), time.min)
            bindings = (qualification_groups_by_unit or {}).get(unit_id, {})
            group_keys = active_group_keys_on(identities[person_id], day) if bindings else set()
            skills = ((skills_by_person or {}).get(person_id, ()) if skills_by_person is not None else
                      {skill for skill, keys in bindings.items() if group_keys.intersection(keys)})
            windows[person_id].append(CapacityWindow(
                starts_at=max(beginning, start), ends_at=min(ending, end), unit_id=unit_id,
                call_level=next(iter(levels)), skills=tuple(sorted(skills)),
            ))

    blocks = defaultdict(list)
    statuses = ACTIVE_LEAVE_STATUSES if include_pending else BLOCKING_LEAVE_STATUSES
    saved_leaves = db.scalars(select(LeaveRequest).where(LeaveRequest.person_id.in_(identities),
                                                  LeaveRequest.starts_on <= last,
                                                  LeaveRequest.ends_on >= first)) if identities else ()
    leaves = [row for row in saved_leaves if str(row.id) not in proposed]
    leaves.extend(row for row in proposed.values() if row.person_id in identities
                  and row.starts_on <= last and row.ends_on >= first)
    for leave in leaves:
        status = status_key(leave.status)
        if not is_active(leave.status):
            continue
        spans = leave_windows(leave, first, last)
        facts.append({"code": "approved_leave" if status in BLOCKING_LEAVE_STATUSES else "pending_leave",
                      "person_id": str(leave.person_id), "source_id": str(leave.id),
                      "blocking": status in statuses,
                      "intervals": [{"starts_at": span.starts_at.isoformat(), "ends_at": span.ends_at.isoformat()} for span in spans]})
        if not known_slot(leave.leave_slot):
            warnings.append({"code": "ot_unknown_leave_slot", "person_id": str(leave.person_id),
                             "source_id": str(leave.id)})
        if status in statuses:
            blocks[leave.person_id].extend(spans)
    if assignments is None:
        buffer = timedelta(hours=rules.rest_rules.minimum_gap_after_24hr_hours + 24)
        assignments = list(db.scalars(select(DutyAssignment).join(DutyAssignment.duty_slot)
            .outerjoin(DutySlot.rota_period).where(
                DutyAssignment.person_id.in_(identities), DutySlot.ends_at >= beginning - buffer,
                DutySlot.starts_at < ending,
                or_(DutySlot.source == PHASE4_SLOT_SOURCE, RotaPeriod.status.in_(OFFICIAL_STATUSES)),
            ).options(selectinload(DutyAssignment.duty_slot)))) if identities else []
    for assignment in assignments:
        if assignment.person_id not in identities or assignment.status.lower() not in ACTIVE_ASSIGNMENT_STATUSES:
            continue
        slot = assignment.duty_slot
        for span in duty_windows(slot, rules):
            if span.starts_at < ending and span.ends_at > beginning:
                blocks[assignment.person_id].append(span)
                facts.append({"code": "duty_or_post_duty_rest", "person_id": str(assignment.person_id),
                              "source_id": str(assignment.duty_slot_id), "blocking": True,
                              "starts_at": span.starts_at.isoformat(), "ends_at": span.ends_at.isoformat()})
    people = []
    for person_id, availability in sorted(windows.items(), key=lambda row: str(row[0])):
        people.append(CapacityPerson(id=person_id,
            unit_ids=tuple(sorted({window.unit_id for window in availability}, key=str)),
            call_level=availability[0].call_level, windowed=True, windows=tuple(availability),
            blocked=merge_intervals(blocks[person_id])))
    return {"people": tuple(people), "posted_person_ids": tuple(sorted(map(str, identities))),
            "facts": facts, "warnings": warnings,
            "pending_stress": include_pending}
