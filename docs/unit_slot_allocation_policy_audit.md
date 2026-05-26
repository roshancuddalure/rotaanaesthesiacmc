# Unit Slot Allocation Policy Audit

Current as of: 2026-05-26

Purpose: audit the implemented unit-slot allocation algorithm, list every factor currently used, separate implemented behavior from planned policy, and identify decisions to finalize before deeper person-specific duty assignment work.

## Executive Conclusion

The current system already has a real deterministic unit-slot allocation engine. It is not random and it is not AI-driven. It creates empty duty slots by selecting one unit per date/duty using locked monthly scope, duty rules, leave pressure, unit/call-level staffing pressure, monthly balance, duty-type balance, weekly balance, weekend balance, same-day unit-use penalties, and forced least-damage fallback when every candidate unit is unsafe.

The unit-slot layer is strong enough to audit and validate with the rota board. It should be treated as the current foundation before moving deeper into person-specific assignment.

However, the policy is not yet "100 percent fixed" because a few important behaviors need board/admin decisions:

- pending or imported-review leave is treated as unavailable during template unit allocation, but as a warning during person safety;
- monthly posting call level and master person call level are used in different precedence orders in different services;
- the `is_adjustable` duty rule flag is visible/configurable but does not currently change generation behavior;
- the 24-hour rest rule is implemented mainly as same-day and previous-day blockers, not as a fully symmetric minimum-gap check against future existing duties;
- `allowed_designations` exists on duty rules but is not enforced in assignment/candidate safety;
- `include_excluded_units_in_safety` is stored in the monthly scope but is not yet used by the template/safety engines.

These should be resolved before we add more intricate person-allocation policy.

## Authoritative Reading Order

Use these documents in this order when reviewing algorithm behavior:

1. `docs/unit_slot_allocation_policy_audit.md` - current audit, policy gaps, and recommended decisions.
2. `docs/rota_generation_and_assignment_algorithm_validation.md` - detailed implemented algorithm explanation for department validation.
3. `Plan/05_confirmed_decisions.md` - user-confirmed project decisions.
4. `Plan/03_domain_rules_and_decision_trees.md` - domain background and historical parsing rules.
5. `Plan/Rota generator/algorithm.txt` - early rough idea only. Do not treat it as authoritative if it differs from backend behavior.

## Implemented Unit Slot Flow

The implemented unit-slot allocation flow is:

1. Ensure a monthly rota period exists.
2. Require the monthly generation scope to be locked.
3. Load included units from the locked scope.
4. Load active duty rules from the current rule version.
5. Build the selected date range and duty list.
6. For each date and duty rule, evaluate every applicable included unit.
7. Calculate staffing pressure for each unit.
8. Avoid hard-blocked units when any non-hard-blocked unit exists.
9. Select the lowest-scoring safe or review-needed unit.
10. If every applicable unit is hard blocked, still create a forced least-damage slot and mark it `needs_review`.
11. Save a `DutySlot` with source `phase4_template`.
12. Save detailed generation events explaining selected, skipped, blocked, and forced decisions.
13. Run a conservative vertical shuffle to reduce same-unit clustering without worsening availability.

The output is still only a unit-assigned empty slot. Person assignment is a second stage.

## Factor Inventory

