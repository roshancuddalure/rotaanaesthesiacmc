"""Reviewable uploads of completed duties, independent of the legacy folder rebuild."""

import hashlib
import json
from calendar import month_abbr
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import UUID

from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.domain.duty_types import DUTY_TYPES
from app.models import (
    AdminMapping,
    DutyAssignment,
    DutySlot,
    ImportBatch,
    ImportSourceRecord,
    Person,
    RotaPeriod,
)
from app.services.imports import classify_duty_label, duty_window_for_date, parse_rota_workbook
from app.services.leave import month_bounds
from app.services.member_import import candidate_json, cell_text, member_state, open_member_workbook
from app.services.member_resolver import MemberIndex, resolve_rows
from app.services.rota_call_levels import inferred_call_levels_from_duty_type

PAST_SOURCE = "past_duty_upload"
OFFICIAL_STATUSES = {"historical", "approved", "published", "finalized"}
ACTIVE_STATUSES = {"assigned", "confirmed", "draft"}
PAST_FIELDS = ("date", "name", "duty_type", "starts_at", "ends_at", "campus", "slot")
DUTIES = {d.key: d for d in DUTY_TYPES}
UNRESOLVED_MEMBER = (
    "Resolve the member name using the master list. Add missing historical members in Members first."
)


def _duty_area(duty: str | None, campus: str | None) -> str | None:
    """The duty area the resolver's context rules use (CART, CAESAR, PAC), else the campus."""
    key = (duty or "").upper()
    for area in ("CART", "CAESAR", "PAC"):
        if area in key:
            return area
    return campus


def _call_level(duty: str | None) -> str | None:
    levels = inferred_call_levels_from_duty_type(duty)
    return next(iter(levels)) if len(levels) == 1 else None


def open_past_workbook(filename: str, content: bytes):
    from app.services.upload_limits import validate_tabular_upload
    if filename.lower().endswith('.xls'):
        validate_tabular_upload(filename, content)
    if len(content) > 5 * 1024 * 1024:
        raise ValueError("File must be no larger than 5 MB.")
    if filename.lower().endswith(".xls"):
        import xlrd

        try:
            old = xlrd.open_workbook(file_contents=content, on_demand=True)
        except (xlrd.XLRDError, ValueError) as exc:
            raise ValueError("Cannot read this .xls workbook.") from exc
        workbook = Workbook()
        workbook.remove(workbook.active)
        try:
            for source in old.sheets():
                if source.nrows > 5100 or source.ncols > 200:
                    raise ValueError("Use at most 5100 worksheet rows and 200 columns.")
                sheet = workbook.create_sheet(source.name)
                for row in source.get_rows():
                    sheet.append(
                        [
                            xlrd.xldate_as_datetime(c.value, old.datemode)
                            if c.ctype == xlrd.XL_CELL_DATE
                            else c.value
                            for c in row
                        ]
                    )
            return workbook
        finally:
            old.release_resources()
    if not filename.lower().endswith(".xlsx"):
        raise ValueError("Upload an .xls or .xlsx workbook.")
    # Reuse the bounded ZIP validation for Excel uploads.
    return open_member_workbook(filename, content)


def inspect_past_workbook(filename: str, content: bytes, header_row: int = 1):
    if not 1 <= header_row <= 100:
        raise ValueError("Header row must be between 1 and 100.")
    workbook = open_past_workbook(filename, content)
    try:
        sheets = []
        for sheet in workbook:
            if (sheet.max_row or 0) > 5100 or (sheet.max_column or 0) > 200:
                raise ValueError("Use at most 5100 worksheet rows and 200 columns.")
            cells = next(
                sheet.iter_rows(
                    min_row=header_row,
                    max_row=header_row,
                    max_col=min(sheet.max_column or 50, 200),
                    values_only=True,
                ),
                (),
            )
            headers = [cell_text(v) for v in cells]
            aliases = {
                "date": {"date", "duty date"},
                "name": {"name", "doctor", "member name", "person"},
                "duty_type": {"duty type", "duty", "duty label"},
                "starts_at": {"starts at", "start"},
                "ends_at": {"ends at", "end"},
                "campus": {"campus"},
                "slot": {"slot", "slot label"},
            }
            mapping = {}
            for field, labels in aliases.items():
                matches = [
                    i for i, h in enumerate(headers) if h.lower().replace("_", " ") in labels
                ]
                if len(matches) == 1:
                    mapping[field] = matches[0]
            sheets.append({"name": sheet.title, "headers": headers, "mapping": mapping})
        if not sheets:
            raise ValueError("Workbook contains no worksheets.")
        return {"sheets": sheets, "fields": PAST_FIELDS}
    finally:
        workbook.close()


