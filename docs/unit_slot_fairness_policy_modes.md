# Unit Slot Fairness Policy Modes

Date added: 2026-05-26

The rota template generator supports three allocation fairness policies. These policies control the target used by the unit-slot allocator before people are assigned.

## Policy 1: Equal Unit

Key: `equal_unit`

Meaning:

```text
Every included unit has the same target share.
```

Use when the rota board wants visually equal participation across units.

Pros:

- Simple to explain.
- Easy to validate from the Unit-Wise Slot Tally.
- Useful when units are meant to be treated as equal administrative rota blocks.

Cons:

- Can overload smaller units on a per-person basis.
- Can create more warnings or forced review slots for units with fewer active members.
- May look fair by unit while being unfair to individual members.

## Policy 2: Equal People

Key: `equal_people`

Meaning:

```text
Each unit's target share is proportional to eligible active people.
```

For a general duty, the target uses active people in the unit. For a call-level duty, the target uses active people in the required call bucket.

Use when the board wants the final burden to trend toward equal duties per department member.

Pros:

- Better human-level fairness.
- Small units are not forced to carry the same absolute load as large units.
- Person assignment should become easier because unit slot volume already follows manpower.

Cons:

- Unit totals can look unequal.
- Requires accurate posting and call-level data.
- A small unit can receive very few slots in a family unless minimum participation rules or review policies are also used.

## Policy 3: Hybrid

Key: `hybrid`

Meaning:

```text
Targets blend equal-unit participation and eligible-people capacity.
```

The current hybrid formula gives every included unit a baseline participation share, then adds extra target weight based on active manpower.

Use this as the default policy.

Pros:

- Protects smaller units from strict equal-unit overload.
- Avoids letting a small unit disappear completely just because it has fewer people.
- Fits the board-facing need to explain both unit participation and member-level fairness.

Cons:

- More complex than equal-unit.
- Still requires target-vs-actual diagnostics to explain why raw unit totals differ.
- The blend may need future tuning after several real months are reviewed.

## Safety Priority

All three policies are below safety.

The engine still avoids hard-blocked units when any safe candidate exists. A fairness policy can change the target and ranking among safe candidates, but it does not make an unsafe unit safe.

## Current UI Behavior

The Rota Template generation settings include:

```text
Fairness policy:
- Hybrid
- Equal Unit
- Equal People
```

Allocation Statistics includes a Target vs Actual table showing:

- unit;
- policy;
- active people;
- target slots;
- actual slots;
- difference.

This is the required companion view for capacity-weighted policies. Without target-vs-actual, Equal People and Hybrid can look unfair even when they are behaving correctly.
