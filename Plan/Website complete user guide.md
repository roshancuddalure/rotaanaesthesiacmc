# Duty Rota Website Complete User Guide

Last updated: 2026-05-08

This guide explains how to use the Duty Rota website from start to finish. It is written for a new rota board user who should not need to understand the code, database, or backend internals.

The most important rule is simple:

Before making a rota, make sure members, leave, and unit assignments are correct. Most rota problems come from wrong input data, not from the rota screen itself.

## Quick Start

Use the website in this order for a normal month:

1. Sign in.
2. Open Overview.
3. Check Department Members.
4. Open Leave and enter or import leave.
5. Open Unit Management and enter or import unit postings.
6. Open Rota Setup.
7. Select included units and lock the month scope.
8. Open Rota Template.
9. Generate the empty template.
10. Open each rota day and assign people.
11. Use Safe Auto-Fill only when the setup is clean.
12. Open Rota Review.
13. Fix open slots, warnings, hard blocks, and exchange requests.
14. Open Publish & Export.
15. Publish the final rota.
16. Download the Excel file.

If any page shows warnings, do not ignore them. Read the warning, open the suggested section, and fix the source problem.

## Phase 1: Data Readiness And Setup

Complete this phase before generating a rota template.

The purpose of Phase 1 is to make sure the system has correct source data. If members, leave, units, or setup are wrong, the Rota Template, Rota Review, and Publish pages will also behave wrongly.

Follow this order:

1. Open Department Members.
2. Confirm active people.
3. Confirm historical people are not accidentally active.
4. Confirm call levels.
5. Confirm designations.
6. Fix duplicate names and aliases.
7. Open Leave.
8. Select the correct month.
9. Enter or import leave.
10. Resolve unknown names or parser warnings.
11. Open Unit Management.
12. Select the correct month.
13. Enter or import unit postings.
14. Resolve unknown people, unknown units, and parser warnings.
15. Open Rota Setup.
16. Select the target month.
17. Confirm included units.
18. Confirm setup rules.
19. Move to Rota Template only after the above items are clean.

Phase 1 is successful when:

- No important member is missing.
- No active member has a wrong call level.
- Leave is entered for the correct month.
- Unit postings are entered for the correct month.
- Imported rows are resolved or intentionally ignored.
- Rota Setup matches the month the board wants to create.

## Phase 2: Rota Generation And Assignment

Complete this phase after Phase 1 is clean.

The purpose of Phase 2 is to create the monthly duty structure and assign people in a way that is readable, safe, and easy for the rota board to audit.

Follow this order:

1. Open Rota Template.
2. Select the correct month.
3. Generate the empty template.
4. Open the first rota day.
5. Review the duty groups shown for that day.
6. Work duty-wise first.
7. Under each duty, assign slots call-wise.
8. Check the candidate list before choosing a person.
9. Avoid people with leave, unit mismatch, recent duty conflict, or workload warning unless there is a clear reason.
10. Enter an override reason when keeping an assignment despite a warning.
11. Repeat this for every duty on the day.
12. Repeat this for every day in the month.
13. Use Safe Auto-Fill only after source data is clean.
14. Treat Safe Auto-Fill as a draft helper, not final approval.
15. Open Rota Review after assignments are done.

Safe Auto-Fill strict rule:

Safe Auto-Fill should only fill a slot when the required call level is known and the selected person has the same normalized call level. For example, a 2nd call duty should be filled by a 2nd call person, not by a 1st, 3rd, or unassigned call person. If the slot does not have a clear call requirement, Safe Auto-Fill should leave it open for board review.

The most important display rule:

Each rota day should be read under duty headings first. Inside each duty, slots should be ordered call-wise. The unit should be visible inside that specific duty slot so the user understands why that person is placed there.

Phase 2 is successful when:

- The template exists for the correct month.
- Every day has the expected duty slots.
- Assignments are grouped by duty.
- Slots under each duty are ordered call-wise.
- Every assignment has a suitable person.
- Warnings are fixed or have clear override reasons.
- Safe Auto-Fill results have been manually reviewed if it was used.

## User Roles

### Rota Board Member

This is the normal rota user. This user can work with:

- Overview
- Duty Analysis
- Department Members
- Leave
- Unit Management
- Rota Setup
- Rota Template
- Rota Review
- Publish & Export

This user should focus on rota creation and validation, not backend cleanup.

### Computer Admin

This user can do everything a rota board member can do, plus admin tools:

- Rota Rules
- Mappings
- Historical Import
- Login Accounts
- Diagnostics

Computer admin should handle data cleanup, import mapping, account creation, and diagnostic work.

### Superadmin

Superadmin is the highest access level. Use this role sparingly. It can manage accounts and admin tools.

## Website Mental Model

The website has four layers of information.

### Layer 1: People

This is the department member list. Each person may have:

- Name
- Active or historical status
- Call level
- Position or designation
- Aliases from imported data

If a person's name or call level is wrong, many later steps will be wrong.

### Layer 2: Availability

This comes mainly from Leave and Unit Management.

Leave tells the system who is unavailable.

