# Actual template generator: dated-scarcity counterexample

The current sequential template can prevent full person coverage even when a
different unit layout covers the exact same duties safely. This is a synthetic
counterexample, not a departmental failure rate or architecture selection.

## Reproduction

`tools/probe_template_scarcity.py` uses a fresh in-memory SQLite database, normal
saved default rules, locked scope, normal generator selection and layout swaps,
and the existing `solve_month` person optimizer. No selector injection or
application monkeypatch changes the generation. OT is disabled explicitly.

Units A and B each have three active first-call people. Required duties are
MAIN_1ST_24HR on 4 and 5 May 2026. All Unit B members have approved full-day leave
on 5 May; both units are available on 4 May. No saved duties are present.

The generator chose **A then B**. The first slot has the existing 33% template
pressure warning. The second is a forced review slot: all candidate units were
hard blocked by template pressure, and the existing forced selection chose B.
The recorded summary reports two created slots, one forced-review slot and
**zero vertical-shuffle swaps**. The existing person optimizer safely fills only
one duty; an exhaustive canonical check proves the fixed layout cannot fill two.

Joint unit/person selection chooses **B then A** and fills both duties. Every
person assignment passes the same canonical final-plan validator. Duties, times,
scope, call levels, leave, and rule thresholds are identical. No assignments are
saved. The template's conservative prospective pressure counts differ from the
canonical assignment check; this experiment does not amend either policy or
declare their existing difference an unauthorized safety exception.

## Consequence for repair design

| Unit layout, first day / second day | Maximum safe coverage |
| --- | --- |
| A / A | 1 of 2 |
| A / B (actual generator) | 1 of 2 |
| B / A | 2 of 2 |
| B / B | 1 of 2 |

A repair loop which changes only one unit and accepts only a strict coverage
gain cannot escape A/B. A coordinated two-slot swap can reach B/A. Therefore the
earlier successful one-change repairs do not establish sufficient neighborhood
search for the full problem. Compare joint modeling against a repair loop with
coordinated moves or bounded plateau exploration, explicit termination and the
same complete final safety checks. A coordinated repair result also prevents
using this example alone to claim that only joint CP-SAT can solve the problem.

## Evidence and remaining scope

Initial actual-generator run session63434 exited0; its report
`n26-current-template-scarcity.json` records complete/source-unchanged at that
revision, 49 exhaustive partial/full allocations, fixed1, joint2, one-move1,
all final checks clear, zero saved assignments. A subsequent harness revision
adds the full layout matrix and coordinated-swap assertions; its separate
artifact is `n26-current-template-scarcity-final.json`. Partial output or a live
process is not a passing result.

Final session **68943 exited0**: complete/source-unchanged true; all four exact
layout coverages match the table, coordinated swap covers2/2, joint covers2/2,
existing optimizer/fixed exact/one-coordinate repair cover1/2. All returned
plans pass final checks and saved assignments remain0. Source hashes were
rechecked after completion; Ruff and scoped whitespace checks passed. No
application runtime source changed, so no new application build, browser or
PostgreSQL-concurrency acceptance is claimed for this verification-only batch.

N26 remains queued preparatory work while N05/N06 are unresolved. Final selection
still needs ratified objective precedence and metrics, representative months,
OT/qualification/reserve/pooled/fixed-boundary cases, equal end-to-end budgets,
memory measurements, maintainability assessment and rollback design. The small
oracle shares the canonical safety validator; an independent safety oracle and
the broader N35 proof remain required. No production behavior changes here.
