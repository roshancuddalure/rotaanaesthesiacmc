# Registry V10r4: independent source and test quality addendum

Reviewer: `/root/registry_supplement_quality`. Date: 2026-11-09.

Read-only source review; no browser runs or application/test mutations. This adds to `original159-registry-v10r3-independent-test-quality-review.md`. Runtime outcomes belong to the executor's reports and are not asserted here.

## Exact reviewed bindings

| Candidate file | SHA-256 |
| --- | --- |
| main.ts | `9f5359ad9e8014098bc12c8ed3f9e1c6b1a06d1a4f92797b7f9da24bfba6e6b8` |
| reference-workspace.ts | `dbd6d1bdb13893ee49d3f004518177b964101520e2bd2034d8639f1c76f134bd` |
| extra-duty.ts | `529e420fc05ce5bfa42655b8863e449e09e22a7c0abe9baf4db5c94c4797b8c3` |

Lifecycle script reviewed: `frontend/tests/premium-original159-registry-v10r4-lifecycle-r2.browser.mjs`, SHA-256 `9ee9440dc28298affa9179ea213c8f7232a64e3d8acc119e4b5b83f76fb6ff00`.

Companion script hashes observed for executor binding only: owner supplement `eecd32f3b506e9696642f0b274b34bb49190b60fccf324b1bd2f782e2bac158a`; focus supplement `e7a71809794fdb6cc46029aca48189dfd92c50fdea4c3dc2dfb30df65ee7cb4b`. This addendum does not independently re-review those companion files beyond the prior V10r3 review.

## Single-line source change

A byte-decoded diff of V10r3 and V10r4 `extra-duty.ts` contains exactly this single line substitution:

```ts
const selected = names.has(select.value) ? select.value : "", currentDraft = draft.get(id) ?? [];
```

The prior line unconditionally retained `select.value`. The empty-options markup uses `<option>No other units</option>` without an explicit value, so the browser exposes its label as the value. Unconditional retention manufactured a disabled unavailable-unit option for that placeholder and selected it even after a genuine new unit became available. The new guard retains only known unit IDs. Rebuilding options then naturally selects the new first real unit when there was no actual selection. The subsequent Add enabled predicate uses `returned.has(select.value)`, consistent with that behavior.

The `names` map preserves last-known actual IDs and is augmented with returned names rather than cleared, so a previously real selected ID absent from the latest reference set still passes this guard and receives the existing disabled unavailable option. The guard does not alter draft order, saved order, mutation payloads, or persistence. Source reasoning supports the narrowly intended placeholder fix. A real-unavailable-selection browser case remains a separate coverage opportunity, not something established by the create scenarios.

## Test improvements and bounds

The lifecycle r2 script still contains 13 modes × three engines × two widths = **78 authored contexts**. It points to isolated preview port 5301 and the V10r4 manifest, checks baseline files, candidate hashes and actual served inline-source-map content before the loop, and checks local files and candidate hashes after the loop. It writes a unique report and asserts aggregate completion after preserving caught per-context failures. The full-source-freeze limitation recorded in the prior review still applies.

The new assertions materially close the prior reference-content gap:

- Accepted target-rename scenarios assert the existing fallback item's text includes `Royal Renamed registry-b` and its remove button's exact accessible name is `Remove Royal Renamed registry-b`.
- Both ordinary create and direct-create assert that the original retained owner's select has actual value `registry-d`, is enabled, contains exactly labelled `Royal Created D` option for that ID, and has its Add button enabled. This detects the placeholder selection bug rather than merely checking option existence.
- Existing host/row/select identity, unsaved order, filters, request counts, no replay, new owner returned order, and empty-state checks remain in the suite.

The script does not additionally assert the up/down accessible names or visible renamed owner heading. The existing remove-label check is a useful representative of the shared action-label update loop; do not describe it as three directly checked action labels. The added option check establishes selectable content and enabled Add state, but does not execute Add or persist/reload the unrelated draft. Those original handlers need their separate source-contract proof.

Verdict: the single-line fix is coherent with the component's existing unavailable-ID preservation contract, and the amended exact-candidate assertions directly detect the observed placeholder regression and the principal rename/new-option behavior. No further blocking issue found in this narrow source/test review. Runtime success, independent source integration approval, build/unit checks and remaining item-159 families are separate gates. Whole item 159 remains partial.
