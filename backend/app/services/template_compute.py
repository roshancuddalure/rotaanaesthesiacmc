"""Durable template previews with exact numeric allocation evidence.

The existing planner runs inside a rolled-back savepoint for previews. Numeric
selections are replayed through the same sequential planner before completion/apply;
provisional staffing/fairness state is never advanced independently in parallel.
"""

import copy
import hashlib
import json
from datetime import date, datetime
from time import perf_counter
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.models import DutySlot, RotaTemplateGenerationRun
from sqlalchemy import select
from app.services import rota_compute as compute
from app.services.compute_kernels import frame, ranks
from app.services.reference_registry import lock_namespace
from app.services.rota_template import TemplateGenerationOptions, generate_empty_template

OPTION_KEYS = {
    "duty_keys",
    "starts_on",
    "ends_on",
    "include_weekdays",
    "include_weekends",
    "replace_existing",
    "allocation_fairness_policy",
}


class TemplateOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    duty_keys: list[str] | None = Field(default=None, max_length=200)
    starts_on: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    ends_on: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    include_weekdays: bool = True
    include_weekends: bool = True
    replace_existing: bool = True
    allocation_fairness_policy: str = Field(
        default="hybrid", pattern=r"^(hybrid|equal_unit|equal_people)$"
    )


def options(value):
    if not isinstance(value, dict) or set(value) - OPTION_KEYS:
        raise HTTPException(422, "Invalid template options")
    try:
        data = TemplateOptions.model_validate(value).model_dump()
    except ValidationError as exc:
        raise HTTPException(
            422, "Invalid template options; check dates, duties and fairness policy"
        ) from exc
    if data["duty_keys"] is not None and (
        not data["duty_keys"] or any(not key or len(key) > 100 for key in data["duty_keys"])
    ):
        raise HTTPException(422, "Select between one and 200 valid duty types")
    for key in ("starts_on", "ends_on"):
        if data.get(key):
            data[key] = date.fromisoformat(data[key])
    if data.get("starts_on") and data.get("ends_on") and data["starts_on"] > data["ends_on"]:
        raise HTTPException(422, "Template end date cannot be before start date")
    return TemplateGenerationOptions(**data)


def stable_slots(result):
    keys = (
        "unit_id",
        "unit_name",
        "duty_date",
        "duty_type",
        "call_level",
        "slot_label",
        "starts_at",
        "ends_at",
        "is_24hr",
        "max_assignees",
        "source",
        "template_status",
        "is_forced_allocation",
        "template_reason",
        "notes",
    )
    return sorted(
        [{key: slot.get(key) for key in keys} for slot in result["slots"]],
        key=lambda slot: (
            str(slot["duty_date"]),
            str(slot["duty_type"]),
            str(slot["unit_id"]),
            str(slot["slot_label"]),
        ),
    )


def preview(db, month, configuration, answers=None):
    evidence = []
    cursor = 0

    def select_numeric(rows, ties):
        nonlocal cursor
        public, expected = frame(rows, ties)
        winner = expected.index(0)
        if answers is not None:
            if cursor >= len(answers) or answers[cursor] != winner:
                raise HTTPException(
                    409, "Template numeric evidence changed. Generate a new preview."
                )
            winner = answers[cursor]
        evidence.append(public)
        cursor += 1
        return winner

    # Initialize configuration before entering the savepoint; never permit an inner commit.
    compute.writable_period(db, month)
    from app.services.rota_rules import get_phase_one_rules

    get_phase_one_rules(db)
    savepoint = db.begin_nested()
    try:
        result = generate_empty_template(
            db, month, options(configuration), commit=False, numeric_selector=select_numeric
        )
        slots = stable_slots(result)
        summary = copy.deepcopy(result["latest_run"]["summary"])
        if answers is not None and cursor != len(answers):
            raise HTTPException(409, "Template evidence length changed")
        return {"slots": slots, "summary": summary, "frames": evidence}
    finally:
        savepoint.rollback()


def start(db, month, user, configuration, engine):
    configuration = {key: value for key, value in configuration.items() if value is not None}
    options(configuration)
    from app.services.rota_rules import get_phase_one_rules
    from app.services.rota_template import selected_duty_rules, month_dates

    _, rules = get_phase_one_rules(db)
    selected = selected_duty_rules(rules, options(configuration))
    if not month_dates(month, options(configuration)):
        raise HTTPException(422, "The selected date and weekday filters contain no duties")
    if any(
        value and value[:7] != month
        for key, value in configuration.items()
        if key in {"starts_on", "ends_on"}
    ):
        raise HTTPException(422, "Template dates must belong to the selected month")
    period, scope = compute.writable_period(db, month)
    if not scope.is_locked:
        raise HTTPException(409, "Lock the month's included units before previewing its template")
    from app.services.rota_template import included_scope_units, rule_applies_to_unit

    units = included_scope_units(scope)
    if not units or not any(
        rule_applies_to_unit(rule, unit) for rule in selected for unit in units
    ):
        raise HTTPException(
            409,
            "No included unit matches the selected duties. Review the month scope and duty campus rules.",
        )
    result = compute.create_job(db, month, user, engine, commit=False)
    job = db.get(compute.RotaComputeJob, UUID(result["id"]))
    job.state = {
        **job.state,
        "requested_engine": engine,
        "template": {"version": 1, "options": configuration, "answers": [], "cursor": 0},
        "decisions": [],
        "slots": [],
        "cursor": 0,
    }
    db.commit()
    return compute.serialize(job)


def token(job, cursor):
    return hashlib.sha256(f"template:{job.id}:{job.revision}:{cursor}".encode()).hexdigest()


