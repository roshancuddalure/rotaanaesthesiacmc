from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import models  # noqa: F401
from app.db.session import Base
from app.domain.duty_types import DUTY_TYPES
from app.models import RuleSetting
from app.services.rota_rules import (
    PHASE_ONE_SETTING_KEY,
    RotaPhaseOneRules,
    default_phase_one_rules,
    get_phase_one_rules,
    save_phase_one_rules,
)


def test_phase_one_defaults_cover_duty_dictionary() -> None:
    rules = default_phase_one_rules()
    duty_keys = {item.key for item in rules.duty_rules}

    assert duty_keys == {item.key for item in DUTY_TYPES}
    assert rules.rest_rules.minimum_gap_after_24hr_hours == 24
    assert rules.unit_staffing_rules.warning_unavailable_percent == 30
    assert rules.unit_staffing_rules.hard_block_unavailable_percent == 40
    assert rules.duty_rules_by_key["MAIN_1ST_24HR"].is_mandatory is True
    assert rules.duty_rules_by_key["PAC"].is_adjustable is True


def test_phase_one_rules_persist_as_rule_setting() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        rule_version, rules = get_phase_one_rules(session)
        rules.rest_rules.minimum_gap_after_24hr_hours = 36
        rules.unit_staffing_rules.warning_unavailable_percent = 25
        saved_version, saved_rules = save_phase_one_rules(session, rules)

        assert saved_version.id == rule_version.id
        assert saved_rules.rest_rules.minimum_gap_after_24hr_hours == 36

    with Session(engine) as session:
        _, loaded_rules = get_phase_one_rules(session)

        assert loaded_rules.rest_rules.minimum_gap_after_24hr_hours == 36
        assert loaded_rules.unit_staffing_rules.warning_unavailable_percent == 25


def test_phase_one_rules_merge_new_duty_types_into_existing_settings() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        rule_version, rules = get_phase_one_rules(session)
        rules.duty_rules = [rule for rule in rules.duty_rules if rule.key not in {"MAIN_SHIFT", "RC_SHIFT", "PB_SHIFT"}]
        setting = session.query(RuleSetting).filter_by(
            rule_version_id=rule_version.id,
            key=PHASE_ONE_SETTING_KEY,
        ).one()
        setting.value = rules.model_dump(mode="json")
        session.commit()

        _, loaded_rules = get_phase_one_rules(session)

        loaded_keys = {rule.key for rule in loaded_rules.duty_rules}
        assert {"MAIN_SHIFT", "RC_SHIFT", "PB_SHIFT"}.issubset(loaded_keys)


def test_phase_one_rules_reject_duplicate_duty_keys() -> None:
    rules = default_phase_one_rules()
    payload = rules.model_dump(mode="json")
    payload["duty_rules"].append(payload["duty_rules"][0])

    try:
        RotaPhaseOneRules.model_validate(payload)
    except ValueError as exc:
        assert "Duty rule keys must be unique" in str(exc)
    else:
        raise AssertionError("Duplicate duty keys should fail validation")
