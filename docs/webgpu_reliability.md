# WebGPU adapter diagnostics, security and recovery

Implemented locally on 20 October 2026 following approval of the 24-item browser upgrade plan.
The optional native hardware-enumeration/compute companion is a separate future extension.

## Adapter selection

Compute Settings displays **Browser-selected GPU** with the available vendor, architecture,
device and description. Redacted fields say **Information unavailable**. The power selector
offers browser default, prefer performance and prefer power saving; these are hints rather
than selectable physical devices. Changing the preference invalidates tests and comparisons.

The standard browser API returns one adapter and cannot enumerate every installed GPU or
select NVIDIA by name. Chrome's published Windows limitations say powerPreference is ignored
for device selection and simultaneous multiple-adapter use is unsupported. The UI explains
Windows graphics preferences, browser restart/retest and Chrome's documented high-performance
option. The application never changes driver, browser or Windows GPU settings itself.
Do not bypass a driver blocklist or enable unsafe WebGPU flags.

Sources checked on 20 October 2026:

- [Chrome Windows WebGPU limitations](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips?hl=en#Windows-specific_limitations)
- [GPUWeb request options](https://gpuweb.github.io/types/interfaces/GPURequestAdapterOptions.html)
- [GPUWeb lifecycle, errors and device loss](https://gpuweb.github.io/gpuweb/explainer/)

The current shader sums nine precomputed integer scoring components. Eligibility, planning
and final validation remain server responsibilities. A working NVIDIA adapter does not
establish an end-to-end speed improvement.

## Frontend and worker trust boundaries

- Strict persisted-preference parsing: bounded stored JSON, current protocol version, valid
  enums/booleans, finite positive comparison timings, non-future timestamps, seven-day expiry,
  matching month/context, browser version and browser-visible capability signature.
- Stored comparisons are performance hints, never authorization. A live exact-score test is
  required before local generation. Automatic mode still requires a 20% end-to-end advantage.
  The capability signature is not a unique physical GPU identifier; browsers may redact it.
- Device failures invalidate prior measurements. Tests and diagnostic exports remain local.
  Exports contain GPU diagnostic metadata and bounded error codes, not names, authentication
  tokens, monthly context hashes or proposed rota assignments.
- Typed requests/responses and validation on both sides of the worker boundary. Only numeric
  rows and tie order are projected into scoring messages; the server frame token stays on
  the main thread. Caller fields cannot override the operation, request ID or power preference.
- One admitted operation per worker, 100,000-row maximum, nine non-negative 32-bit integers per
  row, exact sum overflow checks, distinct non-negative tie values and full CPU score/winner
  verification. Empty/malformed/sparse inputs and malformed responses are rejected.
- Device limits are checked before allocating. Partial allocations, mapped buffers and error
  scopes are cleaned up on failure. Validation, internal, allocation, device loss, worker crash,
  message decoding, transfer and timeout errors have bounded failure paths.
- Production worker responses carry `connect-src 'none'`; the bundled scoring worker cannot
  fetch even same-origin endpoints. No user-supplied shaders or remote GPU scripts are loaded.

## Recovery contract

| Condition | Behavior |
|---|---|
| Unsupported/insecure browser, missing adapter, fallback adapter or blocked worker/storage | Preflight chooses server computation. |
| Device loss or execution/worker failure | One fresh-worker/self-test retry per running recovery instance, then server continuation. Prior benchmark is invalidated. |
| Changed adapter detected before scoring, malformed input, invalid response, parity mismatch or exceeded limits | Stop local scoring and continue on server. No unsafe score retry. |
| GPU does not answer | Terminate after 15 seconds and continue on server. |
| Backend rejects a local ranking with 422 | Discard local device proof and request server scoring for that revision. |
| Step response lost or server 5xx | Fetch durable progress; use an advanced revision, or retry the same revision once. Further failure offers manual resume. |
| Rate limit, stale snapshot, permission change or other client error | Stop, explain the error and offer appropriate resume/server/cancel controls. No unbounded retry loop. |
| Close during preflight or GPU scoring | Abort preflight/terminate the worker. No later generation starts after preflight closes. Existing server progress remains resumable. |
| Cancel | Stop local work and cancel the owned proposal. Already-applied assignments are preserved. |
| Any generation failure | No automatic apply or publish. Successful recovery still produces a reviewed draft. |

Compute mutations have a 30-second client deadline; reads have a 10-second deadline. These
deadlines do not undo a server transaction that already committed; durable revisions and
ownership checks make recovery safe. A response lost during Apply is resolved by reopening
the proposal; Apply remains server-validated and idempotent.

## Backend and deployment

- Strict compute schemas reject extra fields, coercions, invalid months, overlong or malformed
  frame tokens and out-of-range revisions/selections. Streaming request bodies are bounded
  to 4096 bytes before parsing, including chunked requests without a trusted Content-Length.
  Incomplete compute request bodies time out after ten seconds with HTTP 408.
- Per-operator admission control: 12 start tokens, refilling over five minutes; 60 work tokens,
  refilling at 10/second. HTTP 429 includes Retry-After. Job reads, basic capabilities and
  cancellation remain available; requesting the expensive monthly context hash uses work tokens.
  The limiter is bounded to 10,000 buckets and is **per ASGI process**; multi-worker deployments
  need aggregate edge/shared-store admission control. This is not a distributed rate limiter.
- Durable quota: at most three unexpired active proposals per operator through the shared
  compute creation service, plus the existing one-active-proposal-per-month constraint.
- Existing authentication, operator ownership, feature/admin checks, revisions, snapshot
  expiry, canonical server ranking, full revalidation and atomic apply remain authoritative.
  The deterministic frame token is correlation/freshness data, not a secret or authentication.
- Compute responses are no-store. Response protections include nosniff, same-origin referrers
  and denial of framing. Production adds same-origin script/worker CSP, restricted connections
  and HSTS on HTTPS responses. Inline styles remain allowed for existing UI rendering; inline
  script and eval are not allowed. Exact loopback connections support the separately paired
  local assistant; no arbitrary remote model endpoint is allowed by this policy.
- Production CORS allows the configured frontend origin, excluding development origins.
  Production Docker images default APP_ENV to production; Compose retains its explicit
  development override. Use TLS at the deployment edge. Standalone static hosting must apply
  equivalent response headers; Vite preview includes document and dedicated worker policies.
- Vite upgraded to patched 6.4.4; affected transitive packages updated. `npm audit` reports zero
  vulnerabilities for the resulting lockfile at verification time.

No operational database migration or model installation is required for this upgrade.

## Verification

| Verification | Result |
|---|---|
| Full backend suite in disposable PostgreSQL environment | 382 passed, including concurrency checks; 253.76 seconds. |
| Updated compute/security backend tests after final middleware changes | 51 passed, including slow-body deadlines and rate-limited context hashing. |
| Frontend unit tests | 52 passed. |
| Existing compute browser regression workflows | 14 workflows. |
| Real default Intel and forced-performance NVIDIA browser runs | Exact scores/winners at 1, 63, 64, 65, 513, 10,000 and 100,000 rows; signed integer boundary and 30 repeated batches per adapter. |
| Worker fault injection | 20 cases: insecure/missing API, missing/failed adapter or device, pipeline/limits/allocation/mapping/submission/error-scope/parity failures, malformed requests and overlap; cleanup asserted. |
| Integrated recovery | 8 workflows: one/repeated loss, malformed result, backend rejection, lost response, rate limiting, scoring timeout and worker crash. Zero assignments before review. |
| Production browser bundle | Desktop, 390px and 320px; GPU generation, explicit review gate, diagnostic download, worker and external-network CSP blocks. Standalone Vite preview GPU/CSP also passed. |
| Build/static checks | TypeScript + production build, Ruff and whitespace checks. |

Migration upgrade/downgrade/re-upgrade preserved the sentinel record. The disposable PostgreSQL
test database was removed; no compute test databases remained after the run. Browser fixture
servers use independent in-memory databases. Operational rota data was not used for writes.
Concurrent member-resolution work in the shared repository was left intact and is outside
this upgrade. The full-suite count describes the snapshot tested before those additional
tests were added; final focused compute/security checks passed against the later workspace.

Evidence: [hardware and recovery](benchmarks/webgpu_recovery.json),
[production build/CSP](benchmarks/webgpu_production.json),
[existing compute workflows](benchmarks/rota_compute_browser.json),
[verification summary](benchmarks/webgpu_verification.json).

Reproduce with the backend virtual environment:

1. `python tools/test_compute_postgres.py --full` (loopback PostgreSQL, disposable database).
2. `python tools/compute_smoke_server.py` and Vite on 127.0.0.1:5178; in frontend run
   `npm test`, `npm run test:compute`, `npm run test:webgpu`.
3. `npm run build`; `python tools/webgpu_production_smoke_server.py`; in frontend run
   `npm run test:webgpu-production`. Optional COMPUTE_PREVIEW_URL adds a standalone preview check.

The NVIDIA hardware assertion in `test:webgpu` intentionally fails on a machine without an
NVIDIA adapter. Deterministic fault tests and CPU validation do not establish driver stability
on every device, and no permanent browser flags or GPU preferences are changed by these tests.
