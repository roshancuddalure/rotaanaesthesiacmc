"""Rota Rules page support: checks, revision, groups summary, version history and the
eligibility-gaps diagnostic (docs/rota_rules_contract.md).

Eligibility itself lives in ``rota_eligibility``; this module only counts with it.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    CallCluster,
    Person,
    PersonCallClusterMembership,
    ReferenceValue,
    RotaRuleVersion,
)
from app.services.leave import date_range, month_bounds
from app.services.member_profiles import local_today
from app.services.rota_call_levels import normalize_call_level
from app.services.rota_eligibility import (
    GroupInfo,
    _sort_levels,
    describe_levels,
    effective_call_levels,
    eligibility,
    group_info,
    member_call_level,
)
from app.services.rota_rules import (
    VALID_CALL_LEVELS,
    VALID_DUTY_GROUPS,
    VALID_DUTY_KEYS,
    RotaPhaseOneRules,
    RotaRulesInvalid,
    get_phase_one_rules,
    save_phase_one_rules,
)

BEFORE_HISTORY_NOTE = "Before history"
MAX_VERSIONS_LISTED = 100
MAX_DUTY_HOURS = 48


class StaleRules(Exception):
    def __init__(self, current_revision: str):
        self.current_revision = current_revision
        super().__init__("The rules were changed by someone else. Reload and try again.")


# --------------------------------------------------------------------------- revision


def rules_payload(rules: RotaPhaseOneRules) -> dict[str, Any]:
    return rules.model_dump(mode="json")


def rules_revision(rules: RotaPhaseOneRules | dict[str, Any]) -> str:
    payload = rules if isinstance(rules, dict) else rules_payload(rules)
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def current_revision(db: Session) -> str:
    _version, rules = get_phase_one_rules(db)
    return rules_revision(rules)


# --------------------------------------------------------------------------- members today


@dataclass
class MemberSnapshot:
    """One active member on one day: precomputed call level and active group keys."""

    person: Any
    posting_type: str
    day: date
    resolved_call_level: str
    group_keys: set[str]
    unit_id: Any = None


def _active_people(db: Session) -> list[Person]:
    return list(
        db.scalars(
            select(Person)
            .where(Person.active_status == "active")
            .options(
                selectinload(Person.call_level_changes),
                selectinload(Person.call_cluster_memberships).selectinload(
                    PersonCallClusterMembership.cluster
                ),
            )
        )
    )


def _membership_keys(person: Person, day: date, active_only: bool = True) -> set[str]:
    return {
        m.cluster.key
        for m in person.call_cluster_memberships
        if (m.cluster.active or not active_only)
        and m.effective_from <= day
        and (m.effective_to is None or m.effective_to >= day)
    }


def member_snapshots(people: list[Person], day: date) -> list[MemberSnapshot]:
    snapshots = []
    for person in people:
        context = SimpleNamespace(person=person, posting_type="", day=day)
        snapshots.append(
            MemberSnapshot(
                person=person,
                posting_type="",
                day=day,
                resolved_call_level=member_call_level(context),
                group_keys=_membership_keys(person, day),
            )
        )
    return snapshots


def _probe_slot(rule: Any, day: date) -> SimpleNamespace:
    return SimpleNamespace(call_level=None, duty_date=day, duty_type=rule.key)


def groups_by_key(db: Session) -> dict[str, GroupInfo]:
    return {cluster.key: group_info(cluster) for cluster in db.scalars(select(CallCluster))}


def group_summaries(db: Session, day: date | None = None) -> list[dict[str, Any]]:
    """``[{key, name, call_level, active, members}]``; members = memberships in force on
    ``day`` (today) held by active members."""
    day = day or local_today()
    clusters = list(
        db.scalars(
            select(CallCluster)
            .options(selectinload(CallCluster.memberships).selectinload(PersonCallClusterMembership.person))
            .order_by(CallCluster.call_level, CallCluster.name)
        )
    )
    rows = []
    for cluster in clusters:
        people = {
            m.person_id
            for m in cluster.memberships
            if m.effective_from <= day
            and (m.effective_to is None or m.effective_to >= day)
            and m.person is not None
            and m.person.active_status == "active"
        }
        rows.append(
            {
                "key": cluster.key,
                "name": cluster.name,
                "call_level": normalize_call_level(cluster.call_level),
                "active": bool(cluster.active),
                "members": len(people),
            }
        )
    return rows


# --------------------------------------------------------------------------- checks


def duty_eligibility(
    rules: RotaPhaseOneRules, groups: dict[str, GroupInfo], members: list[MemberSnapshot], day: date
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for rule in rules.duty_rules:
        levels = effective_call_levels(rule, groups)
        by_level: Counter[str] = Counter({level: 0 for level in levels})
        slot = _probe_slot(rule, day)
        count = 0
        for member in members:
            if eligibility(member, slot, rule, groups, member.group_keys).eligible:
                count += 1
                by_level[member.resolved_call_level] += 1
        result[rule.key] = {
            "effective_call_levels": _sort_levels(levels),
            "eligible_now": count,
            "eligible_by_level": dict(by_level),
        }
    return result


def _problem(duty_key, field, code, severity, message, fix) -> dict[str, Any]:
    return {
        "duty_key": duty_key,
        "field": field,
        "code": code,
        "severity": severity,
        "message": message,
        "fix": fix,
    }


def rule_problems(
    db: Session,
    rules: RotaPhaseOneRules,
    *,
    groups: dict[str, GroupInfo] | None = None,
    duties: dict[str, dict[str, Any]] | None = None,
    group_rows: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Every problem in ``rules`` (errors block a save, warnings never do)."""
    groups = groups if groups is not None else groups_by_key(db)
    if duties is None:
        today = local_today()
        duties = duty_eligibility(rules, groups, member_snapshots(_active_people(db), today), today)
    group_rows = group_rows if group_rows is not None else group_summaries(db)
    members_by_group = {row["key"]: row["members"] for row in group_rows}
    registered_keys = set(
        db.scalars(select(ReferenceValue.key).where(ReferenceValue.kind == "duty_type"))
    )
    problems: list[dict[str, Any]] = []
    for rule in rules.duty_rules:
        label = rule.label
        if rule.key not in VALID_DUTY_KEYS | registered_keys:
            problems.append(_problem(rule.key, "key", "unknown_duty", "error",
                                     f"Unknown duty rule: {rule.key}",
                                     "Remove this duty; it is not in the duty dictionary."))
        if rule.group not in VALID_DUTY_GROUPS:
            problems.append(_problem(rule.key, "group", "bad_group", "error",
                                     f"Unknown duty group for {label}: {rule.group}",
                                     f"Choose one of: {', '.join(sorted(VALID_DUTY_GROUPS))}."))
        if rule.duration_hours < 0 or rule.duration_hours > MAX_DUTY_HOURS:
            problems.append(_problem(rule.key, "duration_hours", "bad_hours", "error",
                                     f"Hours for {label} must be between 0 and {MAX_DUTY_HOURS} (got {rule.duration_hours}).",
                                     f"Enter hours from 0 to {MAX_DUTY_HOURS}."))
        unknown_levels = sorted({
            item for item in rule.allowed_call_levels if normalize_call_level(item) not in VALID_CALL_LEVELS
        })
        if unknown_levels:
            problems.append(_problem(rule.key, "allowed_call_levels", "unknown_call_level", "error",
                                     f"Unknown allowed call level for {label}: {', '.join(unknown_levels)}",
                                     "Remove it and pick a call level from the list."))
        for field, values, word in (
            ("allowed_cluster_keys", rule.allowed_cluster_keys, "allowed"),
            ("excluded_cluster_keys", rule.excluded_cluster_keys, "excluded"),
        ):
            unknown = sorted({key for key in values if key not in groups})
            if unknown:
                problems.append(_problem(rule.key, field, "unknown_group", "error",
                                         f"Unknown {word} eligibility group for {label}: {', '.join(unknown)}",
                                         "Remove it; that group no longer exists."))
        both = sorted(set(rule.allowed_cluster_keys) & set(rule.excluded_cluster_keys))
        if both:
            names = ", ".join(groups[key].name if key in groups else key for key in both)
            problems.append(_problem(rule.key, "excluded_cluster_keys", "allowed_and_excluded", "error",
                                     f"{label}: {names} is both allowed and excluded, so nobody in it can do the duty.",
                                     "Remove the group from either Groups allowed or Groups excluded."))
        if not rule.active:
            continue
        for key in rule.allowed_cluster_keys:
            group = groups.get(key)
            if group is None or key in both:
                continue
            if not group.active:
                problems.append(_problem(rule.key, "allowed_cluster_keys", "inactive_group", "warning",
                                         f"{label}: group {group.name} is inactive; its members are not eligible.",
                                         "Activate the group on the Eligibility groups page, or remove it here."))
            elif members_by_group.get(key, 0) == 0:
                problems.append(_problem(rule.key, "allowed_cluster_keys", "empty_group", "warning",
                                         f"{label}: group {group.name} has no members today.",
                                         "Add members to the group, or remove it here."))
        info = duties.get(rule.key)
        if info is not None and info["eligible_now"] == 0:
            levels = info["effective_call_levels"]
            problems.append(_problem(rule.key, "allowed_cluster_keys" if rule.allowed_cluster_keys else "allowed_call_levels",
                                     "nobody_eligible", "warning",
                                     f"Nobody active is eligible for {label}"
                                     + (f" (needs {describe_levels(levels)})." if levels else "."),
                                     "Check the call levels and groups for this duty."))
    labels: dict[str, list[Any]] = {}
    for rule in rules.duty_rules:
        labels.setdefault(rule.label.strip().lower(), []).append(rule)
    for same in labels.values():
        if len(same) < 2:
            continue
        for rule in same:
            others = ", ".join(other.key for other in same if other is not rule)
            problems.append(_problem(rule.key, "label", "label_duplicate", "warning",
                                     f"Label \"{rule.label}\" is also used by {others}.",
                                     "Give each duty its own label so reports stay clear."))
    staffing = rules.unit_staffing_rules
    if staffing.hard_block_unavailable_percent < staffing.warning_unavailable_percent:
        problems.append(_problem(None, "unit_staffing_rules.hard_block_unavailable_percent", "guardrail", "warning",
                                 f"Hard block unavailable % ({staffing.hard_block_unavailable_percent}) is below the "
                                 f"warning % ({staffing.warning_unavailable_percent}), so the warning never shows.",
                                 "Set the hard block % at or above the warning %."))
    return problems


