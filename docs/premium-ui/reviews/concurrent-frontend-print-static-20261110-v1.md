# Concurrent frontend source review and staged print candidate

Static review only, bound to `tmp/unit-print-state-v1/manifest.json` recorded
2026-11-10T13:05:59Z. No build, browser, unit run, backend operation, acceptance
change, or product edit was performed by this review. Concurrent changes remain
unattributed and preserved.

The manifest hashes current main, operational-import, styles, unit-member-lists,
unit-board-filters, list-pagination, pagination test files, and package.json.
The unit-member source is `bea421d2519c1acaa1f74b73057076aa0870af1b4f6fb07fead99ac839d9b40b`.
The staged candidate is `54810229ccec2d2000aa71eb6e0740529be5286b78b0701adce6b309070d01dc`.

## Findings

`unit-member-lists.ts` materializes only the current screen page. Its print helper
renders complete matching lists and restores the original DOM nodes, but the
printing render writes zero to the shared pages map. Cleanup restores nodes
without restoring that map. A screen list on page 3 therefore restores page-3
content while the subsequent Next action computes from internal page zero.
This is a source-derived concern, pending runtime reproduction.

The helper is already connected: `unit-board-filters.ts` imports it and calls it
from its existing beforeprint/print-media lifecycle; afterprint/media cleanup
restores it. Its current hash equals the frozen original184 snapshot hash
`1c01b57eace54e99d01205fc07273bacbfe1649c4db576763bb55768d0d33766`.
No duplicate print hook should be added. Absence of a direct main import does
not establish an integration gap.

`list-pagination.ts` independently paginates retained DOM rows through a
MutationObserver, button/select listeners and data-pagination-hidden attributes.
It does not call the unit print helper. Its selector covers tables and many
operational/member/rota lists, so representative real application filtering,
action delegation, nested-list exclusion, focus and print checks remain useful.
Retaining nodes avoids losing edited form values; direct children selected as
rows and existing analysis-pager exclusion determine the affected surfaces.

The two new `list-pagination.test.mjs` tests extract native helpers from main,
await esbuild.transform, and execute them in a VM. They contain no explicit
browser, timer, observer or worker loop. Source inspection cannot identify an
execution hang, and no hang conclusion is made.

The browser fixture uses esbuild, Playwright headless Chromium, setContent and
bundled local modules. It needs frontend as cwd, installed dependencies and
Chromium; it does not need an app server, authenticated data or backend URL.
It checks generic list paging, edit retention, filtering, CSS print visibility,
unit-member print row counts and DOM-count restoration. It does not click Next
or Previous after print restoration, so it does not cover the map inconsistency.
It does not establish real application integration acceptance.

## Staged reviewable change and regression

`tmp/unit-print-state-v1/unit-member-lists.ts` differs from its byte-copied
`unit-member-lists.before.ts` only by guarding `pages.set(key,page)` with
`if (!printing)`. This preserves live screen page state while print renders all
matching entries. It introduces no API request or change to record contents;
that narrow statement applies to this staged one-line candidate only.

`tmp/unit-print-state-v1/print-state.browser.mjs` bundles the staged helper with
the actual existing board lifecycle. It checks 34 items at page 3, complete
print rows, original node identity and focus after restoration, Next yielding
30–33, Previous navigation, duplicate beforeprint/cancellation/repeats, and
11 matching items printing completely then continuing through the screen pager.
Run from frontend with `node ../tmp/unit-print-state-v1/print-state.browser.mjs`.
Setting `UNIT_PRINT_BASELINE=1` selects current product source to demonstrate
that the regression detects the issue. Neither mode has been run in this review.

## Baseline and acceptance limits

The frozen source hashes are in
`frontend-build-snapshot-original184-mapping-v5.json`; exact main source is
available under `tmp/mapping184-reference-v5/main.ts`. A bounded source-copy
search and hash scans completed successfully: the operational source at
`tmp/nested-reference-v13r2/operational-import.ts` exactly matches frozen hash
`01d58023203380fedcee010cd3001b8e2bb478397144566ef92142a515a14b38`;
the main copy matches frozen hash
`2b013209784a58b1cee8d8a778131c1d132b5041a378e03753e6abb504d55ce6`.
No exact styles or unit-member copy was found. Both read-only scan sessions
terminated with exit 0; no ongoing scan remains.

The genuine operational diff changes preview pagination from fixed 25 rows to
10/20/30, adds page clamping and a focused size-change control. It contains no
API call or payload modification. Regression should cover selections/exclusions,
edited row values, acknowledgement gating, report completeness and apply scope
across page/size changes; renderReview replaces the review DOM.

The genuine main diff adds native size controls/mobile paginator copies and
global DOM pagination, removes display truncations for suggestions, review
rows, allocation events and other analysis lists, and changes export UI/action.
The new draft assignment export button shares the existing EagleEye downloader
but selects `rotaPublishMonth` for the new button and `rotaTemplateMonth` for the
old button. This is a material action routing change requiring a test with
different publish/template months, alongside existing approved export gating.
The new approved-workbook description makes content claims that this frontend
review cannot verify. Pagination tests should also check filter clamping,
rank numbering where offsets are computed before paginate, independent lists,
mobile/desktop shared state, full exports/printing, and actions on later pages.
No claim is made that the complete concurrent delta preserves all API/effect/
action semantics; missing genuine styles/unit baselines limit the comparison.
Current-delta validation and prior 61-item bindings remain the root review's
responsibility; this document makes no inferred acceptance decision.
