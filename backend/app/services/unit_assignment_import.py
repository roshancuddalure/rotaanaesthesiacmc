from __future__ import annotations

import io
import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from uuid import UUID

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import PersonPosting, Unit
from app.services.imports import (
    ParseWarning,
    ParsedUnitPosting,
    clean_cell_value,
    is_blank_assignment_value,
    normalize_label,
    split_unitwise_names,
)
from app.services.leave import month_bounds
from app.services.leave_import import match_person, person_lookup
from app.services.unit_management import UNIT_BOARD_SOURCE, normalize_posting_type

POSTING_ALIASES = {
    "1STCALL": "1ST_CALL",
    "FIRSTCALL": "1ST_CALL",
    "CO1STCALL": "CO_1ST_CALL",
    "COFIRSTCALL": "CO_1ST_CALL",
    "2NDCALL": "2ND_CALL",
    "SECONDCALL": "2ND_CALL",
    "3RDCALL": "3RD_CALL",
    "THIRDCALL": "3RD_CALL",
    "DMPDF": "3RD_CALL",
    "4THCALL": "4TH_CALL",
    "FOURTHCALL": "4TH_CALL",
    "CO4THCALL": "CO_4TH_CALL",
    "COFOURTHCALL": "CO_4TH_CALL",
    "5THCALL": "5TH_CALL",
    "FIFTHCALL": "5TH_CALL",
    "PAC": "PAC",
    "PAINCALL": "PAIN",
    "PAIN": "PAIN",
    "ICU": "SICU",
    "ICUPOSTING": "SICU",
    "ICUPOSTINGS": "SICU",
    "SICU": "SICU",
    "SICUPOSTING": "SICU",
    "SICUPOSTINGS": "SICU",
    "DRP": "DRP",
    "DRPPOSTING": "DRP",
    "NEUROICU": "NEURO_ICU",
    "NEUROICUPOSTING": "NEURO_ICU",
    "RESERVE": "OTHER_SPECIAL",
}


@dataclass(frozen=True)
class ParsedUnitwiseUpload:
    postings: tuple[ParsedUnitPosting, ...]
    warnings: tuple[ParseWarning, ...]
    sheets: tuple[str, ...]
    source_format: str


