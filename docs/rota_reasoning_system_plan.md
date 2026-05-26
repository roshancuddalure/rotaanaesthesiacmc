# Rota Reasoning System Plan

Date started: 2026-05-26

## Purpose

The rota engine should not only generate allocations. It should explain them.

The reasoning system is the audit and explanation layer that answers:

- Why did this unit get this slot?
- Why did another unit not get it?
- Which rule blocked the preferred allocation?
- Was this a fairness choice, a safety choice, or a forced review choice?
- What would need to change for a better result next run?

## Current Foundation

The application already stores several explainability records:

- `RotaTemplateGenerationRun`: one summary per unit-slot generation run.
- `RotaTemplateGenerationEvent`: per unit/date/duty decision records.
- `DutySlot.template_status`: ready, needs review, or unresolved.
- `DutySlot.template_reason`: human-readable reason for the generated slot.
- `RotaAutoFillRun` and `RotaAutoFillEvent`: later person-assignment audit records.

The May 2026 imbalance review proved these records are useful, but the explanation is still too low-level. It requires database queries to understand why a matrix cell such as `UNIT VI / CHAD = 0`.

## Reasoning Layers

### Layer 1: Decision Trace

Every generated slot should have a compact trace:

```text
candidate units -> safety status -> fairness snapshot -> selected unit -> final status
```

Each candidate row should capture:

- unit;
- duty group;
- required call bucket;
- group plus call bucket;
- active people considered;
- available before slot;
- available after slot;
- unavailable percent;
- hard block or warning status;
- total-duty deficit;
- family deficit;
- family-call deficit;
- exact-duty deficit;
- selected/not selected reason.

### Layer 2: Matrix Cell Explanation

Every important statistics matrix cell should be explainable.

Example:

```text
UNIT VI / CHAD = 0
Expected target: 5
Actual: 0
Reason: UNIT VI was hard-blocked or warning-skipped on all CHAD attempts.
Top blockers: unavailable percentage >= 40%, same-day provisional duties.
```

This should be generated from saved events, not recomputed separately.

### Layer 3: Policy Explanation

The system should classify each allocation decision into one primary policy reason:

- safety-first;
- total fairness;
- duty-family fairness;
- call-level fairness;
- weekend fairness;
- starvation rescue;
- forced minimal-damage fallback;
- rule exclusion;
- duplicate slot prevention.

This classification lets the UI show a plain-language explanation without exposing raw score math first.

### Layer 4: Recommendation Engine

When imbalance remains, the system should recommend the most likely corrective action:

- increase available staff or lower unit minimums for a small unit;
- adjust duty selection;
- rotate duty-family order;
- mark a unit exempt from a family;
- accept capacity-weighted inequality;
- review leave concentration;
- inspect call-level posting data.

This does not change allocations by itself. It helps the rota board understand whether the output is an algorithm problem, a policy problem, or a staffing-data problem.

## Implementation Slices

### Slice 1: Generation Diagnostics

Status: implemented.

Allocation Statistics now exposes per-unit generation diagnostics:

- active people;
- active call-level counts;
- created events;
- forced events;
- blocked events;
- warning skips;
- info skips;
- top blocked duty families.

### Slice 2: Event-Level Fairness Snapshot

Status: implemented.

Generation events now include:

- `duty_group`;
- `call_bucket`;
- `group_call_bucket`;
- target deficits;
- overage values;
- current bucket counts;
- starvation rescue candidate flag.

### Slice 2B: Fairness Policy Reasoning

Status: implemented.

Generation events and statistics now include the selected fairness policy:

- `equal_unit`;
- `equal_people`;
- `hybrid`.

The Statistics view also includes Target vs Actual so the board can distinguish an unfair raw total from a correct capacity-weighted target.

### Slice 3: Cell-Level Explanations

Status: planned.

Add an API structure for duty-family matrix explanations:

```json
{
  "unit_id": "...",
  "bucket": "chad",
  "expected_target": 5,
  "actual": 0,
  "status": "below_target",
  "primary_reason": "hard_blocked_on_attempts",
  "top_reasons": [
    "unavailable_percent_hard_block",
    "same_day_provisional_pressure"
  ]
}
```

### Slice 4: UI Drilldown

Status: planned.

In the statistics view, clicking a suspicious matrix cell should open:

- target versus actual;
- related generation events;
- selected alternatives;
- hard-block/warning reasons;
- suggested corrective actions.

### Slice 5: Person Assignment Reasoning

Status: planned.

Before finalizing person-level allocation, define the same trace model for candidate people:

```text
candidate people -> eligibility -> safety -> fairness/rank -> selected person -> final status
```

This should explain:

- wrong unit;
- wrong call level;
- leave;
- same-day duty;
- previous 24-hour rest;
- monthly duty limit;
- subgroup/cluster mismatch;
- fairness rank.

## Policy Principle

The reasoning system must never be a decorative afterthought. It is part of the algorithm.

For every allocation, the system should be able to say:

```text
This was selected because it was the safest eligible option that best reduced total, family, and call-level imbalance under the current policy.
```

If it cannot say that, the algorithm or policy is not yet enterprise-grade.
