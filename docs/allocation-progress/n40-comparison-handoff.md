# N40 Automatic gate acceptance and continuation

The previous goal turn made implementation and verification progress but was
interrupted before the execution log/state checkpoint. Authoritative final
artifacts were re-read on resume and implementation hashes matched:

-150frontend tests passed (`n40-final-tests.log`,86868exit0).
-TypeScript/Vite build passed31.87s (`n40-final-production-build.log`,92271exit0),
  existing mixed-import/bundle warnings retained.
-Five selector browser contracts passed (`n40-automatic-browser-verified.json`,
 86457exit0), with a separate native Chromium no-adapter probe.
-Six actual comparison-UI requests, validations and cancellations passed under
  synthetic worker/API contracts (`n40-comparison-contract-final.json`), including
  measurement_version2, Balanced30s fingerprint, compound learning context and
  timed disposable device tests.390px scope note was visually inspected and had
  no overflow/serious-critical Axe issues in the tested scope.

`n40-automatic-gate-audit.md` gives the complete scope and limits. Automatic now
matches exact optimizer options and invalidates pre-version2 timings that omitted
live device verification. The20% threshold and seven-day expiry remain intact.
No physical GPU speedup, real optimizer GPU proposal, domain-policy change or
operational write is claimed. N40 remains in progress because broader hardware,
representative end-to-end and dependent kernel acceptance are outstanding.

This continuation adds a second six-run browser comparison with alternating
learning-context identifiers. Even with identical raw context and choices, its
proof must have parity=false and choose server. The original successful browser
artifact is preserved; the new result writes
`n40-comparison-learning-invalidation.json` only after assertions pass.

The first new launch8490exit1 hit an unready Vite dynamic-module import while
startup took33.95s; retained log `n40-learning-invalidation.log`. The same Vite
process was not restarted. Current source readiness probe66315 and corrected
browser29765 are specific handles to poll; no timeout implies completion.
Task-owned Vite74499/5188 must remain until browser terminal, then stop only that
owned session and verify port closure. No operational service was restarted.

Final corrected browser29765 exited0 and source readiness66315 exited0. The
new artifact records12 starts/validations/cancellations over two six-run
comparisons; changed learning yields parity=false and engine=server, zero page
errors. Vite74499 stopped with CtrlC after the gate. Final source identities and
port closure are checked in the execution checkpoint. No item count increment
follows from this subset.
Then pursue the remaining original allocation/WebGPU/AI tasks and unresolved
N05/P6/N06 decisions without treating them as blanket implementation blockers.
