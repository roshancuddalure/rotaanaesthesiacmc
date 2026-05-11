from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.duty_types import DUTY_TYPES
from app.models import CallCluster, RuleSetting, RuleVersion
from app.services.rota_call_levels import normalize_call_level

PHASE_ONE_SETTING_KEY = "rota_generator.phase1"
PHASE_ONE_RULE_VERSION_NAME = "Rota generator default rules"
VALID_DUTY_KEYS = {duty_type.key for duty_type in DUTY_TYPES}
VALID_DUTY_GROUPS = {duty_type.group for duty_type in DUTY_TYPES}
VALID_CALL_LEVELS = {
    "1ST_CALL",
    "2ND_CALL",
    "3RD_CALL",
    "4TH_CALL",
    "CO_4TH_CALL",
    "5TH_CALL",
}


class DutyRule(BaseModel):
    key: str
    label: str
    group: str
    campus: str | None = None
    duration_hours: int = Field(ge=0, le=48)
    start_time: str = "08:00"
    end_time: str = "08:00"
    is_24hr: bool = False
    counts_in_main_24hr: bool = False
    is_mandatory: bool = True
    is_adjustable: bool = False
    blocks_elective_same_day: bool = True
    blocks_elective_next_day: bool = False
    active: bool = True
    allowed_call_levels: list[str] = Field(default_factory=list)
    allowed_cluster_keys: list[str] = Field(default_factory=list)
    excluded_cluster_keys: list[str] = Field(default_factory=list)
    allowed_designations: list[str] = Field(default_factory=list)
    allowed_units: list[str] = Field(default_factory=list)
    excluded_units: list[str] = Field(default_factory=list)

    @field_validator("key", "label", "group", "start_time", "end_time")
    @classmethod
    def required_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Value is required")
        return cleaned


class DutyCountLimits(BaseModel):
    max_24hr_per_month: int | None = Field(default=None, ge=0)
    max_weekend_24hr_per_month: int | None = Field(default=None, ge=0)
    max_same_group_per_month: int | None = Field(default=None, ge=0)
    max_same_campus_per_month: int | None = Field(default=None, ge=0)


class RestRules(BaseModel):
    minimum_gap_after_24hr_hours: int = Field(default=24, ge=0, le=168)
    post_24hr_blocks_next_day_elective: bool = True


class UnitStaffingRules(BaseModel):
    minimum_available_count: int = Field(default=1, ge=0)
    warning_unavailable_percent: int = Field(default=30, ge=0, le=100)
    hard_block_unavailable_percent: int = Field(default=40, ge=0, le=100)
    small_unit_uses_absolute_minimum: bool = True

    @model_validator(mode="after")
    def validate_threshold_order(self) -> "UnitStaffingRules":
        if self.hard_block_unavailable_percent < self.warning_unavailable_percent:
            raise ValueError("Hard block threshold cannot be below warning threshold")
        return self


class RotaPhaseOneRules(BaseModel):
    duty_rules: list[DutyRule]
    duty_count_limits: DutyCountLimits = Field(default_factory=DutyCountLimits)
    rest_rules: RestRules = Field(default_factory=RestRules)
    unit_staffing_rules: UnitStaffingRules = Field(default_factory=UnitStaffingRules)
    notes: str | None = None

    @property
    def duty_rules_by_key(self) -> dict[str, DutyRule]:
        return {item.key: item for item in self.duty_rules}

    @model_validator(mode="after")
    def validate_unique_duty_keys(self) -> "RotaPhaseOneRules":
        keys = [item.key for item in self.duty_rules]
        if len(keys) != len(set(keys)):
            raise ValueError("Duty rule keys must be unique")
        return self


def _default_duration_hours(is_24hr: bool, key: str) -> int:
    if is_24hr:
        return 24
    if "12HR" in key or key == "CAESAR_A_12HR":
        return 12
    return 0


def _default_duty_rule(duty_type: Any) -> DutyRule:
    is_24hr = bool(duty_type.is_24hr)
    return DutyRule(
        key=duty_type.key,
        label=duty_type.label,
        group=duty_type.group,
        duration_hours=_default_duration_hours(is_24hr, duty_type.key),
        is_24hr=is_24hr,
        counts_in_main_24hr=bool(duty_type.counts_in_main_24hr),
        is_mandatory=is_24hr,
        is_adjustable=not is_24hr,
        blocks_elective_same_day=is_24hr or duty_type.group in {"pac", "shift", "caesar"},
        blocks_elective_next_day=is_24hr,
    )


