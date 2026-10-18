"""Bounded, resumable planning with explicit, atomic application of a reviewed draft."""

import copy
import hashlib
import json
from datetime import datetime, timedelta
from time import perf_counter
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select

from app.models import (
    CallCluster,
    DutyAssignment,
    MemberActivity,
    MonthlyGenerationScope,
    MonthlyGenerationScopeUnit,
    PersonCallClusterMembership,
    RotaComputeJob,
    RotaPeriod,
    RuleSetting,
    RuleVersion,
)
from app.services.operational_import import fingerprint
from app.services.reference_registry import lock_namespace
from app.services.rota_assignment import validate_assignment
from app.services.rota_auto_fill import open_slots_for_period, active_slot_assignments
from app.services.rota_candidates import (
    candidate_context,
    slot_candidates_with_context,
    add_provisional_assignment,
)
from app.services.rota_safety import required_call_levels, rule_for_slot
from app.services.rota_setup import monthly_setup

ACTIVE = {"queued", "running", "completed"}
SCORE_FIELDS = [
    "status",
    "same_day_type",
    "burden",
    "weekend",
    "rest",
    "staffing",
    "fairness",
    "validation",
    "historical_fairness",
]


def context_hash(db):
    state = [fingerprint(db)]
    for model in [
        RuleVersion,
        RuleSetting,
        CallCluster,
        PersonCallClusterMembership,
        RotaPeriod,
        MonthlyGenerationScope,
        MonthlyGenerationScopeUnit,
    ]:
        state.append(
            [dict(r) for r in db.execute(select(model.__table__).order_by(model.id)).mappings()]
        )
    return hashlib.sha256(json.dumps(state, sort_keys=True, default=str).encode()).hexdigest()


def writable_period(db, month):
    from app.services.leave import month_bounds

    starts_on, ends_on = month_bounds(month)
    period = db.scalar(
        select(RotaPeriod).where(RotaPeriod.starts_on == starts_on, RotaPeriod.ends_on == ends_on)
    )
    if period is None:
        raise HTTPException(409, "Set up a draft month and generate its duty template first.")
    scope = db.scalar(
        select(MonthlyGenerationScope).where(MonthlyGenerationScope.rota_period_id == period.id)
    )
    if scope is None:
        raise HTTPException(409, "Set up the month's generation scope first.")
    if period.status.lower() != "draft":
        raise HTTPException(409, "Only an unpublished draft month can be computed or changed.")
    return period, scope


def serialize(job):
    state = job.state
    decisions = state.get("decisions", [])
    return {
        "id": str(job.id),
        "month": job.month,
        "status": job.status,
        "engine": job.engine,
        "fallback_reason": state.get("fallback_reason"),
        "revision": job.revision,
        "context_hash": job.context_hash,
        "processed": state.get("cursor", 0),
        "total": len(state.get("slots", [])),
        "proposed": sum(d.get("person_id") is not None for d in decisions),
        "unresolved": sum(d.get("action") == "unresolved" for d in decisions),
        "decisions": decisions,
        "frame": state.get("pending", {}).get("public"),
        "metrics": state.get("metrics", {}),
        "error": state.get("error"),
        "result": state.get("result"),
        "burden": burden_comparison(state),
        "intelligence": state.get("intelligence"),
        "created_at": job.created_at.isoformat() + "Z",
    }


def burden_comparison(state):
    before = state.get("baseline_loads", [])
    after = copy.deepcopy(before)
    people = {p["person_id"]: p for p in after}
    for sid, original in state.get("intelligence", {}).get("originals", {}).items():
        if original["person_id"] in people:
            decision = next((d for d in state.get("decisions", []) if d["slot_id"] == sid), {})
            person = people[original["person_id"]]
            person["total"] -= 1
            person["hours24"] -= int(decision.get("is_24hr", False))
            person["weekend24"] -= int(
                decision.get("is_24hr", False) and decision.get("weekend", False)
            )
    for d in state.get("decisions", []):
        if d.get("person_id") in people:
            person = people[d["person_id"]]
            person["total"] += 1
            person["hours24"] += int(d.get("is_24hr", False))
            person["weekend24"] += int(d.get("is_24hr", False) and d.get("weekend", False))

    def summarize(rows):
        return {
            key: {
                "min": min((p[key] for p in rows), default=0),
                "max": max((p[key] for p in rows), default=0),
                "mean": round(sum(p[key] for p in rows) / max(1, len(rows)), 2),
            }
            for key in ["total", "hours24", "weekend24"]
        }

    return {"members": len(before), "before": summarize(before), "after": summarize(after)}


