# Registry V10r3: independent test quality review

Reviewer: `/root/registry_supplement_quality`. Date: 2026-11-09.

This is a read-only review of the three test scripts listed below, plus the candidate ownership/readback code they exercise. No browsers were run, and no application or test sources were changed. Passing runtime results must come from the executor's separate reports. This does not accept original item 159 or certify the whole application.

## Exact authored coverage

| Script | Contexts | Coverage boundary |
| --- | ---: | --- |
| `premium-original159-registry-v10r3-lifecycle-r1.browser.mjs` | 78 | 13 modes × Chromium/Firefox/WebKit × 320/1280 widths |
| `premium-original159-registry-v10r3-owner-supplement.browser.mjs` | 12 | Six modes × Chromium × 320/1280 widths |
| `premium-original159-registry-v10r3-focus-supplement.browser.mjs` | 4 | Two focus modes × Chromium × 320/1280 widths |
| Total | 94 | Contexts, not independent assertions or accepted requirements |

The lifecycle r1 modes are normal rename, owner-name rename, two accepted saves, registry create, direct create, first unit, own-list GET retry, own-list failure then close, board GET retry, fallback GET retry, malformed fallback duplicate-owner retry, dirty-close refusal, and no-save close. The owner modes are route/month/account steering, native duplicate close, accepted-save followed by dirty-close refusal, and busy-save Escape refusal. The focus modes cover a replaced board action and a surviving search input after successful primary read but optional fallback read failure, followed by GET-only retry.

The earlier 72-context report is a separate historical run; its six first-unit setup failures must remain failures. The corrected 78-context r1 script sets no campus filter when no units exist and introduces direct-create coverage. Do not add the two runs together as 150 successful contexts.

## What the assertions substantiate

- All three scripts require a unique report path and retain per-context caught failures in that report before the final aggregate assertion. Infrastructure failure before the loop or final hash checks can still terminate without a completed report; the executor log and exit status remain necessary.
- The manifest binds three candidate files to their baseline hashes. Before running, each test checks the real applied file hash, scratch candidate hash, and candidate content in the preview's inline source map. After running it checks local applied and candidate hashes again. This is useful exact-source attribution for these three files; it is not a freeze of every application module, stylesheet, fixture, or served transform throughout the run.
- Mutation routes permit only the specified local normalization PUT/POST endpoints. All other non-GET requests fail the route assertion. Remaining GETs use the disposable local fixture. Assertions cover write counts and ensure GET-only retries do not replay the accepted save.
- The lifecycle script checks actual host, owner row and select node identity, dirty order, Save enabled state, filters, and exact parent/fallback request increments. Two-save mode checks coalescing into one parent close refresh. First-unit mode checks insertion of the owner row and removal of the empty-state paragraph.
- Owner supplement native close checks one close event and one parent read pair after repeated native close calls. Busy mode observes an actually pending PUT, disabled close, Escape refusal, and no parent reads before release. The accepted-then-dirty mode checks prompt refusal retains the new draft, with two prompts by final close and one accepted write.
- Focus supplement gates the optional reference request, observes both post-close request events, focuses an actual parent control, then releases a 503. It distinguishes replacement of that node from retention, checks focus recovery or preserved selection, and verifies GET-only recovery. The event-arrival polling has a 10-second deadline; both supplements release outstanding gates in `finally`. No obvious unbounded fixture gate/deadlock was found in these paths.

## Bounded gaps and recommendations

1. **Rename/create reference content needs an exact V10r3 assertion.** Lifecycle normal mode does not assert the renamed fallback target's visible label, its up/down/remove accessible names, or updated option labels. Owner-name mode checks the ordered-list accessible label but not the visible owner heading. Create modes assert the new owner and its returned order, but not that existing owners gain the new unit as an available option. A stale reference implementation could pass many current assertions. Add a small focused exact-candidate content test, or cite another exact-V10r3 report that already checks these outcomes.
2. **Owner steering scope is pre-read suppression.** All three owner-expiry modes steer after the accepted save and before final registry close. They prove that an expired owner does not start old parent reads at final close. They do not exercise a GET already in flight when route/month/account ownership changes, nor out-of-order parent responses. Such protection may be established by separate source review or other tests, but must not be attributed to these 12 contexts.
3. **Keep cross-engine boundaries explicit.** Native close, busy refusal, owner expiry, and newer-focus coverage are Chromium only. The lifecycle suite does not extend those outcomes to Firefox/WebKit. Neither suite is a physical-device or native assistive-technology check.
4. **Missing/unavailable references are not covered.** No scenario removes an owner or target from the complete fallback readback, adds archived-only complete-list members absent from the month board, or returns unavailable component bindings. No delayed owner-supersession read, initial component-load race, permission-denied read, timeout, or network-abort case is included here. These are bounded follow-up coverage opportunities, not observed application defects.
5. **Payload preservation needs separate proof.** Recording an accepted write and its count does not prove equality with the prior mutation payload contract. Keep the root's exact mutation-expression/source comparison alongside the runtime packet. These tests also do not save/reload the intentionally retained unrelated fallback draft; they establish its in-memory preservation only.
6. **Some fixture branches are inherited and inactive.** The owner supplement imports Firefox/WebKit and contains first-unit/own-read/parent-retry branches that its six-mode loop never selects. This does not inflate executed counts, but those branches must not be described as covered by the owner supplement.

Verdict: useful and coherent bounded regression design, with no evident guaranteed false pass for the asserted node/order/request/focus outcomes. Before claiming the new reference-refresh behavior itself is verified, obtain exact-candidate visible-label, accessible-action-label, and existing-owner new-option assertions. Keep the whole requirement partial until the remaining mutation families are covered.
