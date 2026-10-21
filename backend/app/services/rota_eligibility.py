"""Who may do a duty: the single eligibility function (docs/rota_rules_contract.md).

Every path that decides whether a member can take a slot (slot safety, manual assignment
validation, candidates, auto-fill, the optimizer, compute and the Rota Rules checks) calls
``eligibility`` here. Do not copy this logic elsewhere.

Order of checks:
1. Call level: the slot's own ``call_level`` (a manual override or an old stamped slot) when
   set, otherwise the duty's ``effective_call_levels``.
2. Allowed groups: if the rule names any, the member must belong (on the slot date) to at
   least one *active* allowed group.
3. Excluded groups: the member must not belong to an excluded group.

``effective_call_levels`` is the union of the rule's call levels (or the levels inferred
from the duty key when it lists none) and the parent call level of every active allowed
group ("groups define the pool", owner decision 21 Oct 2026).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session, object_session

from app.services.member_profiles import call_level_on
from app.services.rota_call_levels import inferred_call_levels_from_duty_type, normalize_call_level

CALL_LEVEL_WORDS = {
    "1ST_CALL": "1st",
    "2ND_CALL": "2nd",
    "3RD_CALL": "3rd",
    "4TH_CALL": "4th",
    "CO_4TH_CALL": "co-4th",
    "5TH_CALL": "5th",
}
CALL_LEVEL_ORDER = ["1ST_CALL", "2ND_CALL", "3RD_CALL", "4TH_CALL", "CO_4TH_CALL", "5TH_CALL"]

# Decision codes (extension of the contract's Decision{eligible, reason}).
CODE_CALL_LEVEL = "call_level"
CODE_NOT_IN_GROUP = "not_in_group"
CODE_EXCLUDED_GROUP = "excluded_group"


@dataclass(frozen=True)
class GroupInfo:
    """Snapshot of an eligibility group (call cluster), detached from the session."""

    key: str
    name: str
    call_level: str
    active: bool


@dataclass(frozen=True)
class Decision:
    eligible: bool
    reason: str | None = None
    code: str | None = None


def group_info(cluster: Any) -> GroupInfo:
    return GroupInfo(
        key=cluster.key,
        name=cluster.name,
        call_level=normalize_call_level(cluster.call_level),
        active=bool(cluster.active),
    )


def load_groups_by_key(db: Session) -> dict[str, GroupInfo]:
    from app.models import CallCluster

    return {cluster.key: group_info(cluster) for cluster in db.scalars(select(CallCluster))}


def attached_groups(rule: Any) -> Mapping[str, GroupInfo] | None:
    """Groups attached to a rule (or rules set) by ``get_phase_one_rules``."""
    if rule is None:
        return None
    private = getattr(rule, "__pydantic_private__", None) or {}
    return private.get("_groups")


def _sort_levels(levels: Iterable[str]) -> list[str]:
    return sorted(levels, key=lambda level: (CALL_LEVEL_ORDER.index(level) if level in CALL_LEVEL_ORDER else 99, level))


def rule_call_levels(rule: Any) -> set[str]:
    """The rule's own call levels, or those inferred from the duty key when it lists none."""
    levels = {
        normalized
        for item in (rule.allowed_call_levels or [])
        if (normalized := normalize_call_level(item)) != "Unassigned"
    }
    return levels or inferred_call_levels_from_duty_type(rule.key)


def effective_call_levels(rule: Any, groups_by_key: Mapping[str, Any] | None = None) -> set[str]:
    """Rule call levels (or key-inferred) plus each active allowed group's parent level."""
    if rule is None:
        return set()
    groups = groups_by_key if groups_by_key is not None else (attached_groups(rule) or {})
    levels = set(rule_call_levels(rule))
    for key in rule.allowed_cluster_keys or []:
        group = groups.get(key)
        if group is not None and group.active:
            level = normalize_call_level(group.call_level)
            if level != "Unassigned":
                levels.add(level)
    return levels


def required_call_levels_for(slot: Any, rule: Any, groups_by_key: Mapping[str, Any] | None = None) -> set[str]:
    """Levels a member needs for ``slot``: the slot's own level, else the effective levels."""
    if slot is not None and getattr(slot, "call_level", None):
        normalized = normalize_call_level(slot.call_level)
        if normalized != "Unassigned":
            return {normalized}
    if rule is not None:
        return effective_call_levels(rule, groups_by_key)
    return inferred_call_levels_from_duty_type(getattr(slot, "duty_type", None))