def parse_upload(filename: str, content: bytes, options: dict):
    month = options.get("month", "")
    start, end = month_bounds(month)
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
    if start > today:
        raise ValueError(
            "Select a current or past month; future duties cannot be imported as completed."
        )
    header = options.get("header_row", 1)
    inspection = inspect_past_workbook(filename, content, header)
    info = next((s for s in inspection["sheets"] if s["name"] == options.get("sheet")), None)
    if info is None:
        raise ValueError("Select a worksheet.")
    workbook = open_past_workbook(filename, content)
    records, warnings = [], []
    try:
        sheet = workbook[info["name"]]
        if options.get("layout", "table") == "matrix":
            selected = Workbook()
            dest = selected.active
            dest.title = sheet.title
            formula_warnings = []
            for row_number, cells in enumerate(
                sheet.iter_rows(min_row=header, max_col=200, values_only=True), header
            ):
                values = []
                for column, cell in enumerate(cells, 1):
                    if isinstance(cell, str) and cell.startswith("="):
                        formula_warnings.append(
                            {
                                "row": row_number,
                                "message": f"Formula at column {column} skipped; paste values to import it.",
                                "code": "FORMULA_SKIPPED",
                            }
                        )
                        cell = None
                    values.append(cell)
                dest.append(values)
            try:
                with TemporaryDirectory(prefix="past-rota-") as temporary:
                    path = Path(temporary) / f"{month_abbr[start.month]} {start.year}.xlsx"
                    selected.save(path)
                    parsed = parse_rota_workbook(path)
                    for item in parsed.assignments:
                        records.append(
                            {
                                "row": item.row_index + header - 1,
                                "column": item.column_index,
                                "raw": {
                                    "date": item.duty_date.isoformat(),
                                    "name": item.raw_person_name,
                                    "duty_type": item.duty_label,
                                },
                                "parsed_duty": item.duty_type,
                            }
                        )
                    warnings = [
                        {
                            "row": w.row_index + header - 1 if w.row_index else None,
                            "message": w.message,
                            "code": w.code,
                        }
                        for w in parsed.warnings
                    ]
                    warnings.extend(formula_warnings)
            finally:
                selected.close()
        elif options.get("layout", "table") == "table":
            mapping = options.get("mapping", info["mapping"])
            if not all(field in mapping for field in ("date", "name", "duty_type")):
                raise ValueError("Map date, name, and duty type columns.")
            if any(
                field not in PAST_FIELDS
                or type(col) is not int
                or col < 0
                or col >= len(info["headers"])
                for field, col in mapping.items()
            ) or len(set(mapping.values())) != len(mapping):
                raise ValueError("Invalid or repeated column mapping.")
            for index, cells in enumerate(
                sheet.iter_rows(min_row=header + 1, max_col=200, values_only=True), header + 1
            ):
                if index - header > 5000:
                    raise ValueError("Import at most 5000 rows.")
                raw = {
                    field: (
                        cells[col].isoformat()
                        if field in {"starts_at", "ends_at"}
                        and col < len(cells)
                        and isinstance(cells[col], datetime)
                        else cell_text(cells[col])
                        if col < len(cells)
                        else ""
                    )
                    for field, col in mapping.items()
                }
                if any(raw.values()):
                    records.append({"row": index, "column": mapping["name"] + 1, "raw": raw})
        else:
            raise ValueError("Choose table or departmental matrix layout.")
    finally:
        workbook.close()
    if len(records) > 10000:
        raise ValueError("Import at most 10000 duty assignments at a time.")
    return records, warnings, start, end, today