def default_phase_one_rules() -> RotaPhaseOneRules:
    return RotaPhaseOneRules(
        duty_rules=[_default_duty_rule(duty_type) for duty_type in DUTY_TYPES],
        duty_count_limits=DutyCountLimits(),
        rest_rules=RestRules(),
        unit_staffing_rules=UnitStaffingRules(),
        notes="Default Phase 1 rota generator rules. Confirm limits with the rota board before generation.",
    )


def get_or_create_phase_one_rule_version(db: Session) -> RuleVersion:
    rule_version = db.scalar(
        select(RuleVersion).where(RuleVersion.name == PHASE_ONE_RULE_VERSION_NAME)
    )
    if rule_version is not None:
        return rule_version
    rule_version = RuleVersion(
        name=PHASE_ONE_RULE_VERSION_NAME,
        description="Versioned default rules for rota generator Phase 1.",
        effective_from=date.today().replace(day=1),
        is_active=True,
    )
    db.add(rule_version)
    db.commit()
    db.refresh(rule_version)
    return rule_version


def get_phase_one_rules(db: Session) -> tuple[RuleVersion, RotaPhaseOneRules]:
    rule_version = get_or_create_phase_one_rule_version(db)
    setting = db.scalar(
        select(RuleSetting).where(
            RuleSetting.rule_version_id == rule_version.id,
            RuleSetting.key == PHASE_ONE_SETTING_KEY,
        )
    )
    if setting is None:
        rules = default_phase_one_rules()
        setting = RuleSetting(
            rule_version=rule_version,
            key=PHASE_ONE_SETTING_KEY,
            value=rules.model_dump(mode="json"),
            value_type="json",
            description="Rota generator Phase 1 duty dictionary and guardrail defaults.",
        )
        db.add(setting)
        db.commit()
        return rule_version, rules
    rules = RotaPhaseOneRules.model_validate(setting.value)
    default_rules = default_phase_one_rules()
    existing_keys = {rule.key for rule in rules.duty_rules}
    missing_rules = [rule for rule in default_rules.duty_rules if rule.key not in existing_keys]
    if missing_rules:
        rules.duty_rules.extend(missing_rules)
    return rule_version, rules


def save_phase_one_rules(db: Session, rules: RotaPhaseOneRules) -> tuple[RuleVersion, RotaPhaseOneRules]:
    validate_phase_one_rules(db, rules)
    rule_version = get_or_create_phase_one_rule_version(db)
    setting = db.scalar(
        select(RuleSetting).where(
            RuleSetting.rule_version_id == rule_version.id,
            RuleSetting.key == PHASE_ONE_SETTING_KEY,
        )
    )
    if setting is None:
        setting = RuleSetting(
            rule_version=rule_version,
            key=PHASE_ONE_SETTING_KEY,
            value={},
            value_type="json",
            description="Rota generator Phase 1 duty dictionary and guardrail defaults.",
        )
        db.add(setting)
    setting.value = rules.model_dump(mode="json")
    db.commit()
    db.refresh(rule_version)
    return rule_version, rules


def validate_phase_one_rules(db: Session, rules: RotaPhaseOneRules) -> None:
    cluster_keys = set(db.scalars(select(CallCluster.key)))
    for rule in rules.duty_rules:
        if rule.key not in VALID_DUTY_KEYS:
            raise ValueError(f"Unknown duty rule: {rule.key}")
        if rule.group not in VALID_DUTY_GROUPS:
            raise ValueError(f"Unknown duty group for {rule.label}: {rule.group}")

        normalized_call_levels = [normalize_call_level(item) for item in rule.allowed_call_levels]
        invalid_call_levels = sorted({item for item in normalized_call_levels if item not in VALID_CALL_LEVELS})
        if invalid_call_levels:
            raise ValueError(f"Unknown allowed call level for {rule.label}: {', '.join(invalid_call_levels)}")
        rule.allowed_call_levels = normalized_call_levels

        for field_name, values in (
            ("allowed eligibility group", rule.allowed_cluster_keys),
            ("excluded eligibility group", rule.excluded_cluster_keys),
        ):
            unknown_keys = sorted({value for value in values if value not in cluster_keys})
            if unknown_keys:
                raise ValueError(f"Unknown {field_name} for {rule.label}: {', '.join(unknown_keys)}")
