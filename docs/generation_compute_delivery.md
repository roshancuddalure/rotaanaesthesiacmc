# Reviewed template and member generation

Scope: the approved 60 actions for template allocation, quick Autoassign and whole-month optimisation. Implementation and verification are local; no deployment, push or production data changes are included. This evidence checklist does not guarantee every future driver or scheduling policy.

## Operator workflow

Choose a draft month, review its units and scope, and build a template proposal. Review allocations, forced choices and uncovered work before applying. Then choose **Autoassign members**: quick safe fill preserves assignments; whole-month planning supports locks, preferences and selected repairs. Review and apply the member proposal. Publishing remains separate.

Applied generation can be reversed only while its draft, assignments and inputs remain unchanged. A template cannot be reversed after assigning people to its duties. Both generation windows expose explicit reversal review.

Compute settings offer separate checks and comparisons for members, templates and whole-month candidate ranking. Automatic uses the server for small workloads, unavailable kernels, missing/stale proof or less than 20% measured end-to-end benefit. Prefer GPU still requires correctness and a supported real adapter. Whole-month constraint solving and stateful template refinement remain on the CPU; GPU ranking never overrides eligibility or policy.

## All 60 actions and evidence

Backend tests are under `backend/tests/`; frontend tests under `frontend/tests/`; browser evidence under `docs/benchmarks/`.

| # | Delivered action | Implementation and verification |
|---|---|---|
| 1 | Visible Autoassign with clear naming | `main.ts`, `rota-compute.ts`; compute/production browser journeys |
| 2 | Explain scope, template and members as three stages | generation readiness overview; controls browser suite |
| 3 | Reachable actions on mobile | early toolbar and sticky review footer; 320/390/768/1280 viewport checks |
| 4 | Explain units versus people | separate template/member proposal types and copy; generation journeys |
| 5 | Explain disabled prerequisites | scope, slots and draft guards plus server checks; controls/API tests |
| 6 | Show month, units, filled and open duties | readiness overview with active-assignment counts; controls suite |
| 7 | Render essential controls before reports | early generation toolbar; controls test holds report request open |
| 8 | Keep optional report failures nonblocking | settled report requests; injected optional-report 503 |
| 9 | Offer quick fill and whole-month choices | `openAutoassign`; compute/production journeys |
| 10 | Make preservation and repair explicit | quick fill preserves; whole-month repair scope and locks; optimizer tests |
| 11 | Show per-workload readiness | workload selector and kernel availability; controls comparisons |
| 12 | Exercise each numeric kernel | sum9 and signed lexicographic self-tests; hardware/recovery suites |
| 13 | Report actual browser-selected GPU | hardware signature and diagnostics; Intel/NVIDIA artifacts |
| 14 | Distinguish requested and actual engine | requested_engine and engine in jobs; fallback API/browser assertions |
| 15 | Share server/automatic/GPU modes | shared prepareEngine/selectedEngine; frontend unit tests |
| 16 | Benchmark workloads separately | per-workload proof slots and six alternating runs; controls suite |
| 17 | Invalidate relevant old proof | context/config/kernel/browser/device/active-learning fingerprints; unit/API tests |
| 18 | Measure execution stages | worker upload/dispatch/readback/verification timings and server metrics; comparison artifact |
| 19 | Require measured benefit in Automatic | local <= 0.8 * server with parity; engine-selection tests |
| 20 | Keep small automatic workloads on CPU | estimated-row threshold 256; selection tests |
| 21 | Separate template preview from saving | rolled-back planning savepoint; tests assert zero slots written |
| 22 | Durable revisioned template jobs | shared RotaComputeJob lifecycle; PostgreSQL create/apply races |
| 23 | Typed numeric-only protocol | compute-protocol.ts and compute_kernels.py; projection/malformed-input tests |
| 24 | Preserve exact ordered fairness | lexicographic ranking and canonical ties; frozen cross-language goldens |
| 25 | Safe signed numeric bounds | i32 checks and comparison without subtraction overflow; boundary goldens |
| 26 | Preserve dependent template state | sequential server preview and exact replay; batched read-only scoring |
| 27 | Profile and bound stateful refinement | CPU shuffle capped at 20,000 comparisons with stage metrics; no unproven GPU port |
| 28 | Independently verify template results | canonical winners/token/cursor/revision/replay; mismatch and invalid-batch tests |
| 29 | Explain forced/unresolved allocations | summaries and readable duty/unit labels; generation reviews |
| 30 | Atomic reviewed template apply | input locks, snapshot/hash and exact slot replay; rollback and PG race tests |
| 31 | Shared member eligibility | rota_eligibility.py integration; eligibility/assignment contract tests |
| 32 | Multi-call selection | shared call eligibility in quick/optimizer paths; call-cluster regressions |
| 33 | Dated calls/groups/postings | dated eligibility contract; mid-month/campus tests |
| 34 | Retain leave/rest/staffing/month-boundary safety | authoritative safety engine; optimizer/autofill/safety regressions |
| 35 | Batch numeric work without changing state | envelopes <=32 frames; batch atomicity/parity tests |
| 36 | Match CPU/GPU ranking kernels | sum9 and lexicographic; fixed goldens and real hardware |
| 37 | Assist whole-month solver with GPU hints | private eligible mappings, numeric public frames and validated seeds; GPU journey |
| 38 | Preserve constraints and objective order | hints only; CPU constraints and final validation stay authoritative |
| 39 | Show alternatives/changes/uncovered duties | review table and alternative selection; intelligence regressions |
| 40 | Honest solve status | optimal/feasible/time-limited evidence and per-objective proof flags; optimizer tests |
| 41 | Draft-only mutation guards | template/assign/clear/apply/reverse checks; published-period tests |
| 42 | Role/owner/feature checks at each step | API dependencies and step flags; auth/IDOR/revocation tests |
| 43 | Reject malformed/stale/oversized input | strict models and bounded arrays/revisions; API/protocol tests |
| 44 | Keep identities/credentials out of worker | numeric projection and static shader sources; privacy/CSP tests |
| 45 | Bound GPU/server resources | <=4096 rows, <=32 columns/frames, watchdog/rate/search/shuffle limits |
| 46 | One device retry then CPU recovery | fresh worker for transient errors; fault suite |
| 47 | Invalidate proof on mismatch | worker parity plus server canonical verification; malformed/backend rejection tests |
| 48 | Recover lost responses safely | reload durable revision before retry; network-loss/idempotency tests |
| 49 | Close/cancel/concurrency/stale protection | abort controllers, worker close, revisions and namespace locks; browser/PG tests |
| 50 | Audited guarded reversal | operator/job/run records, activity audit and after-state hash; reversal tests/UI |
| 51 | Frozen scheduling/ranking examples | generation_numeric_goldens.json and backend scheduling fixtures |
| 52 | Boundary and CPU/GPU parity tests | signed extremes/ties, row counts 1/63/64/65/513/2048/4096 on real hardware |
| 53 | Scheduling edge-case regressions | eligibility/call/rest/leave/optimizer/assignment full backend run |
| 54 | Infeasible/forced/repair/lock scenarios | template/intelligence reliability and domain suites |
| 55 | Inject GPU/protocol/network/API faults | recovery suite and template loss controls journey |
| 56 | Real PostgreSQL races | starts/applies/cancel/reverse plus upgrade/downgrade sentinel preservation |
| 57 | Responsive/accessibility/keyboard checks | 320/390/desktop generation, 768 controls, keyboard activation and axe serious/critical checks |
| 58 | Review polish | readable labels, workload summaries, progress, confirmation, mobile footer and reversal |
| 59 | Intel/NVIDIA/fallback/security checks | adapter artifacts, fault suite and built production CSP/privacy checks |
| 60 | Release controls/runbook/evidence | independent flags, rollback guidance and final verification manifest |

