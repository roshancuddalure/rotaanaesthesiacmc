# Complete Rota Generator Workflow Plan

Last updated: 2026-05-07

## Purpose

Build a rota generator that helps the rota board create a safe monthly duty rota while keeping final control with humans.

The system should not be a blind auto-fill tool. It should behave like a board assistant:

- import or enter the month inputs,
- understand leave, unit postings, call levels, duty types, and staffing pressure,
- generate duty slots from configurable templates,
- suggest or auto-assign people using transparent rules,
- warn when elective unit staffing becomes unsafe,
- allow manual edits, exchanges, and overrides with reasons,
- export the final rota in a department-friendly Excel format.

## Inspiration From Mature Rota Software

Premium rota tools usually converge on the same feature set:

- rule-defined automated scheduling,
- leave-aware rota generation,
- fairness tracking across historical duty burden,
- real-time coverage or gap visibility,
- swap and leave approval workflows,
- configurable eligibility and staffing thresholds,
- conflict checks before publishing,
- reusable rota templates,
- audit trails for overrides and disputes,
- Excel or shareable exports.

For this project, the feasible version should focus first on admin-only workflow, explainable suggestions, Excel export, and flexible rule configuration. Provider self-service mobile apps, live notifications, contract hours, and full AI optimization can come later.

## Core Principle

Every rota decision should be explainable.

For any generated assignment, the system should be able to answer:

- why this person was eligible,
- why other people were blocked,
- how leave and previous-day duties affected the decision,
- whether the unit still has enough people for elective work,
- how this affects individual duty counts and fairness,
- which rule version was used.

## Main Workflow: Monthly Rota Wizard

### Step 1: Select Month And Rota Period

Inputs:

- month and year,
- rota period name,
- campuses included: Main, CB, RC, RUHSA, CHAD, etc.,
- units included in this month's rota generation,
- units excluded from this month's rota generation,
- whether excluded units should be ignored completely or shown only for staffing safety,
- generation mode:
  - manual board,
  - suggest-only,
  - auto-fill draft,
  - auto-fill only safe slots.

System checks:

- whether a rota already exists for the month,
- whether unit assignments are ready,
- whether leave data exists,
- whether duty template rules exist for the month,
- whether selected units have enough assigned members to participate,
- whether excluded units still affect elective staffing calculations,
- whether active department members are approved.

Output:

- a draft rota period in `draft` status,
- a saved monthly generation scope,
- warning if required inputs are missing.

Monthly unit inclusion rule:

- Every rota period must explicitly store which units are included in generation.
- The rota board can include all units, selected units, or selected campuses.
- Unit inclusion affects which unit-based duty slots are generated and which people enter candidate pools.
- Even if a unit is excluded from duty generation, the board can choose whether that unit still appears in the safety dashboard.
- This prevents accidental generation for units that are not part of that month's rota plan.

### Step 2: Confirm Department Members

The rota board should approve the active member list before generation.

Required data per person:

- canonical name,
- active/inactive status,
- designation,
- call level,
- unit for the month,
- campus eligibility,
- duty eligibility,
- special restrictions,
- date-specific availability notes,
- whether they can be used for emergency/manual override.

Admin panel should support:

- active member list,
- bulk call-level update,
- unit assignment popup,
- duty eligibility matrix,
- temporary restrictions,
- rule exception notes.

Hard requirement:

- No free-text names in rota generation. Only approved department members can be assigned.

### Step 3: Import Or Enter Leave

Inputs:

- CSV/XLSX leave file for selected month,
- manual leave entries,
- leave status: pending, approved, rejected, cancelled,
- leave slot or leave category if applicable,
- person, start date, end date, reason/notes.

System processing:

- match leave names to canonical members,
- detect unresolved names,
- show day-wise leave pressure,
- show unit-wise leave pressure,
- show call-level leave pressure,
- show leave conflicts with already assigned duties,
- calculate active leave blockers per date.

Outputs:

- monthly leave calendar,
- leave validation report,
- unresolved leave name queue,
- leave pressure matrix.

Deferred but needed:

- CSV/XLSX import preview,
- configurable leave pressure limits,
- unit-specific leave limits,
- approval workflow beyond current status storage.

