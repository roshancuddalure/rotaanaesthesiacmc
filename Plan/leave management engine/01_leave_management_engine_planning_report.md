# Leave Management Engine Planning Report

Last updated: 2026-05-07

## Purpose

The leave management engine will become the availability foundation for the rota software.

Its first job is simple and critical:

- know who has applied for leave,
- know the exact leave dates and leave slots,
- map every leave entry to the correct department member,
- show leave clearly to the rota board,
- feed leave constraints into rota creation and validation.

The long-term goal is that the rota generator never accidentally assigns someone to duty when they are unavailable, and the rota board can see leave pressure before making monthly duty decisions.

## Current Rough Requirement

Source: `Plan/leave management engine/Plan for leave management.txt`.

Confirmed from the rough plan:

- Rota board member uploads leave data for an upcoming month.
- Upload may be Excel or CSV.
- The system parses the file into structured leave slots.
- Leave records must map to canonical Department Members, not free-text names.
- Leave can be edited before the month starts.
- Edited leave entries should use a member selector populated from the finalized Department Members list.
- Leave should be visible by date, month, member, unit, and call level.
- Unit-wise leave statistics should be shown for rota board planning.
- Leave data must later be used by the rota generator engine.

## External Reference Notes

These references were used only for planning principles, not for copying policy:

- W3C CSV on the Web recommends treating CSV as tabular data with consistent rows, headers, UTF-8 encoding, and machine-readable metadata where useful.
- GOV.UK recommends CSV metadata standards for making CSV files easier to process, share, and validate.
- NHS England e-rostering guidance emphasizes leave planning across the year, safe staffing visibility, and minimum/maximum leave controls.
- NHS England flexible working guidance notes that e-rostering supports time-off requests, correct information, and fairness in shift/time-off allocation.

Practical lesson for this project:

- Use CSV as the primary predictable import format.
- Support XLSX as a convenience upload, but convert it internally into the same validated row model.
- Make leave visibility day-by-day and month-by-month, not just as a list.
- Add staffing/call-level limits so leave pressure is visible before rota generation.
- Keep the process transparent and auditable.

## Recommended Import Format

### Recommendation

Use CSV as the official template format for first implementation.

Support XLSX later, or immediately as a convenience if the rota board prefers Excel. Even when XLSX is uploaded, the backend should normalize it into the same internal schema as CSV.

### Why CSV First

CSV is recommended because:

- it is simpler to validate,
- it is less ambiguous than free-form Excel,
- column names can be fixed,
- it is easy to diff and audit,
- parsing failures are easier to explain,
- it avoids hidden Excel formatting problems,
- it can be exported from Excel when users prefer spreadsheet editing.

### Why Still Support Excel

Excel/XLSX is useful because:

- the rota board may naturally work in Excel,
- dropdown lists and protected columns can reduce mistakes,
- color-coded templates may help non-technical users,
- monthly leave sheets are often already maintained as spreadsheets.

### Final Policy

The system should support:

1. CSV official template.
2. XLSX upload using the same column schema.
3. Manual entry/editing in the web UI.
4. Export of the current leave month back to CSV/XLSX.

## Proposed Leave Upload Template

Minimum required columns:

| Column | Required | Example | Notes |
|---|---:|---|---|
| month | Yes | 2026-06 | Upload period. Can be inferred from file name later. |
| person_name | Yes | Sujil | Raw uploaded name. Must resolve to one canonical member. |
| starts_on | Yes | 2026-06-10 | ISO date preferred. |
| ends_on | Yes | 2026-06-12 | Inclusive end date. Same as starts_on for one-day leave. |
| leave_slot | Yes | FULL_DAY | Slot type. Initial values to be confirmed. |
| leave_type | Yes | ANNUAL_LEAVE | Leave type. Initial values below. |
| status | No | APPROVED | Default can be APPROVED for board upload. |
| notes | No | exam leave | Optional. |

Recommended optional columns:

| Column | Purpose |
|---|---|
| call_level_hint | Helps review import mismatch, but should not override member profile automatically. |
| unit_hint | Helps identify expected unit context, but real unit should come from monthly posting data. |
| source_reference | Original sheet row, request number, or local note. |
| requested_on | Date the leave was requested, if available. |
| approved_by | Rota board member or approver, if available. |

## Leave Slot Model

The exact slot set needs user confirmation, but the engine should be designed to allow configurable leave slots.

Initial recommended slots:

- `FULL_DAY`
- `AM`
- `PM`
- `NIGHT`
- `POST_DUTY`
- `CUSTOM`

The current rota context mainly needs date-level unavailability, but slot-level detail is important for partial-day leave and future duty logic.

### Slot Rules

Each leave slot should define:

- label shown in UI,
- whether it blocks 24-hour duty,
- whether it blocks AM duty,
- whether it blocks PM duty,
- whether it blocks night duty,
- default duration weight for statistics.

Example:

| Slot | Blocks 24hr | Blocks AM | Blocks PM | Blocks night |
|---|---:|---:|---:|---:|
| FULL_DAY | Yes | Yes | Yes | Yes |
| AM | Maybe | Yes | No | Maybe |
| PM | Maybe | No | Yes | Maybe |
| NIGHT | Yes | No | Maybe | Yes |
| POST_DUTY | No | Maybe | Maybe | No |

These need department confirmation before enforcement.

## Leave Type Model

Initial leave types:

- `ANNUAL_LEAVE`
- `ACADEMIC_LEAVE`
- `CONFERENCE`
- `EXAM`
- `SICK_LEAVE`
- `MATERNITY_PATERNITY`
- `COMP_OFF`
- `OFFICIAL_DUTY`
- `OTHER`

Each leave type should define:

- display label,
- color,
- whether it blocks duty assignment,
- whether it counts as leave pressure,
- whether it is included in yearly entitlement calculations later.

For MVP, entitlement/balance calculation can be skipped. The engine should focus on availability and planning.

## Status Model

Initial statuses:

- `REQUESTED`
- `APPROVED`
- `REJECTED`
- `CANCELLED`
- `IMPORTED_PENDING_REVIEW`

MVP policy:

- Uploaded board files may default to `APPROVED`.
- Ambiguous names or invalid rows become `IMPORTED_PENDING_REVIEW`.
- Rejected/cancelled leaves remain stored for audit but do not block rota generation.

## Current Backend Fit

Existing model:

- `backend/app/models/leave.py` has `LeaveRequest` with:
  - person,
  - leave_type,
  - starts_on,
  - ends_on,
  - status,
  - source,
  - notes,
  - created_at.

This is a good foundation, but the planned engine needs more structure.

Recommended model expansion:

- add `leave_slot`,
- add `period_id` or derived monthly period link,
- add `import_batch_id`,
- add `source_record_id` or source row trace,
- add `requested_on`,
- add `approved_by_user_id`,
- add `updated_at`,
- add `cancelled_at`,
- add `conflict_status`,
- add `review_status`,
- add optional `raw_person_name`.

Recommended additional tables:

- `leave_types`
- `leave_slot_types`
- `leave_import_batches`
- `leave_import_rows`
- `leave_daily_blocks`
- `leave_conflicts`
- `leave_rule_settings`
- `leave_audit_events`

For MVP, some of these can be implemented as simple strings/settings first, but the plan should keep the richer structure in mind.

## Core Data Concepts

### Leave Request

A human-level leave entry:

- person,
- start date,
- end date,
- leave slot,
- type,
- status,
- source,
- notes.

Example:

- Sujil, 2026-06-10 to 2026-06-12, FULL_DAY, ANNUAL_LEAVE, APPROVED.

### Leave Daily Block

A generated per-day availability block derived from a leave request.

Why this is useful:

- rota generator needs date-level lookup,
- calendar display is simpler,
- conflicts are easier to compute,
- partial-day slots can be checked correctly.

Example:

- Request: Sujil leave 10-12 June.
- Blocks:
  - 2026-06-10 FULL_DAY
  - 2026-06-11 FULL_DAY
  - 2026-06-12 FULL_DAY

### Leave Conflict

A detected issue, such as:

- person is already assigned to duty during leave,
- too many 2nd calls on leave in one day,
- too many people from one unit on leave,
- leave overlaps with special posting restriction,
- duplicate leave entry.

### Leave Import Batch

Each upload should create a batch:

- file name,
- uploader,
- upload time,
- target month,
- detected columns,
- parsed rows,
- valid rows,
- warning rows,
- failed rows.

The original source file should be preserved or at least traceable.

## Name Resolution Workflow

Leave import must never create duplicate members by spelling variation.

Workflow:

1. Read raw `person_name`.
2. Normalize whitespace, punctuation, casing.
3. Match exact canonical member name.
4. Match exact alias.
5. Match high-confidence known alias.
6. If one safe match exists, link to `person_id`.
7. If multiple possible matches exist, mark row as `IMPORTED_PENDING_REVIEW`.
8. If no match exists, mark as unresolved.
9. UI lets rota board/admin choose the correct Department Member from a dropdown.
10. Confirmed correction updates only the import row or optional alias table based on admin decision.

Important:

- Leave import should use the existing canonical Department Member list.
- No free-text person creation from leave import in board-facing UI.
- New member creation, if needed, must remain admin-only.

## Unit and Call-Level Mapping Workflow

Leave should be connected to unit and call-level context for the corresponding month.

Workflow:

1. Import leave request.
2. Link to canonical person.
3. Find `PersonPosting` covering the leave date/month.
4. Derive:
   - unit,
   - posting type,
   - call level,
   - special posting context.
5. If no unit posting exists:
   - use current member call level as fallback,
   - mark unit as unknown,
   - show in dashboard review.

This should be derived context, not duplicated as manually typed text unless needed for audit.

## Main User Workflow

### 1. Upload

Rota board member opens `Leave` screen.

They choose:

- target month,
- source file,
- whether file is CSV or XLSX,
- default status for imported leaves.

System shows:

- detected columns,
- target month,
- preview of first rows,
- missing required columns if any.

### 2. Parse and Validate

Backend parses file and returns a preflight result:

- rows parsed,
- rows ready to import,
- unresolved names,
- invalid dates,
- duplicate leave rows,
- outside-month entries,
- overlapping leave entries,
- possible duty conflicts.

Nothing should be committed as approved until the user confirms import.

### 3. Review

UI shows a review screen:

- green: clean rows,
- yellow: needs review,
- red: cannot import.

For each problematic row:

- show raw person name,
- show suggested match if available,
- allow choosing canonical person,
- allow correcting date,
- allow correcting leave slot/type,
- allow ignoring row with reason.

### 4. Commit

When user confirms:

- create import batch,
- create leave requests,
- create daily leave blocks,
- run conflict checks,
- update dashboard.

### 5. Calendar Editing

Before the month starts, rota board can:

- add leave manually,
- edit leave type,
- edit date range,
- change leave slot,
- cancel leave,
- add notes.

Person selection must always use Department Member picker.

### 6. Rota Integration

During rota creation:

- approved leave blocks remove the person from candidate pool,
- requested/pending leave creates warnings,
- rejected/cancelled leave does not block,
- manual override requires reason and audit log.

## UI Screens

### Leave Overview

Board-facing monthly summary:

- month selector,
- total people on leave,
- total leave days,
- daily leave pressure,
- highest pressure dates,
- unit-wise leave count,
- call-level leave count,
- unresolved import rows,
- duty conflicts.

### Leave Calendar

Month grid:

- each day shows leave count,
- color by pressure level,
- click day to open day drawer,
- drawer shows people on leave grouped by call level/unit/leave type.

Recommended pressure colors:

- normal,
- watch,
- high,
- unsafe.

Thresholds should be configurable.

