"""History scoring uses observed months, never invented zero-duty months."""

from collections import defaultdict
from datetime import date, timedelta
from uuid import UUID, uuid4

from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.domain.duty_types import DUTY_TYPES
from app.models import DutyAssignment, DutySlot, Person, RotaPeriod, RuleSetting, RuleVersion
from app.services.member_profiles import call_level_on

OFFICIAL_STATUSES = {"historical", "approved", "published", "finalized"}
ACTIVE_STATUSES = {"assigned", "confirmed", "draft"}
POLICY_KEY = "allocation.history_fairness"
GROUPS = {d.key: d.group for d in DUTY_TYPES}


class HistoryFairnessPolicy(BaseModel):
    enabled: bool = True
    lookback_months: int = Field(default=6, ge=1, le=36)
    total_weight: float = Field(default=4, ge=0, le=100)
    hours24_weight: float = Field(default=6, ge=0, le=100)
    weekend_weight: float = Field(default=8, ge=0, le=100)
    group_weight: float = Field(default=4, ge=0, le=100)


def policy_for_date(db: Session, target: date):
    setting = db.scalar(
        select(RuleSetting)
        .join(RuleSetting.rule_version)
        .where(RuleSetting.key == POLICY_KEY, RuleVersion.effective_from <= target)
        .order_by(RuleVersion.effective_from.desc(), RuleVersion.created_at.desc())
    )
    return (
        HistoryFairnessPolicy.model_validate(setting.value) if setting else HistoryFairnessPolicy()
    )


def save_history_policy(
    db: Session, policy: HistoryFairnessPolicy, effective_from: date, actor_id: str
):
    version = RuleVersion(
        name=f"History fairness {uuid4()}",
        effective_from=effective_from,
        description=f"History fairness settings saved by {actor_id}",
    )
    db.add(version)
    db.add(
        RuleSetting(
            rule_version=version, key=POLICY_KEY, value=policy.model_dump(), value_type="json"
        )
    )
    db.commit()
    return {"policy": policy.model_dump(), "effective_from": effective_from.isoformat()}


def recorded_assignments(db: Session, start: date, end: date):
    return list(
        db.scalars(
            select(DutyAssignment)
            .join(DutyAssignment.duty_slot)
            .join(DutySlot.rota_period)
            .where(
                DutySlot.duty_date >= start,
                DutySlot.duty_date <= end,
                RotaPeriod.status.in_(OFFICIAL_STATUSES),
                DutyAssignment.status.in_(ACTIVE_STATUSES),
            )
            .options(selectinload(DutyAssignment.duty_slot).selectinload(DutySlot.unit))
        )
    )


def unique_assignments(assignments):
    seen, result = set(), []
    for assignment in assignments:
        slot = assignment.duty_slot
        key = (assignment.person_id, slot.duty_date, slot.duty_type, slot.starts_at, slot.ends_at)
        if key not in seen:
            seen.add(key)
            result.append(assignment)
    return result