Unit Management tells the system where each person is posted for the month and what call level or posting type they belong to.

### Layer 3: Rota Structure

Rota Setup and Rota Template create the empty duty slots for the month.

The template is not the final rota. It is the list of empty slots that must be filled.

### Layer 4: Assignment, Review, And Publish

Rota Template assigns people into slots.

Rota Review checks whether the rota still has problems.

Publish & Export records final approval and creates the final Excel output.

## Main Navigation

### Overview

Purpose:

Overview gives a quick board-facing summary of historical duty load and current workload patterns.

Use it to answer:

- How many 24-hour duties are in the analysis data?
- How much weekend burden exists?
- Who has the highest duty load?
- Who has the highest weekend duty load?
- How many active people are being considered?

Typical actions:

- Click Open Duty Analysis to inspect detailed distribution.
- Click Find Member to search Department Members.

Common difficulties:

- If Overview says analysis is unavailable, the backend may be offline or historical data may not be loaded.
- If names look wrong, check Department Members and admin mappings.

When complete:

Use Overview only as a dashboard. It is not where you create the monthly rota.

### Duty Analysis

Purpose:

Duty Analysis shows workload distribution from historical rota data. It helps the board make fairer decisions.

Tabs:

- Board Summary
- People
- Weekend Load
- Duty Mix
- CART / Schell
- 5th Call
- PAC / Shifts
- Postings
- Call Changes

Important metrics:

- Total 24hr duties: all counted 24-hour duties.
- Weekend 24hr: 24-hour duties on weekends.
- Weekend share: percentage of 24-hour duties that happen on weekends.
- Assignments reviewed: imported duty assignment rows included in analysis.
- Main, CB, RC: major call duty categories.

How to use:

1. Start with Board Summary.
2. Open People to compare individual duty load.
3. Open Weekend Load to check weekend fairness.
4. Open Duty Mix to check Main, CB, RC, Schell, Caesar, CART, PAC, shifts, and special duties.
5. Click a person's name to see their detailed popup.

Common difficulties:

- A person's workload looks too high: check if duplicate names or aliases exist.
- Duty labels look strange: admin may need to fix mappings.
- Months missing: historical import may not include those files.

When complete:

Use findings from Duty Analysis while assigning the new rota, especially for fairness.

### Department Members

Purpose:

Department Members is the master list of people who may appear in the rota.

Important terms:

- Active: currently available for rota planning.
- Historical: in old data but not normally used for current rota.
- Call level: current call category, such as 1st Call, 2nd Call, 3rd Call, 4th Call, or 5th Call.
- Position: designation or role, such as PG, SR, AP, faculty, or other department role.

How to use:

1. Search for a person by name.
2. Filter by active, all, or historical.
3. Filter by position if needed.
4. Filter by call level if needed.
5. For board users, call level is mostly read-only.
6. For admin users, call level can be edited.

Admin tools:

- Create Member
- Clean Invalid Names
- Prefill Call Levels
- Reconcile Trusted Roster

Common difficulties:

- Person missing: admin may need to create or reconcile member.
- Wrong call level: admin should correct it before rota generation.
- Duplicate person: admin should use member cleanup or merge tools.
- Strange imported names: admin should clean invalid names and aliases.

When complete:

Proceed only when active members and call levels are trustworthy.

### Leave

Purpose:

Leave records who is unavailable for each day of the month.

The rota generator uses leave to avoid assigning people who are unavailable.

Important terms:

- Leave request: a saved leave entry.
- Leave type: the reason or category of leave.
- Leave slot: whether leave blocks the full day or a specific part of the day.
- Blocking leave: leave that should prevent rota assignment.
- Leave pressure: how many people are unavailable on a day.
- Busiest day: day with highest leave burden.

Manual leave workflow:

1. Choose the month.
2. Select the person.
3. Select leave type.
4. Select leave slot.
5. Enter start and end dates.
6. Add notes if needed.
7. Click Add Leave.

Import leave workflow:

1. Choose the correct month.
2. Select the leave file.
3. Click Preview File.
4. Review matched, unresolved, and invalid rows.
5. Fix unresolved people if needed.
6. Click Apply Matched Rows only after preview is acceptable.

How to read the calendar:

- Each day card shows leave pressure.
- Click a day to see who is on leave.
- Groups may be shown by call level.

Common difficulties:

- Unresolved names: the file name does not match a known member.
- Invalid rows: date or leave data could not be parsed.
- Wrong month: imported leave may be applied to the wrong month if the month selector is wrong.
- Leave pressure high: assignment may be hard blocked later.

When complete:

Proceed to Unit Management only after leave looks correct.

### Unit Management

Purpose:

Unit Management tells the rota system where people are posted for the month and what call level/posting they belong to.

This is critical because unit staffing safety depends on it.

Important terms:

- Unit: department work area or clinical unit.
- Assignment: person assigned to a unit for a period.
- Posting type: call level or special posting category.
- Minimum free people: number of people who should remain free in a unit after rota assignment.
- Validation issue: warning or error found in unit data.

Manual unit assignment workflow:

1. Choose the month.
2. Click a unit card or Manage Unit.
3. Select a person.
4. Select posting type.
5. Enter start and end dates.
6. Add notes if needed.
7. Click Add Assignment.

Special posting card workflow:

1. Choose the month.
2. Click Pain Calls, SICU, or DRP.
3. Select the member.
4. Enter start and end dates.
5. Add notes if needed.
6. Click Add Assignment.

Pain Calls, SICU, and DRP are handled as special assignment cards. They do not need a normal unit to be selected, and they are saved with the special posting type instead of a unit load. Use these cards when the person is posted to that special work area for the month or part of the month.

Unitwise import workflow:

1. Choose the month.
2. Select the unitwise file.
3. Choose whether to replace existing unit-board assignments.
4. Click Preview File.
5. Review matched, unresolved, and invalid rows.
6. Fix unresolved people or units.
7. Click Apply Matched Rows.

Unit settings workflow:

1. Open a unit.
2. Set Minimum free people.
3. Save unit rule.

Common difficulties:

- Person not matched: member name needs cleanup.
- Unit not matched: unit label mapping may be missing.
- Wrong posting type: call level may be parsed incorrectly.
- Too few people in unit: rota safety may hard block slots.
- Replacing existing assignments accidentally: always check the replace checkbox before import.

When complete:

Proceed only when unit validation issues are fixed or understood.

### Rota Setup

Purpose:

Rota Setup defines the monthly rota period and which units are included in generation.

Important terms:

- Scope: which units are included or excluded for the month.
- Included unit: unit that gets rota slots.
- Excluded unit: unit not generated for this month.
- Locked scope: final confirmation that setup is ready for template generation.
- Readiness: whether included units have enough data for generation.

Workflow:

1. Choose the month.
2. Review all units.
3. Set each unit to included or excluded.
4. Check readiness warnings.
5. Decide whether excluded units should still count in safety.
6. Lock the scope.
7. Save Scope.

Clone workflow:

Use Clone Previous only when the unit setup should mostly match the previous month.

Common difficulties:

- Cannot generate template: scope is not locked.
- Unit appears unready: check Unit Management.
- Unit included by mistake: change it before locking.
- Unit excluded by mistake: include it before template generation.

When complete:

Proceed to Rota Template after the scope is locked.

### Rota Template

Purpose:

Rota Template creates empty duty slots and lets the board assign people.

This is the main working screen for monthly rota building.

Important terms:

- Template slot: empty duty position generated for a date and unit.
- Ready slot: slot that can be assigned.
- Needs review: slot requires board attention.
- Hard blocked: rules say assignment is unsafe unless data or rules change.
- Safety checked: slot has been checked against leave, unit, rest, and staffing rules.
- Cluster suffix: labels such as `(3A)`, `(3B)`, or `(3C)` beside a unit mean the duty is restricted to that specific 3rd-call eligibility subgroup.
- Safe suggestion: candidate the system considers safe.
- Review suggestion: candidate may be possible but needs human decision.
- Blocked suggestion: candidate should not normally be used.
- Manual assignment: board chooses a person directly.
- Override reason: written explanation for accepting a warning.
- Fast load mode: loads the page without expensive suggestions/history.
- Clear Template Cache: removes generated template slots when safe to do so.
- Export Eagle Eye: downloads a month-wide Excel view with duties as rows and dates as columns.
- Export Call-Wise: downloads the Eagle Eye layout split into separate sheets by required person call level, such as 1st Call, 2nd Call, and 3rd Call.
- Allocation Statistics: shows unit-wise, date-wise, duty-wise, duty-family, duty-family plus call-level, call-level-wise, and blocked/skipped allocation tallies for the generated template.

Generate template workflow:

1. Choose the month.
2. Confirm scope is locked in Rota Setup.
3. Open Template Generation Settings if needed.
4. Confirm dates.
5. Confirm duty types.
6. Click Generate Template.

Review calendar workflow:

1. Look at the Rota Calendar.
2. Click a day.
3. Review duty groups.
4. Under each duty group, slots are ordered call-wise.
5. Check unit, duty, required call, safety, assigned member, suggestions, and manual assignment.
6. If a unit is shown as `Unit 1 (3A)`, `Unit 1 (3B)`, or `Unit 1 (3C)`, assign only from the matching 3rd-call subgroup unless a validated board decision says otherwise.

Allocation statistics workflow:

1. Open Rota Template after generating the month.
2. Switch the overview mode to Statistics.
3. Check Unit-Wise Slot Tally to compare total, weekday, Saturday, Sunday, weekend, 24-hour, ready, review, forced, and unresolved slots per unit.
4. Check Duty Type Matrix to confirm a specific duty type is not repeatedly allocated to the same unit.
5. Check Duty Family Matrix to confirm Main, CB, RC, PAC, shift, and other duty groups are not concentrated into separate units.
6. Check Duty Family + Call Matrix to confirm buckets such as Main 1st, CB 1st, RC 1st, and RC 3rd are spread across units.
7. Check Target vs Actual to confirm whether the selected fairness policy produced the expected target share.
8. Check Generation Diagnostics to compare active people, created slots, forced slots, hard blocks, warning skips, and top blocked duty families per unit.
9. Check Date-Wise Distribution to see how many slots each unit received on each date.
10. Check Call-Level Distribution to review how required call levels were spread across units.
11. Check Blocked, Skipped, and Forced Decisions to understand why the engine had to place some duties as forced review slots.
12. Use this section during validation to show that the generator balanced unit availability, leave pressure, weekend distribution, post-duty availability, and duty-family mix rather than allocating randomly.

