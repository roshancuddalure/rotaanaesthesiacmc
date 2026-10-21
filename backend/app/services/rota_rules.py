"""Rota generator rule model (pydantic) and persistence.

``RotaPhaseOneRules`` = per-duty ``DutyRule`` entries (timing, 24h flag, mandatory,
eligibility by call level / cluster / unit) + monthly count limits + rest rules + unit
staffing thresholds. Defaults are derived from ``app.domain.duty_types`` and merged with
the saved JSON on every read, so new duty types appear automatically.

Which settings are actually enforced (see handbook B2):
- ``duty_count_limits``          -> manual/auto assignment validation (needs override).
- ``unit_staffing_rules``        -> template allocation + slot safety.
- ``minimum_gap_after_24hr_hours`` -> candidate scoring text/penalty only.
- ``post_24hr_blocks_next_day_elective`` -> not read anywhere yet.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, Field, PrivateAttr, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.duty_types import DUTY_TYPES
from app.models import ReferenceValue, RuleSetting, RuleVersion
from app.services.call_clusters import ensure_default_call_clusters
from app.services.rota_call_levels import normalize_call_level

PHASE_ONE_SETTING_KEY = "rota_generator.phase1"
PHASE_ONE_RULE_VERSION_NAME = "Rota generator default rules"
VALID_DUTY_KEYS = {duty_type.key for duty_type in DUTY_TYPES}
VALID_DUTY_GROUPS = {duty_type.group for duty_type in DUTY_TYPES}
DEFAULT_DUTY_ORDER = {duty_type.key: index for index, duty_type in enumerate(DUTY_TYPES)}
VALID_CALL_LEVELS = {
    "1ST_CALL",
    "2ND_CALL",
    "3RD_CALL",
    "4TH_CALL",
    "CO_4TH_CALL",
    "5TH_CALL",
}

INACTIVE_PAC_DUTY_KEYS = {"PAC", "MAIN_PAC_SR", "RC_PAC_SR"}
SYNCED_DUTY_METADATA_KEYS = {"RC_3RD_CALL_A", "RC_3RD_CALL_B"}

PAC_SUBDIVISION_RULES = {
    "RC_3RD_CALL_A": {
        "allowed_call_levels": ["3RD_CALL"],
        "allowed_cluster_keys": ["3rd_call_a"],
    },
    "RC_3RD_CALL_B": {
        "allowed_call_levels": ["3RD_CALL"],
        "allowed_cluster_keys": ["3rd_call_b"],
    },
    "MAIN_PAC_PG": {
        "allowed_call_levels": ["3RD_CALL"],
        "allowed_cluster_keys": ["3rd_call_c"],
    },
    "MAIN_PAC_SR_A": {
        "allowed_call_levels": ["3RD_CALL"],
        "allowed_cluster_keys": ["3rd_call_a"],
    },
    "MAIN_PAC_SR_B": {
        "allowed_call_levels": ["3RD_CALL"],
        "allowed_cluster_keys": ["3rd_call_b"],
    },
    "MAIN_PAC_3RD": {
        "allowed_call_levels": ["3RD_CALL"],
    },
    "MAIN_PAC_SENIOR": {
        "allowed_call_levels": ["4TH_CALL"],
    },
    "RC_PAC_SR_A": {
        "allowed_call_levels": ["3RD_CALL"],
        "allowed_cluster_keys": ["3rd_call_a"],
    },
    "RC_PAC_SR_B": {
        "allowed_call_levels": ["3RD_CALL"],
        "allowed_cluster_keys": ["3rd_call_b"],
    },
    "RC_PAC_3RD": {
        "allowed_call_levels": ["3RD_CALL"],
    },
    "RC_PAC_SENIOR": {
        "allowed_call_levels": ["4TH_CALL"],
    },
}


class DutyRule(BaseModel):
    key: str
    label: str
    group: str
    campus: str | None = None
    # Range (0-48) is checked as a ``bad_hours`` problem, not by pydantic, so the Rota Rules
    # page can list every problem at once (docs/rota_rules_contract.md).
    duration_hours: int
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
    # Eligibility groups snapshot attached by ``get_phase_one_rules`` (not serialised); lets
    # ``rota_eligibility.effective_call_levels(rule)`` add each active group's call level.
    _groups: dict | None = PrivateAttr(default=None)

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
    # Hard block below warning is reported as a ``guardrail`` warning (never blocks a save).


class RotaPhaseOneRules(BaseModel):
    duty_rules: list[DutyRule]
    duty_count_limits: DutyCountLimits = Field(default_factory=DutyCountLimits)
    rest_rules: RestRules = Field(default_factory=RestRules)
    unit_staffing_rules: UnitStaffingRules = Field(default_factory=UnitStaffingRules)
    notes: str | None = None
    _groups: dict | None = PrivateAttr(default=None)

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
    rule = DutyRule(
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
    if duty_type.key in INACTIVE_PAC_DUTY_KEYS:
        rule.active = False
        rule.is_mandatory = False
        rule.is_adjustable = True
    if duty_type.key in PAC_SUBDIVISION_RULES:
        pac_rule = PAC_SUBDIVISION_RULES[duty_type.key]
        rule.allowed_call_levels = list(pac_rule.get("allowed_call_levels", []))
        rule.allowed_cluster_keys = list(pac_rule.get("allowed_cluster_keys", []))
        rule.is_mandatory = False
        rule.is_adjustable = True
    return rule


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


class RotaRulesInvalid(ValueError):
    """Error-severity problems found by ``rota_rules_admin.rule_problems``."""

    def __init__(self, problems: list[dict[str, Any]]):
        self.problems = problems
        errors = [p["message"] for p in problems if p["severity"] == "error"]
        super().__init__("; ".join(errors) or "Rules are not valid")


def attach_groups(rules: RotaPhaseOneRules, groups: dict | None = None, db: Session | None = None) -> RotaPhaseOneRules:
    """Attach the eligibility groups snapshot to the rule set and every duty rule."""
    if groups is None:
        from app.services.rota_eligibility import load_groups_by_key

        groups = load_groups_by_key(db) if db is not None else {}
    rules._groups = groups
    for rule in rules.duty_rules:
        rule._groups = groups
    return rules


def get_phase_one_rules(db: Session) -> tuple[RuleVersion, RotaPhaseOneRules]:
    """Load the saved rules merged with current defaults (new duty types are appended, legacy
    PAC keys forced inactive). Creates the rule version, default rules and default clusters on
    first call, so this "read" can write to the database."""
    ensure_default_call_clusters(db)
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
    else:
        rules = RotaPhaseOneRules.model_validate(setting.value)
    default_rules = default_phase_one_rules()
    default_rules_by_key = default_rules.duty_rules_by_key
    existing_keys = {rule.key for rule in rules.duty_rules}
    missing_rules = [rule for rule in default_rules.duty_rules if rule.key not in existing_keys]
    if missing_rules:
        rules.duty_rules.extend(missing_rules)
    registered = list(db.scalars(select(ReferenceValue).where(ReferenceValue.kind == "duty_type")))
    for value in registered:
        configured = DutyRule.model_validate(
            {**value.behavior, "key": value.key, "label": value.label, "active": value.active}
        )
        rules.duty_rules = [r for r in rules.duty_rules if r.key != value.key]
        rules.duty_rules.append(configured)
    for rule in rules.duty_rules:
        if rule.key in INACTIVE_PAC_DUTY_KEYS:
            rule.active = False
        if rule.key in SYNCED_DUTY_METADATA_KEYS and rule.key in default_rules_by_key:
            default_rule = default_rules_by_key[rule.key]
            rule.label = default_rule.label
            rule.group = default_rule.group
    rules.duty_rules.sort(
        key=lambda rule: DEFAULT_DUTY_ORDER.get(rule.key, len(DEFAULT_DUTY_ORDER))
    )
    attach_groups(rules, db=db)
    return rule_version, rules


def save_phase_one_rules(
    db: Session, rules: RotaPhaseOneRules
) -> tuple[RuleVersion, RotaPhaseOneRules]:
    """Validate and overwrite the single rule setting in place. Version history is kept by
    ``rota_rules_admin.save_rules_with_history`` (the API path)."""
    ensure_default_call_clusters(db)
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
    registered = {
        r.key: r
        for r in db.scalars(select(ReferenceValue).where(ReferenceValue.kind == "duty_type"))
    }
    for rule in rules.duty_rules:
        if rule.key in registered:
            value = registered[rule.key]
            value.behavior, value.label, value.active = (
                rule.model_dump(mode="json"),
                rule.label,
                rule.active,
            )
            value.version += 1
    db.commit()
    db.refresh(rule_version)
    attach_groups(rules, db=db)
    return rule_version, rules


def validate_phase_one_rules(db: Session, rules: RotaPhaseOneRules) -> None:
    """Raise ``RotaRulesInvalid`` listing every error-severity problem; normalise call levels.

    Warnings (inactive/empty groups, nobody eligible, duplicate labels, guardrails) never
    block. See ``rota_rules_admin.rule_problems`` for the codes."""
    from app.services.rota_rules_admin import rule_problems

    problems = rule_problems(db, rules)
    if any(problem["severity"] == "error" for problem in problems):
        raise RotaRulesInvalid(problems)
    for rule in rules.duty_rules:
        rule.allowed_call_levels = [normalize_call_level(item) for item in rule.allowed_call_levels]