| Area | Variable or source | Current effect | Configurable today | Audit note |
| --- | --- | --- | --- | --- |
| Month | `month`, month start/end | Defines rota period and date range | Through API/UI | Core input |
| Date bounds | `starts_on`, `ends_on` | Limits generation inside selected month | Through API/UI | Validated so end cannot precede start |
| Day type | `include_weekdays`, `include_weekends` | Includes or excludes weekdays/weekends | Through API/UI | At least one must be true |
| Scope lock | `MonthlyGenerationScope.is_locked` | Generation blocked unless locked | Through setup UI | Good enterprise control |
| Included units | `MonthlyGenerationScopeUnit.status == included` | Only included units are candidates | Through setup UI | Excluded safety option not fully used yet |
| Existing slots | Existing `phase4_template` slots | Blocks duplicate slot keys and replacement if assigned | Partly | Replacement refuses assigned slots |
| Duty selection | Explicit duty keys or mandatory active duties | Determines which duties are generated | Through API/UI | If no duty list, mandatory duties only |
| Duty activity | `DutyRule.active` | Inactive requested duties fail validation | Through rules UI | Good |
| Duty mandatory | `DutyRule.is_mandatory` | Used only for default duty selection | Through rules UI | Not used for hard-block policy |
| Duty adjustable | `DutyRule.is_adjustable` | Displayed/stored only | Through rules UI | Needs policy and implementation |
| Unit allow/exclude | `allowed_units`, `excluded_units` | Filters candidate units for a duty | Through rules UI/API | Matches unit id, code, or name |
| Duty group | `DutyRule.group` | Used by shuffle and person duty burden | Through rules UI | Important for clustering |
| Timing | `start_time`, `end_time`, `duration_hours`, `is_24hr` | Defines slot bounds and leave/rest effects | Through rules UI | 24-hour drives next-day unit rest subtraction |
| Elective blocking | `blocks_elective_same_day`, `blocks_elective_next_day` | Used in person safety assignment indexes | Through rules UI | Template allocation uses 24-hour next-day provisional logic |
| Required call | Rule allowed call level or inferred from duty key | Filters unit pool for unit pressure | Through rule config plus inference | Single-call duties use call-specific pool |
| Active people | `Person.active_status == active` | Only active people count in pools | Through member management | Good |
| Monthly unit postings | `PersonPosting` date overlap and unit | Defines unit membership on each date | Through unit management/import | Source filtering should be clarified |
| Posting call level | `PersonPosting.posting_type` | Used by template call-specific unit pool | Through unit board | Template uses posting type first |
| Master call level | `Person.call_level` | Used by person safety `member_call_level` before posting type | Through member management | Precedence mismatch with template allocation |
| Leave status | `approved`, `requested`, `imported_pending_review` | Template pressure currently counts all active leave statuses as unavailable | Through leave records | Mismatch with person safety, where only approved is hard |
| Leave slot | `FULL_DAY`, `AM`, `PM`, `NIGHT` | Determines whether leave blocks duty time | Through leave records | Implemented consistently by duty time |
| Same-day unit duties | Provisional count for same unit/date | Reduces available members and adds score penalty | Generated state | Unit-level estimate before person assignment |
| Previous-day 24-hour duties | Provisional count by unit/date/call | Reduces next-day availability | Generated state | Unit-level estimate before person assignment |
| Unit minimum | `Unit.minimum_free_people` | Hard block when available after slot falls below minimum | Through unit management | Fallback for mixed/unknown call duties |
| Call minimum | `UnitCallMinimum` | Overrides unit minimum for single-call duties | Through unit management | Implemented and tested |
| Warning threshold | `warning_unavailable_percent` | Marks allocation warning/needs review | Through rules | Default 30 percent |
| Hard threshold | `hard_block_unavailable_percent` | Hard-blocks allocation unless all units are hard blocked | Through rules | Default 40 percent |
| Small-unit rule | `small_unit_uses_absolute_minimum` | Makes minimum free people hard rule before percentage | Through rules | Important for small pools |
| Month balance | `unit_month_count * 100` | Strongly avoids overusing same unit in month | Hard-coded weight | Should become policy-configurable later |
| Same-duty balance | `unit_same_duty_count * 60` | Avoids giving same duty repeatedly to same unit | Hard-coded weight | Good current behavior |
| Week balance | `unit_same_week_count * 25` | Avoids weekly clustering | Hard-coded weight | Good current behavior |
| Weekend balance | Saturday/Sunday counts and total weekend counts | Balances Saturdays against Saturdays and Sundays against Sundays before ordinary score | Hard-coded tie order | Keep as current policy unless board disagrees |
| Same-day unit use | `provisional_unit_day_count * 80` | Avoids multiple duties for same unit on same date | Hard-coded weight | Also feeds pressure |
| Leave pressure | `unavailable_percent` | Higher pressure increases score and may warn/block | Threshold configurable, weight hard-coded | Good but leave-status policy needs finalization |
| Near minimum | `max(0, minimum + 1 - available_after) * 30` | Penalizes units close to minimum free people | Hard-coded weight | Good safety bias |
| Forced fairness | forced count, weekend counts, duty count, month count, damage score | Chooses least-damaging unit when every unit is hard blocked | Hard-coded tie order | Keeps exports complete but requires review |
| Layout shuffle | pattern score for same-day group duplicates and near repeat duty dates | Swaps same duty type between units only when safety is not worsened | Hard-coded | Conservative and auditable |

