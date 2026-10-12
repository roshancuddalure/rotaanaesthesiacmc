# 250-action implementation goal

User approval: implement and test all 250 actions in prioritized order, 13 October 2026. The goal remains active until the full backlog is implemented and tested. The CSV is the per-item source of truth; completed means the acceptance criterion has been implemented and verified, not merely planned.

## Batch 1 — authentication and destructive-data protection

Implemented A001–A010, A019, A051, A052, A111–A113 and A142. This closes all nine P0 items from the audit.

- Legacy member reads require authentication and all twelve mutation routes require admin rights. Mappings and historical administrative status require admin rights; analysis requires authentication.
- Public bootstrap is removed. The legacy historical rebuild now returns 410 and directs users to the reviewed Past Duties workflow; its old UI button is removed.
- Public forgot-password exposes no token and gives the same instructions for known/unknown accounts. Authorized administrators can issue an identity-verified recovery code from Accounts. A computer-admin cannot recover or create a superadmin account.
- Account creation, password reset and change use the same 8–128-character policy. Reset invalidates existing sessions and unused recovery tokens; newly issued codes invalidate older codes.
- Mapping fields, Accounts fields and Diagnostics JSON render stored markup as text.
- Manual and imported member names, call levels and statuses use shared validation. Duplicate creation returns a conflict without mutating the existing person. Explicit Restore now supports historical/inactive as well as archived people.
- Unit imports default to add mode. Replacement rejects uploads with no safe assignment and trims/splits month-intersecting postings instead of deleting historical/future portions.
- Locked scopes reject membership or safety-setting changes unless explicitly unlocked with a reason.

Validation:

- Backend full suite: **222 passed** after the initial fixes (83.04 seconds).
- Frontend existing controller suite: **4 passed**.
- Frontend TypeScript/Vite production build: passed.
- Browser checks: **11 passed**, covering stored-markup rendering, role-dependent recovery/creation controls, safe import defaults and public recovery fields at desktop/phone sizes.
- First focused run identified a test still expecting historical reactivation through Create; the explicit Restore behavior and regression were corrected before the successful full run.

No deployment or real-database write was performed. Tests use in-memory SQLite; browser checks use the disposable synthetic audit backend. No schema migration was required for this batch.

## Batch 2 — import commit protection and synchronization

Completed A083 with bounded leave/unit upload reads; **100 focused backend tests passed**, including oversized inputs and posting boundary cases.

Completed A031/A032/A041/A087/A161: deployment-appropriate network messages, structured field-validation errors, shared mutation notifications and cross-tab cache invalidation, fresh Overview analysis, and fresh Eligibility Group rosters. Units and Mappings also refresh on navigation. **Seven frontend tests and the production build pass**; a synthetic browser flow verified new member visibility in Eligibility Groups and fresh requests for Units, members and Overview.

Completed A081: reviewed-state hashes bind the source file, options and relevant master-data snapshot. Missing review is rejected; changed state returns 409. Tests explicitly check stale files, master changes and replacement-option changes. Validation: 70 focused leave/unit/security tests, 69 cross-path import/security tests, and a browser flow that committed reviewed imports and rejected a changed source.

Completed A082/A085/A086/A089:

- All four upload pathways persist replay fingerprints and return the original batch result on a retry. Replays do not emit another frontend data-change event.
- Leave and unit records and their source-row ledger commit together; an injected audit failure rolled back the leave records too. Historical batch APIs provide actor, month, counts, paginated source rows and rejected-row CSVs. Leave and Unit screens expose this history and drilldown.
- Member/past preview hashes also bind filenames and source bytes, so distinct unchanged files can be independently reviewed and recorded.
- Every preview pathway offers rejected-row downloads before applying. Downloads preserve source row numbers and errors; spreadsheet formula cells are protected.
- All import commits acquire the same PostgreSQL transaction lock before revalidation/replay lookup. Real concurrency checks used a new PostgreSQL cluster under `tmp/ui_audit/pg_cluster`, loopback port 5543, database `duty_rota_test_imports`, and fresh per-test schemas. This cluster is separate from the real local and Railway databases. Simultaneous same-key retries produced one batch/record; conflicting reviews produced one successful commit and one HTTP 409.

Validation: 106 import/security tests, 73 updated cross-path tests, 37 focused ledger/security tests, **two real PostgreSQL concurrency tests**, eight frontend tests, production build, browser history/replay/drilldown checks, and browser rejected-preview downloads in all four pathways. A browser check caught a missing Past Duties action allowlist entry; it was fixed and covered by a controller regression before completion.

Current milestone: **28/250 completed and tested; 222 approved and queued.** The goal remains active. Shared request and workbook safeguards, permission matrix, concurrency checks for ordinary edits and remaining phase-one items come next.

Integrated checkpoint: **239 backend tests passed**, with the disposable PostgreSQL concurrency tests enabled (103.65 seconds); **eight frontend tests passed** and the production build passed. No real database or deployment was changed.

## Remaining scope

Every item outside the completed set remains approved and queued, including larger profile-history correction, account editing/auditing, unit-master editing, import history/reversal, allocation previews, publication revisioning, historical coverage policy, analysis drilldowns and accessibility work. Partial prerequisites do not count as completed items.
