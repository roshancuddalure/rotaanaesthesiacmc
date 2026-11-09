# Leave import status: V2 handoff

The current applied app remains at **40 accepted requirements out of 260**. This candidate is **not applied**. It addresses the missing approval-state summary in collapsed leave-import rows; it does not change normalization, eligibility, import payloads or saved values.

## What the candidate shows

| Display | Authoritative source | Meaning |
| --- | --- | --- |
| Approval state in preview | `row.after.status` | The normalized proposal returned by the last preview. |
| Preview input | `row.values.status` | Input returned by that preview, which may already contain operator corrections. |
| Pending refresh message | Existing `previewDirty` lifecycle | Earlier returned values cannot confirm edits made since that preview. |

Missing or null statuses say **Not returned**. Empty strings say **Blank (no approval state)**; whitespace-only strings and unsupported types have distinct explanations. Known states receive readable labels. Unknown strings remain escaped text. Neither import readiness nor a matched member implies that leave is approved.

The first draft called `row.values.status` a file value. Read-only inspection of `backend/app/services/operational_import.py` showed that `normalize_rows` merges corrections into those values before returning them. V2 corrects the caption to **preview input**. V1 and its successful source checks remain preserved; those checks did not prove the original caption accurate.

## Verified so far

- The full-project TypeScript overlay passes.
- Removing only the four new presentation helpers, the additional authority-text call in `say()`, and the leave-only row-summary expression exactly recovers the entire original source. Existing handlers, state changes, serialization and requests remain byte-identical.
- Fifteen extracted-helper cases cover known states, missing/blank values, prototype names and unsupported types. Additional probes check escaping, input/normalized disagreement, stale wording and frozen input objects.
- Twelve real-controller preview workflows pass: three browser engines, 320px and 1280px, leave and unit imports. They retain existing mode/scope handling, correction behavior, stale apply refusal, preview failure/retry and exact locally intercepted apply payloads.
- Unit-import rows do not receive the new leave-specific summary.

The twelve controller workflows currently prove omitted-status handling and stale authority. They do **not** yet prove every known/unknown status through the rendered UI. No production or configured database was used. Apply requests in the fixture are answered locally with a failure response; no data is saved.

## Remaining gates before integration

1. Render all known states, long/HTML-like unknown strings, prototype names and missing/null/empty/whitespace/unsupported values through the actual leave-import controller.
2. Verify disagreements between returned input and normalized status without presenting either as original file content.
3. Edit the status field, hold and fail refresh, retry, move focus deliberately, exclude rows and change pages. The old normalized value must stay visibly stale until a new preview succeeds.
4. Measure normal, enlarged-text and short mobile layouts, including complete labels and controls near the apply area.
5. Recheck affected import recovery, matching and review-context workflows; preserve existing payloads, acknowledgements, frozen previews and no-replay behavior.
6. Review the final candidate, apply it only against the recorded baseline, run applied-source checks and a held build, then explicitly revalidate the existing 40 acceptances.
7. Judge original requirements 145 and 147 against every applicable representation. This row summary alone cannot certify those whole requirements.

## Exact artifacts

- Candidate: `tmp/leave-import-status-v2/operational-import.ts`
- Candidate SHA-256: `da4115875ee785528a22780b10c8f15b561615778a98e5c2f38b2bb687a164c7`
- Source/probe proof: `tmp/leave-import-status-v2/source-proof.json`
- Proof runner: `tmp/prove_leave_import_status_v2.mjs`
- Preview server: `tmp/leave-import-status-v2-preview-server.mjs` on loopback port 5208
- Regression test: `frontend/tests/premium-leave-status-import-regression-preview.browser.mjs`
- Execution record: `docs/premium-ui/reviews/leave-import-status-v2-preview-regression-execution.json`
- Provenance correction: `docs/premium-ui/reviews/leave-import-status-input-provenance.json`

The last sealed applied review package is `tmp/premium-frontend-review-20261029-leave-guidance-40.zip`. Backend files were read only; no push or deployment occurred. Physical-device and native assistive-technology checks remain pending.
