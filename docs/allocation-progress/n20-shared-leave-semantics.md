# N20: shared leave semantics and consumer reconciliation

Status: Done against original N20 acceptance. 16/50 complete; final reconciliation below supersedes earlier checkpoint notes.

## Implemented foundation

`backend/app/services/leave_semantics.py` is a pure module with no database, optimizer or model-service dependency. It owns immutable approved/pending/active sets, existing case handling, inclusive request-date enumeration, known versus unresolved slots, hospital-local leave bands, identity-time interval union and the existing duty start-hour rule.

- Status matching remains case-insensitive, without silently correcting stored whitespace or misspellings. Reference aliases still resolve at write entry points. Historical `aproved` or `approved ` is not silently promoted to approval.
- FULL_DAY is [00:00,next 00:00), AM [00:00,12:00), PM [12:00,next 00:00), NIGHT [00:00,08:00) and [18:00,next 00:00) on each stored date. Date clipping preserves stored ranges and month/leap boundaries.
- Unknown/CUSTOM safety falls back conservatively to a full date. Exact accounting explicitly excludes this fallback and must disclose unresolved records; it cannot charge a conservative safety interval as precise absence.
- Union joins overlapping/adjacent half-open intervals. Callers group by person and intended status category, so overlapping causes and duplicate records cannot multiply a person's unavailable time. Union does not deduplicate the source record/history list.
- The duty predicate preserves the approved legacy rule: any partial leave blocks 24-hour duty; shorter duty uses its start hour. It is not replaced by arbitrary interval intersection. A duty beginning 11:00 can retain its existing PM-leave behavior even when it continues into afternoon; OT uses actual interval overlap independently.
- Existing imports of constants/date helpers from `services.leave` remain supported. OT wrappers still return existing TimeInterval objects. No schema, endpoint payload, domain policy, operational migration or frontend change in this foundation batch.

## Consumer authority map

| Consumer | Shared facts now used | Status policy preserved |
|---|---|---|
| Calendar/summary/pressure | Shared active/approved classification and inclusive date helpers | Active includes pending; legacy request-day metrics still need correction/basis disclosure, not relabeling as leave taken. |
| Existing full profile workspace | Canonical leave rows retained; shared fixture reconciles its source with calendar/validation | History retains approved, pending, rejected, cancelled and unknown records; no statistics inferred from the recent 30-row subset. |
| Normal safety/assignment/candidates | Shared status and duty predicate through safety context | Approved hard blocker; pending warning. The same fixture asserts actual validation and candidate issue severity. |
| Template | Shared active classification, dates and duty predicate | Existing conservative staffing-pressure policy continues; no pending approval is invented. |
| OT availability and month capacity | Shared bands/known-slot/union, shared status facts | Approved normal scenario; active only in explicit pending stress. Existing leave/rest union preserves identity-level subtraction. |
| Balancing | Shared active predicate and duty overlap | Existing strict active-leave exclusion preserved. |
| Extra duty and independent verifier | Shared canonical status facts and existing duty overlap | Explicit Q2 in docs/extra_duty_contract.md treats approved/requested/imported_pending_review as strict. Independent plan checks remain independently composed and are checked against fixed external expectations. |
| Superadmin allocation | Shared approved classification for strict blocker labels | Existing active-leave prohibition preserved; no special permission is inferred. |
| Monthly approval | Same immutable pending set in the existing SQL lower(status) filter | Only requested/imported_pending_review selected; no auto-approval or transaction change. |

The N03 baseline contract register explicitly records specialized strict behavior. Centralizing facts must not erase that policy distinction. Changing which operations permit pending leave would require separate policy authority. Existing attributed manual override classifications also remain unchanged; central facts do not create new permissions.

## Evidence and remaining work

`backend/tests/test_leave_semantics.py` supplies fixed AM/PM/NIGHT/24-hour boundary expectations; independent minute-set enumeration for every combination and duplicate/order invariance; unknown fallback versus exact accounting; stored-date NIGHT boundary. Nine status fixtures reconcile actual calendar, workspace, normal safety, validator, candidate ranking, OT official/stress, extra-duty strict checking and the independent verifier from one canonical record. Tests assert expected behavior from contracts, not merely agreement between consumers.

First current report `n20-semantics-first.xml`: 63 passed, zero failures/errors/skips, including existing N18 characterization, OT availability and monthly approval checks. Ruff and scoped whitespace passed. Broader regression results and exact runtime hashes are logged after that run finishes. The first attempted source patch failed context verification atomically; inspection confirmed no partial files, then the corrected patch applied.

Next: finish dated unit/call attribution across transfers/promotions, unit-management monthly attribution and API/consumer counting-basis presentation. Reconcile every consumer against N18 worked examples before closing N20. Legacy request-day counters stay explicitly separate from the new interval totals; the frontend still needs to present that basis. Elapsed/future statistics are N22; entitlement and working-day counts remain unavailable without an approved policy/calendar.

