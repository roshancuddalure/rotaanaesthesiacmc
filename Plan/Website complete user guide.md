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
- Safe suggestion: candidate the system considers safe.
- Review suggestion: candidate may be possible but needs human decision.
- Blocked suggestion: candidate should not normally be used.
- Manual assignment: board chooses a person directly.
- Override reason: written explanation for accepting a warning.
- Fast load mode: loads the page without expensive suggestions/history.
- Clear Template Cache: removes generated template slots when safe to do so.
- Export Eagle Eye: downloads a month-wide Excel view with duties as rows and dates as columns.
- Export Call-Wise: downloads the Eagle Eye layout split into separate sheets by required person call level, such as 1st Call, 2nd Call, and 3rd Call.

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
