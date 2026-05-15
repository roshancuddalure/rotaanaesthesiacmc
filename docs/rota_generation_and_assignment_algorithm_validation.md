# Rota Template Generation and Person Assignment Algorithm

Current as of: 2026-05-15  
Application area: Duty Rota software, backend rota generator and assignment services  
Purpose: Department validation document describing the implemented algorithm precisely enough for review by department elders and rota board validators.

## 1. Executive Summary

The current rota system works in two separate stages.

1. Template generation creates empty duty slots for a selected month. It does not assign people. It selects the unit for each duty/date using a balancing and staffing-pressure algorithm, creates one slot per selected duty/date, and marks each slot as `ready` or `needs_review`.
2. Person assignment fills those slots later. Assignment may be manual by the rota board or automatic through Safe Auto-Fill. Both routes use the same validation checks: unit posting, call level, duty subgroup, leave, same-day duty conflict, previous-day 24-hour rest block, unit staffing safety, and monthly duty-count limits.

The design is intentionally conservative. Mandatory clinical duty slots are preserved even if staffing pressure is high, but they are marked for review. Adjustable/non-mandatory slots are skipped when the selected allocation is hard blocked. Safe Auto-Fill only fills slots when the candidate is clearly eligible, validation is clear, no override is needed, and the required call level is unambiguous.

## 2. Main Code Paths Reviewed

The current behavior is implemented mainly in these files:

- `backend/app/services/rota_template.py`: monthly date selection, duty selection, unit allocation, template slot creation, template run/event audit.
- `backend/app/services/rota_safety.py`: eligibility pool, leave/rest blockers, safety status, unit/call-level staffing status.
- `backend/app/services/rota_candidates.py`: candidate list construction, candidate ranking score, explanation text.
- `backend/app/services/rota_assignment.py`: manual assignment, assignment validation, override handling, replace/clear assignment.
- `backend/app/services/rota_auto_fill.py`: Safe Auto-Fill draft assignment.
- `backend/app/services/rota_rules.py`: configurable duty rules, default duty dictionary, duty count limits, rest rules, staffing thresholds.
- `backend/app/services/rota_setup.py`: monthly rota period and locked included/excluded unit scope.
- `backend/app/domain/duty_types.py`: built-in duty type dictionary.
- `backend/app/models/rota.py`: stored rota slots, assignments, generation runs, events, auto-fill runs, and audit records.

Relevant automated tests:

- `backend/tests/test_rota_template.py`
- `backend/tests/test_rota_safety.py`
- `backend/tests/test_rota_assignment.py`
- `backend/tests/test_rota_candidates.py`
- `backend/tests/test_rota_auto_fill.py`
- `backend/tests/test_rota_rules.py`

## 3. Inputs Required Before Generation

Template generation depends on the following stored inputs.

1. Month, for example `2026-05`.
2. A `RotaPeriod` for the month, created or reused automatically.
3. A `MonthlyGenerationScope` that is locked before generation.
4. Included units inside the locked scope.
5. Active duty rules from the current rota rule version.
6. Unit postings for people during the month.
7. Leave requests for the month.
8. Unit-level and optional call-level minimum free people rules.

Generation is blocked if the monthly scope is not locked, if no included unit exists, or if no active duty rule is selected.

## 4. Duty Rules and Default Rule Behavior

The current rule set is stored under `rota_generator.phase1` in a rule setting linked to the rule version named `Rota generator default rules`.

Each duty rule includes:

- duty key and display label;
- duty group, such as `main`, `cb`, `rc`, `pac`, `shift`;
- start time, end time, duration, and 24-hour flag;
- whether the duty is mandatory;
- whether the duty is adjustable;
- whether it blocks elective work on the same day;
- whether it blocks elective work the next day;
- allowed call levels;
- allowed eligibility subgroup keys;
- excluded eligibility subgroup keys;
- allowed/excluded units.

Default staffing rules are:

- minimum available count: `1`;
- warning unavailable threshold: `30%`;
- hard block unavailable threshold: `40%`;
- small-unit absolute minimum enabled: `true`.

Default rest rule:

- minimum gap after 24-hour duty: `24` hours.

Important default duty behavior:

