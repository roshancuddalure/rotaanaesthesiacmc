# Rota Generator Phase Action Plan

Last updated: 2026-05-07

## Phase 1: Rule Foundation And Duty Dictionary

Action plan:

1. Create the rota-generator duty dictionary from the confirmed duty list.
2. Make each duty type configurable:
   - display label,
   - group,
   - campus/location,
   - expected duration,
   - start/end time,
   - 24-hour duty flag,
   - main 24-hour count flag,
   - mandatory vs adjustable flag,
   - same-day elective blocking flag,
   - next-day elective blocking flag,
   - active/inactive flag.
3. Add eligibility placeholders:
   - allowed call levels,
   - allowed designations,
   - allowed units,
   - excluded units.
4. Add duty count limit defaults:
   - monthly 24-hour total,
   - weekend duty total,
   - duty-group total,
   - campus total.
5. Add rest-rule defaults:
   - minimum 24-hour gap after a 24-hour duty,
   - whether post-call next day blocks elective availability.
6. Add unit-staffing defaults:
   - minimum available people,
   - warning threshold,
   - hard block threshold,
   - small-unit handling.
7. Store the configuration under a rule version.
8. Add admin API to read and update Phase 1 rules.
9. Add admin UI so computer admins/superadmins can edit the first rule bundle.
10. Add backend tests for defaults, validation, and persistence.

Acceptance:

- Rota rules can be viewed and edited without code changes.
- The existing confirmed duty list is represented in the rule bundle.
- The default minimum gap after 24-hour duties is 24 hours.
- Duty types can be marked mandatory or adjustable for future leave-aware slot generation.

## Phase 2: Monthly Rota Period And Unit Scope

Action plan:

1. Create rota period setup screen.
2. Add monthly included-unit selector.
3. Add monthly excluded-unit selector.
4. Add clone-from-previous-month action.
5. Show selected unit readiness:
   - assigned members,
   - call-level spread,
   - missing call levels,
   - leave pressure warning.
6. Store locked/unlocked generation scope.
7. Require reason when unlocking after slot generation.

Acceptance:

- Every rota month explicitly records which units are included in generation.
- The system warns if an included unit is not ready.

## Phase 3: Leave Import And Leave Pressure

Action plan:

1. Add CSV/XLSX leave import preview.
2. Match imported names to canonical Department Members.
3. Send unresolved names to review.
4. Store approved/pending/rejected/cancelled leave states.
5. Build daily leave calendar.
6. Calculate leave pressure by date, unit, and call level.
7. Expose leave blockers to the generator.

Acceptance:

- Leave pressure is known before empty duty slots are generated.

## Phase 3B: Advanced Leave Parser

Action plan:

1. Inspect real department leave workbooks before parser changes.
2. Support multi-sheet Excel files.
3. Auto-detect table-style leave sheets with flexible headers.
4. Auto-detect wide calendar-style leave sheets where dates are columns.
5. Parse names under each date column.
6. Compress consecutive daily cells for the same person into date ranges.
7. Preserve sheet name, row number, and source format in preview rows.
8. Detect unresolved names, invalid dates, outside-month rows, and duplicate rows.
9. Add confidence/source-format metadata to preview output.
10. Keep import as preview-only until the rota board approves apply behavior.

Acceptance:

- The parser can preview both simple CSV/XLSX leave tables and the department's wide date-column leave workbook format.

## Phase 3C: Accurate Leave Import Apply Workflow

Action plan:

1. Strengthen name cleaning:
   - remove titles,
   - remove slot markers from name cells,
   - normalize punctuation and spacing,
   - preserve raw names for audit.
2. Match names only to canonical Department Members or saved aliases for automatic import.
3. Produce conservative suggestions for near matches, but do not auto-import uncertain fuzzy matches.
4. Parse leave slots from:
   - explicit slot columns,
   - AM/PM/FN/AN/NIGHT/FULL DAY text,
   - parenthesized or suffixed markers inside name cells.
