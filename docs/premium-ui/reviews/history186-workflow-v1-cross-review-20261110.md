# Requirement 186 workflow-history V1: independent cross-review

Reviewer: `/root/eta_print_review_nov10`. Source/diff review only; no compiler, browser, unit test, API request or application process was executed. This document is the only authored change. This is not acceptance evidence and does not authorize integration.

## Independently hashed inputs

| Input | SHA-256 |
| --- | --- |
| `tmp/import186-workflow-v1/workflow-import-history.before.ts` | `6af21b09f48bb6632ac7afb78759884d4aa0e9750d520f48be0c79ea3d4b5cf5` |
| Current `frontend/src/workflow-import-history.ts` | `6af21b09f48bb6632ac7afb78759884d4aa0e9750d520f48be0c79ea3d4b5cf5` |
| `tmp/import186-workflow-v1/workflow-import-history.ts` | `b04102c7dd2578e3ccc417920c83d6ff67a8f483059f17ae157e52ce5ff34b18` |
| `tmp/import186-workflow-v1/manifest.json` | `e3489415795c787c2bd2d5fa4bf7497b9f87e4380721f7e67345993dc942cb27` |
| Staged `tmp/import186-filter-v1/history-filter.ts` | `9f4540aabab34b3eb4732b28f415f40281f393d92e49c988c77b9e57d4e5310e` |
| `frontend/src/ui.ts` | `680d7830bca8826b46b6f1dc2c0d064d2a3a2e16fb41188d2c323de6bccf85b2` |
| `frontend/src/services/api.ts` | `5167f842eb4e07cf5216d18bde2ef48ded1a6692490d80dd261e4ceb038a5e3c` |
| `frontend/src/audit-time.ts` | `136542cb2daec343417532d372f2e8ce01a0e6103ef6c62a7a4a8017ac8a6d15` |

The genuine baseline still equals current product source. The candidate is staged only and imports a helper not yet installed in production; it needs an isolated overlay resolving that staged dependency before compilation/browser checks.

## Findings

No static blocker was found in the requested checks. Runtime proof remains required for every behavior below.

**Search input and caret:** `render()` creates its shell once per live mount. Subsequent initial action/busy, successful read, failed read, pagination, download and finally renders replace only list/pager/detail/status regions. They do not replace or set the existing search input's value. Local input calls only `renderBatchList()`. Clear intentionally updates that same input and focuses it. The search count/clear button are stable shell children.

The actual shared `retainActionFocus` implementation was inspected at `ui.ts:278`: it records whether the trigger owned focus, tracks focus entering any other element except body, always removes its listener when finalized, and refuses restoration if focus moved or now belongs elsewhere. Thus typing into the persistent search input while a read/download is held should suppress the action's later focus restoration. This is a source argument, not observed caret preservation. The candidate's existing `.table-scroll` focus restoration also requires the active element to have become body and does not run when search owns focus.

**Busy and download behavior:** Original `busy` assignment, message clearing, click guard, native disabled expressions and finally reset remain. View Rows, rejected download, batch pagers and detail pagers all render disabled during an action. Input/clear intentionally bypass the action busy gate only for local filtering; filtering during a held operation still creates natively disabled action buttons because they use `busy`. No second read/download is authorized by this bypass. The original rejected-download service invocation, arguments and error handling remain exact. No CSV creation, naming, byte transformation or alternate endpoint is introduced.

**Zero local matches and pagination:** The list's zero-match state is separate from an actually empty returned page. Batch pager visibility depends on `history.offset > 0 || history.has_more`, and disabled states depend on busy/offset/has_more, independently of `visible.length`. Search cannot hide a server-provided Next/Previous batch control. Page navigation retains the same month and +/-25 server offset expressions. Query remains a local closure value across page reads, truthfully labeled “Search this loaded page.”

**IDs and details:** View/download actions retain each escaped immutable `batch.id`. `selected` is still assigned from the clicked ID only after a successful detail read, not a filtered row index. Detail paging still uses that selected ID with the same +/-50 offset. If search excludes the selected batch, a text-only notice explicitly names `detail.filename` and selected batch ID. Failed open/download leaves prior detail associated with its original selected ID; navigating batches clears detail as before. Similar filenames and reordered/filter-hidden rows need explicit runtime assertions, but no index reassociation was introduced.

**Displayed search fields and formats:** Search uses exactly the displayed filename, formatted month, account, formatted timestamp when present or recorded status when timestamp is absent, and the displayed `count + outcome label` strings with the same underscore-to-space replacement. It does not search hidden IDs, raw undisplayed timestamps or recorded status that the original cell does not display. Case/whitespace/literal matching is delegated to the reviewed pure helper. Existing `formatMonth`, `formatAuditTimestamp`, row raw/normalized/outcome formatting and escaping expressions remain. The status message moves from escaped HTML interpolation to `textContent`, which remains text-only.

**Mount ownership:** Mount generation/current-owner checks remain; the new input handler resets to null during mounting and checks `isCurrent()` before filtering. The click handler now also checks ownership before doing work. Initial failure/success ignores obsolete owners. Later render checks current owner, and every action finally finalizes `retainActionFocus(isCurrent())`, including stale completion. Some original paginated request results still assign the old closure's state after await without another owner check; they cannot render into a newer owner because render is guarded. No cancellation guarantee is added. In particular, the unchanged download service may finish its existing artifact behavior after navigation; this review does not claim host-remount cancellation of downloads or requests.

## Required runtime gates

- Across held/successful/failed open, both batch/detail pagers and rejected downloads, assert exact search node identity, input value, focus and caret; type before releasing responses, then clear and repeat. Include keyboard and outside-focus cases.
- During every held action, filter to zero and to different batches; verify native disabled states and unchanged request counts. Show batch pager controls persist for offset/has_more fixtures and issue the original month/offset GET after recovery.
- Use similar filenames and distinct batch IDs; assert exact visible IDs/order, correct View/download ID, filtered-out detail context and unchanged detail pager ID.
- Verify displayed-field literal matching, punctuation/casing/whitespace, timestamp zone/missing/invalid fixtures, named parsed rejection bytes and unavailable/empty/expired-session recovery using the existing service.
- Remount/detach during held initial/detail/page/download operations; prove no stale UI/focus update or extra follow-up request. Describe unchanged in-flight download behavior separately rather than claiming cancellation.
- Compile the isolated candidate/helper, run responsive/theme/enlarged-text checks and bind results to exact source/build/environment. Native assistive technology and physical-device checks remain pending unless actually performed.

These findings cover only workflow import history. Dedicated member/past histories and the complete requirement 186 remain separate gates. No acceptance increment follows from this static review.
