"""Distinct identity/time reporting from canonical leave records, without I/O.

These are current-state recorded leave intervals, not attendance confirmation,
elapsed leave taken, working days or an entitlement ledger.
"""

from collections import Counter, defaultdict
from datetime import timedelta

from app.services.leave_semantics import (
    date_range, is_active, is_approved, is_pending, known_slot, leave_intervals,
    status_key, union_intervals,
)


def interval_coverage(records, starts_on, ends_on):
    """Union per person/status group, clipping only the requested report dates.

    Request counts remain distinct from covered dates/hours. Unknown slots never
    inherit the conservative safety fallback as precise accounting. Caller owns
    canonical querying, authorization, transaction and historical completeness.
    """
    if ends_on < starts_on:
        raise ValueError("Leave report end date precedes start date")
    groups = {key: {"records": set(), "people": set(), "unknown": set(),
                    "spans": defaultdict(list)} for key in ("approved", "pending", "active")}
    counts = Counter()
    seen = set()
    unknown_statuses, invalid_dates = set(), set()
    for row in records:
        if row.id is None or row.person_id is None:
            raise ValueError("Leave accounting requires canonical record and person identities")
        if row.id in seen:
            continue
        seen.add(row.id)
        if row.starts_on > ends_on or row.ends_on < starts_on:
            continue
        counts[status_key(row.status)] += 1
        if not is_active(row.status) and status_key(row.status) not in {"cancelled", "rejected"}:
            unknown_statuses.add(str(row.id))
        if row.ends_on < row.starts_on:
            invalid_dates.add(str(row.id))
        selected = (["approved"] if is_approved(row.status) else
                    ["pending"] if is_pending(row.status) else [])
        if is_active(row.status):
            selected.append("active")
        precise = known_slot(row.leave_slot) and row.ends_on >= row.starts_on
        spans = leave_intervals(row, starts_on, ends_on, conservative_unknown=False) if precise else ()
        for key in selected:
            group = groups[key]
            group["records"].add(row.id)
            group["people"].add(row.person_id)
            if not precise:
                group["unknown"].add(str(row.id))
            group["spans"][row.person_id].extend(spans)

    result = {}
    for key, group in groups.items():
        seconds, covered_dates = 0.0, 0
        for spans in group["spans"].values():
            dates = set()
            for span in union_intervals(spans):
                seconds += (span.ends_at - span.starts_at).total_seconds()
                dates.update(date_range(span.starts_at.date(),
                                        (span.ends_at - timedelta(microseconds=1)).date()))
            covered_dates += len(dates)
        precise = not group["unknown"]
        result[key] = {
            "record_count": len(group["records"]), "people_with_records": len(group["people"]),
            "precise": precise, "clock_hours": seconds / 3600 if precise else None,
            "person_calendar_dates": covered_dates if precise else None,
            "known_clock_hours": seconds / 3600, "known_person_calendar_dates": covered_dates,
            "unresolved_record_ids": sorted(group["unknown"]),
        }
    return {"version": 1, "starts_on": starts_on.isoformat(), "ends_on": ends_on.isoformat(),
            "status_record_counts": dict(counts), "groups": result,
            "unrecognized_status_record_ids": sorted(unknown_statuses),
            "invalid_date_record_ids": sorted(invalid_dates),
            "basis": "Union per person of stored local leave bands within inclusive report dates; "
                     "partial dates count as touched dates, not full leave days. "
                     "Current canonical statuses; approved and pending may overlap and are not additive.",
            "attendance_verified": False, "historical_coverage_complete": False,
            "working_days": None, "entitlement_balance": None}
