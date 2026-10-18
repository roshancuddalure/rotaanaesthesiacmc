"""One conservative identity matcher shared by all roster import paths.

Comparison keys never replace display text. Similarity produces candidates, never
an automatic identity choice. Ambiguous exact keys remain ambiguous.
"""

import re
import unicodedata
from datetime import date
from difflib import SequenceMatcher
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Person, PersonPosting

TITLE = re.compile(r"^(?:dr|doctor|prof|professor|mr|mrs|ms)\.?\s*", re.I)
ROMAN = {
    "i": 1,
    "ii": 2,
    "iii": 3,
    "iv": 4,
    "v": 5,
    "vi": 6,
    "vii": 7,
    "viii": 8,
    "ix": 9,
    "x": 10,
    "xi": 11,
    "xii": 12,
}


def display_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", str(value)).split())


def label_key(value: str) -> str:
    return " ".join(
        "".join(c if c.isalnum() else " " for c in display_text(value).casefold()).split()
    )


def member_key(value: str) -> str:
    value = display_text(value)
    # Require a title boundary: never strip 'Dr' from a name such as 'Drew'.
    value = re.sub(
        r"^(?:(?:dr|doctor|prof|professor|mr|mrs|ms)(?:\.\s*|\s+))+", "", value, flags=re.I
    )
    return "".join(c for c in value.casefold() if c.isalnum())


def unit_key(value: str) -> str:
    key = label_key(value)
    key = re.sub(r"\b(?:unit|u)\s*0*(\d{1,2})\b", lambda m: "unit " + str(int(m[1])), key)
    key = re.sub(r"\bunit\s+([ivx]+)\b", lambda m: "unit " + str(ROMAN.get(m[1], m[1])), key)
    return key


def member_lookup(db: Session, *, active_only: bool = True) -> dict[str, Person | None]:
    query = select(Person).options(
        selectinload(Person.aliases),
        selectinload(Person.designations),
        selectinload(Person.call_level_changes),
        selectinload(Person.postings).selectinload(PersonPosting.unit),
    )
    if active_only:
        query = query.where(Person.active_status == "active")
    lookup: dict[str, Person | None] = {}
    for person in db.scalars(query):
        for label in [person.canonical_name, *(a.alias for a in person.aliases)]:
            key = member_key(label)
            if not key:
                continue
            if key in lookup and (lookup[key] is None or lookup[key].id != person.id):
                lookup[key] = None
            else:
                lookup[key] = person
    return lookup


def member_candidates(
    name: str, lookup: dict[str, Person | None], limit: int = 5
) -> list[tuple[float, Person]]:
    key = member_key(name)
    scores = {}
    for candidate_key, person in lookup.items():
        if person is None or not key:
            continue
        score = SequenceMatcher(None, key, candidate_key).ratio()
        if score >= 0.65 and score > scores.get(person.id, (0, None))[0]:
            scores[person.id] = (score, person)
    return sorted(scores.values(), key=lambda item: (-item[0], item[1].canonical_name))[:limit]


def resolve_member(
    db: Session,
    name: str,
    person_id: UUID | None = None,
    *,
    active_only: bool = True,
    as_of: date | None = None,
    lookup: dict[str, Person | None] | None = None,
) -> dict:
    if lookup is None:
        lookup = member_lookup(db, active_only=False)
    person = db.get(Person, person_id) if person_id else lookup.get(member_key(name))
    ambiguous = not person_id and member_key(name) in lookup and person is None
    ranked = member_candidates(name, lookup)
    if ambiguous:
        for candidate in db.scalars(select(Person).options(selectinload(Person.aliases))):
            if member_key(name) in {
                member_key(v)
                for v in [candidate.canonical_name, *(a.alias for a in candidate.aliases)]
            }:
                ranked.insert(0, (1.0, candidate))
    if person and person not in [p for _, p in ranked]:
        ranked.insert(0, (1.0, person))
    candidates = []
    for score, candidate in ranked:
        today = as_of or date.today()
        positions = sorted(
            (
                d
                for d in candidate.designations
                if d.effective_from <= today and (d.effective_to is None or d.effective_to >= today)
            ),
            key=lambda d: d.effective_from,
        )
        units = sorted(
            {
                f"{p.unit.campus or ''} {p.unit.name}".strip()
                for p in candidate.postings
                if p.unit and p.starts_on <= today and (p.ends_on is None or p.ends_on >= today)
            }
        )
        from app.services.member_profile import default_call_level_on

        active_primary = sorted(
            (
                p
                for p in candidate.postings
                if p.unit and p.starts_on <= today and (p.ends_on is None or p.ends_on >= today)
            ),
            key=lambda p: p.starts_on,
        )
        effective_call = (
            active_primary[-1].posting_type
            if active_primary
            else default_call_level_on(candidate, today)
        )
        candidates.append(
            {
                "id": str(candidate.id),
                "name": candidate.canonical_name,
                "status": candidate.active_status,
                "call_level": effective_call,
                "default_call_level": candidate.call_level,
                "designation": positions[-1].designation if positions else None,
                "units": units,
                "score": round(score, 3),
            }
        )
    usable = person is not None and (not active_only or person.active_status == "active")
    method = (
        "member_id"
        if person_id
        else "canonical_exact"
        if person and member_key(person.canonical_name) == member_key(name)
        else "approved_alias"
    )
    return {
        "raw": name,
        "comparison_key": member_key(name),
        "person_id": str(person.id) if usable else None,
        "canonical_name": person.canonical_name if usable else None,
        "state": "matched"
        if usable
        else "ambiguous"
        if ambiguous
        else "inactive"
        if person
        else "needs_review",
        "method": method if usable else None,
        "reason": "Stable member ID"
        if usable and person_id
        else "Unambiguous normalized name or approved alias"
        if usable
        else "Select an active member or explicitly create a separate identity",
        "candidates": candidates,
    }