Fairness policy options:

- `Hybrid`: default. Blends unit participation and eligible-person capacity.
- `Equal Unit`: each included unit gets the same target share.
- `Equal People`: each unit's target follows active eligible people and call-level pool size.

Forced review slots:

- A forced review slot means every eligible unit was hard blocked for that duty/date.
- The engine still fills the cell with the fairest least-damaging unit so the generated Excel sheet has no empty duty cells.
- These slots are not treated as safe. Review them before assigning people.
- The Statistics tab shows the forced count per unit and per date, so the board can confirm these difficult slots were divided fairly.

Manual assignment workflow:

1. Open a day.
2. Find the duty slot.
3. Check safety status.
4. Choose a member.
5. Add override reason if needed.
6. Choose Replace Current if replacing an assignment.
7. Click Assign or Replace.

Suggestion workflow:

1. Open a day.
2. Check Suggested Members.
3. Click Use for a safe suggestion.
4. Click Review to select a suggestion that needs manual decision.
5. Add override reason if required.
6. Click Assign.

Safe Auto-Fill workflow:

Use only after leave and units are clean.

1. Confirm template exists.
2. Confirm warnings are understood.
3. Click Safe Auto-Fill.
4. Review what it assigned and what it left open.

Template export workflow:

1. Open Rota Template.
2. Confirm the correct month is selected.
3. Use Export Eagle Eye when you want a compact whole-month scan by date.
4. Use Export Call-Wise when you want the same compact duty-by-date view, but separated by required person call level.
5. In the call-wise workbook, each sheet uses duties as rows and dates as columns. Cells contain only unit names.
6. Category divider rows are intentionally not included in call-wise sheets so the export stays compact.
7. A Main 3rd Call duty appears in the 3rd Call sheet, not in the 1st Call or 4th Call sheet.
8. If a duty rule allows multiple call levels, that duty can appear in each allowed call-level sheet because any of those person levels may be eligible.

Common difficulties:

- Page feels slow: turn on Fast load mode.
- No generated slots: generate template or lock scope first.
- No suggestions: unit staffing or leave may block all candidates.
- Statistics show forced slots: open the blocked/skipped/forced decision table and review the per-unit reasons before assigning manually.
- Statistics show unresolved slots: regenerate the template after checking unit scope and duty rules, because normal hard-blocked duties should now become forced review slots instead of empty cells.
- Hard blocked slot: check Leave, Unit Management, and Rota Rules.
- Assignment rejected: selected person violates safety rules.
- Need override reason: system requires a written justification.
- Clear Template Cache disabled: existing assignments may prevent clearing.

When complete:

Every slot should be assigned or intentionally left for review.

### Rota Review

Purpose:

Rota Review is the final checking area before publish.

It is designed to show:

- Open slots
- Warning slots
- Hard-blocked slots
- Override assignments
- Person workload
- Call-wise fairness
- Exchange requests
- Accepted review decisions

Important terms:

- Review item: anything that needs board attention.
- Hard-blocked item: a serious blocker that should be fixed before publish.
- Accepted warning: a warning the rota board has reviewed and accepted with a written note.
- Override assignment: assignment saved with a reason despite a warning.
- Confirmed override: an override assignment the rota board has reviewed and confirmed with a written note.
- Call-wise fairness: workload comparison inside the same call level, such as 1st Call compared with 1st Call only.
- High-load flag: a person has more assignments than the average for that call level.
- Low-load flag: a person has fewer assignments than the average for that call level.
- Exchange request: request to replace one assigned person with another.
- Pending exchange: exchange waiting for approval or rejection.

Workflow:

1. Choose the month.
2. Review summary metrics.
3. Use the review filters: All, Hard Blockers, Open Slots, Warnings, Overrides.
4. Fix hard blockers and open slots first. These are not ordinary warnings.
5. For a warning or override, open the review item.
6. If the board accepts the warning, click Accept Warning and enter a clear decision note.
7. If the board accepts an override assignment, click Confirm Override and enter a clear decision note.
8. Use Open Full Day to fix or inspect the slot in Rota Template.
9. Check Call-Wise Fairness.
10. Check Person-Wise Duty Load.
11. If needed, request an exchange.
12. Approve or reject pending exchanges.

Call-wise fairness workflow:

1. Review one call level at a time.
2. Compare total assignments and 24-hour duties within that call level.
3. Check weekend 24-hour load.
4. Check duty group totals, such as Main, CB, RC, Shift, PAC, or Schell.
5. Use high-load and low-load flags to decide whether to adjust future assignments.
6. Remember that fairness is advisory at this stage. It helps board judgment but does not automatically block publish.