- 24-hour duties are mandatory by default.
- Non-24-hour duties are adjustable by default.
- 24-hour duties block elective same-day work and next-day elective work.
- PAC, shift, and Caesar group duties block same-day elective work by default.
- Legacy PAC keys `PAC`, `MAIN_PAC_SR`, and `RC_PAC_SR` are inactive.
- Active PAC subdivision duties are configured with specific 3rd-call/4th-call and subgroup rules.

## 5. Template Generation Algorithm

### 5.1 Date Selection

The system calculates the month start and end date, then applies optional generation bounds:

- `starts_on`, if provided, cannot go before the month start.
- `ends_on`, if provided, cannot go after the month end.
- weekdays and weekends can be included or excluded.
- at least one of weekdays/weekends must be included.
- end date cannot be before start date.

The result is an ordered list of generation dates.

### 5.2 Duty Selection

The system loads active duty rules.

- If no explicit duty list is supplied, only active mandatory duties are selected.
- If a duty list is supplied, all requested duty keys must exist and be active.
- Unknown or inactive requested duties raise an error.

### 5.3 Unit Selection

Only units marked `included` in the locked monthly generation scope are considered. Units are sorted by name before use.

A duty rule may further restrict units:

- If a unit matches the rule's excluded unit list, the rule does not apply to that unit.
- If the rule has no allowed unit list, it applies to all included units except excluded ones.
- If allowed units are configured, the unit must match by unit id, unit code, or unit name.

### 5.4 Required Call Level for Unit Pressure

For unit-level pressure during template generation, the system tries to determine a single required call level.

It uses:

1. the duty rule's allowed call levels, if exactly one non-unassigned call level is configured;
2. otherwise, call level inferred from the duty type key, for example `MAIN_1ST_24HR` means `1ST_CALL`;
3. otherwise, no specific call-level filter is applied.

This matters because unit staffing is calculated among active posted members in the same unit and same required call level when the required call is known.

### 5.5 Staffing Pressure Calculation for a Candidate Unit

For each date, duty rule, and candidate unit, the system calculates a pressure snapshot before deciding which unit gets the slot.

The active unit member pool includes people who:

- are posted to the candidate unit on the slot date;
- are marked active;
- match the required call level if a required call level is known.

Unavailable members include active unit members with leave that blocks the rule on that date.

Leave blocking behavior:

- for 24-hour duties, `FULL_DAY`, `AM`, `PM`, and `NIGHT` leave block the duty;
- for non-24-hour duties, `FULL_DAY` blocks all;
- `AM` blocks if the duty starts before 12:00;
- `PM` blocks if the duty starts at or after 12:00;
- `NIGHT` blocks if the duty starts at or after 18:00 or before 08:00.

The pressure calculation also subtracts provisional duties already allocated to that unit on that day during the same generation run.

Key calculated values:

- `assigned_members`: total eligible active unit members for that unit/call level;
- `unavailable_members`: members blocked by leave;
- `provisional_unit_day_duties`: already planned duties for the same unit/date in this generation pass;
- `available_before_slot`: total minus leave minus provisional duties;
- `available_after_slot`: available before slot minus one more member for the new duty;
- `blocked_count`: leave-blocked plus provisional duties plus the proposed new duty;
- `unavailable_percent`: blocked count divided by total members, rounded as a percent;
- `minimum_free_people`: unit/call-level minimum free people.

The pressure status is:

- `hard_block` if the unit has zero active assigned members;
- `hard_block` if small-unit absolute minimum is enabled and `available_after_slot` is below the configured minimum;
- `hard_block` if unavailable percent reaches the hard-block threshold;
- `warning` if unavailable percent reaches the warning threshold;
- otherwise `ready`.

### 5.6 Balanced Unit Allocation Score

For each date and duty rule, the system scores all applicable candidate units and selects the unit with the lowest score. For Saturday and Sunday slots, the system now applies weekend equal-division keys before the ordinary allocation score.

Step-by-step, a unit is assessed using these variables:

