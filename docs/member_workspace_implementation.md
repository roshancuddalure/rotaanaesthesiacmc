# Department member workspace implementation

Approved scope: the full 65-item member profile and CSV action plan.

## Requirement audit

Each row identifies current implementation and its verification basis. Source was reviewed alongside the backend and browser tests; test scope is stated explicitly.

| # | Requirement | Evidence |
| --- | --- | --- |
| 1 | Open profile from member names | Desktop rows/mobile cards call the shared workspace; app integration browser checks. |
| 2 | Use stable member IDs | Workspace routes use UUIDs; analysis now supplies person_id. |
| 3 | Reuse profile across application | Members, analysis, leave rows/cards and unit-posting names open one component. |
| 4 | Identity header | Persistent name, effective designation, membership and effective default call level. |
| 5 | Operation rail | Eight labelled tabs; vertical desktop and horizontal mobile. |
| 6 | Overview default | Member entry defaults to Overview with essential summary and issue actions. |
| 7 | Contextual entry | Analysis selects duties; leave/posting entries select their corresponding tab. |
| 8 | Persistent controls | Fixed dialog header/footer with separately scrollable content. |
| 9 | Preserve list context | Overlay leaves search/filter/sort/scroll state; restores focus; app browser checks. |
| 10 | Previous/Next | Filtered IDs determine order; dirty switch protected; browser checks exercise both directions. |
| 11 | Explicit editing | View mode and Edit profile; role-dependent controls. |
| 12 | Draft copy | structuredClone separates draft and saved member until successful response. |
| 13 | Save/Cancel bar | Persistent footer, dirty indicator, pending-save state. |
| 14 | Guard exits | Close, backdrop, Escape, unload, member switch; native modal prevents background navigation. |
| 15 | Keep tab drafts | Inputs update draft; tab rendering preserves it; browser checks. |
| 16 | Field validation | Inline field errors with aria-describedby, cross-tab focus, server error summary. |
| 17 | Validate names | Shared server validation rejects blanks/numeric-only values, preserves Unicode/punctuation, length limit. |
| 18 | Controlled values | Validated status/call values and matching editor choices. |
| 19 | Concurrent changes | Row lock and revision fingerprint; readable comparison and retain-draft/reload actions. |
| 20 | Atomic save | Identity, aliases, designations, dated calls and activity commit together; rollback regression. |
| 21 | Current designation | Inclusive effective-date filtering in list, profile and member audit. |
| 22 | Designation timeline | Date-ordered history cards with current/upcoming/past badges, source and notes. |
| 23 | Correct/end designation | Editable history includes dates/notes and remove action. |
| 24 | Validate periods | End-before-start and overlap rejection on client/server. |
| 25 | Default vs posting | Profile explains overrides; postings display dated unit/call context. |
| 26 | Dated default changes | Editor, model/migration, resolver and planning fallback; date-boundary regression. |
| 27 | Eligibility groups | Dated group records, active state, description, call level and restrictions explanation. |
| 28 | Postings | Date-ordered current/upcoming/past posting records and source. |
| 29 | Leave | Dated leave/status/slot/source cards and explanation of approved vs pending/cancelled. |
| 30 | Status consequences | Archive/restore open editor; confirmation shows linked future duties/postings/groups; history retained. |
| 31 | Phone layout | Full-screen responsive native dialog below 700px. |
| 32 | Mobile tabs | Horizontally scrollable labelled rail with selected state. |
| 33 | Narrow forms | Single-column forms; browser verified at 320/390 CSS pixels. |
| 34 | Keyboard viewport | VisualViewport resize/scroll fitting, dynamic height and safe-area padding. |
| 35 | Main scroll | Scrollable tab content with fixed header/footer; no page horizontal overflow. |
| 36 | History mobile cards | Related records render labelled cards rather than wide tables. |
| 37 | Touch targets | 44px minimum buttons/selects/text inputs; checkbox labels have 44px interactive area. |
| 38 | Modal focus | Native showModal inertness, focus containment, guarded Escape and restored opener; browser assertions. |
| 39 | Tab accessibility | tablist/tab/tabpanel roles, selected state, roving tabindex and orientation-appropriate arrows/Home/End. |
| 40 | Reflow/long text | 320px, 390px and desktop checks; long escaped names, wrapping, visible focus and text status. |
| 41 | Visible CSV action | Import CSV and template link beside Create Member; advanced operations separately disclosed. |
| 42 | Download template | Public CSV contains exact approved six-field header; browser download response verified; examples in import help. |
| 43 | Name-only lists | Parser accepts headed or headerless single-column lists; defaults explained and previewed. |
| 44 | Column mapping | Heading aliases plus explicit mapping UI; backend mapping regression. |
| 45 | CSV parsing | Python csv parser handles quoted commas, escaped quotes, multiline, BOM and newlines; regressions. |
| 46 | File errors/limits | CSV extension, UTF-8, unique headers, malformed content, 2 MB and 5,000-row limits. |
| 47 | Separate modes | Create-only default and update-existing; no implicit overwrite via creation. |
| 48 | Explicit matching | UUID first, normalized canonical/alias lookup; ambiguity and missing IDs surface errors. |
| 49 | Fuzzy review | Suggestions never merge; operator can match existing identity or confirm a distinct member and refresh. |
| 50 | File duplicates | Repeated normalized names and repeated target IDs flagged before apply. |
| 51 | Blank semantics | Blank updates preserve fields; __CLEAR__ explicitly clears default call; regression. |
| 52 | Row preview/diffs | Create/update/unchanged/review/invalid and before/after identity plus designation additions. |
| 53 | Preview correction/exclusion | Editable row fields, refresh validation, row selection; apply disabled after draft corrections. |
| 54 | Frozen safe apply | Persisted operator-owned expiring preview, selected row validation, locks, stale check and stored retry result. |
| 55 | Completion report | Counts/batch/affected profile links and downloadable safe CSV row report; browser retry flow. |
| 56 | Aliases editor | Alias list/source, remove actions and multiline addition; collision checks server-side. |
| 57 | Rename continuity | Keep-previous-name option enabled by default; alias collision validation and regression. |
| 58 | Explicit reactivation | Creation rejects existing identities; import blocks reactivation; profile status change requires confirmation. |
| 59 | API permissions | Authenticated member/workspace reads and admin writes/imports/merges; API regression. |
| 60 | Safe text | Escaping on profile/list/attributes/import values; browser checks HTML-like name; spreadsheet-safe report cells. |
| 61 | Operator activity | Durable before/after/operator/time/batch; profile/create/update/status/alias/designation/merge/import and batch member tools. |
| 62 | Merge comparison | Candidate identity, aliases, designation/default differences, record counts and source/target revision checks. |
| 63 | Preserve references | Duties/postings/leave/designations/aliases/groups/dated calls/exchanges/auto-fill/activity/legacy references; FK-enabled regression. |
| 64 | Actionable quality | Overview issue buttons plus member list quality controls open relevant profile tab. |
| 65 | Independent tabs | Per-tab requests/cache/retry preserve editor; failure/retry browser test; activity shows readable changes. |

