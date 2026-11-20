"""Locks must refresh cached clean inputs without discarding a caller's edits."""

from copy import deepcopy

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models import OtCalendar, Unit
from app.services.ot_calendar_store import revision
from app.services.rota_assignment import RotaAssignmentError, assign_person_to_slot
from app.services.rota_compute import lock_operational_inputs
from tests.test_ot_assignment_integration import environment as environment  # noqa: F401


@pytest.mark.parametrize("ot_enabled", [False, True])
def test_lock_refreshes_clean_unit_fields_but_preserves_unrelated_pending_notes(environment, monkeypatch, ot_enabled):
    from app.core.config import settings
    monkeypatch.setattr(settings, "ot_calendar_enabled", ot_enabled)
    db, unit, _people, _target = environment
    unit.notes = "Unrelated unsaved administrator note"
    with Session(db.get_bind()) as editor:
        current = editor.get(Unit, unit.id)
        current.minimum_free_people = 3
        editor.commit()
    assert unit.minimum_free_people == 0
    def refuse_flush(*args):
        pytest.fail("Acquiring/refreshing scheduling inputs flushed an unrelated edit")
    event.listen(db, "before_flush", refuse_flush)
    try:
        with db.no_autoflush:
            lock_operational_inputs(db)
            assert unit.minimum_free_people == 3
            assert unit.notes == "Unrelated unsaved administrator note"
            assert unit in db.dirty
    finally:
        event.remove(db, "before_flush", refuse_flush)


@pytest.mark.parametrize("ot_enabled", [False, True])
def test_lock_preserves_pending_relationship_rows_while_refreshing_other_fields(environment, monkeypatch, ot_enabled):
    from app.core.config import settings
    monkeypatch.setattr(settings, "ot_calendar_enabled", ot_enabled)
    from app.models import UnitCallMinimum
    db, unit, _people, _target = environment
    pending = UnitCallMinimum(call_level="4TH_CALL", minimum_free_people=2)
    unit.call_minimums.append(pending)
    with Session(db.get_bind()) as editor:
        editor.get(Unit, unit.id).minimum_free_people = 3
        editor.commit()
    def refuse_flush(*args):
        pytest.fail("Input refresh flushed a pending relationship row")
    event.listen(db, "before_flush", refuse_flush)
    try:
        with db.no_autoflush:
            lock_operational_inputs(db)
            assert unit.minimum_free_people == 3
            assert pending in unit.call_minimums and pending in db.new
            assert pending.minimum_free_people == 2
    finally:
        event.remove(db, "before_flush", refuse_flush)


def test_stale_loaded_calendar_cannot_approve_manual_duty_after_another_session_edit(environment):
    db, unit, people, target = environment
    cached = db.query(OtCalendar).filter_by(unit_id=unit.id).one()
    old_revision = cached.revision
    with Session(db.get_bind()) as editor:
        current = editor.get(OtCalendar, cached.id)
        config = deepcopy(current.configuration)
        for row in config["weekly"]:
            row["bands"][0]["minimum"] = row["bands"][0]["target"] = 4
        current.configuration, current.revision = config, revision(config)
        editor.commit()
    assert cached.revision == old_revision
    with pytest.raises(RotaAssignmentError) as failure:
        assign_person_to_slot(db, slot_id=target.id, person_id=people[0].id)
    assert any(row["code"] == "ot_reservation_conflict" for row in failure.value.validation["issues"])


@pytest.mark.parametrize("change", ["published", "unlocked", "inactive_rule"])
def test_template_rechecks_authority_and_rule_dto_after_waiting_for_input_lock(environment, monkeypatch, change):
    from app.models import DutySlot, MonthlyGenerationScope, RotaPeriod, RuleSetting
    from app.services import rota_compute
    from app.services.rota_rules import PHASE_ONE_SETTING_KEY
    from app.services.rota_template import generate_empty_template, TemplateGenerationOptions
    from tests.test_ot_template import lock_scope, DAY, KEY
    db, unit, _people, target = environment
    lock_scope(db, unit)
    actual_lock = rota_compute.lock_operational_inputs
    def edit_then_lock(session):
        with Session(db.get_bind()) as editor:
            if change == "published":
                editor.get(RotaPeriod, target.rota_period_id).status = "published"
            elif change == "unlocked":
                editor.query(MonthlyGenerationScope).filter_by(rota_period_id=target.rota_period_id).one().is_locked = False
            else:
                setting = editor.query(RuleSetting).filter_by(key=PHASE_ONE_SETTING_KEY).one()
                value = deepcopy(setting.value)
                next(row for row in value["duty_rules"] if row["key"] == KEY)["active"] = False
                setting.value = value
            editor.commit()
        actual_lock(session)
    monkeypatch.setattr(rota_compute, "lock_operational_inputs", edit_then_lock)
    with pytest.raises(ValueError):
        generate_empty_template(db, "2026-11", TemplateGenerationOptions(duty_keys=[KEY], starts_on=DAY, ends_on=DAY))
    assert db.get(DutySlot, target.id) is not None


@pytest.mark.parametrize("ot_enabled", [False, True])
def test_first_use_rule_bootstrap_cannot_commit_away_input_locks(environment, monkeypatch, ot_enabled):
    from app.core.config import settings
    monkeypatch.setattr(settings, "ot_calendar_enabled", ot_enabled)
    from app.models import CallCluster, RuleSetting, RuleVersion
    from app.services.rota_rules import get_phase_one_rules, read_phase_one_rules
    db, _unit, _people, _target = environment
    db.query(RuleSetting).delete()
    db.query(RuleVersion).delete()
    db.query(CallCluster).delete()
    db.commit()
    lock_operational_inputs(db)
    transaction = db.get_transaction()
    def refuse_commit(*args):
        pytest.fail("First-use rule bootstrap released a scheduling transaction")
    event.listen(db, "before_commit", refuse_commit)
    try:
        version, rules = get_phase_one_rules(db)
        assert version.id is not None and rules.duty_rules
        assert db.get_transaction() is transaction and transaction.is_active
    finally:
        event.remove(db, "before_commit", refuse_commit)
    db.rollback()
    assert read_phase_one_rules(db) is None
    assert db.query(CallCluster).count() == 0
    # A completed protected transaction must not suppress normal later bootstrap.
    get_phase_one_rules(db)
    db.rollback()
    assert read_phase_one_rules(db) is not None


@pytest.mark.parametrize("cached", [True, False])
def test_legacy_autofill_builds_its_context_under_lock_and_retains_joint_ot_capacity(environment, cached):
    from app.models import DutyAssignment
    from app.services.rota_auto_fill import run_safe_auto_fill, AutoFillOptions
    from tests.test_ot_assignment_integration import slot
    db, unit, _people, target = environment
    slot(db, unit, target.duty_date)
    result = run_safe_auto_fill(db, "2026-11", AutoFillOptions(use_cached_context=cached))
    assert result["assigned_slots"] == 1
    assert db.query(DutyAssignment).count() == 1
