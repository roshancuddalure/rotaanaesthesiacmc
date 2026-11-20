# N26: whole-month unit/person comparison, preparatory evidence

20 November 2026. N26 remains Queued behind its recorded N05/N06 acceptance dependencies. No architecture selected or activated.

## What changed

`tools/compare_month_allocation_architectures.py` compares a joint unit/person CP-SAT model with iterative single-coordinate template repair for all 30 November dates. Both use the same canonical candidate eligibility, current duty incompatibility function, joint OT reservation graph and complete final-plan validator. The tool creates fresh in-memory SQLite data and never opens the operational database.

Eight third-call members belong to two units. One required 24-hour logical duty per day can use either unit; 24-hour post-duty rest is retained. Unit IV requires all four members for Thursday OT and two otherwise; Unit V requires two daily. Two people exchange unit postings on November 16, and another has approved November 7–9 leave. These are explicit synthetic configurations, not amendments to departmental policy.

The logical requirement count is **30**, although 60 test slot alternatives are stored. The model allows at most one alternative per logical day; it cannot manufacture coverage by filling both. The supplied starting template alternates units and is **not** output from the production template generator. The earlier actual-generator counterexample remains separate in `n26-current-template-scarcity.md`.

## Observed results

| Scenario / method | Required / covered | Squared member load | Unit IV / V duties | Method wall seconds | Solver calls |
|---|---:|---:|---:|---:|---:|
| Flexible month, joint | 30 / 30 | 114 | 12 / 18 | 0.59 | 1 |
| Flexible month, repair | 30 / 30 | 114 | 11 / 19 | 14.27 | 35 |
| Locked open duty, joint | 30 / 29 | 107 | 15 / 14 | 0.62 | 1 |
| Locked open duty, repair | 30 / 29 | 107 | 11 / 18 | 14.50 | 33 |

The initial prescribed template covered 26 duties in both scenarios. Repair accepted four changes in the flexible month and three in the locked case. In the latter, November 19 remains locked to Unit IV while all four members are required for OT; the duty stays required and empty. Every returned layout preserves the lock and passes complete canonical validation. No proposed assignment was saved.

Coverage attains an independent upper bound of 30 or 29 logical days with any admitted candidate. Squared loads attain the arithmetic lower bound at that coverage: 114 for 30 duties across eight people, 107 for 29. All members are in the same monthly call-level target group, so at fixed coverage the target terms cancel. This proves the stated coverage/equality pair on these fixtures, not all production objectives or all departmental rules independently.

Unit contributions differ despite equally balanced person loads. They are descriptive counts, without opportunity-normalized unit denominators or a new unit-equality objective. Do not choose between the methods by quietly promoting unit equality ahead of the approved person-level priorities. Weekend, night, holiday, spacing/history, preferences, repair stability and unequal-call targets are not compared here.

## Resources and search limits

Both methods receive the same 30-second monotonic allowance for model construction, solver calls and final validation. Common fixture/candidate preparation is recorded separately. No measured method overrun occurred; blocking model construction or validation is not forcibly cancelled at the deadline. Search trace records every attempted neighbor and its proof receipts; evaluating all single-coordinate neighbors is not a general global-optimality proof.

Whole-process working-set sampling requested 100 ms intervals. Flexible joint: 5 observations, maximum 157,429,760 bytes; repair: 114 observations, 165,629,952 bytes. Locked joint: 5 observations, 157,597,696 bytes; repair: 114 observations, 164,605,952 bytes. No sampler errors were recorded. These are observed resident-process maxima including the fixture, native solver and retained prior allocations. They are not continuous peaks, isolated incremental method memory or hardware requirements. Sampling offsets are retained.

These are sequential single runs with joint first, shared canonical caches, random fixture UUIDs and uncontrolled hardware activity. A fixed CP-SAT seed does not remove those effects. The timings cannot establish production speedups or architecture superiority.

## Constraint and maintenance inventory

| Concern | Shared implementation / limitation |
|---|---|
| Dated posting, leave, scope and candidate authority | Canonical candidate context and clear eligible candidates; no overrides. |
| Duty/duty rest conflicts | Existing `incompatible` function applied to all pairs per person. |
| Whole-plan OT and reserves | Existing `add_joint_reservations`, plus final canonical validator. |
| Logical alternatives and locked open duty | Experimental at-most-one day constraint; locked alternatives removed before either method. |
| Monthly hard count limits | Fixture explicitly asserts all unlimited; no silent omission for arbitrary rules. |
| Objective precedence | Mandatory coverage then common-call equality only; lower tiers require integration work. |
| Canonical rejection | Only typed final-plan rejection becomes a no-good cut. Duplicate/scope/write assertions cannot be swallowed as ordinary search cuts. |
| Integration debt | New model orchestration is experimental; production work should reuse a shared model builder and normalize logical requirements before target computation. Test alternative rows must never double production demand. |

The regression gate additionally rejects duplicate logical coverage, changed locked scope and an invalid adjacent-duty pair. An already-expired solve returns no choices and no objective proof. See `n26-month-experiment-regression.xml` for the terminal result.

Verification: native sessions 43711 and 53709 exited zero with complete reports, no assignment writes, and identical 173-file source maps independently rechecked against current files. Native 27068 exited zero: **9 passed in 11.62 seconds**, no failures/errors/skips, including the new experiment invariants and existing joint-reservation regressions. Scoped Ruff and whitespace checks passed. `n26-month-source.json` retains the final source and report hashes. The earlier `n26-month-comparison.json` is a pre-instrumentation prototype observation, not the primary final comparison.

## Remaining decision evidence

Retain N05/N06 ratification, representative real correction baselines, complete approved objectives, opportunity-based unit fairness, preserved commitments and publication rules, more constrained months, repair plateaus, repeated/resource-controlled runs, and rollback/feature-flag integration. This month experiment closes a previous scale gap in preparatory evidence; it does not satisfy all N26 acceptance or authorize N27 production activation. The full 50-item tracker remains authoritative.
