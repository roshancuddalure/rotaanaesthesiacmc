# Independent review: extra leave status surfaces

Reviewer: `/root/leave_status_rebase`. This reviewer authored the separate v5 main/theme candidate present in the preview environment, but did not author these member-profile/record-workspace changes or the profile-status test. No independence is claimed for v5 layout. The isolated controller fixture does not import main. This review makes no application or acceptance changes.

## V1 decision: do not apply

The two intended changes are narrow: a static normalized-editor explanation replaces a global availability claim, and legacy Recent Leave displays a readable escaped status label. Independent reverse-hunk inspection recovered all original nonblank lines after removing those exact changes. Imports, 20/27 control opening attributes, 6/2 handler assignments and 19/27 selected effect-call expressions remain identical in record-workspace/member-profile respectively. The review read the complete patch, label sink and actual controller test rather than relying only on the author's proof.

The new v1 label helper nevertheless called `value.toLowerCase()` directly. The exact extracted candidate throws for null, undefined, 42 and an object; the former `escape(l.status)` converted nullish values to empty strings and other values to escaped strings. The API contract specifies a string, but the avoidable loss of malformed-response tolerance conflicts with the frontend regression constraint. Finding `FE-LEGACY-LEAVE-STATUS-TOLERANCE-001` must be fixed before integration. The v1 proposal and failure probe remain preserved.

## Scope and copy accuracy

The new editor guidance accurately limits itself to returned state/session and operation-specific blocking/safety information. Pending requests are not confirmed absence. It avoids the older universal claim that pending leave merely warns in every operation: `rota_safety.person_blockers` separates approved hard blocks from pending warnings, while Balance structural eligibility also considers active pending leave and template pressure uses active overlaps. These services were read only. No new eligibility decision, status option, request value or permission is implemented.

Known legacy states have readable labels, including the canceled alias and case variations. Unknown strings stay verbatim and enter the same existing escape sink, with no prototype-bearing lookup. Canonical workspace formatting remains unchanged. Statuses, dates and session values must still be compared to returned data; humanizing a label does not prove approval, save or assignment safety.

## What the v1 runtime evidence establishes

The normal and stress reports contain six contexts each: three engines and two layouts. Together these are 12 browser contexts, 24 legacy/canonical history controller workflows and 12 nested pristine editors. They check the five known states, alias/case variants, prototype names, long and HTML-like unknown strings, wrapping, full cross-month date attributes, exact editor member/session/status/range, native close/Cancel and opener focus. All GET responses are local fixtures. There is no save or approval mutation.

The launchers are fixture buttons importing real controllers. They do not prove the live Department Members menu or full app route/role matrix. V5 preview theme is separately bound; the final integrated two-TS batch must also run with the actual baseline theme. Physical devices, native assistive technology and software keyboards remain pending. Source hashes and reports do not independently establish terminal exit codes; root retains tool handles and logs.

## Impact on the prior 38 accepted items

Accepted profile items 122–131 potentially touch the legacy profile/history or nested editor and require a current source-delta bridge plus relevant native regression. Nonvirtualized history item 116 must retain every record and date. Item 142 uses the normalized leave editor: the paragraph is presentation only, but actual two-phase Review/Save/readback and the paired monthly workflow need current-source applicability. The two-TS patch does not alter fonts, styles, motion, icons, tables, import, compute, generation, API code, export contents or permission branches. Unrelated accepted evidence should be preserved through an explicit bounded delta review rather than silently rehashed.

Before closing integration, use uniquely named reports/copies so accepted historical raw evidence is preserved:

1. Final profile-status normal/stress and malformed-value fixtures on the integrated two-TS source with the baseline theme, retaining exact source/test/report/log bytes.
2. Real leave approval persistence on the dedicated hardcoded 8025 RAM fixture: individual Review/Save/readback, monthly stale-409/fresh-token flow and unchanged assignment identities.
3. Record close plus applicable profile cancel/pending/identity cases: dirty/pending refusals, exact opener, newer focus and no extra mutation. A narrowly justified unchanged-code bridge can supplement, never relabel old raw results.
4. Profile date cards and editor actions: date attributes/full cross-month ranges, long status flow, action geometry and focus. Profile record-pattern/readback families cover nested payloads, saves and recovery; explicitly explain any family not rerun.
5. Full unit suite and a held-source production build. Independently review the prior 38 delta before refreshing acceptance evidence.

This bounded batch does not complete original 145 or 147: main calendar/day-list statuses, returned safety presentation and other relevant representations remain separate gates. No new acceptance count, backend change, service reset, production write, push or deployment is authorized by this review.

## V2 source addendum

`tmp/leave-status-extra-surfaces-proposal-v2/` changes only the legacy label helper to accept unknown values, convert once using `String(value ?? "")`, classify the resulting string and return it unchanged for unknown states. Independent extraction now returns empty strings for null/undefined, `42` for 42 and `[object Object]` for an object. This preserves the former escape sink's tolerance; malformed string content still gets escaped at the existing render sink.

Independent reverse-hunk/API/control/handler inspection passes again for proposed member-profile `6874284e2437402f0cb00d57841f0d4170d8ecc6f2067ad2a156e38c3b0b69f2` and record-workspace `7c196c12b114c48bf2db4ee57aad7e591d8e3acc7a77cccd15abbad7c349fb8f`. V2 is a source-safe bounded candidate after the original finding's repair; fresh v2 controller/malformed and final integrated regressions remain required. V1's failure is historical, not relabeled as passing.


V2 runtime addendum: both fresh status reports (6normal+6stress) and both malformed/healthy-reopen reports (6normal+6stress) were independently read and bound to current test/candidate bytes. All24previewcontexts have no recorded failure; the exact source/candidate holds match. They establish the bounded controller results above, including nullish/numeric/object/false tolerance and healthy reopen, but do not replace parent terminal logs or final integrated baseline-theme approval/save/close/date/editor/build gates. The v1 JSON is preserved as `leave-extra-surfaces-independent-review-v1.json`; current JSON now recommends bounded v2 integration subject to those explicit gates. No application or ledger was changed by this review.