Review decision notes:

- Write the real board reason, not just "ok".
- Example: "Accepted because only one eligible 3rd Call is available and consultant cover is arranged."
- The decision note is stored for audit and future debugging.
- Do not accept hard blockers from Rota Review. Hard blockers should be fixed by changing leave, unit assignment, duty assignment, or rules.

Exchange workflow:

1. Select current assignment.
2. Wait for the new member list to load for that exact duty slot.
3. Review the Safe, Needs Review, and Blocked counts shown below the target list.
4. Select the new member.
5. Prefer Safe targets when possible.
6. If selecting a Needs Review or Blocked target, read the warning carefully before continuing.
7. Enter reason.
8. Click Request Exchange.
9. Review validation result.
10. Approve or reject.
11. If approval needs override, enter decision reason.

Exchange target statuses:

- Safe: no known person-specific blocker for that slot.
- Needs Review: may be usable, but the board should review the warning before requesting.
- Blocked: has a serious conflict. Avoid unless there is a deliberate board reason and backend validation allows the request.
- Not prechecked: the candidate check could not load, so the dropdown is using active members as fallback. Treat this as less safe and verify before approving.

Common difficulties:

- Rota Review loads slowly: backend may be computing safety; wait briefly, then refresh. If repeated, use Rota Template Fast load mode and check backend.
- Suggestions are not loaded for every review row at once. Open one review item to load suggestions for that exact slot.
- Open slots remain: go to Rota Template and assign them.
- Hard blocks remain: fix source data or change assignment.
- Warning remains after accepting: another unresolved issue may still exist on the same slot.
- Exchange blocked: selected replacement is unsafe.
- Approval reason required: the exchange needs an override reason.

When complete:

Proceed to Publish & Export when review items are clear or deliberately accepted.

### Publish & Export

Purpose:

Publish & Export is where the final rota is approved and downloaded.

Important terms:

- Checklist blocker: problem that prevents publish.
- Checklist warning: issue that can be published only with confirmation.
- Final approval: recorded decision that rota is ready.
- Final Excel export: downloadable rota file.

Workflow:

1. Choose the month.
2. Read the status panel.
3. Review clear checks, blockers, and warnings.
4. If blockers exist, open Rota Review and fix them.
5. If warnings exist, decide whether to confirm them.
6. Enter approval note.
7. Click Publish Final Rota.
8. Download Excel.

Final Excel export sheets:

- Summary: month, approval, slot counts, review counts, and fairness flags.
- Publish Readiness: checklist blockers, warnings, and clear checks.
- Final Rota: final duty assignments.
- Duty Counts: person-wise workload, weekday/weekend split, and duty group burden.
- Call Fairness: call-wise averages, high-load people, low-load people, and duty group totals.
- Unit Safety: unit-day safety summary.
- Review Items: warnings, blockers, accepted status, and decision notes.
- Review Decisions: accepted warnings and confirmed overrides with who/when/why audit notes.
- Leave Safety Conflicts: people blocked or warned by leave/rest safety.
- Exchange Audit: exchange decisions and validation status.

Common difficulties:

- Publish button disabled: blockers remain.
- Warning confirmation required: check the warning checkbox.
- Approval note required: enter who approved and any board note.
- Download disabled: rota has not been published yet.

When complete:

Save the Excel export as the final monthly rota file.

## Admin Tools

Admin tools are for computer admin and superadmin users.

### Rota Rules

Purpose:

Defines the duty dictionary and rule foundations.

Includes:

- Duty type label
- Duty group
- Duration
- Mandatory or adjustable status
- Rest behavior
- Allowed call levels
- Unit staffing thresholds

Use carefully. Changing rules affects future generation and safety.

Common difficulties:

- Wrong rule causes many hard blocks.
- Allowed call levels too strict can produce no candidates.
- Rest rule changes can affect many people.

### Mappings

Purpose:

Maps messy imported labels to clean system labels.

Examples:

- Historical duty label to known duty type
- Unit label to known unit
- Posting label to call level/posting type

Workflow:

1. Scan Historical Files.
2. Filter mappings.
3. Select or enter target key.
4. Confirm target label.
5. Set status.
6. Save.

Common difficulties:

- Unresolved mapping causes analysis gaps.
- Wrong duty mapping corrupts workload analysis.
- Wrong unit mapping affects unit postings.

### Historical Import

Purpose:

Imports historical rota and unitwise data for analysis and seed data.

Use only when source files and mappings are ready.

Common difficulties:

- Source folder missing.
- Import warnings appear.
- Skipped names need member cleanup.
- Wrong mapping can affect many months.

### Login Accounts

Purpose:

Create and list login accounts.

Workflow:

1. Enter username.
2. Enter display name.
3. Enter password.
4. Select role.
5. Create account.

Common difficulties:

- Username already exists.
- Wrong role assigned.
- User cannot see admin tools because role is rota board member.

### Diagnostics

Purpose:

Shows system health and database counts.

Use when:

- Data looks wrong.
- Import status is unclear.
- Admin wants a JSON summary.

Common difficulties:

- Diagnostics unavailable: backend or permissions issue.
- Counts look wrong: verify imports and mappings.

## Glossary

| Term | Meaning |
| --- | --- |
| Active member | Person currently used for rota planning. |
| Historical member | Person present in old data but not normally used now. |
| Assignment | A saved link between a person and a duty slot. |
| Call level | Person or posting category such as 1st Call, 2nd Call, 3rd Call, 4th Call, or 5th Call. |
| Candidate | Person suggested for a duty slot. |
| Duty slot | Empty rota position for a duty on a date. |
| Hard blocked | System found a serious rule or availability conflict. |
| Leave pressure | Number or burden of people unavailable on a day. |
| Locked scope | Monthly unit selection confirmed for generation. |
| Manual assignment | Board directly chooses a person for a slot. |
| Override | Board knowingly accepts a warning with a reason. |
| Posting | Unit or call-level placement for a person. |
| Review item | A rota issue requiring attention. |
| Safe Auto-Fill | Automatic assignment of low-risk safe suggestions. |
| Safety check | Rule check using leave, units, rest gap, and staffing data. |
| Scope | Included/excluded units for a rota month. |
| Template | Generated empty rota slots before final assignments. |
| Unit | Work area or clinical unit used for staffing. |

## Duty Terms

| Term | Meaning |
| --- | --- |
| Main call | Main 24-hour duty group. |
| CB call | CB duty group. |
| RC call | RC duty group. |
| Schell | Schell call duty. |
| Caesar | Caesar duty group, including Caesar A or B where relevant. |
| CART | CART duty. |
| PAC | PAC duty. |
| Shift | Shift duty. |
| 5th Call | Fifth call duty category. |
| 24-hour duty | Duty that counts as a full 24-hour duty. |
| Weekend duty | Duty occurring on Saturday or Sunday. |

## Common Problems And Fixes

### Page keeps loading

Meaning:

The frontend is waiting for the backend.

Fix:

1. Wait briefly.
2. Refresh page.
3. Check backend is running.
4. If Rota Template is slow, enable Fast load mode.
5. If Rota Review is slow, check whether safety or backend queries are stuck.

### API offline

Meaning:

Frontend cannot reach backend.

Fix:

1. Start the app with `start.ps1`.
2. Confirm backend is running on port 8000.
3. Confirm frontend API base URL is correct.

### Cannot sign in

Fix:

1. Check username.
2. Check password.
3. Use Forgot Password if enabled.
4. Ask superadmin to reset or create account.

### Person is missing

Fix:

1. Search Department Members.
2. Check Active and All filters.
3. Admin creates or reconciles member if truly missing.

### Wrong call level

Fix:

1. Admin opens Department Members.
2. Update call level.
3. Recheck Unit Management.
4. Recheck Rota Template safety.

### Leave import has unresolved rows

Fix:

1. Check raw name.
2. Find or create matching member.
3. Correct aliases or roster.
4. Preview import again.
5. Apply matched rows only.

### Unit import has unresolved rows

Fix:

1. Check raw person name.
2. Check raw unit label.
3. Fix member or unit mapping.
4. Preview again.
5. Apply matched rows only.

### Template cannot generate

Likely causes:

- Scope not locked.
- No included units.
- No active duty rules.
- Existing generated slots have assignments and cannot be replaced.

Fix:

1. Open Rota Setup.
2. Include units.
3. Lock scope.
4. Reopen Rota Template.
5. Generate again.

### No candidates available

Likely causes:

- Too many people on leave.
- Unit has too few free people.
- Call level mismatch.
- Rest rule conflict.

Fix:

1. Check Leave.
2. Check Unit Management.
3. Check person's call level.
4. Use manual assignment with override only if board accepts it.

### Hard blocked slot

Meaning:

The system found a serious blocker.

Fix:

1. Open the slot.
2. Read safety reasons.
3. Fix source data if wrong.
4. Choose another person if possible.
5. Use override only if allowed and documented.

### Publish disabled

Likely causes:

- Open slots.
- Hard blockers.
- Checklist blockers.

Fix:

1. Open Publish checklist.
2. Click blocker action.
3. Fix in Rota Review or Rota Template.
4. Return to Publish.

## Monthly Rota Checklist

Use this checklist for every month.

### Data Preparation

- [ ] Members checked.
- [ ] Active/historical status checked.
- [ ] Call levels checked.
- [ ] Leave entered or imported.
- [ ] Leave pressure reviewed.
- [ ] Unit assignments entered or imported.
- [ ] Unit validation issues reviewed.

### Rota Generation

- [ ] Rota Setup month selected.
- [ ] Units included/excluded correctly.
- [ ] Scope locked.
- [ ] Rota Template generated.
- [ ] Template calendar reviewed.
- [ ] Safety checked.

### Assignment

- [ ] Each day opened.
- [ ] Duty groups reviewed.
- [ ] Slots assigned call-wise.
- [ ] Hard blocks fixed.
- [ ] Override reasons entered where needed.
- [ ] Safe Auto-Fill reviewed if used.