def preview_past_duties(db: Session, filename: str, content: bytes, options: dict):
    records, warnings, start, end, today = parse_upload(filename, content, options)
    _, members_snapshot = member_state(db)
    index = MemberIndex.load(db)
    periods = list(
        db.scalars(
            select(RotaPeriod).where(RotaPeriod.starts_on <= end, RotaPeriod.ends_on >= start)
        )
    )
    period_errors = (
        [
            "This month has an unfinished rota. Publish/finalize it before importing completed duties."
        ]
        if any(p.status not in OFFICIAL_STATUSES for p in periods)
        else []
    )
    existing = list(
        db.scalars(
            select(DutyAssignment)
            .join(DutyAssignment.duty_slot)
            .where(DutySlot.duty_date >= start, DutySlot.duty_date <= end)
            .options(selectinload(DutyAssignment.duty_slot).selectinload(DutySlot.rota_period))
        )
    )
    mappings = list(
        db.scalars(select(AdminMapping).where(AdminMapping.mapping_type == "duty_label"))
    )
    mapping_lookup = {m.source_label.casefold().strip(): m for m in mappings}
    rows, seen, replacements = [], set(), set()
    upload_positions = {}
    saved_slots = list(
        db.scalars(select(DutySlot).where(DutySlot.duty_date >= start, DutySlot.duty_date <= end))
    )
    resolutions = options.get("resolutions", {})
    # First pass: each row's date and duty give the resolver its context, so the whole file
    # is resolved together and contradictions between rows are flagged.
    contexts = {}
    for position, record in enumerate(records, 1):
        resolution = resolutions.get(str(position), {})
        if resolution.get("action") == "skip":
            continue
        raw = record["raw"]
        day, _ = _duty_day(raw, start, end, today)
        duty = _duty_for(record, resolution, mapping_lookup)
        chosen = resolution.get("person_id")
        contexts[position] = {
            "raw_name": raw.get("name", ""),
            "person_id": chosen if chosen and _known_id(index, chosen) else None,
            "unknown_id": bool(chosen) and not _known_id(index, chosen),
            "call_level": _call_level(duty),
            "on": day,
            "duty_area": _duty_area(duty, raw.get("campus", "").strip().upper() or None),
        }
    ordered = sorted(contexts)
    resolved = dict(zip(ordered, resolve_rows(index, [contexts[p] for p in ordered], purpose="history")))
    for position, record in enumerate(records, 1):
        key = str(position)
        raw = record["raw"]
        resolution = resolutions.get(key, {})
        if resolution.get("action") == "skip":
            rows.append(
                {
                    **record,
                    "key": key,
                    "normalized": {},
                    "action": "skip",
                    "errors": [],
                    "person_candidates": [],
                    "resolution_status": None,
                    "resolution_reason": "",
                    "resolution_warnings": [],
                    "conflicts": [],
                    "target_assignment": None,
                }
            )
            continue
        errors = list(period_errors)
        if any(v.startswith("=") for v in raw.values()):
            errors.append("Formula cells must be replaced with values.")
        day, date_error = _duty_day(raw, start, end, today)
        if date_error:
            errors.append(date_error)
        member = resolved[position]
        person_id = member.person_id if member.matched else None
        if contexts[position]["unknown_id"]:
            person_id = None
            errors.append("Selected member no longer exists.")
        elif person_id is None:
            errors.append(UNRESOLVED_MEMBER)
        duty = _duty_for(record, resolution, mapping_lookup)
        if duty not in DUTIES:
            errors.append("Resolve the duty label to a recognized duty type.")
        starts_at = ends_at = None
        is_24hr = False
        if day and duty in DUTIES:
            starts_at, ends_at, is_24hr = duty_window_for_date(day, duty)
            if bool(raw.get("starts_at")) != bool(raw.get("ends_at")):
                errors.append(
                    "Provide both start and end timestamps, or leave both blank for standard times."
                )
            elif raw.get("starts_at"):
                try:
                    starts_at = datetime.fromisoformat(raw["starts_at"])
                    ends_at = datetime.fromisoformat(raw["ends_at"])
                    if (
                        starts_at.tzinfo
                        or ends_at.tzinfo
                        or starts_at.date() != day
                        or not 0 < (ends_at - starts_at).total_seconds() <= 48 * 3600
                    ):
                        raise ValueError()
                    is_24hr = (ends_at - starts_at).total_seconds() == 24 * 3600
                except ValueError:
                    errors.append(
                        "Use valid local ISO timestamps spanning 1–48 hours, with start on the duty date."
                    )
        slot_label = raw.get("slot", "").strip()
        campus = raw.get("campus", "").strip().upper() or None
        if len(slot_label) > 100 or (campus and len(campus) > 100):
            errors.append("Slot/campus label exceeds 100 characters.")
        normalized = {
            "date": day.isoformat() if day else None,
            "person_id": person_id,
            "name": member.canonical_name if person_id else raw.get("name"),
            "duty_type": duty,
            "starts_at": starts_at.isoformat() if starts_at else None,
            "ends_at": ends_at.isoformat() if ends_at else None,
            "is_24hr": is_24hr,
            "campus": campus,
            "slot": slot_label,
        }
        matching = [
            a
            for a in existing
            if a.status in ACTIVE_STATUSES
            and a.duty_slot.duty_date == day
            and a.duty_slot.duty_type == duty
        ]
        exact = [a for a in matching if str(a.person_id) == person_id]
        target = None
        action = "create"
        if exact:
            action = "unchanged"
            target = exact[0]
            if any(
                a.duty_slot.starts_at != starts_at or a.duty_slot.ends_at != ends_at for a in exact
            ):
                errors.append(
                    "Recorded times differ. Correct times in the source or skip this row; time edits require manual review."
                )
        elif matching:
            replace_id = resolution.get("replace_assignment_id")
            target = next((a for a in matching if str(a.id) == replace_id), None)
            if target:
                action = "correct"
                if target.duty_slot.starts_at != starts_at or target.duty_slot.ends_at != ends_at:
                    errors.append(
                        "Correction times differ from the recorded duty. Correct source times or skip; this workflow changes the assigned member only."
                    )
                if str(target.id) in replacements:
                    errors.append("Multiple rows replace the same duty assignment.")
                replacements.add(str(target.id))
            elif resolution.get("action") == "additional" and slot_label:
                action = "create"
                if any(a.duty_slot.slot_label == slot_label for a in matching):
                    errors.append(
                        "Additional parallel duties need a slot label not already used for this date and duty."
                    )
            else:
                errors.append(
                    "A different member already has this duty/date. Select a correction or skip; additional parallel duties need a distinct slot label."
                )
        if action == "create" and day and duty in DUTIES and person_id:
            position = (day, duty)
            previous_rows = upload_positions.get(position, [])
            if any(previous_person != person_id for previous_person, _ in previous_rows):
                if (
                    resolution.get("action") != "additional"
                    or not slot_label
                    or any(
                        not previous_slot or previous_slot == slot_label
                        for _, previous_slot in previous_rows
                    )
                ):
                    errors.append(
                        "Another upload row assigns this duty/date to a different member. Give parallel duties distinct slot labels and explicitly select Additional, or skip the duplicate."
                    )
            upload_positions.setdefault(position, []).append((person_id, slot_label))
            reserved_label = slot_label or f"past:{person_id}"
            reserved_slots = [
                saved
                for saved in saved_slots
                if saved.duty_date == day
                and saved.duty_type == duty
                and saved.slot_label == reserved_label
            ]
            if any(
                saved.starts_at != starts_at or saved.ends_at != ends_at for saved in reserved_slots
            ):
                errors.append(
                    "This saved slot has different times, even though its assignment is inactive. Correct source times or use a distinct reviewed slot."
                )
        signature = (normalized["date"], duty, person_id)
        if signature in seen:
            errors.append(
                "Duplicate person/date/duty in this upload; retain one row and skip the duplicate."
            )
        seen.add(signature)
        conflicts = [
            {
                "id": str(a.id),
                "person_id": str(a.person_id),
                "name": db.get(Person, a.person_id).canonical_name,
                "slot": a.duty_slot.slot_label,
                "source": a.duty_slot.source,
            }
            for a in matching
        ]
        rows.append(
            {
                **record,
                "key": key,
                "normalized": normalized,
                "action": "needs_review" if errors else action,
                "errors": errors,
                "person_candidates": [candidate_json(c) for c in member.candidates],
                "resolution_status": member.status,
                "resolution_reason": member.reason,
                "resolution_warnings": list(member.warnings),
                "conflicts": conflicts,
                "target_assignment": str(target.id) if target else None,
            }
        )
    snapshot = [
        (
            str(a.id),
            str(a.person_id),
            a.status,
            a.duty_slot.duty_type,
            str(a.duty_slot.starts_at),
            str(a.duty_slot.ends_at),
        )
        for a in existing
    ]
    slot_snapshot = sorted(
        (
            str(saved.id),
            str(saved.rota_period_id),
            saved.slot_label,
            saved.source,
            saved.duty_type,
            str(saved.starts_at),
            str(saved.ends_at),
            saved.is_24hr,
        )
        for saved in saved_slots
    )
    digest = hashlib.sha256(
        json.dumps(
            [
                rows,
                warnings,
                sorted(snapshot),
                slot_snapshot,
                members_snapshot,
                [(str(p.id), p.status) for p in periods],
                options.get("month"),
                options.get("sheet"),
                filename,
                {key:value for key,value in options.items() if key not in {"confirm_corrections","confirm_warnings"}},
                hashlib.sha256(content).hexdigest(),
            ],
            sort_keys=True,
        ).encode()
    ).hexdigest()
    return {
        "rows": rows,
        "warnings": warnings,
        "preview_hash": digest,
        "counts": {
            action: sum(r["action"] == action for r in rows)
            for action in ("create", "unchanged", "correct", "needs_review", "skip")
        },
        "month": options["month"],
        "sheet": options["sheet"],
    }


