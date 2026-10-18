"""Reviewed optimization orchestration and teaching; no autonomous policy changes."""

import copy
from itertools import product
from datetime import datetime, date
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select

from app.models import RotaTeachingExample, RotaLearningVersion, RuleSetting, RuleVersion
from app.services import rota_compute as compute
from app.services.rota_candidates import candidate_context
from app.services.rota_optimizer import solve_month, without_slots, validate_plan
from app.services.reference_registry import lock_namespace

DEFAULT_WEIGHTS = {"burden": 1, "spacing": 1, "history": 1}


def calendar(db):
    row = db.scalar(
        select(RuleSetting)
        .where(RuleSetting.key == "allocation.intelligence.holidays")
        .order_by(RuleSetting.created_at.desc())
    )
    return row.value.get("dates", []) if row else []


def save_calendar(db, user, dates):
    version = RuleVersion(
        name=f"Intelligence holiday calendar {uuid4()}",
        effective_from=date.today(),
        description=f"Calendar reviewed by {user.id}",
    )
    db.add(version)
    db.add(
        RuleSetting(
            rule_version=version,
            key="allocation.intelligence.holidays",
            value={"dates": sorted(set(dates)), "operator_id": str(user.id)},
            value_type="json",
        )
    )
    db.commit()
    return {"dates": calendar(db)}


def active_learning(db):
    version = db.scalar(select(RotaLearningVersion).where(RotaLearningVersion.status == "active"))
    return version


def start(db, month, user, options):
    if options["mode"] not in {"balanced", "repair", "preferences"}:
        raise HTTPException(422, "Unknown planning mode")
    period, _ = compute.writable_period(db, month)
    slots = {str(s.id): s for s in compute.open_slots_for_period(db, period.id)}
    repair = set(options.get("repair_slots", []))
    locked = set(options.get("locked_slots", []))
    if (repair | locked) - slots.keys() or repair & locked:
        raise HTTPException(
            422, "Repair and locked slots must belong to this month and cannot overlap"
        )
    if repair and options["mode"] != "repair":
        raise HTTPException(422, "Existing assignments can only change in repair mode")
    if any(len(compute.active_slot_assignments(slots[s])) != 1 for s in repair):
        raise HTTPException(422, "Repair requires exactly one current assignment per selected slot")
    requested = options.get("preferences", [])
    people = candidate_context(db, month).people
    if any(p["slot_id"] not in slots or UUID(p["person_id"]) not in people for p in requested):
        raise HTTPException(422, "Preferences must reference this month and posted members")
    result = compute.create_job(db, month, user)
    job = db.get(compute.RotaComputeJob, UUID(result["id"]))
    learning = active_learning(db)
    job.state = {
        **job.state,
        "intelligence": {
            "version": 1,
            "options": options,
            "alternatives": [],
            "selected": None,
            "learning_version": str(learning.id) if learning else None,
            "weights": learning.data["weights"] if learning else DEFAULT_WEIGHTS,
            "originals": {
                s: {
                    "assignment_id": str(compute.active_slot_assignments(slots[s])[0].id),
                    "person_id": str(compute.active_slot_assignments(slots[s])[0].person_id),
                }
                for s in repair
            },
        },
    }
    db.commit()
    return compute.serialize(job)


