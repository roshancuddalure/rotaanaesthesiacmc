# N05/N26: shared objective expressions and scoring

20 November 2026. N05 remains In progress and N26's architecture decision remains open.

## Implementation

`allocation_objective_model.py` now constructs the existing objective expressions and exact incumbent-quality vector. The production `solve_month` calls this helper; its eligibility, safety constraints, greedy seed, independent lower bounds, staged search, final validator and public interface remain in place.

The expression statements and nested scoring function were moved verbatim, except that canonical targets are fetched by the caller and passed in. Existing objective order, rounding, fixed-duty treatment, monthly target membership, preference modes and objective revision 2 are preserved. `n05-optimizer-before-shared.py.txt` archives the actual previous file; `n05-objective-extraction.json` records byte/text hashes and normalized expression/function provenance. Structural comparison supports the extraction claim; runtime tests provide separate behavioral evidence.

The helper covers required coverage, coverage, optional repair stability, preferences in their existing mode-dependent position, call-level equality, weekend/night/holiday burdens, workload and spacing/history. It performs no database reads or policy selection.

## Comparison integration

The month experiment's explicit `--full-objectives` mode uses this same balanced-mode builder. Its fixture has eight members sharing 30 logical requirements, so the target is 3.75. Sixty physical alternative rows must not double demand. All methods retain one common eligible-candidate universe; fixing a unit layout sets unwanted variables to zero rather than deleting rows and changing workload opportunity denominators.

Repair now compares complete shared quality vectors in this mode. Reaching the coverage/equality arithmetic bounds alone cannot stop the search as though later tiers were proved. Complete canonical validation and exact saved-commitment checks still apply to every accepted plan. The fixture declares two synthetic holiday dates; it has no preference costs or requested replacements, so those branches are exercised by production/arithmetic tests rather than this one month.

## Verification

- Before extraction: 14 objective precedence, burden and saved-basis tests passed in 26.46 seconds.
- Initial production regression after extraction: 69 passed in 40.94 seconds.
- Independent arithmetic audit: four parametrized tests enumerate 108 selections, covering balanced/preferences modes with/without originals. Closed-form equality and explicit cumulative burden tables match every CP expression and incumbent score; four passed in 3.81 seconds. This is scoring verification, not clinical feasibility proof.
- Broad final gate: `n05-shared-objectives-final.xml`, **94 passed in 75.81 seconds**, no failures/errors/skips. It includes real optimizer/review/export, OT, saved commitments, complete-month/date/skill oracles and experiment invariants. Nine existing pytest warnings concern recorded properties with xunit2 XML; they are retained in the log.
- Additional universe test: `n26-full-objective-universe.xml`, **one passed in 5.56 seconds**, verifies logical target 3.75, unchanged candidate sets across layouts, nine balanced tiers and no false optimality shortcut from only coverage/equality bounds.

These suites overlap; do not add earlier gate totals. Scoped Ruff and whitespace checks are recorded with the checkpoint. No operational allocation, schema, UI, cloud routing, model installation or deployment changed.

## Limits and next work

Full-tier month results retain per-tier proof receipts. A later tier proved after an unproved earlier incumbent is conditional on those fixed earlier values; it does not establish a globally optimal lexicographic plan. The method wall allowance includes model construction and validation, whose blocking calls can overrun slightly.

The experiment still needs representative scenarios, unequal call pools, configured hard count limits, nonzero preferences and requested repair changes, opportunity-based unit fairness, calibrated resource/method-order measurements and N05/N06 acceptance evidence. No architecture was selected and no N27 planning path was activated. The full 50-item tracker remains authoritative.

## Full-tier month observation

`n26-full-objectives-boundary-final.json`, native session 67919 exit zero, is complete with all 174 recorded source hashes independently checked unchanged. Both methods covered **30 November duties: 29 new choices plus one fixed duty**, with squared member load 114. All three October/November/December saved signatures remained unchanged; no proposed assignment was written.

| Method | Wall seconds / allowance | Solver calls | Weekend score | Spacing/history score | Unproved or unreached tiers |
|---|---:|---:|---:|---:|---|
| Joint | 26.33 / 30 | 1 | 39 | 87 | Weekend; spacing/history |
| Repair | 30.10 / 30 | 6 | 39 | 107 | Spacing/history; preferences not reached |

The joint quality vector is `[-29, -29, -10450, 39, 465, 6, 465, 87, 0]`; repair differs in spacing/history, at 107. The first two entries count new choices; the fixed duty is included separately in total coverage and monthly load. Every reached model receipt matches the shared scorer at the corresponding position. Neither method proves all objectives; later conditional receipts must not be promoted into a global lexicographic guarantee.

Joint had no measured overrun; repair overran by 0.10 seconds in blocking work. Requested 100 ms whole-process memory sampling yielded 238 observations/max 173,047,808 bytes for joint and 249/max 184,639,488 bytes for repair, with no errors. These include native solver, common fixture and retained allocations; they are sampled observations, not continuous peaks or incremental hardware requirements. Fixed method order, random fixture UUIDs, shared caches and uncontrolled machine activity prevent causal performance claims.

The preceding `n26-full-objectives-boundary.json` remains a preliminary observation with an overly narrow legacy top-level scope label; its explicit full-mode flag and tier list identified the actual nine-tier run. The final artifact corrects that label without changing scoring logic. `n05-shared-objectives-final-source.json` records the final source and evidence hashes.
