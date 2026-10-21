"""Explicit reviewed generation reversal, only while the exact applied state is unchanged."""

from datetime import date, datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import Date, DateTime, Uuid, select

from app.models import DutyAssignment, DutySlot, MemberActivity, RotaTemplateGenerationRun
from app.services import rota_compute as compute
from app.services.reference_registry import lock_namespace


def revert(db, job, revision, user, dry_run=False):
    if job.status == "reverted":
        return compute.serialize(job)
    if job.status != "applied" or job.revision != revision:
        raise HTTPException(409, "Reload an applied generation before requesting reversal")
    lock_namespace(db, "rota-compute:" + job.month)
    compute.lock_operational_inputs(db)
    compute.writable_period(db, job.month)
    result = job.state.get("result", {})
    if (
        not result.get("after_context_hash")
        or compute.context_hash(db) != result["after_context_hash"]
    ):
        raise HTTPException(
            409,
            "Rota data or rules changed after apply. Review and repair the current draft instead of automatic reversal.",
        )
    if dry_run:
        return {**compute.serialize(job), "reversal_validated": True}
    if job.state.get("template"):
        run = db.get(RotaTemplateGenerationRun, UUID(result["generation_run_id"]))
        if run is None:
            raise HTTPException(409, "Original generation record is unavailable")
        new_slots = list(db.scalars(select(DutySlot).where(DutySlot.generation_run_id == run.id)))
        if any(slot.assignments for slot in new_slots):
            raise HTTPException(409, "Template duties have assignments and cannot be reversed")
        for slot in new_slots:
            db.delete(slot)
        db.flush()
        for raw in result["original_template_rows"]:
            values = dict(raw)
            if db.get(DutySlot, UUID(values["id"])):
                continue
            for column in DutySlot.__table__.columns:
                value = values.get(column.name)
                if value is None:
                    continue
                if isinstance(column.type, DateTime):
                    values[column.name] = datetime.fromisoformat(value)
                elif isinstance(column.type, Date):
                    values[column.name] = date.fromisoformat(value)
                elif isinstance(column.type, Uuid):
                    values[column.name] = UUID(value)
            db.add(DutySlot(**values))
        run.summary = {
            **run.summary,
            "reverted_by": str(user.id),
            "reverted_at": datetime.utcnow().isoformat(),
        }
    else:
        for assignment_id in result.get("assignment_ids", []):
            assignment = db.get(DutyAssignment, UUID(assignment_id))
            if assignment is None:
                raise HTTPException(409, "An applied assignment is unavailable")
            db.add(
                MemberActivity(
                    person_id=assignment.person_id,
                    operator_id=user.id,
                    operator_name=user.display_name or user.username,
                    action="rota_generation_reverted",
                    details={"job_id": str(job.id), "assignment_id": assignment_id},
                )
            )
            db.delete(assignment)
        for sid, original in job.state.get("intelligence", {}).get("originals", {}).items():
            assignment = db.get(DutyAssignment, UUID(original["assignment_id"]))
            if assignment is None:
                raise HTTPException(409, "An original repaired assignment is unavailable")
            assignment.status = original.get("status", "assigned")
    job.status = "reverted"
    job.revision += 1
    job.state = {
        **job.state,
        "reversal": {
            "operator_id": str(user.id),
            "at": datetime.utcnow().isoformat(),
            "published": False,
        },
    }
    db.commit()
    return compute.serialize(job)