### Leave List

Filterable table/card list:

- person,
- dates,
- slot,
- type,
- status,
- unit,
- call level,
- source,
- conflict state.

Actions:

- edit,
- cancel,
- mark reviewed,
- view source row.

### Upload Center

Upload workflow:

- choose month,
- upload CSV/XLSX,
- preview,
- review errors,
- commit.

### Unit-Wise Leave Dashboard

For selected month:

- unit vs date matrix,
- unit total leave days,
- call-level leave count,
- special posting leave count,
- people absent by unit on each day.

This helps the rota board see if one unit is over-exposed.

### Person Leave Popup

Accessible from person name:

- all leave in selected month,
- previous/future leave,
- duty conflicts,
- monthly posting/unit,
- call level,
- notes/source.

## Dashboard Metrics

Recommended first dashboard:

- total approved leave requests,
- total leave days,
- number of people with leave,
- unresolved imported rows,
- conflict count,
- highest leave-pressure date,
- unit with highest leave burden,
- call level with highest leave burden.

Recommended day-level dashboard:

- day,
- total leave blocks,
- leave by call level,
- leave by unit,
- approved vs pending,
- duty conflicts.

Recommended unit-level dashboard:

- unit,
- active people in unit,
- people on leave,
- percentage unavailable,
- call-level breakdown,
- dates with maximum leave pressure.

## Validation Rules

### Import Validation

Errors:

- missing person name,
- unresolved person,
- invalid start date,
- invalid end date,
- end date before start date,
- unsupported leave slot,
- unsupported leave type,
- row outside selected month if strict mode is on.

Warnings:

- leave overlaps existing leave,
- leave crosses month boundary,
- duplicate-looking leave row,
- person inactive/historical,
- no unit posting found for month,
- leave creates duty conflict,
- leave exceeds configured daily slot limit.

### Rota Conflict Validation

Hard block:

- approved leave overlaps duty assignment.

Warning:

- pending/requested leave overlaps duty assignment.
- person has leave ending immediately before 24-hour duty, if department wants rest buffer.
- person has partial leave conflicting with specific AM/PM/night slot.

Override policy:

- only admin/authorized role can override,
- override reason required,
- original conflict retained for audit,
- export should show overridden conflicts if requested.

## Leave Pressure Rules

This is important for rota board decisions.

Configurable limits should support:

- maximum people on leave per day,
- maximum people on leave per call level per day,
- maximum people on leave per unit per day,
- maximum senior call people on leave per day,
- special dates or holiday periods with stricter limits,
- minimum available people per call level/unit.

Initial simple rules:

- warn if too many people are on leave on the same date,
- warn if too many from the same call level are on leave,
- warn if too many from the same unit are on leave,
- warn if all eligible people for a duty type are unavailable.

Later advanced rules:

- fairness over holidays,
- equal distribution of popular leave windows,
- leave quota progress across year,
- yearly entitlement tracking.

## Rota Generator Integration

The leave engine should expose an availability API.

For a proposed duty slot:

Input:

- date,
- duty type,
- slot timing,
- call level,
- unit/campus if relevant.

Output per person:

- available,
- blocked by approved leave,
- warning due to pending leave,
- blocked by partial-day slot,
- conflict explanation,
- source leave request id.

Candidate selection should use:

1. canonical person,
2. call level eligibility,
3. unit/posting context,
4. approved leave blocks,
5. pending leave warnings,
6. existing duty spacing,
7. duty load balancing.

## API Plan

Recommended endpoints:

- `GET /api/v1/leave/months`
- `GET /api/v1/leave/summary?month=YYYY-MM`
- `GET /api/v1/leave/calendar?month=YYYY-MM`
- `GET /api/v1/leave/requests?month=YYYY-MM`
- `POST /api/v1/leave/requests`
- `PUT /api/v1/leave/requests/{id}`
- `POST /api/v1/leave/requests/{id}/cancel`
- `POST /api/v1/leave/imports/preview`
- `POST /api/v1/leave/imports/commit`
- `GET /api/v1/leave/imports/{id}`
- `GET /api/v1/leave/conflicts?month=YYYY-MM`
- `POST /api/v1/leave/conflicts/{id}/override`
- `GET /api/v1/leave/availability?date=YYYY-MM-DD&duty_type=...`