def create_job(db, month, operator, engine="server"):
    lock_namespace(db, "rota-compute:" + month)
    period, _ = writable_period(db, month)
    # Materialize defaults before freezing the snapshot.
    context = candidate_context(db, month)
    db.flush()
    lock_namespace(db, "rota-compute:" + month)
    existing = db.scalar(
        select(RotaComputeJob)
        .where(RotaComputeJob.month == month, RotaComputeJob.status.in_(ACTIVE))
        .with_for_update()
    )
    if existing and datetime.utcnow() - existing.updated_at > timedelta(hours=2):
        existing.status = "failed"
        existing.state = {**existing.state, "error": "Expired. Create a fresh proposal."}
        db.flush()
        existing = None
    if existing:
        raise HTTPException(
            409,
            {
                "message": "A proposal already exists for this month. Resume or cancel it.",
                "job_id": str(existing.id),
            },
        )
    slots = open_slots_for_period(db, period.id)
    job = RotaComputeJob(
        month=month,
        operator_id=operator.id,
        engine=engine,
        context_hash=context_hash(db),
        state={
            "slots": [str(s.id) for s in slots],
            "cursor": 0,
            "operator_name": operator.display_name or operator.username,
            "baseline_loads": [
                {
                    "person_id": str(p.id),
                    "total": len(context.assignments_by_person.get(p.id, [])),
                    "hours24": sum(
                        a.duty_slot.is_24hr for a in context.assignments_by_person.get(p.id, [])
                    ),
                    "weekend24": sum(
                        a.duty_slot.is_24hr and a.duty_slot.duty_date.weekday() >= 5
                        for a in context.assignments_by_person.get(p.id, [])
                    ),
                }
                for p in context.people.values()
                if p.active_status == "active"
            ],
            "decisions": [],
            "metrics": {"planning_ms": 0, "steps": 0},
        },
    )
    db.add(job)
    db.commit()
    return serialize(job)


