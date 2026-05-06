# System Manual And Brainstorming Summary

This document is the shared map for the Duty Rota software. It explains what the system is, how the current pieces work, what rules it must respect, and how we should proceed without confusion.

## 1. What We Are Building

We are building an admin-facing web app for the CMC Anaesthesia duty rota workflow.

The software should eventually support:

- importing historical rota and unitwise files,
- maintaining a clean department member list,
- managing leave and availability,
- creating monthly duty rota templates,
- validating duty rules before approval,
- allowing rota board-approved duty exchanges,
- producing analysis dashboards and exports,
- keeping audit history so important changes are traceable.

The system is a web app, not Windows desktop software. It runs locally through one command during development:

```powershell
.\launch.bat
```

The frontend opens at:

```text
http://localhost:5173
```

Default superadmin:

```text
username: rotachief
password: rotateam
```

## 2. Current Architecture

Backend:

- FastAPI API server.
- SQLAlchemy database models.
- Alembic migrations.
- PostgreSQL database.
- Python service layer for imports, members, analysis, authentication, and reconciliation.

Frontend:

- Vite + TypeScript.
- Browser-based admin console.
- Sections currently include Overview, Analysis, Mappings, Imports, Department Members, Login Accounts, and Diagnostics.

Database:

- Stores people, aliases, designations, units, postings, rota periods, duty slots, assignments, import traceability, admin mappings, auth accounts, sessions, and password reset tokens.

## 3. Current Working Sections

### Login And Privileges

The app now has rota-team login.

Roles:

- `rota_board_member`
- `computer_admin`
- `superadmin`

Current behavior:

- Superadmin can create login accounts.
- Computer admin and superadmin can access Diagnostics.
- Sign in, forgot password, reset password, and sign out are implemented.
- Forgot-password currently creates a local reset token for development.

### Admin Mappings

This section lets admins review and control how raw Excel labels map into software concepts.

Examples:

- duty labels,
- unit labels,
- posting labels.

Purpose:

- avoid hardcoding all departmental interpretations in backend code,
- let the rota board correct uncertain mappings,
- make imports safer and explainable.

### Historical Imports

The app can parse historical rota and unitwise Excel files.

It stores:

- import batches,
- source records,
- warnings,
- normalized people,
- units,
- postings,
- duty slots,
- duty assignments.

The import engine preserves traceability back to source files, sheets, rows, and columns wherever possible.

### Department Members

This section manages the canonical department member list.

It supports:

- member listing,
- member creation,
- designation history,
- invalid-name cleanup,
- duplicate candidate review,
- merging duplicate people,
- trusted roster reconciliation.

The trusted roster file is:

```text
Plan/Data/ANAESTHESIA department doctors(namelist).xlsx
```

This workbook is now treated as the corrected full-name reference. Imported name variants are preserved as aliases.

### Analysis

The Analysis section summarizes duty allocation from normalized database records.

It includes:

- individual duty counts,
- dutywise counts,
- daywise distribution,
- weekend duties,
- monthwise totals,
- duty category totals,
- promotion/call-level movement based on historical data.

Official analysis should only include analysis-ready rota periods:

- `historical`
- `approved`
- `published`
- `finalized`

Draft months should not affect official analysis.

### Diagnostics

Diagnostics is for computer admin and superadmin.

It summarizes:

- database table counts,
- import warnings,
- mapping status,
- rota period status,
- invalid member names,
- account roles.

## 4. Main Product Features Still Needed

### Analysis Section

Already started and working, but will need refinement.

Required final behavior:

- tally duty counts per person,
- dutywise analysis,
- daywise analysis,
- weekend-duty burden,
- monthwise comparison,
- exportable reports.

### Leave Management

Needed behavior:

- upload leave details from Excel,
- parse monthly leave,
- show daywise who is on leave,
- show leave by level/designation/call eligibility,
- use leave as a hard blocker or warning during duty generation,
- show leave conflicts with assigned duties.

### Rota Template Generation

This is the most complex part.

Inputs:

- unitwise members for the month,
- call levels,
- leave list,
- existing duty counts,
- unit staffing needs,
- duty rules,
- previous/future duty spacing.

Output:

- a proposed monthly duty rota template,
- explainable warnings,
- candidate suggestions,
- elective availability awareness.

Important concept:

People who are not on leave and not on duty are available for elective posting. The engine should avoid creating a duty template that drains a unit so badly that elective work is affected.

