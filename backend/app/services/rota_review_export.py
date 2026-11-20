"""Read-only, revision-bound workbook of the selected member proposal."""

from collections import Counter
from io import BytesIO
from types import SimpleNamespace
from uuid import UUID

from fastapi import HTTPException
import xlsxwriter

from app.services import rota_compute as compute
from app.services.rota_publish import assignment_rows, unfilled_rows, write_rows
from app.services.rota_template import write_eagle_eye_matrix
from app.services.rota_candidates import candidate_context
from app.services.allocation_objectives import objective_basis_text


def proposal_export(db, job, revision):
    if job.state.get("template") or job.status != "completed" or job.revision != revision:
        raise HTTPException(409, "Complete and reload the selected member proposal before exporting")
    # Same locks, current-input check and independent final validation as Apply,
    # without entering its operational mutation branch.
    compute.apply_job(db, job, revision, dry_run=True)
    period, _ = compute.writable_period(db, job.month)
    saved = compute.open_slots_for_period(db, period.id)
    context = candidate_context(db, job.month)
    # Non-template commitments still contribute to a person's monthly workload.
    # Keep them visible in the preview rather than reporting only generated duties.
    by_id = {slot.id: slot for slot in saved}
    for assignment in context.assignments:
        by_id.setdefault(assignment.duty_slot_id, assignment.duty_slot)
    saved = sorted(by_id.values(), key=lambda s: (s.duty_date, s.duty_type, s.slot_label))
    decisions = {d["slot_id"]: d for d in job.state["decisions"] if d.get("person_id")}
    projected = []
    for slot in saved:
        decision = decisions.get(str(slot.id))
        assignments = compute.active_slot_assignments(slot)
        if decision:
            person = context.people[UUID(decision["person_id"])]
            assignments = [SimpleNamespace(person=person, person_id=person.id,
                status="draft", source="reviewed_proposal", override_reason=None)]
        projected.append(SimpleNamespace(
            duty_date=slot.duty_date, unit=slot.unit, duty_type=slot.duty_type,
            slot_label=slot.slot_label, call_level=slot.call_level,
            template_status=slot.template_status, template_reason=slot.template_reason,
            is_24hr=slot.is_24hr, assignments=assignments))
    output = BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True,
        "strings_to_formulas": False, "strings_to_urls": False})
    report = job.state.get("intelligence", {})
    alternatives = report.get("alternatives", [])
    selected = alternatives[report.get("selected", 0)] if alternatives else {}
    write_rows(workbook, "Review Summary", ["Field", "Value"], [
        ["Status", "DRAFT FOR REVIEW - NOT PUBLISHED"], ["Month", job.month],
        ["Proposal", str(job.id)], ["Revision", job.revision],
        ["Selected alternative", job.state.get("intelligence", {}).get("selected", 0) + 1],
        ["Scheduling context", job.context_hash], ["Engine", job.engine],
        ["GPU frames verified", job.state.get("metrics", {}).get("gpu_frames_verified", 0)],
        ["Unfilled slots", len(unfilled_rows(projected))],
        ["Validation", "Current proposal passed independent application checks; no assignments saved"],
        ["Fairness basis", objective_basis_text(selected.get('objective_basis'))],
    ])
    write_rows(workbook, "Rota Preview", ["Date", "Day", "Unit", "Unit Code", "Duty",
        "Slot Label", "Assigned Member", "Call Level", "Assignment Source", "Override Reason",
        "Template Status", "Template Reason"], assignment_rows(projected))
    write_rows(workbook, "Unfilled", ["Date", "Day", "Unit", "Duty", "Slot Label", "Call Level", "Status"],
        unfilled_rows(projected))
    totals, hours24, weekends = Counter(), Counter(), Counter()
    for slot in projected:
        for assignment in slot.assignments:
            pid = assignment.person_id
            totals[pid] += 1
            hours24[pid] += int(slot.is_24hr)
            weekends[pid] += int(slot.duty_date.weekday() >= 5)
    people = dict(context.people)
    for slot in projected:
        for assignment in slot.assignments:
            if assignment.person:
                people[assignment.person_id] = assignment.person
    write_rows(workbook, "Member Workload", ["Member", "Call Level", "Total Duties", "24hr Duties", "Weekend Duties"],
        [[p.canonical_name, p.call_level, totals[pid], hours24[pid], weekends[pid]]
         for pid, p in sorted(people.items(), key=lambda row: (row[1].canonical_name, str(row[0])))])
    write_rows(workbook, "Optimization Evidence", ["Objective", "Value", "Proven"],
        [[o["name"], o["value"], o["proven"]] for o in selected.get("objectives", [])])
    write_rows(workbook, "Warnings", ["Warning"], [[w] for w in selected.get("warnings", [])])
    write_eagle_eye_matrix(workbook, projected, context.rules, assigned_names=True)
    for sheet in workbook.worksheets():
        sheet.set_header("&CDRAFT FOR REVIEW - NOT PUBLISHED")
        sheet.set_footer(f"&L{job.month} | Revision {job.revision}&RPage &P of &N")
    workbook.close()
    return f"rota-review-{job.month}-r{job.revision}.xlsx", output.getvalue()
