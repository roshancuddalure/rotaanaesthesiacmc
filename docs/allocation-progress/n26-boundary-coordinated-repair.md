# N26: preserved commitments and coordinated month repair

20 November 2026. This extends the isolated unit/person experiment; N26 acceptance and production activation remain open.

## Preserved commitments

The disposable fixture can now preserve three assigned duties: October 31, November 15 and December 1, with each linked to its actual month's rota period. All nearby saved duties overlay the canonical joint OT graph. The November duty is removed from the decision alternatives and counted once in November coverage and member workload. October/December duties constrain availability without entering November's load totals.

Column-level signatures cover assignment identity/person/status and duty identity/unit/date/times/type/24-hour flag. Every candidate result must retain those signatures; a changed saved record raises an invariant failure rather than becoming an ordinary solver cut. The regression deliberately corrupts and rolls back a disposable record to verify this behavior. An expired search with the saved November duty reports one already-covered duty, zero new choices and no optimization proof.

Before comparison, the complete saved baseline must pass the canonical whole-context OT check. Combining the saved October duty with an all-staff November 1 OT requirement creates an existing shortage and is rejected. This is a benchmark completeness condition; the application's separately scoped edit-validation policy is unchanged.

## A month-wide repair plateau

A synthetic dated duty group admits only one person per unit on November 1–2, expanding to all eight members from November 3. Unit IV needs all four people for November 1 OT, so its first-day duty alternative is unavailable. The prescribed first two unit choices are IV then V.

Moving only the first duty to V leaves two adjacent duties competing for the same person and rest window. Moving only the second duty to IV still leaves the first duty unavailable. Moving both—to V then IV—covers both. The other 28 required dates remain in the same month model, with the existing Thursday OT pressure, leave and posting exchange.

A focused regression first repairs the unrelated Thursday-pressure choices, then solves four complete monthly layouts: original, first-coordinate change, second-coordinate change, and the pair. Their proven coverage is 29, 29, 29 and 30; squared member loads are 107 at coverage 29 and 114 at coverage 30. The comparison is lexicographic: the lower raw square at lower coverage does not make 29 duties preferable to 30.

## Search-order defect found and addressed

The initial coordinated method exhausted every single-coordinate neighbor before considering pairs. In the final global-baseline revision's 30-second development run, joint planning covered 30, while both repair methods retained 29 after their budgets expired. Actual overruns were 0.13 seconds for single repair and 0.38 seconds for coordinated repair; blocking work is not hard-cancelled. The historical `n26-month-plateau-final.json` retains this limitation rather than being overwritten.

The coordinated method now prioritizes pairs when an unfilled duty's alternative shares candidate identities and an incompatible duty/rest window with another duty. It uses canonical candidates and incompatibility, with no fixture dates or expected answers embedded in the heuristic. Ordinary single moves and remaining pairs follow; duplicates, locked days and preserved days are excluded. Every proposed layout still uses the same model, complete final check, strict coverage/equality improvement and original 30-second allowance. The regression verifies that the actual scarce-candidate case prioritizes the necessary pair.

This is development against a known counterexample, not an unseen quality study. Remaining work includes full approved objective tiers, representative constraints, opportunity-based unit fairness, calibrated resources and architecture selection under N05/N06. The original 50-item scope remains intact.

## Verified priority revision

`n26-prioritized-repair-tests.xml`: **12 passed in 64.92 seconds**, zero failures/errors/skips, native session 44964 exit zero. The suite includes the original invariants, exact saved-commitment/rollback checks, the four-layout plateau proof, prioritized-pair uniqueness and rejection of an infeasible saved OT baseline. Scoped Ruff and whitespace checks passed.

The fresh 30-second-per-method study, `n26-month-plateau-prioritized.json`, completed with current source hashes unchanged, native session 74612 exit zero:

| Method | Covered / required | Squared member load | Method wall seconds | Solver calls |
|---|---:|---:|---:|---:|
| Joint | 30 / 30 | 114 | 2.66 | 1 |
| Single-coordinate repair | 29 / 30 | 107 | 30.22 | 25 |
| Candidate/rest-prioritized paired repair | 30 / 30 | 114 | 12.36 | 8 |

The single-coordinate method retained its safe incumbent at budget exhaustion, with a measured 0.22-second overrun. Paired repair accepted five changes and reached both the independent coverage upper bound and arithmetic workload lower bound. The trace includes the necessary November 1–2 pair, selected through shared candidate/rest competition; later pairs address other pressure dates. All saved baselines were globally OT-feasible and no proposed assignments were written.

Requested memory sampling was every 100 ms. Plateau joint: 23 observations, maximum whole-process working set 160,157,696 bytes; single repair: 236 observations, 166,744,064 bytes; paired repair: 81 observations, 167,825,408 bytes. No sampler errors occurred. These are observed process-resident maxima including native solver, fixture and retained allocations, not continuous peaks or minimum hardware requirements.

Runs use fixed method order, random fixture UUIDs, shared canonical caches and uncontrolled machine activity. The earlier boundary measurement also overlapped a test worker. Timing changes across revisions do not isolate a causal speedup; the observed safe coverage and budget outcomes are the supported conclusions. Earlier pre-priority/pre-baseline artifacts are retained under their own hashes and are not recertified as this revision.

The same-revision preserved-boundary rerun (`n26-month-boundary-prioritized.json`, native 85969 exit zero) also passed: both methods covered all 30 November requirements with 29 new choices and the one saved November duty, squared load 114, and all three saved signatures unchanged. Joint used one call/3.59 seconds; repair used five calls/11.43 seconds. There was no measured budget overrun. Whole-process sampling observed maxima of 160,378,880 bytes over 29 observations and 162,807,808 bytes over 91 observations, respectively.

The two current reports are complete, share identical 173-file source maps and were independently rechecked against current files. The final source/report checkpoint is `n26-prioritized-repair-source.json`. All 171 production application source hashes also match the preceding checkpoint: the changes are isolated experiment/test work, with no production framework or policy change. All benchmark and test sessions are terminal; only the progress dashboard remains intended to run.