def compact_token(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    ascii_text = "".join(character for character in decomposed if not unicodedata.combining(character))
    return re.sub(r"[^A-Za-z0-9]+", "", ascii_text).upper()


def normalize_unit_label(value: str) -> str:
    normalized = normalize_label(value)
    return re.sub(r"\b(unit|ot|campus|main|department|dept)\b", "", normalized).strip()


def normalize_import_posting(value: str) -> str:
    compacted = compact_token(value)
    if compacted in POSTING_ALIASES:
        return POSTING_ALIASES[compacted]
    explicit_call = re.search(
        r"\b(co\s*)?([1-5])(?:st|nd|rd|th)?\s*calls?\b",
        value,
        flags=re.IGNORECASE,
    )
    if explicit_call:
        number = explicit_call.group(2)
        if explicit_call.group(1) and number == "4":
            return "CO_4TH_CALL"
        if explicit_call.group(1) and number == "1":
            return "CO_1ST_CALL"
        return {
            "1": "1ST_CALL",
            "2": "2ND_CALL",
            "3": "3RD_CALL",
            "4": "4TH_CALL",
            "5": "5TH_CALL",
        }[number]
    label = normalize_label(value)
    if "dm pdf" in label:
        return "3RD_CALL"
    if "co" in label and "4" in label and "call" in label:
        return "CO_4TH_CALL"
    if "co" in label and "1" in label and "call" in label:
        return "CO_1ST_CALL"
    if "1" in label and "call" in label:
        return "1ST_CALL"
    if "2" in label and "call" in label:
        return "2ND_CALL"
    if "3" in label and "call" in label:
        return "3RD_CALL"
    if "4" in label and "call" in label:
        return "4TH_CALL"
    if "5" in label and "call" in label:
        return "5TH_CALL"
    if "pac" in label:
        return "PAC"
    if "pain" in label:
        return "PAIN"
    if "neuro" in label and "icu" in label:
        return "NEURO_ICU"
    if "sicu" in label or label in {"icu", "icu posting", "icu postings"}:
        return "SICU"
    if "drp" in label:
        return "DRP"
    if "reserve" in label:
        return "OTHER_SPECIAL"
    return normalize_posting_type(value.replace("calls", "call").replace("CALLS", "CALL"))


def is_unitwise_context_label(value: str) -> bool:
    label = normalize_label(value)
    return label in {
        "main",
        "main campus",
        "ranipet",
        "ranipet campus",
        "rc",
        "unit",
        "date",
        "day",
    }


def posting_allows_context_rows(posting_label: str) -> bool:
    return normalize_import_posting(posting_label) in {"PAIN", "PAC"}


def date_range_label(value: object) -> str | None:
    cleaned = clean_cell_value(value)
    if re.search(r"\b\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:-|to)\s*\d{1,2}\b", cleaned, re.IGNORECASE):
        return cleaned
    return None


def infer_row_date_bounds(*, raw_person_name: str, raw_date_label: str | None, month: str) -> tuple[date, date]:
    month_start, month_end = month_bounds(month)
    for source in (raw_person_name, raw_date_label or ""):
        match = re.search(
            r"\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:-|to)\s*(\d{1,2})\b",
            source,
            flags=re.IGNORECASE,
        )
        if not match:
            continue
        start_day = int(match.group(1))
        end_day = int(match.group(2))
        if end_day < start_day:
            continue
        try:
            return date(month_start.year, month_start.month, start_day), date(
                month_start.year,
                month_start.month,
                end_day,
            )
        except ValueError:
            continue
    return month_start, month_end


def ranges_overlap(first_start: str, first_end: str, second_start: str, second_end: str) -> bool:
    return first_start <= second_end and second_start <= first_end


def parse_unitwise_excel_upload(filename: str, content: bytes) -> ParsedUnitwiseUpload:
    workbook = load_workbook(io.BytesIO(content), data_only=True)
    postings: list[ParsedUnitPosting] = []
    warnings: list[ParseWarning] = []
    sheets: list[str] = []
    source_file = filename
    try:
        for worksheet in workbook.worksheets:
            sheets.append(worksheet.title)
            rows = list(worksheet.iter_rows(values_only=False))
            if not rows:
                warnings.append(
                    ParseWarning(source_file, worksheet.title, None, None, "EMPTY_UNITWISE", "No rows found.")
                )
                continue
            unit_by_column = {
                column_index: clean_cell_value(cell.value)
                for column_index, cell in enumerate(rows[0][1:], start=2)
                if clean_cell_value(cell.value)
            }
            if not unit_by_column:
                warnings.append(
                    ParseWarning(
                        source_file,
                        worksheet.title,
                        1,
                        None,
                        "MISSING_UNIT_HEADER",
                        "No unit headers found in the first row.",
                    )
                )
                continue
            current_posting_label = ""
            date_label_by_column: dict[int, str] = {}
            for row in rows[1:]:
                if not row:
                    continue
                label = clean_cell_value(row[0].value)
                label_is_context = bool(
                    current_posting_label
                    and posting_allows_context_rows(current_posting_label)
                    and is_unitwise_context_label(label)
                )
                if label and not label_is_context:
                    current_posting_label = label
                    date_label_by_column = {}
                if not current_posting_label:
                    continue
                for column_index, cell in enumerate(row[1:], start=2):
                    raw_date_label = date_label_by_column.get(column_index)
                    unit_label = label if label_is_context else unit_by_column.get(column_index)
                    if unit_label is None or is_blank_assignment_value(cell.value):
                        continue
                    names = split_unitwise_names(cell.value)
                    if not names:
                        if posting_allows_context_rows(current_posting_label) and (
                            date_label := date_range_label(cell.value)
                        ):
                            date_label_by_column[column_index] = date_label
                            continue
                        warnings.append(
                            ParseWarning(
                                source_file,
                                worksheet.title,
                                cell.row,
                                column_index,
                                "INVALID_PERSON_NAME",
                                f"Discarded non-person unitwise value: {clean_cell_value(cell.value)}",
                            )
                        )
                        continue
                    for person_name in names:
                        postings.append(
                            ParsedUnitPosting(
                                source_file=source_file,
                                sheet_name=worksheet.title,
                                unit_label=unit_label,
                                posting_label=current_posting_label,
                                person_name=person_name,
                                raw_person_name=clean_cell_value(cell.value),
                                row_index=cell.row,
                                column_index=column_index,
                                column_label=get_column_letter(column_index),
                                raw_date_label=raw_date_label,
                            )
                        )
    finally:
        workbook.close()
    return ParsedUnitwiseUpload(tuple(postings), tuple(warnings), tuple(sheets), "excel_unitwise")


def text_lines(filename: str, content: bytes) -> list[str]:
    last_error: UnicodeDecodeError | None = None
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin1"):
        try:
            return content.decode(encoding).splitlines()
        except UnicodeDecodeError as exc:
            last_error = exc
    raise ValueError(f"Unable to read text unitwise file: {last_error}") from last_error


def line_unit_match(line: str, unit_labels: dict[str, str]) -> str | None:
    key = normalize_unit_label(line)
    if key in unit_labels:
        return unit_labels[key]
    line_key = normalize_unit_label(re.split(r"[:|,\t-]", line, maxsplit=1)[0])
    return unit_labels.get(line_key)


def posting_from_line(line: str) -> tuple[str | None, str]:
    patterns = [
        r"\bco\s*4(?:th)?\s*calls?\b",
        r"\b[1-5](?:st|nd|rd|th)?\s*calls?\b",
        r"\bfirst\s*calls?\b",
        r"\bsecond\s*calls?\b",
        r"\bthird\s*calls?\b",
        r"\bfourth\s*calls?\b",
        r"\bfifth\s*calls?\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, line, re.IGNORECASE)
        if match:
            remainder = (line[: match.start()] + " " + line[match.end() :]).strip(" :-|\t")
            return match.group(0), remainder
    return None, line


def parse_unitwise_text_upload(filename: str, content: bytes, units: list[Unit]) -> ParsedUnitwiseUpload:
    unit_labels: dict[str, str] = {}
    for unit in units:
        for label in (unit.name, unit.code):
            unit_labels[normalize_unit_label(label)] = unit.name

    postings: list[ParsedUnitPosting] = []
    warnings: list[ParseWarning] = []
    current_unit = ""
    current_posting = ""
    for row_number, raw_line in enumerate(text_lines(filename, content), start=1):
        line = clean_cell_value(raw_line)
        if not line:
            continue
        detected_unit = line_unit_match(line, unit_labels)
        if detected_unit and normalize_unit_label(line) in unit_labels:
            current_unit = detected_unit
            continue

        working_line = line
        if detected_unit:
            current_unit = detected_unit
            working_line = re.split(r"[:|,\t-]", line, maxsplit=1)[-1].strip()
        posting_label, remainder = posting_from_line(working_line)
        if posting_label:
            current_posting = posting_label
            working_line = remainder
        if not current_unit or not current_posting:
            warnings.append(
                ParseWarning(
                    filename,
                    "Text",
                    row_number,
                    None,
                    "MISSING_CONTEXT",
                    f"Could not determine unit/posting for line: {line}",
                )
            )
            continue
        if not working_line:
            continue
        names = split_unitwise_names(working_line)
        if not names:
            warnings.append(
                ParseWarning(
                    filename,
                    "Text",
                    row_number,
                    None,
                    "INVALID_PERSON_NAME",
                    f"Discarded non-person unitwise value: {line}",
                )
            )
            continue
        for person_name in names:
            postings.append(
                ParsedUnitPosting(
                    source_file=filename,
                    sheet_name="Text",
                    unit_label=current_unit,
                    posting_label=current_posting,
                    person_name=person_name,
                    raw_person_name=working_line,
                    row_index=row_number,
                    column_index=1,
                    column_label="A",
                )
            )
    return ParsedUnitwiseUpload(tuple(postings), tuple(warnings), ("Text",), "text_unitwise")


def read_unitwise_upload(db: Session, filename: str, content: bytes) -> ParsedUnitwiseUpload:
    lowered = filename.lower()
    if lowered.endswith((".xlsx", ".xlsm")):
        return parse_unitwise_excel_upload(filename, content)
    if lowered.endswith((".txt", ".csv")):
        units = list(db.scalars(select(Unit).where(Unit.active_status == "active")))
        return parse_unitwise_text_upload(filename, content, units)
    raise ValueError("Unit assignment import supports XLSX, XLSM, TXT, or CSV files")


def unit_lookup(db: Session) -> dict[str, Unit | None]:
    units = list(db.scalars(select(Unit).where(Unit.active_status == "active")))
    lookup: dict[str, Unit | None] = {}
    for unit in units:
        for label in (unit.code, unit.name):
            for key in {normalize_label(label), normalize_unit_label(label)}:
                existing = lookup.get(key)
                if existing is not None and existing.id != unit.id:
                    lookup[key] = None
                elif key:
                    lookup[key] = unit
        unit_text = f"{unit.code} {unit.name}".casefold()
        extra_labels: list[str] = []
        if "main" in unit_text:
            extra_labels.extend(["main", "main campus"])
        if "ranipet" in unit_text or re.search(r"\brc\b", unit_text):
            extra_labels.extend(["ranipet", "ranipet campus", "rc"])
        for label in extra_labels:
            key = normalize_label(label)
            existing = lookup.get(key)
            if existing is not None and existing.id != unit.id:
                lookup[key] = None
            else:
                lookup[key] = unit
    return lookup


def match_unit(raw_label: str, lookup: dict[str, Unit | None]) -> tuple[Unit | None, str | None]:
    for key in (normalize_label(raw_label), normalize_unit_label(raw_label)):
        if key in lookup:
            return lookup[key], "unit_exact" if lookup[key] is not None else "unit_ambiguous"
    return None, None


def existing_unit_board_keys(db: Session, month: str) -> set[tuple[str, str, str]]:
    starts_on, ends_on = month_bounds(month)
    postings = db.scalars(
        select(PersonPosting).where(
            PersonPosting.source == UNIT_BOARD_SOURCE,
            PersonPosting.starts_on <= ends_on,
            (PersonPosting.ends_on.is_(None)) | (PersonPosting.ends_on >= starts_on),
        )
    )
    return {
        (str(posting.person_id), str(posting.unit_id), normalize_posting_type(posting.posting_type))
        for posting in postings
    }


def warning_to_text(warning: ParseWarning) -> str:
    location = f"{warning.sheet_name}"
    if warning.row_index is not None:
        location += f" row {warning.row_index}"
    if warning.column_index is not None:
        location += f" col {warning.column_index}"
    return f"{location}: {warning.message}"


def make_preview_row(
    posting: ParsedUnitPosting,
    *,
    person_matches,
    units: dict[str, Unit | None],
    existing_keys: set[tuple[str, str, str]],
    month: str,
) -> dict[str, object]:
    issues: list[str] = []
    person, match_method, match_confidence, suggestion = match_person(posting.person_name, person_matches)
    unit, unit_match_method = match_unit(posting.unit_label, units)
    posting_type = normalize_import_posting(posting.posting_label)
    starts_on, ends_on = infer_row_date_bounds(
        raw_person_name=posting.raw_person_name,
        raw_date_label=posting.raw_date_label,
        month=month,
    )
    if match_confidence == "ambiguous":
        issues.append("Ambiguous department member match")
    elif person is None:
        issues.append("Unresolved department member")
        if suggestion is not None:
            issues.append(f"Suggested match: {suggestion.canonical_name}")
    if unit_match_method == "unit_ambiguous":
        issues.append("Ambiguous unit match")
    elif unit is None:
        issues.append("Unresolved unit")
    if not posting_type:
        issues.append("Missing posting/call level")
    if person is not None and unit is not None:
        key = (str(person.id), str(unit.id), posting_type)
        if key in existing_keys:
            issues.append("Existing matching unit assignment already recorded")
    return {
        "row_number": posting.row_index,
        "sheet_name": posting.sheet_name,
        "column_label": posting.column_label,
        "raw_person_name": posting.raw_person_name,
        "cleaned_person_name": posting.person_name,
        "person_id": str(person.id) if person else None,
        "person_name": person.canonical_name if person else None,
        "suggested_person_id": str(suggestion.id) if suggestion else None,
        "suggested_person_name": suggestion.canonical_name if suggestion else None,
        "match_method": match_method,
        "match_confidence": match_confidence,
        "raw_unit_label": posting.unit_label,
        "unit_id": str(unit.id) if unit else None,
        "unit_name": unit.name if unit else None,
        "unit_match_method": unit_match_method,
        "raw_posting_label": posting.posting_label,
        "posting_type": posting_type,
        "starts_on": starts_on.isoformat(),
        "ends_on": ends_on.isoformat(),
        "preview_status": "matched" if not issues else "needs_review",
        "issues": issues,
    }


def mark_duplicate_import_rows(rows: list[dict[str, object]]) -> None:
    seen: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        person_id = row.get("person_id")
        if not person_id:
            continue
        overlaps = [
            previous
            for previous in seen.get(str(person_id), [])
            if ranges_overlap(
                str(row.get("starts_on")),
                str(row.get("ends_on")),
                str(rows[previous].get("starts_on")),
                str(rows[previous].get("ends_on")),
            )
        ]
        if overlaps:
            row["preview_status"] = "needs_review"
            row["issues"].append("Person appears more than once in this import for overlapping dates")  # type: ignore[union-attr]
            for previous in overlaps:
                rows[previous]["preview_status"] = "needs_review"
                rows[previous]["issues"].append(  # type: ignore[union-attr]
                    "Person appears more than once in this import for overlapping dates"
                )
        seen.setdefault(str(person_id), []).append(index)


def preview_unit_assignment_import(db: Session, filename: str, content: bytes, month: str) -> dict[str, object]:
    month_bounds(month)
    parsed = read_unitwise_upload(db, filename, content)
    person_matches = person_lookup(db)
    units = unit_lookup(db)
    existing_keys = existing_unit_board_keys(db, month)
    rows = [
        make_preview_row(
            posting,
            person_matches=person_matches,
            units=units,
            existing_keys=existing_keys,
            month=month,
        )
        for posting in parsed.postings
    ]
    mark_duplicate_import_rows(rows)
    matched = sum(1 for row in rows if row["preview_status"] == "matched")
    unresolved = sum(
        1
        for row in rows
        if "Unresolved department member" in row["issues"] or "Unresolved unit" in row["issues"]
    )
    invalid = sum(1 for row in rows if row["preview_status"] != "matched") - unresolved
    return {
        "filename": filename,
        "month": month,
        "total_rows": len(rows),
        "matched_rows": matched,
        "unresolved_rows": unresolved,
        "invalid_rows": max(0, invalid),
        "sheets": list(parsed.sheets),
        "source_formats": [parsed.source_format],
        "parser_warnings": [warning_to_text(warning) for warning in parsed.warnings],
        "rows": rows,
    }


def row_is_safe_to_apply(row: dict[str, object]) -> bool:
    return (
        row.get("preview_status") == "matched"
        and row.get("person_id")
        and row.get("unit_id")
        and row.get("posting_type")
        and not row.get("issues")
    )


def clear_unit_board_month(db: Session, month: str) -> int:
    starts_on, ends_on = month_bounds(month)
    result = db.execute(
        delete(PersonPosting).where(
            PersonPosting.source == UNIT_BOARD_SOURCE,
            PersonPosting.starts_on <= ends_on,
            (PersonPosting.ends_on.is_(None)) | (PersonPosting.ends_on >= starts_on),
        )
    )
    return result.rowcount or 0


def apply_unit_assignment_import(
    db: Session,
    filename: str,
    content: bytes,
    month: str,
    *,
    replace_existing: bool = False,
) -> dict[str, object]:
    preview = preview_unit_assignment_import(db, filename, content, month)
    starts_on, ends_on = month_bounds(month)
    deleted_rows = clear_unit_board_month(db, month) if replace_existing else 0
    created = 0
    skipped_rows: list[dict[str, object]] = []
    for row in preview["rows"]:
        if not row_is_safe_to_apply(row):
            skipped_rows.append(row)
            continue
        db.add(
            PersonPosting(
                person_id=UUID(str(row["person_id"])),
                unit_id=UUID(str(row["unit_id"])),
                posting_type=str(row["posting_type"]),
                starts_on=date.fromisoformat(str(row.get("starts_on") or starts_on.isoformat())),
                ends_on=date.fromisoformat(str(row.get("ends_on") or ends_on.isoformat())),
                source=UNIT_BOARD_SOURCE,
                notes=(
                    f"Imported from {filename}, sheet {row.get('sheet_name')}, "
                    f"row {row.get('row_number')}"
                ),
            )
        )
        created += 1
    db.commit()
    return {
        "filename": filename,
        "month": month,
        "created_rows": created,
        "deleted_existing_rows": deleted_rows,
        "skipped_rows": len(skipped_rows),
        "skipped_preview_rows": skipped_rows,
        "preview": preview,
    }
