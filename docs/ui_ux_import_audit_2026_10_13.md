# Duty Rota UI, UX and import audit — 13 October 2026

## Outcome and approval boundary

This inspection produced **250 distinct numbered action items across 25 areas**. Each item has a priority, evidence classification, implementation phase and acceptance criterion. This is a proposed improvement backlog, not a claim that all 250 items are defects.

Inspection baseline: `0b6b85eb33944796009c8f874781d104b6e4f330`. Application code was clean at the start. No application implementation, deployment, production import or real-database migration was performed for this audit. The new deliverables are this report, the CSV backlog and the verification record.

The user approved implementation and testing of all 250 actions on 13 October 2026. The prioritized goal is active. See [implementation progress](ui_ux_import_implementation_2026_10_13.md) and the CSV status/evidence columns for current completion; the findings below retain the original audit baseline.

Priority counts: **9 P0**, **141 P1**, **100 P2**.

Evidence counts: **33 C**, **8 B**, **209 E**.

- **P0:** immediate authentication, privilege or destructive-data exposure.
- **P1:** correctness, synchronization, availability or core workflow reliability.
- **P2:** usability, discoverability, reporting and operational improvements.
- **C:** current behavior or limitation confirmed from source; some also reproduced with an isolated API check.
- **B:** behavior observed by browser inspection or automated accessibility checks on synthetic screens.
- **E:** proposed enhancement/hardening based on the inspected workflow; not asserted to be an independently reproduced defect. Some extend an existing capability rather than adding a wholly absent feature.

## Scope and method

Reviewed all 16 navigation destinations: Overview, Duty Analysis, Department Members, Leave, Unit Management, Rota Setup, Rota Template, Rota Review, Publish & Export, User Guide, Rota Rules, Eligibility Groups, Mappings, Past Duties, Login Accounts and Diagnostics.

The browser pass captured **32 main-screen states**, each at desktop 1440×1000 and phone 390×844, plus profiles at both sizes. A second pass captured **16 additional states**: all nine analysis subtabs, a unit editor, member column selection and preview, leave preview, unit workbook preview, past-duty column selection and preview. The phone login screen was also inspected. Source inspection covered forms, custom dialogs, import apply functions, role gates, scoring, review, publication and exports.

Browser testing used installed Chrome through Playwright and axe with a disposable SQLite database, synthetic people, units and leave. The application backend was bound to local port 8013 and the frontend to local port 5178. The database dependency was overridden and DATABASE_URL was set to SQLite before importing the application. No current local or Railway data was used or modified. Inspecting setup GETs did create records in this disposable database, which is itself a finding about the current GET behavior.

API checks used a separate in-memory database. They covered anonymous reads, reset-token disclosure, CSV previews and cross-month unit-board removal. Browser import checks stopped at review; they did not apply an import to a real database.

Limits: this is a source and synthetic-browser audit, not a production security penetration test, PostgreSQL concurrency test, full populated-month allocation test or screen-reader certification. The first browser pass encountered an axe harness setup error; the corrected run completed all 32 main-screen scans. The retained results are from that corrected run. Phone layouts were checked at 390 pixels; other widths, high zoom, dark mode, assistive technologies and every filled/error dialog state require the focused follow-up checks listed in the backlog. API authentication was overridden for synthetic logins; anonymous requests still reproduced missing dependencies on legacy routes. Full end-to-end role permission testing is proposed in A011/A250.

## Existing capabilities to preserve

Member importing already supports CSV/XLSX normalization, aliases, duplicate review, blank-preserves-existing behavior, reviewed hashes and source-row history. Profiles already support dated call changes and private Admin/HOD comments. Past-duty XLS/XLSX importing already supports worksheet selection, table/matrix layouts, review, duplicates and corrections, source history, coverage summaries and effective-dated fairness settings. Unit importing already has correction and pagination tools, and can learn mappings. Leave importing already identifies within-file duplicate rows. These should be strengthened and synchronized rather than replaced without cause.

## Findings to address first

1. Legacy member and mapping routes lack backend authentication/role dependencies. Anonymous member, mapping and analysis reads returned HTTP 200 in the isolated checks; authenticated Accounts correctly returned HTTP 401 without a token. The legacy historical rebuild route also lacks a permission dependency in source. See A001–A004.
2. Forgot-password returns a usable reset token to a caller who supplies a known username. The synthetic HOD account reproduced token disclosure. The deployed bootstrap path is also public and uses a predefined credential in source. See A005–A006.
3. Computer-admin accounts can call account creation with a superadmin role because require_admin alone is used. See A008.
4. Replacing a unit month deletes entire intersecting unit-board posting rows. The isolated example removed all 36 ongoing postings that began in January when clearing October; rollback restored the disposable state. No real postings were cleared. Replacement also occurs before safely applicable rows are processed. See A111–A114.
5. The locked-scope update path checks unlock reasons but allows unit changes when the submitted scope remains locked. See A142.
6. Leave and unit apply reparses the upload without the reviewed-state hash protection used by member/past-duty imports. Their endpoints also read uploads without a bounded read. See A081/A083.
7. Analysis and roster caches can outlive master-data changes; Overview reuses its existing analysis and Eligibility Groups reuses any nonempty member array. The analysis subtitle is fixed to an old date range. See A041/A161/A221.
8. Template width was 1502 pixels at a 1440-pixel viewport and 765 pixels at a 390-pixel viewport. Review width was 767 pixels at a 390-pixel viewport. See A171/A191.
9. Browser checks found unsupported member-sort ARIA attributes, invalid template-tab semantics, unlabeled scope selects, a 2.99:1 Unassigned-chip contrast ratio, and keyboard-inaccessible scroll regions. See A231–A235.
10. Unit settings do not currently provide a unit-identity create/rename/campus/archive workflow. Mobile mapping cards show Save without editable values. See A091–A100/A241.

## Coverage matrix

| Inspected area | Related action IDs | Inspection evidence |
|---|---|---|
| Authentication, Accounts and HOD | A001–A020 | Source, isolated API probes, desktop/phone Accounts and phone login |
| Navigation and shared forms | A021–A040 | Shell, navigation, request helpers and desktop/phone behavior |
| Overview | A041–A050 | Source and desktop/phone screenshots |
| Members and profiles | A051–A070 | Source, desktop/phone list and profile, member preview |
| Member imports and shared import infrastructure | A071–A090 | Column mapping, normalized preview, API/service apply inspection |
| Unit creation/editing and assignments | A091–A110 | Master/settings APIs, posting services, unit editor |
| Unit importing | A111–A120 | CSV and workbook previews, replacement service and isolated cross-month probe |
| Leave and importing | A121–A140 | Calendar/list/forms, CSV preview, duplicate detection and apply service |
| Rota Setup | A141–A150 | Source, both layouts, scope lock and clone behavior |
| Rota Rules and Eligibility Groups | A151–A170 | Both screens, rule APIs, group dates and cached member selection |
| Template, candidates and auto-fill | A171–A190 | Both layouts, renderer, assignment, safety and scoring services |
| Review and exchanges | A191–A200 | Both layouts, decision/exchange forms and backend checks |
| Publish and export | A201–A210 | Both layouts, checklist, approval and export code |
| Past Duties and fairness | A211–A220 | Both layouts, workbook mapping/preview, history and fairness services |
| Duty Analysis | A221–A230 | Both layouts, all nine subtabs and analysis service |
| Accessibility | A231–A240 | Corrected axe scans, screenshots, dialog and table source |
| Mappings, Diagnostics and User Guide | A241–A250 | Both layouts, backend pathways and help content |