Board users should access normal leave workflow.

Computer admins should access:

- import diagnostics,
- raw unresolved rows,
- schema settings,
- leave type/slot configuration,
- override audit.

## Database Plan

### Minimum MVP Expansion

Add to `leave_requests`:

- `leave_slot`
- `import_batch_id`
- `raw_person_name`
- `updated_at`

Create:

- `leave_import_batches`
- `leave_import_rows`
- `leave_conflicts`

### Stronger Version

Create:

- `leave_types`
- `leave_slot_types`
- `leave_daily_blocks`
- `leave_rule_settings`
- `leave_audit_events`

### Suggested Constraints

- Leave request end date must be >= start date.
- Leave request must have valid person id.
- Prevent exact duplicate approved leave:
  - person,
  - starts_on,
  - ends_on,
  - leave_slot,
  - leave_type,
  - status.
- Daily blocks should be unique by:
  - leave_request_id,
  - block_date,
  - leave_slot.

## Import Parser Design

Parser service responsibilities:

- detect file type,
- read CSV/XLSX,
- normalize headers,
- validate required columns,
- parse dates,
- expand date ranges,
- normalize leave slot/type,
- resolve person names,
- attach source row number,
- produce preflight report.

Do not write final leave records during preview.

Preview output should include:

- parsed normalized row,
- raw row,
- errors,
- warnings,
- suggested person match,
- confidence,
- source row number.

## Audit and Traceability

Every leave record should know:

- who uploaded or created it,
- when it was created,
- source file/import batch,
- raw person name if imported,
- row number if imported,
- who edited it,
- what changed,
- reason for cancellation/override.

This matters because leave affects duty allocation and can become a source of disputes.

## Roles and Permissions

Rota board member:

- upload leave,
- review import,
- add/edit/cancel leave before publish,
- view dashboard/calendar,
- resolve person matches using existing Department Members.

Computer admin:

- configure leave types/slots,
- inspect import diagnostics,
- resolve difficult data issues,
- manage rule thresholds,
- approve overrides if needed.

Superadmin:

- all permissions,
- system-level configuration,
- audit review.

Future possible role:

- read-only department viewer.

## Frontend UX Plan

### Desktop

Primary layout:

- top month selector,
- summary metrics,
- calendar + side panel,
- unit/call-level dashboards,
- leave list below.

### Mobile

Primary layout:

- month selector,
- summary chips,
- agenda list by day,
- bottom navigation includes Leave once implemented,
- day cards open person leave details,
- upload may be desktop-preferred but should still be possible on mobile.

### UI Principles

- Board users should not see raw parser/admin details unless a row needs review.
- Editing leave must use member picker, not free text.
- Conflicts should be explained in plain language.
- The calendar should show pressure, not just names.
- The system should answer: "Can we safely build this rota with this leave pattern?"

## Recommended Implementation Phases

### Phase L0 - Final Decisions

Confirm:

- leave slot types,
- leave type list,
- allowed upload template,
- daily/unit/call-level leave limits,
- whether pending leave blocks rota or warns only,
- who can override leave conflicts,
- whether leave balance/entitlement is in scope.

Deliverable:

- confirmed leave rules document.

### Phase L1 - Data Model and API Foundation

Build:

- model expansion,
- leave API routes,
- basic create/edit/cancel/list,
- month summary service,
- tests for date overlap and validation.

Deliverable:

- manually entered leave can be stored and viewed.

### Phase L2 - Import Preview

Build:

- CSV parser,
- optional XLSX parser,
- template validation,
- person matching,
- preflight report,
- unresolved-row review model.

Deliverable:

- upload file can be previewed without committing.

