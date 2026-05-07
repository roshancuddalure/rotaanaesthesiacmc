# Unit Management Interface and Workflow Plan

Last updated: 2026-05-07

## Purpose

The Unit Management system will be the monthly staffing layer between Department Members, Leave, and Rota Slot Generation.

For every rota month, the rota board team must be able to assign members at each call level to their concerned units. The rota generator will then use that monthly unit staffing map to decide:

- who is eligible for unit-linked duties,
- how many people are available in each unit on each day,
- how leave affects elective-list staffing,
- whether duty slots for a unit/day need to be reduced, increased, blocked, or warned,
- whether a suggested duty assignment would make elective service unsafe.

This should become a board-facing planning tool, not an admin/debug screen.

## Core Product Idea

The system should answer four rota-board questions:

1. Who belongs to each unit this month?
2. At what call level are they functioning this month?
3. On each date, how many people are actually available for elective work after leave and duties?
4. Based on that availability, how many duty slots can safely be assigned without compromising elective service?

## Current Backend Fit

Existing models:

- `Unit`
  - code,
  - name,
  - campus,
  - active status.
- `PersonPosting`
  - person,
  - unit,
  - posting type,
  - start date,
  - end date,
  - source,
  - notes.
- `LeaveRequest`
  - person,
  - leave date range,
  - leave slot,
  - status.
- `DutySlot` and `DutyAssignment`
  - already allow unit-linked duty slots.

This is a good base. The missing layer is a monthly unit-planning interface and staffing/availability calculations.

## Key Definitions

### Unit

A working department/unit/team for a month.

Examples may include:

- Main,
- Cardiac,
- Neuro,
- CTVS,
- ICU/SICU,
- Pain,
- DRP,
- PAC,
- outside/rotation units if needed.

Final unit list should come from existing `units` table and be editable by admin only.

### Monthly Unit Assignment

A record that says:

- person X,
- belongs to unit Y,
- from date A to date B,
- with call level Z,
- for rota month M.

This currently maps to `PersonPosting`.

### Elective Availability

The number of people available in a unit on a specific day after subtracting:

- approved leave,
- already assigned duties that remove the person from elective work,
- post-duty rest if configured,
- special posting constraints,
- inactive/unavailable members.

### Unit Staffing Threshold

Minimum people required to run elective service for that unit and call level on a given day.

Example shape:

- Main unit requires at least 2 first calls, 2 second calls, 1 third call available on weekdays.
- Cardiac may require a different minimum.
- Weekends may require different rules.

The exact thresholds should be configurable later; the first plan should design for them.

## Main Workflow

### 1. Select Rota Month

Rota board opens `Unit Management`.

Top controls:

- month selector,
- copy from previous month,
- import from unitwise file later,
- save draft,
- mark month ready for rota generation.

The screen always works in the context of one month.

### 2. Review Unit Roster Grid

The main interface shows a unit-by-call-level board.

Rows:

- units.

Columns or groups:

- 1st call,
- 2nd call,
- 3rd call,
- 4th call,
- co-4th call,
- 5th call,
- special postings if relevant.

Inside each cell:

- assigned members,
- member count,
- warning if too few,
- warning if duplicate assignment,
- leave pressure summary for that group.

### 3. Assign Members

The rota board can:

- add member to a unit/call-level cell,
- move member between unit/call-level cells,
- remove member from unit assignment,
- edit effective date range if assignment is partial month,
- add note.

Person selection must use canonical Department Member picker.

No free-text member names.

### 4. Validate Monthly Unit Map

Before using the map for rota generation, the system validates:

- member assigned to more than one full-time unit in overlapping dates,
- missing unit for active member if expected,
- call level missing,
- inactive/historical member assigned,
- unit has too few people for configured minimum,
- duplicate person in same unit/call-level,
- leave pressure makes a unit unsafe on multiple days,
- special postings overlap with normal unit assignment.

Validation levels:

- Error: must fix before rota generation.
- Warning: can continue but should be reviewed.
- Info: context note.

### 5. Daily Availability Calculation

For each date in the selected month:

Start with:

- monthly unit assignments,
- member call level for that assignment,
- active status.

Subtract or flag:

- approved full-day leave,
- approved partial leave if it blocks elective work,
- duty assignment that day,
- previous-day 24hr duty if rest rule applies,
- special posting if it removes elective availability.

Output:

- unit,
- date,
- call level,
- assigned people,
- people on leave,
- people on duty,
- available people,
- required minimum,
- surplus or deficit.

### 6. Rota Slot Generation Uses Unit Availability

When generating duty slots for a unit/day, the generator should:

1. Load monthly unit map.
2. Load leave calendar.
3. Load existing duty draft assignments.
4. Compute available elective staffing for each unit/call-level/day.
5. Compare with configured minimum elective staffing.
6. Decide allowed duty capacity:
   - normal slots allowed,
   - fewer slots allowed,
   - slots require warning,
   - slots blocked.
7. Candidate selection excludes people whose assignment would make unit availability unsafe.

## Board-Facing Screens

## Screen 1 - Unit Management Overview

Purpose:

- see overall readiness of the monthly unit map.

Elements:

- month selector,
- ready status,
- active members assigned,
- unassigned active members,
- total units staffed,
- validation errors/warnings,
- high-risk dates caused by leave.

Primary actions:

- open assignment board,
- copy previous month,
- run validation,
- mark ready for rota generation.

## Screen 2 - Assignment Board

Purpose:

- assign people into units and call levels.

Recommended layout:

- left: unit list,
- top: call-level tabs or columns,
- center: assignment cells with member chips,
- right drawer: selected unit details.

Each member chip should show:

- name,
- call level,
- leave count this month,
- duty load from historical/current draft if available,
- warning marker if conflict.

Interactions:

- add member button inside each unit/call-level cell,
- dropdown member picker,
- remove chip,
- move chip,
- edit effective dates,
- note field.

Desktop:

- grid/table style.

Mobile:

- unit cards with call-level sections,
- bottom navigation remains active,
- editing opens a sheet/drawer.

## Screen 3 - Daily Unit Availability

Purpose:

- show whether elective service has enough people each day.

View options:

- calendar view,
- unit-by-date matrix,
- day list.

Each day/unit cell should show:

- required count,
- available count,
- leave count,
- duty count,
- status color.

Status:

- green: safe,
- yellow: tight,
- red: unsafe,
- grey: no elective requirement configured.

Clicking a cell opens details:

- assigned people,
- on leave,
- on duty,
- available,
- missing call levels,
- suggested action.

## Screen 4 - Unit Detail Page

Purpose:

- inspect one unit for the month.

Sections:

- unit header,
- monthly members by call level,
- leave calendar for that unit,
- daily availability trend,
- current/future duty impact,
- validation warnings,
- notes.

## Screen 5 - Validation and Readiness

Purpose:

- decide whether unit map is safe enough for rota generation.

Validation panels:

- unassigned active people,
- duplicate assignments,
- missing call levels,
- unit staffing deficits,
- leave pressure days,
- incomplete threshold settings,
- special posting overlaps.

Action:

- mark ready only if no errors.
- warnings require acknowledgement.

## Data Model Plan

## Existing Tables to Use

### units

Use as master unit list.

Needs:

- board-friendly active/inactive status,
- display order later,
- campus grouping,
- optional elective service flag.

### person_postings

Use for monthly assignments.

Current fields are enough for MVP:

- person_id,
- unit_id,
- posting_type,
- starts_on,
- ends_on,
- source,
- notes.

For unit management, `posting_type` can store call level or special posting type.

Recommended posting types:

- `1ST_CALL`
- `2ND_CALL`
- `3RD_CALL`
- `4TH_CALL`
- `CO_4TH_CALL`
- `5TH_CALL`
- `PAIN`
- `SICU`
- `DRP`
- `NEURO_ICU`
- `PAC`
- `OTHER_SPECIAL`

## New Tables Recommended Later

### unit_staffing_rules

Defines minimum elective staffing.

Fields:

- unit_id,
- call_level,
- weekday_minimum,
- saturday_minimum,
- sunday_minimum,
- effective_from,
- effective_to,
- active_status.

