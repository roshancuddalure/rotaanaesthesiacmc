# Workflow import history search: independent static security review

Review date: 11 November 2026. Scope: the staged workflow candidate, its genuine baseline, unchanged shared helper and the existing narrow API/type definitions. No tests, compiler, browser, API calls or product edits were executed. This is source-review evidence only; it does not prove security, recovery or accessibility at runtime.

## Source and API preservation

The independently recomputed baseline/candidate/helper hashes match the supplied manifest. The current product owner exactly equals the staged baseline at review time. The five awaited history/detail/download invocation expressions are unchanged and remain in their existing branches: initial history read, rejected CSV download, batch rows read, batch pager and row pager. Month/offset arithmetic and immutable batch ID request arguments are preserved. The helper receives the local query; no search term is added to an API request, URL, storage value or download name. No authorization checks, token/header handling, mutation function, permissions or server behavior are changed by the candidate.

The existing API encodes IDs/month in paths and reuses the authenticated request/download transport. The rejected CSV helper is unchanged: it captures auth generation, calls readDownloadBlob, downloads the returned blob under its existing name, then revokes the object URL. This stage neither synthesizes CSV nor adds another endpoint/download path. Backend authorization and all download transport behavior remain outside the demonstrated static scope.

## Findings and concrete integration actions

1. **No new executable query sink identified in reviewed code.** Query text is assigned to input.value and consumed only by the pure literal helper. The helper trims/lowercases/splits whitespace and uses includes; it does not construct a regex, HTML, selector or executable expression. Search terms span exactly the displayed filename, formatted month, actor, displayed recorded-time-or-status and displayed count labels. An undisplayed status is not searched when a timestamp is displayed. Do not expand this to raw/hidden JSON values without changing the explicit UI scope.

2. **New contextual/error strings use textContent.** The filtered-detail notice interpolates filename and immutable selected batch ID through textContent, so the new notice does not create an HTML injection sink. Status errors previously escaped into HTML now use textContent. Existing filename/account/month/status/key/ID markup continues to pass through escape; raw/normalized/outcome JSON remains escaped. Verify adversarial filename/account/key/query strings in runtime coverage rather than treating this static inspection as an XSS test.

3. **Pre-existing typed-number HTML interpolation remains a defense-in-depth gap.** Both baseline and candidate interpolate count values and row.row without HTML escaping. Their API types are number/nullable number, and this change does not introduce that trust assumption; runtime server data is not validated by TypeScript. A safe presentation-only hardening would escape these interpolations in both list/detail views, preserving numeric text and values, then test deliberately malformed string-valued fixtures. This is a static robustness finding, not proof that the actual endpoint returns attacker-controlled malformed values or that an exploit exists.

4. **Owner guards improve and no stale handler overwrite was identified.** Mount clears previous onclick/oninput handlers before the initial await. New delegated handlers check isCurrent at entry; render/renderBatchList also check connected host/generation. Failed stale reads can still change only their abandoned closure-local message/busy variables, then render returns without repainting a newer mount. The open branch already guards before assigning loaded rows. Pager assignments occur before finally but belong to the old closure; no shared-state write is introduced. This needs delayed-response/remount tests to prove behavior. Readonly reads are not aborted, and the stage should not claim cancellation.

5. **Search preserves its own input node, but batch rows are recreated.** renderBatchList replaces only the list region while the outer search shell remains mounted. Request and download association still comes from the initiating button's captured immutable dataset.batch, not the filtered row index. Filtering during a request must be tested with similar filenames and distinct IDs. The existing focusTarget fallback reaches h3 when a requested batch is filtered out; it does not explicitly return the retained search field. That may be a keyboard UX issue (separately reviewed by the focus/paging specialist), not an authorization defect. Never restore a reference to an old replaced row/button.

6. **Error and download guarantees require runtime work.** The candidate preserves query/shell during ordinary action errors and leaves existing actions for explicit retry. Initial read failure retains the existing Try again behavior; full remount starts a new local query because query is function-local. Decide/test whether same-context explicit remount should retain query. Do not promise download cancellation when navigating away: the unchanged API helper can finish an already requested download after host unmount; auth-generation rejection belongs to transport. Browser cases must verify 503, empty 200, expired session, accepted recovery and unchanged parsed filenames/bytes against actual transport without replaying Apply.

7. **Loaded-page promise remains honest in the new search UI.** Batch paging controls are outside the filtered list region and depend on original server has_more/offset; zero matches does not erase them. Clearing query does not issue a request. The filtered-detail notice explicitly names the retained filename/batch outside results. Source alone does not prove its wrapping/focus/pager behavior or that malformed responses recover cleanly.

## Required evidence before integration/acceptance

Use staged overlay tests with unexpected network aborted and exact method/path capture; verify malicious markup/punctuation stays literal text, undisplayed values do not match, similar filenames retain distinct action IDs, read/download failures retain query and selected detail, old host responses do not repaint, and no writes occur. Include browser-native download artifact bytes and auth/empty-body transport branches through existing API helpers. Run the independent focus/paging matrix, typecheck and held current-source build after integration. No acceptance increment follows from this review.

## Independently recomputed SHA-256 bindings

- `tmp/import186-workflow-v1/workflow-import-history.before.ts`: `6af21b09f48bb6632ac7afb78759884d4aa0e9750d520f48be0c79ea3d4b5cf5`
- `tmp/import186-workflow-v1/workflow-import-history.ts`: `b04102c7dd2578e3ccc417920c83d6ff67a8f483059f17ae157e52ce5ff34b18`
- `tmp/import186-workflow-v1/manifest.json`: `e3489415795c787c2bd2d5fa4bf7497b9f87e4380721f7e67345993dc942cb27`
- `tmp/import186-filter-v1/history-filter.ts`: `9f4540aabab34b3eb4732b28f415f40281f393d92e49c988c77b9e57d4e5310e`
- `frontend/src/workflow-import-history.ts`: `6af21b09f48bb6632ac7afb78759884d4aa0e9750d520f48be0c79ea3d4b5cf5`
- `frontend/src/services/api.ts`: `5167f842eb4e07cf5216d18bde2ef48ded1a6692490d80dd261e4ceb038a5e3c`

The five extracted awaited API expressions match exactly between baseline and candidate.
