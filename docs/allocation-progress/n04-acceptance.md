# N04 original acceptance audit

N04 requires one immutable versioned scheduling snapshot covering OT, leave,
postings, groups, dates, rules, locks and learned preferences; relevant edits must
stale proposals, semantic no-ops must reproduce, and unnecessary sensitive notes
must be excluded. This audit preserves that scope. N04 is Done following the
final consumer reconciliation below; this is not completion of the whole plan.

| Requirement | Implementation and authoritative evidence |
|---|---|
| Immutable/versioned evidence | `scheduling_snapshot.SchedulingSnapshot`: frozen version, canonical JSON and digest; detached/no-flush tests in `test_scheduling_snapshot.py` |
| OT demand and qualifications | Calendar config/revision in enabled snapshot; stale reviewed server/GPU-protocol apply in `test_ot_template.py`, `test_ot_assignment_integration.py`, `test_ot_reviewed_scoring.py`; real calendar-edit ordering in `test_ot_allocation_concurrency.py` |
| Leave/status/intervals | Snapshot includes dates, slot, status; private leave notes excluded. Projection mutation tests and pending-to-approved reviewed apply in `test_snapshot_acceptance.py` |
| Dated posting/call/group | Dates, identities, levels and membership active fields included; direct reviewed stale checks for midmonth posting/call/group-window changes in `test_snapshot_acceptance.py`; OT interval correctness has separate N11 evidence |
| Rules and reference behavior | Actual rest-rule and reference-behavior edits stale; rule order preserved; unordered call pools canonical. General rules notes excluded from scheduling projection and intelligence evidence; actual note-only save tested separately from decision edits |
| Scope/locks/dates | Period status, scope lock and included-unit status included; draft publication change at creation boundary refused in all three reviewed modes; scoped unit edit reviewed test |
| Learned version | Active ID/weights only; activation, rollback and active weight edits stale reviewed ordinary/intelligent apply; inactive/audit churn no-op; actual PostgreSQL activation/apply ordering |
| Fallback/extra ledger | Inputs and locks added; relationship/record mutation tests establish parents before baseline; signed balance/extra contexts compared even if choices stay identical |
| Consistent acquisition | Reviewed creation initializes defaults then locks and reloads inputs before DTO/hash. Step/replay locks held outside template savepoint. Two reproduced PostgreSQL old-context/new-hash races fixed; `n04-acquisition-postgres.xml`34passed |
| Notes/privacy/no-op | Canonical note fields projected out, assignment override presence and forced-prefix classification retained. Import review keeps full-row fingerprint; scheduling has its own projection. `test_snapshot_acceptance.py` checks real rules save and intelligence evidence without rule notes |

Test sources are in `backend/tests`. Latest XML/source fingerprints take precedence
over counts quoted in older checkpoints. Tests are complementary: a stale hash
assertion proves invalidation, while actual apply tests prove refusal without duty
writes; protocol cases do not prove physical GPU execution.

Version 4 drops the reference registry's edit counter from scheduling identity;
reference key, label, aliases, active status and behavior remain included. A real
note-only rules save bumps that counter without changing planning semantics.
Import-review fingerprints and canonical version/audit records retain the counter.
General Rota Rules notes are excluded only at the known phase-one settings key,
not by recursively deleting arbitrary fields from unknown reference behavior.

Unknown nested reference/configuration values remain conservatively included.
Their contents are server-side evidence; this work adds no model or browser data
route. Canonical private free-text fields have explicit projection rules, rather
than assuming unknown keys can be safely removed. New scheduling configuration
fields require review of projection, consumer and invalidation tests together.

Balance/extra-duty preview wrappers now validate their existing draft/scope domain
preconditions, then use the shared planning acquisition boundary before loading
the displayed plan and signed hash. The draft/scope checks retain their existing
error codes; final apply still rebuilds and verifies the signed context. Inspect
the specialized final/follow-up artifacts before asserting full regression success.
Final consumer reconciliation: `n04-consumers-final.xml`154passed204.61s on the
corrected source. `n04-consumers-postgres.xml`15passed98.58s includes actual balance
and extra-duty preview writers waiting in pg_locks, then committing after the
coherent preview and invalidating its signed context. Actual stale apply refused
without assignment changes or batch creation. Runner exited0 after guarded test
database cleanup. Source fingerprints: `n04-consumers-source.json`.

The original N04 criteria are satisfied by the mapped evidence, including real
note-only save/apply, semantic input changes, consistent acquisition, immutable
evidence and explicit sensitive-note projection. This completion does not promise
that every unrelated reference edit is ignored; conservative invalidation remains
documented for unrecognized configuration. Rollback changes hash formats and
requires fresh previews; it must not reinterpret old durable proposal evidence.
N13
heatmaps, N26 optimizer/architecture benchmarking and later rollout gates retain
their separate acceptance scope.
