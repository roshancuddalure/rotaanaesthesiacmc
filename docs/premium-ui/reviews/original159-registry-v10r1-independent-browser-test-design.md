# Registry retained-parent browser test design

Author: `/root/registry_test_design_v10`. Read-only inspection, 9 November 2026. No application edits or browser executions performed for this review. This document proposes tests; it is not passing runtime evidence.

Inspected `frontend/tests/premium-original159-registry-v10r1-fallback-recovery.browser.mjs`, the three V10r1 candidate files, `workspace-load-state.ts`, and the existing import owner-supersession test pattern. V10r1 candidate hashes are main `ea77a0f96a9f7e168489c7c7a2315bd7e631fe02b985cfd61b8b0ab185fdb2ac`, registry `dbd6d1bdb13893ee49d3f004518177b964101520e2bd2034d8639f1c76f134bd`, fallback component `96ec1451980ea1dda2ce9bc0f96401d3d3e57d78512962b81ab777d649a4a592`.

## What the existing six cases actually prove

They rename target B while owner A has an unsaved reordered list C,B. They check original host and owner row identity, retained order, enabled Save order, the renamed target text, retained search and campus values, one PUT, and no page errors. They log read counts but do not assert exact read deltas. They do not cover new owners, owner names, source-selection identity/value, exact final-close sequencing, failed readback, or expired owners.

Two source issues deserve direct regression cases before integration: the owner list's `ol` accessible name is built from the original `row.unit_name`, including after a later `repaintUnit`; and inserting the first actual owner does not remove the original `.extra-duty-empty` paragraph. Neither is covered by target-B rename.

## Reusable fixture and reliable observability

Retain the A/B/C fixture and all production-source hash checks. Add D with a unique ID, campus, code, name and revision. All normalization writes must be locally fulfilled and recorded; reject every unexpected non-GET, including fallback PUT. Use one isolated page per scenario. Keep request phase separately from total counts: `initial`, `registry-open`, `mutation-accepted`, `registry-own-read`, `parent-read`, `retry`. Distinguish GET `/api/v1/normalization/units` from GET `/api/v1/unit-management/month` and GET `/api/v1/extra-duty/unit-fallbacks`.

Use an explicit deferred promise to hold one identified request, signal when its route handler is entered, steer the UI, then release. Avoid sleep-based inference and avoid `networkidle` with an intentionally held request. Resolve all gates in finally before `unrouteAll`. Wait for the visible failure/status or intended destination rather than assuming response completion means DOM commit. Capture observations and route logs on every assertion failure, then fail after writing all contexts.

Controls: toolbar `[aria-label="Unit actions"] details.row-menu > summary`, `[data-manage-department-units]`, direct creation `[data-add-department-unit]`; dialog `getByRole('dialog', {name:'Manage department units', exact:true})`; choose `[data-select-unit="registry-b"]`; edit `[name=name]`, `[name=campus]`, `[name=code]`; submit `getByRole('button', {name:'Save unit', exact:true})` (inspect creation button text rather than assuming it matches); normal close `[data-close]`; loading/error close `[data-load-close]`; saved-read retry `[data-load-retry]`; parent retry `[data-retry-profile-parent]`; parent region `[data-profile-parent-refresh]`. Scope every registry selector to the dialog to avoid matching parent actions.

Fallback observations: `[data-fallback-unit="registry-parent"]`, `summary > strong`, `ol.extra-duty-fallback-list`, `[data-fallback-item]`, `[data-fb-select]`, `[data-fb-save]`, `[data-fb-reset]`, `[data-fb-up]`, `[data-fb-add]`. Store exact references to host, row, select, chosen move button and Save button before opening registry. Assert nodes retained immediately after reference commit, not after deliberately clicking a component action that normally repaints that row.

## Priority execution cases

1. **Deferral while open.** Rename B and finish the registry's own GET, but leave the dialog open. Assert accepted PUT=1, registry own GET=1, and parent board/fallback GET deltas=0. Parent may show pending status; it must not claim current yet. Close once and assert precisely one board GET and one complete fallback GET.

2. **Two saves coalesce.** Rename B, then C in the same registry. Two PUTs and two registry own GETs; zero parent GETs while open. Final close produces one parent pair and both latest names; original A order C,B remains dirty. Assert no normalization or fallback mutation on read retry.

3. **Manage-list creation.** Inside Manage department units click `[data-new]`, fill D with explicit unique code (avoid an untracked suggest-code race), POST once. Manage mode remains open until explicit close. Final parent read adds actual returned D owner exactly once and adds D as an eligible option in A without replacing A's select or losing its preselected value/order.

4. **Direct creation auto-close.** Use `[data-add-department-unit]`, POST D. The `createNew` branch closes automatically after acceptance without requiring the registry own read. Assert one parent pair, exactly one D owner, and no duplicate final-close refresh from the native close event.

5. **New owner's actual initial order.** Return D with fallback order C,B in the complete fallback GET. Assert D initially displays C,B and its Save order is disabled. Never infer an empty saved baseline merely because D was just created. Then reorder D and discard: it returns to C,B.

6. **First unit from empty state.** Start with empty board, empty normalized registry and empty fallback snapshot. Create D. Assert one actual D details row, automatic-order state, disabled Save order and absence of `.extra-duty-empty`. Retain the original fallback host. This catches the current append-only empty-message defect.

7. **Rename the owner itself.** A has C,B dirty order. Rename A. Assert its summary and `ol` accessible name use the new A name; A's row, controls, order and dirtiness remain. Then click Move down on C (normal component repaint) and assert the accessible name still uses new A. Check no stale old owner name in either list accessible name.

