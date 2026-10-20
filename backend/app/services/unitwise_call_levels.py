"""Prefill ``Person.call_level`` from section labels in a unitwise workbook
(hard-coded to ``data/source/historical/unitwise/May 2026.xlsx``; handbook B16).

Names resolve through the shared ``MemberIndex`` (purpose "history"); fuzzy similarity never
assigns. ``preview_call_level_prefill`` changes nothing; ``prefill_call_levels_from_unitwise``
applies only the confirmed matched rows of that preview and needs its ``preview_token``.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path

from openpyxl import load_workbook
from sqlalchemy.orm import Session

from app.models import Person
from app.services.department_roster_reset import clean_key
from app.services.member_profiles import call_level_on, local_today, record_call_change
from app.services.member_resolver import MemberIndex, ResolutionContext
from app.services.members import check_preview_token, preview_token
from app.services.roster_reconciliation import clean_roster_name

DEFAULT_UNITWISE_CALL_LEVEL_PATH = (
    Path(__file__).resolve().parents[3]
    / "data"
    / "source"
    / "historical"
    / "unitwise"
    / "May 2026.xlsx"
)

CALL_LEVEL_LABELS = {
    "5th calls": "5TH_CALL",
    "4th calls": "4TH_CALL",
    "3rd call SR/APs": "3RD_CALL",
    "DM/PDF": "3RD_CALL",
    "2nd call SRs": "2ND_CALL",
    "2nd call PGs (2022)": "2ND_CALL",
    "3rd call PGs (2023)": "3RD_CALL",
    "2nd call PGs (2023)": "2ND_CALL",
    "2nd call PGs (2024)": "2ND_CALL",
    "1st call PGs (2025)": "1ST_CALL",
}


@dataclass(frozen=True)
class UnitwiseCallLevelEntry:
    raw_name: str
    cleaned_name: str
    call_level: str


@dataclass
class CallLevelPrefillResult:
    matched: int
    unmatched: int
    cleared: int
    unmatched_names: list[str]
    examples: list[str]
    mode: str = "preview"
    preview_token: str = ""
    changes: int = 0
    needs_review: int = 0
    rows: list[dict] = field(default_factory=list)


def strip_unitwise_suffixes(value: object) -> str:
    cleaned = clean_roster_name(value)
    cleaned = re.sub(
        r"\bMay\s+\d{1,2}(st|nd|rd|th)?\s+\d{1,2}(st|nd|rd|th)?\b",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\bBP\s+\d{1,2}\s+\d{1,2}\b", " ", cleaned, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", cleaned).strip()


def extract_unitwise_call_levels(
    path: Path = DEFAULT_UNITWISE_CALL_LEVEL_PATH,
) -> list[UnitwiseCallLevelEntry]:
    worksheet = load_workbook(path, data_only=True, read_only=True).active
    current_call_level: str | None = None
    entries: list[UnitwiseCallLevelEntry] = []

    for row in worksheet.iter_rows(values_only=True):
        first_cell = row[0] if row else None
        if isinstance(first_cell, str) and first_cell.strip() in CALL_LEVEL_LABELS:
            current_call_level = CALL_LEVEL_LABELS[first_cell.strip()]
        elif isinstance(first_cell, str) and first_cell.strip():
            current_call_level = None

        if current_call_level is None:
            continue

        for value in row[1:]:
            if not isinstance(value, str) or not value.strip():
                continue
            cleaned = strip_unitwise_suffixes(value)
            if not cleaned:
                continue
            entries.append(
                UnitwiseCallLevelEntry(
                    raw_name=value.strip(),
                    cleaned_name=cleaned,
                    call_level=current_call_level,
                )
            )

    deduped: dict[tuple[str, str], UnitwiseCallLevelEntry] = {}
    for entry in entries:
        deduped.setdefault((clean_key(entry.cleaned_name), entry.call_level), entry)
    return list(deduped.values())




def _plan(db: Session, path: Path) -> tuple[list[dict], list[dict], dict[str, Person]]:
    index = MemberIndex.load(db)
    people = {str(person.id): person for person in index.people}
    rows: list[dict] = []
    for entry in extract_unitwise_call_levels(path):
        res = index.resolve(entry.cleaned_name, ResolutionContext.build(entry.call_level), purpose="history")
        if not res.matched and entry.raw_name != entry.cleaned_name:
            # Fall back to the cell as written (exact / alias / rule only).
            raw = index.resolve(entry.raw_name, ResolutionContext.build(entry.call_level), purpose="history")
            if raw.matched:
                res = raw
        person = people.get(res.person_id) if res.matched else None
        rows.append({
            "raw_name": entry.raw_name,
            "cleaned_name": entry.cleaned_name,
            "new_call_level": entry.call_level,
            "status": res.status,
            "method": res.method,
            "reason": res.reason,
            "person_id": res.person_id,
            "canonical_name": res.canonical_name,
            "current_call_level": call_level_on(person) if person else None,
            "candidates": [c.__dict__ for c in res.candidates],
            "warnings": list(res.warnings),
            "action": "review",
        })
    levels_by_person: dict[str, set[str]] = {}
    for row in rows:
        if row["status"] == "matched":
            levels_by_person.setdefault(row["person_id"], set()).add(row["new_call_level"])
    for row in rows:
        if row["status"] != "matched":
            row["reason"] = row["reason"] or "Not matched to a member"
            continue
        levels = levels_by_person[row["person_id"]]
        if len(levels) > 1:
            row.update(status="conflict", action="review",
                       reason=f"{row['canonical_name']} is listed under several call levels "
                              f"({', '.join(sorted(levels))}); set the level by hand")
        elif row["current_call_level"] == row["new_call_level"]:
            row["action"] = "unchanged"
        else:
            row["action"] = "set"
    changes, seen = [], set()
    for row in rows:
        if row["action"] == "set" and row["person_id"] not in seen:
            seen.add(row["person_id"])
            changes.append({"person_id": row["person_id"], "name": row["canonical_name"],
                            "from": row["current_call_level"], "to": row["new_call_level"]})
    changes.sort(key=lambda c: (c["name"].casefold(), c["person_id"]))
    return rows, changes, people


def _result(rows: list[dict], changes: list[dict], mode: str) -> CallLevelPrefillResult:
    review = [row for row in rows if row["action"] == "review"]
    return CallLevelPrefillResult(
        matched=sum(1 for row in rows if row["action"] in {"set", "unchanged"}),
        unmatched=len(review),
        cleared=0,
        unmatched_names=[row["raw_name"] for row in review][:50],
        examples=[f"{c['name']}: {c['from'] or 'none'} -> {c['to']}" for c in changes[:20]],
        mode=mode,
        preview_token=preview_token(changes),
        changes=len(changes),
        needs_review=len(review),
        rows=rows,
    )


def preview_call_level_prefill(db: Session, path: Path = DEFAULT_UNITWISE_CALL_LEVEL_PATH) -> CallLevelPrefillResult:
    """What a prefill would change. Makes no database changes."""
    rows, changes, _ = _plan(db, path)
    return _result(rows, changes, "preview")


def prefill_call_levels_from_unitwise(
    db: Session,
    path: Path = DEFAULT_UNITWISE_CALL_LEVEL_PATH,
    token: str | None = None,
) -> CallLevelPrefillResult:
    """Apply the confirmed changes of ``preview_call_level_prefill``.

    Only rows the resolver matched with certainty change a level; other members keep theirs.
    Raises ``StalePreviewError`` when ``token`` does not match the current preview."""
    rows, changes, people = _plan(db, path)
    check_preview_token(preview_token(changes), token, "call-level prefill")
    for change in changes:
        record_call_change(db, people[change["person_id"]], change["to"], local_today(),
                           "Prefilled from trusted unitwise roster", "unitwise_prefill")
    db.commit()
    return _result(rows, changes, "applied")
