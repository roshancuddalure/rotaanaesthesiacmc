"""Scheduling semantics, privacy, frozen evidence and import-review independence."""

from copy import deepcopy
from dataclasses import FrozenInstanceError
from datetime import date, timedelta
import json
from uuid import uuid4

import pytest
from sqlalchemy import event, select

from app.models import (
    CallCluster, DutyAssignment, DutySlot, ExtraDutyBatch, ExtraDutyRecord, LeaveRequest,
    MonthlyGenerationScope, Person, PersonCallClusterMembership, PersonPosting, RuleSetting, Unit, UnitFallback,
)
from app.services.operational_import import fingerprint
from app.services.rota_rules import PHASE_ONE_SETTING_KEY, get_phase_one_rules
from app.services.scheduling_snapshot import capture
from tests.test_rota_compute import compute_db as compute_db  # noqa: F401


@pytest.fixture(autouse=True)
def initialized_rules(compute_db):
    get_phase_one_rules(compute_db[0])


def test_private_notes_do_not_enter_snapshot_or_invalidate_scheduling_but_import_review_changes(compute_db):
    db, _ = compute_db
    person = db.scalar(select(Person))
    leave = LeaveRequest(person=person, starts_on=date(2026, 5, 20), ends_on=date(2026, 5, 20),
                         leave_type="ANNUAL_LEAVE", leave_slot="FULL_DAY", status="pending")
    db.add(leave)
    db.commit()
    before, imported = capture(db), fingerprint(db)
    secret = "PRIVATE_MEDICAL_DETAIL_402"
    leave.notes = secret
    db.scalar(select(Unit)).notes = secret
    db.scalar(select(PersonPosting)).notes = secret
    db.scalar(select(RuleSetting)).description = secret
    db.commit()
    after = capture(db)
    assert secret not in after.canonical_json
    assert before.digest == after.digest
    assert fingerprint(db) != imported


@pytest.mark.parametrize("change", ["leave", "posting", "call", "minimum", "rest_rule", "lock",
                                   "holiday", "membership", "published", "duty_time", "assignment",
                                   "fallback", "ledger"])
def test_relevant_input_change_invalidates_snapshot(compute_db, change):
    db, user = compute_db
    person = db.scalar(select(Person))
    unit = db.scalar(select(Unit))
    slot = db.scalar(select(DutySlot))
    if change == "fallback":
        other = Unit(code="SNAPSHOT_OTHER", name="Other unit")
        db.add(other)
        db.commit()
    if change == "ledger":
        batch = ExtraDutyBatch(rota_period_id=slot.rota_period_id, month="2026-05",
                               plan_hash="p", context_hash="c", created_by_id=user.id)
        db.add(batch)
        db.commit()
    before = capture(db).digest
    if change == "leave":
        db.add(LeaveRequest(person=person, starts_on=date(2026, 5, 2), ends_on=date(2026, 5, 2),
                            leave_type="ANNUAL_LEAVE", leave_slot="AM", status="approved"))
    elif change == "posting":
        db.scalar(select(PersonPosting)).ends_on = date(2026, 5, 10)
    elif change == "call":
        person.call_level = "4TH_CALL"
    elif change == "minimum":
        unit.minimum_free_people += 1
    elif change == "rest_rule":
        row = db.scalar(select(RuleSetting).where(RuleSetting.key == PHASE_ONE_SETTING_KEY))
        value = deepcopy(row.value)
        value["rest_rules"]["minimum_gap_after_24hr_hours"] += 24
        row.value = value
    elif change == "lock":
        row = db.scalar(select(MonthlyGenerationScope))
        row.is_locked = not row.is_locked
    elif change == "holiday":
        row = db.scalar(select(RuleSetting))
        db.add(RuleSetting(rule_version_id=row.rule_version_id, key="allocation.intelligence.holidays",
                           value={"dates": ["2026-05-02"]}, value_type="json"))
    elif change == "membership":
        group = db.scalar(select(CallCluster))
        db.add(PersonCallClusterMembership(person=person, cluster=group, effective_from=date(2026, 5, 1)))
    elif change == "published":
        slot.rota_period.status = "published"
    elif change == "duty_time":
        slot.ends_at += timedelta(hours=1)
    elif change == "assignment":
        db.add(DutyAssignment(duty_slot=slot, person=person, status="assigned"))
    elif change == "fallback":
        db.add(UnitFallback(unit_id=unit.id, fallback_unit_id=other.id, position=1))
    else:
        db.add(ExtraDutyRecord(batch_id=batch.id, person_id=person.id, slot_id=slot.id, assignment_id=uuid4(),
                              month="2026-05", duty_date=slot.duty_date, duty_type=slot.duty_type,
                              status="active"))
    db.commit()
    assert capture(db).digest != before


def test_snapshot_is_immutable_detached_and_capture_never_flushes_pending_edits(compute_db):
    db, _ = compute_db
    before = capture(db)
    with pytest.raises(FrozenInstanceError):
        before.digest = "changed"
    decoded = json.loads(before.canonical_json)
    decoded["tables"]["persons"].clear()
    assert json.loads(before.canonical_json)["tables"]["persons"]
    unit = db.scalar(select(Unit))
    unit.minimum_free_people += 1
    def refuse_flush(*args):
        pytest.fail("Capturing saved scheduling evidence flushed pending edits")
    event.listen(db, "before_flush", refuse_flush)
    try:
        assert capture(db) == before
    finally:
        event.remove(db, "before_flush", refuse_flush)
    assert unit in db.dirty
    db.commit()
    assert capture(db).digest != before.digest


def test_unordered_call_pool_reordering_is_noop_but_duty_order_is_preserved(compute_db):
    db, _ = compute_db
    row = db.scalar(select(RuleSetting).where(RuleSetting.key == PHASE_ONE_SETTING_KEY))
    value = deepcopy(row.value)
    value["duty_rules"][0]["allowed_call_levels"] = ["3RD_CALL", "4TH_CALL"]
    row.value = value
    db.commit()
    before = capture(db).digest
    value = deepcopy(row.value)
    value["duty_rules"][0]["allowed_call_levels"].reverse()
    row.value = value
    db.commit()
    assert capture(db).digest == before
    value = deepcopy(row.value)
    value["duty_rules"].reverse()
    row.value = value
    db.commit()
    assert capture(db).digest != before
