# N17 scarcity and temporal acceptance corpus

Original action covers all units busy, no eligible senior, overlapping areas,
staffing above roster, closure, leap day, partial shift and month boundary.
Shortages and safe alternatives must be asserted; no forced template may be
mislabeled safe, and no mandatory minimum silently reduced.

New `backend/tests/test_ot_scarcity_corpus.py` provides six named scenarios:

| Scenario | Shortage and alternative evidence |
|---|---|
| All units busy | Two units each have4seniors and require4 for OT. Duty remains null-unit/unresolved/not forced. Explicit reviewed fixture change to3OT in only the second unit makes only that unit ready. Calendar content/revisions remain unchanged by generation in both runs |
| No eligible senior | All4people/postings have1st-call;3rd-call OT/duty cannot be supplied. Unresolved/not forced; calendar revision retained |
| Demand above roster |4people cannot cover minimum5; template stays unresolved, never silently reduces demand |
| Overlapping areas | Two simultaneous area minima2+2consume4identities and prevent a duty. Changing only explicit band arrangement to adjacent halves preserves both minima2 and makes a duty feasible/ready |
| Leap day, closure, month rest | Actual29Feb2028 duty remains blocked even with that date's OT closed, because1March still requires4 and its duty/rest removes one. Ordinary manual override cannot bypass; no assignment saved. Explicitly reviewed1March closure allows a real normal assignment, verified independently across the February month |
| Partial shift | ApprovedAM leave for all4people blocks the full08–16OT band; explicit12–16band has4compatible people. Both demand minima remain4, with no unapproved handover or partial-day waiver |

Synthetic staffing thresholds are explicitly relaxed only to isolate OT behavior
in disposable fixtures. They do not change departmental policy, operational rules
or the planning priority order. Alternative inputs are deliberately changed by the
test administrator; the generator is then checked not to amend them itself.

Complementary existing tests are run with this corpus, not assumed from source:

- `test_ot_capacity.py` includes pooled senior overlap, adjacent roles, whole-band
  availability, exact boundaries, closure/zero/unknown and25independently enumerated
  small matching scenarios with order/metamorphic checks.
- `test_ot_reserves.py` includes included/additional reserves, distinct cross-unit
  identities, approved reserve handover, independent witness verification and
  exhaustive identity-booking oracles.
- `test_ot_availability.py` exercises dated calls/transfers, actual partial leave,
  simultaneous duty/rest and previous-month duties.
- `test_ot_template.py` protects reserved people, saved duties, reviewed CPU/GPU
  numeric replay, shuffle and unknown/shortage outcomes. Reviewed-zero legacy
  forced behavior remains visibly needs-review, never a claim of OT-safe supply.
- `test_ot_assignment_integration.py` and `test_ot_joint_reservations.py` test
  combined duty/reservation choices, future rest, overrides, scoped existing
  deficits, restoration and actual apply boundaries.

The new corpus changes tests only; no production runtime or policy is adjusted.
The initial six-case run passed17.81s. Final `n17-corpus-regression.xml` passed131checks43.01s after adding the
actual leap-day assignment/independent verification. Zero failures/errors/skips.
N17 is Done against its original row; runtime source hashes match the batch-start
snapshot. Counts overlap existing evidence and must not be summed as unique.

This corpus proves the named bounded fixtures and specified invariants. It does
not prove all departmental months feasible, global month-wide unit optimization,
performance targets, or real administrator correction rate. Those stay in N02,
N05/N06, N26 and later acceptance/pilot work. No production migration or deployment
is performed. Existing OT gating stays disabled by default until rollout gates.