### unit_daily_requirements

Optional override table for a specific date.

Fields:

- unit_id,
- requirement_date,
- call_level,
- minimum_required,
- notes.

Useful for holidays, conferences, exam days, reduced lists, special events.

### unit_assignment_snapshots

Optional future audit table.

Stores monthly unit map at the moment rota generation starts.

This helps reproduce why the rota generator made a decision.

## MVP Data Strategy

For first implementation:

- use `PersonPosting`,
- do not add new staffing-rule tables yet unless needed,
- create APIs that return derived monthly unit matrix,
- keep staffing thresholds in code/config placeholder until user gives exact rules.

When you provide call-level slot/unit threshold design, add `unit_staffing_rules`.

## Unit Assignment Rules

## Rule 1 - One Primary Unit Per Date

A person should not be assigned to two primary units on the same date unless one assignment is special posting or explicitly allowed.

Error if:

- same person has overlapping primary unit postings.

Warning if:

- primary unit overlaps special posting.

## Rule 2 - Call Level Required

Every person in a unit assignment must have a call level/posting type.

Error if:

- posting type missing.

## Rule 3 - Active Member Only

Only active department members should be assigned for future rota planning.

Warning or error if:

- inactive/historical member is assigned.

## Rule 4 - Unit Staffing Minimum

Each unit/day/call-level must meet minimum elective staffing after leave/duty removal.

Initially:

- warning only until thresholds are confirmed.

Later:

- error for critical deficits.

## Rule 5 - Leave-Aware Availability

Approved leave removes member from available elective staff on affected dates.

Requested leave:

- warning only by default.

Cancelled/rejected leave:

- ignored for availability.

## Rule 6 - Duty-Aware Availability

If a member is assigned duty on a date, their availability for elective work depends on duty type.

Examples:

- 24hr duty likely removes from elective work that day.
- post-duty next day may remove or reduce availability depending on department rule.
- short shift may partially block.

Exact duty-to-elective rules need confirmation.

## Rota Generator Workflow Integration

## Before Generation

Rota generator should require:

- selected rota month,
- unit map status ready or acknowledged,
- leave data loaded,
- staffing threshold profile selected,
- duty slot template selected.

## During Generation

For each unit/day:

1. Read assigned people by call level.
2. Remove approved leave.
3. Remove people already assigned incompatible duties.
4. Apply post-duty rest rules if configured.
5. Count remaining elective availability.
6. Compare against minimum elective requirement.
7. Calculate spare capacity.
8. Determine how many duty slots can be safely filled.
9. Select candidates only from safe availability pool.
10. If no safe candidate, create warning/blocked slot.

## Candidate Explanation

For every suggested person, show:

- unit,
- call level,
- leave status,
- available elective count after assignment,
- duty load,
- weekend load,
- reason selected.

For blocked candidates, show:

- on approved leave,
- would make unit unsafe,
- wrong call level,
- duty spacing issue,
- already assigned,
- special posting conflict.

## Unit Availability Formula

For a unit U, date D, call level L:

```
assigned = members assigned to U/L on D
leave_blocked = assigned members with approved leave on D
duty_blocked = assigned members already assigned incompatible duty on D
rest_blocked = assigned members blocked by post-duty rest rule on D
available = assigned - leave_blocked - duty_blocked - rest_blocked
surplus = available - minimum_required
```

Generator should not assign a duty if:

```
available_after_assignment < minimum_required
```

unless overridden.

## Interface Details

## Month Selector

Same month selector style as Leave.

Options:

- previous month,
- current selected month,
- next month.

Actions:

- copy previous month assignments,
- clear draft month,
- validate,
- mark ready.

## Assignment Cell

Each unit/call-level cell:

- shows count,
- shows member chips,
- add button,
- warning badge if leave-heavy,
- deficit badge if below threshold.

Member chip:

- name,
- call level,
- leave days this month,
- warning dot.

## Member Picker

Searchable dropdown:

- canonical name,
- current call level,
- current unit if already assigned,
- leave count in selected month.

Picker should prevent accidental duplicate assignment.

## Unit Detail Drawer