1. `rule_applies_to_unit`: whether the duty rule is allowed for that unit and not explicitly excluded.
2. `required_call`: the required call level for the duty, from the duty rule or inferred duty key.
3. `assigned_members`: active posted unit members for the date, filtered to the required call level when known.
4. `unavailable_members`: assigned members whose leave blocks that duty date/time.
5. `provisional_unit_day_duties`: duties already allocated to the same unit on that same date during the generation run.
6. `provisional_post_24hr_duties`: 24-hour duties allocated to the same unit/call level on the previous day, because these create post-duty unavailability on the target date.
7. `available_before_slot`: assigned members minus leave-blocked members minus provisional same-day duties minus previous-day 24-hour post-duty duties.
8. `available_after_slot`: available before slot minus the proposed new duty slot.
9. `minimum_free_people`: unit-level or call-level-specific minimum people who should remain free.
10. `unavailable_percent`: percentage of the unit/call-level pool unavailable after adding the proposed slot.
11. `unit_month_count`: how many generated slots the unit already has in the month.
12. `unit_same_duty_count`: how many slots of the same duty type the unit already has.
13. `unit_same_week_count`: how many slots the unit already has in the same ISO week.
14. `unit_weekend_count`: how many Saturday/Sunday slots the unit already has.
15. `unit_weekend_day_count`: how many same-day weekend slots the unit already has, counted separately for Saturday and Sunday.
16. `provisional_unit_day_count`: another same-day unit-use penalty used inside the allocation score.
17. `near_minimum_penalty`: extra penalty if the proposed slot would leave the unit close to or below its free-person minimum.

Score formula:

```text
unit_month_count * 100
+ unit_same_duty_count * 60
+ unit_same_week_count * 25
+ unit_weekend_count * 20, only for weekend target dates
+ provisional_unit_day_count * 80
+ unavailable_percent
+ near_minimum_penalty
```

Where:

```text
near_minimum_penalty = max(0, minimum_free_people + 1 - available_after_slot) * 30
```

Weekend selection rule:

```text
For Saturday/Sunday slots, choose by:
1. lower same weekend-day count for that unit;
2. lower total weekend count for that unit;
3. lower ordinary allocation score;
4. lower same-duty count;
5. lower month count;
6. unit name alphabetically.
```

This means Saturdays are balanced against Saturdays, Sundays are balanced against Sundays, and total weekend burden is then balanced across units. The ordinary safety/balance score is still used after these weekend fairness keys. If all lower-weekend-count units are hard blocked and another unit is safe, the engine still prefers safe allocations because hard-blocked units are removed from the preferred pool when any safe allocation exists.

Interpretation:

- A unit that has already received many duties in the month becomes less preferred.
- A unit that has already received the same duty type becomes less preferred.
- A unit already used heavily in the same ISO week becomes less preferred.
- Weekend balancing is applied only when the target date is a weekend, and it is applied before the ordinary allocation score.
- A unit already allocated another duty on the same day is penalized.
- Higher leave/staffing pressure makes a unit less preferred.
- Units close to the minimum free-person threshold receive extra penalty.

Non-weekend selection tie-break order:

1. lower allocation score;
2. lower same-duty count;
3. lower month count;
4. unit name alphabetically.

Hard-blocked units are avoided if at least one non-hard-blocked unit exists. If all candidate units are hard blocked, the algorithm still chooses the lowest scoring hard-blocked unit, then applies the mandatory/adjustable duty rule described below.

Previous-day post-duty rule:

- Only previous-day 24-hour duties reduce next-day unit availability.
- 12-hour duties, PAC duties, shift duties, and other non-24-hour duties do not create this next-day post-duty subtraction during template allocation.
- Because people are not assigned yet at template-generation time, this is counted at unit/call-level level. For example, if Unit II receives one 24-hour 1st-call slot on May 10, Unit II 1st-call availability is reduced by one on May 11.

### 5.7 Slot Creation, Review, or Skipping

For each date and selected duty rule:

- If no applicable unit can be selected, no slot is created and skipped events are recorded.
- If all applicable unit allocations are hard blocked and the duty is adjustable and not mandatory, no slot is created. Blocked generation events are recorded.
- If all applicable unit allocations are hard blocked and the duty is mandatory, the system creates an unresolved slot without assigning it to a unit.
- Otherwise, the slot is created against the selected unit.

Mandatory slots are therefore preserved for board visibility, but the engine does not force them onto a hard-blocked unit.

Created slots store:

- rota period;
- unit;
- duty date;
- duty type;
- inferred or configured call level;
- slot label;
- start and end datetime;
- 24-hour flag;
- max assignees, currently `1`;
- source `phase4_template`;
- template status, either `ready`, `needs_review`, or `unresolved`;
- template reason;
- generation run id;
- explanatory notes.

Slot status:

- `ready` if selected unit pressure is safe;
- `needs_review` if selected unit pressure is warning;
- `unresolved` if no safe unit allocation was found for a mandatory slot.

