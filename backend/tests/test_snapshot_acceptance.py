"""Original N04 acceptance: real reviewed apply, notes and dated scheduling inputs."""

from copy import deepcopy
from datetime import date
import json
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import (
    CallCluster, DutyAssignment, LeaveRequest, MemberCallLevelChange,
    MonthlyGenerationScopeUnit, Person, PersonCallClusterMembership, PersonPosting,
    ReferenceValue, RotaComputeJob, RuleSetting, Unit, UnitCallMinimum,
)
from app.services import rota_compute as compute, rota_intelligence as intelligence
from app.services.operational_import import fingerprint
from app.services.rota_candidates import candidate_context
from app.services.rota_rules import get_phase_one_rules, save_phase_one_rules
from app.services.rota_setup import monthly_setup
from app.services.scheduling_snapshot import capture
from tests.test_rota_compute import compute_db as compute_db, complete  # noqa: F401


def test_real_rule_notes_save_preserves_reviewed_scheduling_and_private_notes_stay_out(compute_db):
    db, user = compute_db
    job = complete(db, user)
    _version, rules = get_phase_one_rules(db)
    # Ensure this also tests the real reference-registry version bump on save.
    rule = rules.duty_rules[0]
    reference = ReferenceValue(kind="duty_type", key=rule.key, label=rule.label,
                               behavior=rule.model_dump(mode="json"), active=True)
    db.add(reference)
    db.commit()
    compute.cancel(db, job)
    job = complete(db, user)
    old_version = reference.version
    before, import_before = capture(db), fingerprint(db)
    secret = "PRIVATE_RULE_ADMIN_NOTE_731"
    rules.notes = secret
    save_phase_one_rules(db, rules)
    assert reference.version > old_version
    assert fingerprint(db) != import_before
    after = capture(db)
    assert after.digest == before.digest
    assert secret not in after.canonical_json
    assert secret not in json.dumps(intelligence.input_snapshot(candidate_context(db, "2026-05")))
    assert compute.apply_job(db, job, job.revision, user)["status"] == "applied"


@pytest.mark.parametrize("change", ["dated_posting", "dated_call", "group_window", "call_minimum",
                                    "scope_unit", "pending_to_approved", "reference_behavior"])
def test_dated_and_scoped_input_change_refuses_reviewed_apply_without_writes(compute_db, change):
    db, user = compute_db
    get_phase_one_rules(db)
    person = db.scalar(select(Person))
    unit = db.scalar(select(Unit))
    group = db.scalar(select(CallCluster))
    membership = PersonCallClusterMembership(person=person, cluster=group, effective_from=date(2026, 1, 1))
    leave = LeaveRequest(person=person, starts_on=date(2026, 5, 30), ends_on=date(2026, 5, 30),
                         leave_type="ANNUAL_LEAVE", leave_slot="AM", status="pending")
    db.add_all([membership, leave])
    scoped = db.scalar(select(MonthlyGenerationScopeUnit))
    if scoped is None:
        _, scope = monthly_setup(db, "2026-05")
        scoped = MonthlyGenerationScopeUnit(scope=scope, unit=unit, status="included")
        db.add(scoped)
    reference = ReferenceValue(kind="snapshot_acceptance", key="reviewed", label="Reviewed",
                               behavior={"active_pool": ["1ST_CALL"]}, active=True)
    db.add_all([membership, leave, reference])
    db.commit()
    job = complete(db, user)
    if change == "dated_posting":
        db.scalar(select(PersonPosting)).starts_on = date(2026, 5, 15)
    elif change == "dated_call":
        db.add(MemberCallLevelChange(person_id=person.id, call_level="3RD_CALL", effective_from=date(2026, 5, 15)))
    elif change == "group_window":
        membership.effective_to = date(2026, 5, 10)
    elif change == "call_minimum":
        db.add(UnitCallMinimum(unit_id=unit.id, call_level="4TH_CALL", minimum_free_people=3))
    elif change == "scope_unit":
        assert scoped is not None
        scoped.status = "excluded"
    elif change == "pending_to_approved":
        leave.status = "approved"
    else:
        reference.behavior = {"active_pool": ["3RD_CALL"]}
    db.commit()
    assert capture(db).digest != job.context_hash
    with pytest.raises(HTTPException) as failure:
        compute.apply_job(db, job, job.revision, user)
    assert failure.value.status_code == 409
    assert db.query(DutyAssignment).count() == 0


def test_nested_semantic_rule_change_still_invalidates_after_note_filtering(compute_db):
    db, user = compute_db
    job = complete(db, user)
    row = db.scalar(select(RuleSetting))
    value = deepcopy(row.value)
    value["rest_rules"]["minimum_gap_after_24hr_hours"] += 24
    row.value = value
    db.commit()
    assert capture(db).digest != job.context_hash
    with pytest.raises(HTTPException):
        compute.apply_job(db, db.get(RotaComputeJob, UUID(str(job.id))), job.revision, user)
    assert db.query(DutyAssignment).count() == 0
