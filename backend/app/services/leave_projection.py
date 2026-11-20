"""Detached, immutable leave values for hypothetical scheduling reviews."""

from dataclasses import dataclass
from datetime import date
from uuid import UUID


@dataclass(frozen=True)
class LeaveProjection:
    id: UUID | str
    person_id: UUID
    starts_on: date
    ends_on: date
    leave_slot: str
    status: str

    def __post_init__(self):
        if not str(self.id) or not isinstance(self.person_id, UUID):
            raise ValueError("Leave projection requires a stable identity and canonical person UUID")
        if type(self.starts_on) is not date or type(self.ends_on) is not date or self.ends_on < self.starts_on:
            raise ValueError("Leave projection requires ordered calendar dates")
        if not isinstance(self.leave_slot, str) or not isinstance(self.status, str):
            raise ValueError("Leave projection requires stored session and status values")


def indexed_projections(rows):
    rows = tuple(rows)
    if len(rows) > 5000 or any(not isinstance(row, LeaveProjection) for row in rows):
        raise ValueError("Use at most 5000 immutable leave projections")
    indexed = {str(row.id): row for row in rows}
    if len(indexed) != len(rows):
        raise ValueError("Each proposed leave identity must occur once")
    return indexed