def history_context(db: Session, month_start: date):
    policy = policy_for_date(db, month_start)
    absolute = month_start.year * 12 + month_start.month - 1 - policy.lookback_months
    start = date(absolute // 12, absolute % 12 + 1, 1)
    assignments = unique_assignments(
        recorded_assignments(db, start, month_start - timedelta(days=1))
    )
    by_person = defaultdict(list)
    for assignment in assignments:
        by_person[assignment.person_id].append(assignment.duty_slot)
    people = {p.id: p for p in db.scalars(select(Person))}
    return {
        "policy": policy,
        "start": start,
        "end": month_start - timedelta(days=1),
        "by_person": by_person,
        "people": people,
        "months": sorted({a.duty_slot.duty_date.strftime("%Y-%m") for a in assignments}),
    }


def historical_score(context: dict, person_id: UUID, target_slot: DutySlot):
    policy = context["policy"]
    slots = context["by_person"].get(person_id, [])
    group = GROUPS.get(target_slot.duty_type, target_slot.duty_type)

    def rates(items):
        months = {s.duty_date.strftime("%Y-%m") for s in items}
        denominator = len(months)
        if not denominator:
            return None
        return {
            "total": len(items) / denominator,
            "hours24": sum(s.is_24hr for s in items) / denominator,
            "weekend": sum(s.duty_date.weekday() >= 5 for s in items) / denominator,
            "group": sum(GROUPS.get(s.duty_type, s.duty_type) == group for s in items)
            / denominator,
        }

    person = context["people"].get(person_id)
    peer_rates = [
        rates(items)
        for other_id, items in context["by_person"].items()
        if other_id in context["people"]
        and context["people"][other_id].active_status == "active"
        and person
        and call_level_on(context["people"][other_id], target_slot.duty_date)
        == call_level_on(person, target_slot.duty_date)
    ]
    peer_rates = [r for r in peer_rates if r]
    own = rates(slots)
    averages = (
        {
            key: sum(r[key] for r in peer_rates) / len(peer_rates)
            for key in ("total", "hours24", "weekend", "group")
        }
        if peer_rates
        else {}
    )
    # No history: neutral, rather than treating missing data as zero burden.
    penalty = (
        round(
            sum(
                max(0, own[key] - averages[key]) * getattr(policy, f"{key}_weight")
                for key in averages
            )
        )
        if own and policy.enabled
        else 0
    )
    observed = sorted({s.duty_date.strftime("%Y-%m") for s in slots})
    reason = (
        f"Historical fairness: {len(slots)} duties across {len(observed)} observed month(s); "
        f"{penalty} score penalty for burden above observed peers at the same current call level. "
        f"Window {context['start']} to {context['end']}. Missing months are excluded, not counted as zero."
    )
    if not own:
        reason = "Historical coverage is unknown for this member; history scoring is neutral, not zero-workload credit."
    if not policy.enabled:
        reason = "Historical fairness scoring is disabled; past duties still apply to statistics and rest checks."
    return {
        "penalty": penalty,
        "observed_months": observed,
        "window_months": policy.lookback_months,
        "recorded_window_months": context["months"],
        "rates": own,
        "peer_rates": averages,
        "policy": policy.model_dump(),
        "reason": reason,
    }


def nearby_duties(db: Session, slot: DutySlot, person_id: UUID, minimum_rest: int):
    start = slot.starts_at - timedelta(hours=minimum_rest + 48)
    end = slot.ends_at + timedelta(hours=minimum_rest + 48)
    assignments = db.scalars(
        select(DutyAssignment)
        .join(DutyAssignment.duty_slot)
        .outerjoin(DutySlot.rota_period)
        .where(
            DutyAssignment.person_id == person_id,
            DutyAssignment.status.in_(ACTIVE_STATUSES),
            DutySlot.id != slot.id,
            DutySlot.ends_at >= start,
            DutySlot.starts_at <= end,
            or_(DutySlot.source == "phase4_template", RotaPeriod.status.in_(OFFICIAL_STATUSES)),
        )
        .options(selectinload(DutyAssignment.duty_slot))
    )
    return [a.duty_slot for a in unique_assignments(assignments)]


def past_coverage(db: Session):
    today = date.today()
    assignments = unique_assignments(recorded_assignments(db, date(2000, 1, 1), today))
    grouped = defaultdict(list)
    for assignment in assignments:
        grouped[assignment.duty_slot.duty_date.strftime("%Y-%m")].append(assignment)
    return [
        {
            "month": month,
            "assignments": len(items),
            "members": len({a.person_id for a in items}),
            "days_with_records": len({a.duty_slot.duty_date for a in items}),
            "latest_duty_date": max(a.duty_slot.duty_date for a in items).isoformat(),
            "coverage": "Observed records; missing dates/member records are not assumed complete",
        }
        for month, items in sorted(grouped.items(), reverse=True)
    ]
