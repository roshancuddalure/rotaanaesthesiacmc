"""Batched dated posting/call facts for leave reports; no scheduling decisions.

Use canonical call precedence. Conflicting postings are reported as unresolved,
never settled by whichever row happens to sort first. Source scope stays explicit.
"""

from collections import defaultdict
from dataclasses import dataclass
from types import SimpleNamespace
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models import Person, PersonPosting, Unit
from app.services.member_profiles import CALL_LEVELS, call_level_on
from app.services.rota_call_levels import normalize_call_level
from app.services.rota_eligibility import member_call_level


@dataclass(frozen=True)
class LeaveDayAttribution:
    unit_id: UUID | None
    unit_name: str | None
    posting_type: str | None
    call_level: str
    warnings: tuple[str, ...]


class LeaveAttribution:
    def __init__(self, db, person_ids, starts_on, ends_on, *, postings=None):
        identities = set(person_ids)
        self.first, self.last = starts_on, ends_on
        self.postings = defaultdict(list)
        self.cache = {}
        with db.no_autoflush:
            self.people = {person.id: person for person in db.scalars(select(Person).where(
                Person.id.in_(identities)).options(selectinload(Person.call_level_changes),
                                                  selectinload(Person.call_changes)))} if identities else {}
            rows = postings
            if rows is None:
                rows = db.scalars(select(PersonPosting).where(
                    PersonPosting.person_id.in_(identities), PersonPosting.starts_on <= ends_on,
                    (PersonPosting.ends_on.is_(None)) | (PersonPosting.ends_on >= starts_on))) if identities else ()
            for row in rows:
                if row.person_id in identities and row.starts_on <= ends_on \
                        and (row.ends_on is None or row.ends_on >= starts_on):
                    self.postings[row.person_id].append(row)
            unit_ids = {row.unit_id for rows in self.postings.values() for row in rows if row.unit_id}
            self.unit_names = dict(db.execute(select(Unit.id, Unit.name).where(Unit.id.in_(unit_ids))).all()) \
                if unit_ids else {}

    def resolve(self, person_id, day):
        if day < self.first or day > self.last:
            raise ValueError("Leave attribution date is outside its loaded report range")
        key = (person_id, day)
        if key in self.cache:
            return self.cache[key]
        warnings = []
        rows = [row for row in self.postings.get(person_id, ())
                if row.starts_on <= day and (row.ends_on is None or row.ends_on >= day)]
        unit_ids = {row.unit_id for row in rows}
        types = {row.posting_type for row in rows}
        unit_id = next(iter(unit_ids)) if len(unit_ids) == 1 else None
        posting_type = next(iter(types)) if len(types) == 1 else None
        if not rows:
            warnings.append("posting_missing")
        elif len(unit_ids) > 1:
            warnings.append("posting_unit_ambiguous")
        if len(types) > 1:
            warnings.append("posting_type_ambiguous")
        person = self.people.get(person_id)
        if person is None:
            levels = set()
        elif rows:
            levels = {member_call_level(SimpleNamespace(person=person, posting_type=row.posting_type, day=day))
                      for row in rows}
        else:
            levels = {normalize_call_level(call_level_on(person, day))}
        level = next(iter(levels)) if len(levels) == 1 and levels <= CALL_LEVELS else "Unassigned"
        if level == "Unassigned":
            warnings.append("call_level_unresolved")
        if unit_id is not None and unit_id not in self.unit_names:
            warnings.append("unit_reference_missing")
        result = LeaveDayAttribution(unit_id, self.unit_names.get(unit_id), posting_type,
                                     level, tuple(warnings))
        self.cache[key] = result
        return result
