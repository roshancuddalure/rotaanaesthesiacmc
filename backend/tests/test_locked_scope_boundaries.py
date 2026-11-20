"""Adversarial locked-scope and balancing checks on disposable domain records."""

from datetime import date
from random import Random
from uuid import UUID

import pytest
from sqlalchemy import select

from app.models import DutyAssignment, PersonPosting, RotaComputeJob
from app.services import balance_duties as bd, rota_compute as compute
from app.services.rota_assignment import RotaAssignmentError, assign_person_to_slot, validate_assignment
from app.services.rota_candidates import candidate_context, slot_candidates_with_context
from app.services.rota_optimizer import solve_month
from app.services.extra_duty_verify import check_month
from tests.test_balance_duties import (
    db as db, user as user, make_unit, member, setup_month, make_slot, assign, edit_rules, relaxed, leave,
)


@pytest.mark.parametrize("member_kind", ["outside", "unposted", "expired", "future"])
def test_manual_override_cannot_import_member_outside_dated_locked_scope(db, member_kind):
    edit_rules(db, relaxed)
    unit, outside = make_unit(db, "UNIT_I"), make_unit(db, "OUT")
    setup_month(db, [unit])
    kwargs = {"ends_on": date(2026, 5, 14)} if member_kind == "expired" else {"starts_on": date(2026, 5, 16)} if member_kind == "future" else {}
    target = member(db, "Adversarial recipient", outside if member_kind == "outside" else unit, **kwargs)
    if member_kind == "unposted":
        db.query(PersonPosting).filter_by(person_id=target.id).delete()
    slot = make_slot(db, unit, date(2026, 5, 15))
    db.commit()
    check = validate_assignment(db, slot=slot, person=target, replace_existing=False)
    assert check["status"] == "blocked"
    assert any(i["code"] == "scope_member_excluded" for i in check["issues"])
    with pytest.raises(RotaAssignmentError):
        assign_person_to_slot(db, slot_id=slot.id, person_id=target.id, override_reason="Must not bypass scope")
    assert db.query(DutyAssignment).count() == 0


def test_template_slot_outside_scope_never_gets_cpu_gpu_or_optimizer_assignment(db, user):
    edit_rules(db, relaxed)
    inside, outside = make_unit(db, "UNIT_I"), make_unit(db, "OUT")
    setup_month(db, [inside])
    member(db, "Inside", inside)
    recipient = member(db, "Outside", outside)
    slot = make_slot(db, outside, date(2026, 5, 15))
    db.commit()
    context = candidate_context(db, "2026-05")
    candidates = slot_candidates_with_context(db, slot=slot, context=context)
    assert all(c["validation_status"] == "blocked" for c in candidates["candidates"])
    check = validate_assignment(db, slot=slot, person=recipient, replace_existing=False)
    assert any(i["code"] == "scope_unit_excluded" for i in check["issues"])
    result = solve_month(db, context, {str(slot.id): slot}, seconds=3)
    assert result["choices"] == {} and result["uncovered"] == 1
    for engine in ["server", "local_gpu"]:
        serialized = compute.create_job(db, "2026-05", user, engine)
        job = db.get(RotaComputeJob, UUID(serialized["id"]))
        while job.status in {"queued", "running"}:
            compute.advance(db, job, job.revision)
        assert all(d.get("person_id") is None for d in job.state["decisions"])
        job.status = "cancelled"
        db.commit()
    assert db.query(DutyAssignment).count() == 0


def test_balance_never_moves_to_excluded_unit_even_if_member_has_dual_posting(db):
    edit_rules(db, relaxed)
    inside, outside = make_unit(db, "UNIT_I"), make_unit(db, "OUT")
    setup_month(db, [inside])
    a, b = member(db, "Donor", inside), member(db, "Recipient", inside)
    db.add(PersonPosting(person=b, unit=outside, posting_type="1ST_CALL", starts_on=date(2026, 5, 1)))
    excluded = member(db, "Excluded only", outside)
    for day in [1, 4, 7, 10]:
        assign(db, make_slot(db, inside, date(2026, 5, day)), a)
    bad = make_slot(db, outside, date(2026, 5, 16))
    assign(db, bad, a)
    db.commit()
    state = bd._load(db, "2026-05")
    assert outside.id not in state.candidate_units(b.id, bad)
    assert state.candidate_units(excluded.id, bad) == []
    plan = bd.plan_balance(db, "2026-05")
    assert all(m["to_person_id"] != str(excluded.id) for m in plan["moves"])