8. **Preserve current option selection.** Add D to the initial snapshot, choose D in A's `[data-fb-select]` without adding it, then rename B and close. Assert the select DOM node and selected ID D survive; its label/options reflect current names and include neither self nor existing C/B draft IDs.

9. **Registry own GET fails, then retry.** Accept one PUT, fail only the immediately following normalized-units GET with 503. Wait for heading `Change saved; refresh unavailable`; assert accepted saved copy and no parent GET while open. Click dialog `[data-load-retry]`, succeed the GET, and assert no second PUT. Final close refreshes the parent once and preserves the draft.

10. **Registry own GET fails, then close.** Same accepted PUT and failed own read, but click `[data-load-close]` without retry. Parent must still read once and reflect the accepted rename. A child read failure must not suppress the accepted mutation notification.

11. **Parent board GET fails.** After final close fail only first `/unit-management/month` parent GET. Keep fallback GET valid. Assert stale/preserved-data status, retained A draft and one mutation. Parent retry succeeds with one more board/fallback pair, then reports reflected changes. Assert PUT stays at one and no fallback PUT occurs.

12. **Parent fallback GET fails.** After final close succeed board GET but fail only complete fallback GET. Assert retry appears and no success claim. On retry return valid references. Check draft identity/order at failure and after success. Track both GETs because Promise.all can reject while its other read is still pending.

13. **Malformed fallback shape.** Return duplicate owner IDs, non-array `fallbacks`, or non-string target ID in separate contexts. Each must yield recoverable stale status without labels/order/node loss or success claim. Retry with valid data; no mutation replay. Bind this to consumed-shape checks rather than asserting arbitrary backend policy.

14. **Missing target or selected option.** Initial D is selected but not yet added; later complete snapshot omits D. Existing B/C dirty order survives. D's retained select option is explicitly unavailable/disabled and Add is disabled until a returned valid option is selected. Separately omit a draft target: its ID/order must remain, its last-known label must be marked unavailable, and no silent pruning/write is allowed.

15. **No save cancellation.** Open then close an untouched registry; zero write and zero parent pair. Edit then reject `Discard unsaved unit details?`: dialog remains, name draft remains, zero parent GET. Accept discard and close: still zero parent GET, because no accepted mutation exists.

16. **Save then reject later draft discard.** Accept rename B, then type an unsaved second name. Dismiss the close confirmation. Dialog and new text remain; accepted PUT count one and parent GET zero. Accept next discard; parent refreshes only the confirmed name, not the unsaved second text.

17. **Busy refusal.** Hold the PUT before fulfillment. Assert controls frozen; Escape does not close and does not prompt discard; parent GET zero. Release once; complete own read; final close yields one parent pair. Do not force-click disabled controls and call that a real user behavior.

18. **Native close idempotence.** After accepted save, call `HTMLDialogElement.close()` in page evaluation to exercise the native event integration directly. Expect one parent pair and retained draft. Explicitly label this a programmatic native-event test, not an emulated user close. Also test real keyboard Escape after a clean accepted save.

19. **New focus/selection during pending refresh.** Hold the final parent pair, focus and type a new value into `input[data-unit-board-search]` and select a different valid `[data-fb-select]` option. Release responses. Assert newer values and active element survive; notices do not steal focus. If the board filter changes invalidate fixture selectors, observe the fallback host independently.

20. **Route owner supersession.** After accepted save but before final close, programmatically navigate to `#view=user-guide` and await `#guide-checklist`. Then dispatch final native close. No expired parent's board/fallback read or status resurrection. Separately close first, hold the parent pair, navigate, release: old responses cannot modify Guide or restore Units.

21. **Month owner supersession.** While accepted registry remains open, dispatch a real `change` event from `#working-month` after setting `2026-12`; classify this explicitly as programmatic background steering because a modal blocks normal pointer access. Wait for the new-month board. Snapshot phase counts, then close old dialog; no old-month parent pair. Repeat with already-pending old parent responses and release after new month is visible. Return proper December start/end dates; do not reuse November metadata.

22. **Account owner supersession.** Follow the existing import owner test's actual signout path. After accepted save, sign out before final close or while parent reads are held. Wait for login form before releasing old results. Assert no old-account status, labels or Units restoration and no post-steering parent pair. Allow the existing API generation guard to reject old reads; classify expected rejected read separately from browser page errors.

23. **Fallback editor initially unavailable.** First fallback GET returns 503 or the existing feature-disabled response; board remains usable. Save/close a registry change. Observe whether the new reference read plus missing component reader causes perpetual parent stale status. A board success must not falsely claim fallback choices loaded. Decide and document the intended recovery path: recover fallback component first, then parent retry, or independently report optional fallback failure. Do not silently classify this as a successful complete refresh.

24. **Fallback save races with reference refresh.** Initiate a genuine fallback Save order, hold its locally fulfilled PUT, then exercise a separate accepted registry parent refresh through explicit fixture steering. Reference updates must retain the saving control state and must not produce another fallback PUT. Release the accepted fallback response and check its saved baseline/label rendering remain coherent. Clearly label background/programmatic steering; normal modal pointer access does not permit simultaneous interactions.

## Suggested bounded matrix

Run core rename owner/target, direct/manage create, first owner, own-read recovery, parent-read recovery and Escape through Chromium/Firefox/WebKit at 320 and 1280. Run explicit account/month/route supersession and gated races in Chromium at both widths first, expanding engines if actual failures or implementation changes justify it. Record exact coverage; do not multiply a source review into runtime contexts. Preserve separate candidate and integrated reports, source-map overlay verification, raw failure artifacts, and request-body privacy. This matrix can close the registry family; it cannot alone accept all of original item 159.