### Step 4: Prepare Unit And Call-Level Board

Inputs:

- monthly unit assignments,
- call level or posting type,
- start date and end date,
- special postings such as ICU/SICU/DRP/Pain/Neuro if needed,
- notes for special restrictions.

System processing:

- calculate total members per unit and call level,
- calculate leave count per unit per date,
- calculate people already on duty previous day,
- estimate people available for elective work:
  - total assigned to unit,
  - minus approved leave,
  - minus same-day duty if duty removes elective availability,
  - minus previous-day 24-hour duty if post-call rest removes elective availability.

Critical configurable rule:

- If more than a configured percentage of a unit/call-level group is unavailable due to leave, duty, or previous-day duty, the generator should avoid assigning more people from that unit/call-level on that date.

Initial default from rough idea:

- warning threshold: 30 percent unavailable,
- hard block threshold: configurable, likely 30 to 40 percent depending on unit size,
- minimum absolute available count should override percentage for small units.

Example:

- Unit II has 10 PG 2023 members.
- 2 are on leave.
- 1 had previous-day 24-hour duty.
- unavailable = 3/10 = 30 percent.
- Generator should avoid giving additional duty from that exact unit/call level unless override is approved.

### Step 5: Generate Leave-Aware Empty Duty Slots

Duty slots should be created before assigning people, but not blindly.

The empty slot template for the month must be based on:

- selected month,
- selected campuses,
- selected included units,
- duty template rules,
- approved/pending leave rules,
- unit/call-level staffing pressure,
- holiday/elective-light day rules if configured.

This means slot generation is a safety-aware planning step, not only a fixed calendar copy.

Duty types from current rough list:

- Main 1st Call
- Main 2nd Call
- Main 3rd Call
- Main 4th Call
- CB 1st Call
- Caesar A
- Caesar B
- CB 3rd Call
- CB 4th Call
- RC 1st Call A
- RC 1st Call B
- RC 12 hrs
- RC 2nd Call
- RC 3rd Call A
- RC 3rd Call B
- RC 4th Call
- 5th Call
- RUHSA
- CHAD
- CART Call
- Schell
- Main PAC PG 2023
- Main PAC SR
- Main PAC 3rd Call
- Main PAC Senior
- RC PAC SR
- RC PAC 3rd Call
- RC PAC Senior
- Main Shift SR
- RC Shift
- PB Shift

Each duty slot needs:

- date,
- duty type,
- campus/location,
- duty group,
- expected duration,
- start time and end time,
- whether it counts as 24-hour duty,
- whether it blocks elective work same day,
- whether it blocks elective work next day,
- required call level(s),
- allowed designations,
- allowed units or excluded units,
- required number of assignees,
- priority,
- optional pairing rules.

Admin panel should allow duty templates by:

- month,
- weekday/weekend,
- holiday,
- campus,
- included unit,
- excluded unit,
- duty type,
- duty group,
- effective date/version.

Leave-aware slot generation should do this:

1. Start from the base monthly duty template.
2. Apply the selected monthly unit-generation scope.
3. For each date and unit/call level, calculate leave pressure before creating slots.
4. If leave pressure is safe, create the normal duty slots.
5. If leave pressure crosses warning threshold, create the slot but mark it as `needs_review`.
6. If leave pressure crosses hard threshold, either:
   - skip that slot,
   - reduce required assignee count,
   - move it to manual-review bucket,
   - or create it as blocked from auto-assignment,
   depending on the configured policy.
7. Store the reason for every skipped, reduced, or flagged slot.

Slot generation policies should be configurable:

- always create all template slots and only warn,
- do not create unsafe unit-linked slots,
- create unsafe slots but block assignment until reviewed,
- reduce optional slots first,
- preserve mandatory emergency/on-call slots even if staffing is pressured,
- allow rota board chief to restore a skipped slot with reason.

Important distinction:

- Mandatory clinical coverage duties should usually still be generated, but they may need senior review if staffing pressure is unsafe.
- Optional, elective-support, or non-critical slots can be skipped/reduced when leave pressure is high.
- The admin panel must define which duty types are mandatory and which are adjustable.

### Step 6: Run Preflight Before Assignment

The system should not generate if critical inputs are broken.