def test_forged_reviewed_assignment_to_outside_member_is_rejected_at_apply(db, user):
    edit_rules(db, relaxed)
    inside, outside = make_unit(db, "UNIT_I"), make_unit(db, "OUT")
    setup_month(db, [inside])
    member(db, "Inside", inside)
    attacker = member(db, "Outside", outside)
    make_slot(db, inside, date(2026, 5, 15))
    db.commit()
    raw = compute.create_job(db, "2026-05", user)
    job = db.get(RotaComputeJob, UUID(raw["id"]))
    while job.status in {"queued", "running"}:
        compute.advance(db, job, job.revision)
    state = dict(job.state)
    state["decisions"] = [{**state["decisions"][0], "person_id": str(attacker.id), "person_name": attacker.canonical_name}]
    job.state = state
    db.commit()
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as invalid:
        compute.apply_job(db, job, job.revision)
    assert invalid.value.status_code == 409
    assert db.query(DutyAssignment).count() == 0


def test_scope_edit_invalidates_existing_compute_and_balance_reviews(db, user):
    from fastapi import HTTPException
    from app.models import MonthlyGenerationScopeUnit
    edit_rules(db, relaxed)
    unit = make_unit(db, "UNIT_I")
    setup_month(db, [unit])
    donor = member(db, "Donor", unit)
    member(db, "Receiver", unit)
    for day in [1, 4, 7, 10]:
        assign(db, make_slot(db, unit, date(2026, 5, day)), donor)
    make_slot(db, unit, date(2026, 5, 16))
    db.commit()
    preview = bd.preview(db, "2026-05", user)
    raw = compute.create_job(db, "2026-05", user)
    job = db.get(RotaComputeJob, UUID(raw["id"]))
    while job.status in {"queued", "running"}:
        compute.advance(db, job, job.revision)
    db.query(MonthlyGenerationScopeUnit).one().status = "excluded"
    db.commit()
    with pytest.raises(HTTPException) as stale:
        compute.apply_job(db, job, job.revision)
    assert stale.value.status_code == 409
    with pytest.raises(bd.BalanceError):
        bd.apply(db, "2026-05", preview["token"], preview["plan_hash"], user)
    assert db.query(DutyAssignment).count() == 4


@pytest.mark.parametrize("seed", range(12))
def test_randomized_balance_preserves_scope_capacity_commitments_and_dated_eligibility(db, user, seed):
    rng = Random(seed)
    edit_rules(db, relaxed)
    unit, outside = make_unit(db, "UNIT_I"), make_unit(db, "OUT")
    setup_month(db, [unit])
    people = [member(db, f"Member {i}", unit) for i in range(4)]
    excluded = member(db, "Excluded member", outside)
    # Some months include a midmonth departure or a leave interval.
    if seed % 2:
        db.scalar(select(PersonPosting).where(PersonPosting.person_id == people[3].id)).ends_on = date(2026, 5, 15)
    if seed % 3 == 0:
        leave(db, people[2], date(2026, 5, 4), date(2026, 5, 7))
    slots = [make_slot(db, unit, date(2026, 5, day)) for day in [1, 4, 7, 10, 13, 16, 19, 22]]
    for slot in slots:
        assign(db, slot, people[0] if rng.random() < .85 else people[1])
    db.commit()
    before = {a.id: (a.duty_slot_id, a.status) for a in db.scalars(select(DutyAssignment))}
    preview = bd.preview(db, "2026-05", user)
    assert all(m.get("to_person_id") != str(excluded.id) for m in preview["moves"])
    result = bd.apply(db, "2026-05", preview["token"], preview["plan_hash"], user)
    after = list(db.scalars(select(DutyAssignment)))
    assert {a.id: (a.duty_slot_id, a.status) for a in after} == before
    context = candidate_context(db, "2026-05")
    for a in after:
        assert a.duty_slot.unit_id == unit.id and a.person_id != excluded.id
        assert any(p.person_id == a.person_id and p.unit_id == unit.id and p.starts_on <= a.duty_slot.duty_date
                   and (p.ends_on is None or p.ends_on >= a.duty_slot.duty_date) for p in context.postings)
    assert check_month(db, "2026-05")["ok"]
    if seed % 2 == 0 and seed % 3 != 0:
        assert all(row["ok_after"] for row in result["levels"])
        assert sorted(sum(a.person_id == p.id for a in after) for p in people) == [2, 2, 2, 2]
