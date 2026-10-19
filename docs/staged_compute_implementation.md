# Staged rota performance and optional browser GPU

20 October 2026 update: [adapter diagnostics, three-layer security and bounded recovery](webgpu_reliability.md).

Scope: the requirements in `Plan/to do/oct2026.txt` and the seven-stage implementation
plan approved in chat. Status: implemented and verified on 19 October 2026.

## User workflow

1. Open **Admin Tools → Compute Settings**. GPU use is off by default on each browser.
2. Use **Test Device**, enable local computation, and choose Server, Automatic or Prefer
   local GPU. Hardware support alone is not evidence of a faster rota run.
3. **Compare engines on this month** runs three server and three local proposals in
   alternating order. It includes cold worker/GPU startup, data transfer, planning and
   complete server validation. All comparison proposals are cancelled; none is applied.
4. Automatic requires identical decisions and a median local time at least 20% lower.
   The proof is tied to this adapter, month, rule/data fingerprint, scoring version and
   seven-day expiry. Missing, software, stale or slower devices use the server.
5. In **Rota Template**, select **Generate & review draft**. Follow progress, inspect
   proposed assignments, unresolved slots, explanations and workload counts, and
   download a JSON report. Closing the dialog stops further work; reopen to continue.
6. Confirm the review and select **Apply reviewed draft**. The backend checks the live
   snapshot and complete proposal again, then commits assignments and audit records
   together. Generation never publishes a rota.

Jobs run in bounded request chunks, with durable progress between requests. They do
not require a new background service or keep working secretly after the page closes.
The browser GPU serves the current operator's proposal, not a shared compute pool.

## Implementation and acceptance evidence

| Stage | Delivered behavior | Evidence |
|---|---|---|
| 1. Baseline | Disposable full-month benchmark; query count and SQL time; loading, candidate validation, safety, scoring and save-stage timings; template-generation timing; exact assignment comparison. | `tools/benchmark_rota_compute.py`; `docs/benchmarks/rota_compute_96_members.json`. |
| 2. Shared engine | Reuse indexed monthly context and one safety result per slot; preload group membership, call timelines and minima; cache nearby duties including month boundaries; update counts/rest indexes after each provisional choice. | `rota_candidates.py`, `rota_assignment.py`, `rota_safety.py`, `history_fairness.py`; cached/reference parity, conflict and cancelled-duplicate regressions. |
| 3. Reviewable jobs | Queued/running/completed/failed/cancelled/applied states; resumable bounded steps; revision-based retry protection; two-hour expiry; one active proposal per month; progress and cancellation. Proposals never write operational assignments. | `rota_compute.py`, `RotaComputeJob`, migration `20261018_0021`; job lifecycle/API tests and browser resume/interruption flows. |
| 4. Device controls | Admin navigation; per-browser opt-in and mode; actual adapter test; exact-score self-test; enable/disable/reset; deployment feature flags; responsive controls. | `compute-device.ts`, `rota-compute.ts`, real main navigation and desktop/390/320 px browser checks. |
| 5. GPU pilot | Real WGSL integer scoring in a dedicated worker; bounded buffers and batches; CPU/GPU exact equality; deterministic tie order; overflow rejection; empirical whole-proposal comparison before Automatic can select GPU. | `compute-worker.ts`; actual Intel hardware-adapter tests for 1, 64, 513 and 10,000 candidates; comparison artifact. |
| 6. Review/apply | Explain each choice; preserve existing assignments; show before/proposed workload ranges and means; dry validation endpoint; stale/published rejection; validate the entire proposal against other proposed choices; atomic and idempotent apply; attributed member activity. | Backend proposal tests; real PostgreSQL double apply, racing create/cancel, and an external edit blocking apply then invalidating its snapshot; browser review/apply/report tests. |
| 7. Recovery/release | Worker timeout and cleanup; GPU loss/unavailable API fallback; manual server continuation; interrupted response recovery; durable resume; mobile review cards and sticky actions; feature flags; normal server path remains available. | Browser fault injection, timeout, unsupported API and lost-response scenarios; server failure/expiry/ownership tests. |

The existing compatibility auto-fill API also uses shared context and atomic operational
writes, records running/completed/failed correctly, and rejects published months.
The reachable browser action uses the new reviewed-job workflow.

The full compatibility run loads one context. A reviewed job reloads context once per
bounded request, sharing it across every candidate in that chunk. This keeps resumable
requests independent of old ORM sessions while avoiding per-candidate database reloads.

## Measured performance

The recorded benchmark uses 96 synthetic members, two units and 62 slots across May
2026, in separate disposable SQLite databases for each path. Both paths use atomic
writes; the baseline intentionally retains uncached validation/context rather than
reintroducing unsafe per-slot commits.