Fresh broad verification: `n20-semantics-regression.xml` **276 passed in 237.53s**, zero failures/errors/skips, on the unchanged runtime after the first63pass. Includes normal safety/template/candidates, extra-duty and independent verifier, balancing, superadmin, leave/unit-management and enabled OT assignment/joint/month-capacity integration. Suites overlap; counts are not additive. Runner38969 exited0. Final scope and hashes: `n20-source.json`; batch-start scope: `n20-before.json`. No current PG/browser/build run was needed for this pure-facts change; those broader release gates are not inferred from these checks. N20 remains In progress.


## Subsequent reporting batch: distinct identities and interval coverage

- New pure leave_accounting.interval_coverage reuses canonical leave_semantics, clips report dates and unions time per person within approved/pending/active groups. Separate status record counts remain traceable; repeated references to the same canonical record ID are counted once. Approved and pending groups may overlap; active is their union, not their sum. Covered dates are touched person-calendar dates, not full entitlement days.
- Unknown sessions and inverted ranges expose unresolved IDs with precise clock/date totals null; known interval lower bounds remain separate. Unrecognized statuses are visible and are never promoted to approval. No private notes/raw names are projected. Current-state stored bands are not elapsed attendance, historical completeness, working days or entitlement balances.
- Existing leave_summary now exposes additive interval_coverage and a total_leave_days_basis description. total_leave_days remains the separate legacy inclusive active request-day counter; N18's duplicate example therefore remains6 request-days, alongside60 approved clock-hours and108 active clock-hours. This avoids silently changing the meaning of an existing field. The frontend basis label is still unfinished.
- Busiest-day count and pressure total_people/blocking_people now count distinct identities, while entries and blockers retain individual source requests. Unit/call pressure totals deduplicate person-dates within their existing attribution. The subsequent dated-attribution batch below replaces first-date/current-call attribution; API/consumer presentation still needs N20 acceptance.
- Verification exposed an arithmetic error in the N18 NIGHT example: 00:00-08:00 plus18:00-24:00 totals14hours, not10. The documented example and two new test expectations were corrected; scheduling intervals/policy were already14 and remain unchanged. The first n20-reporting-first.xml55pass2fail artifact is retained. n20-reporting-current.xml92passed39.24s after correction; n20-reporting-final.xml29passed13.27s after adding explicit unknown-status/inverted-date diagnostics. Suites overlap; final reports0fail/error/skip. Ruff/scoped whitespace pass. n20-reporting-before.json/n20-reporting-source.json show scope and unchanged previous core files.
- No frontend/browser/build/PostgreSQL/deployment/operational migration/model/cloud/policy changes. Current frontend shape guards accept additive summary/pressure fields; UI integration is not claimed verified. Scheduler helpers and prior allocation runtime hashes remain unchanged except the reporting-only leave.py functions.


## Subsequent dated-attribution batch

- New services/leave_attribution.py loads person call timelines, relevant postings and unit labels in batches; resolve(person,date) uses canonical member_call_level/call_level_on precedence. Cache is per identity/date. Actual transfer and timeline effective dates determine unit/call attribution; a same-date workspace change keeps existing priority over HOD change. Existing canonical call helpers are unchanged.
- All-source calendar/summary/pressure no longer attribute a whole range to its first date or today's call. Summary breakdowns remain explicitly request-days; pressure remains distinct person-dates. Day entries and source blockers expose attribution_warnings. Conflicting units become Unknown unit and conflicts are visible, rather than choosing a latest/sorted row. Conflicting posting types/calls are also explicit. Missing postings retain dated department call information where canonical; unresolved calls are Unassigned.
- Unit-board summaries retain their existing unit_board source scope. Leave days now count distinct active person-calendar dates during that person's actual board posting. Leave spanning transfers is divided between units, and duplicate/partial requests do not multiply it. Ambiguous board units do not receive guessed definite counts; each affected unit gets unresolved_leave_person_dates. API UnitSummaryRead exposes that count and leave_days_basis. Historical-only conflicts remain visible in all-source reports but do not silently change the unit-board source scope.
- Compatibility posting_context_for_month now delegates to the same dated context for a single date, so future use cannot reintroduce arbitrary latest-row resolution. Main reports use the batched context, not that per-date wrapper.
- New test_leave_attribution.py verifies actual 13-date transfer + promotion + overlapping duplicate: request-days A7/B8 remain distinct from pressure/unit-board person-dates A5/B8; call person-dates3rd10/4th3. Both unit-board and historical conflict variants exercise explicit source scope. HOD/workspace tie precedence, compatibility ambiguity and query-free resolution are covered.
- n20-attribution-first.xml85passed41.06s; final n20-attribution-final.xml60passed44.94s after the compatibility refinement includes leave/report/unit-management/setup/profile regressions. n20-attribution-batch.xml7passed4.96s adds measured loading for1versus41people:5queries each, then0queries during all date resolutions. This is an observed fixture result, not a universal bound for larger ORM batches. All reports0fail/error/skip; suites overlap. Ruff/scoped whitespace pass. No runtime edits after final60/batch7. Hashes and current source scope: n20-attribution-before.json/n20-attribution-source.json.
- N20 remains In progress for frontend/API counting-basis and unresolved-disclosure integration and final original-row reconciliation. No frontend changes/build/browser/PostgreSQL/operational migration/deployment/cloud/model/clinical-policy amendment in this batch. Allocation eligibility and call-policy source remain unchanged; reports do not certify duty capacity or attendance.