def check_rules(db: Session, rules: RotaPhaseOneRules) -> dict[str, Any]:
    today = local_today()
    groups = groups_by_key(db)
    duties = duty_eligibility(rules, groups, member_snapshots(_active_people(db), today), today)
    problems = rule_problems(db, rules, groups=groups, duties=duties)
    return {"problems": problems, "duties": duties}


# --------------------------------------------------------------------------- history


def _user_name(user: Any) -> str | None:
    if user is None:
        return None
    return getattr(user, "display_name", None) or getattr(user, "username", None)


def _changed_duties(before: dict[str, Any] | None, after: dict[str, Any]) -> list[str]:
    if before is None:
        return []
    old = {rule["key"]: rule for rule in before.get("duty_rules", [])}
    new = {rule["key"]: rule for rule in after.get("duty_rules", [])}
    labels = []
    for key, rule in new.items():
        if old.get(key) != rule:
            labels.append(rule.get("label") or key)
    labels.extend(rule.get("label") or key for key, rule in old.items() if key not in new)
    return labels


def _next_saved_at(db: Session) -> datetime:
    now = datetime.utcnow()
    latest = db.scalar(select(RotaRuleVersion.saved_at).order_by(RotaRuleVersion.saved_at.desc()).limit(1))
    if latest is not None and latest >= now:
        now = latest + timedelta(microseconds=1)
    return now