### Review

- [ ] Rota Review opened.
- [ ] Open slots fixed.
- [ ] Hard blocks fixed.
- [ ] Workload reviewed.
- [ ] Exchange requests handled.
- [ ] Warnings accepted or fixed.

### Publish

- [ ] Publish checklist reviewed.
- [ ] Blockers cleared.
- [ ] Warnings confirmed if accepted.
- [ ] Approval note entered.
- [ ] Final rota published.
- [ ] Excel exported.

## Emergency Fix Checklist

Use this when the rota is almost final but a problem appears.

1. Identify the problem.
2. Decide if it is data, assignment, rule, or publish problem.
3. If data problem, fix Members, Leave, or Unit Management.
4. If assignment problem, fix Rota Template.
5. If warning problem, fix Rota Review.
6. If publish problem, open Publish & Export checklist.
7. Recheck affected day.
8. Recheck Rota Review.
9. Publish again only after review is acceptable.

## What Not To Do

- Do not publish with unresolved blockers.
- Do not ignore hard blocks.
- Do not use override without a clear reason.
- Do not import files into the wrong month.
- Do not clear template cache casually.
- Do not run historical import casually.
- Do not change Rota Rules in the middle of a month unless the board understands the effect.
- Do not assume Safe Auto-Fill completed the rota.

## Recommended Operating Routine

For each month, assign one person to own each responsibility:

- Data owner: members, leave, unit assignments.
- Rota owner: template generation and assignments.
- Review owner: warnings, hard blocks, exchanges.
- Approval owner: publish and final Excel export.

This prevents one person from accidentally mixing data cleanup, rota assignment, and final approval without review.

## Manage Department Members and Upload CSV or Excel

Computer admins and superadmins can use the **Member List**, **Import and Review**, and **Import History** links in Department Members. The list searches canonical names and saved aliases, with status, position, and call-level filters. Manual call-level edits and completed imports refresh the master list, call counts, and audit indicators together.

1. Download the simple CSV template (`name,call_level`) or the Excel template, or use your own `.csv` / `.xlsx` file with a header row and one member per row. Save CSV files using UTF-8 encoding; comma, semicolon, and tab delimiters are supported.
2. Select your file. Set the header row if it is not row 1, then click **Read File and Columns**.
3. Choose the worksheet and map its columns. Only **name** is required. Optional columns are designation, call level, status, aliases, effective-from date, and effective-to date.
4. Click **Preview Normalized Members**. Review the original values, normalized details, matched member, and proposed changes.
5. Use **Review rows** to focus on updates, new members, or review items. For uncertain matches, select a suggested existing member, explicitly create a new member, or skip the row. Correct invalid values in your file and upload again, or skip those rows. Preview again after changing selections.
6. If existing call levels change, review the old and new levels and tick the explicit approval checkbox. Click **Apply Reviewed Import** once every review item is resolved or skipped.

Names have titles and extra spaces cleaned. Existing canonical names are preserved when matching by names or aliases. A spelling manually matched to a member becomes an alias for later uploads. Similar names require review; members are never automatically merged.

Use `1st call` through `5th call` (or `first` through `fifth`) for call levels. Supported statuses are `active`, `inactive`, `historical`, and `archived`. Separate aliases with semicolons. Designations require an effective-from date; dates may be Excel date cells or `YYYY-MM-DD`. Formula cells must be replaced with values.

Blank optional cells preserve existing values. New members default to active status. Importing the same data again does not duplicate members, aliases, or designation entries. Existing duties, leave, and unit postings remain linked to the same member. Unit assignments continue through Unit Management.

Every CSV and Excel row is checked against all existing members and aliases, including earlier uploads and historical or archived records. Duplicate rows and ambiguous matches require review. Missing members in an uploaded file remain unchanged; importing is not a roster replacement.

Each import records its source filename, worksheet, file row, original and normalized values, changes, and importing account. **Import History** displays the latest 30 member import batches; use **View Rows** to review the recorded source values and before/after changes. Re-uploading an unchanged file may be recorded as an unchanged import without duplicating members. Imports are transactional: a write failure rolls back the entire batch. If member data changes after preview, preview again before applying.

Limits: `.csv` or `.xlsx`, 5 MB file size, 50 MB expanded size for Excel, 5000 data rows, and the first 50 columns (CSV files with more columns are rejected). Import one worksheet at a time. The supported fields do not include phone numbers, email addresses, or employee IDs.

## Past Duties for Statistics and Future Allocation

Computer admins and superadmins can open **Admin Tools → Past Duties** to upload completed `.xls` or `.xlsx` rotas. Files are limited to 5 MB. Import one selected month and worksheet at a time.

