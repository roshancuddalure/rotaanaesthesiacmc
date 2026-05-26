# Rota Allocation Research Principles

Current as of: 2026-05-26

Purpose: summarize useful ideas from rostering papers, solver documentation, and practical scheduling forums before changing our unit-slot allocation algorithm.

## Short Answer

There is a mature scheduling principle that applies directly to our problem:

> Fair rota generation should not balance only total workload. It should balance workload by meaningful duty categories, using hard constraints for safety/eligibility and soft objectives for fairness.

For our rota, this means total unit duty count is only one fairness dimension. We also need grouped fairness for:

- Main/OR calls;
- CB calls;
- RC calls;
- PAC duties;
- shifts;
- duty group plus call level, such as Main 1st, CB 1st, RC 1st;
- weekends inside each important bucket.

This idea is already well established in nurse and physician rostering literature, where fairness commonly means balancing nights, weekends, shift types, hours, skill burdens, and undesirable duties separately rather than only balancing total assignments.

## Sources Reviewed

### Solver And Practical Scheduling References

- Google OR-Tools Employee Scheduling guide: https://developers.google.com/optimization/scheduling/employee_scheduling
- Timefold Solver load balancing and fairness guide: https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/load-balancing-and-fairness
- Timefold Employee Shift Scheduling fairness guide: https://docs.timefold.ai/employee-shift-scheduling/latest/employee-resource-constraints/fairness/fairness
- Operations Research Stack Exchange example on employee scheduling formulation: https://or.stackexchange.com/questions/4425/limit-number-of-switches-in-employee-scheduling-problem
- Practical forum examples from Stack Overflow/Reddit/OR communities around fair shift distribution and constraint solving were reviewed for recurring implementation lessons, not as scientific authority.

### Papers And Academic References

- Fairness in Nurse Rostering, University of Portsmouth working paper/PDF: https://pure.port.ac.uk/ws/portalfiles/portal/123556/FairnessinNurseRostering.pdf
- Devesse et al., physician scheduling in emergency rooms, accepted manuscript: https://strathprints.strath.ac.uk/82417/1/Devesse_etal_JORS_2022_Linear_approximations_to_improve_lower_bounds_of_a_physician_scheduling_problem.pdf
- A systematic two-phase approach for the nurse rostering problem, EJOR/INRC summary: https://www.sciencedirect.com/science/article/pii/S0377221711011362
- The First International Nurse Rostering Competition 2010: https://ideas.repec.org/a/spr/annopr/v218y2014i1p221-23610.1007-s10479-012-1062-0.html
- Second International Nurse Rostering Competition problem description: https://arxiv.org/abs/1501.04177

## Useful Principles For Our System

### 1. Hard Constraints And Soft Constraints Should Be Separate

Rostering papers and solver examples consistently separate:

- hard constraints: must not be violated;
- soft constraints: allowed but penalized or reviewed.

For us:

Hard constraints should include:

- monthly scope locked;
- duty rule applies to unit;
- active unit/call pool exists when required;
- wrong call level/person subgroup is blocked;
- no unsafe duplicate slot key;
- approved board rules for rest/leave once finalized.

Soft constraints should include:

- total unit load fairness;
- Main/CB/RC family mix fairness;
- weekend fairness;
- exact duty repetition;
- week clustering;
- near-minimum staffing pressure where not hard blocked;
- pending leave pressure.

Why this matters:

- It lets us keep clinical coverage safe while still explaining why one duty distribution is better than another.
- It avoids hiding risky decisions inside one big score.

### 2. Fairness Is Not One Number

Timefold's fairness docs highlight that fairness is not simply "everyone gets the same total", especially when skills differ. Physician scheduling literature also discusses fairness across shift types, nights, weekends, and hours.

For us, equal total duties is necessary but not sufficient.

A unit receiving 12 duties total can still be unfairly treated if:

- 10 are Main calls and 2 are RC/CB;
- another unit receives 10 RC/CB and 2 Main;
- one unit receives most Saturday Main calls;
- one unit repeatedly receives a specific duty family at the same call level.

So our fairness model should become multi-bucket:

```text
total unit duties
duty group duties
duty group + call level duties
exact duty duties
weekend duties
weekend duty group duties
week-level clustering
```

### 3. Use Target Deviation, Not Only Raw Counts

Physician scheduling models often use target hours/weekends and penalize deviation from the target. Timefold frames fairness through load balancing, including max-load style thinking.

For our unit allocator:

```text
expected_group_share = total_group_slots_so_far / included_unit_count
group_overage = max(0, unit_group_count - floor(expected_group_share))
```

