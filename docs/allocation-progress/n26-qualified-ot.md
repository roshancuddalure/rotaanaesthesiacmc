# Qualified pools and dated-window architecture comparison

Five bounded experiments now compare the existing joint OT reservation model
with coordinated unit-layout repair under an independent identity-matching
oracle. They change no production scheduler, database, fairness priority or
departmental policy. This is N26 preparatory evidence, not architecture selection.

## Fixture and independent proof

Two units have six people split across third/fourth call. Three short coincident
duties explicitly permit that call pool. Three full OT bands need distinct
identities: Unit A cardiac skill with third/fourth-call pool, Unit A general
third/fourth-call role, and Unit B third-call role. In the dated-window variants,
one cardiac member's window ends at noon; it covers the9–11 duty but not the
8–16 OT band. Another member is the sole full-band cardiac candidate.

The independent oracle explicitly enumerates injective assignments of residual
people to the declared OT roles. It uses fixture role lists, not canonical
eligibility/interval/graph helpers. Duty people cannot overlap, fixed people
are removed from choices and residual staffing, and a locked unfilled duty has
no decision variables.866 distinct-person partial/full duty sets are compared
with the canonical final OT guard. This independently verifies role matching
for the stated whole-band/single-window fixture; it does not independently prove
general departmental leave/rest/posting or overlapping interval semantics.

Joint CP-SAT uses `add_joint_reservations` directly. Coordinated repair explores
single/two-coordinate unit changes with the same model and strict coverage
improvement. Every returned layout passes the independent oracle and final guard.
The original layout stamps all duties Unit A; it is not a reproduction of the
current production generator. The earlier actual-generator counterexample remains
separate evidence in `n26-current-template-scarcity.md`.

## Verified coverage

| Scenario | Original unit layout | Joint | Repair | Independent maximum |
| --- | --- | --- | --- | --- |
| Pooled calls and cardiac skill |2|3|3|3|
| Partial cardiac qualification window |2|3|3|3|
| Reversed people/variable input order |2|3|3|3|
| Preserved fixed person/duty |1 new|2 new|2 new|2 new|
| Locked unfilled logical duty |2|2|2|2|

The partial-window cases preserve the only full-band cardiac person for OT and
can use the short-window member on a short duty. Reversing input order preserves
safe maximum coverage, not identical identities: equally feasible solutions may
differ, and no fairness tie-break was introduced. The fixed person is excluded
from new choices; the locked open duty remains empty rather than disappearing
from the requirement count.

Native session35966 exited0: `n26-qualified-ot-comparison.json` complete and
source-unchanged, all source hashes independently rechecked. Ruff passed.
Qualified/availability/joint regression has separate terminal evidence in
`n26-qualified-ot-regression.xml`: session43682 exited0,28passed87.39s.
Final source hashes are recorded in `n26-qualified-source.json`; scoped whitespace
checks passed. No browser/build/operational database gate is claimed for this
pure experimental tool and unchanged runtime services.

## Remaining evidence

These are tiny pure OT-reservation components, not month-wide canonical duty
eligibility validation. No operational write, actual GPU run or full workflow
speed measurement occurred. Fairness and peak memory remain unmeasured; neither
is implied zero. A coverage tie on these fixtures does not choose joint modeling
over repair, nor establish that strict-improvement repair escapes all plateaus.

N26 still needs representative months, actual duty rules/dated postings/leave,
included/additional reserves, boundary commitments, equal resource budgets,
maintainability and ratified N05/N06 objective/acceptance criteria. N35 keeps its
independent whole-rule oracle scope. N27 is not activated by this experiment;
the original50-item goal and separate policy/deployment gates remain intact.