def _known_id(index: MemberIndex, person_id) -> bool:
    try:
        return UUID(str(person_id)) in index.by_id
    except ValueError:
        return False


def _duty_day(raw: dict, start: date, end: date, today: date):
    try:
        day = date.fromisoformat(raw.get("date", "").split("T")[0].split(" ")[0])
        if not start <= day <= end or day >= today:
            raise ValueError()
        return day, None
    except ValueError:
        return None, (
            "Duty date must be a completed past date in the selected month (YYYY-MM-DD or Excel date)."
        )


def _duty_for(record: dict, resolution: dict, mapping_lookup: dict):
    raw_duty = record["raw"].get("duty_type", "")
    mapping = mapping_lookup.get(raw_duty.casefold().strip())
    if mapping and mapping.status == "needs_review" and not resolution.get("duty_type"):
        return None
    return (
        resolution.get("duty_type")
        or (mapping.target_key if mapping and mapping.status != "needs_review" else None)
        or record.get("parsed_duty")
        or (raw_duty if raw_duty in DUTIES else classify_duty_label(raw_duty))
    )


def apply_past_duties(
    db: Session, filename: str, content: bytes, options: dict, preview_hash: str, actor_id: str
):
    from app.services.reviewed_import import acquire_import_lock, replayed_result, attach_result
    acquire_import_lock(db)
    replay = replayed_result(db, PAST_SOURCE, preview_hash, actor_id, filename, content, options)
    if replay is not None:
        return replay
    preview = preview_past_duties(db, filename, content, options)
    if preview_hash != preview["preview_hash"]:
        raise ValueError("File, selections, or saved duties changed. Preview again.")
    if preview["counts"]["needs_review"]:
        raise ValueError("Resolve or skip all review items first.")
    if preview["warnings"] and not options.get("confirm_warnings"):
        raise ValueError("Acknowledge parser warnings before importing.")
    if preview["counts"]["correct"] and not options.get("confirm_corrections"):
        raise ValueError("Explicitly approve the recorded duty corrections.")
    if not preview["rows"]:
        raise ValueError("No duty assignments were found.")
    start, end = month_bounds(preview["month"])
    batch = ImportBatch(
        source_filename=Path(filename).name[:255],
        import_kind=PAST_SOURCE,
        status="completed",
        completed_at=datetime.utcnow(),
        source_metadata={
            "actor_id": actor_id,
            "month": preview["month"],
            "sheet": preview["sheet"],
            "counts": preview["counts"],
            "preview_hash": preview_hash,
            "file_sha256": hashlib.sha256(content).hexdigest(),
            "warnings": preview["warnings"],
            "corrections_approved": bool(options.get("confirm_corrections")),
        },
    )
    try:
        db.add(batch)
        db.flush()
        period = db.scalar(
            select(RotaPeriod).where(RotaPeriod.starts_on == start, RotaPeriod.ends_on == end)
        )
        if period is None and any(row["action"] == "create" for row in preview["rows"]):
            period = RotaPeriod(
                name=preview["month"], starts_on=start, ends_on=end, status="historical"
            )
            db.add(period)
            db.flush()
        for row in preview["rows"]:
            data = row["normalized"]
            assignment = (
                db.get(DutyAssignment, UUID(row["target_assignment"]))
                if row["target_assignment"]
                else None
            )
            before = None
            if row["action"] == "correct":
                before = {
                    "assignment_id": str(assignment.id),
                    "person_id": str(assignment.person_id),
                    "name": db.get(Person, assignment.person_id).canonical_name,
                    "status": assignment.status,
                }
                slot = assignment.duty_slot
                assignment.status = "superseded"
                replacement = db.scalar(
                    select(DutyAssignment).where(
                        DutyAssignment.duty_slot_id == slot.id,
                        DutyAssignment.person_id == UUID(data["person_id"]),
                    )
                )
                if replacement:
                    replacement.status = "confirmed"
                    assignment = replacement
                else:
                    assignment = DutyAssignment(
                        duty_slot=slot,
                        person_id=UUID(data["person_id"]),
                        source=PAST_SOURCE,
                        status="confirmed",
                        override_reason=f"Reviewed correction in batch {batch.id}",
                    )
                    db.add(assignment)
            elif row["action"] == "create":
                label = data["slot"] or f"past:{data['person_id']}"
                slot = db.scalar(
                    select(DutySlot).where(
                        DutySlot.rota_period_id == period.id,
                        DutySlot.duty_date == date.fromisoformat(data["date"]),
                        DutySlot.duty_type == data["duty_type"],
                        DutySlot.slot_label == label,
                    )
                )
                if slot is None:
                    slot = DutySlot(
                        rota_period=period,
                        duty_date=date.fromisoformat(data["date"]),
                        duty_type=data["duty_type"],
                        slot_label=label,
                        starts_at=datetime.fromisoformat(data["starts_at"]),
                        ends_at=datetime.fromisoformat(data["ends_at"]),
                        is_24hr=data["is_24hr"],
                        source=PAST_SOURCE,
                        notes=json.dumps({"campus": data["campus"], "batch_id": str(batch.id)}),
                    )
                    db.add(slot)
                    db.flush()
                assignment = db.scalar(
                    select(DutyAssignment).where(
                        DutyAssignment.duty_slot_id == slot.id,
                        DutyAssignment.person_id == UUID(data["person_id"]),
                    )
                )
                if assignment:
                    assignment.status = "confirmed"
                else:
                    assignment = DutyAssignment(
                        duty_slot=slot,
                        person_id=UUID(data["person_id"]),
                        source=PAST_SOURCE,
                        status="confirmed",
                    )
                    db.add(assignment)
            if assignment:
                db.flush()
            db.add(
                ImportSourceRecord(
                    batch=batch,
                    sheet_name=preview["sheet"],
                    row_index=row["row"],
                    column_index=row["column"],
                    record_type="past_duty",
                    raw_value=json.dumps(row["raw"]),
                    cleaned_value=json.dumps(data),
                    normalized_table="duty_assignments" if assignment else None,
                    normalized_id=assignment.id if assignment else None,
                    rule_key="past_duty_upload_v1",
                    notes=json.dumps(
                        {"action": row["action"], "before": before, "errors": row["errors"]}
                    ),
                )
            )
        db.flush()
        result = {"batch_id": str(batch.id), "counts": preview["counts"], "month": preview["month"], "replayed": False}
        attach_result(batch, result, filename, content, options)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return result