5. Detect duplicate rows inside the uploaded file.
6. Detect existing duplicate leave rows already saved in the database.
7. Add an Apply Matched Rows action after preview.
8. Create leave records only for safe matched rows.
9. Skip unresolved, invalid, duplicate, and uncertain rows.
10. Refresh the monthly leave calendar and pressure dashboard after apply.

Acceptance:

- The website can preview a leave file, safely import matched rows, and update the monthly leave calendar without creating duplicate or uncertain leave records.

## Phase 4: Leave-Aware Empty Slot Template Generation

Status: implemented on 2026-05-07.

Action plan:

1. Build duty template editor.
2. Generate slots only for selected monthly units.
3. Check leave pressure before creating each slot.
4. Create normal slots for safe dates.
5. Flag warning slots as `needs_review`.
6. Skip, reduce, block, or send unsafe adjustable slots to manual review according to rule settings.
7. Preserve mandatory clinical slots unless admin rules say otherwise.
8. Store explanation for every created, skipped, reduced, or blocked slot.

Acceptance:

- The empty monthly template already reflects selected units and leave pressure.

## Phase 5: Availability And Unit Safety Engine

Action plan:

1. Calculate daily availability per unit/call level.
2. Subtract approved leave.
3. Subtract same-day duty blockers.
4. Subtract previous-day 24-hour duty blockers.
5. Apply unit staffing thresholds.
6. Show safe/warning/hard-block state.
7. Recalculate after each manual assignment.

Acceptance:

- Every slot can show the staffing impact before assignment.

Implementation status:

- Completed the first Phase 5 safety engine.
- Added per-slot safety calculation using unit postings, approved leave, review-pending leave, same-day duty blockers, previous-day 24-hour rest blockers, and Phase 1 staffing thresholds.
- Added a month-level rota safety API and frontend safety panels on the Rota Template screen.
- Manual assignment will reuse this safety engine in Phase 6 so slot safety recalculates after each assignment.

## Phase 6: Manual Assignment With Validation

Action plan:

1. Assign, replace, and clear people manually.
2. Validate leave conflicts.
3. Validate call-level eligibility.
4. Validate 24-hour rest.
5. Validate duty count limits.
6. Validate unit staffing pressure.
7. Require override reason where configured.

Acceptance:

- The board can build a safe rota manually before auto-fill exists.

Implementation status:

- Completed the first Phase 6 manual assignment workflow.
- Added assign, replace, and clear actions for generated duty slots.
- Added validation for approved leave, review-pending leave, same-day duty conflicts, previous-day 24-hour rest blockers, unit/call-level eligibility, monthly duty count limits, and unit staffing safety.
- Assignments with warnings or hard conflicts require an override reason before saving.
- The Rota Template screen now shows assigned members and manual assignment controls per slot.

## Phase 7: Candidate Suggestions

Action plan:

1. Build candidate pools for slots.
2. Separate eligible, warning, and blocked people.
3. Score candidates by duty burden, weekend burden, rest gap, staffing pressure, and fairness.
4. Explain every suggestion.
5. Allow board to accept or reject suggestions.

Acceptance:

- Candidate suggestions are useful and explainable.

Implementation status:

- Completed the first Phase 7 candidate suggestion engine.
- Added candidate pools per generated slot with eligible, needs-review, and blocked groups.
- Added ranking scores from current duty load, 24-hour load, weekend 24-hour load, same duty group/campus load, rest gap, staffing pressure, validation state, and fairness against the current assigned-member average.
- Added plain-language reasons for every suggestion.
- The Rota Template screen now shows top suggestions per slot, supports accepting safe suggestions, selecting review suggestions into the manual assignment controls, and hiding rejected suggestions for the current session.

## Phase 8: Safe Auto-Fill Draft

Action plan:

1. Run auto-fill over empty slots.
2. Fill only safe slots.
3. Leave risky slots empty.
4. Generate validation report.
5. Store explanation for every generated assignment.

Acceptance:

- The generator can create a first draft without hiding risks.

Implementation status:

- Completed the first Phase 8 safe auto-fill draft.
- Auto-fill runs across generated slots and assigns only the top candidate when that candidate is safe, clear, and does not require an override.
- Slots with review-needed or blocked candidates are left open.
- Added auto-fill run/event audit tables so every assigned, skipped, and blocked decision is reportable.
- The Rota Template screen now includes a Safe Auto-Fill action and latest auto-fill report.
- The generated slot review surface is now calendar-based: each day opens a popup showing unit-grouped slot cards, current assignments, safety status, suggestions, and manual assignment controls.

## Phase 9: Review, Override, Exchange

Action plan:

1. Build review dashboard.
2. List all warnings/errors.
3. Show person-wise duty counts and weekend load.
4. Allow board corrections.
5. Add duty exchange workflow.
6. Record requester, approver, reason, and validation impact.

Acceptance:

- Finalized rota changes are traceable and approved.

Implementation status:

- Completed the first Phase 9 review dashboard and exchange workflow.
- Added a Rota Review screen that lists open slots, warning slots, hard-blocked slots, override assignments, person-wise duty load, and exchange requests.
- Added backend review summary generation from the current template, safety checks, candidate suggestions, and saved assignments.
- Added traceable exchange requests with requester, approver/rejector, reason, validation snapshot, decision note, and applied assignment ID.
- Exchange approval now reuses the existing validated assignment endpoint with source `exchange_approved`.
- Added exchange approval/rejection API routes and frontend controls.

## Phase 10: Publish And Export

Action plan:

1. Add publish checklist.
2. Block publish if hard errors remain.
3. Confirm warnings and overrides.
4. Record board approval.
5. Export final Excel rota.
6. Export duty count, leave conflict, unit availability, and audit reports.

Acceptance:

- The final rota can be exported and defended from rule/version metadata.

Implementation status:

- Completed the first Phase 10 publish and export workflow.
- Added a publish checklist that blocks final approval when:
  - monthly unit scope is not locked,
  - no template slots exist,
  - generated slots remain open,
  - hard safety blockers remain,
  - exchange requests are still pending.
- Added warning confirmation for remaining review warnings and override assignments.
- Added publish approval audit records with approver, approval note, warning confirmation, checklist snapshot, rule version, and publish timestamp.
- Publishing marks the rota period as `published`.
- Added final Excel export after publish with:
  - Summary,
  - Final Rota,
  - Duty Counts,
  - Unit Safety,
  - Review Items,
  - Leave Safety Conflicts,
  - Exchange Audit.
- Added a `Publish & Export` frontend screen with checklist, approval form, and final Excel download.

## Phase 11: Debugging, QA, And Hardening

Action plan:

1. Run full backend, frontend, and visual QA passes.
2. Fix accumulated lint, typing, layout, and edge-case issues.
3. Debug older historical-analysis cleanup warnings that are not blocking the forward build.
4. Test the complete workflow from month setup to export.
5. Verify desktop and mobile layouts.
6. Review security, permissions, backups, and deployment behavior.
7. Prepare final acceptance checklist with the rota board.

Acceptance:

- The complete rota generator workflow is stable enough for real rota-board use.

Implementation status:

- Completed the first Phase 11 QA sweep across backend quality checks, backend tests, frontend build, migration state, and local app reachability.
- Fixed accumulated backend lint issues from older historical-analysis code:
  - removed an unused manual-review source read,
  - removed duplicate historical name-alias keys that were already being overwritten at runtime.
- Verified backend Ruff passes across the full backend package.
- Verified the full backend test suite passes after the cleanup.
- Verified the local database is at Alembic head `20260508_0012`.
- Verified the frontend production build passes.
- Verified the running frontend responds locally at `http://127.0.0.1:5173`.
- Remaining QA still needed with real rota-board data:
  - browser walkthrough on desktop and mobile,
  - imported leave files with difficult names, noisy headers, merged cells, and repeated staff labels,
  - full month setup to publish/export using actual department rules,
  - user acceptance review for terminology, hover help, and board-facing reports.

Final acceptance checklist:

1. Month setup has the correct year, month, included units, and active rule version.
2. Department member data is current, with unit, call-level, campus, and eligibility details filled.
3. Leave import has been reviewed, matched, cleaned, and committed to the monthly leave calendar.
4. Empty slot generation reflects leave availability and selected monthly units.
5. Calendar day popups clearly show slots, assignments, warnings, and hard blockers.
6. Candidate suggestions explain why each person is eligible, needs review, or is blocked.
7. Safe auto-fill only assigns clear low-risk slots and leaves risky slots open.
8. Manual overrides are recorded with reason and approver details.
9. Exchange requests are approved or rejected before publishing.
10. Publish checklist has no hard blockers and accepted warnings are intentionally confirmed.
11. Final Excel export includes rota, duty counts, unit safety, review items, leave conflicts, and audit history.
12. Board users can understand all user-facing labels and help text without seeing internal code terms.

## Phase 12: Call Cluster Eligibility

Action plan:

1. Add admin-defined call clusters as optional subgroups inside normal call levels.
2. Allow admins to assign members to one or more effective-dated clusters.
3. Extend duty rules so a duty can require whole call levels, specific call clusters, or both.
4. Update safety checks so missing required cluster eligibility is clearly blocked or override-only.
5. Update candidate suggestions and safe auto-fill so restricted duties only use matching cluster members.
6. Show cluster badges in Department Members, Unit Management, Rota Template day popups, Review, and Export where useful.
7. Keep current call-level behavior unchanged when no cluster restrictions are configured.

Acceptance:

- Admins can configure duties like Schell Call or Shift so only selected subgroups inside a call level are eligible.
- The rota board can see why a member is eligible or blocked for a special duty.
- Safe auto-fill never assigns a member outside a required cluster.
- Manual override remains possible but is traceable.

Implementation status:

- Planning completed in `Plan/unit management engine/03_call_cluster_eligibility_plan.md`.
- Phase 12A backend foundation started after approval.
- Added call cluster and effective-dated membership schema, migration, service helpers, and admin API endpoints.
- Extended duty rule JSON with optional allowed/excluded cluster keys while preserving current call-level behavior.
- Added backend tests for cluster CRUD, member assignment, and effective-date lookup.
- Next: build the admin UI for managing clusters and showing cluster badges in member/unit workflows.

## Phase 13: Call-Wise Unit Staffing Safety

Action plan:

1. Store minimum free people separately for each unit/call level.
2. Show those call-wise settings in the Unit Management popup beside assigned member counts.
3. Block invalid settings where the minimum exceeds assigned members in that unit/call.
4. Use the specific call pool during template generation when a duty has one required call level.
5. Keep the old unit-level minimum as a fallback for mixed-call or unclear duties.
6. Add regression tests for Unit Management validation, rota safety, and template generation.

Acceptance:

- Main 1st Call is evaluated against only 1st Call members in that unit.
- Main 3rd Call is evaluated against only 3rd Call members in that unit.
- The board cannot save a minimum-free rule that is impossible for that unit/call pool.
- Existing fallback behavior still works for duties without a single clear call level.

Implementation status:

- Implemented schema, API, Unit Management UI, template generation logic, safety hydration, and focused tests on 2026-05-10.
- Detailed implementation log is in `Plan/development_log.md` under `2026-05-10 - Call-Wise Unit Minimum Free People Rules`.

## Phase 14: Rota Review Board Decisions

Action plan:

1. Split Rota Review into workable queues for hard blockers, open slots, warnings, and overrides.
2. Load heavy candidate suggestions only for the selected slot detail.
3. Store accepted warnings and confirmed overrides as audit records.
4. Require a written board note for each accepted warning or confirmed override.
5. Keep hard blockers and open slots as fix-required items, not accept-in-place items.
6. Feed unresolved warning counts into Publish & Export.

Acceptance:

- Rota Review remains fast on full months.
- The board can see what still must be fixed versus what has been accepted.
- Accepted warnings and confirmed overrides retain who/when/why audit data.
- Publish can distinguish unresolved warnings from accepted review decisions.

Implementation status:

