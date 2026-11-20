"""Read-only saved-day OT-role coverage preview. No rule/default initialization."""

from app.services.ot_availability import canonical_availability
from app.services.ot_calendar_store import resolved
from sqlalchemy import select

from app.models import CallCluster, Unit
from app.services.ot_capacity import CapacityReserve, evaluate_capacity
from app.services.rota_safety import unit_minimum_for_required_calls
from app.services.rota_rules import read_phase_one_rules


def day_capacity(db, unit_id, day, *, include_pending=False):
    calendar = resolved(db, unit_id, day)
    scope = {"reserve_evaluated": False,
             "scope_note": "OT role coverage only; existing unit/call staffing minima are not evaluated here."}
    if not calendar["configured"]:
        missing = calendar.get("missing_areas", ())
        return {**calendar, **scope, "capacity": None, "pending_stress": include_pending,
                "warnings": ["Missing reviewed OT demand or closure for: " + ", ".join(missing)
                             if missing else "No reviewed OT demand is defined for this unit/date."]}
    if not calendar["requirements"]:
        return {**calendar, **scope, "status": "closed", "capacity": None,
                "pending_stress": include_pending, "warnings": []}
    rules = read_phase_one_rules(db)
    if rules is None:
        if all(row.target == 0 for row in calendar["requirements"]):
            return {**calendar, **scope, "status": "feasible",
                    "capacity": evaluate_capacity(calendar["requirements"], ()),
                    "pending_stress": include_pending, "warnings": []}
        return {**calendar, **scope, "status": "not_evaluated", "capacity": None,
                "pending_stress": include_pending,
                "warnings": ["Configure Rota Rules before evaluating leave, rest and staffing capacity."]}
    unit = db.get(Unit, unit_id)
    reserves = tuple(CapacityReserve(
        id=f"minimum:{row.id}", unit_id=row.unit_id, starts_at=row.starts_at, ends_at=row.ends_at,
        call_levels=row.call_levels, minimum=unit_minimum_for_required_calls(unit, set(row.call_levels), rules),
        mode=calendar["reserve_mode"],
    ) for row in calendar["requirements"])
    qualification_map = {row.skill_key: row.group_keys for row in calendar["qualification_bindings"]}
    used_skills = {skill for row in calendar["requirements"] if row.target > 0 for skill in row.required_skills}
    source_keys = {key for skill in used_skills for key in qualification_map.get(skill, ())}
    active_keys = set(db.scalars(select(CallCluster.key).where(CallCluster.key.in_(source_keys), CallCluster.active.is_(True)))) if source_keys else set()
    context = canonical_availability(db, calendar["requirements"], rules, include_pending=include_pending,
                                     qualification_groups_by_unit={unit_id: qualification_map})
    capacity = evaluate_capacity(calendar["requirements"], context["people"], reserves=reserves)
    if source_keys - active_keys:
        context["warnings"].append({"code": "ot_qualification_sources_unavailable", "group_keys": sorted(source_keys - active_keys)})
    scope = {"reserve_evaluated": True,
             "scope_note": "OT roles and existing staffing minima for these configured call pools are evaluated together. Other duties and call pools still require full rota validation."}
    eligible_ids = {person for row in capacity["requirements"] for person in row["eligible_person_ids"]}
    qualification_gap = any(row["code"] == "ot_qualifications_unconfigured" for row in context["warnings"])
    uncertain_availability = any(row["code"] in {"ot_call_context_unresolved", "ot_unknown_leave_slot", "ot_qualification_sources_unavailable"}
                                for row in context["warnings"])
    shortage = capacity["mandatory_covered"] < capacity["mandatory_required"] or any(
        row["minimum_shortage"] for row in capacity["reserves"])
    unresolved = qualification_gap or (uncertain_availability and shortage)
    return {**calendar, **scope, "status": "not_evaluated" if unresolved else capacity["status"], "capacity": capacity,
            "pending_stress": include_pending,
            "counts": {"posted_people": len(context["posted_person_ids"]),
                       "compatible_available_people": len(eligible_ids),
                       "approved_leave_people": len({f["person_id"] for f in context["facts"] if f["code"] == "approved_leave"}),
                       "pending_leave_people": len({f["person_id"] for f in context["facts"] if f["code"] == "pending_leave"}),
                       "duty_or_rest_people": len({f["person_id"] for f in context["facts"] if f["code"] == "duty_or_post_duty_rest"})},
            "warnings": context["warnings"], "facts": context["facts"]}
