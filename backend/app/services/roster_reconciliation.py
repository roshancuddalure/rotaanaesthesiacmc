"""Reconcile database members against the trusted department roster workbook
(``Plan/Data/ANAESTHESIA department doctors(namelist).xlsx``): rename to roster spelling,
merge members whose canonical names are identical, add aliases and roster designations,
and create missing members. Path/sheet names are hard-coded to the March 2026 workbook
(handbook B16, D1).

Names resolve through the shared ``MemberIndex``. Only certain matches (exact name, approved
alias, reviewed rule) are renamed or merged; similar names appear in the preview as
needs_review with candidates and are never merged. ``preview_roster_reconciliation`` changes
nothing; ``reconcile_department_roster`` applies the preview and needs its token.
"""

import re
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path
from uuid import UUID

from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models import Person, PersonAlias, PersonDesignation
from app.services.imports import clean_cell_value, is_valid_person_name, normalize_label
from app.services.members import (
    check_preview_token,
    compact_name_key,
    merge_people,
    person_brief,
    preview_token,
    select_merge_target,
)
from app.services.normalization import member_key

DEFAULT_ROSTER_PATH = (
    Path(__file__).resolve().parents[3]
    / "Plan"
    / "Data"
    / "ANAESTHESIA department doctors(namelist).xlsx"
)

CURRENT_ROSTER_SHEETS = {
    "OVERALL MARCH 26",
    "ANAESTHESIA",
    "CARDIAC ANAESTHESIA",
    "NEURO ANAESTHESIA",
}

EXPLICIT_DESIGNATION_SHEETS = {"CARDIAC ANAESTHESIA", "NEURO ANAESTHESIA"}

REJECT_LABEL_PARTS = (
    "anaesthesia",
    "department",
    "designation",
    "professor",
    "professors",
    "associate",
    "assistant",
    "resident",
    "fellowship",
    "tutor",
    "batch",
    "year",
    "total",
    "staff",
    "emp",
    "s no",
)

