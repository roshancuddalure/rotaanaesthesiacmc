# Unit Duty Family Distribution Plan

Current as of: 2026-05-26

Purpose: explain why total duties can look equally divided while Main/CB/RC duty families are not equally distributed, and define the plan to fix unit-slot allocation fairness before person-specific duty assignment becomes more advanced.

Implementation status:

- Backend grouped fairness counters, grouped selection keys, allocation statistics matrices, frontend statistics tables, and focused regression tests were implemented on 2026-05-26.
- The remaining validation task is to run this on real rota-board month data and confirm whether the visible Main/CB/RC mix now matches department expectations.

## Problem Seen In Testing

Testing found that total duty count is being divided reasonably evenly across included units, but the type of duties is not evenly mixed.

Example pattern:

- Unit 1 may receive mostly Main/OR calls and very few RC calls.
- Another unit may receive mostly CB calls and very few Main/OR calls.
- Total monthly slot count per unit may still look fair, so the issue is hidden unless the board checks duty-family distribution.

This means the algorithm is balancing quantity, but not enough quality/mix of duties.

## Root Cause In Current Algorithm

The current template allocation score in `backend/app/services/rota_template.py` considers:

- total monthly slots per unit;
- exact same duty type per unit;
- same ISO week count;
- weekend count;
- same-day unit count;
- leave/unavailability pressure;
- near-minimum staffing pressure.

But it does not consider:

- total Main-family duties per unit;
- total CB-family duties per unit;
- total RC-family duties per unit;
- Main/CB/RC distribution within the same call level;
- duty group plus call-level distribution, for example `main + 1ST_CALL` versus `rc + 1ST_CALL`;
- target quota or expected fair share for each duty family.

So the engine can make a locally fair choice for each duty while still producing global imbalance across duty families.

Current score shape:

```text
unit_month_count * 100
+ exact_same_duty_count * 60
+ unit_week_count * 25
+ weekend_count * 20
+ same_day_unit_count * 80
+ unavailable_percent
+ near_minimum_penalty
```

The exact-duty counter helps avoid repeatedly giving the exact same duty, such as `MAIN_1ST_24HR`, to one unit. But it does not prevent the same unit from receiving too many duties from the broader `main` group while another unit receives too many from `rc` or `cb`.

The vertical shuffle pass also cannot fully fix this because it only swaps units between slots with the same exact duty type. That preserves exact duty counts and reduces clustering, but it does not rebalance family-level mix.

## Correct Fairness Goal

The policy should not be only:

> Every included unit gets roughly the same total number of duties.

The correct policy should be:

> Every included unit gets a reasonably balanced mix of duty families and call-level duty families, subject to leave, staffing safety, unit eligibility, and mandatory coverage.

That means we need separate fairness tracks:

1. Total duty count fairness.
2. Duty family fairness: Main, CB, RC, PAC, shift, Caesar, etc.
3. Call-level fairness: 1st, 2nd, 3rd, 4th, co-4th, 5th.
4. Duty family plus call-level fairness: Main 1st, CB 1st, RC 1st, Main 3rd, RC 3rd, etc.
5. Weekend fairness inside those buckets where relevant.

## Proposed Fix

This plan is now backed by the research pass in `docs/rota_allocation_research_principles.md`.

The key borrowed principle is: fairness must be measured over every duty category that people experience as meaningfully different, not only over total slot count.

### Phase 1: Add Distribution Diagnostics First

Status: implemented.

Before changing the allocator, add report columns/tables so we can prove the problem numerically.

Add or expand allocation statistics with:

- unit x duty group matrix;
- unit x call level matrix;
- unit x duty group x call level matrix;
- per-unit percentage share of Main, CB, RC duties;
- imbalance warnings where a unit's share is far above or below expected fair share.

This gives the board a visible before/after comparison.

### Phase 2: Add Group Counters To The Allocator

Status: implemented.

During template generation, maintain new counters:

```text
unit_group_counts[(unit_id, duty_group)]
unit_call_counts[(unit_id, call_level)]
unit_group_call_counts[(unit_id, duty_group, call_level)]
unit_week_group_counts[(unit_id, week, duty_group)]
unit_weekend_group_counts[(unit_id, duty_group)]
```

These counters should be initialized from existing generated template slots when `replace_existing` is false, just like the current total and exact-duty counters.

### Phase 3: Add Group-Mix Penalties

Status: implemented as grouped overage selection before the ordinary score.

Add penalties to allocation scoring:

```text
+ unit_group_count * group_weight
+ unit_group_call_count * group_call_weight
+ unit_call_count * call_weight
+ unit_week_group_count * week_group_weight
```

Recommended first weights:

```text
group_weight = 70
group_call_weight = 90
call_weight = 25
week_group_weight = 35
```

Rationale:

- `group_call_weight` should be strong because "Main 1st versus RC 1st versus CB 1st" is exactly the imbalance testers noticed.
- `group_weight` should be strong enough to avoid one unit becoming mostly Main or mostly RC.
- `call_weight` should be lighter because total call-level fairness matters, but duty family mix is more important here.
- `week_group_weight` avoids weekly clustering of the same family.

These weights should be tested on real rota-board data before being exposed as admin settings.

### Phase 3B: Prefer Lexicographic Overage Before Weighted Score

Status: implemented and refined with target-deficit priority.

The research pass suggests not hiding important fairness inside one weighted sum. For major buckets, compare overage first, then fall back to the ordinary score.

Recommended safe-allocation key:

```text
(
  weekend_day_count, if weekend,
  total_target_deficit,
  group_call_target_deficit,
  group_target_deficit,
  group_call_overage,
  group_overage,
  exact_duty_overage,
  total_month_overage,
  allocation_score,
  unit_name,
)
```

This makes the allocator prefer a unit that is under-used in `rc:1ST_CALL`, for example, even if its total monthly duty count is already close to average.

### Phase 4: Add Target-Share Awareness

Status: implemented with target-deficit and overage comparison against currently comparable candidates.

Simple count penalties may still fail when duty groups have very different total volume. The better enterprise version should calculate expected fair share:

```text
expected_group_share = total_slots_in_group_so_far / included_unit_count
expected_group_call_share = total_slots_in_group_call_so_far / included_unit_count
```

Then penalize a unit more when it is already above expected share:

```text
group_overage = max(0, unit_group_count - floor(expected_group_share))
group_call_overage = max(0, unit_group_call_count - floor(expected_group_call_share))
```

This prevents a large duty family, such as Main calls, from overwhelming the score simply because every unit must eventually get many Main duties.

The implemented allocator now also looks at target deficit before overage. This means an under-target unit is actively preferred when it is safe, instead of only avoiding units that are already over target.

### Phase 4B: Rotate Duty-Family Order

Status: implemented.

The generator no longer processes selected duty families in the same fixed order every day. It rotates the family order by date while preserving the user's selected duty order inside each family.

This prevents late-order families such as CHAD or RUHSA from always being considered after Main, CB, RC, PAC, and Shift have already consumed the smaller units' same-day capacity.

### Phase 4C: Allocation Diagnostics

Status: implemented.

Allocation Statistics now includes a Generation Diagnostics table with:

- active people by unit;
- active call-level counts;
- created slots;
- forced review events;
- hard-blocked events;
- warning skips;
- info skips;
- top blocked duty families.

Generation events also store duty-family, call-bucket, target-deficit, overage, and starvation-rescue context so future matrix-cell explanations can be built from saved audit data.

### Phase 4D: Fairness Policy Modes

Status: implemented.

The generator now supports three explicit policies:

- `equal_unit`: every included unit has the same target share.
- `equal_people`: target share follows eligible active people and call-level capacity.
- `hybrid`: blends unit participation with eligible-person capacity. This is the default.

The Target vs Actual statistics table shows the expected slot target and actual result for the selected policy.

### Phase 5: Keep Safety Above Fairness

The order should remain:

1. Exclude units where duty rule does not apply.
2. Avoid hard-blocked units if any non-hard-blocked unit exists.
3. Apply staffing and leave pressure.
4. Apply duty mix fairness.
5. Apply total duty fairness.
6. Apply stable tie-breakers.

Safety must continue to win over perfect distribution. A unit with dangerous leave pressure should not receive a slot just to make a duty-family matrix look neat.

## Updated Selection Priority

For non-weekend safe allocations, the target should become:

1. lower hard/safety risk;
2. lower duty group plus call-level overage;
3. lower duty group overage;
4. lower exact same-duty count;
5. lower total monthly count;
6. lower weekly group count;
7. lower same-day unit count;
8. lower staffing pressure;
9. unit name.

For weekend allocations:

1. lower same weekend-day count;
2. lower weekend duty group plus call-level count;
3. lower total weekend count;
4. lower duty group plus call-level overage;
5. lower duty group overage;
6. lower ordinary score;
7. unit name.

## Regression Tests Needed

Add focused tests before or with implementation:

1. Total duties still balance across units.
2. Main/CB/RC groups distribute across units when all units are equally eligible and safe.
3. Main 1st, CB 1st, and RC 1st do not concentrate in separate units.
4. Weekend Main/CB/RC mix is not concentrated in one unit.
5. Safety still beats group fairness when a unit is hard blocked.
6. Unit rule restrictions still work when only some units are allowed for a duty.
7. Forced minimal-damage allocation still divides forced burden fairly.
8. Vertical shuffle does not undo group balance.

## Implementation Touch Points

Primary backend file:

- `backend/app/services/rota_template.py`

Likely changes:

- add helper to get `duty_group` from `DutyRule`;
- add helper to resolve `required_call` once and reuse it;
- add group/call counters;
- update `allocation_score`;
- update `choose_balanced_unit` tie-breakers;
- update counter increments after slot creation;
- initialize new counters from existing slots;
- include new score parts in generation event details.

Tests:

- `backend/tests/test_rota_template.py`

Optional frontend/reporting:

- Expand allocation statistics UI with group and group-call matrices.
- Link the allocation statistics help text to the research principle: total fairness and duty-family fairness are separate checks.

## Recommended Board Policy Wording

Use this wording for validation:

> The generator should divide total duty burden across included units, but also divide duty families fairly. A unit should not repeatedly receive mostly Main, CB, or RC calls unless safety, eligibility, leave, or board-approved restrictions make that unavoidable. When unavoidable, the reason must be visible in allocation statistics and audit events.

## Decision Needed

Before implementation, confirm the exact fairness buckets:

1. Should Main, CB, and RC be balanced as separate primary duty families?
2. Should Caesar be part of CB family or its own family?
3. Should PAC and shifts be balanced separately from 24-hour calls?
4. Should 1st/2nd/3rd/4th call family fairness be separate inside each family?
5. How much imbalance is acceptable before the UI flags it as warning?

Recommended initial answer:

- Balance by `DutyRule.group`.
- Balance by `DutyRule.group + required_call_level`.
- Keep Caesar as its own group for now because it has different duty behavior.
- Keep PAC and shifts separate.
- Add warning when one unit is more than 1 slot above the expected fair share in a major group-call bucket.
