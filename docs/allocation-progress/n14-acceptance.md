# N14 acceptance map

Updated 14 November 2026. This maps the original N14 row to implementation evidence;
it does not replace its acceptance criteria or complete the 50-item plan. N14 is
Done after N04 consumer closure. Evidence counts overlap; protocol tests do not
prove physical GPU speed.

| Prospective path | Current protection | Evidence to inspect |
|---|---|---|
| Ordinary manual/replacement | Mandatory OT and unresolved input block ordinary override; release replaced holders | `test_ot_assignment_integration.py`: manual override, replacement, month-end, missing demand |
| Candidates and legacy autofill | Shared monthly guard; cached context rebuilt under input lock after audit commit | `test_ot_assignment_integration.py`: candidate ranking; `test_ot_snapshot_freshness.py`: cached/uncached autofill; PostgreSQL warm/cold autofill cases |
| Ordinary reviewed scoring | Provisional choices and final apply validation use OT; changed demand invalidates review | `test_ot_reviewed_scoring.py`: server/local_gpu, apply/dry-run/stale demand/idempotency; inspect latest XML before claiming pass |
| Month optimizer/review | Joint duty/reservation variables and independent final proof; partial coverage stays explicit | `test_ot_joint_reservations.py`, `test_ot_assignment_integration.py`: joint optimizer and reviewed intelligent apply |
| Template unit choices/shuffle | Proposed layout capacity before fairness; unknown/infeasible units cannot become forced OT exceptions; shuffle rechecks | `test_ot_template.py`: simultaneous slots, protected duties, unresolved/export, actual shuffle, reviewed server/GPU protocol apply |
| Balance apply | Replacement precheck releases donor; real transfer and post-write verifier retain final authority; OT memo cleared after every accepted transfer | `test_ot_assignment_integration.py`: actual apply/stale demand/undo; `test_ot_balance_cache.py`: different person's skill-dependent alternatives reopen and close |
| Extra-duty apply | Recomputed candidate pools, full final placements and independent verifier | `test_ot_assignment_integration.py`: actual apply, partial coverage, stale demand, idempotency |
| Exchange approval | Standalone shared assignment validator/lock, no retained caller context | `test_ot_assignment_integration.py`: approval rechecks changed calendar and preserves original holder on refusal |
| Superadmin write/undo | Existing published-month authority retained; no implicit OT assignment waiver | `test_ot_assignment_integration.py`: actual write refusal and unsafe undo preview/apply |
| Generation reversal | Complete restored set checked before preview/apply; safe restoration remains idempotent | `test_ot_assignment_integration.py`: unsafe reversal and safe original restoration |
| Recycle restoration | Prospective restoration checked within per-item transaction; archival/elapsed facts separated | `test_ot_assignment_integration.py`: recent duty rollback, archival facts and pending-change preservation |
| Publish | OT checklist evidence; existing explicit attributed superadmin publish override retained | `test_ot_assignment_integration.py`: deficit checklist and attributed publish override |

Tests above are in `backend/tests`. Current source and XML are authoritative;
this table is a navigation aid, not a substitute for executing them. Latest broad
balance/extra-duty run: `ot-balance-cache-regression.xml`, 173 passed in 102.34s.
Ordinary reviewed-scoring run: `ot-reviewed-scoring-final.xml`, 21 passed in
38.86s, including four new server/GPU-protocol safe/stale-demand cases and the
existing scorer regression. This is numeric-frame verification, not execution
on a physical browser GPU.
Real PostgreSQL input ordering evidence remains `ot-postgres-allocation-final.xml`,
29 passed, including committed edits, actual waiting writers, cold bootstrap and
reviewed template apply. Those races predate the pure in-memory memo correction.

Remaining N14 acceptance work:

- Current write-constructor/holder-mutation audit maps normal assignment, compute,
  extra-duty, superadmin and balance to the paths above. Recycle/reversal use
  restoration preflight. Historical writers remain facts; past-duty imports reject
  current/future dates. Ordinary reviewed scoring is tested separately from the
  intelligent month optimizer.
- Actual template presentation is now verified in `ot-template-browser.json`: eight
  cases across 1440px/390px, shortage/unknown/safe/forced-review. Unresolved days
  stay blocked and unallocated, full detail exposes the actual reason, and forced
  review is not rendered ready. No page errors, viewport overflow or assignment
  writes. Build passed; this is not physical GPU or complete permissions evidence.
- N04 dependency is reconciled in `n04-acceptance.md`: versioned projected
  snapshot, relevant edit/no-op/privacy tests, actual apply refusal, coherent
  acquisition and real concurrent writer evidence. Final154specialized/15PG checks
  passed on current consumer source, including ordinary legacy error contracts.
- Keep exception boundaries explicit. Affected existing OT deficits remain
  conservatively blocked, unrelated proven independent deficits are scoped out,
  and unknown demand is never silently discarded. A repair relaxation requires
  separate policy authority; it is not an implied N14 permission.
- Full snapshot/learning invalidation (N04), pressure heatmaps (N13), global unit
  planning architecture/scale benchmarks (N26), permissions/recovery/pilot gates
  retain their original task scope and acceptance requirements.

Closure is limited to the original N14 behavior: effective OT feasibility gates
template eligibility and every mapped normal prospective allocation path; missing
proof stays unresolved, and exception/fact boundaries are enumerated above. The
template uses capacity before its existing fairness ranking; global month-wide
unit/person optimization remains N26/N27. Existing OT flag supports rollback of
the integration and remains disabled by default; disabling it removes OT protection
and must not be described as an equivalent safe allocation policy. Deployment,
policy amendments and later permission/pilot gates remain separately authorized.