## Proposed implementation phases

| Phase | Scope | Item count | Release gate |
|---|---|---:|---|
| 1 | Authentication, privilege enforcement, dangerous replacement, core validation and concurrency safeguards | 30 | Permission checks and destructive-import regression cases pass; approved scope is reviewable |
| 2 | Member master/profiles, import pathways, units, leave and monthly setup synchronization | 86 | Representative files pass through preview/apply with duplicate and stale-state protection |
| 3 | Rules, groups, template, allocation, review, publication, history and statistics | 79 | A populated monthly workflow remains correct across promotions, leave and history changes |
| 4 | Navigation, feedback, mobile/accessibility, diagnostics and operating guidance | 55 | Browser checks cover the approved flows and no previously reproduced accessibility/overflow issue remains |

Dependencies: shared identity validation and import commit safeguards precede bulk workflow changes; effective-date reconciliation precedes allocation/history refinements; publication revisioning follows review-state consistency. Actions can be moved between phases if you prefer a different release scope. Accessible controls and test coverage should accompany each phase even where the broader improvement is listed in Phase 4.

**Exact Phase 1 IDs:** A001, A002, A003, A004, A005, A006, A007, A008, A009, A010, A011, A016, A020, A041, A051, A052, A053, A058, A081, A082, A083, A084, A089, A111, A112, A113, A114, A142, A202, A250.

## Complete numbered action backlog

Each group gives source locations. For B items, the verification record additionally identifies the browser state. The CSV includes the source references on every individual row. Acceptance criteria describe the proposed completed behavior; they are not claims that the behavior has already been implemented.

### 1. Authentication and exposed endpoints