Preflight checks:

- all selected month dates exist,
- monthly generation scope has at least one included unit,
- all duty templates have rules,
- all active people have call levels where required,
- all unit assignments are approved/ready,
- no unresolved leave names,
- no unknown duty type mappings,
- no impossible hard rules,
- staffing thresholds are configured,
- historical fairness baseline exists or generation starts with zero baseline.

Preflight result levels:

- error: cannot generate,
- warning: can generate but needs review,
- info: data quality note.

### Step 7: Build Candidate Pools

For each duty slot, the candidate engine builds a ranked list.

Eligibility filters:

- person is active,
- person is approved by rota board,
- person has required call level,
- person is allowed for the duty type,
- person is allowed for campus/location,
- person is not on approved leave,
- person has no same-day incompatible duty,
- person satisfies 24-hour rest rule,
- person does not break max duty limits,
- person does not make unit elective staffing unsafe,
- person does not violate special posting restrictions.

Candidate states:

- eligible,
- blocked by hard rule,
- allowed with warning,
- allowed only with override.

The UI should show both eligible and blocked candidates so the board understands why choices were limited.

### Step 8: Score Eligible Candidates

Scoring should be weighted and configurable.

Suggested scoring factors:

- lower total 24-hour duties this month,
- lower weekend duties this month,
- lower duty count for this exact duty group,
- lower historical burden over selected baseline months,
- lower recent-duty load,
- longer rest gap since last 24-hour duty,
- lower unit staffing pressure on that day,
- same call-level fairness,
- same designation fairness,
- campus fairness,
- preference or restriction notes,
- avoid repeated same person on same weekday/weekend pattern,
- avoid consecutive-year special burdens if later needed, such as Christmas or festival days.

Every score should produce explanation text:

- "Eligible: PG 2023, not on leave, last 24-hour duty 5 days ago, monthly total below group average."
- "Blocked: approved leave on May 14."
- "Warning: assigning this person leaves Unit III PG 2023 at 28 percent unavailable."

### Step 9: Assignment Strategy

The generator should support three modes.

Mode A: Suggest Only

- no assignment is made automatically,
- each slot shows ranked candidates,
- board chooses manually.

Mode B: Safe Auto-Fill

- system fills only slots where the top candidate has no warnings,
- risky slots remain empty for board decision.

Mode C: Full Draft Auto-Fill

- system attempts the full month,
- warnings are allowed but tracked,
- hard-rule violations stay unassigned unless override policy permits draft exceptions.

Recommended first build:

- implement Suggest Only first,
- then Safe Auto-Fill,
- only later Full Draft Auto-Fill.

### Step 10: Daily Unit Availability Guardrail

This is the key domain-specific feature from the rough idea.

For every date, unit, and call level:

Availability formula:

- total assigned members,
- minus approved leave on that date,
- minus members assigned to duty that removes elective availability on that date,
- minus members who had previous-day 24-hour duty if post-call rest applies,
- optionally minus members on special postings away from elective unit.

Metrics:

- total members,
- unavailable count,
- available count,
- unavailable percentage,
- minimum required available count,
- warning/block state,
- list of people causing pressure.

When assigning a duty, calculate the "after assignment" state.

Actions:

- if within safe threshold, allow,
- if warning threshold crossed, show warning,
- if hard threshold crossed, block auto-assignment,
- if manual override allowed, require reason and mark issue.

Admin panel should let the rota team configure:

- threshold percentage by unit/call level,
- minimum absolute available count,
- whether previous-day duty counts as unavailable,
- whether same-day PAC/shift counts as unavailable,
- whether small units use percentage, absolute count, or both,
- duty types that affect elective availability,
- cancellation/adjustment policy when unsafe.

### Step 11: Rota Board Review Interface

The board should have a month calendar plus operational panels.

Core views:

- Month Board: date columns and duty rows.
- Daily Safety View: unit-wise available/elective staffing.
- Person Load View: duty counts per person.
- Weekend Load View.
- Duty Mix View.
- Conflicts View.
- Empty Slots View.
- Overrides/Audit View.

Each slot should show:

- assigned person,
- duty type,
- warning icon if any,
- candidate button,
- conflict status,
- override status.