After each created slot, the unit month/week/weekend/duty/day counters are updated immediately, so later decisions in the same run account for earlier allocations.

Unresolved slot behavior:

- `unit_id` is left empty.
- `slot_label` is set to `unresolved`.
- `template_reason` states that no safe unit allocation was found.
- Per-unit blocked events are stored with each unit's availability/pressure details.
- The rota board must manually review and decide how to handle the duty.

### 5.8 Template Generation Audit Trail

Every generation creates a `RotaTemplateGenerationRun`.

The run stores:

- month;
- duty keys used;
- start/end dates used;
- weekday/weekend inclusion;
- replace-existing flag;
- included unit count;
- number of created slots;
- number of needs-review slots;
- number of skipped events;
- number of blocked events.

Generation events are recorded for:

- created slots;
- skipped units where another unit was selected;
- skipped entries due to duplicate existing slots or rule not applying;
- blocked adjustable slots.

Each event stores date, duty, unit, action, severity, reason, and detailed pressure/score values.

## 6. Existing Template Replacement and Clearing

If `replace_existing` is true, existing generated template slots for the period are removed before generation. Replacement is blocked if any generated slot already has an assignment.

Template cache clearing normally refuses to remove generated slots that have assignments. It can remove assignments only when explicitly called with `clear_assignments=true`. Historical/imported slots are not removed; only slots with source `phase4_template` are handled.

## 7. Safety Algorithm Used for Person Assignment

The person safety engine is used by manual assignment, candidate ranking, safety review, and Safe Auto-Fill.

### 7.1 Candidate Eligibility Pool

For a slot, the system starts from active monthly unit postings.

A person is considered in the slot's unit context only if:

- the person is posted to the same unit on the slot date;
- the posting is active on that date;
- the person status is active;
- duplicate person/unit contexts are ignored.

The system then filters by required call level:

- use the slot call level if set and not `Unassigned`;
- otherwise use the duty rule's allowed call levels if configured;
- otherwise infer from the duty type key.

If no required call level is known, the system uses the full active unit member pool.

The system then applies duty subgroup rules:

- if allowed cluster keys are configured, the person must be in at least one active allowed cluster on that date;
- if excluded cluster keys are configured, the person must not be in an active excluded cluster.

### 7.2 Person-Specific Blockers

For each eligible person, the safety engine checks:

1. Leave on the slot date that blocks the slot time.
2. Same-day incompatible duty assignment.
3. Previous-day duty that blocks next-day rest.

Approved/blocking leave creates a hard blocker. Pending/imported review leave creates a warning. Same-day incompatible duty and previous-day 24-hour rest create hard blockers.

Active assignment statuses are:

- `assigned`;
- `draft`;
- `confirmed`.

### 7.3 Safety Status for the Slot

The safety engine returns three person lists:

- `available_people`;
- `warning_people`;
- `hard_blocked_people`.

It also calculates:

- total unit members;
- eligible members;
- available members;
- hard-blocked members;
- warning members.

The slot safety status is:

- `hard_blocked` if there are no eligible active members;
- `hard_blocked` if small-unit absolute minimum is enabled and available members are below the unit/call-level minimum;
- `hard_blocked` if the hard-blocked member percentage reaches the hard threshold;
- `needs_review` if the hard-blocked member percentage reaches the warning threshold;
- `needs_review` if any member has warning leave;
- `needs_review` if confirmed plus warning blockers reach the warning threshold;
- otherwise `safe`.

## 8. Manual Assignment Algorithm

Manual assignment is performed through `assign_person_to_slot`.

The process is:

1. Load the slot and the target person.
2. If the same person is already actively assigned to the slot and replacement is not requested, return unchanged.
3. Run full assignment validation.
4. If validation status is `blocked`, reject the assignment.
5. If validation requires override and no override reason is provided, reject the assignment.
6. If replacement is requested, delete existing active slot assignments.
7. Create a `DutyAssignment` with status `assigned`, source `manual_rota_board` unless another source is supplied, and optional override reason.
8. Return the assignment and recalculated slot safety.

Manual assignment validation checks:

- slot capacity when replacement is not requested;
- person active status;
- whether the person is posted to the slot unit on the slot date;
- required call-level match;
- required eligibility subgroup match;
- person-specific leave/rest/same-day blockers;
- unit staffing safety status;
- monthly duty count limits.

