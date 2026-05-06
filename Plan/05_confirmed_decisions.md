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

## 2026-05-06 User Direction

### Admin-Controlled Mapping

Duty-label mapping, unit mapping, and posting/group mapping must be comprehensively editable from the frontend admin panel.

Implication:

- Parser mappings should not be locked only in backend code.
- Historical import should seed suggested mappings, but rota admins must be able to review and change them.
- The rota board and import pipeline should use the admin-approved mapping configuration.
- Uncertain labels should be surfaced as review items rather than silently guessed.

### Dynamic Analysis Dashboard

The app should have a native Analysis section similar in coverage to the existing standalone HTML report, but integrated into the software UX.

Implication:

- The dashboard should be computed dynamically from normalized database records.
- Analysis should update after each monthly rota is approved/finalized.
- Draft rota periods should not affect official analysis totals.
- Historical imported periods can be included as analysis-ready data.
- The old HTML report is evidence for useful metrics, not the UI implementation to embed directly.

### Department Members And Deduplication

The software needs a dedicated department members management section.

Implication:

- The department member list should be maintained separately from raw imported names.
- Imported name variants should be deduplicated through an admin review pass.
- Canonical members should keep aliases so future imports can resolve names correctly.
- Member designation/promotion history should be stored with effective dates.
- Analytics and rota workflows should eventually use canonical members and designation history.
- Invalid imported names must be blocked or cleaned before they become department members.
- Non-person spreadsheet values such as date labels, unit headers, campus labels, placeholders, and numeric artifacts should be discarded.

### Login And Privileges

The system should now use rota-team login accounts.

Implication:

- Supported roles are rota board member, computer admin, and superadmin.
- Computer admin and superadmin can access software diagnostics.
- Superadmin can create login accounts for the rota team.
- The default seeded superadmin is username `rotachief` with password `rotateam`.
- Forgot-password support can create a local reset token during this development phase; production delivery should later move to email/SMS or another secure channel.

### Trusted Department Roster

`Plan/Data/ANAESTHESIA department doctors(namelist).xlsx` is the trusted reference for corrected department member names.

Implication:

- Roster reconciliation should use this workbook to canonicalize imported person names.
- Previous imported spellings must be preserved as aliases.
- Conservative exact/near-exact matching is preferred over risky broad fuzzy merges.
- Invalid spreadsheet artifacts should still be handled by the invalid-member cleanup pass.
