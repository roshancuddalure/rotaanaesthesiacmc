# Requirement 185: independent static preservation and shared-pattern review

Recorded 2026-11-10 by `/root/eta_print_review_nov10`. This immutable source review supplements, and does not replace, applied browser/build evidence. Only this document was authored. No product edits, tests, application processes or API calls were performed.

## Inputs and independent reconstruction

| Input | SHA-256 |
| --- | --- |
| Genuine integration baseline `tmp/past185-v2-integration-before/past-duties.ts` | `659bc4a927a8d4efbaf0ab0050941262555319e3fbc1ca85064332435ea32bd1` |
| Current applied `frontend/src/past-duties.ts` | `ca145769e2d8d4c00d37de57852acc2ab83c321d1761a5c5545c3da888fa729d` |
| Declarative staging script `tmp/stage_past185_v1.py` | `3c9719eb3375886e385831eafc9f02dac6b35474533dc1f459d06029996f8579` |
| Existing proof `tmp/past185-steps-v1/composition-proof.json` | `67200da20e9eff189ebf64805436d738e0771cb9c8e29b4fecacc5c5ed003173` |
| Current `frontend/src/operational-import.ts` | `d98a64b3e73ac13f1d2eb40e5c646a8bad02b608134d2b2ae217e5d2ec97afdd` |
| Shared `frontend/src/ui.ts` | `680d7830bca8826b46b6f1dc2c0d064d2a3a2e16fb41188d2c323de6bccf85b2` |

I read the baseline/current diff and staging script. I independently parsed the script's literal `replace(old,new)` calls with Python AST, without executing that staging script, and applied them in memory to the genuine baseline. Exactly **10** replacements were extracted; every old string occurred exactly once at its replacement step. The reconstructed text equalled the current applied source exactly. Thus all applied TypeScript source differences are completely explained by those ten replacements; this is an independent forward reconstruction of the existing reverse-composition proof. Byte hashes above bind the actual CRLF-bearing input files; reconstruction used Python's normal text newline handling.

The ten edits are:

1. Import the existing shared `steps` helper from `./ui`.
2. Add local `savedContext`, `selectionComplete` and `activeAction` presentation state.
3. Derive the displayed progress stage from that state, file/preview presence and pending Apply.
4. Render shared steps with historical labels and selected-month context.
5. Append escaped, explicitly scoped saved filename/month/sheet context within the existing saved-outcome section.
6. Reset completion alongside existing settings-change review invalidation.
7. Reset completion alongside existing one-click member/resolution review invalidation.
8. Reset completion for a real Inspect/Preview action, and record the active presentation action before the existing busy/render path.
9. Capture saved context and mark completion after accepted Apply and the existing current-owner check, before existing preview clearing/outcome construction.
10. Clear the active presentation action in the existing finally path.

The V2 manifest states the TypeScript file is unchanged from V1; its candidate hash equals the current applied hash above. V2's separate CSS additions are scoped to `[data-past-progress]` and concern dot sizing/label wrapping; this TypeScript reconstruction makes no whole-stylesheet preservation claim.

## Shared interaction patterns

The applied past-duty source imports `steps` from `./ui` and actually calls it in render with `['Select workbook', 'Set up', 'Review', 'Apply']` and the computed stage. This is helper reuse rather than a copied imitation of the markup.

The current operational CSV source imports the same helper. Its `IMPORT_STEPS` is `['Upload file', 'Map columns', 'Review rows', 'Apply']`; both initial dialog rendering and `setStep(index)` call `steps(IMPORT_STEPS, index)`, and accepted completion uses the labels' length. Both therefore use the same four-position shared progress implementation while their labels retain their distinct input/setup context.

Both modules also retain shared `memberMatch`, `applyBlocker`, `retainActionFocus`, `importRowAttention` and `importPreviewAuthorityText` usage. This establishes source-level interaction-pattern consistency. It does not imply identical workflow transport, file formats, normalization semantics or every UI control.

## Preserved historical explanations and data semantics

The following existing explanatory text remains unchanged outside the ten replacements:

- Completed duties update statistics and future person-allocation scoring; existing member call levels remain unchanged.
- The separate assignment-table and department-matrix layout descriptions.
- Preview month/worksheet context, returned new/unchanged/corrected row explanations, correction confirmation and local hospital-time explanation.
- Observed coverage is not proof of a complete roster; missing history is not zero workload; fairness uses observed months.
- Historical fairness ranks observed burden among active peers of the same current call level, with unknown history neutral and safety/leave rules authoritative.
- Saved-readback failure retains the saved outcome and explicitly describes its retry as read-only.

The new selected-month paragraph and saved-context paragraph add context without replacing these explanations. Every new filename/month/sheet interpolation uses the existing escaping function; missing returned month/sheet uses `Not returned` rather than invented values.

The full reconstruction and reviewed diff also establish these exact original expressions/branches are unchanged:

- Previous-month calculation: construct a midday local date from `status.today`, call `setMonth(getMonth() - 1)`, and form the same selected `YYYY-MM`; the original selected-month maximum remains `status.today.slice(0,7)`.
- Initial `PastDutyOptions`, layout/header/mapping/resolutions fields, selected worksheet mapping, row corrections, warning/correction flags, and preview-invalidating branches.
- `pastDutyUpload` Inspect and Preview arguments and accepted Apply's original `file`, `options`, and `preview.preview_hash` arguments; no replacement transport or serialization is introduced.
- The blocker checks, warning/correction approvals, original preview refresh, busy guard/fieldset behavior, member-choice handling and existing current-owner checks.
- The exact accepted outcome expression remains `result.replayed ? ... : ...`, including the original no-additional-duties replay message and original `result.counts.create`, `.correct`, `.unchanged` interpolation. Thus correction-count success wording is preserved even though the boundary browser test's successful outcome assertion is only `/Recorded/`.
- The original successful Apply readback, readback-error recovery, Apply-error review invalidation and retained action-focus restoration.
- Existing template download and preview-rejection CSV calls/filenames, fairness save call and history GET call; no endpoint or export content expression is changed.

This closes the **static source-preservation/shared-pattern evidence gap** for these exact baseline/current hashes. Applied runtime and source/build applicability remain separate gates. No backend parsing, real spreadsheet fixtures, native assistive technology, physical-device behavior, production authorization or live mutation is established here. Existing failed/incomplete browser evidence remains unchanged and must remain visible in the final acceptance record.