Slot actions:

- assign person,
- view candidate list,
- replace assignment,
- clear assignment,
- swap with another slot,
- lock slot,
- add note,
- mark manually approved.

### Step 12: Manual Exchange And Override Workflow

Needed from earlier notes:

- duty change after finalization by rota board chief,
- manual duty exchange with reason log,
- approval by rota board.

Exchange workflow:

1. Admin selects existing assignment.
2. Admin chooses replacement person or target slot for swap.
3. System validates both before and after states.
4. System shows conflicts, duty count changes, and unit availability impact.
5. Admin enters reason.
6. Rota board chief approves or rejects.
7. Audit event is stored.
8. Export/published rota is updated only after approval.

Audit fields:

- old person,
- new person,
- old slot,
- new slot,
- reason,
- requester,
- approver,
- timestamp,
- validation issues accepted,
- rule version.

### Step 13: Publish And Export

Before publish:

- no empty required slots unless explicitly allowed,
- no leave conflicts,
- no 24-hour spacing errors,
- no hard unit staffing violations,
- all overrides have reasons,
- all warnings reviewed,
- rota board approval recorded.

Outputs:

- Excel rota in familiar department layout,
- Excel analysis sheet,
- issue report,
- duty count summary,
- unit availability summary,
- person-level final workload,
- export metadata: month, generated timestamp, rule version, approver.

Statuses:

- draft,
- generated,
- under review,
- approved,
- published,
- finalized,
- reopened/amended.

## Admin Panel: Flexible Rule-Changing Interface

This should be a separate rule-control area for `computer_admin` / `superadmin`, with selected safe controls exposed to rota board users.

### Admin Panel Sections

1. Duty Types

- create/edit duty type,
- display name,
- code,
- campus,
- duty group,
- duration,
- start/end time,
- counts as 24-hour duty,
- counts as weekend burden,
- blocks elective same day,
- blocks elective next day,
- included/excluded from analysis buckets,
- active/inactive.

2. Duty Template Builder

- define which duty slots exist for each day pattern,
- weekday/weekend/holiday variants,
- unit-specific slot rules,
- included/excluded unit behavior,
- number of required people,
- mandatory vs adjustable slot flag,
- leave-pressure adjustment policy,
- recurring monthly template,
- effective date and rule version,
- clone previous month template.

3. Eligibility Matrix

- duty type vs call level,
- duty type vs designation,
- duty type vs unit,
- campus restrictions,
- person-specific eligibility overrides,
- temporary restriction dates.

4. Duty Count Limits

Configurable by:

- duty type,
- duty group,
- call level,
- designation,
- person,
- weekday/weekend,
- month,
- rolling period,
- campus.

Limit examples:

- max total 24-hour duties per month,
- max weekend duties per month,
- max Main duties per month,
- max RC duties per month,
- max PAC duties per month,
- max shifts per month,
- max consecutive duty days,
- minimum rest hours after 24-hour duty.

5. Unit Staffing Rules

- unit-level minimum available count,
- call-level-specific minimum available count,
- percentage unavailable threshold,
- warning threshold,
- hard block threshold,
- small-unit handling,
- whether previous-day duty removes availability,
- whether each duty type removes availability,
- holiday/elective-light day override.

6. Monthly Generation Scope

- choose included units for each rota month,
- exclude units for a month,
- include/exclude by campus if useful,
- clone previous month's included unit list,
- show member count and leave pressure per selected unit,
- warn if a selected unit has no approved members,
- decide whether excluded units still appear in safety calculations,
- lock the scope before final generation.

7. Leave Rules

- leave slots/categories,
- leave statuses that block duty,
- pending leave behavior,
- max leave pressure per unit/call level,
- leave import mapping,
- unresolved leave name review,
- leave conflict severity.

8. Fairness Weights

- weight for total duties,
- weight for weekend duties,
- weight for duty-type burden,
- weight for historical baseline,
- weight for rest gap,
- weight for unit staffing pressure,
- weight for same call-level balance,
- weight for campus distribution.

9. Validation Severity

Each rule should be configurable as:

- disabled,
- info,
- warning,
- hard error,
- override allowed with reason,
- override not allowed.

10. Rule Versions