### Editable Duty Changes After Finalization

Needed behavior:

- rota board chief can approve changes after finalization,
- duty exchange must have a reason,
- change history must be logged,
- original assignment and revised assignment should both remain auditable.

### Manual Rules

Needed behavior:

- admins should be able to add or adjust rules later,
- rules should have effective dates,
- rules should be versioned where possible,
- the engine should explain which rule blocked or warned about an assignment.

## 5. Rota Creator Rules From Current Notes

The rota engine must consider:

- appropriate call duties should be assigned only to appropriate call-level people,
- leave must be considered while creating a duty template,
- duty allocation must preserve enough unit members for elective work,
- duty exchanges need rota board approval and reason logging,
- rules must be manually editable later,
- each person should have at least 24 hours gap between calls.

The currently confirmed hard rule:

- At least 24 hours gap between two 24-hour duties for the same person.

Likely future rule categories:

- call-level eligibility,
- leave conflict,
- unit staffing minimum,
- weekend burden balancing,
- monthly duty count balancing,
- 24-hour duty spacing,
- campus/location restrictions,
- post-call availability,
- special duty category eligibility,
- manual override and approval.

## 6. How The System Should Think

The system should not blindly auto-generate a rota and pretend it is correct.

The safer model is:

1. Import and clean data.
2. Maintain trusted members and aliases.
3. Load unitwise posting and leave data for a target month.
4. Generate required duty slots.
5. For each slot, calculate eligible candidates.
6. Block impossible candidates.
7. Score possible candidates.
8. Suggest assignments with explanations.
9. Let the rota board accept, edit, or override.
10. Validate the full rota before approval.
11. Approve/finalize.
12. Update analysis only after approval/finalization.

## 7. Recommended Learning / Planning Time

Before building the rota generator, we should spend focused time making the departmental logic explicit.

Suggested workflow:

1. Confirm all duty types and call levels.
2. Confirm which people/designations can do which duties.
3. Confirm unit staffing minimums for elective availability.
4. Confirm leave Excel format.
5. Confirm monthly unitwise input format.
6. Confirm hard rules vs soft balancing preferences.
7. Confirm what the rota board wants to override manually.
8. Confirm final approval and post-finalization exchange workflow.

This reduces chaos because the rota generator is only as good as the rules and data it receives.

## 8. Proposed Implementation Plan From Here

### Step 1 - Stabilize Current Admin Foundation

- Protect remaining admin APIs with login roles.
- Improve account management UX.
- Add audit logs for important admin actions.
- Add backup/restore plan.

### Step 2 - Finish Member And Alias Review

- Improve dedupe review using trusted roster.
- Add alias review screen.
- Let admins approve ambiguous merges manually.
- Add member profile page with duties, postings, aliases, and designations.

### Step 3 - Build Leave Import And Leave Dashboard

- Define leave Excel format.
- Parse leave sheet.
- Store leave records with source traceability.
- Show monthly/daywise leave.
- Show leave by call level/designation/unit.

### Step 4 - Build Monthly Rota Setup

- Create a target rota month.
- Load unitwise members for that month.
- Generate duty slots from a configurable duty template.
- Let admins review empty duty board.

### Step 5 - Build Validation Engine

- Implement 24-hour duty spacing.
- Implement leave conflict checks.
- Implement call-level eligibility.
- Implement unit elective-availability warnings.
- Show issues clearly in the UI.

### Step 6 - Build Candidate Suggestion Engine

- For each duty slot, show eligible candidates.
- Explain why candidates are blocked.
- Score candidates by fairness and safety.
- Let rota board accept/override.

### Step 7 - Build Approval And Exchange Workflow

- Draft -> reviewed -> approved/finalized.
- Post-finalization duty exchange with reason.
- Audit every change.
- Refresh official analysis only after approval/finalization.

### Step 8 - Export And Reporting

- Export final rota to Excel.
- Export analysis to Excel.
- Later add offline HTML report export.

## 9. Current State Snapshot

As of the latest local database cleanup:

- trusted roster entries processed: 238,
- people: 1,444,
- aliases: 502,
- designations: 14,
- invalid member names: 0,
- dedupe candidate groups: 288.

Verification status:

- backend lint passes,
- backend tests pass,
- frontend production build passes.

## 10. Core Principle

The software should make the rota board more confident, not more confused.

Therefore every important decision should be:

- visible,
- editable where appropriate,
- validated,
- explainable,
- auditable.