STATUS_SUFFIX_RE = re.compile(
    r"\s*(?:[-–—]\s*)?\b(study leave|maternity leave|senior resident|sr|ml|ap|micu)\b.*$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class RosterEntry:
    canonical_name: str
    raw_name: str
    sheet_name: str
    designation: str | None = None


@dataclass
class RosterReconciliationResult:
    roster_entries: int = 0
    matched_people: int = 0
    created_people: int = 0
    renamed_people: int = 0
    merged_people: int = 0
    aliases_created: int = 0
    designations_created: int = 0
    unmatched_database_people: int = 0
    examples: list[str] = field(default_factory=list)
    mode: str = "preview"
    preview_token: str = ""
    needs_review: int = 0
    rows: list[dict] = field(default_factory=list)


def display_name(value: str) -> str:
    words: list[str] = []
    for token in value.split():
        if len(token) <= 2:
            words.append(token.upper())
        else:
            words.append(token[:1].upper() + token[1:].lower())
    return " ".join(words)


def clean_roster_name(value: object) -> str:
    cleaned = clean_cell_value(value)
    # Word boundary: never strip "Prof" from a label such as "PROFESSORS-2".
    cleaned = re.sub(r"^(dr|prof|mr|mrs|ms)\b\.?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\([^)]*\)", " ", cleaned)
    cleaned = STATUS_SUFFIX_RE.sub(" ", cleaned)
    cleaned = cleaned.replace(".", " ")
    cleaned = re.sub(r"\s*[-–—]\s*$", " ", cleaned)
    cleaned = re.sub(r"[^A-Za-z0-9]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return display_name(cleaned)


def is_roster_person_value(value: object) -> bool:
    cleaned = clean_roster_name(value)
    if not cleaned or not is_valid_person_name(cleaned):
        return False
    normalized = normalize_label(cleaned)
    if re.fullmatch(r"\d+", normalized):
        return False
    if any(part in normalized for part in REJECT_LABEL_PARTS):
        return False
    if normalized.startswith(("md ", "dm ", "pdf ")):
        return False
    return True


def normalize_designation(value: object) -> str | None:
    cleaned = clean_cell_value(value)
    if not cleaned:
        return None
    normalized = normalize_label(cleaned)
    if not normalized or normalized.isdigit() or normalized in {"designation", "emp no"}:
        return None
    return cleaned.upper().replace("ASSOC.", "ASSOCIATE").replace("ASST.", "ASSISTANT")


def extract_department_roster(path: Path = DEFAULT_ROSTER_PATH) -> list[RosterEntry]:
    workbook = load_workbook(path, data_only=True, read_only=True)
    entries: dict[str, RosterEntry] = {}

    for sheet_name in CURRENT_ROSTER_SHEETS:
        if sheet_name not in workbook.sheetnames:
            continue
        worksheet = workbook[sheet_name]
        for row in worksheet.iter_rows(values_only=True):
            if sheet_name in EXPLICIT_DESIGNATION_SHEETS:
                explicit_cells = ((1, 3), (4, 6))
                for name_index, designation_index in explicit_cells:
                    if name_index >= len(row) or not is_roster_person_value(row[name_index]):
                        continue
                    canonical = clean_roster_name(row[name_index])
                    designation = (
                        normalize_designation(row[designation_index])
                        if designation_index < len(row)
                        else None
                    )
                    entries.setdefault(
                        compact_name_key(canonical),
                        RosterEntry(canonical, clean_cell_value(row[name_index]), sheet_name, designation),
                    )
                continue

            for value in row:
                if not is_roster_person_value(value):
                    continue
                canonical = clean_roster_name(value)
                entries.setdefault(
                    compact_name_key(canonical),
                    RosterEntry(canonical, clean_cell_value(value), sheet_name),
                )

    return sorted(entries.values(), key=lambda entry: entry.canonical_name.casefold())


ROSTER_DESIGNATION_FROM = date(2026, 3, 1)


def plan_roster_reconciliation(db: Session, entries: list[RosterEntry]) -> tuple[list[dict], list[dict]]:
    """Rows for the preview and the ordered list of changes (what the token covers)."""
    from app.services.member_resolver import MemberIndex

    index = MemberIndex.load(db)
    by_id = {str(person.id): person for person in index.people}
    alias_owner = {alias.alias: str(alias.person_id) for alias in db.scalars(select(PersonAlias))}
    name_owner = {person.canonical_name: str(person.id) for person in index.people}
    rows: list[dict] = []
    for entry in entries:
        row = {"raw_name": entry.raw_name, "roster_name": entry.canonical_name, "sheet": entry.sheet_name,
               "designation": entry.designation, "status": "not_found", "action": "review", "method": None,
               "person_id": None, "current_name": None, "merge_from": [], "reason": "",
               "candidates": [], "warnings": []}
        key = member_key(entry.canonical_name)
        same_name = sorted((by_id[str(i)] for i in index.canonical.get(key, set())),
                           key=lambda p: (p.canonical_name, str(p.id)))
        if len(same_name) > 1:
            # Identical canonical names: the same person entered more than once.
            target = next((p for p in same_name if p.canonical_name == entry.canonical_name), None)
            target = target or select_merge_target(same_name)
            row.update(status="matched", method="canonical_exact", person_id=str(target.id),
                       current_name=target.canonical_name,
                       merge_from=[person_brief(p) for p in same_name if p.id != target.id],
                       reason=f"{len(same_name)} members have the name '{entry.canonical_name}'; they will be merged")
            row["warnings"] += [f"{p.canonical_name} is {p.active_status}"
                                for p in same_name if p.active_status != "active"]
        else:
            res = index.resolve(entry.canonical_name, purpose="history")
            if not res.matched and member_key(entry.raw_name) != key:
                raw = index.resolve(entry.raw_name, purpose="history")
                if raw.matched:
                    res = raw
            row.update(status=res.status, method=res.method, reason=res.reason, warnings=list(res.warnings),
                       candidates=[asdict(c) for c in res.candidates])
            if res.matched:
                row.update(person_id=res.person_id, current_name=by_id[res.person_id].canonical_name)
            elif res.status == "not_found":
                near = index.near_duplicates(entry.canonical_name)
                if near:
                    row.update(status="needs_review", candidates=[asdict(c) for c in near],
                               reason=f"'{entry.canonical_name}' is close to an existing member; not created")
                else:
                    row.update(action="create", reason="Not in the member list; will be created")
        rows.append(row)

    # One member must not take two roster names.
    claimed: dict[str, list[dict]] = {}
    for row in rows:
        if row["status"] == "matched":
            for person_id in [row["person_id"], *[s["id"] for s in row["merge_from"]]]:
                claimed.setdefault(person_id, []).append(row)
    for person_id, owned in claimed.items():
        if len(owned) > 1:
            for row in owned:
                row.update(status="conflict", merge_from=[],
                           reason=f"{by_id[person_id].canonical_name} matches several roster names "
                                  f"({', '.join(r['roster_name'] for r in owned)}); resolve by hand")

    changes: list[dict] = []
    for row in rows:
        if row["status"] == "matched":
            target_id = row["person_id"]
            merged_ids = {s["id"] for s in row["merge_from"]}
            renaming = row["current_name"] != row["roster_name"]
            taken_by = name_owner.get(row["roster_name"])
            if renaming and taken_by and taken_by != target_id and taken_by not in merged_ids:
                row.update(status="conflict", merge_from=[],
                           reason=f"'{row['roster_name']}' is already the name of {by_id[taken_by].canonical_name}")
                continue
            for source in row["merge_from"]:
                changes.append({"op": "merge", "target": target_id, "source": source["id"],
                                "source_name": source["name"]})
            if renaming:
                changes.append({"op": "rename", "person": target_id, "from": row["current_name"],
                                "to": row["roster_name"]})
            row["action"] = "merge" if row["merge_from"] else ("rename" if renaming else "keep")
            alias = row["raw_name"].strip()
            owner = alias_owner.get(alias)
            if alias and alias != row["roster_name"]:
                if owner and owner != target_id and owner not in merged_ids:
                    row["warnings"].append(f'Alias "{alias}" belongs to {by_id[owner].canonical_name}; not moved')
                elif owner is None:
                    changes.append({"op": "alias", "person": target_id, "alias": alias})
            if row["designation"]:
                changes.append({"op": "designation", "person": target_id, "designation": row["designation"]})
        elif row["action"] == "create":
            alias = row["raw_name"].strip()
            owner = alias_owner.get(alias)
            if owner:
                row["warnings"].append(f'Alias "{alias}" belongs to {by_id[owner].canonical_name}; not moved')
            changes.append({"op": "create", "name": row["roster_name"],
                            "alias": alias if alias != row["roster_name"] and not owner else None,
                            "designation": row["designation"]})
    return rows, changes


def _add_designation(db: Session, person: Person, designation: str | None,
                     result: RosterReconciliationResult) -> None:
    if not designation:
        return
    exists = db.scalar(select(PersonDesignation).where(
        PersonDesignation.person_id == person.id,
        PersonDesignation.designation == designation,
        PersonDesignation.effective_from == ROSTER_DESIGNATION_FROM,
    ))
    if exists is not None:
        return
    db.add(PersonDesignation(person=person, designation=designation, effective_from=ROSTER_DESIGNATION_FROM,
                             source="trusted_roster",
                             notes="Imported from ANAESTHESIA department doctors(namelist).xlsx"))
    db.flush()
    result.designations_created += 1


def _add_alias(db: Session, person: Person, alias: str, source: str, result: RosterReconciliationResult) -> None:
    if alias and alias != person.canonical_name and             db.scalar(select(PersonAlias).where(PersonAlias.alias == alias)) is None:
        db.add(PersonAlias(person=person, alias=alias, source=source))
        db.flush()
        result.aliases_created += 1


def _apply(db: Session, changes: list[dict], result: RosterReconciliationResult) -> set[UUID]:
    touched: set[UUID] = set()
    for change in changes:
        op = change["op"]
        if op == "merge":
            merge_people(db, UUID(change["target"]), [UUID(change["source"])], commit=False)
            result.merged_people += 1
        elif op == "rename":
            person = db.get(Person, UUID(change["person"]))
            old_name = person.canonical_name
            person.canonical_name = change["to"]
            db.flush()
            _add_alias(db, person, old_name, "roster_previous_name", result)
            result.renamed_people += 1
        elif op == "alias":
            _add_alias(db, db.get(Person, UUID(change["person"])), change["alias"], "trusted_roster", result)
        elif op == "designation":
            _add_designation(db, db.get(Person, UUID(change["person"])), change["designation"], result)
        elif op == "create":
            person = Person(canonical_name=change["name"], active_status="active")
            db.add(person)
            db.flush()
            if change["alias"]:
                _add_alias(db, person, change["alias"], "trusted_roster", result)
            _add_designation(db, person, change["designation"], result)
            result.created_people += 1
            touched.add(person.id)
    return touched


def _summary(rows: list[dict], changes: list[dict], mode: str) -> RosterReconciliationResult:
    review = [row for row in rows if row["status"] != "matched" and row["action"] != "create"]
    result = RosterReconciliationResult(
        roster_entries=len(rows), matched_people=sum(1 for row in rows if row["status"] == "matched"),
        mode=mode, preview_token=preview_token(changes), needs_review=len(review), rows=rows)
    if mode == "preview":
        result.created_people = sum(1 for c in changes if c["op"] == "create")
        result.renamed_people = sum(1 for c in changes if c["op"] == "rename")
        result.merged_people = sum(1 for c in changes if c["op"] == "merge")
        result.aliases_created = sum(1 for c in changes if c["op"] == "alias")
        result.designations_created = sum(1 for c in changes if c["op"] == "designation")
    result.examples = [f"{row['raw_name']} -> {row['roster_name']} ({row['action']})"
                       for row in rows if row["action"] in {"rename", "merge", "create"}][:10]
    return result


def _unmatched(db: Session, matched: set[str]) -> int:
    return sum(1 for person_id in db.scalars(select(Person.id)) if str(person_id) not in matched)


def preview_roster_reconciliation(db: Session, path: Path = DEFAULT_ROSTER_PATH) -> RosterReconciliationResult:
    """What reconciliation would change. Makes no database changes."""
    rows, changes = plan_roster_reconciliation(db, extract_department_roster(path))
    result = _summary(rows, changes, "preview")
    result.unmatched_database_people = _unmatched(db, {r["person_id"] for r in rows if r["status"] == "matched"})
    return result


def reconcile_department_roster(
    db: Session,
    path: Path = DEFAULT_ROSTER_PATH,
    token: str | None = None,
) -> RosterReconciliationResult:
    """Apply the reviewed preview. Raises ``StalePreviewError`` if ``token`` is stale."""
    rows, changes = plan_roster_reconciliation(db, extract_department_roster(path))
    check_preview_token(preview_token(changes), token, "roster reconciliation")
    result = _summary(rows, changes, "applied")
    try:
        created = _apply(db, changes, result)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise
    matched = {r["person_id"] for r in rows if r["status"] == "matched"} | {str(i) for i in created}
    result.unmatched_database_people = _unmatched(db, matched)
    return result