Validation outcomes:

- `clear`: assignment can be saved without override.
- `needs_override`: assignment can be saved only if an override reason is provided.
- `blocked`: assignment is rejected even if an override reason is supplied.

Important current behavior:

- Wrong call level is treated as a `blocked` issue and cannot be forced by override.
- Approved leave conflict is treated as an error that requires override, not an absolute block.
- Unit safety warning or hard-block status creates warning/error issues and requires override.

## 9. Monthly Duty Count Limit Checks

During assignment validation, the system calculates the person's current active generated-template assignments in the same month, excluding the same slot if replacement is happening.

It then checks the prospective assignment against configured limits:

- maximum 24-hour duties per month;
- maximum weekend 24-hour duties per month;
- maximum duties in the same duty group per month;
- maximum duties at the same campus per month.

If configured limits would be exceeded, validation adds error issues and requires override.

## 10. Candidate Suggestion and Ranking Algorithm

Candidate suggestions use the same safety and validation engine, then apply a ranking score.

### 10.1 Candidate Status

The initial pool is built from:

- available people -> `eligible`;
- warning people -> `needs_review`;
- hard-blocked people -> `blocked`.

Each candidate is then individually validated. If validation finds blocked/error issues, the candidate becomes `blocked`. If warnings remain, the candidate becomes `needs_review`. Otherwise the candidate remains `eligible`.

The system intentionally includes blocked candidates in the response so the board can see why people were not suitable.

### 10.2 Candidate Counts

For each candidate, the system calculates existing active assignments in the month, excluding the target slot:

- total assignments;
- weekday assignments;
- weekend assignments;
- whether the target is weekend;
- same day-type assignments, meaning weekday load for a weekday target or weekend load for a weekend target;
- total 24-hour duties;
- weekend 24-hour duties;
- same duty group count;
- same campus count.

It also calculates nearest rest gap in hours from the candidate's existing saved duties.

### 10.3 Candidate Score

Candidates are sorted by status, then rank score, then person name.

Status order:

1. eligible;
2. needs_review;
3. blocked.

Score formula:

```text
status_penalty
+ same_day_type * 30
+ total_assignments * 6
+ total_24hr * 10
+ weekend_24hr * 12
+ same_group * 5
+ same_campus * 2
+ fairness_penalty
+ rest_penalty
+ staffing_penalty
+ validation_penalty
```

Where:

```text
status_penalty = 0 for eligible, 35 for needs_review, 1000 for blocked
fairness_penalty = max(0, total_assignments - floor(current_average_assignments)) * 7
rest_penalty = 80 if rest gap is below configured minimum
rest_penalty = 15 if rest gap is less than configured minimum + 12 hours
staffing_penalty = 10 if slot safety is needs_review
staffing_penalty = 25 if slot safety is hard_blocked
validation_penalty = 20 if assignment requires override
```

This means the strongest person-level fairness factor is same weekday/weekend load, followed by overall assignment burden, 24-hour burden, weekend 24-hour burden, same group, and same campus.

### 10.4 Candidate Explanation Text

Each candidate includes reason text explaining:

- whether they are eligible, need review, or blocked;
- leave/rest/same-day blockers;
- current month duty load;
- same weekday/weekend load;
- same duty group load;
- nearest rest gap;
- whether duty load is above or below the current assigned-member average;
- validation issue messages.

## 11. Safe Auto-Fill Algorithm

Safe Auto-Fill is conservative and draft-only.

For each generated template slot in date/duty order:

1. If the slot already has an active assignment, skip it.
2. Build full candidate context and candidate list.
3. Determine required call levels from the slot or rule.
4. If strict call-level mode is on and the slot does not have exactly one required call level, skip the slot and mark it for review.
5. Choose the first candidate who:
   - has candidate status `eligible`;
   - has validation status `clear`;
   - does not require override;
   - matches the single required call level when strict mode is on.
6. If no such candidate exists, leave the slot open and record why.
7. If a safe candidate exists, call the same assignment service used by manual assignment, with source `safe_auto_fill_draft`.
8. Record an auto-fill event for assigned, skipped, or blocked result.

Safe Auto-Fill never deliberately assigns a candidate who needs an override. It also leaves ambiguous call-level duties open.

## 12. Published Data and Audit Objects

The algorithm creates auditable database records:

- `DutySlot`: the generated empty duty requirement.
- `DutyAssignment`: the saved person-to-slot assignment.
- `RotaTemplateGenerationRun`: one template generation run summary.
- `RotaTemplateGenerationEvent`: per-date/per-duty/per-unit generation explanation.
- `RotaAutoFillRun`: one Safe Auto-Fill run summary.
- `RotaAutoFillEvent`: per-slot Safe Auto-Fill explanation.
- `RotaReviewDecision`: later review decisions for warning/issue acceptance.
- `RotaPublishApproval`: final publish approval summary.

This gives traceability for what rule version was used, what was created, what was skipped, what needed review, and which assignments required override reasons.

## 13. Allocation Statistics for Validation

The Rota Template screen includes an Allocation Statistics view for validating the generated empty template before people are assigned.

The statistics view summarizes generated slots and generation decisions in five ways.

1. Unit-Wise Slot Tally

This table shows each unit's total slots, weekday slots, Saturday slots, Sunday slots, total weekend slots, 24-hour slots, ready slots, needs-review slots, and unresolved slots. It is used to check whether one unit has received a disproportionate share of the template.

2. Duty Type Matrix

This table shows units as rows and duty types as columns. It is used to check whether a duty type, such as Main 1st Call or RC 3rd Call, is repeatedly allocated to the same unit.

3. Date-Wise Distribution

This table shows each date, day name, total generated slots, per-unit slot count, needs-review count, and unresolved count. It is used to check whether the engine reduced allocations to units with leave, same-day duty pressure, or previous-day 24-hour post-duty pressure.

4. Call-Level Distribution

This table shows how generated slots are divided by required call level for each unit. It is used to check whether 1st call, 2nd call, 3rd call, 4th call, and other call-linked duties were distributed appropriately.

5. Blocked, Skipped, and Unresolved Decisions

This table shows date, unit, duty, action, and reason for allocation decisions that did not become a normal ready slot. It includes skipped units, skipped adjustable duties, blocked allocations, and unresolved mandatory duties. This is the main evidence table when the rota board needs to explain why the engine did not allocate a duty automatically.

The allocation statistics are generated from saved `DutySlot` rows and the latest `RotaTemplateGenerationEvent` audit trail. They are therefore not a separate calculation that can disagree with the generated template; they summarize the actual generated slots and recorded decisions.

## 14. Current Limitations and Validation Notes

These points are important for department validation.

1. Template generation currently creates one slot per selected duty/date by choosing one included unit. It is not a full combinatorial optimizer for all possible unit-duty combinations.
2. Template generation assigns units, not people.
3. Person assignment happens only after slots exist, either manually or through Safe Auto-Fill.
4. Safe Auto-Fill is intentionally not full auto-generation. It fills only clear, same-call, no-override slots.
5. Approved leave currently requires an override reason for manual assignment, rather than being absolutely impossible. Wrong call level remains an absolute block.
6. The `allowed_designations` field exists on duty rules but is not currently enforced by the safety/assignment path reviewed here.
7. Candidate scoring weights are hard-coded in the candidate service at present; they are not yet user-configurable through the UI.
8. Unit allocation scoring weights are hard-coded in the template service at present.
9. Existing duty assignments affect person-level safety and ranking, while template-generation unit pressure considers leave and provisional slots created during the current generation pass.
10. Historical workload analysis is not currently part of the candidate rank score in the reviewed implementation; ranking uses current-month saved assignments.

## 15. Validation Summary

The current algorithm is an explainable, rule-based rota assistant.

It does the following:

- requires a locked monthly unit scope before generation;
- uses configurable duty rules and default department duty dictionary;
- checks leave pressure and unit/call-level minimum staffing while generating slots;
- balances generated slots across units using month, duty, week, weekend, same-day, leave-pressure, and minimum-staffing penalties;
- preserves mandatory duties with review flags when unsafe;
- skips adjustable non-mandatory duties when the selected allocation is hard blocked;
- validates person assignment using unit posting, call level, subgroup eligibility, leave, same-day duty, previous-day 24-hour rest, unit safety, and monthly duty limits;
- ranks candidate suggestions with transparent scoring and explanation text;
- auto-fills only safe, clear, single-call-level slots;
- stores generation and auto-fill audit events for later review.

For departmental validation, the most important conclusion is that the system is not a black-box AI allocator. It is a deterministic, rule-based workflow with explicit audit records and manual board control over all risky assignments.