def save_rules_with_history(
    db: Session,
    rules: RotaPhaseOneRules,
    *,
    user: Any = None,
    base_revision: str | None = None,
    note: str | None = None,
):
    """Stale check -> validate (all problems) -> save -> store a version.

    Raises ``StaleRules`` or ``RotaRulesInvalid``. Returns ``(rule_version, rules)`` as
    re-read after the save (the GET shape)."""
    _version, before = get_phase_one_rules(db)
    before_payload = rules_payload(before)
    before_revision = rules_revision(before_payload)
    if base_revision is not None and base_revision != before_revision:
        raise StaleRules(before_revision)
    has_history = db.scalar(select(RotaRuleVersion.id).limit(1)) is not None
    save_phase_one_rules(db, rules)  # raises RotaRulesInvalid (a ValueError)
    rule_version, saved = get_phase_one_rules(db)
    saved_payload = rules_payload(saved)
    if not has_history:
        db.add(
            RotaRuleVersion(
                revision=before_revision,
                rules=before_payload,
                saved_by_id=None,
                saved_by_name=None,
                saved_at=_next_saved_at(db),
                changed_duties=[],
                note=BEFORE_HISTORY_NOTE,
            )
        )
        db.flush()
    db.add(
        RotaRuleVersion(
            revision=rules_revision(saved_payload),
            rules=saved_payload,
            saved_by_id=getattr(user, "id", None),
            saved_by_name=_user_name(user),
            saved_at=_next_saved_at(db),
            changed_duties=_changed_duties(before_payload, saved_payload),
            note=note,
        )
    )
    db.commit()
    return rule_version, saved