- rule set name,
- effective month/date,
- created by,
- approved by,
- changelog,
- clone previous version,
- compare versions,
- rollback future version before use.

11. Audit And Permissions

- who changed rules,
- old value/new value,
- when changed,
- reason for change,
- approval status,
- board-visible summary of current active rules.

## Data Model Needed

Likely tables/models:

- `rota_periods`
- `duty_types`
- `duty_templates`
- `duty_slots`
- `duty_assignments`
- `monthly_generation_scopes`
- `monthly_generation_scope_units`
- `rule_sets`
- `rule_versions`
- `eligibility_rules`
- `duty_limit_rules`
- `rest_rules`
- `unit_staffing_rules`
- `leave_rules`
- `fairness_weight_rules`
- `validation_issues`
- `candidate_suggestions`
- `assignment_explanations`
- `assignment_overrides`
- `exchange_requests`
- `publish_approvals`
- `export_batches`

Existing models can be reused where already present:

- people/persons,
- aliases,
- units,
- person postings,
- leave requests,
- duty slots/assignments if already scaffolded,
- configurable rule settings.

## Backend Engine Modules Needed

Recommended backend structure:

- `rota_period_service`: create month, status transitions, publish checks.
- `duty_template_service`: build slots from templates.
- `availability_service`: leave, duty, rest, unit availability.
- `unit_staffing_service`: daily unit/call-level pressure calculations.
- `generation_scope_service`: monthly included/excluded unit scope.
- `eligibility_service`: hard filters and blocked reasons.
- `candidate_scoring_service`: weighted scoring and explanations.
- `assignment_service`: assign, replace, clear, swap.
- `validation_service`: issue generation and severity handling.
- `override_service`: reasoned overrides and audit.
- `exchange_service`: post-finalization duty changes.
- `export_service`: Excel output and metadata.

## Frontend Screens Needed

Board-facing:

- Rota Wizard
- Monthly Unit Scope Selector
- Monthly Rota Board
- Daily Unit Safety Panel
- Candidate Drawer
- Person Duty Load Drawer
- Conflict/Warnings Review
- Exchange Request Panel
- Publish Checklist
- Export Center

Admin-facing:

- Duty Type Rules
- Template Builder
- Monthly Generation Scope Settings
- Eligibility Matrix
- Duty Count Limits
- Unit Staffing Rules
- Leave Rules
- Fairness Weights
- Validation Severity Settings
- Rule Version Manager
- Audit Log

## Things Left From Earlier Plans

Already implemented foundation:

- manual leave first layer,
- unit management first layer,
- board-facing UX cleanup,
- analysis preflight/data quality foundation,
- trusted member cleanup baseline.

Still needed before rota generation is reliable:

- CSV/XLSX leave import preview,
- leave slot template design by call level,
- configurable leave pressure limits,
- unit-specific leave rules,
- monthly included-unit selection,
- final staffing threshold model,
- duty template builder,
- rota period setup with generation scope,
- leave-aware duty slot generation,
- candidate eligibility engine,
- candidate scoring engine,
- leave conflict enforcement,
- 24-hour rest validation in generator,
- manual assignment workflow,
- override and exchange approval workflow,
- publish checklist,
- Excel export,
- visual QA for rota board screens,
- backup/restore and stronger production authentication.

## Build Phases

### Phase 1: Rule Foundation And Duty Dictionary

Deliverables:

- duty type admin editor,
- eligibility matrix,
- duty count limits,
- rest rules,
- unit staffing rule table,
- mandatory vs adjustable duty flag,
- leave-pressure slot adjustment policy,
- rule version model.

Acceptance:

- rota team can configure duty types, count limits, staffing rules, and slot-adjustment behavior without code changes.

### Phase 2: Monthly Rota Period And Unit Scope

Deliverables:

- rota period setup,
- member approval check,
- unit assignment readiness check,
- monthly included-unit selector,
- monthly excluded-unit selector,
- clone previous month's unit scope,
- selected unit readiness dashboard,
- lock/unlock generation scope.

Acceptance:

- before generation, the board has explicitly selected which units participate in that month's rota.
- the system warns if an included unit has no approved members, missing call levels, or dangerous leave pressure.

### Phase 3: Leave Import And Leave Pressure

