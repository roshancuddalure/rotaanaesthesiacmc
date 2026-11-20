"""Bounded selected-unit month view with one canonical availability load."""

from datetime import datetime, time, timedelta
from time import monotonic

from sqlalchemy import select

from app.models import CallCluster, Person
from app.services.leave import date_range, month_bounds
from app.services.ot_availability import canonical_availability
from app.services.ot_calendar import OtRequirement, resolve_day
from app.services.ot_calendar_store import CalendarConfiguration, current, require_unit
from app.services.ot_capacity import CapacityReserve, CapacityResourceLimit, eligible, evaluate_capacity
from app.services.rota_rules import read_phase_one_rules
from app.services.rota_safety import unit_minimum_for_required_calls


LEVELS = ("1ST_CALL", "2ND_CALL", "3RD_CALL", "4TH_CALL", "CO_4TH_CALL", "5TH_CALL")


def month_capacity(db, unit_id, month, *, include_pending=False):
    first, last = month_bounds(month)
    saved = current(db, unit_id)
    unit = require_unit(db, unit_id)
    config = CalendarConfiguration.model_validate(saved["configuration"]) if saved["configuration"] else None
    days = {day: resolve_day(config.weekly, config.exceptions, day=day, unit_id=unit_id)
            for day in date_range(first - timedelta(days=1), last + timedelta(days=1))} if config else {}
    requirements = tuple(row for day in days.values() for row in day["requirements"])
    if len(requirements) > 512:
        raise CapacityResourceLimit("Monthly OT view supports at most 512 role bands per unit")
    # Whole-band roles can transmit competition beyond the first overlapping
    # pair. Build temporal components once instead of truncating at midnight or
    # at the end of the day's own roles. Eligibility still belongs to the matcher.
    components = []
    for requirement in sorted(requirements, key=lambda r: (r.starts_at, r.ends_at, r.id)):
        if components and requirement.starts_at < components[-1][1]:
            start, finish, members = components[-1]
            components[-1] = (start, max(finish, requirement.ends_at), (*members, requirement))
        else:
            components.append((requirement.starts_at, requirement.ends_at, (requirement,)))
    rules = read_phase_one_rules(db)
    mapping = {row.skill_key: row.group_keys for row in config.qualification_bindings} if config else {}
    sources = {key for keys in mapping.values() for key in keys}
    active = set(db.scalars(select(CallCluster.key).where(CallCluster.key.in_(sources), CallCluster.active.is_(True)))) if sources else set()
    # Zero-demand midnight anchors keep posted/leave/rest counts meaningful on
    # explicit closure days too, without inventing OT or staffing requirements.
    anchors = tuple(OtRequirement(id=f"view:{day}", unit_id=unit_id, area_key="view", band_key="view",
        starts_at=datetime.combine(day, time.min), ends_at=datetime.combine(day + timedelta(days=1), time.min),
        call_levels=LEVELS, minimum=0, target=0) for day in date_range(first, last))
    context = canonical_availability(db, (*requirements, *anchors), rules,
        include_pending=include_pending, qualification_groups_by_unit={unit_id: mapping}, horizon_days=35) if rules else None
    people = context["people"] if context else ()
    if len(people) > 512:
        raise CapacityResourceLimit("Monthly identity detail supports at most 512 posted people per unit")
    warnings = list(context["warnings"]) if context else [{"code": "rota_rules_unconfigured"}]
    if sources - active:
        warnings.append({"code": "ot_qualification_sources_unavailable"})
    result = []
    detail_work = 0
    deadline = monotonic() + 8
    for day in date_range(first, last):
        resolved = days.get(day)
        own = tuple(resolved["requirements"]) if resolved else ()
        begin, end = datetime.combine(day, time.min), datetime.combine(day + timedelta(days=1), time.min)
        # Include competing whole roles that overlap this day's roles, including
        # a preceding overnight band. This is a unit-local view, never a global
        # proof across different units sharing the same identities.
        nearby = tuple(row for start, finish, members in components if start < end and finish > begin for row in members)
        configured = bool(resolved and resolved["configured"])
        status = "not_evaluated"
        report = None
        if configured and context and not warnings and monotonic() < deadline:
            reserves = tuple(CapacityReserve(id=f"minimum:{r.id}", unit_id=unit_id,
                starts_at=r.starts_at, ends_at=r.ends_at, call_levels=r.call_levels,
                minimum=unit_minimum_for_required_calls(unit, set(r.call_levels), rules),
                mode=config.reserve_mode) for r in nearby)
            try:
                report = evaluate_capacity(nearby, people, reserves=reserves, seconds=min(.2, max(0, deadline-monotonic())))
                status = report["status"]
            except CapacityResourceLimit:
                status = "not_evaluated"
            if not nearby:
                status = "closed" if report is not None else "not_evaluated"
        points = {begin, end}
        for r in nearby:
            points.update(t for t in (r.starts_at, r.ends_at) if begin < t < end)
        for person in people:
            for span in (*person.windows, *person.blocked):
                points.update(t for t in (span.starts_at, span.ends_at) if begin < t < end)
        for fact in context["facts"] if context else ():
            for span in fact.get("intervals", ()):
                points.update(t for t in (datetime.fromisoformat(span["starts_at"]),
                    datetime.fromisoformat(span["ends_at"])) if begin < t < end)
        if len(points) > 2048:
            raise CapacityResourceLimit("Monthly interval detail exceeds supported dimensions")
        detail_work += len(points) * max(1, len(people))
        if detail_work > 200000:
            raise CapacityResourceLimit("Monthly identity interval detail exceeds supported work budget")
        has_witness = report is not None and (report.get("solver_status") in {"OPTIMAL", "FEASIBLE"}
                                              or not nearby and status == "closed")
        intervals = []
        for start, finish in zip(sorted(points), sorted(points)[1:]):
            probe = CapacityReserve(id="count", unit_id=unit_id, starts_at=start, ends_at=finish,
                                   call_levels=LEVELS, minimum=0, mode="included")
            posted = {str(p.id) for p in people if any(w.unit_id == unit_id and w.starts_at <= start and w.ends_at >= finish for w in p.windows)}
            available = {str(p.id) for p in people if eligible(p, probe)}
            reserved = set()
            if has_witness:
                for row in report["requirements"]:
                    need = next(r for r in nearby if r.id == row["id"])
                    if need.starts_at < finish and need.ends_at > start:
                        reserved.update(row["matched_person_ids"])
                for row in report["reserves"]:
                    for span in row["intervals"]:
                        if datetime.fromisoformat(span["starts_at"]) < finish and datetime.fromisoformat(span["ends_at"]) > start:
                            reserved.update(span["matched_person_ids"])
            intervals.append({"starts_at": start.isoformat(), "ends_at": finish.isoformat(),
                "posted_person_ids": sorted(posted), "available_person_ids": sorted(available),
                "unavailable_person_ids": sorted(posted-available),
                "reserved_person_ids": sorted(reserved) if has_witness else None,
                "unreserved_person_ids": sorted(available-reserved) if has_witness else None,
                "ot_required": sum(r.minimum for r in nearby if r.starts_at < finish and r.ends_at > start) if configured else None})
        result.append({"day": str(day), "status": status, "configured": configured,
            "missing_areas": resolved.get("missing_areas", []) if resolved else [],
            "requirements": [r.model_dump(mode="json") for r in own], "capacity": report,
            "intervals": intervals})
    labels = {str(row.id): row.canonical_name for row in db.execute(
        select(Person.id, Person.canonical_name).where(Person.id.in_([p.id for p in people])))} if people else {}
    return {"unit_id": str(unit_id), "month": month, "revision": saved["revision"], "people": labels,
        "pending_stress": include_pending, "scope": "selected_unit_only",
        "scope_note": "Selected-unit OT and reserve witness within the displayed month and adjacent loaded dates only. Unreserved people are not certified duty candidates. Counts are interval-specific; do not sum people across intervals or units.",
        "warnings": warnings, "facts": context["facts"] if context else [], "days": result}
