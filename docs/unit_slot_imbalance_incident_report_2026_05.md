# Unit Slot Imbalance Incident Report - May 2026 Run

Date reviewed: 2026-05-26

Reviewed run:

- Month: 2026-05
- Latest generation run timestamp: 2026-05-26 03:43:40
- Generated slots: 837
- Included units: 6

## Screenshot Finding

The Duty Family Matrix shows that total and family distribution are still visibly uneven:

| Unit | Total | RC | CHAD | RUHSA | Shift |
| --- | ---: | ---: | ---: | ---: | ---: |
| UNIT I | 141 | 28 | 7 | 6 | 19 |
| UNIT II | 164 | 45 | 6 | 7 | 17 |
| UNIT III | 142 | 27 | 6 | 7 | 18 |
| UNIT IV | 151 | 38 | 7 | 7 | 18 |
| UNIT V | 142 | 30 | 5 | 4 | 18 |
| UNIT VI | 97 | 18 | 0 | 0 | 3 |

The average total per unit is 139.5 slots. UNIT VI is 42.5 slots below average, while UNIT II is 24.5 slots above average.

## Primary Root Cause

This is not only a grouped fairness scoring problem. The current allocator first removes hard-blocked units from the safe candidate pool, then applies fairness only among the remaining safe units.

In this run, UNIT VI was repeatedly hard-blocked before fairness could help it.

Evidence from generation events for UNIT VI:

- `blocked/error`: 303 events
- `skipped/warning`: 478 events
- `created/info`: 7 events
- `created/warning`: 37 events
- `forced_allocation/warning`: 53 events

Most UNIT VI block reasons were one of:

- Available members would fall below the unit minimum of 1.
- The unavailable percentage met or exceeded the hard-block threshold of 40%.

## Staffing Pressure Behind The Imbalance

UNIT VI has a much smaller active posting base than the other included units for May 2026.

Distinct active people by unit:

| Unit | Distinct active people |
| --- | ---: |
| UNIT I | 50 |
| UNIT II | 37 |
| UNIT III | 25 |
| UNIT IV | 27 |
| UNIT V | 25 |
| UNIT VI | 11 |

UNIT VI normalized call-level pool:

| Call level | Count |
| --- | ---: |
| 1ST_CALL | 5 |
| 2ND_CALL | 3 |
| 3RD_CALL | 4 |
| 4TH_CALL | 3 |
| 5TH_CALL | 1 |

Because UNIT VI has only 11 distinct active people, a few leave entries, same-day provisional duties, or post-24-hour rest blocks can push it above the 40% hard-block threshold quickly.

## Why CHAD And RUHSA Became Zero For UNIT VI

CHAD and RUHSA are currently near the end of the selected duty order for this run:

```text
... MAIN_SHIFT, RC_SHIFT, PB_SHIFT, CHAD, RUHSA
```

The allocator processes duties sequentially within each date. By the time CHAD and RUHSA are evaluated, earlier Main, CB, RC, PAC, and Shift slots may already have consumed UNIT VI capacity for that day.

For CHAD and RUHSA, UNIT VI was skipped on all dates due to hard-block pressure:

- CHAD skip reasons ranged from 45% to 91% unavailable.
- RUHSA skip reasons ranged from 45% to 91% unavailable.

So CHAD and RUHSA were not zero because the grouped fairness matrix ignored them. They became zero because UNIT VI was not a safe candidate when those late-order duties were allocated.

## Why UNIT II Got High RC Load

RC total should average about 31 per unit if all six units are equally eligible. Actual RC distribution:

| Unit | RC |
| --- | ---: |
| UNIT I | 28 |
| UNIT II | 45 |
| UNIT III | 27 |
| UNIT IV | 38 |
| UNIT V | 30 |
| UNIT VI | 18 |

UNIT VI was hard-blocked for many RC duties, including:

- `RC_4TH_24HR`: 31 blocked events
- `RC_PAC_SENIOR`: 31 blocked events
- `RC_PAC_3RD`: 31 blocked events
- `RC_PAC_SR_A`: 30 blocked events
- `RC_1ST_B_24HR`: 29 blocked events
- `RC_1ST_A_24HR`: 22 blocked events

Once UNIT VI is removed from those candidate sets, the remaining safe units absorb the RC load. UNIT II appears to have absorbed a larger share because it remained comparatively safer or lower-scored during those RC decisions.

## Contributing Algorithm Behavior

The current algorithm has these behaviors:

1. Hard-block safety is evaluated before fairness.
2. Fairness only operates among non-hard-blocked units.
3. Same-day provisional duties reduce available unit capacity.
4. Previous 24-hour duties reduce next-day availability for relevant call buckets.
5. The duty order is fixed, so late-order families can lose access to small units.
6. Group fairness is not currently allowed to override safety pressure unless every candidate unit is hard-blocked.

These are defensible safety-first rules, but they mean equal distribution is not guaranteed when one unit has much lower staffing capacity.

## Policy Decision Needed

Before changing code, we need to choose the intended enterprise policy:

1. Equal-unit policy:
   Every included unit should receive near-equal totals and near-equal duty-family mix, even if one unit has fewer people. This may create more review/unsafe slots for small units.

2. Capacity-weighted policy:
   Units receive duties proportional to their available manpower and call-level pools. Under this policy, UNIT VI receiving fewer total duties may be correct, but the UI must show expected target versus actual.

3. Hybrid policy:
   Keep safety hard blocks, but add minimum family participation targets so small units should still receive at least some CHAD/RUHSA/Shift unless explicitly exempted.

## Recommended Next Fix

Use the hybrid policy first.

Recommended implementation:

1. Add target calculation per unit and duty family.
   - Equal target for standard units.
   - Optional capacity-adjusted target when a unit has materially smaller manpower.

2. Add duty-order rotation.
   - Do not always process CHAD/RUHSA after Main/CB/RC/PAC/Shift.
   - Rotate family order by date so late-order families do not always lose small units.

3. Add a "family starvation rescue" rule.
   - If a unit has zero count for a selected family and can take the duty with warning rather than hard block, prefer it.
   - Do not override true hard blocks unless policy explicitly allows review-forced slots.

4. Add allocation diagnostics to the UI.
   - For each matrix cell, show expected target, actual count, and reason for shortfall.
   - Example: `UNIT VI / CHAD = 0 because UNIT VI was hard-blocked on 31 CHAD attempts`.

5. Add a generation audit summary.
   - Per unit: active people, call-level pool, hard-blocked attempts, warning attempts, created slots, forced slots.
   - This will make future imbalance reports explainable without database querying.

## Implementation Update

Status: implemented after this incident review.

The allocator now includes:

- duty-family order rotation by date;
- target-deficit priority for total slots, duty family, duty family plus call level, exact duty, and call bucket;
- overage comparison after target deficit;
- generation event details for duty group, call bucket, group-call bucket, target deficits, overage values, and starvation-rescue candidate status;
- Allocation Statistics Generation Diagnostics for active people, call-level pool, created events, forced events, hard blocks, warning skips, info skips, and top blocked families.

This does not weaken hard-block safety. A hard-blocked unit is still avoided when another safe unit exists.

## Immediate Conclusion

The visible inequality mainly came from safety pressure and duty ordering, not from a missing matrix display. UNIT VI was too often hard-blocked because it had only 11 active people and small call-level pools. CHAD/RUHSA were especially affected because they were allocated at the end of the selected duty sequence.

The next algorithm slice should therefore be target-aware and order-aware, not just more weighted scoring.
