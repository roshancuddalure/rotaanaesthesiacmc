# N24 reviewed leave repair adapter

N24 remains in progress. This checkpoint connects canonical approved leave to the existing reviewed intelligence engine. Administrator interface/browser acceptance, OT-only repair scope and import consistency remain unfinished.

## Contract

Administrators can request `/api/v1/leave/repair-preview` with one month, up to 100 distinct canonical leave IDs, explicit repair slot IDs and explicit locked slot IDs. Every selected leave record must currently be approved. Unknown IDs, duplicate identities, pending/cancelled records, unaffected slots and overlapping repair/lock selections are rejected. Preview uses the shared namespace/input locks and writes no proposal or operational assignment.

The review includes all selected leaves' affected duties, even those outside the selected month, but eligible repair slots must belong to its unambiguous draft period and existing generation scope, use the reviewed template source, have exactly one active assignment and remain unlocked. Published/non-draft or ambiguous periods are not offered as repair scope. A generation-scope configuration lock is not reinterpreted as an assignment lock.

The review token binds actor, leave identities, month, explicit selection and locks, affected assignments, scheduling snapshot and planning feature availability. `/api/v1/leave/repair-proposal` requires that token and an explicit nonempty repair selection. It rechecks current evidence under locks, obeys existing compute/intelligence flags and start limits, and calls the existing `rota_intelligence.start` in server repair mode. Normal setup/rules bootstrap precedes the final token check; changed setup requires a fresh review.

Every nonselected slot is passed to the engine as locked, including empty slots. This prevents a leave-scoped repair from becoming whole-month autofill. The existing job stores leave-repair provenance in the same transaction as its original-assignment evidence. No assignment changes while previewing, creating, computing or validating the proposal. Existing job revision, owner, final validation and explicit apply endpoints remain authoritative.

## Unresolved repair protection

Inspection identified that the old compute apply path could classify an original as replaced when its decision had no replacement person. Apply now rejects a proposal containing any selected original without a reviewed replacement, before operational changes, for both validate and apply. Original assignments remain active. Replacement processing iterates actual person proposals only; unresolved decisions are not counted as successful changes. This applies to existing repair jobs too, not only the new leave adapter.

## Evidence

Initial adapter/intelligence suite: 24 passed in 22.55 seconds (`n24-repair-first.xml`). Expanded runtime regression including compute, leave review and unresolved protection: 62 passed in 38.28 seconds (`n24-repair-final.xml`). A refined suite additionally exercises the actual authenticated proposal/step/validate/apply HTTP sequence. Real disposable PostgreSQL tests exercise leave-scoped double application and preservation of an unresolved original. The refined HTTP/engine suite passed 63 tests in 41.90 seconds (`n24-repair-acceptance.xml`). PostgreSQL passed 15 tests in 51.52 seconds (`n24-repair-postgres.xml`), including both new leave-scoped tests; runner40013 exited0 after migration/sentinel checks and guarded database cleanup. Both artifacts have zero failures/errors/skips. Final hashes are in `n24-repair-source.json`. These suites overlap and counts are not additive. Ruff and scoped whitespace checks passed.

## Remaining N24 work

Build the administrator workflow for OT evidence, protected impacts, explicit repair/lock selection, stale-review recovery and existing job review/application; verify actual desktop/mobile/keyboard behavior. Address OT-only shortages whose repair requires freeing a different person's duty, without expanding scope or assuming leave grants cancellation authority. Complete canonical import-impact consistency. Earlier approval/allocation PostgreSQL gates remain separate evidence, not proof of these remaining interactions.

No production deployment, operational migration, new model, external data route or clinical policy amendment is performed by this adapter.
