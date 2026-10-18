# Approved normalization and editing implementation

Status: implemented and verified.

Approved on 18 October 2026. Objective: complete all 60 approved items for maintainable units,
member identity, dated postings, leave, reference values, reviewed CSV imports and responsive profile editing.

## Requirement audit

Sources were inspected alongside backend and browser behavior. Primary implementations:
`backend/app/services/normalization.py`, `reference_registry.py`, `reference_catalog.py`,
`operational_import.py`, `operational_records.py`; frontend `reference-workspace.ts`,
`record-workspace.ts`, `operational-import.ts`, `member-workspace.ts` and reachable `main.ts` entry points.

Primary acceptance coverage: `backend/tests/test_normalization_registry.py`,
`backend/tests/test_operational_import.py`, existing member/unit/leave/parser suites,
`frontend/tests/normalization.browser.mjs` and `frontend/tests/member-workspace.browser.mjs`.

| # | Approved requirement | Current evidence |
|---|---|---|
| 1 | Visible Add Unit | Main Units entry; actual desktop/mobile navigation checks. |
| 2 | Complete unit form | Name, code, campus, notes, fallback and optional call minima; registry API validation. Blank call minima preserve fallback behavior. |
| 3 | Suggested code and duplicate checks | suggested_unit_code and normalized ownership; registry acceptance test. |
| 4 | Equivalent numbered units | unit_key handles U04, Unit 4 and Unit IV; comparison tests. |
| 5 | Campus separation | Campus remains in comparison keys and selector/profile labels; ambiguity requires selection. |
| 6 | Searchable lifecycle list | Name/code/campus/alias search, active/archive filter, month-based distinct member count. |
| 7 | Rename/archive/restore with history | Stable UUID, retained qualified aliases and linked records; lifecycle/stale-edit test. |
| 8 | Archive impact | Linked and future posting/duty counts appear before status confirmation. |
| 9 | Nested unit creation | Posting/import drafts survive creation; selected new unit returns to parent. Browser tests. |
| 10 | Useful empty states | Units, references and profile sections provide creation actions and readable empty states. |
| 11 | Shared identity resolution | normalization.py comparison, owner lookup and candidates are used across member CSV, unitwise, leave and historical paths. |
| 12 | Stable ID precedence | Explicit UUID before unambiguous canonical name or approved alias; ambiguity tests. |
| 13 | Unicode and title handling | NFKC/spacing comparison preserves display names; Drew/Mridula and Unicode parser regressions. |
| 14 | Initial/punctuation variants | Ambiguous owners remain unresolved; no automatic identity merge. |
| 15 | Suggestions require selection | Fuzzy auto-match expectations replaced with explicit-review and zero-auto-assignment tests. |
| 16 | Candidate metadata | Name, status, call level, designation and date-relevant units, including member CSV suggestions. |
| 17 | Select/create/skip unresolved identities | Searchable selection, nested creation and exclusions; member CSV supports explicit existing/distinct choices. |
| 18 | Explicit alias learning | Separate administrator-controlled opt-in; transactional alias learning acceptance test. |
| 19 | One normalized alias owner | Uniqueness checks include active, archived and historical people; ambiguous owners all appear as candidates. |
| 20 | Inactive identity review | Status is visible; profile review/restore preserves the parent import draft. |
| 21 | Add Posting in profile | Postings tab opens shared reviewed editor; existing records expose Edit posting. |
| 22 | Searchable member selectors | Profile, main editing and per-row import selectors include search. |
| 23 | Nested member creation | Existing identity suggestions precede creation; parent draft remains intact. |
| 24 | Independent field corrections | Corrections are stored per source row/field; member selection preserves unit/type/date edits. |
| 25 | Default/monthly/special distinction | Profile and editor explain precedence; distinct special postings may coexist with primary membership. |
| 26 | Effective and ongoing dates | Start required, open posting end supported, reversed intervals rejected; dated profile history. |
| 27 | Posting duplicate/overlap checks | Stored and within-file primary overlaps and repeated special postings rejected; distinct-special regression test. |
| 28 | Inactive/date validation | Active member/unit checks and strict date/month bounds in preview and save. |
| 29 | Append/update/replace modes | Separate frozen scopes and before/after review; cross-month replacement clips incoming ranges and splits existing ranges outside the selected month. |
| 30 | Both directions of membership | Unit board shows members; profile shows dated campus-qualified units/postings; either context opens editing. |
| 31 | Profile leave actions | Add, edit and cancel from Leave tab; changes recorded in member activity. |
| 32 | Shared leave identity tools | Search, explicit candidates, nested creation and inactive-profile review match posting/import behavior. |
| 33 | Leave-type aliases | Approved mappings such as CL to CASUAL_LEAVE; custom labels and ownership checks. |
| 34 | Leave-session aliases | Labels map to supported sessions; custom/unknown sessions conservatively block 24-hour duties. Regression test. |
| 35 | Strict approval states | Unsupported states rejected; built-in approval meanings cannot be reassigned; block/warn/nonblocking explained. |
| 36 | Ambiguous dates | CSV/XLSX text dates retained until explicit DMY/MDY convention; API tests. |
| 37 | Leave duplicates and partial overlaps | Stored and within-file checks distinguish AM/PM and conservatively handle full/custom sessions; exclusions plus refresh resolve overlaps. |
| 38 | Duty impact before leave save | Session-aware manual/import review shows affected duties; import application requires acknowledgement. |
| 39 | Approval versus record edits | Activity before/after values distinguish status, dates, type and notes with operator/time. |
| 40 | Cancellation semantics | History remains; availability block is removed; existing duties remain linked and require review. |
| 41 | Templates and completed examples | Member, unitwise and leave CSV templates plus completed examples inside import dialogs. |
| 42 | Consistent import workflow | Upload, Map, Normalize, Resolve, Review, Apply exposed across all three operational import experiences. |
| 43 | Mapping before matching | Column-inspection endpoints allow unfamiliar headers before identity matching; unknown-heading test. |
| 44 | Original/proposed/reason | Operational field review shows values and explanations; source originals retained in frozen batch/audit. |
| 45 | Explicit match states | Matched/new, needs review, ambiguous, duplicate, invalid and excluded states shown with issues. |
| 46 | Repeated correction opt-in | Explicitly apply a member/unit resolution to repeated raw labels in the current file. |
| 47 | File-only versus reusable | Ordinary corrections affect the batch; remembering an alias is separate and ownership-checked. |
| 48 | Apply valid selected rows | Exclusions survive refreshed review; invalid selected rows block apply; exclusion/overlap acceptance test. |
| 49 | Downloadable reports | Source row/sheet, original/proposed values, issues, warnings and exclusions; operational report remains after apply. |
| 50 | Frozen/stale/retry protection | Operator-owned durable batches, expiry, fingerprints, write locks and stored results; stale/retry tests; paging keeps Apply disabled after edits. |
| 51 | Consistent profile rail | Eight sections: Overview, Details, Roles, Names, Postings, Leave, Duties, Activity; profile browser tests. |
| 52 | Section-local actions and errors | Posting/leave editors, row edits and reference/designation management stay contextual. |
| 53 | Mobile profile/editor layout | Full-screen narrow dialogs, compact horizontal rail, wrapped controls and sticky editor actions; 320/390 px tests and visual inspection. |
| 54 | Draft preservation | Profile tabs and nested dialogs retain drafts; close guards prevent accidental discard; browser regression checks. |
| 55 | Keyboard/focus/touch | Native modal dialogs, focus return, rail keyboard navigation, labelled fields and 44 px targets; inspected CSS and browser tests. |
| 56 | Reference management | Search/add/edit/archive campuses, designations, leave types/sessions/statuses, posting labels and duty types; main-screen browser entry checks. |
| 57 | Visible Add Mapping | Imported label, category, searchable approved destinations and conflict checks; mapping API and navigation tests. |
| 58 | Operational reference semantics | Duty types require duration/times, eligible calls, counting and availability rules. Generator, metadata and analysis consume definitions; acceptance test generates an actual custom slot and checks timing/eligibility. |
| 59 | Audit and usage | Normalization events preserve operator/time/source/before/after; member activity covers posting/leave edits/imports. Unit/reference editors expose usage and activity before lifecycle changes. |
| 60 | Regression/browser verification | Full backend suite, boundary tests, production build, desktop/mobile import/profile tests, real screen navigation and read-only PostgreSQL smoke checks. |

