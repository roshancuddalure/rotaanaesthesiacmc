# Confirmed Decisions

This file records answers and decisions confirmed by the user so future sessions do not need to ask the same questions again.

## 2026-05-05 User Answers

### MVP Scope

Version 1 should support both:

- importing and analyzing existing rotas,
- creating new monthly rotas.

This means the MVP cannot be only a report viewer. It needs rota creation, validation, import, and export workflows.

### Users

Initial users are rota admins only.

Implication:

- No individual staff login is required in the first version.
- Role design should still allow future expansion to consultants, PGs, unit leads, and staff self-service.

### Output

The final rota/output should be exportable to Excel.

Implication:

- Excel export is an MVP feature.
- The app should preserve enough layout and duty-slot structure to generate familiar departmental spreadsheets.

### Leave

Leave balance calculation is not needed now, but may be added later.

Implication:

- MVP leave management should focus on date availability and rota conflict prevention.
- Schema should not block future leave balance tracking.

### Hard Duty Spacing Rule

There must be at least 24 hours between two 24-hour duties for the same person.

Implication:

- This is a hard validation rule.
- A rota with this violation should not be publishable/exportable without an explicit admin override, if overrides are allowed.

### Duty Limits

Duty limits differ by situation and should be configurable in the admin panel.

Implication:

- Do not hardcode monthly duty limits by call level.
- Store limits as editable policy/rule settings with effective dates.

### Historical Data

Historical data from January 2025 to May 2026 should be imported into the new system as seed data.

Implication:

- Build a historical import/seed phase.
- Preserve source traceability from the existing analysis files where possible.

### Offline HTML Report

A self-contained offline HTML export like the current analysis report is desirable if possible.

Implication:

- Excel export is required first.
- Offline HTML report export should be part of reporting/export planning.

## Current Product Direction

The system should be an admin-facing web app that can:

1. Import historical and monthly rota/unitwise data.
2. Normalize people, aliases, units, call levels, postings, leave, and duties.
3. Validate rota drafts with configurable rules.
4. Assist admins in creating new monthly rotas.
5. Export final rota outputs to Excel.
6. Generate analysis reports, including offline HTML if feasible.