def member_call_level(member: Any) -> str:
    """Normalised call level of a member context (person, posting_type, day)."""
    resolved = getattr(member, "resolved_call_level", None)
    if resolved:
        return resolved  # precomputed by bulk callers (Rota Rules checks)
    day = member.day or date.today()
    person = member.person
    has_timeline = any(c.effective_from <= day for c in person.call_level_changes) or any(
        c.effective_from <= day and not c.source.startswith("merged:") for c in person.call_changes
    )
    return normalize_call_level(
        call_level_on(person, day)
        if has_timeline
        else member.posting_type or call_level_on(person, day)
    )


def active_group_keys_on(person: Any, day: date, db: Session | None = None) -> set[str]:
    """Keys of the active groups ``person`` belongs to on ``day``.

    Uses the loaded ``call_cluster_memberships`` relationship when available (preloaded by
    the month loaders), otherwise one query.
    """
    try:
        unloaded = inspect(person).unloaded
    except Exception:  # noqa: BLE001 - plain objects in tests
        unloaded = set()
    if "call_cluster_memberships" not in unloaded:
        return {
            m.cluster.key
            for m in person.call_cluster_memberships
            if m.cluster.active
            and m.effective_from <= day
            and (m.effective_to is None or m.effective_to >= day)
        }
    db = db or object_session(person)
    if db is None:
        return set()
    from app.services.call_clusters import active_cluster_keys_for_person

    return active_cluster_keys_for_person(db, person.id, day)


def describe_levels(levels: Iterable[str]) -> str:
    words = [CALL_LEVEL_WORDS.get(level, level) for level in _sort_levels(levels)]
    if not words:
        return ""
    if len(words) == 1:
        return f"{words[0]} call"
    return f"{', '.join(words[:-1])} or {words[-1]} call"


def describe_level(level: str) -> str:
    if level in CALL_LEVEL_WORDS:
        return f"{CALL_LEVEL_WORDS[level]} call"
    return "no call level" if level in {"", "Unassigned"} else level


def _group_names(keys: Iterable[str], groups: Mapping[str, Any]) -> list[str]:
    return [groups[key].name if key in groups else key for key in keys]


def _join_or(names: list[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} or {names[-1]}"


def eligibility(
    member_context: Any,
    slot: Any,
    rule: Any,
    groups: Mapping[str, Any] | None = None,
    memberships_on_date: set[str] | None = None,
    *,
    check_call_level: bool = True,
) -> Decision:
    """Can this member take ``slot`` under ``rule``? Ignores leave, units and workload.

    ``groups`` maps group key -> group (``GroupInfo`` or ``CallCluster``); when omitted the
    groups attached to the rule by ``get_phase_one_rules`` are used. ``memberships_on_date``
    is the set of active group keys the member belongs to on the slot date; when omitted it
    is read from the person's memberships.
    """
    if groups is None:
        groups = attached_groups(rule) or {}
    required = required_call_levels_for(slot, rule, groups) if check_call_level else set()
    if required:
        level = member_call_level(member_context)
        if level not in required:
            return Decision(
                False,
                f"Needs {describe_levels(required)}; listed as {describe_level(level)}",
                CODE_CALL_LEVEL,
            )
    if rule is None:
        return Decision(True)
    allowed = list(rule.allowed_cluster_keys or [])
    excluded = list(rule.excluded_cluster_keys or [])
    if not allowed and not excluded:
        return Decision(True)
    if memberships_on_date is None:
        day = getattr(slot, "duty_date", None) or member_context.day or date.today()
        memberships_on_date = active_group_keys_on(member_context.person, day)

    def group_active(key: str) -> bool:
        group = groups.get(key)
        return group.active if group is not None else True

    if allowed:
        if not any(key in memberships_on_date and group_active(key) for key in allowed):
            return Decision(
                False, f"Not in {_join_or(_group_names(allowed, groups))}", CODE_NOT_IN_GROUP
            )
    hit = [key for key in excluded if key in memberships_on_date and group_active(key)]
    if hit:
        return Decision(
            False,
            f"In excluded group {', '.join(_group_names(hit, groups))}",
            CODE_EXCLUDED_GROUP,
        )
    return Decision(True)