def advance(db, job, revision):
    if revision < job.revision or job.status not in {"queued", "running"}:
        return compute.serialize(job)
    if revision != job.revision:
        raise HTTPException(409, "Reload before continuing")
    compute.check_current(db, job)
    state = copy.deepcopy(job.state)
    intelligence = state["intelligence"]
    options = intelligence["options"]
    period, _ = compute.writable_period(db, job.month)
    all_slots = {str(s.id): s for s in compute.open_slots_for_period(db, period.id)}
    base = without_slots(candidate_context(db, job.month), intelligence["originals"])
    slots = {
        s: slot
        for s, slot in all_slots.items()
        if s not in options["locked_slots"]
        and (s in intelligence["originals"] or not compute.active_slot_assignments(slot))
    }
    preferences = {f"{p['slot_id']}:{p['person_id']}": p["penalty"] for p in options["preferences"]}
    # One bounded search per request. Further calls produce distinct alternatives.
    previous = intelligence["alternatives"]
    forbidden = [p["choices"] for p in previous]
    minimum_required = (
        -next(
            (o["value"] for o in previous[0]["objectives"] if o["name"] == "required_coverage"), 0
        )
        if previous
        else 0
    )
    result = solve_month(
        db,
        base,
        slots,
        mode=options["mode"],
        seconds=options["seconds"],
        originals={s: v["person_id"] for s, v in intelligence["originals"].items()},
        preferences=preferences,
        forbidden=forbidden,
        weights=intelligence["weights"],
        holiday_dates=calendar(db),
        minimum_coverage=len(previous[0]["choices"]) if previous else 0,
        minimum_required=minimum_required,
    )
    decisions = []
    for sid, slot in all_slots.items():
        if sid not in slots:
            decision = compute.decision_for(slot, reason="Locked or existing assignment preserved.")
            decision["action"] = "preserved"
        else:
            person = result["choices"].get(sid)
            candidate = result["candidates"][sid].get(person)
            rejected_messages = list(dict.fromkeys(
                issue['message'] for item in result['rejected'][sid] for issue in item['issues']
                if issue.get('message')))
            unresolved_reason = (' '.join(rejected_messages[:3]) if rejected_messages else
                ('Eligible members conflict with other duties in this plan. Compare alternatives or review availability.'
                 if result['candidates'][sid] else 'No clear eligible member is posted to the required unit and call level for this date.'))
            decision = compute.decision_for(
                slot,
                candidate,
                reason=unresolved_reason,
            )
            decision["original"] = intelligence["originals"].get(sid)
            if decision["original"] and person == decision["original"]["person_id"]:
                decision["action"] = "unchanged"
            decision["reason"] = ("Whole-month optimization. " if candidate else "") + decision[
                "reason"
            ]
        decisions.append(decision)
    report = {k: v for k, v in result.items() if k not in {"candidates", "rejected"}}
    report["decisions"] = decisions
    report["rejected"] = result["rejected"]
    report["changed"] = sum(
        d.get("original") is not None and d["person_id"] != d["original"]["person_id"]
        for d in decisions
    )
    if not previous or (
        report["status"] != "infeasible"
        and len(report["choices"]) >= len(previous[0]["choices"])
        and all(p["choices"] != report["choices"] for p in previous)
    ):
        previous.append(report)
        intelligence["alternative_notice"] = "A distinct alternative is ready."
    else:
        intelligence["alternative_notice"] = (
            "No equally covered distinct alternative was found within the search budget."
        )
    intelligence["selected"] = intelligence["selected"] or 0
    state["decisions"] = previous[intelligence["selected"]]["decisions"]
    state["cursor"] = len(state["slots"])
    state["metrics"]["planning_ms"] += result["elapsed_ms"]
    state["metrics"]["steps"] += 1
    job.state = state
    job.status = "completed"
    job.revision += 1
    job.updated_at = datetime.utcnow()
    db.commit()
    return compute.serialize(job)


def select_alternative(db, job, index, revision):
    compute.check_current(db, job)
    if job.status != "completed" or revision != job.revision or not job.state.get("intelligence"):
        raise HTTPException(409, "Reload the completed proposal")
    state = copy.deepcopy(job.state)
    choices = state["intelligence"]["alternatives"]
    if index >= len(choices) or index < 0:
        raise HTTPException(422, "Alternative is unavailable")
    state["intelligence"]["selected"] = index
    state["decisions"] = choices[index]["decisions"]
    job.state = state
    job.revision += 1
    db.commit()
    return compute.serialize(job)


