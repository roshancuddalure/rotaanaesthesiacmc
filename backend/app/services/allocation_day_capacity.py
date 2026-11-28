"""Approved fractional availability from canonical active leave interval unions.

AM/PM leave removes half a day; overlapping records remove time only once.
These are fairness weights, not entitlement, attendance or working hours.
"""
from app.services.leave_semantics import is_active, leave_intervals, union_intervals

def posted_capacity(person_id, days, leaves):
    total = 0.0
    for day in days:
        spans = union_intervals(span
            for leave in leaves.get(day, {}).get(person_id, []) if is_active(leave.status)
            for span in leave_intervals(leave, day, day))
        blocked = sum((s.ends_at-s.starts_at).total_seconds() for s in spans)/86400
        remaining = max(0.0, min(1.0, 1-blocked))
        total += remaining
    return total