1. Download the standard assignment-table template, or choose the departmental matrix layout used by the existing parser. The table requires `date`, `name`, and `duty_type`; optional columns are `starts_at`, `ends_at`, `campus`, and `slot`.
2. Select the completed-duty month, worksheet, layout, and header/date row. For the departmental matrix, the first selected row is dates, the next is weekdays, then duty labels and names.
3. Read the worksheets, map columns for a table, and preview. Check normalized member names, duty types, dates, and local hospital start/end times. If times are blank, the standard duty windows are shown explicitly in preview.
4. Resolve names using the existing member master list and resolve unknown duty labels. Missing former staff should be added as historical members first; this workflow does not change members' current call levels or create people automatically.
5. Resolve duplicate rows, skipped values, and conflicts with previously uploaded or published duties. Reuploads are unchanged when the member, date, duty, and times match. A different member for an existing duty requires a selected correction and explicit approval. Additional parallel duties require a distinct slot label and deliberate selection. Different recorded times require manual/source correction rather than being silently overwritten.
6. Preview again after changing resolutions. Acknowledge parser warnings and approve any member corrections, then apply. Prior corrected assignments remain in the audit trail as superseded and stop contributing to statistics. An unfinished draft month must be finalized/published before completed duties can be imported into it.

**Recorded History Coverage** shows observed months, duties, members, and days with records. These counts are not proof of a complete roster. **Past-Duty Import History → View Rows** shows source values, normalized records, and prior members for corrections. Future/today duties cannot be marked completed by this workflow.

Parallel assignments to different people for the same duty/date must also be reviewed within a brand-new upload. Give each parallel row a distinct `slot` label, then select **Additional** for subsequent rows and preview again. Otherwise skip the duplicate. This check applies before any records are saved, as well as against earlier uploads. Reusing an inactive saved slot cannot silently override the start/end times you reviewed. Changes to saved slot metadata after preview require a fresh preview.

**Historical Fairness Settings** defaults to a six-month lookback. It adds configurable penalties for above-average total, 24-hour, weekend, and same-category burden among observed active peers at the same call level. Each person's rates use their observed months; missing data is neutral rather than zero-duty credit. Settings are saved with an effective date and selected using the target month's first day. Candidate explanations and saved auto-fill events show the historical score contribution. Existing leave/eligibility rules remain authoritative, and recorded duties participate in overlap/rest checks across month boundaries even when historical fairness is disabled.

The older server-folder historical rebuild remains under a disclosure section. New uploaded past-duty batches use their own source and are retained independently of that rebuild. Legacy `.xls` support uses `xlrd`, installed through backend dependencies and checked by the launcher.

## Member Profiles, Promotions, and HOD Comments

Click a person's name in **Department Members** to open their profile card on desktop or mobile. The same member ID connects aliases, imports, postings, leave, duties, and statistics.

The profile shows current status and call level, official-duty totals, dated call-level changes, designation history, aliases, unit postings, recent leave, and member-import source rows. Earlier promotion dates are not invented for existing members; their existing call level is the baseline until dates are recorded.

If the member already holds a call level and its start date has just been confirmed, the first timeline entry may keep the same level and record the known effective date with its supporting reason. This appears as **Baseline recorded**, rather than inventing a previous promotion level.

Admins and HOD users can record a call-level change with its **effective-from date** and **reason/approval reference**. A future change stays scheduled. Add changes in effective-date order; the system rejects a backdated change when a later entry already exists. Current-day CSV/Excel call changes and the trusted prefill workflow also record history. Changes do not rewrite completed duties, but daily rota eligibility and capacity use the call level effective on the duty date. Unit summary counts use the start of the selected month/assignment; daily eligibility remains date-specific for mid-month promotions. Analysis uses recorded promotion history where available instead of inferring it solely from old duty labels.

Admins can also edit names/status, add aliases, and add dated designations from the profile. Renames preserve the former name as an alias. Data refreshes from the member master record rather than creating a second person in another section.

**Admin and HOD Comments** retain the author, role, and recording time. They are visible to computer admins, superadmins, and HOD accounts; rota-board accounts can view the general profile but cannot access these comments or edit the promotion timeline. Comments are append-only; add a follow-up to correct one. A superadmin can create a login with the **Head of Department** role under Login Accounts. The HOD role grants profile/promotion/comment access without granting import or software-admin privileges.

The profile tables are added by migration `20261012_0018`. The local database was upgraded during implementation; other deployments must run `alembic upgrade head` when upgrading the app.


## Reviewed Generation and Local Compute

In Rota Template, choose **Generate & review draft**. Follow progress, review each
proposal and unresolved slot, expand the workload comparison, and download the report
if needed. Confirm review and choose **Apply reviewed draft** to save assignments.
This does not publish the rota. Close and reopen to continue an interrupted proposal;
Cancel proposal discards its proposed choices without changing existing assignments.

Admins can open **Compute Settings** to test the current device, enable browser GPU
use, choose Server/Automatic/Prefer local GPU, or reset the device preference. The
preference affects this browser only. GPU use starts off. Automatic stays on the
server until three runs per engine show identical results and sufficient end-to-end
benefit on the same rota data. A GPU fault or unavailable API falls back to the server.
Keep the page open while it computes. A stale-data message means the rota or rules
changed: cancel the old proposal and generate a fresh one.

See `../docs/staged_compute_implementation.md` for the complete verification record,
measured benchmark, supported-device limits and deployment flags.