## Release and recovery

`ROTA_COMPUTE_ENABLED` controls reviewed computation; `BROWSER_GPU_ENABLED` gates browser acceleration. `TEMPLATE_COMPUTE_ENABLED`, `TEMPLATE_GPU_ENABLED` and `OPTIMIZER_GPU_ENABLED` independently gate the template flow and GPU workloads. See backend configuration and `.env.example`. Turning off GPU flags sends pending GPU work to the server on its next step. Disabling reviewed computation blocks new work while owned proposals remain available for cancellation.

Rollback acceleration first by disabling its workload flag; keep reviewed CPU generation available. Undo applied draft work using reviewed reversal while its snapshot is unchanged, or repair the current draft after later edits. Snapshot changes deliberately block automatic reversal. Shared compute jobs require no new schema. The historical 0023 migration fix avoids referencing ORM columns introduced by later migrations; clean upgrade/downgrade/re-upgrade preserves a sentinel row.

Browsers choose adapters through WebGPU power preferences. The application cannot enumerate or force every physical GPU. NVIDIA verification launches a browser with the discrete adapter selected and confirms the returned hardware signature; a normal browser can still choose Intel. A passing kernel check does not establish end-to-end speedup. Automatic requires a separate workload comparison.

## Reproduce verification locally

Use the backend virtual environment. `tools/test_compute_postgres.py --full` creates and removes only a generated loopback PostgreSQL test database. Smoke servers use disposable in-memory SQLite and must remain on loopback. Tests sharing the same fixture server must run sequentially.

```powershell
.\backend\.venv\Scripts\python.exe tools/test_compute_postgres.py --full
.\backend\.venv\Scripts\python.exe -m pytest backend/tests/test_generation_api.py -q
# Separate terminals:
.\backend\.venv\Scripts\python.exe tools/compute_smoke_server.py
.\backend\.venv\Scripts\python.exe tools/generation_smoke_server.py
cd frontend
npm test
npm run build
npm run dev -- --host 127.0.0.1 --port 5197 --strictPort
$env:MEMBER_TEST_URL='http://127.0.0.1:5197'
npm run test:generation-controls
npm run test:generation
npm run test:compute
npm run test:webgpu
```

For built CSP verification, build then start `tools/generation_smoke_server.py --production --port 8024`. Set `COMPUTE_PRODUCTION_URL=http://127.0.0.1:8024` and run `npm run test:webgpu-production`.

Final counts and commands: `docs/benchmarks/generation_verification.json`. Browser artifacts: `generation_compute_browser.json`, `generation_controls_browser.json`, `rota_compute_browser.json`, `webgpu_recovery.json` and `webgpu_production.json`. Mobile screenshot: `frontend/tests/artifacts/template-gpu-review-mobile.png`.

## Practical limits

This is hybrid candidate ranking. Constraint search, final validation and stateful refinement remain on the server. Learned settings never bypass hard rules. Bounded search may leave work uncovered; globally optimal is reported only when proved for the configured model/candidate set. Browser/OS/driver changes require renewed comparison. Operators still review policy, forced allocations and uncovered work before publishing.