Deliverables:

- leave import preview,
- leave name resolution,
- leave approval state handling,
- daily leave calendar,
- unit-wise leave pressure dashboard,
- call-level-wise leave pressure dashboard,
- leave blockers API for generation.

Acceptance:

- selected month has clean leave inputs and the system can calculate leave pressure before any empty slots are generated.

### Phase 4: Leave-Aware Empty Slot Template Generation

Deliverables:

- duty template builder,
- generate empty slots for a month based on selected units,
- apply leave pressure before slot creation,
- flag unsafe slots as `needs_review`,
- skip/reduce adjustable slots if configured,
- preserve mandatory clinical coverage slots with warnings if configured,
- store slot-generation explanations,
- manual slot edits,
- slot validation.

Acceptance:

- board can create a blank monthly duty rota that already reflects selected units and known leave pressure.
- the system can explain why a slot was created, skipped, reduced, or sent to manual review.

### Phase 5: Availability And Unit Safety Engine

Deliverables:

- daily availability calculation,
- unit/call-level elective availability matrix,
- previous-day duty effect,
- staffing threshold warnings/blocks.

Acceptance:

- every slot can show whether assigning someone will make unit staffing unsafe.

### Phase 6: Manual Assignment With Validation

Deliverables:

- assign/replace/clear person in a slot,
- validate leave conflicts,
- validate call-level eligibility,
- validate 24-hour rest,
- validate duty count limits,
- validate unit staffing pressure after assignment,
- show issue severity and required override reason.

Acceptance:

- the board can safely build a rota manually before auto-fill exists.

### Phase 7: Candidate Suggestions

Deliverables:

- eligibility filters,
- blocked reasons,
- ranked candidates,
- scoring explanations.

Acceptance:

- board can open any empty slot and see explainable candidate choices.

### Phase 8: Safe Auto-Fill Draft

Deliverables:

- auto-fill safe slots,
- leave risky slots empty,
- full validation report,
- generated assignment explanations.

Acceptance:

- system can create a useful first draft without hiding risks.

### Phase 9: Review, Override, Exchange

Deliverables:

- board review dashboard,
- manual changes,
- exchange workflow,
- override reasons,
- audit log.

Acceptance:

- finalized rota can still be changed safely with traceable approval.

### Phase 10: Publish And Export

Deliverables:

- publish checklist,
- approval state,
- Excel export,
- issue report,
- final duty count report.

Acceptance:

- exported rota is shareable and includes enough metadata to defend decisions.

## Recommended First Implementation Slice

The best next slice is not full auto-generation. It should be:

1. Build duty type/rule admin pages.
2. Build monthly rota period setup.
3. Add monthly included-unit selection.
4. Add leave import preview and leave pressure calculation.
5. Generate leave-aware empty duty slots from configurable template.
6. Show skipped/reduced/flagged slot explanations.
7. Show leave and unit staffing pressure on the month board.
8. Add manual assignment with validation.
9. Add candidate suggestions for one or two duty groups.
10. Expand to all duty groups after the board confirms behavior.

This gives the rota board a useful tool early while keeping the complex algorithm inspectable.

## Open Decisions Needed From Rota Board

1. Exact call levels allowed for each duty type.
2. Which duties remove elective availability same day.
3. Which duties remove elective availability next day.
4. Whether PAC/shift duties count against unit staffing.
5. Minimum available count per unit/call level.
6. Whether the 30 percent threshold is warning, hard block, or both.
7. Whether small units should use absolute minimum instead of percentage.
8. Maximum monthly duty counts per call level.
9. Maximum weekend duty counts per call level.
10. Festival/holiday special rules.
11. Whether pending leave blocks assignment or only warns.
12. Who can approve overrides and finalized exchanges.

## Final Target

The final rota generator should feel like this:

- the rota board chooses the month,
- confirms members, units, and leaves,
- clicks generate slots,
- reviews leave/unit pressure,
- gets ranked candidates for each slot,
- optionally auto-fills safe duties,
- manually resolves the hard cases,
- validates the whole month,
- approves and exports,
- later performs duty exchanges with full reason and audit trail.

That is the practical premium-software shape adapted to the department's actual rota logic.