| Measurement | Uncached reference | Optimized |
|---|---:|---:|
| Assignment run | 72.324 s | 2.661 s |
| SQL queries | 69,174 | 604 |
| Assignments | 62 | 62 |
| Unresolved slots | 0 | 0 |

Assignments match exactly. This run measured 27.18× faster execution and 99.13% fewer
queries. Template generation for one configured daily duty over all 31 days measured
0.665 s. These are fixture results on this machine, not a production latency promise.
See the JSON artifact for stage timings and the precise fixture definition.

The browser comparison is a separate, small, live HTTP fixture. Its artifact includes
the actual adapter, GPU transfer/compute timings, median whole-proposal timings and
selected engine. On the tested Intel adapter the local pilot was slower end to end,
so Automatic correctly selected the server. GPU support is optional; most of the
measured benefit comes from eliminating redundant backend work. The GPU kernel is
deliberately limited to numeric score aggregation; safety, score-parity checks and
database authority remain on the server.

## Isolation, concurrency and rollout

- `ROTA_COMPUTE_ENABLED=false` disables the reviewed-job endpoints for rollback.
- `BROWSER_GPU_ENABLED=false` prevents new local GPU jobs and switches an existing
  local job to server execution at its next step. Existing manual rota screens remain.
- Both deployment flags default on; local browser GPU permission defaults off.
- Only admins can start a local GPU job. A job is readable/mutable by its owner or a
  superadmin; normal workflow users retain server generation.
- A unique partial index and shared edit lock prevent competing active month proposals.
  Final apply locks the scheduling snapshot tables in PostgreSQL, including protection
  from older writers that do not take the advisory lock. All validation precedes writes.
- Workers receive numeric score rows, numeric tie order and an opaque frame token.
  No member names, UUIDs, account tokens or private comments are sent to the worker.
- Every submitted local winner is checked against the server's canonical ranking.
  A stale frame, wrong selection, or changed live context cannot bypass validation.
- Browser/GPU support is detected at runtime. Automated hardware execution was tested
  with the available Intel adapter in Chromium; this does not certify every browser,
  mobile GPU, driver, or the machine's separate NVIDIA adapter.

## Reproduce verification

From the repository root (Windows PowerShell):

```powershell
# All backend tests, including isolated PostgreSQL concurrency and migration checks.
backend\.venv\Scripts\python.exe tools/test_compute_postgres.py --full

# Benchmark only creates disposable in-memory SQLite databases.
backend\.venv\Scripts\python.exe tools/benchmark_rota_compute.py --members 96 --slots 62 --output docs/benchmarks/rota_compute_96_members.json

# Browser fixture server: loopback only, in-memory data, no configured live DB access.
backend\.venv\Scripts\python.exe tools/compute_smoke_server.py
```

With Vite running on port 5178 and the fixture server on 8019:

```powershell
cd frontend
npm run build
npm test
npm run test:compute
npm run test:normalization
npm run test:members
```

Set `MEMBER_TEST_BROWSER` if the browser executable is not Playwright's default.
`MEMBER_TEST_URL` and `COMPUTE_TEST_API` override the two loopback URLs.

The PostgreSQL runner checks for a loopback connection, creates a uniquely named
`duty_rota_test_compute_*` database, verifies fresh migration, downgrade/re-upgrade and
preservation of a sentinel member, runs isolated schema fixtures, and drops only its
own generated database in `finally`. It never resets the operational database.

Screenshots: `frontend/tests/artifacts/compute-review-mobile.png` and
`frontend/tests/artifacts/compute-settings-mobile.png`.


## Final verification ? 19 October 2026

- Full backend suite: **323 passed, zero failed, zero skipped**, including six real
  PostgreSQL concurrency tests. Fresh migration, downgrade/re-upgrade and existing
  member preservation passed in a disposable database.
- Frontend: **8 unit tests and 33 browser workflows passed** (14 compute, 11 normalization,
  8 member/profile/import). Production TypeScript/Vite build passed, including the worker asset.
- A final focused rerun passed all 16 compute backend scenarios, including admin/board
  GPU permissions and disabling GPU mid-job. The browser also verified that cancelling
  an already applied draft from another tab reports the applied state accurately.
- Ruff and whitespace checks passed. Mobile review/settings screenshots were inspected;
  the review uses stacked cards without horizontal clipping at narrow widths.
- Local migration is at **20261018_0021**. Operational counts remained **312 members,
  8 units and 14,448 assignments**; the live compute-job table remains empty.
- The fixture HTTP server and generated PostgreSQL test databases were cleaned up.
  The existing frontend dev server was retained.

Machine-readable verification: `docs/benchmarks/rota_compute_verification.json`.
