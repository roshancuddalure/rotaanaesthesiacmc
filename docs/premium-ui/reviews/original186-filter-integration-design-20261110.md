# Import-history filtering: integration design

This is source-review groundwork for requirement 186, not runtime or acceptance evidence. It supplements `original186-current-history-gap-audit-20261110.json` and the independent review messages. No production code or API changes are proposed here.

## Search contract

Use a shared pure predicate for case-insensitive, whitespace-separated literal terms. Every term must occur in at least one displayed filename, actor, recorded status, outcome label/count, worksheet or recorded-time field. Do not interpret input as a regular expression, alter stored values, infer outcomes or serialize new exports. An empty query shows the returned snapshot unchanged and in its existing order.

For workflow history, explicitly label search **Search this loaded page**. Keep the server's existing month, offset and next/previous controls; do not imply a server-wide search or hide pagination when local matches are empty. Member and past-duty histories should likewise describe the returned list rather than promise completeness.

## Preserve the working import and its controls

`past-duties.ts` already has a preview-action filter and an import-changing `onchange` path. A history search needs its own attribute/state. Handle it with an early return before `selectionComplete`, `reviewed`, resolutions or confirmation flags can change. A keystroke must update only the history rows and match-count/empty-state nodes. It must preserve the actual input node, caret, selected file, reviewed preview, warning/correction approvals and open row editors.

Dedicated member/workflow history should also update their list region locally. Do not replace the search input on every keystroke. Keep selected detail state separate from the visible row index and bind actions to immutable batch IDs. If a filtered-out batch's detail stays open, give it an explicit filename/batch context; it must never appear to belong to another result. A clear-search control must restore all returned rows without another mutation or losing the current month.

## Downloads and recovery

Reuse existing download functions and preserve their filenames and bytes. The shared `readDownloadBlob` already rejects empty successful responses before creating an object URL and handles failed responses/session changes. Do not duplicate this logic or invent CSV content from recorded rows.

`WorkflowImportKind` includes member/past values, but that alone does not prove that dedicated member/past history batch IDs identify records in the workflow export store. Verify the existing endpoint/store identity before adding any new history-download button. Existing preview rejection downloads must retain their preview meaning.

Initial read failure, detail failure, empty download and unavailable download should retain query/list/detail context and provide an explicit safe retry using the existing read or download action. Recovering a report must never replay Apply. Keep the existing timestamp formatter, explicit zone/unknown-zone context and raw recorded-time meaning.

## Required verification

1. Search similar filenames and distinct actors/outcomes using multiple terms, casing, whitespace and punctuation; clear search and inspect the exact visible batch IDs and order.
2. Search to zero matches while paginated; verify page navigation remains available and is still the existing GET with unchanged month/offset.
3. Type in the search field while a read resolves; prove input identity, focus and caret survive, and that newer navigation suppresses old updates.
4. Filter past history while a corrected preview is approved; verify the preview/hash/file/options/confirmation flags remain identical and Apply still submits the existing body.
5. Hold/fail detail and rejection reads; retain the filtered list and explicitly identified detail, then retry without a write.
6. Parse named downloaded artifacts and compare exact bytes. Cover empty 200, unavailable response, expired session and accepted recovery using existing transport.
7. Exercise UTC, explicit offset, unzoned, missing and invalid audit timestamps without changing source values.
8. Verify keyboard controls, phone/tablet/desktop, both themes, long escaped filenames and enlarged text. Bind all results to actual source/build and preserve failures.

Implementation should remain staged until the applied requirement-185 browser/unit/build and current-scope revalidation gates have completed. Local process/resource failures do not establish a product defect or a passing test.