## Validation

- Additive migration `20261018_0020` applied and confirmed as PostgreSQL Alembic head.
- Read-only database smoke checks: 312 members and 8 units; unit registry, campus/designation,
  leave type/session, duty catalog and metadata endpoints all returned HTTP 200.
- Final full backend suite: 206 passed; Ruff checks pass.
- Production frontend build passed.
- Browser acceptance: 11 normalization workflows and 8 existing profile/CSV/integration workflows passed.
  Layouts exercised at 1280, 390 and 320 px; actual main-screen navigation at desktop/mobile widths.
- Browser API fixtures isolate UI behavior; backend acceptance tests exercise actual SQLAlchemy transactions.
- Visually inspected mobile editor screenshot: `frontend/tests/artifacts/leave-editor-mobile.png`.

Similar people are never merged automatically. Historical names and relationships are preserved.
New operational labels must map to a supported meaning or supply the required scheduling configuration.


## Repository merge verification ? 18 October 2026

Merged the divergent local and origin/main histories while retaining the approved
60-item implementation and the remote authentication, reviewed-import, past-duty,
and HOD profile features. Consolidated duplicate profile ORM mappings and migration
revision 20261012_0018. Shared call resolution and stale-review checks cover both
workspace schedules and HOD call history; member merges preserve both histories.

Validation after reconciliation: 301 backend tests passed, 2 PostgreSQL concurrency
tests skipped; 8 frontend unit tests and 19 desktop/mobile browser workflows passed.
Production frontend build, affected Python import checks, whitespace checks, and a
single Alembic head (20261018_0020) were verified.
