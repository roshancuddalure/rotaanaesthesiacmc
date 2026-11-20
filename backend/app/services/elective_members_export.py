"""Daily elective availability export from canonical interval and locked-scope inputs."""

from collections import defaultdict
from datetime import datetime, time
from io import BytesIO

import xlsxwriter
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models import MonthlyGenerationScope, RotaPeriod
from app.services.leave import date_range, month_bounds
from app.services.ot_availability import canonical_availability
from app.services.ot_calendar import OtRequirement
from app.services.ot_capacity import eligible, overlaps
from app.services.rota_rules import read_phase_one_rules
from app.services.rota_publish import write_rows
from app.services.reference_registry import lock_namespace
from app.services.scheduling_inputs import lock_inputs

LEVELS = ("1ST_CALL", "2ND_CALL", "3RD_CALL", "4TH_CALL", "CO_4TH_CALL", "5TH_CALL")


def elective_members_export(db, month, starts="08:00", ends="17:00"):
    first, last = month_bounds(month)
    if not 2 <= first.year <= 9998:
        raise HTTPException(422, "Elective availability exports support years 0002 through 9998 for rest-boundary checks")
    try:
        start, end = time.fromisoformat(starts), time.fromisoformat(ends)
        if len(starts) != 5 or len(ends) != 5 or start.tzinfo or end.tzinfo or start >= end:
            raise ValueError()
    except ValueError as exc:
        raise HTTPException(422, "Choose an increasing same-day elective window as HH:MM") from exc
    lock_namespace(db, "elective-members-export")
    lock_inputs(db)
    scope = db.scalar(select(MonthlyGenerationScope).join(MonthlyGenerationScope.rota_period).where(
        RotaPeriod.starts_on == first, RotaPeriod.ends_on == last).options(selectinload(MonthlyGenerationScope.units)))
    if scope is None or not scope.is_locked:
        raise HTTPException(409, "Lock the month's unit scope before exporting elective members")
    units = sorted((row.unit for row in scope.units if row.status == "included" and row.unit
                    and row.unit.active_status == "active"), key=lambda u: (u.name, str(u.id)))
    if not units:
        raise HTTPException(409, "The locked scope has no active included units")
    if len(units) > 100:
        raise HTTPException(422, "Export is limited to 100 included units per month")
    requirements = [OtRequirement(id=f"{day}:{unit.id}", unit_id=unit.id, area_key="availability",
        band_key="export", starts_at=datetime.combine(day, start), ends_at=datetime.combine(day, end),
        call_levels=LEVELS, minimum=0, target=0)
        for day in date_range(first, last) for unit in units]
    rules = read_phase_one_rules(db)
    if rules is None:
        raise HTTPException(409, "Configure rota rules before exporting elective availability")
    availability = canonical_availability(db, requirements, rules)
    people = {person.id: person for person in availability["people"]}
    if len(people) > 10000:
        raise HTTPException(422, "Export is limited to 10,000 posted members per month")
    # Reuse already-loaded identities; no private notes are exported.
    from app.models import Person
    names = {p.id: p.canonical_name for p in db.scalars(select(Person).where(Person.id.in_(people)))}
    pending = defaultdict(list)
    for fact in availability["facts"]:
        if fact["code"] == "pending_leave":
            pending[fact["person_id"]].extend(fact["intervals"])
    output = BytesIO()
    book = xlsxwriter.Workbook(output, {"in_memory": True, "strings_to_formulas": False, "strings_to_urls": False})
    for day in date_range(first, last):
        day_needs = [r for r in requirements if r.starts_at.date() == day]
        candidates = defaultdict(list)
        for need in day_needs:
            for pid, person in people.items():
                if eligible(person, need):
                    candidates[pid].append(need)
        rows = []
        ambiguous = {pid for pid, matches in candidates.items() if len(matches) > 1}
        for unit in units:
            need = next(r for r in day_needs if r.unit_id == unit.id)
            found = []
            for pid, matches in candidates.items():
                if pid in ambiguous or need not in matches:
                    continue
                person = people[pid]
                levels = {w.call_level for w in person.windows if w.unit_id == unit.id and overlaps(w, need)}
                risk = any(datetime.fromisoformat(span["starts_at"]) < need.ends_at and
                           need.starts_at < datetime.fromisoformat(span["ends_at"])
                           for span in pending[str(pid)])
                found.append([unit.name, unit.code, names[pid], ", ".join(sorted(levels)),
                              "Pending leave overlaps - confirm" if risk else "No pending leave overlap"])
            rows.extend(sorted(found, key=lambda r: (r[3], r[2])))
            if not found:
                rows.append([unit.name, unit.code, "No confirmed available members", "", ""])
        write_rows(book, day.isoformat(), ["Unit", "Unit Code", "Available Member", "Dated Call Level", "Pending leave risk"], rows)
        sheet = book.worksheets()[-1]
        sheet.set_header(f"&C{day.isoformat()} | Elective availability {starts}-{ends}")
        note_row = len(rows) + 3
        note = book.add_format({"text_wrap": True, "valign": "top", "font_color": "#475569"})
        notes = [f"Availability window: {starts}-{ends}, hospital-local time. Locked included units only. Full-window availability required.",
                 "Excludes approved leave, overlapping duties and configured post-duty rest. Pending leave is shown as risk, not approval.",
                 "Availability is not an elective assignment or proof of skill/supervision coverage. No person is reserved by this export.",
                 f"People with ambiguous simultaneous included-unit availability omitted: {len(ambiguous)}.",
                 f"Unresolved canonical availability records on this date: {sum(w.get('day') == day.isoformat() or 'day' not in w for w in availability['warnings'])}. Uncertain records are not proof of availability."]
        for offset, text in enumerate(notes):
            sheet.merge_range(note_row + offset, 0, note_row + offset, 4, text, note)
            sheet.set_row(note_row + offset, 32)
        sheet.set_footer("&LGenerated from current saved inputs; regenerate after changes&RPage &P of &N")
    book.close()
    return f"elective-list-members-{month}.xlsx", output.getvalue()