def public_frame(job, state):
    cursor = state["cursor"]
    if cursor >= len(state.get("frames", [])):
        return None
    return {
        **state["frames"][cursor],
        "token": token(job, cursor),
        "batches": state["frames"][cursor : cursor + 32],
    }


def advance(
    db, job, revision, selection=None, received_token=None, fallback=False, selections=None
):
    if revision < job.revision or job.status not in {"queued", "running"}:
        return compute.serialize(job)
    if revision != job.revision:
        raise HTTPException(409, "Reload the template proposal before continuing")
    compute.check_current(db, job)
    started = perf_counter()
    state = copy.deepcopy(job.state)
    template = state["template"]
    if fallback:
        job.engine = "server"
        state["fallback_reason"] = "Browser computation unavailable; continued on the server."
    if "frames" not in template:
        result = preview(db, job.month, template["options"])
        template.update(result)
        template["plan_hash"] = hashlib.sha256(
            json.dumps(result["slots"], sort_keys=True).encode()
        ).hexdigest()
    if job.engine == "local_gpu" and (selection is not None or selections is not None):
        pending = public_frame(job, template)
        supplied = selections if selections is not None else [selection]
        if (
            not pending
            or received_token != pending["token"]
            or not 1 <= len(supplied) <= min(32, len(template["frames"]) - template["cursor"])
        ):
            raise HTTPException(422, "Invalid template frame selection")
        if selection is not None and supplied[0] != selection:
            raise HTTPException(422, "Conflicting template selections")
        expected = [
            ranks(f["rows"], f["ties"]).index(0)
            for f in template["frames"][template["cursor"] : template["cursor"] + len(supplied)]
        ]
        if supplied != expected or any(type(i) is not int for i in supplied):
            raise HTTPException(422, "GPU template allocation disagreed with canonical fairness")
        template["answers"].extend(supplied)
        state["metrics"]["gpu_frames_verified"] = state["metrics"].get(
            "gpu_frames_verified", 0
        ) + len(supplied)
        template["cursor"] += len(supplied)
    if job.engine == "server":
        for pending in template["frames"][template["cursor"] :]:
            template["answers"].append(ranks(pending["rows"], pending["ties"]).index(0))
            template["cursor"] += 1
    complete = template["cursor"] == len(template["frames"])
    if complete:
        replay = preview(db, job.month, template["options"], template["answers"])
        if replay["slots"] != template["slots"]:
            raise HTTPException(409, "Template changed during preview. Generate a new proposal.")
        from app.services.rota_rules import get_phase_one_rules

        labels = get_phase_one_rules(db)[1].duty_rules_by_key
        state["decisions"] = [
            {
                "slot_id": str(i),
                "date": s["duty_date"],
                "duty": labels[s["duty_type"]].label
                if s["duty_type"] in labels
                else s["duty_type"],
                "unit": s["unit_name"] or "Unit not allocated",
                "action": "template",
                "person_id": None,
                "person_name": None,
                "reason": s["template_reason"],
                "score": None,
                "forced": s["is_forced_allocation"],
            }
            for i, s in enumerate(replay["slots"])
        ]
    state["template"] = template
    state["slots"] = list(range(len(template["frames"])))
    state["cursor"] = template["cursor"]
    state["metrics"]["planning_ms"] += round((perf_counter() - started) * 1000, 2)
    state["metrics"]["steps"] += 1
    job.status = "completed" if complete else "running"
    job.state = state
    job.revision += 1
    job.updated_at = datetime.utcnow()
    db.commit()
    return compute.serialize(job)


def apply(db, job, revision, user, dry_run=False):
    if job.status == "applied":
        return compute.serialize(job)
    if job.status != "completed" or job.revision != revision:
        raise HTTPException(409, "Complete and review this template before applying")
    lock_namespace(db, "rota-compute:" + job.month)
    compute.lock_operational_inputs(db)
    compute.check_current(db, job)
    state = job.state["template"]
    replay = preview(db, job.month, state["options"], state["answers"])
    if replay["slots"] != state["slots"]:
        raise HTTPException(409, "Template preview no longer matches live data")
    if dry_run:
        return {**compute.serialize(job), "validated": True}
    period, _ = compute.writable_period(db, job.month)
    original_slots = list(db.scalars(select(DutySlot).where(DutySlot.rota_period_id == period.id)))
    old_rows = [
        {
            column.name: (
                getattr(slot, column.name).isoformat()
                if hasattr(getattr(slot, column.name), "isoformat")
                else str(getattr(slot, column.name))
                if isinstance(getattr(slot, column.name), UUID)
                else getattr(slot, column.name)
            )
            for column in DutySlot.__table__.columns
        }
        for slot in original_slots
    ]
    result = generate_empty_template(db, job.month, options(state["options"]), commit=False)
    if stable_slots(result) != state["slots"]:
        db.rollback()
        raise HTTPException(409, "Template final verification failed; nothing applied")
    run = db.get(RotaTemplateGenerationRun, UUID(result["latest_run"]["id"]))
    run.summary = {
        **run.summary,
        "proposal_id": str(job.id),
        "operator_id": str(user.id),
        "engine": job.engine,
        "requested_engine": job.state.get("requested_engine", job.engine),
        "plan_hash": state["plan_hash"],
    }
    job.status = "applied"
    job.revision += 1
    db.flush()
    job.state = {
        **job.state,
        "result": {
            "created_slots": run.created_slots,
            "assigned": 0,
            "published": False,
            "generation_run_id": str(run.id),
            "original_template_rows": old_rows,
            "after_context_hash": compute.context_hash(db),
        },
    }
    db.commit()
    return compute.serialize(job)