- Phase 14 queue/filter UI and on-demand slot suggestions implemented on 2026-05-10.
- Phase 14 review-decision storage, API, UI, migration, guide updates, and tests implemented on 2026-05-10.
- Detailed implementation logs are in `Plan/development_log.md` under:
  - `2026-05-10 - Rota Review Phase 1 And 2 Usability Pass`,
  - `2026-05-10 - Rota Review Phase 3 Review Decisions`.

## Phase 15: Rota Review Call-Wise Fairness

Action plan:

1. Compare people inside their own call level rather than across the whole department.
2. Include unit-posted members with zero assignments so under-assignment is visible.
3. Show assignment totals, 24-hour totals, weekend 24-hour totals, and duty-group burden.
4. Flag unusually high and low assignment loads within each call level.
5. Keep fairness informational first; do not block publish until the rota board approves the thresholds.

Acceptance:

- Rota Review shows call-wise workload averages.
- The board can see high-load and low-load people before final publish.
- Person-wise workload includes weekday/weekend split.
- Fairness checks remain fast enough for full-month review.

Implementation status:

- Backend fairness summary, frontend Call-Wise Fairness section, workload table expansion, and focused tests implemented on 2026-05-11.
- Detailed implementation log is in `Plan/development_log.md` under `2026-05-11 - Rota Review Phase 4 Call-Wise Fairness Audit`.

## Phase 16: Rota Review Exchange Target Eligibility

Action plan:

1. Load candidates for the selected exchange assignment's duty slot.
2. Populate the exchange target list from those slot-specific candidates.
3. Label each replacement as Safe, Needs Review, or Blocked.
4. Show a short target summary before request.
5. Warn the board before creating Needs Review or Blocked exchange requests.
6. Keep backend exchange validation as the final source of truth.

Acceptance:

- The board no longer chooses exchange targets from an unqualified all-active-member list by default.
- Replacement choices are tied to the specific duty slot.
- Risky replacement choices are visible before request.
- Candidate loading failure has a clear fallback state.

Implementation status:

- Frontend slot-aware exchange target loading, candidate-labelled dropdown, risk confirmation, and documentation completed on 2026-05-11.
- Detailed implementation log is in `Plan/development_log.md` under `2026-05-11 - Rota Review Phase 5 Exchange Target Eligibility`.

## Phase 17: Final Export Audit Pack

Action plan:

1. Add publish-readiness checklist details into the final Excel export.
2. Add accepted warning and confirmed override decisions into the export.
3. Add call-wise fairness summary into the export.
4. Expand review items with accepted/unaccepted status and decision notes.
5. Expand exchange audit with validation and override context.

Acceptance:

- The exported workbook can explain not only the final rota, but also what was reviewed, accepted, warned, exchanged, and fairness-checked.
- Accepted review decisions are visible outside the website.
- Call-wise fairness is available to the board after publish.

Implementation status:

- Final export audit sheets and expanded columns implemented on 2026-05-11.
- Detailed implementation log is in `Plan/development_log.md` under `2026-05-11 - Phase 17 Final Export Audit Pack`.

## Phase 18: Rota Template Call-Wise Export

Action plan:

1. Add a Rota Template Excel export that splits generated slots by required person call level.
2. Keep all call-level sheets inside one workbook.
3. Use the rule-level allowed call configuration first, then duty-type inference as fallback.
4. Keep the workbook compact by using the Eagle Eye duty-by-date matrix inside each call-level sheet.
5. Expose the export from the Rota Template screen beside Eagle Eye export.

Acceptance:

- The board can download one workbook and inspect 1st Call, 2nd Call, 3rd Call, and other required call duties separately.
- A duty appears under the call level of the person required to do that duty.
- Weekend rows are visibly highlighted.
- Category divider rows are omitted in call-wise sheets to avoid extra blank space.
- The export is documented in the user guide.

Implementation status:

- Implemented on 2026-05-11.
- Detailed implementation log is in `Plan/development_log.md` under `2026-05-11 - Rota Template Call-Wise Export`.
