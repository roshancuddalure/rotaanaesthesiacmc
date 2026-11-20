"""Read-only, bounded eligibility for actual saved unfilled duties on a unit/date."""

from time import monotonic

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models import DutySlot
from app.services.ot_calendar_store import require_unit
from app.services.rota_assignment import validate_assignment
from app.services.rota_candidates import active_assignment, candidate_context
from app.services.rota_rules import read_phase_one_rules
from app.services.rota_template import PHASE4_SLOT_SOURCE


def day_duty_capacity(db, unit_id, day, *, include_pending=False):
    require_unit(db, unit_id)
    response = {"unit_id": str(unit_id), "day": str(day), "scenario": "approved_leave",
        "status": "not_evaluated", "duties": [],
        "scope_note": "Each count is for one saved unfilled duty, independently. It is not simultaneous coverage or permission to assign; apply revalidates current inputs."}
    if include_pending:
        return {**response, "reason": "Duty eligibility is not certified for pending-leave stress. Return to the approved-leave scenario to check actual duties."}
    rules = read_phase_one_rules(db)
    if rules is None:
        return {**response, "reason": "Configure Rota Rules before checking duty eligibility."}
    with db.no_autoflush:
        slots = list(db.scalars(select(DutySlot).where(DutySlot.unit_id == unit_id,
            DutySlot.duty_date == day, DutySlot.source == PHASE4_SLOT_SOURCE)
            .order_by(DutySlot.id).options(selectinload(DutySlot.assignments), selectinload(DutySlot.rota_period))))
        if not slots:
            return {**response, "status": "no_saved_duties", "reason": "No saved unit-assigned duties on this date. Build or review the template first; interval capacity alone does not define duty eligibility."}
        if len(slots) > 16:
            return {**response, "reason": "More than 16 duties exceed this drill-down's work limit."}
        context = candidate_context(db, str(day)[:7], rules=rules)
        people = sorted(context.people.values(), key=lambda p: str(p.id))
        if len(people) * len(slots) > 256:
            return {**response, "reason": "Candidate checks exceed this drill-down's work limit; counts remain unproven."}
        deadline = monotonic() + 10
        duties = []
        for slot in slots:
            row = {"slot_id": str(slot.id), "duty_type": slot.duty_type, "label": slot.slot_label,
                   "starts_at": slot.starts_at.isoformat(), "ends_at": slot.ends_at.isoformat(),
                   "eligible_count": None, "eligible_people": [], "blocked_people": []}
            if slot.rota_period is None or slot.rota_period.status.lower() != "draft":
                duties.append({**row, "status": "protected", "reason": "Only draft duties can receive normal assignments."})
                continue
            if slot.template_status == "excluded" or any(active_assignment(a) for a in slot.assignments):
                duties.append({**row, "status": "not_open", "reason": "Duty is excluded or already assigned; replacements are outside this read-only check."})
                continue
            for person in people:
                if monotonic() >= deadline:
                    return {**response, "reason": "Candidate check time budget reached; partial counts are not certified."}
                validation = validate_assignment(db, slot=slot, person=person,
                    replace_existing=False, context=context)
                item = {"person_id": str(person.id), "name": person.canonical_name}
                if validation["status"] == "clear" and not validation.get("requires_override"):
                    row["eligible_people"].append(item)
                else:
                    row["blocked_people"].append({**item, "issues": [
                        {"code": i.get("code"), "message": i.get("message")}
                        for i in validation.get("issues", [])]})
            unresolved = any(i["code"] == "ot_capacity_unresolved"
                             for p in row["blocked_people"] for i in p["issues"])
            duties.append({**row, "status": "not_evaluated" if unresolved else "evaluated",
                "reason": "OT input or capacity proof is unresolved; no certified count." if unresolved else None,
                "eligible_count": None if unresolved else len(row["eligible_people"])})
    return {**response, "status": "evaluated", "duties": duties}