## Interface counting-basis foundation (N20 still In progress)

- Added frontend/src/leave-counting-basis.ts: read-only coverage renderer validates version/group precision and nonnegative values, displays approved/pending/active clock hours and person-calendar dates separately, and falls back to unavailable for malformed/missing evidence. Unknown exact totals remain unknown with known coverage separately labeled. Raw IDs/codes are not interpolated into markup.
- Existing Leave snapshot now labels the legacy counter Active request-days, mounts the interval coverage and attribution-warning summaries, and explains request-day breakdowns. Existing pressure text now states distinct person-dates instead of entries. Unit modal labels active leave person-dates and displays missing/conflicting attribution basis using the new API field. API TypeScript interfaces accept the additive coverage/warning/unit basis fields without rewriting unrelated work.
- New focused4 tests and full npm test131passed, zero failures/skips/cancellations. Production TypeScript/Vite build passed (existing mixed-import and bundle-size warnings). Isolated real browser renderer tests at1440/390/320 pass approved/pending/unknown/unit conflict/malformed fallback;0horizontal overflow/pageerrors/serious-criticalAxe. Initial browser harness used browser.newPage and Axe required explicit newContext; corrected harness then3viewports pass. A stray Get-Content dummy command after focused tests failed on missing file; it did not alter files and the full131 suite subsequently passed.
- Scope limitation: browser evidence exercises the actual renderer module with production styles, not the full main.ts Leave navigation/refresh/stale/error integration. Those full-page checks plus remaining unit summary/overview labels and strict optional API shape handling still need acceptance. N20 therefore remains In progress; no N21/N22 completion inferred. n20-ui-before.json/n20-ui-source.json and n20-counting-basis-browser.json record evidence.


## Final N20 original acceptance complete

Status: Done; 16/50 tasks complete, full goal active. This closure supersedes earlier batch-in-progress notes.

| Original criterion | Verified evidence |
|---|---|
| Shared facts across calendar/profile/OT/candidates/safety/reports | leave_semantics and actual9status consumer fixtures;63focused and276core regression. Normal pending warnings and specialized Q2/balancing/superadmin strict contracts remain explicit. |
| Overlapping absence does not multiply | Per-person/status interval unions, pressure distinct identities and dated unit-board person-dates; separate request counters labeled. Reporting29final and dated60final plus7query-bound cases. |
| AM/PM/NIGHT accounting | Fixed duty boundary tables and independent minute oracle for every partial combination, duplicate/order invariance, month/leap boundaries and unknown precision. NIGHT worked example corrected14hours, no band change. |
| Dated attribution | Canonical transfer/promotion/call precedence, explicit conflicts, source scope and batch query tests. All5n20-attribution-source hashes match; shared scheduling helpers unchanged. |
| Visible basis and recovery | Actualmainpage memorybackend1440/390/320:12hoursfromdupAM,unknownpendingCUSTOM,distinctpressure1,keyboarddisclosure,missingcoveragefallback,503retry,lateMayresponsecannotoverwriteJune. Unitoverview/modalconflicts via controlledresponsefixture; backendactualconflicts separatelytested. |

Interface now labels active request-days versus covered clock hours/person-calendar dates, explains pending overlap/future/attendance limits and exposes unresolved units. Unit overview and refreshed metrics use Unit leave person-dates with explicit basis; modal shows conflict counts. The overview reports unit/person references rather than pretending conflicts are globally unique dates. Actualmobiletestfound25pxemptyunitcardoverflow; scoped .unit-card childrenminwidth/wrapping fix removes it at390/320 without hiding content.

Final frontend132tests0fail/skip/cancel, finalTypeScript/Vitebuildpass(existingmixedimport/chunksizewarnings). Actualpagebrowser3viewports0pageerrors/overflow/seriouscriticalAxe in testedcoveragepanel. n20-page-source.json, n20-reporting-page-browser.json, n20-page-unit-final.log and n20-page-build-accepted.log. Logs usePowerShellUTF16. Initialbrowser exactmetrictooltip matching and inheritedseedleave issues corrected in test fixture; realmobileoverflowfixedscopedCSS. Earlierfailedattempts not claimedgreen.

No backend/schema/clinicalpolicy/operationalmigration/deploy/model/cloud changes thisbatch. Existing unrelatedfrontendwork preserved. Rollback requiresno migration; revert onlyscopedrenderer/labels/wrapping and preserve source/audit history. N21searchableprofiletimeline/actions andN22person/year/asofstatistics remain unfinished. No attendance, entitlement, workcalendar or historicalcompletenessclaim.
