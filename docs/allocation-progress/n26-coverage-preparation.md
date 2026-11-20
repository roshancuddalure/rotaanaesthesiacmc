# N26 architecture experiment: preparation, not selection

This isolated experiment compares a fixed unit layout, joint unit/person CP-SAT,
and an iterative loop which changes one unit choice at a time when coverage
strictly improves. It changes no application scheduler, objective, safety rule,
feature flag, operational record or schema. N26 remains queued until N05/N06
dependencies are satisfied; this is reusable experimental preparation.

## Method

`tools/compare_allocation_architectures.py` creates fresh in-memory SQLite data:
two units, three first-call people per unit, and two logical 24-hour duties. The
fixtures cover concurrent duties, consecutive dates, dates three days apart,
and consecutive duties with both unit choices locked to Unit I. Each permitted
unit alternative retains the same duty requirement, time and call level.

Every possible partial/full person allocation is enumerated and checked with
the existing canonical `validate_plan`. Rejected singleton and pair selections
become CP-SAT cuts. With only two logical duties these cuts describe every
combination; this is not a general month-wide constraint encoding. All returned
plans are checked again and the harness asserts zero saved assignments.

Both algorithms consume exactly the same options and canonical conflict cuts.
The exhaustive maximum verifies coverage, but shares the canonical validator:
it is not an independent implementation of departmental safety policy. The
iterative loop evaluates all one-coordinate neighbors per round and only accepts
strict coverage improvement; it is not guaranteed globally optimal on larger
instances. Unit locks remove options before every algorithm, including repair.

## Interpretation limits

The fixed template is deliberately supplied to the experiment. The production
template already checks pressure and attempts staffing-preserving swaps. A
coverage gap against this fixed layout does **not** prove the production
generator produces that layout or that its repair cannot recover it. A current
generator counterexample must be reproduced separately before architecture
selection.

## Architecture decision to make after N05/N06

| Question | Joint model | Iterative repair | Required evidence |
| --- | --- | --- | --- |
| Can later scarcity change an earlier unit choice? | Unit/person options coexist in the model. | Repair must reopen allowed earlier choices. | Same published/explicit locks, demand and dated eligibility. |
| Can unit choices hide unsafe staffing combinations? | Requires joint reserve/OT constraints or validated rejection cuts. | Every proposed layout needs a complete final-plan check. | Higher-order shortages; pair compatibility alone is insufficient. |
| What proves a reported result? | Report feasible versus proven optimal and any bound/gap. | Report incumbent quality, explored layouts and termination reason. | Independent exhaustive oracle on small cases, canonical final checks on all cases. |
| What happens at a time limit? | Keep only a validated incumbent; preserve required open duties. | Keep only a validated best layout; preserve unresolved duties. | Explicit budget at equal end-to-end scope, including validation. |
| What makes maintenance acceptable? | Reuse dated eligibility and explicit rule semantics. | Reuse existing template, person optimizer and review authority. | Constraint inventory, duplicated-rule count, rollback and feature-flag design. |

Neither architecture should gain coverage by changing required duties, relaxing
review requirements, moving locked choices, or treating an unvalidated incumbent
as safe. Select only after representative evidence; do not infer selection from
which prototype happens to be shorter or faster on these tiny fixtures.

Conflict-oracle construction and solver times are recorded separately. Neither
is a production request-latency benchmark. Memory and fairness are explicitly
unknown; OT is disabled. No inference about GPU speed, fairness priority,
departmental correction rates, scalability or architecture preference follows.
N26 selection still requires ratified metrics, representative months, explicit
OT/reserve/fixed/pooled-call constraints, memory measurements, fairness and
maintainability comparison, and a genuine sequential-template counterexample.

## Evidence

The initial run (`n26-coverage-preparation.log`, session 37926, exit 1) exposed
duplicate labels for concurrent fixture duties. The harness now assigns distinct
logical-duty labels; the application uniqueness rule was preserved. Results of
the corrected run belong in `n26-coverage-verified.json` only after its complete
and source-unchanged flags pass. Do not interpret partial output as acceptance.

The four-member corrected fixture also rejected the harness's expected coverage
assertion (`n26-coverage-verified.log`, session 48853, exit 1). Diagnostic session
52819 exited 1 with actual fixed and joint coverage **2/2** on concurrent duties:
the canonical per-slot check excludes its own assignment from same-day blockers,
so one other assigned member is 25%, below the existing 30% warning threshold.
This refutes the original experimental expectation; it is not a scheduler bug.
The subsequent three-member fixture makes one other blocked member 33%, requiring
review under existing rules. Its output is `n26-coverage-three-member.json`;
fairness, thresholds, and validator code remain unchanged.

Corrected three-member run session **26288 exited 0**. Its report has
`complete=true` and `source_unchanged=true`, with all 169 enumerated plans
checked and every returned result passing final validation:

| Fixture | Fixed template | Joint | Iterative | Exhaustive maximum |
| --- | --- | --- | --- | --- |
| Concurrent duties | 1/2 | 2/2 | 2/2 | 2/2 |
| Adjacent dates/rest pressure | 1/2 | 2/2 | 2/2 | 2/2 |
| Spaced dates/control | 2/2 | 2/2 | 2/2 | 2/2 |
| Locked to Unit I | 1/2 | 1/2 | 1/2 | 1/2 |

All cases saved zero assignments. Exhaustive conflict preparation took
0.144–0.649 seconds per case; joint solves 0.006–0.602 seconds; iterative
aggregate solves 0.008–0.044 seconds. These uncontrolled tiny timings exclude
fixture/context construction and are not evidence of a runtime winner. The
locked case's joint solve was slower than its repair solve. Ruff and scoped
whitespace checks passed. No application runtime source changed in this batch.

Follow-up: an actual current-generator counterexample is now reproduced in
[the dated-scarcity report](n26-current-template-scarcity.md), retaining normal
pressure checks and swaps. It also exposes a one-coordinate repair plateau.
Next enlarge the shared corpus and exact constraints after N05/N06 ratification.
Keep N26 queued and the full original 50-item scope intact until its acceptance
criteria pass.
