"""Shared leave facts with explicit consumer policy, no entitlement inference.

Normal allocation blocks approved leave and warns on pending. Extra-duty Q2
deliberately treats every active status as strict; preserve that separate policy.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

BLOCKING_LEAVE_STATUSES = frozenset({"approved"})
PENDING_LEAVE_STATUSES = frozenset({"requested", "imported_pending_review"})
ACTIVE_LEAVE_STATUSES = BLOCKING_LEAVE_STATUSES | PENDING_LEAVE_STATUSES
KNOWN_LEAVE_SLOTS = frozenset({"FULL_DAY", "AM", "PM", "NIGHT"})
_BANDS = {"FULL_DAY": ((0, 24),), "AM": ((0, 12),), "PM": ((12, 24),),
          "NIGHT": ((0, 8), (18, 24))}


def status_key(value: str | None) -> str:
    """Existing case handling; never silently repair stored typos or whitespace."""
    return (value or "").lower()


def is_active(value: str | None) -> bool:
    return status_key(value) in ACTIVE_LEAVE_STATUSES


def is_approved(value: str | None) -> bool:
    return status_key(value) in BLOCKING_LEAVE_STATUSES


def is_pending(value: str | None) -> bool:
    return status_key(value) in PENDING_LEAVE_STATUSES


def count_leave_days(starts_on: date, ends_on: date) -> int:
    """Inclusive request dates, not elapsed absence or entitlement days."""
    return (ends_on - starts_on).days + 1


def date_range(starts_on: date, ends_on: date) -> list[date]:
    return [date.fromordinal(starts_on.toordinal() + offset)
            for offset in range(count_leave_days(starts_on, ends_on))]


@dataclass(frozen=True, order=True)
class LeaveInterval:
    starts_at: datetime
    ends_at: datetime

    def __post_init__(self):
        if self.starts_at.tzinfo or self.ends_at.tzinfo or self.ends_at <= self.starts_at:
            raise ValueError("Leave intervals require increasing hospital-local wall times")


def known_slot(value: str | None) -> bool:
    return (value or "").upper() in KNOWN_LEAVE_SLOTS


def leave_intervals(leave, first: date, last: date, *, conservative_unknown=True) -> tuple[LeaveInterval, ...]:
    """Date-clipped bands on EACH stored inclusive date, independent of status.

    Unknown slots retain the full-date safety fallback. Exact accounting callers
    exclude this fallback and disclose unknown records rather than charge hours.
    """
    code = (leave.leave_slot or "").upper()
    bands = _BANDS.get(code, ((0, 24),) if conservative_unknown else ())
    return tuple(LeaveInterval(datetime.combine(day, time.min) + timedelta(hours=start),
                               datetime.combine(day, time.min) + timedelta(hours=end))
                 for day in date_range(max(first, leave.starts_on), min(last, leave.ends_on))
                 for start, end in bands)


def union_intervals(intervals) -> tuple[LeaveInterval, ...]:
    """Union actual time; callers group by person and intended status policy."""
    merged = []
    for row in sorted(intervals, key=lambda item: (item.starts_at, item.ends_at)):
        span = LeaveInterval(row.starts_at, row.ends_at)
        if merged and merged[-1].ends_at >= span.starts_at:
            previous = merged.pop()
            span = LeaveInterval(previous.starts_at, max(previous.ends_at, span.ends_at))
        merged.append(span)
    return tuple(merged)


def duty_leave_blocks(leave_slot: str | None, *, is_24hr: bool, start_hour: int) -> bool:
    """Legacy duty policy: partial leave blocks 24h; shorter duties use start hour.

    Separate from OT interval intersection. Callers check dates/status and choose
    the approved/pending policy required by their contract.
    """
    if is_24hr:
        return True
    code = (leave_slot or "").upper()
    if code == "AM":
        return start_hour < 12
    if code == "PM":
        return start_hour >= 12
    if code == "NIGHT":
        return start_hour >= 18 or start_hour < 8
    return True