def version_summary(version: RotaRuleVersion) -> dict[str, Any]:
    return {
        "version_id": str(version.id),
        "saved_at": version.saved_at.isoformat(),
        "saved_by": version.saved_by_name,
        "revision": version.revision,
        "changed_duties": list(version.changed_duties or []),
        "note": version.note,
    }


def list_versions(db: Session, limit: int = MAX_VERSIONS_LISTED) -> list[dict[str, Any]]:
    versions = db.scalars(
        select(RotaRuleVersion).order_by(RotaRuleVersion.saved_at.desc()).limit(limit)
    )
    return [version_summary(version) for version in versions]


def get_version(db: Session, version_id: UUID) -> RotaRuleVersion | None:
    return db.get(RotaRuleVersion, version_id)


def version_detail(version: RotaRuleVersion) -> dict[str, Any]:
    return {
        "version_id": str(version.id),
        "saved_at": version.saved_at.isoformat(),
        "saved_by": version.saved_by_name,
        "rules": version.rules,
    }


def restore_version(db: Session, version: RotaRuleVersion, *, user: Any, base_revision: str | None):
    rules = RotaPhaseOneRules.model_validate(version.rules)
    when = version.saved_at.strftime("%d %b %Y %H:%M")
    return save_rules_with_history(
        db,
        rules,
        user=user,
        base_revision=base_revision,
        note=f"Restored the version saved {when}",
    )


# --------------------------------------------------------------------------- gaps


def eligibility_gaps(db: Session, month: str) -> list[dict[str, Any]]:
    """Active duties for which nobody active is eligible on any day of ``month``."""
    starts_on, ends_on = month_bounds(month)
    _version, rules = get_phase_one_rules(db)
    groups = groups_by_key(db)
    people = _active_people(db)
    days = list(date_range(starts_on, ends_on))
    snapshots_by_day = {day: member_snapshots(people, day) for day in days}
    gaps = []
    for rule in rules.duty_rules:
        if not rule.active:
            continue
        reasons: Counter[str] = Counter()
        level_match = False
        found = False
        levels = effective_call_levels(rule, groups)
        for day in days:
            slot = _probe_slot(rule, day)
            for member in snapshots_by_day[day]:
                decision = eligibility(member, slot, rule, groups, member.group_keys)
                if decision.eligible:
                    found = True
                    break
                if decision.code != "call_level":
                    level_match = True
                    reasons[decision.reason or ""] += 1
            if found:
                break
        if found:
            continue
        if not people:
            reason = "There are no active members."
        elif not level_match:
            reason = f"Nobody active is listed as {describe_levels(levels)}."
        else:
            reason = reasons.most_common(1)[0][0] or "Nobody passes the eligibility rules."
        gaps.append({"duty_key": rule.key, "label": rule.label, "reason": reason})
    return gaps

