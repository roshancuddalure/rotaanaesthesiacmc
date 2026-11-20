# Higher-order OT architecture comparison

The isolated experiment extends the earlier two-duty examples to three
simultaneous duties, using the existing `add_joint_reservations` component
directly. No application scheduler, database record, objective priority or
departmental rule changes. N26 remains preparatory pending N05/N06 and the full
representative architecture comparison.

## Shared constraints and independent oracle

Unit A has four qualified people and mandatory OT minimum2; Unit B has two
qualified people and mandatory minimum1. Three logical two-hour duties overlap
the OT bands completely. Everyone is initially available and equally qualified
within their unit. Each duty needs one distinct person. There are no leave,
posting, skill, group, temporal handover or rest differences in this deliberately
bounded case. The fixed-duty scenario reserves one Unit A person for a saved
duty throughout the same interval; the fixed duty is never a decision variable.

Under exactly these assumptions, an independent arithmetic oracle is sufficient:
selected distinct duty people per unit cannot exceed roster count minus fixed
duty count minus OT minimum. The tool enumerates all partial/full duty choices,
rejects duplicate people on coincident duties, and compares that arithmetic with
the canonical final OT guard. It does not call canonical interval/graph helpers
to calculate the independent capacity bound. This is not an independent oracle
for arbitrary departmental policy or a month-wide constraint implementation.

Joint CP-SAT uses the actual reservation adapter, with caller-owned per-duty and
per-person constraints. Repair starts with all duties stamped Unit A and explores
one- and two-unit-coordinate moves, accepting strict coverage improvements. Every
layout solve uses the same reservation model. Locks constrain every algorithm.
All accepted results must match the exhaustive allowed-layout maximum and pass
the final canonical guard. Nothing is committed.

## Initial measured result

| Scenario | Original A/A/A layout | Joint | Coordinated repair | Exact maximum |
| --- | --- | --- | --- | --- |
| Flexible unit choices |2|3|3|3|
| All unit choices locked to A |2|2|2|2|
| One preserved fixed duty in A |1 new|2 new|2 new|2 new|

Across the three scenarios,902 sequences are enumerated, including duplicate
person rejections;594 distinct-person sets receive canonical guard checks and
must agree with the independent oracle. Duties are identities, not interchangeable
coverage totals. A lock does not disappear just because another layout is feasible.

The pairwise-only negative control selects three A duties in the first two
scenarios. Every selected pair can leave two A people for OT, but all three
together leave only one. The full OT guard rejects those triples. Pairwise cuts
are therefore not a sufficient replacement for higher-order reservations or
complete final-set checking. The negative-control output is explicitly rejected
for use; it is not reported as a safe three-duty solution. With a fixed duty,
pairwise cuts happen to suffice on this small scenario, which does not generalize.

Initial native session97003 exited0; `n26-joint-ot-comparison.json` complete and
source-unchanged, source hashes independently verified before cleanup. Ruff found
one unused import; removed without changing the experiment. Final run writes
`n26-joint-ot-comparison-final.json` and must be checked for terminal acceptance.
Existing OT joint/guard regression has separate XML/log evidence.

Final session7498 exited0: final artifact complete/source-unchanged, all source
hashes independently rechecked. Outcomes match the table and all accepted final
checks pass. Regression6694 exited0:18passed73.01s in
`n26-joint-ot-regression.xml`; no new runtime scheduler change required.
Ruff/scoped whitespace passed. Joint solve times16.8–22.4ms and repair aggregate
21.8–389.8ms on this uncontrolled tiny run are not scalable timing estimates.
Repair used13 solves on the two flexible cases and1 on the locked case.

## Decision limits

Both approaches recover the maximum here. This does not choose a winner:
repair uses more model solves and can still encounter plateaus, whereas a larger
joint model may increase encoding/search costs. Per-case timings include tiny
model construction/solves and shared oracle preparation is recorded separately;
uncontrolled timings are not a production speed comparison. Peak memory and
fairness are unmeasured/null, not zero.

Next compare actual month requirements with dated eligibility, heterogeneous
skills, overlapping pools, included/additional reserves, fixed boundary duties,
locked unfilled slots, resource limits, explicit feasible/optimal bounds and
ratified objective precedence. Preserve the current real-template scarcity
counterexample and two-slot repair success. A three-duty OT component proof does
not fulfill N26/N27/N35 or justify new GPU kernels. Full original50 scope remains.
