# Automatic gate: exact configuration and comparable wall time

Automatic retains the existing requirement that local wall time be at most80%
of server wall time, with exact parity, matching month/data/workload/kernel/
browser/adapter, a fresh device check and a proof younger than seven days.
This batch changes proof scope and measurement integrity, not scheduling rules
or that threshold. N40 remains in progress for the full dependent hardware and
workflow matrix; no physical GPU speed advantage is established here.

## Reproduced source gaps and corrections

Optimizer settings compared Balanced planning with a five-second search budget,
while the generator offered30/60/120 seconds and passed no optimizer option
fingerprint to Automatic. A proof could therefore be reused for another mode,
budget, lock/repair scope or preference set. Comparison now measures the normal
Balanced30-second configuration. The generator captures exact submitted options
before awaiting capabilities, fingerprints them and uses that same fingerprint
for both preflight and saved-job checks.

The fingerprint normalizes lock/repair sets and distinct preference ordering
without mutating inputs. Duplicate slot/person preferences follow the backend's
last-value-wins rule; reversing conflicting duplicates changes the fingerprint.
An unscoped older optimizer proof cannot match. Template proofs also require
configuration; legacy member proof fields cannot masquerade as optimizer/template
or a different kernel. Stored adapter labels must match the verified test, and
unusable Automatic evidence returns server before worker startup. Invalid or
fractional workload-size estimates cannot trigger Automatic GPU selection.

The comparison also checked only raw data context across six reports, although
optimizer behavior depends on an active learning version/weights. All optimizer
reports must now carry the same nonempty compound benchmark context as well as
the same raw context and choices. Changed/missing learning context cannot produce
a parity-qualified Automatic proof.

Finally, local measurements omitted the fresh device test paid by real Automatic
generation and reused a warmed test worker. Local comparison wall timing now
includes a disposable fresh verification worker, closes it and uses a cold scoring
worker. HTTP/job work, score calls, server optimization and final validation stay
inside elapsed time. Proof measurement_version2 invalidates older timings for
all workloads until compared again; explicit pilot mode remains subject to
existing live device/kernel/safety checks.

The comparison UI states its Balanced30-second/no-lock/no-preference scope and
that other options use the server. The30-second search budget is not a promised
end-to-end deadline. Six alternating preview proposals are validated and cancelled;
none are applied or published. Preview disposal cancellation is outside measured
generation wall time, as before; initial settings readiness outside the six runs
is also distinct from each timed local revalidation.

## Evidence scope

Unit checks cover exact20% boundary, exact seven-day expiry/future timestamps,
roles/deployment switches, browser/signature changes, workload/kernel/config,
adapter label, malformed storage, estimated sizes, option ordering/duplicates,
learning context and early startup rejection. Final acceptance is recorded in
the final test/build logs, not inferred from earlier green intermediate runs.

`automatic-optimizer.browser.mjs` exercises actual generator requests with
synthetic workers/API: legacy/unmatched budget/mode choose server, a matching
proof chooses local assistance, a changed live adapter returns server. Canonical
validation calls are mocked; no assignment is applied. Its separate native
Chromium probe uses no WebGPU enablement flags and returned **no-adapter**. This
does not prove that the physical machine lacks a GPU, nor certify a GPU job.

`automatic-comparison.browser.mjs` exercises the actual settings comparison:
six alternating options, thirty-second scope, six validations/cancellations,
four device-test calls (initial readiness plus three timed local checks), compound
learning context, recorded configuration and stage timing.390px scope text,
overflow/Axe checks and screenshot are separate UI evidence. Synthetic returned
jobs contain no numeric frames; no ranking dispatch or actual solver speed is
claimed. Existing GPU ranking versus server-optimization attribution is retained.

Initial browser attempts failed because the harness filled a select as an input,
omitted the existing final-validation route, and created an Axe page without an
explicit browser context. Those logs are retained; harness fixes changed no
application safety policy. Intermediate builds/tests overlap final acceptance.

Final source hashes: n40-automatic-source.json. Rollback is scoped to frontend
gate/fingerprint/measurement changes; no database migration/data rollback is
needed. Do not restore invalid old measurements as current evidence. Remaining
N36/N39/N40/N41 native/browser/cold-warm/end-to-end workload matrix and ratified
N06 targets still matter; an integer kernel or synthetic selector win does not
make allotment perfect or justify an Automatic hardware advantage claim.

## Final checkpoint

- n40-final-tests.log:150passed, zero failures/skips; session86868 exited0.
- n40-final-production-build.log:TypeScript/Vite passed31.87s with existing
  mixed-import/bundle warnings; session92271 exited0.
- Final browser session86457 exited0. n40-automatic-browser-verified.json has
  five expected selector outcomes and the separate native no-adapter result.
- n40-comparison-contract-final.json records six starts/validations/cancellations,
  matching Balanced30s options, measurement_version2, exact compound context and
  stage reports.390px overflow/Axe scope checks passed; screenshot visually read.
- Final source hashes independently rechecked unchanged; scoped whitespace passed.
  Earlier test/build/browser runs overlap; failed harness logs are preserved.

The benchmark producer and consumer are verified under synthetic contracts.
Physical current-adapter throughput, representative cold/warm departmental
comparisons and future-kernel dependency acceptance remain open. N40 is notDone.
