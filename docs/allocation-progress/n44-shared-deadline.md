# Shared advisory request deadline and retry measurement — 20 November 2026

One90-second monotonic budget now covers an entire companion suggestion request: reference preparation, runtime/catalog checks, prompt measurement, generation, any correction attempt and final response review. Previously each HTTP call had its own90-second timeout. Metadata/probes/retries could therefore accumulate work beyond the browser's95-second companion-fetch timeout.

Every outgoing request receives only the remaining time. The companion checks expiry after reading a response, before another stage and before exposing the final suggestion. Expiry returns504 with the stage and regular-planning guidance. An early transport failure remains503 rather than being counted as successful abstention. Health probes retain their separate existing timeout. No request data can increase this budget, context size, output allowance or retry count.

This is admission and result-acceptance deadline enforcement. The [Python monotonic clock](https://docs.python.org/3/library/time.html#time.monotonic) avoids wall-clock adjustment issues; [urllib timeouts](https://docs.python.org/3.11/library/urllib.request.html#urllib.request.urlopen) govern blocking transport operations. They are not a process kill switch. Indefinite trickled-body handling, browser disconnect propagation and proof that a real Ollama worker has ceased inference are not established here; stronger cancellation remains open. Late results are refused whenever control returns, and no additional stage is admitted after expiry. Backend source fetches outside the companion are not part of this90-second budget.

## Correction retry defect

Code inspection found that a correction attempt appends instructions but reused the original prompt receipt. Its changed prompt could then fail the strict equal-count completion check or reach generation without a fresh reserved-output calculation. Each attempt now re-verifies model/runtime and measures its exact current messages/schema within the original deadline. The same original user instruction still governs numerical/claim validation; retries gain no policy authority.

A regression forces a malformed first reply followed by a valid response with different measured prompt counts1000and1400. It requires two distinct probes, identical probe/generation messages for the correction, and decreasing timeouts across all eight calls. This verifies the changed-prompt path rather than assuming a receipt can be reused.

## Verification and limits

- `n44-shared-deadline.xml`:**127passed99.69s**, native4859EXIT0, no failures/errors/skips. Eight new deterministic actual-companion cases cover cumulative budgets, exact-boundary expiry at metadata/probe stages, changed retry remeasurement, expired invalid reply/no retry, overdue response review/no output and early transport failure classification. Prior119tests overlap this set.
- `n44-deadline-http.json`:complete/source_unchanged/fixture_closed, native79430EXIT0. Actual urllib sockets and companion API against a synthetic owned127.0.0.1:11438 server; test-only deadline1second, production constant unchanged90seconds. Quick controlHTTP200 in0.172s. Cumulative metadata, slow measurement and slow suggestion return504 in1.032/1.063/1.032s respectively. Recorded started stages stop at the expired stage; no late suggestion is returned.
- The fixture provides fabricated protocol counters and has no model or operational data. It verifies transport/deadline behavior, not actual model generation or production latency. Handlers capture case-local state; final server close joins finite pending handlers and closes the port. Any occupied port would fail binding without modifying the existing service.
- Ruff/scoped whitespace passed. Live-fixture source hashes and five-file checkpoint hashes were independently rechecked. The AI evaluation manifest includes the deadline module for later comparable runs. No frontend or source endpoint changed, so no new browser/build claim.

All test/fixture handles are terminal;11438is closed and no model was started. Dedicated progress viewer5201 remains live. No assignment/policy/schema/production/cloud/model-download change occurred. The implementation adds no durable job, recovery replay or emergency repair authority; N45 remains queued for its full dependent orchestration scope, and N44 remains In progress.

Next freeze a versioned-reference development corpus for both existing models under the now-shared request budget and fresh per-retry measurement. Preserve historical runs and distinguish timeouts, guarded rejection, mechanical accuracy and human-reviewed semantics. N06 quantitative acceptance, unseen departmental cases and N50 pilots remain separate; all50items are retained.
