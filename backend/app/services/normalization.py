"""Comparison keys for names and units, and the review-import wrapper of the member resolver.

Comparison keys never replace display text. Name-to-member resolution lives in
app.services.member_resolver; similarity produces candidates, never an automatic choice.
"""

import re
import unicodedata
from datetime import date
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


def _candidate_detail(person: Person, score: float, reason: str, today: date) -> dict:
    from app.services.member_profile import default_call_level_on

    positions = sorted(
        (d for d in person.designations
         if d.effective_from <= today and (d.effective_to is None or d.effective_to >= today)),
        key=lambda d: d.effective_from,
    )
    current = sorted(
        (p for p in person.postings
         if p.unit and p.starts_on <= today and (p.ends_on is None or p.ends_on >= today)),
        key=lambda p: p.starts_on,
    )
    return {
        "id": str(person.id),
        "name": person.canonical_name,
        "status": person.active_status,
        "call_level": current[-1].posting_type if current else default_call_level_on(person, today),
        "default_call_level": person.call_level,
        "designation": positions[-1].designation if positions else None,
        "units": sorted({f"{p.unit.campus or ''} {p.unit.name}".strip() for p in current}),
        "score": round(score, 3),
        "reason": reason,
    }


def resolve_member(
    db: Session,
    name: str,
    person_id: UUID | None = None,
    *,
    active_only: bool = True,
    as_of: date | None = None,
    index=None,
    call_level: str | None = None,
    duty_area: str | None = None,
) -> dict:
    """Resolve one written name through the shared resolver (app.services.member_resolver).

    Kept for the review import and the /members/resolve API; the response keeps its
    original fields and adds ``status``, ``warnings`` and per-candidate ``reason``.
    active_only=False lets historical members be matched (past and historical records).
    """
    from app.services.member_resolver import MemberIndex, ResolutionContext

    if index is None:
        index = MemberIndex.load(db)
    result = index.resolve(
        name, ResolutionContext.build(call_level, as_of, duty_area), person_id=person_id,
        purpose="live" if active_only else "history",
    )
    today = as_of or date.today()
    inactive = result.status == "needs_review" and any(" is " in w and "confirm" in w for w in result.warnings)
    state = (
        "matched" if result.matched
        else "ambiguous" if result.status == "ambiguous"
        else "inactive" if inactive
        else "needs_review"
    )
    candidates = [
        _candidate_detail(index.by_id[UUID(c.person_id)], c.score, c.reason, today)
        for c in result.candidates
    ]
    if result.matched and not any(c["id"] == result.person_id for c in candidates):
        candidates.insert(0, _candidate_detail(index.by_id[UUID(result.person_id)], 1.0, result.method or "", today))
    return {
        "raw": result.raw,
        "comparison_key": result.comparison_key,
        "person_id": result.person_id,
        "canonical_name": result.canonical_name,
        "state": state,
        "status": result.status,
        "method": result.method if result.matched else None,
        "reason": result.reason,
        "warnings": result.warnings,
        "candidates": candidates,
    }


# TEMPORARY (removed once every caller uses app.services.member_resolver): the previous
# exact-key lookup and fuzzy candidate list, kept only so in-flight migrations still import.
def member_lookup(db: Session, *, active_only: bool = True) -> dict[str, Person | None]:
    query = select(Person).options(selectinload(Person.aliases))
    if active_only:
        query = query.where(Person.active_status == "active")
    lookup: dict[str, Person | None] = {}
    for person in db.scalars(query):
        for label in [person.canonical_name, *(a.alias for a in person.aliases)]:
            key = member_key(label)
            if key:
                lookup[key] = None if key in lookup and (lookup[key] is None or lookup[key].id != person.id) else person
    return lookup


def member_candidates(name: str, lookup: dict[str, Person | None], limit: int = 5) -> list[tuple[float, Person]]:
    from difflib import SequenceMatcher

    key = member_key(name)
    scores: dict = {}
    for candidate_key, person in lookup.items():
        if person is None or not key:
            continue
        score = SequenceMatcher(None, key, candidate_key).ratio()
        if score >= 0.65 and score > scores.get(person.id, (0, None))[0]:
            scores[person.id] = (score, person)
    return sorted(scores.values(), key=lambda item: (-item[0], item[1].canonical_name))[:limit]