def add_example(db, job, user, payload):
    if job.status != "applied":
        compute.check_current(db, job)
    decision = next((d for d in job.state["decisions"] if d["slot_id"] == payload["slot_id"]), None)
    if not decision or not decision.get("person_id"):
        raise HTTPException(422, "Choose a proposed assignment")
    alternative = payload.get("preferred_person_id") if payload["kind"] == "prefer" else None
    preferred_features = None
    if alternative:
        period, _ = compute.writable_period(db, job.month)
        slot = next(
            s
            for s in compute.open_slots_for_period(db, period.id)
            if str(s.id) == decision["slot_id"]
        )
        base = without_slots(
            candidate_context(db, job.month), job.state.get("intelligence", {}).get("originals", {})
        )
        rows = compute.slot_candidates_with_context(db, slot=slot, context=base)["candidates"]
        candidate = next(
            (
                c
                for c in rows
                if c["person_id"] == alternative and c["validation_status"] == "clear"
            ),
            None,
        )
        if not candidate:
            raise HTTPException(422, "Preferred member is not a clear eligible candidate")
        preferred_features = candidate["score_parts"]
        choices = {
            d["slot_id"]: d["person_id"] for d in job.state["decisions"] if d.get("person_id")
        }
        choices[decision["slot_id"]] = alternative
        slots = {str(s.id): s for s in compute.open_slots_for_period(db, period.id)}
        if validate_plan(db, base, slots, choices):
            raise HTTPException(
                422, "This preference conflicts with the complete proposal; repair the draft first"
            )
    context = candidate_context(db, job.month)
    example = RotaTeachingExample(
        job_id=job.id,
        operator_id=user.id,
        status="unverified",
        data={
            **payload,
            "preferred_person_id": alternative,
            "preferred_features": preferred_features,
            "month": job.month,
            "decision": decision,
            "context_hash": job.context_hash,
            "rule_snapshot": candidate_context(db, job.month).rules.model_dump(),
            "availability_snapshot": {
                "postings": [
                    {
                        "person_id": str(p.person_id),
                        "unit_id": str(p.unit_id),
                        "starts_on": str(p.starts_on),
                        "ends_on": str(p.ends_on),
                    }
                    for p in context.postings
                ],
                "leave_days": {
                    str(day): {
                        str(person): [
                            {"slot": leave.leave_slot, "status": leave.status} for leave in leaves
                        ]
                        for person, leaves in people.items()
                    }
                    for day, people in context.leaves.items()
                },
                "prior_assignments": [
                    {"person_id": str(a.person_id), "slot_id": str(a.duty_slot_id)}
                    for a in context.assignments
                ],
            },
            "job_snapshot": {
                "decisions": job.state["decisions"],
                "intelligence": job.state.get("intelligence"),
            },
        },
    )
    db.add(example)
    db.commit()
    return {"id": str(example.id), "status": example.status}


def approve_example(db, example, user):
    example.status = "exception" if example.data["kind"] == "exception" else "approved"
    example.data = {
        **example.data,
        "approved_by": str(user.id),
        "approved_at": datetime.utcnow().isoformat(),
    }
    db.commit()


def learning_candidate(db, user):
    source = list(
        db.scalars(
            select(RotaTeachingExample)
            .where(RotaTeachingExample.status == "approved")
            .order_by(RotaTeachingExample.created_at.desc())
        )
    )
    unique = {}
    for row in source:
        key = (
            row.data.get("context_hash", row.data.get("historical_assignment")),
            row.data["slot_id"],
        )
        unique.setdefault(key, row)
    rows = list(unique.values())
    pairs = [r for r in rows if r.data["kind"] == "prefer" and r.data.get("preferred_features")]
    fields = {"burden": "burden", "spacing": "rest", "history": "historical_fairness"}

    def agreement(weights):
        return sum(
            sum(
                (
                    r.data["preferred_features"].get(field, 0)
                    - r.data["decision"].get("score_parts", {}).get(field, 0)
                )
                * weights[key]
                for key, field in fields.items()
            )
            < 0
            for r in pairs
        )

    # Fit a small bounded ranking model to approved pairwise choices. Equal agreement
    # prefers the smallest departure from the default weights; no automatic activation.
    candidates = [dict(zip(fields, values)) for values in product(range(1, 6), repeat=3)]
    weights = min(
        candidates,
        key=lambda w: (-agreement(w), sum(abs(v - 1) for v in w.values()), tuple(w.values())),
    )
    version = RotaLearningVersion(
        operator_id=user.id,
        data={
            "weights": weights,
            "training_examples": [str(r.id) for r in rows],
            "pairwise_examples": len(pairs),
            "training_agreement": agreement(weights),
            "method": "bounded_pairwise_ranking_v1",
            "evaluation": None,
        },
    )
    db.add(version)
    db.commit()
    return version