### Phase L3 - Import Commit and Calendar

Build:

- commit clean rows,
- create daily blocks,
- month calendar UI,
- day drawer,
- leave list,
- conflict generation.

Deliverable:

- rota board can import and manage monthly leave.

### Phase L4 - Unit/Call-Level Dashboard

Build:

- derive unit/call-level from monthly postings,
- unit-wise dashboard,
- call-level dashboard,
- pressure thresholds,
- high-risk date view.

Deliverable:

- board can see leave burden by unit and level.

### Phase L5 - Rota Generator Integration

Build:

- availability service,
- duty assignment conflict check,
- rota candidate filtering,
- publish blocker,
- override workflow.

Deliverable:

- rota creation respects leave.

### Phase L6 - Polish and Export

Build:

- CSV/XLSX export,
- mobile agenda view,
- audit timeline,
- conflict report,
- backup/restore consideration.

Deliverable:

- leave workflow is reliable for routine monthly use.

## Testing Plan

Backend tests:

- CSV header validation,
- date parsing,
- date range expansion,
- person matching,
- ambiguous person handling,
- duplicate leave detection,
- overlap detection,
- unit/call-level derivation,
- conflict with duty assignment,
- cancelled/rejected leave does not block,
- approved leave blocks.

Frontend tests:

- upload preview rendering,
- unresolved row correction,
- member picker only, no free text,
- calendar pressure display,
- edit/cancel workflows,
- mobile agenda usability,
- conflict explanation visibility.

End-to-end tests:

- upload sample leave file,
- resolve one ambiguous name,
- commit import,
- open calendar,
- verify person leave popup,
- attempt duty assignment during approved leave,
- confirm conflict is shown.

## Sample CSV

```csv
month,person_name,starts_on,ends_on,leave_slot,leave_type,status,notes
2026-06,Sujil,2026-06-10,2026-06-12,FULL_DAY,ANNUAL_LEAVE,APPROVED,Family function
2026-06,Preethi Kuryan,2026-06-15,2026-06-15,AM,ACADEMIC_LEAVE,APPROVED,Teaching
2026-06,Jeenu Ann Jose,2026-06-20,2026-06-20,FULL_DAY,CONFERENCE,REQUESTED,
```

## Open Questions for User

1. What are the actual leave slot categories used by the department?
2. Does full-day leave block all duty types, including 24-hour calls starting that day?
3. How should AM/PM leave interact with 24-hour duty?
4. Are leave requests usually pre-approved before upload, or should the system support approval workflow?
5. Should pending leave block rota generation or only warn?
6. What are the maximum allowed people on leave per day?
7. Are limits different by call level?
8. Are limits different by unit?
9. Should special postings like SICU, Pain, DRP, Neuro ICU have separate leave pressure rules?
10. Do we need leave balance/entitlement tracking now, or only availability?
11. Can leave cross month boundaries in the monthly upload?
12. Who can override a leave-duty conflict?
13. Should cancelled leave remain visible in the board-facing calendar or only in audit?
14. Should the leave upload template be strict English column names or allow department-specific labels?
15. Should staff eventually apply for leave directly, or will the rota board remain the only input source?

## Key Product Decisions Recommended Now

Recommended defaults:

- Use CSV as official upload template.
- Support XLSX using same columns.
- Store source import batch and raw row for traceability.
- Use Department Member picker for all manual edits.
- Keep leave balance out of MVP.
- Treat approved leave as hard block for rota duty assignment.
- Treat pending leave as warning.
- Show leave pressure by day, unit, and call level.
- Make limits configurable, not hardcoded.
- Keep admin diagnostics hidden from board-facing UI.

## Implementation Starting Point

First code phase should be L1:

1. Expand `LeaveRequest`.
2. Add leave API routes.
3. Add manual create/edit/cancel.
4. Add month list/summary endpoints.
5. Add basic frontend Leave screen.

After manual leave works, build import preview. This avoids making the import parser carry the whole product at once.

