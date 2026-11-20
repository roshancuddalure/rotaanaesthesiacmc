# N24 leave approval and allocation transaction checks

N24 remains in progress. This document records the transaction changes and their verification; it does not certify the repair workflow or administrator interface.

## Changes

Monthly leave review now acquires the existing scheduling-input lock after the operational namespace lock. Approval calls this same review under its transaction and holds the lock through status/audit changes and commit. Clean cached input attributes are refreshed under the lock; uncommitted caller edits retain the established `lock_inputs` behavior. Manual/profile leave review follows the same namespace-then-input order.

Direct manual assignment now acquires its namespace and final scheduling-input lock whenever it owns its context, including when the OT feature is disabled. This protects canonical leave checks as well as OT checks. Callers supplying a planning context still own its transaction and lock lifetime.

Autofill acquires its namespace and final input lock after its existing audit-run bootstrap commit. It reloads the draft period and slots before building its cached planning context. The period must still be draft. This lock is now acquired with OT disabled too. No bootstrap commit is moved inside the final locked allocation section.

Reviewed compute already acquires the shared normalization namespace and final input locks. These changes reuse the existing transaction model and preserve explicit exception policy; they do not add an allocation engine or alter leave eligibility.

## Intended PostgreSQL evidence

The new `test_leave_allocation_concurrency.py` uses the guarded disposable PostgreSQL fixture. It observes actual `pg_blocking_pids` relationships before allowing the holder to commit. Both reviewed-compute/approval commit orders are exercised: the waiting operation must reject its stale reviewed context. Manual assignment and autofill wait for an approval with OT disabled, then validate against approved leave. A noncooperating external edit must block approval's input lock; after that edit commits, a previously loaded leave record must refresh and the old review must be rejected without an approval audit.

The runner creates a new loopback database, tests migration forward/backward/forward with a preservation sentinel, and drops only that generated database in cleanup. This is isolated verification, not an operational migration.

Results must be recorded from terminal processes and JUnit artifacts. A running process, source inspection, or observed wait alone does not prove that all race outcomes passed.

The focused backend suite passed 62 tests in 109.16 seconds (`n24-lock-backend.xml`). Ruff and scoped whitespace checks passed. The first PostgreSQL run (`n24-lock-postgres-first.xml`) passed 17 tests and failed one autofill fixture expectation: after approval, the fixture met existing staffing safety thresholds. Autofill correctly saved zero assignments. Adding one reserve still left two of five identities unavailable (40%, the existing hard threshold). The fixture now has eight eligible identities and two absences (25%, below the existing 30% warning threshold). A focused SQLite reproduction confirms one safe assignment; all staffing thresholds remain unchanged. The revised test also observes autofill's backend PID at its final namespace request, after the audit bootstrap can return a connection to the pool. The expanded PostgreSQL run passed 33 of 34 tests, including all 16 existing OT-enabled/cold-bootstrap cases; its only failure was that same undersized fixture. The final verification run with the corrected eight-person fixture passed all 18 tests in 66.12 seconds, zero failures/errors/skips (`n24-lock-postgres-verified.xml`). Session27435 exited0 after guarded database cleanup. Migration forward/backward/forward and preservation-sentinel checks therefore also completed. Final hashes/results are recorded in `n24-lock-source.json`. Counts overlap and are not additive.

## Remaining scope

Reviewed repair linkage, administrator OT/protected-impact presentation and interaction checks, import consistency and broader final integration remain incomplete. This focused transaction gate does not establish completion of all 50 items or all allocation entry paths. The full inventory and later global integration gates remain authoritative.


## Next repair integration boundary

Source review confirms that `rota_intelligence.start` already supports explicit `repair_slots`, `locked_slots`, originals, proposal revisions and final application validation. Its advance step also considers unfilled slots unless locked. A leave-scoped repair adapter must therefore lock all nonselected slots, not merely pass the affected repair slots, to avoid expanding a leave repair into whole-month autofill. Recompute affected assignments from canonical approved records after approval, retain protected/non-draft impacts for authorized resolution, and bind the explicit selected scope to a stable review token. Bootstrap before the final token check and reuse existing proposal/apply endpoints; do not create another generator. This source review is not implementation or acceptance evidence for that adapter.