Evidence/context: [backend/app/api/v1/members.py:27](../backend/app/api/v1/members.py#L27), [backend/app/api/v1/admin_mappings.py:21](../backend/app/api/v1/admin_mappings.py#L21), [backend/app/api/v1/historical_imports.py:11](../backend/app/api/v1/historical_imports.py#L11), [backend/app/api/v1/auth.py:179](../backend/app/api/v1/auth.py#L179), [frontend/src/main.ts:2560](../frontend/src/main.ts#L2560).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A001 | P0 / C | 1 | Require authentication and appropriate permissions on every legacy member endpoint, including merge, cleanup and roster reset. | Anonymous requests fail and unauthorized roles cannot mutate members. |
| A002 | P0 / C | 1 | Protect mapping creation, editing and historical-file scanning on the backend. | Hiding the Mappings menu is supplemented by enforced API permissions. |
| A003 | P0 / C | 1 | Restrict the legacy historical rebuild endpoint and replace its unrestricted execution with a reviewed operation. | An anonymous request cannot rebuild history or trigger database writes. |
| A004 | P0 / C | 1 | Authenticate analysis endpoints that expose department personnel and duty records. | Unauthenticated dashboard, preflight and manual-review requests are rejected. |
| A005 | P0 / C | 1 | Stop returning password-reset tokens from the public forgot-password response. | Knowing a username cannot obtain a token capable of changing its password. |
| A006 | P0 / C | 1 | Remove the public default-superadmin bootstrap route from deployed environments. | Production cannot create a privileged account through an unauthenticated bootstrap call. |
| A007 | P0 / C | 1 | Escape stored values in mapping, account and diagnostics HTML rendering. | Names, notes and labels containing markup display as text without executing. |
| A008 | P0 / C | 1 | Limit creation of superadmin accounts to an explicitly authorized superadmin operation. | A computer-admin login cannot grant superadmin privileges. |
| A009 | P1 / C | 1 | Apply one password-validation policy to account creation, reset and password change. | All three paths reject passwords that violate the same policy. |
| A010 | P1 / C | 1 | Revoke existing sessions and outstanding reset tokens after a password reset. | Previously issued sessions and unused reset tokens stop working after recovery. |

### 2. Accounts and role experience

Evidence/context: [backend/app/api/v1/auth.py:146](../backend/app/api/v1/auth.py#L146), [frontend/src/main.ts:7223](../frontend/src/main.ts#L7223), [frontend/src/member-profile.ts:9](../frontend/src/member-profile.ts#L9).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A011 | P1 / E | 1 | Publish an explicit permission matrix for rota-board, HOD, computer-admin and superadmin roles. | Each UI action maps to a documented and tested server permission. |
| A012 | P1 / E | 4 | Give HOD users a clear entry point to member profiles and promotion recording. | An HOD can discover profile management without guessing that member names are clickable. |
| A013 | P1 / E | 4 | Add an account-edit workflow for display name, email and allowed role changes. | Authorized admins can update an existing account without creating another login. |
| A014 | P1 / E | 4 | Add account deactivation with session revocation and a visible status change. | Deactivated users cannot continue through an existing session. |
| A015 | P2 / E | 4 | Show last login and creation date in account management. | Admins can distinguish unused accounts from regularly used accounts. |
| A016 | P1 / E | 1 | Record account-role changes and deactivation in an administrator audit trail. | Every privilege change identifies the actor, time and previous value. |
| A017 | P2 / E | 4 | Add search and role/status filters to Login Accounts. | A matching account is easy to find as the list grows. |
| A018 | P2 / E | 4 | Use visible labels, password requirements and password-manager attributes in account creation. | Users understand each field before typing and password managers recognize its purpose. |
| A019 | P2 / E | 4 | Provide an administrator-assisted recovery workflow until a delivery channel is configured. | Recovery clearly identifies the responsible admin without exposing tokens publicly. |
| A020 | P1 / E | 1 | Handle session expiration with a clear sign-in prompt and preserved recoverable drafts. | A 401 does not leave the user repeatedly retrying a broken screen. |

### 3. Navigation and working context

Evidence/context: [frontend/src/main.ts:312](../frontend/src/main.ts#L312), [frontend/src/main.ts:436](../frontend/src/main.ts#L436), [frontend/src/main.ts:632](../frontend/src/main.ts#L632).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A021 | P1 / C | 4 | Replace independent month variables with a shared, explicit working-month context. | Opening Units, Setup, Template, Review and Publish keeps the selected month consistent. |
| A022 | P1 / E | 4 | Add navigable URLs for sections, selected month and member profiles. | Reload, bookmarks and browser Back return to the same working context. |
| A023 | P2 / E | 4 | Show a compact workflow progression from data readiness through publishing. | Users can see the current stage and the next required task. |
| A024 | P2 / E | 4 | Offer Members as a convenient mobile navigation destination. | A phone user can reach the master roster without repeatedly opening More. |
| A025 | P2 / E | 4 | Add breadcrumbs and context-preserving return links on review dialogs. | Returning from a correction restores the originating screen and filters. |
| A026 | P1 / E | 4 | Warn before navigation abandons unsaved rules, scope or profile drafts. | Unsaved edits are preserved or deliberately discarded. |
| A027 | P2 / E | 4 | Retain section filters and scroll position during routine refreshes. | Saving one record does not send the user to the top of a long list. |
| A028 | P2 / E | 4 | Display the working month beside all actions that affect monthly records. | A user can identify the affected month before committing an operation. |
| A029 | P2 / E | 4 | Expose a global member search linking to the canonical profile. | People can be located without switching to the Members list first. |
| A030 | P2 / E | 4 | Standardize section titles and terminology across navigation, help and messages. | The same destination has one recognizable name everywhere. |

### 4. Forms, feedback and recovery

Evidence/context: [frontend/src/services/api.ts:172](../frontend/src/services/api.ts#L172), [frontend/src/services/api.ts:210](../frontend/src/services/api.ts#L210), [frontend/src/main.ts:9366](../frontend/src/main.ts#L9366).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A031 | P1 / C | 4 | Replace local-launch instructions in production network errors with deployment-appropriate recovery messages. | Public-site users are not told to run launch.bat on their computer. |
| A032 | P1 / C | 4 | Translate structured FastAPI validation errors into field-specific messages. | A failed request identifies the offending field instead of only reporting HTTP 422. |
| A033 | P1 / E | 4 | Centralize request deadlines and cancellation, including file uploads. | A stuck request can be cancelled and does not leave controls busy indefinitely. |
| A034 | P1 / E | 4 | Discard results from outdated requests after month or section changes. | A slower response cannot overwrite the newer screen. |
| A035 | P1 / E | 4 | Preserve entered values when a form submission fails. | Correcting one error never requires re-entering the whole form. |
| A036 | P2 / E | 4 | Distinguish loading, empty, unavailable and partially loaded states consistently. | An unavailable dataset is never presented as a valid empty dataset. |
| A037 | P1 / E | 4 | Guard duplicate submissions while mutations are pending. | Repeated clicks cannot create duplicate records or repeated operations. |
| A038 | P2 / E | 4 | Place success and error feedback near the action, with announced status messages. | Keyboard and screen-reader users receive the same feedback as sighted users. |
| A039 | P2 / E | 4 | Add contextual retry controls to failed section loads. | A user retries the failed request without reloading the entire application. |
| A040 | P1 / E | 4 | Replace generic destructive confirmations with a preview of the affected records. | The final confirmation states what will change and how many records are affected. |

### 5. Overview and department readiness

Evidence/context: [frontend/src/main.ts:1005](../frontend/src/main.ts#L1005), [backend/app/services/analysis.py:229](../backend/app/services/analysis.py#L229).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A041 | P1 / C | 1 | Invalidate the cached overview analysis after relevant imports and rota publishing. | Overview totals reflect committed changes without a full browser reload. |
| A042 | P1 / E | 4 | Show completeness of the analyzed history beside workload totals. | Missing months are visibly different from months with zero duties. |
| A043 | P2 / E | 4 | Add current-month readiness cards for members, leave, units and scope. | The homepage directs users to unresolved setup problems. |
| A044 | P2 / E | 4 | Provide a date-window filter for overview workload rankings. | Ranks and totals use the user's selected historical period. |
| A045 | P2 / E | 4 | Link overview workload leaders to canonical member profiles and duty detail. | A high burden can be investigated with one context-preserving action. |
| A046 | P2 / E | 4 | Show the definitions and denominators behind active-person averages. | Users can explain exactly which people and months an average includes. |
| A047 | P2 / E | 4 | Add a useful first-run empty state with setup and import actions. | A new department can start work directly from an empty overview. |
| A048 | P2 / E | 4 | Separate historical burden indicators from current draft allocation indicators. | Each displayed number makes its period and inclusion rules explicit. |
| A049 | P2 / E | 4 | Show the last successful analysis refresh and provide a refresh action. | Users can recognize when summary information may be stale. |
| A050 | P2 / E | 4 | Add an actionable exception list instead of only highest-load rankings. | Missing call levels, unresolved names and setup blockers link to correction screens. |

### 6. Department member master list

Evidence/context: [frontend/src/main.ts:4494](../frontend/src/main.ts#L4494), [backend/app/api/v1/members.py:199](../backend/app/api/v1/members.py#L199), [backend/app/services/members.py:167](../backend/app/services/members.py#L167).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A051 | P1 / C | 1 | Use the same name, status and call-level validation for manual edits and imports. | Manual APIs reject blank names and unsupported codes just as imports do. |
| A052 | P1 / C | 1 | Make duplicate-name creation an explicit match-or-restore decision. | Creating a member does not silently reactivate or modify an existing record. |
| A053 | P1 / E | 1 | Use stable person IDs and normalized uniqueness checks throughout matching. | Case and spacing differences cannot create an accidental second master member. |
| A054 | P2 / E | 2 | Add pagination or virtualization to the master member list. | Hundreds of members do not require rendering the entire roster at once. |
| A055 | P2 / E | 2 | Allow member search to match saved aliases as well as canonical names. | A familiar spreadsheet spelling locates the correct master person. |
| A056 | P2 / E | 2 | Expose missing call level and missing designation as filterable correction queues. | Admins can work through incomplete records without scanning the whole list. |
| A057 | P1 / E | 2 | Preview linked future duties, postings and eligibility before archiving a member. | The admin understands and resolves the consequences of archiving. |
| A058 | P1 / E | 1 | Route status transitions through one consistent archive/restore service. | Choosing archived in a profile sets the same metadata as the Archive action. |
| A059 | P2 / E | 2 | Give duplicate-review groups a side-by-side comparison and survivor selection. | A merge review shows both identities and their linked records before approval. |
| A060 | P2 / E | 2 | Provide a filtered roster export with IDs, canonical names, call levels and statuses. | Admins can reconcile the master list without copying the screen manually. |

### 7. Profiles, promotions and comments

Evidence/context: [frontend/src/member-profile.ts:9](../frontend/src/member-profile.ts#L9), [backend/app/api/v1/member_profiles.py:67](../backend/app/api/v1/member_profiles.py#L67), [backend/app/services/member_profiles.py:32](../backend/app/services/member_profiles.py#L32).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A061 | P1 / C | 2 | Choose the displayed designation by effective date and end date. | A future or expired designation is not shown as the current designation. |
| A062 | P1 / C | 2 | Preserve profile form drafts across saving and failed validation. | Reasons and comments remain available after a rejected submission. |
| A063 | P1 / E | 2 | Add a reviewed correction/cancellation workflow for scheduled call changes. | An erroneous future promotion can be corrected while retaining its audit history. |
| A064 | P1 / E | 2 | Support backdated promotion-history insertion with chronological reconciliation. | Adding verified earlier history does not corrupt later call transitions. |
| A065 | P1 / E | 2 | Preview the affected future slots and eligibility pools before recording a promotion. | HOD and admins can see which allocations will need revalidation. |
| A066 | P2 / E | 2 | Expose designation end dates and notes in the profile editor. | The UI can manage all supported designation-history fields. |
| A067 | P1 / E | 2 | Add controlled alias removal or reassignment with collision checks and an audit record. | An incorrectly linked spelling can be corrected without losing traceability. |
| A068 | P2 / E | 2 | Add filters and pagination for profile posting, leave and import history. | Older records remain discoverable beyond the current response limits. |
| A069 | P2 / E | 2 | Link profile duty statistics to the underlying duty list and time window. | Users can verify a total against its constituent duties. |
| A070 | P2 / E | 2 | Add comment categories and follow-up references while preserving author/time privacy rules. | HOD and admin notes can be organized without erasing prior comments. |

### 8. Member CSV and Excel import

Evidence/context: [frontend/src/member-import.ts:39](../frontend/src/member-import.ts#L39), [backend/app/services/member_import.py:167](../backend/app/services/member_import.py#L167), [backend/app/api/v1/member_import.py:24](../backend/app/api/v1/member_import.py#L24).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A071 | P2 / E | 2 | Present member importing as clear File, Columns, Review and Apply steps. | Users can identify the current step and what is required next. |
| A072 | P2 / E | 2 | Show a small source sample while configuring member columns. | Header mappings can be checked against actual source values before preview. |
| A073 | P1 / E | 2 | Detect one source column mapped to incompatible member fields. | Conflicting mappings are blocked with a specific explanation. |
| A074 | P2 / E | 2 | Allow a resolver to search the full master roster beyond suggested candidates. | A legitimate match can be selected even when fuzzy suggestions miss it. |
| A075 | P1 / E | 2 | Explain normalization changes and match evidence next to each proposed member update. | Admins can compare original values, normalized values and the matching reason. |
| A076 | P2 / E | 2 | Paginate member-import review rows and prioritize unresolved rows. | A 5000-row upload remains usable and unresolved rows are immediately reachable. |
| A077 | P1 / E | 2 | Require an explicit restore decision for archived members encountered in an upload. | Import matching cannot obscure whether a historical identity is being reactivated. |
| A078 | P1 / E | 2 | Collect an effective date and approval reason for imported call-level changes. | Batch promotions retain the same meaning and traceability as profile changes. |
| A079 | P2 / E | 2 | Offer an explicit way to clear an existing field during import. | Blank-preserves-existing behavior remains safe while deliberate clearing is possible. |
| A080 | P2 / E | 2 | Provide legacy XLS support or a clear conversion path in member importing. | The file picker and help explain exactly which Excel formats are supported. |

### 9. Shared import infrastructure and synchronization

Evidence/context: [backend/app/api/v1/leave.py:246](../backend/app/api/v1/leave.py#L246), [backend/app/api/v1/unit_management.py:387](../backend/app/api/v1/unit_management.py#L387), [frontend/src/services/api.ts:172](../frontend/src/services/api.ts#L172).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A081 | P1 / C | 1 | Add reviewed-preview tokens to leave and unit imports, following member/past-duty imports. | Apply rejects changes to the file, options or relevant database state after review. |
| A082 | P1 / E | 1 | Use database-backed idempotency keys for every import apply operation. | A retried upload produces one committed batch and a consistent result. |
| A083 | P1 / C | 1 | Enforce file-size limits before fully reading leave and unit uploads. | Oversized files are rejected without loading the entire payload into memory. |
| A084 | P1 / E | 1 | Bound workbook dimensions, sheets and parsed cell counts in all importers. | Small compressed files cannot cause unbounded parsing work. |
| A085 | P1 / E | 2 | Create durable batch history for leave and unit imports with actors and source rows. | Every imported record can be traced to a reviewed batch. |
| A086 | P2 / E | 2 | Provide a downloadable rejected-row report for each import pathway. | Skipped and unresolved records are visible and can be corrected offline. |
| A087 | P1 / E | 2 | Introduce a shared data-change event that invalidates members, units, candidates and analysis caches. | A committed master-data change refreshes every dependent section consistently. |
| A088 | P1 / E | 2 | Add optimistic concurrency checks to member, scope, rule and posting writes. | A stale editor receives a conflict rather than overwriting newer changes. |
| A089 | P1 / E | 1 | Serialize conflicting import commits and enforce uniqueness within the transaction. | Two admins applying overlapping imports cannot create conflicting duplicates. |
| A090 | P2 / E | 2 | Add a reviewed batch-reversal workflow that respects later dependent changes. | An incorrect upload can be reversed safely with an explicit impact preview. |

### 10. Unit creation and unit editing

Evidence/context: [backend/app/api/v1/unit_management.py:161](../backend/app/api/v1/unit_management.py#L161), [backend/app/models/unit.py:15](../backend/app/models/unit.py#L15), [frontend/src/main.ts:4217](../frontend/src/main.ts#L4217).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A091 | P1 / C | 2 | Add a dedicated unit-master editor; the current settings API only edits staffing minima. | Authorized users can edit a unit's identity and metadata through the UI. |
| A092 | P1 / E | 2 | Support creating a unit with validated code, name and campus. | A new unit becomes available consistently in postings, scope and mappings. |
| A093 | P1 / E | 2 | Validate unit-code uniqueness using a normalized comparison. | Equivalent case or whitespace variants cannot produce duplicate unit identities. |
| A094 | P1 / E | 2 | Allow unit rename while retaining the stable unit ID and existing relationships. | Renaming a unit preserves postings, historical slots and mapping references. |
| A095 | P1 / E | 2 | Provide controlled campus changes with a future-duty impact preview. | Admins can assess which campus-dependent allocations require review. |
| A096 | P1 / E | 2 | Add unit archival with a check for active postings and future allocations. | An archived unit cannot silently disappear from a required rota scope. |
| A097 | P1 / E | 2 | Support effective-dated unit staffing settings. | Changing next month's minimum staffing does not rewrite past planning assumptions. |
| A098 | P2 / E | 2 | Display unit notes and edit history in the unit profile. | Users can identify why the current staffing settings were chosen. |
| A099 | P2 / E | 2 | Provide a unit detail page showing membership, leave pressure and staffing minima together. | Planning information is accessible without opening several separate forms. |
| A100 | P1 / E | 2 | Preview staffing shortages before increasing a unit's minimum-free requirement. | The editor identifies affected dates before saving a stricter setting. |

### 11. Manual unit assignments and special postings

Evidence/context: [frontend/src/main.ts:4121](../frontend/src/main.ts#L4121), [frontend/src/main.ts:4164](../frontend/src/main.ts#L4164), [backend/app/api/v1/unit_management.py:131](../backend/app/api/v1/unit_management.py#L131).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A101 | P1 / E | 2 | Prevent overlapping incompatible postings when saving a manual assignment. | One person cannot be assigned to conflicting units over the same dates without explicit policy. |
| A102 | P1 / E | 2 | Provide a transfer operation that ends the old posting and begins the new one atomically. | A dated transfer creates no accidental gap or overlap. |
| A103 | P2 / E | 2 | Offer searchable member selection in unit and special-posting editors. | Large rosters can be searched without scrolling a long select list. |
| A104 | P1 / E | 2 | Show a day-specific effective call level when editing dated postings. | A mid-month promotion is reflected for the actual assignment dates. |
| A105 | P1 / E | 2 | Keep special posting types separate from the person's call-level identity. | Editing SICU, PAC or DRP membership cannot accidentally change call level. |
| A106 | P2 / E | 2 | Add a unit membership timeline for within-month transfers and rotations. | Admins can see which unit a member belongs to on each date. |
| A107 | P1 / E | 2 | Show the effect of editing a posting on saved rota assignments. | Affected future duties become a visible review queue after the edit. |
| A108 | P2 / E | 2 | Support a previewed bulk move for a selected group of members. | Each member's source, destination and date range are reviewed before a batch transfer. |
| A109 | P1 / E | 2 | Provide an audited end-posting action instead of only deleting records. | Historical postings remain available when an ongoing posting is terminated. |
| A110 | P2 / E | 2 | Retain filters and selected unit after assignment save or removal. | The editor returns to the same planning context after a successful operation. |

### 12. Unit import pathways

Evidence/context: [frontend/src/main.ts:290](../frontend/src/main.ts#L290), [backend/app/services/unit_assignment_import.py:1210](../backend/app/services/unit_assignment_import.py#L1210), [backend/app/services/unit_assignment_import.py:1278](../backend/app/services/unit_assignment_import.py#L1278), [backend/app/services/unit_assignment_import.py:554](../backend/app/services/unit_assignment_import.py#L554).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A111 | P1 / C | 1 | Default unit importing to adding reviewed assignments rather than replacing them. | Replacement is an explicit user choice for every new import. |
| A112 | P0 / C | 1 | Split or trim ongoing postings when replacing a month's unit-board records. | Replacing October preserves the posting portions before and after October. |
| A113 | P1 / C | 1 | Block destructive replacement when the reviewed upload contains no valid assignments. | An empty or unrecognized file cannot clear the month's existing roster. |
| A114 | P1 / E | 1 | Show the exact assignment additions, removals and date-range edits in replacement preview. | The final confirmation lists the full replacement impact. |
| A115 | P1 / C | 2 | Add a true tabular CSV pathway with explicit column mapping. | A normal name/unit/posting/date CSV is parsed as records instead of sectioned text. |
| A116 | P2 / E | 2 | Provide downloadable unit CSV, workbook-matrix and text-format examples. | Users know which layout is expected before preparing a file. |
| A117 | P2 / E | 2 | Allow selecting sheets and the header row in unit Excel imports. | An irrelevant worksheet or title row does not require editing the original workbook. |
| A118 | P1 / E | 2 | Make uncertain fuzzy matches require confirmation before assignments are applied. | Suggested identities are not silently treated as verified matches. |
| A119 | P1 / E | 2 | Validate within-file overlaps and contradictions before applying unit assignments. | Two conflicting rows for the same person and dates are flagged together. |
| A120 | P2 / E | 2 | Show and audit learned aliases and unit-label mappings separately from imported postings. | Admins can inspect and undo an incorrect learned mapping independently. |

### 13. Leave entry and management

Evidence/context: [frontend/src/main.ts:3310](../frontend/src/main.ts#L3310), [backend/app/api/v1/leave.py:39](../backend/app/api/v1/leave.py#L39), [backend/app/api/v1/leave.py:181](../backend/app/api/v1/leave.py#L181).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A121 | P1 / C | 2 | Normalize and validate leave statuses consistently for create and update APIs. | The same status spelling has the same semantics in both paths. |
| A122 | P1 / E | 2 | Validate leave type, slot and status against supported enumerations. | Unknown codes cannot bypass availability rules through manual requests. |
| A123 | P1 / E | 2 | Show overlapping leave requests before saving a new or edited request. | Admins can merge, replace or cancel overlaps deliberately. |
| A124 | P2 / E | 2 | Make half-day and slot-specific leave understandable in the date form. | Users can distinguish morning, afternoon and whole-day absence. |
| A125 | P1 / E | 2 | Preview saved-duty conflicts when approving or changing leave. | Affected assignments are identified and sent to review. |
| A126 | P2 / E | 2 | Add member, status, leave-type and unit filters to the leave list and calendar. | Users can isolate a relevant set without changing data. |
| A127 | P2 / E | 2 | Provide a date-range view for leave crossing month boundaries. | A cross-month request is visible as one continuous record. |
| A128 | P1 / E | 2 | Record who created, amended, approved or cancelled each leave request. | The audit history explains every availability change. |
| A129 | P2 / E | 2 | Explain pressure thresholds directly in leave calendars and legends. | A colored day has a visible reason and a route to the underlying people. |
| A130 | P2 / E | 2 | Add an audited leave-correction workflow with preservation of the original values. | An incorrect approved absence can be corrected without losing history. |

### 14. Leave import pathways

Evidence/context: [frontend/src/main.ts:3228](../frontend/src/main.ts#L3228), [backend/app/services/leave_import.py:823](../backend/app/services/leave_import.py#L823), [backend/app/services/leave_import.py:741](../backend/app/services/leave_import.py#L741).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A131 | P1 / C | 2 | Expose every leave preview row through pagination instead of only the first 25. | Admins can review all records that will be applied. |
| A132 | P1 / E | 2 | Add an in-place member resolver for unresolved leave names. | A row can be matched and re-previewed without abandoning the import screen. |
| A133 | P2 / E | 2 | Add worksheet, header and column selection for tabular leave workbooks. | Common departmental layouts can be configured without modifying source files. |
| A134 | P1 / E | 2 | Show the source and interpreted date values together for ambiguous dates. | Admins must confirm an ambiguous date convention before applying it. |
| A135 | P2 / E | 2 | Provide separate templates for date-range leave and day-matrix leave. | The supported layouts are illustrated with valid examples. |
| A136 | P1 / E | 2 | Distinguish exact duplicate, overlapping leave and different-slot absence in review. | Different cases produce different correction choices. |
| A137 | P1 / E | 2 | Require explicit confirmation of partial import with a skipped-row summary. | Users know which unresolved records will remain unapplied. |
| A138 | P1 / E | 2 | Preserve confirmed name resolutions as reviewed aliases when authorized. | The next leave upload does not repeatedly require the same spelling correction. |
| A139 | P2 / E | 2 | Offer editable normalized leave type and slot in row correction. | A parsing mistake can be corrected without altering the original spreadsheet. |
| A140 | P1 / E | 2 | Validate and explain month-boundary handling before applying imported leave. | Cross-month dates are preserved and the affected months are visible. |

### 15. Monthly rota setup

Evidence/context: [frontend/src/main.ts:4952](../frontend/src/main.ts#L4952), [backend/app/services/rota_setup.py:26](../backend/app/services/rota_setup.py#L26), [backend/app/services/rota_setup.py:73](../backend/app/services/rota_setup.py#L73).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A141 | P1 / C | 2 | Make setup GET requests read-only and create periods/scopes through an explicit action. | Browsing a month does not create database records. |
| A142 | P1 / C | 1 | Enforce scope immutability while locked; current updates can keep locked=true while changing units. | A locked scope must be deliberately unlocked before its membership changes. |
| A143 | P1 / E | 2 | Show a clone-previous-month diff before saving the cloned scope. | Unexpected exclusions or missing units cannot be copied unnoticed. |
| A144 | P1 / E | 2 | Recalculate included, excluded and readiness counts as selections change. | Unsaved selections and displayed summary counts stay consistent. |
| A145 | P2 / E | 2 | Add a saved/unsaved indicator and discard-changes control to Rota Setup. | Users can tell whether the displayed scope has been committed. |
| A146 | P1 / E | 2 | Validate readiness across the actual month, including promotions and transfers. | A ready unit has passed date-sensitive checks across its participating days. |
| A147 | P2 / E | 2 | Provide bulk include/exclude controls with individual exceptions. | Large unit lists can be configured efficiently while preserving reviewability. |
| A148 | P2 / E | 2 | Explain excluded-unit safety behavior with a concrete example. | Users understand which excluded people still affect staffing calculations. |
| A149 | P1 / E | 2 | Track scope changes and lock/unlock actions with actor, time and reason. | A generated rota can be traced to the scope used at generation. |
| A150 | P2 / E | 2 | Give each readiness warning a direct link to the exact offending posting or leave record. | Resolving a warning does not require searching the destination screen. |

### 16. Rules and duty eligibility configuration

Evidence/context: [frontend/src/main.ts:4730](../frontend/src/main.ts#L4730), [backend/app/api/v1/rota_rules.py:21](../backend/app/api/v1/rota_rules.py#L21), [backend/app/services/rota_rules.py:100](../backend/app/services/rota_rules.py#L100).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A151 | P2 / E | 3 | Add rule search and filters by duty group, call level and active status. | Admins can locate a duty rule among the full rule catalog. |
| A152 | P2 / E | 3 | Replace difficult multiple-select controls with accessible searchable selection lists. | Selected calls and groups are obvious on both desktop and phone. |
| A153 | P1 / E | 3 | Show a before/after rule diff before saving changes. | Admins can review every affected rule rather than committing an opaque full form. |
| A154 | P1 / E | 3 | Add an effective-date workflow and rule-version history. | Users can schedule future rules and inspect the rules that governed an older month. |
| A155 | P1 / E | 3 | Validate contradictory allowed/excluded eligibility-group selections. | A group cannot be unintentionally both included and excluded without a clear rule outcome. |
| A156 | P1 / E | 3 | Validate warning thresholds against hard-block thresholds. | A warning threshold cannot exceed the corresponding blocking threshold. |
| A157 | P1 / E | 3 | Explain and validate zero-hour duties consistently with import and scoring behavior. | Zero has one documented meaning and cannot silently change across pathways. |
| A158 | P2 / E | 3 | Show affected duty pools and eligible-member counts while editing a rule. | An empty eligibility pool is visible before the rule is saved. |
| A159 | P1 / E | 3 | Preview how changed rules affect existing draft and published rotas. | Admins can choose an explicit revalidation or versioning action. |
| A160 | P2 / E | 3 | Provide a reviewed reset-to-default action for individual rules. | Defaults can be restored without erasing unrelated custom settings. |

### 17. Eligibility groups

Evidence/context: [frontend/src/main.ts:4849](../frontend/src/main.ts#L4849), [backend/app/api/v1/call_clusters.py:21](../backend/app/api/v1/call_clusters.py#L21), [backend/app/models/call_cluster.py:14](../backend/app/models/call_cluster.py#L14).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A161 | P1 / C | 3 | Refresh the roster when opening groups instead of reusing any nonempty member cache. | Recent promotions, restorations and name changes appear in group selection. |
| A162 | P1 / E | 3 | Evaluate allowed group members at the chosen effective date. | A scheduled promotion is considered when configuring future group membership. |
| A163 | P1 / E | 3 | Show existing membership start/end dates and a future membership timeline. | Users can distinguish current membership from a scheduled change. |
| A164 | P2 / E | 3 | Display selected, eligible, excluded and search-result counts separately. | The shown count is not confused with the actual membership size. |
| A165 | P2 / E | 3 | Add select-visible and clear-visible controls for eligible search results. | Batch selection respects the current filter and parent call. |
| A166 | P1 / E | 3 | Preview additions and removals before Save Members replaces membership. | Admins can inspect precisely who joins or leaves the group. |
| A167 | P1 / E | 3 | Require a dependency review before deactivating a group referenced by duty rules. | An active duty cannot silently lose its eligibility pool. |
| A168 | P1 / E | 3 | Highlight group members whose call level no longer matches the parent call. | Promotion-related membership drift becomes an actionable correction queue. |
| A169 | P2 / E | 3 | Link group members to their canonical profiles without losing group drafts. | Eligibility decisions can be checked against promotion history. |
| A170 | P2 / E | 3 | Add a group membership export with effective dates and stable member IDs. | Admins can reconcile specialist pools with departmental records. |

### 18. Template generation and rota presentation

Evidence/context: [frontend/src/main.ts:6337](../frontend/src/main.ts#L6337), [frontend/src/main.ts:5860](../frontend/src/main.ts#L5860), [backend/app/api/v1/rota_template.py:22](../backend/app/api/v1/rota_template.py#L22).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A171 | P1 / B | 3 | Fix overflowing template action rows on desktop and phone layouts. | The page width stays within the viewport and every action remains reachable. |
| A172 | P2 / B | 3 | Collapse the long stack of template metrics into a concise mobile summary. | A phone user reaches the calendar without scrolling past dozens of tiles. |
| A173 | P1 / E | 3 | Add a generation preview showing slot counts, duty choices and scope before committing. | Users can review the planned template before slots are written. |
| A174 | P1 / E | 3 | Expose regeneration behavior as preserve, replace or merge with an assignment impact diff. | Regeneration cannot discard existing work unexpectedly. |
| A175 | P1 / E | 3 | Show explicit unchecked/failed safety states instead of empty safety objects after request failure. | Unavailable checks cannot resemble a successfully checked rota. |
| A176 | P1 / E | 3 | Explain the limits of Fast Load Mode and provide an explicit check-safety action. | Users can tell which safety and candidate datasets have not been loaded. |
| A177 | P2 / E | 3 | Add calendar/list filters for duty, unit, campus, call level and assignment state. | A full month can be reduced to a useful planning subset. |
| A178 | P2 / E | 3 | Keep day dialogs linked to the selected month and support return to the same calendar cell. | Reviewing a day preserves the user's navigation context. |
| A179 | P1 / E | 3 | Require a reviewed impact summary when clearing duties and assignments. | The action identifies exactly which saved records will be removed. |
| A180 | P2 / E | 3 | Show generation-run provenance including rule version, scope version and initiating user. | A displayed template can be reproduced and compared with previous runs. |

### 19. Candidate selection and automatic allocation

Evidence/context: [frontend/src/main.ts:5258](../frontend/src/main.ts#L5258), [backend/app/services/rota_candidates.py:57](../backend/app/services/rota_candidates.py#L57), [backend/app/services/rota_auto_fill.py:32](../backend/app/services/rota_auto_fill.py#L32).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A181 | P1 / E | 3 | Show score components separately for current burden, historical burden and other ranking factors. | A candidate's score can be explained without reading backend logs. |
| A182 | P1 / E | 3 | Show blocking rules separately from soft ranking reasons in candidate cards. | Users understand which issues cannot be fixed by choosing a higher score. |
| A183 | P1 / E | 3 | Include the target-date call level and promotion basis in candidate details. | Eligibility is understandable when the member changes call level during the month. |
| A184 | P1 / E | 3 | Show historical coverage and neutral-history handling beside history penalties. | Missing history is not mistaken for evidence of low workload. |
| A185 | P1 / E | 3 | Preview auto-fill assignments and leftovers before committing a run. | Users can inspect the proposed allocation and unresolved slots first. |
| A186 | P1 / E | 3 | Provide an auditable run summary with before/after workload and open-slot reasons. | The allocation result explains both assignments made and slots left open. |
| A187 | P1 / E | 3 | Support cancellation and resumable status for lengthy auto-fill operations. | The UI remains responsive and does not repeat an uncertain run. |
| A188 | P1 / E | 3 | Revalidate candidate eligibility at commit time after simultaneous master-data changes. | A previously suggested candidate cannot be saved using stale availability. |
| A189 | P2 / E | 3 | Allow comparing a small set of candidates side by side. | Burden, leave, rest and eligibility tradeoffs are visible together. |
| A190 | P1 / E | 3 | Keep manual assignments protected during auto-fill and explain any regeneration exceptions. | A run does not silently replace deliberate board decisions. |

### 20. Review, overrides and exchanges

Evidence/context: [frontend/src/main.ts:6992](../frontend/src/main.ts#L6992), [backend/app/api/v1/rota_review.py:20](../backend/app/api/v1/rota_review.py#L20), [backend/app/services/rota_review.py:36](../backend/app/services/rota_review.py#L36).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A191 | P1 / B | 3 | Fix phone-width overflow in the Review page. | Review controls and content remain usable at a 390-pixel viewport. |
| A192 | P2 / E | 3 | Group related review issues by slot and show a clear next action. | Users resolve one underlying problem instead of repeatedly opening duplicate issues. |
| A193 | P1 / E | 3 | Show the rule, data source and affected date behind each blocker. | The reviewer can trace an issue to a concrete correction. |
| A194 | P1 / E | 3 | Differentiate acknowledge-warning, approved override and hard-block outcomes in the UI. | A warning acknowledgement is never mistaken for permission to bypass a hard block. |
| A195 | P1 / E | 3 | Require appropriate approval roles and detailed reasons for allowed overrides. | Every override has a responsible approver and an auditable basis. |
| A196 | P1 / E | 3 | Preview both sides of an exchange, including rest and staffing impacts. | A swap is checked as a complete operation before approval. |
| A197 | P1 / E | 3 | Revalidate exchanges against current data at approval time. | A pending request cannot apply after its eligibility assumptions become invalid. |
| A198 | P2 / E | 3 | Show exchange history with requester, approver, time and rejection reason. | The full decision trail is visible from the rota month. |
| A199 | P2 / E | 3 | Add member, unit, call-level and issue-age filters to the review queue. | The board can divide review work and locate a specific person's problems. |
| A200 | P1 / E | 3 | Detect stale decisions when the underlying assignment, leave or rule changes. | Previously resolved issues return for review when their basis changes. |

### 21. Publication and exports

Evidence/context: [frontend/src/main.ts:7148](../frontend/src/main.ts#L7148), [backend/app/api/v1/rota_publish.py:17](../backend/app/api/v1/rota_publish.py#L17), [backend/app/services/rota_publish.py:21](../backend/app/services/rota_publish.py#L21).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A201 | P1 / E | 3 | Show the exact rota revision and checklist snapshot being approved. | Publication identifies the data the board actually reviewed. |
| A202 | P1 / E | 1 | Enforce publish/approve permissions separately from ordinary viewing permissions. | An authenticated viewer cannot publish solely because they can load the checklist. |
| A203 | P1 / E | 3 | Add a final approval summary of assignments, overrides, exclusions and unresolved warnings. | The approver can review the complete decision before final publication. |
| A204 | P2 / E | 3 | Make checklist blockers jump directly to the relevant slot or setup record. | Resolving publication blockers requires fewer context-switching steps. |
| A205 | P1 / E | 3 | Define an amendment workflow for changes made after publication. | A published revision remains identifiable when a later correction is issued. |
| A206 | P1 / E | 3 | Tie exported files to the approved revision rather than an ambiguous current state. | An export can be verified against its publication record. |
| A207 | P2 / E | 3 | Offer a preview of the Excel layout and contents before downloading. | Users can confirm month, campus and duty formatting in the UI. |
| A208 | P2 / E | 3 | Offer clearly labeled board, member and unit-oriented export layouts. | Recipients receive a useful view of the same approved rota. |
| A209 | P1 / E | 3 | Neutralize spreadsheet formulas in exported names, aliases and user-entered notes. | Values beginning with spreadsheet formula characters are exported safely as text. |
| A210 | P2 / E | 3 | Show export errors and allow retry without repeating publication. | A failed download does not require approving the rota again. |

### 22. Past duties and historical fairness

Evidence/context: [frontend/src/past-duties.ts:14](../frontend/src/past-duties.ts#L14), [backend/app/services/past_duties.py:38](../backend/app/services/past_duties.py#L38), [backend/app/services/history_fairness.py:109](../backend/app/services/history_fairness.py#L109).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A211 | P2 / E | 3 | Add source samples and sheet/layout detection to the past-duty upload wizard. | Users can distinguish table and department-matrix layouts before previewing. |
| A212 | P1 / E | 3 | Display an exact correction diff including prior member, replacement and resulting statistics. | Historical corrections have an understandable effect before approval. |
| A213 | P1 / E | 3 | Extend duplicate review to legitimate same-person shifts with distinct time intervals. | Separate duties are not conflated solely because their date and duty type match. |
| A214 | P2 / E | 3 | Paginate past-duty preview rows and use a searchable shared member resolver. | Large workbooks do not render a full member dropdown for every row. |
| A215 | P1 / E | 3 | Record confirmed historical month coverage, including verified zero-duty members. | Fairness calculations can distinguish a complete zero from missing records. |
| A216 | P1 / E | 3 | Account for historical call-level changes when comparing historical burdens. | A recently promoted person's earlier-role duties are interpreted under a documented policy. |
| A217 | P1 / E | 3 | Represent imported campus/unit context in structured fields used by checks and statistics. | Campus information is not stored only as notes that allocation cannot reliably use. |
| A218 | P2 / E | 3 | Add policy-version history and an as-of-date selector for fairness settings. | Admins can inspect scheduled settings and the policy used by a particular rota. |
| A219 | P2 / E | 3 | Provide a coverage drilldown from month to day, duty and source batch. | Missing historical days and the origin of recorded duties are easy to inspect. |
| A220 | P1 / E | 3 | Add a reviewed historical-duty correction and reversal workflow beyond person replacement. | Wrong times, duty types and dates can be corrected with retained provenance. |

### 23. Duty Analysis and statistical interpretation

Evidence/context: [frontend/src/main.ts:2498](../frontend/src/main.ts#L2498), [backend/app/services/analysis.py:229](../backend/app/services/analysis.py#L229), [backend/app/services/analysis.py:533](../backend/app/services/analysis.py#L533).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A221 | P1 / C | 3 | Replace the hardcoded Jan 2025-May 2026 analysis subtitle with the actual data range. | Newly uploaded months appear accurately in the page description. |
| A222 | P2 / E | 3 | Use a common date, campus, call-level and member filter across all analysis tabs. | Comparisons between tabs refer to the same selected population. |
| A223 | P1 / E | 3 | Show counted-duty definitions and exclusions beside 24-hour and weekend metrics. | Users can understand why different totals differ. |
| A224 | P2 / E | 3 | Enable drilldown from every aggregate to its source assignments. | A total can be reconciled with actual records and import provenance. |
| A225 | P2 / E | 3 | Show data-completeness indicators on personnel and month comparisons. | Incomplete coverage does not look like lighter workload. |
| A226 | P1 / E | 3 | Use historical effective call levels for role-period comparisons and label inferred levels. | Promotion analysis distinguishes recorded history from fallback inference. |
| A227 | P2 / E | 3 | Expose normalized rates and their denominators alongside raw totals. | People with different covered periods can be compared transparently. |
| A228 | P2 / E | 3 | Add export of the current filtered analysis view with definitions and coverage metadata. | A shared report reproduces the displayed selection and meaning. |
| A229 | P2 / E | 3 | Provide meaningful empty states for each analysis tab and comparison. | A lack of relevant duty types produces an explanation rather than an ambiguous blank chart. |
| A230 | P1 / C | 3 | Make manual-review analysis reflect current import batches as well as legacy filesystem reports. | New upload issues are not absent merely because they were never written to a legacy CSV report. |

### 24. Accessibility and phone interaction

Evidence/context: [frontend/src/main.ts:5860](../frontend/src/main.ts#L5860), [frontend/src/main.ts:4952](../frontend/src/main.ts#L4952), [frontend/src/styles.css:2849](../frontend/src/styles.css#L2849).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A231 | P1 / B | 4 | Correct unsupported ARIA attributes on member and template controls. | Automated checks no longer report aria-allowed-attr violations for these controls. |
| A232 | P1 / B | 4 | Give template tabs the correct roles, relationships and selected state. | The tablist has valid tab children and keyboard navigation follows its semantics. |
| A233 | P1 / B | 4 | Label every unit-scope select with the unit identity and field purpose. | Rota Setup no longer reports select-name violations. |
| A234 | P1 / B | 4 | Fix insufficient contrast in the Members Unassigned call-level chip. | The observed 2.99:1 text contrast meets the applicable 4.5:1 requirement. |
| A235 | P1 / B | 4 | Make overflowing review, import and diagnostics regions keyboard focusable. | Keyboard users can reach and scroll the regions identified by the browser checks. |
| A236 | P2 / E | 4 | Audit and improve touch-target size for repeated archive, save and calendar controls. | Phone users can activate adjacent actions reliably without mis-taps. |
| A237 | P1 / E | 4 | Standardize focus trapping, Escape closing and focus restoration in all custom dialogs. | Keyboard focus stays inside an open modal and returns to its trigger. |
| A238 | P2 / E | 4 | Add accessible table captions, column scopes and sortable-column announcements. | Screen-reader users understand table purpose and current sort order. |
| A239 | P2 / E | 4 | Provide non-color labels for all pressure, safety and warning indicators. | Status remains understandable without distinguishing colors. |
| A240 | P2 / E | 4 | Verify zoom, reduced motion, dark mode and narrow layouts across busy and error states. | Core tasks remain readable and operable under these display preferences. |

### 25. Mappings, diagnostics and operating guidance

Evidence/context: [frontend/src/main.ts:2560](../frontend/src/main.ts#L2560), [frontend/src/main.ts:7282](../frontend/src/main.ts#L7282), [frontend/src/main.ts:7323](../frontend/src/main.ts#L7323).

| ID | Priority / basis | Phase | Action | Acceptance criterion |
|---|---|---:|---|---|
| A241 | P1 / C | 4 | Provide an editable mobile mapping card; current cards show values and Save without editors. | Phone users can change target, status and notes before saving a mapping. |
| A242 | P1 / E | 4 | Use validated unit and duty selectors instead of free-form mapping target keys. | Mappings cannot point to nonexistent targets through ordinary editing. |
| A243 | P1 / E | 4 | Show a preview of affected import labels before changing a mapping. | Admins can assess the downstream normalization consequences. |
| A244 | P2 / E | 4 | Retain mapping edit drafts while searching or switching type filters. | Filtering does not silently discard unsaved row edits. |
| A245 | P2 / E | 4 | Add reviewed/suggested/unresolved mapping counts and a correction queue. | Admins can focus on the labels that still block import quality. |
| A246 | P2 / E | 4 | Replace diagnostics-only JSON with actionable checks and correction links. | Invalid names, missing call levels and import problems have direct next steps. |
| A247 | P2 / E | 4 | Provide a redacted diagnostics download with revision and environment metadata. | Support information can be shared without exposing credentials or private comments. |
| A248 | P2 / E | 4 | Update the User Guide for HOD profiles, dated promotions and all current import workflows. | Guide instructions match the currently visible roles and section names. |
| A249 | P2 / E | 4 | Add contextual help and links to the relevant guide step from import and setup screens. | Users can understand a term or format without searching the entire guide. |
| A250 | P1 / E | 1 | Add a focused regression suite for approved import, synchronization and mobile workflows. | Each implemented fix has a meaningful check tied to its acceptance criterion. |

## Files and approval

- [Sortable CSV backlog](ui_ux_import_actions_2026_10_13.csv) contains all 250 items with evidence, acceptance criteria, phase and status.
- [Verification record](ui_ux_import_verification_2026_10_13.md) contains observed screen and isolated API results.
- Synthetic screenshots and reproducible investigation harnesses are under the ignored local directory `tmp/ui_audit/`; they contain no real department records.

All phases have been approved for implementation and testing. Progress is recorded in the implementation log and CSV. Deployment and real-database import are outside this inspection and implementation checkpoint.