def evaluate(db, version, user, months):
    training = set(version.data["training_examples"])
    training_months = {
        r.data["month"] for r in db.scalars(select(RotaTeachingExample)) if str(r.id) in training
    }
    if len(set(months)) < 2 or len(set(months)) > 3 or set(months) & training_months:
        raise HTTPException(
            422, "Choose two or three distinct draft months absent from training examples"
        )
    if len(training) < 6:
        raise HTTPException(
            409, "At least six approved examples are needed before evaluating learned preferences"
        )
    results = []
    for month in sorted(set(months)):
        period, _ = compute.writable_period(db, month)
        context = candidate_context(db, month)
        slots = {
            str(s.id): s
            for s in compute.open_slots_for_period(db, period.id)
            if not compute.active_slot_assignments(s)
        }
        if not slots:
            raise HTTPException(422, "Held-out months must contain unfilled duty slots")
        baseline = solve_month(
            db, context, slots, seconds=10, weights=DEFAULT_WEIGHTS, holiday_dates=calendar(db)
        )
        candidate = solve_month(
            db,
            context,
            slots,
            seconds=10,
            weights=version.data["weights"],
            holiday_dates=calendar(db),
        )

        def metrics(result):
            objective = {x["name"]: x["value"] for x in result["objectives"]}
            return [
                result["uncovered"],
                objective.get("weekend_burden", 10**9),
                objective.get("night_burden", 10**9),
                objective.get("workload", 10**9),
            ]

        passed = (
            bool(candidate["choices"])
            and not validate_plan(db, context, slots, candidate["choices"])
            and metrics(candidate) <= metrics(baseline)
        )
        results.append(
            {
                "month": month,
                "context_hash": compute.context_hash(db),
                "baseline": metrics(baseline),
                "candidate": metrics(candidate),
                "passed": passed,
                "baseline_ms": baseline["elapsed_ms"],
                "candidate_ms": candidate["elapsed_ms"],
            }
        )
    version.data = {
        **version.data,
        "evaluation": {
            "passed": all(r["passed"] for r in results),
            "heldout_months": months,
            "results": results,
            "evaluated_by": str(user.id),
            "at": datetime.utcnow().isoformat(),
        },
    }
    db.commit()
    return version.data["evaluation"]


def activate(db, version, user, rollback=False):
    lock_namespace(db, "rota-learning-activation")
    db.refresh(version)
    evaluation = version.data.get("evaluation")
    if not rollback and (not evaluation or not evaluation.get("passed")):
        raise HTTPException(409, "Held-out evaluation must pass before activation")
    if not rollback and any(
        r["context_hash"] != compute.context_hash(db) for r in evaluation["results"]
    ):
        raise HTTPException(
            409, "Scheduling data changed since evaluation; evaluate again before activation"
        )
    if rollback and not version.data.get("activated_at"):
        raise HTTPException(409, "Rollback requires a previously activated version")
    for current in db.scalars(
        select(RotaLearningVersion).where(RotaLearningVersion.status == "active").with_for_update()
    ):
        current.status = "retired"
    version.status = "active"
    version.data = {
        **version.data,
        "activated_at": datetime.utcnow().isoformat(),
        "activated_by": str(user.id),
    }
    db.commit()