def owned_job(db, job_id, operator):
    lock_namespace(db, "rota-compute")
    job = db.scalar(
        select(RotaComputeJob)
        .where(RotaComputeJob.id == job_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if job is None:
        raise HTTPException(404, "Compute job not found")
    if job.operator_id != operator.id and operator.role != "superadmin":
        raise HTTPException(403, "This proposal belongs to another operator")
    return job


def check_current(db, job):
    writable_period(db, job.month)
    if (
        datetime.utcnow() - job.created_at > timedelta(hours=2)
        or context_hash(db) != job.context_hash
    ):
        job.status = "failed"
        job.state = {
            **job.state,
            "error": "Rota data or rules changed, or this proposal expired. Generate a fresh draft.",
        }
        job.revision += 1
        db.commit()
        raise HTTPException(409, job.state["error"])


def prepare_context(db, job, state):
    context = candidate_context(db, job.month)
    period, _ = monthly_setup(db, job.month)
    slots = {str(s.id): s for s in open_slots_for_period(db, period.id)}
    for decision in state["decisions"]:
        if decision.get("person_id"):
            add_provisional_assignment(
                context, slots[decision["slot_id"]], UUID(decision["person_id"])
            )
    return context, slots


def choose_candidates(db, slot, context):
    row = slot_candidates_with_context(db, slot=slot, context=context)
    calls = required_call_levels(slot, rule_for_slot(slot, context.rules))
    candidates = (
        [
            c
            for c in row["candidates"]
            if c["candidate_status"] == "eligible"
            and c["validation_status"] == "clear"
            and not c["requires_override"]
            and c["call_level"] in calls
        ]
        if len(calls) == 1
        else []
    )
    return row, candidates


def decision_for(
    slot, candidate=None, reason="No clear same-call candidate; left open for review."
):
    return {
        "slot_id": str(slot.id),
        "date": str(slot.duty_date),
        "duty": slot.slot_label,
        "unit": slot.unit.name if slot.unit else "",
        "action": "proposed" if candidate else "unresolved",
        "person_id": candidate["person_id"] if candidate else None,
        "person_name": candidate["person_name"] if candidate else None,
        "score": candidate["rank_score"] if candidate else None,
        "is_24hr": slot.is_24hr,
        "weekend": slot.duty_date.weekday() >= 5,
        "score_parts": candidate["score_parts"] if candidate else {},
        "reason": " ".join(candidate["reasons"]) if candidate else reason,
    }


def advance(db, job, revision, selection=None, token=None, fallback=False, batch=8):
    if job.state.get("intelligence"):
        from app.services.rota_intelligence import advance as intelligent_advance

        return intelligent_advance(db, job, revision)
    if revision < job.revision:
        return serialize(job)  # Retry after a lost response: do not execute another step.
    if revision != job.revision:
        raise HTTPException(409, "Reload this proposal before continuing")
    if job.status not in {"queued", "running"}:
        return serialize(job)
    lock_namespace(db, "rota-compute:" + job.month)
    check_current(db, job)
    started = perf_counter()
    state = copy.deepcopy(job.state)
    context, slots = prepare_context(db, job, state)
    if fallback:
        state["fallback_reason"] = "Browser computation unavailable; continued on the server."
        job.engine = "server"
        state.pop("pending", None)
    pending = state.get("pending")
    if pending:
        if selection is None:
            return serialize(job)
        if token != pending["public"]["token"] or selection != pending["winner"]:
            raise HTTPException(
                422, "Local computation disagreed with the validated ranking. Retry on the server."
            )
        candidate = pending["candidates"][selection]
        slot = slots[state["slots"][state["cursor"]]]
        state["decisions"].append(decision_for(slot, candidate))
        add_provisional_assignment(context, slot, UUID(candidate["person_id"]))
        state["cursor"] += 1
        state.pop("pending")
    for _ in range(batch):
        if state["cursor"] >= len(state["slots"]):
            break
        slot = slots[state["slots"][state["cursor"]]]
        if active_slot_assignments(slot):
            decision = decision_for(slot, reason="Existing assignment preserved.")
            decision["action"] = "preserved"
            state["decisions"].append(decision)
            state["cursor"] += 1
            continue
        _, candidates = choose_candidates(db, slot, context)
        if candidates and job.engine == "local_gpu":
            # Opaque row indices and numeric parts only; names/IDs/comments never enter the worker.
            ordered = sorted(candidates, key=lambda c: c["person_id"])
            winner = next(
                i for i, c in enumerate(ordered) if c["person_id"] == candidates[0]["person_id"]
            )
            tie_order = {
                c["person_id"]: i
                for i, c in enumerate(
                    sorted(candidates, key=lambda c: (c["person_name"], c["person_id"]))
                )
            }
            public = {
                "token": hashlib.sha256(
                    f"{job.id}:{job.revision}:{state['cursor']}".encode()
                ).hexdigest(),
                "rows": [
                    [c["score_parts"].get(field, 0) for field in SCORE_FIELDS] for c in ordered
                ],
                "ties": [tie_order[c["person_id"]] for c in ordered],
            }
            state["pending"] = {"public": public, "candidates": ordered, "winner": winner}
            break
        candidate = candidates[0] if candidates else None
        state["decisions"].append(decision_for(slot, candidate))
        if candidate:
            add_provisional_assignment(context, slot, UUID(candidate["person_id"]))
        state["cursor"] += 1
    job.status = "completed" if state["cursor"] == len(state["slots"]) else "running"
    state["metrics"]["planning_ms"] += round((perf_counter() - started) * 1000, 2)
    state["metrics"]["steps"] += 1
    for name, elapsed in context.timings.items():
        state["metrics"][name] = round(state["metrics"].get(name, 0) + elapsed, 2)
    job.state = state
    job.revision += 1
    job.updated_at = datetime.utcnow()
    db.commit()
    return serialize(job)


def cancel(db, job):
    if job.status != "applied":
        job.status = "cancelled"
        job.revision += 1
        job.updated_at = datetime.utcnow()
        db.commit()
    return serialize(job)


def apply_job(db, job, revision, operator=None, dry_run=False):
    if job.status == "applied":
        return serialize(job)
    if job.status != "completed" or job.revision != revision:
        raise HTTPException(409, "Complete and review this proposal before applying")
    lock_namespace(db, "rota-compute:" + job.month)
    if db.get_bind().dialect.name == "postgresql":
        # Protect the final snapshot even from older writers that do not use advisory locks.
        from sqlalchemy import text
        from app.db.session import Base

        names = [
            "persons",
            "person_aliases",
            "person_designations",
            "member_call_level_changes",
            "person_call_changes",
            "units",
            "unit_call_minimums",
            "admin_mappings",
            "reference_values",
            "person_postings",
            "leave_requests",
            "duty_slots",
            "duty_assignments",
            "rule_versions",
            "rule_settings",
            "call_clusters",
            "person_call_cluster_memberships",
            "rota_periods",
            "monthly_generation_scopes",
            "monthly_generation_scope_units",
        ]
        tables = sorted(n for n in names if n in Base.metadata.tables)
        bind = db.get_bind()
        schema = bind.get_execution_options().get("schema_translate_map", {}).get(None)
        quote = bind.dialect.identifier_preparer.quote
        prefix = quote(schema) + "." if schema else ""
        db.execute(
            text(
                "LOCK TABLE "
                + ", ".join(prefix + quote(n) for n in tables)
                + " IN SHARE ROW EXCLUSIVE MODE"
            )
        )
    check_current(db, job)
    started = perf_counter()
    context = candidate_context(db, job.month)
    period, _ = writable_period(db, job.month)
    # Revalidate every proposal against the current schedule, including prior proposed choices.
    # Save nothing operational until all decisions have passed.
    slots = {str(s.id): s for s in open_slots_for_period(db, period.id)}
    intelligence = job.state.get("intelligence", {})
    originals = intelligence.get("originals", {})
    if originals:
        from app.services.rota_optimizer import without_slots

        context = without_slots(context, originals)
        for sid, original in originals.items():
            active = active_slot_assignments(slots[sid])
            if (
                len(active) != 1
                or str(active[0].id) != original["assignment_id"]
                or str(active[0].person_id) != original["person_id"]
            ):
                raise HTTPException(
                    409, "An original assignment changed. Generate a fresh proposal."
                )
    proposals = [d for d in job.state["decisions"] if d.get("person_id")]
    for d in proposals:
        slot = slots.get(d["slot_id"])
        person = context.people.get(UUID(d["person_id"]))
        if (
            slot is None
            or person is None
            or (active_slot_assignments(slot) and str(slot.id) not in originals)
        ):
            raise HTTPException(409, "An assignment changed. Generate a fresh proposal.")
        validation = validate_assignment(
            db,
            slot=slot,
            person=person,
            replace_existing=str(slot.id) in originals,
            context=context,
        )
        if validation["status"] != "clear":
            raise HTTPException(409, "The complete proposal no longer passes safety validation.")
        add_provisional_assignment(context, slot, person.id)
    for d in proposals:
        validation = validate_assignment(
            db,
            slot=slots[d["slot_id"]],
            person=context.people[UUID(d["person_id"])],
            replace_existing=True,
            context=context,
        )
        if validation["status"] != "clear":
            raise HTTPException(409, "The complete proposal no longer passes safety validation.")
    if intelligence:
        from app.services.rota_optimizer import validate_plan, without_slots

        base = without_slots(candidate_context(db, job.month), originals)
        if validate_plan(db, base, slots, {d["slot_id"]: d["person_id"] for d in proposals}):
            raise HTTPException(
                409,
                "This proposal would introduce a conflict in a preserved duty. Generate a fresh draft.",
            )
    if dry_run:
        return {
            **serialize(job),
            "validated": True,
            "validation_ms": round((perf_counter() - started) * 1000, 2),
        }
    changed_originals = {
        d["slot_id"]
        for d in job.state["decisions"]
        if d["slot_id"] in originals and d.get("person_id") != originals[d["slot_id"]]["person_id"]
    }
    for sid in changed_originals:
        old = db.get(DutyAssignment, UUID(originals[sid]["assignment_id"]))
        old.status = "cancelled"
        db.add(
            MemberActivity(
                person_id=old.person_id,
                operator_id=job.operator_id,
                operator_name=job.state.get("operator_name", "Reviewed repair"),
                action="rota_compute_replaced",
                details={"job_id": str(job.id), "slot_id": sid},
            )
        )
    saved = 0
    for d in proposals:
        if d["slot_id"] in originals and d["slot_id"] not in changed_originals:
            continue
        saved += 1
        db.add(
            DutyAssignment(
                duty_slot_id=UUID(d["slot_id"]),
                person_id=UUID(d["person_id"]),
                status="assigned",
                source="reviewed_compute_draft",
            )
        )
        db.add(
            MemberActivity(
                person_id=UUID(d["person_id"]),
                operator_id=operator.id if operator else job.operator_id,
                operator_name=(operator.display_name or operator.username)
                if operator
                else job.state.get("operator_name", "Reviewed rota compute"),
                action="rota_compute_applied",
                details={"job_id": str(job.id), "slot_id": d["slot_id"], "reason": d["reason"]},
            )
        )
    job.status = "applied"
    job.revision += 1
    job.state = {
        **job.state,
        "result": {"assigned": saved, "replaced": len(changed_originals), "published": False},
        "metrics": {
            **job.state["metrics"],
            "apply_ms": round((perf_counter() - started) * 1000, 2),
        },
    }
    db.commit()
    return serialize(job)
