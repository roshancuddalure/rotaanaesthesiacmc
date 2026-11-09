# Profile draft, workload and unknown-history browser evidence

All five suites completed successfully against the same held frontend sources. Their raw JSON reports record SHA-256 digests of the declared application files and their own test scripts; a final independent filesystem comparison confirmed every recorded digest still matches.

| Suite | Browser contexts | Nested workflows or recovery cases |
| --- | ---: | --- |
| `qa-profile-section-state.json` | 6 | One canonical and one legacy editing sequence per context; 12 exact locally fulfilled PUTs and 18 exact locally fulfilled comment POSTs in total |
| `qa-profile-section-markers.json` | 6 | Canonical Names selected-range typing and baseline restoration; legacy native required-field validation with an independent sibling draft |
| `qa-profile-workload-unknown.json` | 9 | 108 parent/child workload workflows, plus 9 malformed-list Retry recoveries |
| `qa-profile-workload-values.json` | 6 | 66 returned-analysis/count workflows |
| `qa-profile-unknown-histories.json` | 6 | 624 returned-history workflows |

Total: **33 browser contexts**. Nested workflows are fixture/role sequences inside those contexts; they are not additional browser contexts. The first two suites store sequence-level results rather than `cases` arrays, so a zero nested-array count is not a zero-coverage result.

Chromium, Firefox and WebKit were exercised at 320px and 1280px widths. The nine-context workload suite additionally covers a 320px viewport with the root font set to 200%, plus a 320×480 short viewport. This is browser emulation and root-font enlargement, not physical-device or full browser-zoom certification.

The editing suites verify immediate accessible section markers without replacing the typing node, caret/selection retention, exact baseline restoration, hidden-section local validation and native first-invalid focus, existing loaded/error/Retry descriptions, refused and confirmed discard, save failure retention, successful save clearing and independent sibling drafts. A confirmed comment save followed by a failed profile GET is labelled saved/refresh-needed, disables repeated mutation and recovers through GET-only Refresh.

Workload fixtures distinguish genuine numeric zero from null, missing, empty, string, negative and fractional values; missing reporting periods are explicit. Nested duty history opens the same member with the existing role parameter, retains parent draft values, restores the original workload action on Close and preserves the existing cached leap-February filter contract. Empty or absent workload analysis is explicit rather than a fabricated total.

History fixtures distinguish omitted, null and non-array values from a genuinely returned empty array. They cover seven legacy histories in three existing role contexts, two required canonical identity lists with blocked editing and GET-only Retry, and optional canonical dated-call history. Restricted comments retain their existing visibility guard. Raw fixture responses are not rewritten into invented empty arrays.

The discovered Names marker regression is preserved in `tmp/premium-profile-section-markers-alias-baseline.log`: restoring the original alias text initially retained an unsaved marker because internal alias IDs differed. The final test passes after the presentation-only comparison was corrected; existing global dirty semantics and save serialization remain outside that presentation change.

All API requests were intercepted locally. Mocked write payload equality verifies the existing client contract; it does not certify real backend persistence, authorization, scheduling, aggregate calculation or production behavior. No physical-device or native assistive-technology checks are claimed.