This is better than only saying:

```text
unit_group_count * weight
```

Because some groups naturally have many more duties. Target deviation asks: "Is this unit above its fair share for this bucket right now?"

### 4. Prefer Lexicographic Fairness For Important Buckets

A weighted sum can accidentally hide a bad fairness problem. For example, a unit can still receive too many Main duties if total count and staffing pressure dominate the score.

An enterprise scheduling pattern is to compare the most important objectives first, then use lower objectives as tie-breakers.

For us, selection should prefer this shape:

```text
1. safety status
2. group + call-level overage
3. duty group overage
4. exact duty overage
5. weekend bucket overage, when weekend
6. total monthly overage
7. staffing pressure
8. stable unit-name tie-breaker
```

This is more explainable than a single opaque number.

### 5. Two-Stage Scheduling Fits Our Architecture

The nurse rostering literature includes two-phase approaches where broad workload/demand decisions are made before detailed shift assignment.

Our system already follows this shape:

1. Unit-slot allocation: decide which unit owns each duty slot.
2. Person assignment: decide which person inside that unit fills the slot.

This is good. The mistake would be trying to fix unit-family unfairness at the person stage. Person assignment cannot repair a skewed unit template. We should fix duty-family fairness in stage 1 before refining stage 2.

### 6. Auditability Matters As Much As Optimization

Forums and practical scheduling discussions repeatedly show that staff lose trust when the scheduler cannot explain why a roster is fair.

For us, every allocation should expose:

- the selected unit;
- safety status;
- total duty count;
- duty group count;
- duty group plus call-level count;
- exact duty count;
- weekend count;
- why competing units were skipped;
- whether the result was forced by safety constraints.

This means we should improve the allocation statistics before or alongside the algorithm change.

### 7. Solver Technology Is Useful, But Not Mandatory Yet

OR-Tools and Timefold show mature ways to model schedules using CP-SAT/constraint solving. That is a future option.

But for our immediate issue, we do not need to replace the current deterministic generator with a full solver yet. We can apply the same principles inside our current greedy allocator:

- hard/soft constraint separation;
- grouped load balancing;
- target-share penalties;
- lexicographic tie-breakers;
- audit tables.

Move to OR-Tools/CP-SAT later only if:

- greedy allocation cannot satisfy board-approved fairness;
- we need backtracking across the whole month;
- forced slots become frequent;
- there are many coupled cross-date rules.

## Research-Backed Fix For Our Current Issue

The Main/CB/RC imbalance should be fixed by adding grouped fairness buckets.

Recommended first implementation:

1. Keep safety filtering first.
2. Add counters for:
   - `unit_group_counts[(unit_id, duty_group)]`;
   - `unit_group_call_counts[(unit_id, duty_group, required_call)]`;
   - `unit_weekend_group_counts[(unit_id, duty_group)]`;
   - `unit_week_group_counts[(unit_id, week, duty_group)]`.
3. Compute expected fair share for each bucket as generation progresses.
4. Penalize overage above expected fair share.
5. Use lexicographic selection so group-call fairness is checked before ordinary total-count score.
6. Add allocation statistics showing before/after group distribution.

Recommended first buckets:

```text
duty_group = DutyRule.group
required_call = duty rule allowed call level, else inferred from duty key, else "Unassigned"
group_call_bucket = duty_group + required_call
```

Example buckets:

```text
main:1ST_CALL
cb:1ST_CALL
rc:1ST_CALL
main:3RD_CALL
rc:3RD_CALL
pac:3RD_CALL
shift:Unassigned
```

## What To Avoid

Avoid these traps:

- balancing only total monthly duties;
- balancing only exact duty type;
- hiding all fairness inside one weighted sum;
- trying to fix unit-family imbalance during person assignment;
- using historical/manual plans as invisible bias without audit;
- making every fairness rule hard, which can make generation impossible;
- adopting a full solver before the rota board confirms the fairness policy.

## Recommendation For This Project

For our current stage, the best enterprise-grade path is:

1. Keep the deterministic generator.
2. Add research-backed grouped fairness scoring.
3. Add diagnostics that visibly prove duty-family distribution.
4. Validate on real rota-board data.
5. Only after the unit template is fair, proceed to person-specific assignment policy.

The most important borrowed principle is:

> Fairness must be measured over every duty category people experience as meaningfully different.

In our department, Main/OR, CB, RC, PAC, shifts, weekends, and call-level family buckets are meaningfully different. Therefore the allocator must balance them separately.

