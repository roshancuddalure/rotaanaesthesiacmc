"""Current-state recorded person leave statistics; no attendance or balance inference."""

from calendar import monthrange
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta

from app.services.leave_accounting import interval_coverage
from app.services.leave_semantics import (
    LeaveInterval, date_range, is_approved, is_pending, known_slot, leave_intervals,
    status_key, union_intervals,
)


def report_bounds(year, month=None):
    if type(year) is not int or not 1 <= year <= 9998:
        raise ValueError("Report year must be between 1 and 9998")
    if month is not None and (type(month) is not int or not 1 <= month <= 12):
        raise ValueError("Report month must be between 1 and 12")
    return (date(year, month or 1, 1),
            date(year, month, monthrange(year, month)[1]) if month else date(year, 12, 31))


def _measure(spans, unknown):
    merged = union_intervals(spans)
    seconds = sum((span.ends_at - span.starts_at).total_seconds() for span in merged)
    dates = {day for span in merged for day in date_range(
        span.starts_at.date(), (span.ends_at - timedelta(microseconds=1)).date())}
    return {"precise": not unknown, "clock_hours": seconds / 3600 if not unknown else None,
            "calendar_dates": len(dates) if not unknown else None,
            "known_clock_hours": seconds / 3600, "known_calendar_dates": len(dates),
            "unresolved_record_ids": sorted(unknown)}


def _timing(rows, first, last, as_of, predicate):
    parts = {key: [] for key in ("whole_period", "elapsed", "future")}
    unknown = {key: set() for key in parts}
    start = datetime.combine(first, time.min)
    end = datetime.combine(last + timedelta(days=1), time.min)
    boundary = min(end, max(start, as_of))
    unknown_current_date = False
    for row in rows:
        if not predicate(row.status) or row.starts_on > last or row.ends_on < first:
            continue
        if not known_slot(row.leave_slot) or row.ends_on < row.starts_on:
            unknown["whole_period"].add(str(row.id))
            # Unknown session cannot be assigned precise hours. Date intersection
            # still tells which side of the as-of boundary may be affected.
            row_start = datetime.combine(max(first, min(row.starts_on, row.ends_on)), time.min)
            row_end = datetime.combine(min(last, max(row.starts_on, row.ends_on)) + timedelta(days=1), time.min)
            if row_start < boundary:
                unknown["elapsed"].add(str(row.id))
            if row_end > boundary:
                unknown["future"].add(str(row.id))
            if row_start < as_of < row_end and as_of.time() != time.min:
                unknown_current_date = True
            continue
        spans = leave_intervals(row, first, last, conservative_unknown=False)
        parts["whole_period"].extend(spans)
        for span in spans:
            if span.starts_at < boundary:
                parts["elapsed"].append(LeaveInterval(span.starts_at, min(span.ends_at, boundary)))
            if span.ends_at > boundary:
                parts["future"].append(LeaveInterval(max(span.starts_at, boundary), span.ends_at))
    result = {key: _measure(parts[key], unknown[key]) for key in parts}
    # Calendar dates touching elapsed/future can overlap on the current date.
    # "In progress" counts a date only when it has coverage on both sides now.
    current_date = as_of.date()
    elapsed_today = any(span.starts_at.date() <= current_date <=
                        (span.ends_at - timedelta(microseconds=1)).date() for span in parts["elapsed"])
    future_today = any(span.starts_at.date() <= current_date <=
                       (span.ends_at - timedelta(microseconds=1)).date() for span in parts["future"])
    known_current_date = int(elapsed_today and future_today)
    result["known_in_progress_calendar_dates"] = known_current_date
    result["in_progress_calendar_dates"] = None if unknown_current_date else known_current_date
    result["in_progress_precise"] = not unknown_current_date
    return result


def statistics(records, person_id, *, year, month=None, as_of):
    first, last = report_bounds(year, month)
    if not isinstance(as_of, datetime) or as_of.tzinfo is not None:
        raise ValueError("As-of must be a hospital-local date/time without an offset")
    unique = {}
    for row in records:
        if row.person_id != person_id:
            raise ValueError("Person leave statistics cannot mix identities")
        if row.id is None:
            raise ValueError("Person leave statistics require canonical record IDs")
        if row.starts_on <= last and row.ends_on >= first:
            unique[row.id] = row
    rows = list(unique.values())
    if len(rows) > 2000:
        raise ValueError("More than 2000 leave records overlap this period; choose a smaller report range")
    record_days = sum(max(0, (min(last, row.ends_on) - max(first, row.starts_on)).days + 1)
                      for row in rows)
    if record_days > 100_000:
        raise ValueError("Leave statistics exceed 100000 record-dates; choose a smaller report range")
    by_type = defaultdict(list)
    for row in rows:
        by_type[row.leave_type].append(row)
    monthly = []
    for number in ([month] if month else range(1, 13)):
        beginning, ending = report_bounds(year, number)
        monthly.append({"month": f"{year:04d}-{number:02d}",
                        "coverage": interval_coverage(rows, beginning, ending),
                        "approved": _timing(rows, beginning, ending, as_of, is_approved)})
    return {
        "version": 1, "person_id": str(person_id), "year": year, "month": month,
        "starts_on": first.isoformat(), "ends_on": last.isoformat(),
        "as_of_local": as_of.isoformat(), "clock": "Asia/Kolkata hospital-local wall time",
        "coverage": interval_coverage(rows, first, last),
        "approved": _timing(rows, first, last, as_of, is_approved),
        "pending": _timing(rows, first, last, as_of, is_pending),
        "by_type": [{"type": key, "status_record_counts": dict(Counter(status_key(row.status) for row in values)),
                     "coverage": interval_coverage(values, first, last),
                     "approved": _timing(values, first, last, as_of, is_approved)}
                    for key, values in sorted(by_type.items())],
        "monthly": monthly,
        "definitions": {
            "elapsed": "Recorded approved absence elapsed using current canonical status; not verified attendance or approval known at the historical as-of time.",
            "calendar_dates": "Distinct touched calendar dates, including weekends/holidays; partial dates are not full entitlement days. Elapsed and future date counts may share the in-progress date.",
            "types": "Different leave types may overlap. Type-hour totals are not additive; overall per-person interval union is authoritative.",
            "monthly": "A cross-month request appears in each overlapping month; do not sum monthly record counts as distinct annual requests.",
            "working_days": "Unavailable: no authoritative individual dated work calendar is configured for this report.",
            "historical_coverage": "Only recorded canonical data is reported. No matching records does not prove complete history. Deleted records and missing legacy data are not reconstructed as attendance.",
        },
        "working_days": None, "entitlement_balance": None,
        "historical_coverage_complete": False, "attendance_verified": False,
    }