When clicking a unit:

- call-level roster,
- leave summary,
- daily availability,
- validation issues,
- notes.

## Daily Availability Matrix

Rows:

- units.

Columns:

- dates.

Cell:

- `available / required`,
- color status,
- click for details.

This can be visually dense on desktop and converted to unit cards on mobile.

## Board Workflow Example

1. Rota board selects `June 2026`.
2. Clicks `Copy from May 2026`.
3. Moves promoted/resigned/new members.
4. Assigns each member into unit/call-level cells.
5. Opens leave impact view.
6. Sees `Main 2nd Call` unsafe on June 14 because three members are on leave.
7. Adjusts duty slot expectation or moves member from another unit.
8. Runs validation.
9. Marks unit map ready.
10. Rota generator uses unit map plus leave to produce draft rota.

## API Plan

Recommended endpoints:

- `GET /api/v1/units`
- `POST /api/v1/units`
- `PUT /api/v1/units/{unit_id}`
- `GET /api/v1/unit-management/month?month=YYYY-MM`
- `POST /api/v1/unit-management/month/copy`
- `POST /api/v1/unit-management/assignments`
- `PUT /api/v1/unit-management/assignments/{posting_id}`
- `DELETE /api/v1/unit-management/assignments/{posting_id}`
- `GET /api/v1/unit-management/availability?month=YYYY-MM`
- `GET /api/v1/unit-management/unit/{unit_id}?month=YYYY-MM`
- `GET /api/v1/unit-management/validation?month=YYYY-MM`
- `POST /api/v1/unit-management/mark-ready`

Future:

- `GET /api/v1/unit-management/staffing-rules`
- `POST /api/v1/unit-management/staffing-rules`
- `PUT /api/v1/unit-management/staffing-rules/{rule_id}`

## First Implementation Layer After Approval

If approved, the safest first build is:

1. Add `Unit Management` navigation item.
2. Add backend API to return units and existing person postings for selected month.
3. Add monthly assignment board using current `PersonPosting`.
4. Allow adding/removing/editing assignments.
5. Add simple validation:
   - duplicate overlapping primary unit assignment,
   - missing call level,
   - inactive member assigned.
6. Add leave-aware monthly counts:
   - leave days by unit,
   - people available by unit/call level.
7. Add read-only daily availability cards without enforcing thresholds.
8. Document threshold questions for the next phase.

This gives a working board without waiting for the final staffing-slot formula.

## Deferred Until User Provides Slot/Threshold Design

- exact elective minimums per unit,
- unit-specific daily templates,
- call-level staffing limits,
- how AM/PM/NIGHT leave affects elective availability,
- how each duty type removes elective availability,
- post-duty rest effect on next-day elective work,
- automatic adjustment of number of duty slots,
- rota generator hard blocking.

## Open Questions for User

1. What are the official unit names to expose in the board UI?
2. Does each person belong to exactly one unit per month, or can some have split units?
3. Which posting types are primary unit assignments vs special postings?
4. What call-level groups should be used in the assignment board?
5. For each unit, what is the minimum elective staffing required by call level on weekdays?
6. Are Saturday/Sunday elective requirements different?
7. Do holidays have reduced elective requirements?
8. Does approved full-day leave remove the person from elective availability for all duty planning?
9. How should AM/PM leave affect elective availability?
10. Which duty types remove a person from elective work on the same day?
11. Does a 24hr duty remove next-day elective availability due to rest/post-duty?
12. Should the generator reduce unit-linked duty slots automatically, or only warn the board?
13. Can the board override unsafe unit staffing?
14. Should the unit map be locked once rota generation starts?
15. Should we import unit assignments from Excel in the future or keep it manual first?

## Recommended Approval Decision

Approve first implementation layer only:

- monthly unit assignment board,
- manual add/remove/edit,
- leave-aware availability display,
- basic validation,
- no automatic rota-slot adjustment yet.

Then provide:

- call-level groups,
- unit staffing thresholds,
- duty-to-elective blocking rules.

After those are confirmed, build the second layer:

- staffing rules,
- hard validation,
- rota generator slot adjustment.