## Current Unit Allocation Formula

For safe or review-needed candidate units, the ordinary score is:

```text
unit_month_count * 100
+ unit_same_duty_count * 60
+ unit_same_week_count * 25
+ unit_weekend_count * 20, only on weekend target dates
+ provisional_unit_day_count * 80
+ unavailable_percent
+ near_minimum_penalty
```

Where:

```text
near_minimum_penalty = max(0, minimum_free_people + 1 - available_after_slot) * 30
```

For weekend duties, selection first balances:

1. fewer slots on the same weekend day type, Saturday or Sunday;
2. fewer total weekend slots;
3. lower ordinary allocation score;
4. fewer same-duty slots;
5. fewer total monthly slots;
6. unit name.

Hard-blocked units are removed from the preferred pool if at least one safe or warning unit exists.

If all applicable units are hard blocked, forced minimal-damage fallback selects by:

1. active members exist in the required call pool;
2. fewer same weekend-day slots when weekend;
3. fewer total weekend slots;
4. fewer forced allocations already in this run;
5. fewer same-duty slots;
6. fewer total monthly slots;
7. lower damage profile: smaller shortage, fewer unavailable members, fewer same-day duties, fewer post-24-hour duties, lower unavailable percent, and lower ordinary score.

## Current Person Assignment Factors

Person assignment is already implemented, but should be treated as the next policy layer. Current validation uses:

- slot capacity;
- person active status;
- same unit posting on slot date;
- required call-level match;
- required call-cluster/subgroup match;
- leave blockers;
- same-day incompatible duty blockers;
- previous-day rest blockers;
- unit staffing safety after assignment;
- monthly limits for total 24-hour duties, weekend 24-hour duties, same duty group, and same campus;
- override reason where validation status is `needs_override`.

Safe Auto-Fill uses candidate suggestions but only assigns when the candidate is eligible, validation is clear, no override is needed, and the slot has exactly one required call level.

## Policy Gaps To Decide

### 1. Leave Status Policy

Current mismatch:

- Template unit allocation counts all active leave statuses, including `requested` and `imported_pending_review`, as unavailable.
- Person safety treats approved leave as hard, but requested/imported-review leave as warning while still available.

Recommended policy:

- Approved leave should be hard unavailable.
- Requested/imported-review leave should create `needs_review` pressure, not hard unavailability, unless the rota board explicitly chooses conservative planning mode.
- The same leave-status rule should be used by template generation, safety dashboard, manual assignment, candidate suggestions, and auto-fill.

### 2. Call-Level Source Of Truth

Current mismatch:

- Template allocation filters the unit pool with `PersonPosting.posting_type` first.
- Person safety currently resolves call level from `Person.call_level` before `PersonPosting.posting_type`.

Recommended policy:

- For a specific rota month/date, `PersonPosting.posting_type` should be the source of truth.
- `Person.call_level` should be fallback metadata only.
- This matters when a person changes call level or has a month-specific posting.

### 3. Adjustable Duty Behavior

Current behavior:

- `is_adjustable` is stored and shown.
- It does not currently cause unsafe adjustable slots to be skipped, reduced, or moved to an unresolved bucket.
- If the duty is selected and at least one unit is applicable, a forced least-damage slot is still created when all units are hard blocked.

Recommended policy:

- Mandatory clinical coverage duties should always be created, even if forced, and marked `needs_review`.
- Adjustable duties should have a configurable unsafe policy:
  - force with review,
  - skip,
  - create unresolved,
  - reduce required assignees,
  - or manual-only.

### 4. 24-Hour Rest Enforcement

Current behavior:

- Same-day incompatible duties are blocked.
- Previous-day 24-hour/post-duty blockers are applied.
- Candidate scoring checks nearest rest gap, including future slots, but validation does not fully enforce a symmetric minimum gap against all existing future assignments.

Recommended policy:

- Enforce a true minimum rest-gap validation using `starts_at` and `ends_at` against all existing active assignments for that person in the month.
- Keep same-day and previous-day shortcuts for dashboards, but make the assignment validator the final source of truth.

### 5. Designation Eligibility

Current behavior:

- `allowed_designations` exists on duty rules.
- It is not enforced in the unit-slot or person-assignment path audited here.

Recommended policy:

- Decide whether designation should be enforced in Phase 1 person assignment.
- If yes, enforce it through effective-dated `PersonDesignation` records and include clear candidate blocker text.

### 6. Excluded Unit Safety

Current behavior:

- Monthly scope stores `include_excluded_units_in_safety`.
- The audited template and safety paths use generated slots and included-unit allocation; the excluded-unit safety flag is not yet part of the core calculations.

Recommended policy:

- Decide whether excluded units should appear only in dashboards or also affect allocation decisions.
- If dashboards only, document that clearly in the UI.

### 7. Posting Source Filtering

Current behavior:

- Unit Management reads `PersonPosting.source == unit_board`.
- Template and safety services load overlapping postings generally.

Recommended policy:

- For forward rota generation, use board-approved monthly unit postings as the authoritative source.
- Historical/imported postings should not affect future generation unless explicitly promoted to board-approved month postings.

### 8. Hard-Coded Weights

Current behavior:

- Unit allocation weights and candidate scoring weights are hard-coded.

Recommended policy:

- Freeze current weights for the first board validation cycle.
- After board approval, move weights into rule settings only if the board actually needs tuning.

## Proposed Enterprise Policy Set

Before person-specific assignment becomes more advanced, the rota board should approve this baseline:

1. A monthly rota cannot be generated until the unit scope is locked.
2. The locked monthly unit board is the source of truth for unit and call-level membership.
3. Approved leave is hard unavailable.
4. Pending/imported-review leave is warning pressure unless conservative planning mode is selected.
5. Single-call duties must use call-level-specific staffing pools and call-level-specific minimums.
6. Mixed-call or unclear duties fall back to full unit pool and unit-level minimum.
7. Mandatory clinical duties are preserved as slots even when forced, but forced slots are `needs_review`.
8. Adjustable unsafe duties require a configured policy before generation.
9. Saturday and Sunday burden should be balanced separately, then total weekend burden should be balanced.
10. Previous-day 24-hour unit pressure should reduce next-day unit availability for that call level.
11. Person assignment must enforce true rest-gap validation before publish-quality use.
12. Wrong call level and wrong subgroup remain absolute blockers.
13. Approved leave conflicts require explicit board override if allowed.
14. Every forced slot, warning acceptance, override, and exchange must have audit text.
15. No full auto-fill until safe auto-fill behavior is accepted on real data.

## Documentation Cleanup Guidance

Keep:

- `docs/unit_slot_allocation_policy_audit.md` as the current policy audit.
- `docs/rota_generation_and_assignment_algorithm_validation.md` as the detailed implementation validation guide.
- `Plan/05_confirmed_decisions.md` as the permanent decision register.
- `Plan/development_log.md` as the chronological engineering record.

Treat as historical background:

- `Plan/Rota generator/algorithm.txt`
- older brainstorming sections in `Plan/Rota generator/02_complete_rota_generator_workflow_plan.md`

Do not delete historical planning notes yet. They contain domain context. Instead, rely on the authoritative reading order above when a conflict appears.

## Next Engineering Actions

Recommended order:

1. Confirm the policy gaps in this document with the rota board.
2. Align the implementation and validation docs for leave status behavior.
3. Align call-level source of truth to monthly posting type.
4. Decide and implement `is_adjustable` unsafe-slot behavior.
5. Add true symmetric rest-gap validation for person assignment.
6. Decide whether to enforce designation eligibility now or later.
7. Add regression tests for each finalized policy.
8. Only then proceed to the detailed person-specific duty allocation policy and scoring refinements.