## Verification and operation

- Frontend production build and TypeScript check pass.
- Eight Chromium workflows cover profile editing, CSV download/preview/correction/report/apply retry, and actual app navigation at desktop/mobile widths.
- Browser workflow covers unsaved Escape/member-switch guards, stale-version comparison, cross-tab validation, independent tab retry, inert background and focus restoration.
- Full backend suite: 178 passed. Latest affected profile/template suite: 48 passed. Ruff passed.
- Local PostgreSQL: member list (312 members) and every profile section returned 200 using an authenticated dependency override for verification, without changing personnel records.
- Local schema is upgraded to `20261017_0019 (head)`. Missing predecessor `20261012_0018` was reconstructed from inspected existing table definitions; original history tables remain intact.
- New migration was checked with isolated upgrade/downgrade before applying to local PostgreSQL.

Template: `frontend/public/templates/department-members.csv`. Start Vite on port 5178 and run `npm run test:members` from frontend; install Chromium with `npx playwright install chromium` or supply `MEMBER_TEST_BROWSER`.

## Explicit choices and limits

- Designation dates are inclusive; conflicting historical overlaps must be corrected before saving that designation history.
- New CSV members default to Active and no default call level; blank updates preserve values. `__CLEAR__` deliberately clears a base call level. Dated changes remain explicit profile records.
- CSV designations require ISO dates and do not silently terminate previous positions.
- Preview ownership expires in two hours; completed results remain retry-safe.
- Mobile verification uses Chromium emulation and rendered screenshots; no physical phone or native on-screen keyboard was available. VisualViewport handling is implemented, but physical-device behaviour is not independently certified.
- No deployment, commit, push, or roster reset was performed. Unrelated handbook artifacts were preserved.
- Existing broader rota and authentication issues outside the approved member-profile scope remain outside this change.
