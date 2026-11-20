# Original 186: independent past-history V2 cross-review

Scope: static review only, requested against the genuine baseline. No candidate or product edits, compiler, browser, test runner or server launch were performed. The small review script only read/hash-compared files and wrote its tmp comparison artifact. This document does not accept original 186 or establish runtime correctness.

## Hash binding and unchanged product source

Freshly read SHA-256 values:

| Artifact | SHA-256 |
| --- | --- |
| `tmp/import186-past-v2/past-duties.before.ts` | `ca145769e2d8d4c00d37de57852acc2ab83c321d1761a5c5545c3da888fa729d` |
| `tmp/import186-past-v2/past-duties.ts` | `5256b39117157b89e9fd1b0f802a604307629211266a0223b22bcac42e9dd9f8` |
| `tmp/import186-past-v2/history-filter.ts` | `9f4540aabab34b3eb4732b28f415f40281f393d92e49c988c77b9e57d4e5310e` |
| `tmp/import186-past-v2/manifest.json` | `c923b4f9081a0b9a4f6f9f09d8b2c480a4126b7d1c7b492305c9012ac3efb82e` |
| Current `frontend/src/past-duties.ts` | `ca145769e2d8d4c00d37de57852acc2ab83c321d1761a5c5545c3da888fa729d` |

The baseline matches the current product source at review time. Independent slice/call comparisons are recorded in `tmp/import186-past-v2/independent-static-comparisons.json`, authored by `tmp/review_history186_past_v2_static.py`. These are text comparisons, not executed application tests.

## Findings

No static blocker was identified in the reviewed V2 busy-gate repair. The original batch-history action used the shared `busy` flag, rendered both upload/fairness fieldsets disabled and disabled batch/refresh controls. V2 keeps that global exclusion: `loadHistoryRows` rejects busy requests, sets `busy=true` and `activeAction='history'`, clears the same global message, natively disables the existing fieldsets and history/refresh buttons in place, then restores them after the owning request completes. Existing general actions remain behind the shared busy gate. The uploader's change handler still rejects changes while busy; the confirmation/blocker calculation is unchanged.

The added Clear and query handlers deliberately run during a read, but touch only local history presentation. A filtered replacement row button gets its native `disabled` attribute from the same current global `busy` flag. Completion restores captured original button states by immutable batch ID, including replacements. Previously hidden rows default to the baseline non-busy state, which is justified here because the baseline's batch buttons had no independent disabled condition beyond `busy`. This assumption must be revisited if future row-specific eligibility is added.

Fieldset disabling preserves children's own disabled properties, including Read Worksheets remaining disabled without a file. Restoration retains each captured fieldset's original disabled property and skips detached controls. The candidate does not emulate native disabling with `aria-disabled` alone. Its extra row-specific `aria-disabled` merely identifies the loading batch.

The request records an immutable batch ID, increments a local request sequence, and checks both mount ownership and sequence before rendering success/error or clearing busy/restoring controls. The `finally` path always releases the existing `retainActionFocus` listener even when ownership is stale; it suppresses focus restoration for a stale owner. A stale request does not re-enable a new mount's controls. This is stronger local history ownership than the baseline's history branch, while preserving the same read endpoint and ID argument.

The history input's `input` handler updates only history rows/count/Clear state. It never calls the full uploader render, and its `change` handler returns before the original selection-complete/reviewed/confirmation resets. During a history GET, the candidate also avoids the full uploader render. The actual selected File input, approved preview, row-editor nodes, options/resolutions, checkboxes and open detail nodes therefore remain intact by construction in those paths. Browser identity/focus proof is still required. Other existing actions continue their baseline full render behavior; this review does not claim input identity across every unrelated action.

Existing detail HTML remains associated with its own captured batch ID and returned filename, including while another request is pending or fails. Local filtering does not replace detail nodes. On a failed request for B with A still open, the failure explicitly names B and A's detail continues to identify A. Reviewers should verify that combined presentation in the browser rather than infer that `selectedHistoryId` means the currently displayed detail has already changed.

## Preserved expressions and semantics

The following complete slices compare byte-for-byte after newline decoding: previous-month/options initialization; `blockerText`; original uploader/preview markup; original change-handler decisions after the search early return; saved-context/success/replayed outcome and Apply follow-through; and existing non-history action execution from the rejected-CSV branch through action cleanup.

The original Inspect, Preview and Apply calls retain their original file/options/hash arguments; fairness saving retains policy/effective-from; rejected-preview CSV retains `past_duty_rejected_rows.csv`; template download retains `past-duties-template.xlsx`, original blob transport and object-URL cleanup. The history read necessarily moves from `getPastDutyHistory(target.dataset.pastBatch)` to `getPastDutyHistory(id)` with `id` captured from that same dataset value; the explicit retry uses the captured selected batch ID. This is an intentional handler refactor, not an exact-expression claim for that one call. No new download action or endpoint is added.

The displayed `formatAuditTimestamp(h.at, "Asia/Kolkata")` expression is unchanged and reused for matching. Its occurrence count increases from one to two because the candidate searches the displayed formatted timestamp as well as rendering it. Stored date values, previous-month arithmetic, coverage values, outcome labels/counts and row serialization are unchanged. Literal matching uses the staged shared helper; no regex, server filter, export transformation or row-order change is introduced.

## Concrete evidence gaps before integration or acceptance

1. No compile/typecheck has run for this candidate. Verify the real API history field types against the helper's `readonly string[]` contract and compile the exact candidate/helper bytes.
2. Hold a real candidate-module history GET with a corrected preview, warnings/corrections approved, selected file, open row editor and unsaved fairness values. Assert object/node identity and unchanged value/state both while held and after success/failure. Checking only visible text is insufficient.
3. During that held GET, inspect native `:disabled` and effective fieldset disabling for template/inspect/preview/Apply, all resolver and confirmation controls, fairness saving, refresh and every history row. Attempt pointer/keyboard actions and programmatic delegated events; no second read/write/export should occur. Search/Clear remain usable and issue no request.
4. Reveal a previously hidden row while held, replace a previously visible row through successive queries, then resolve/fail the GET. Verify every replacement is natively disabled while held and correctly enabled afterward; independently disabled original controls remain disabled. Verify Read Worksheets stays disabled when no file exists.
5. Remount the same host while a GET is held, then resolve and reject the old request in separate cases. New DOM, busy/control states, query, detail and focus must remain untouched. The old focus listener must be released. Request count must demonstrate that retry cannot run concurrently.
6. Verify focus/caret when typing during read completion, when moving focus outside the host, when the requested row is filtered away and when a successful retry hides its own button. Test failure B with detail A still open and confirm both batch contexts remain intelligible.
7. Exercise mixed-case multi-field AND queries, literal punctuation, whitespace-only/clear, zero matches, long escaped filenames/actors/sheets and exact stable IDs/order. Assert no XSS elements are created and the same loaded snapshot is restored without a request.
8. Compare actual request bodies, server outcomes, saved/replayed text and CSV/template filename/bytes with the genuine baseline. Exact source slices support this requirement but do not prove transport/download behavior. Include existing failed/empty/session-expired download and safe read retry cases without replaying Apply.
9. Run the agreed responsive/theme/enlarged-text and three-engine matrix, including keyboard/scroll-region behavior and status announcements. No physical-device or native assistive-technology claim follows from this static review.
10. After any integration, bind current-source browser/unit/build evidence and revalidate affected earlier accepted scopes. Other original-186 history components and all other frontend requirements remain separate gates.

Disposition: suitable to proceed to independent candidate compilation and focused regression testing when the root permits runtime work. Still unintegrated, untested and unaccepted.
