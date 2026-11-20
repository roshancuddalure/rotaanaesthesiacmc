# Requirement 185: independent source and intended-coverage review

Recorded 2026-11-10. This is a read-only review of product and test sources, with this documentary artifact as the only authored change. No browser execution, product modification, process change or new passing result is claimed. Root controls the separate applied R3 execution; preserve prior failures.

## Exact acceptance criteria

Source: `docs/premium-ui/acceptance-criteria/items-174-260.json`, item 185.

Requirement: “Make past-duty import steps consistent with operational CSV workflows while retaining their distinct historical-data explanations.”

Pass conditions:

1. “Past-duty upload, preview, correction, review and apply use the shared import interaction patterns.”
2. “Historical-data explanations and date context remain distinct, and existing historical import payloads and outcomes are preserved.”

Evidence needed: “Historical CSV workflow traces and current/historical date boundary fixtures.” Evidence must identify the relevant source/build and covered fixture, role, state and environment, with untested portions explicit.

## Proposed fresh evidence acceptance map

| Condition | Existing intended assertions / independent source comparison | Required fresh evidence before acceptance |
| --- | --- | --- |
| Shared interaction patterns | `premium-original185-steps-v2-recovery-20261110.browser.mjs`: four shared step states, `aria-current`, select/setup/review/pending-apply/completed stages, blocked and uncertain Apply, same-file and new-file draft reset. `past-duties.ts` and `operational-import.ts` reuse `steps`, `memberMatch`, `applyBlocker`, `retainActionFocus`, `importRowAttention` and `importPreviewAuthorityText`. | Successful applied recovery execution, actual current-source/build binding, and explicit source comparison establishing the shared helpers. Labels may remain context-specific. |
| Correction and review | `premium-original185-steps-v2-boundaries-20261110.browser.mjs`: current-month correction, parser-warning/correction approval, changed resolution, stale authority, fresh preview and original Apply form options/hash. | Successful applied boundary execution preserving the same assertions. |
| Distinct historical context | Boundary suite covers January/previous December, leap February, current month, differing selected/returned month, replayed response, missing returned month/sheet, filename escaping and saved batch context. Recovery suite retains saved context across another draft. Source retains historical fairness/coverage explanations and table/matrix descriptions. | Applied boundary results plus existing exact source/composition preservation proof for explanatory sentences; current tests do not assert every retained historical sentence. |
| Existing payloads and outcomes | Recovery suite observes actual production FormData, file bytes/name, field keys, options and preview hash; template and rejected CSV names/bytes; pending duplicate protection; accepted-save readback recovery using GET only; uncertain Apply re-preview; superseded owner suppression. Boundary suite covers correction options and replayed outcome. | Applied results plus unchanged outcome-expression proof. Boundary success checks only `/Recorded/`; it does not independently assert the full correction-count sentence. Do not describe that weaker assertion as an exact count assertion. |
| Responsive presentation | `premium-original185-steps-v2-visual-r1-20261110.browser.mjs`: 3 engines × 320/844 widths × light/dark, normal and actual doubled computed text, no progress overflow, round step dots containing glyphs, screenshots. | Fresh applied visual results and screenshot review, with current CSS/source binding. |

The runner `tmp/run_past185_v2_applied_r2_isolated.py` intends 6 recovery + 15 boundary + 12 visual contexts and checks all source hashes before/after. R3 must be evaluated from its own unique reports and actual terminal state; intended counts are not completed cases. An earlier suite failure leaves later suites unexecuted.

## Binding and scope limitations

- Bind the final result to the current held production-build snapshot and reconcile any source changes since that build. Runner source stability alone is not a build-input/dist check.
- The cloned tests still read staged `candidatePath` bytes as an equality guard while dynamically importing `/src/past-duties.ts`. Explain this distinction; staged file metadata alone does not establish which applied module was served. Root's current-source server configuration and applied/candidate source equality are necessary bindings.
- Identify the fixture as the admin past-duty workflow with intercepted API transport. The tests do not exercise real authentication/authorization or production API mutation.
- Workbook bytes are transport fixtures, not real spreadsheet parsing. Boundary fixtures exercise table layout. Matrix-layout runtime behavior, real parser integration, native assistive technology and physical devices are outside these assertions.
- Native browser crashes and prior timeouts remain failed/incomplete execution evidence; they neither prove a product defect nor satisfy these pass conditions.

No acceptance increment is recommended until fresh applied results, source/build bindings and the explicit preservation proof are reviewed together.
