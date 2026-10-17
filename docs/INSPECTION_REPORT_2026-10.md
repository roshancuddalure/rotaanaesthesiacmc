# Inspection Report — Duty Rota Software

| | |
|---|---|
| Date | 17 October 2026 |
| Code inspected | `main` at commit `a231ddf` ("dutyrota26may26") |
| Scope | Entire repository: backend (FastAPI services, models, 17 migrations), frontend (`main.ts`, `api.ts`), tests, Docker/Railway setup, scripts, planning docs |
| Companion | [`DEVELOPER_HANDBOOK.md`](DEVELOPER_HANDBOOK.md) |
| Changes made during the inspection | Documentation only: module docstrings, function docstrings and `KNOWN ISSUE (handbook <ID>)` comments. Verified mechanically: all 61 changed Python files are AST-identical to `HEAD` once docstrings are ignored, and both changed TypeScript files compile to identical JavaScript once comments are stripped. |

## How the inspection was done

- Read every backend module (API, services, models, migrations) and the structure and
  critical paths of the frontend (auth, navigation, event wiring, rendering, API client).
- Ran the backend test suite (**157 passed**) and the frontend type-check (**clean**), both
  before and after adding the documentation.
- Generated the route table from the running app to check authentication on every endpoint
  (**85 routes, 32 without authentication**).
- Reproduced the key logic findings with a scratch script against an in-memory database:
  - **B2:** with a 24h duty saved on the 13th, assigning the same doctor a 24h duty on the 12th validates as `clear`.
  - **B9:** PAC, shift and CHAD slots are generated as 24-hour windows.
- Checked repository hygiene and the GitHub visibility of `origin` (**public**).

Severity: **Critical** (exploitable now / data loss), **High**, **Medium**, **Low**.
Perspective: **Dev** = affects maintainers/operations, **User** = visible to the rota board.

---

## Immediate actions (do these first)

1. **Make the GitHub repository private now.** Then treat everything ever committed as
   leaked: rotate the Railway Postgres password and every credential in `cred/`; reset all app
   passwords; and purge `cred/`, `backups/`, `Debug/` and the logs from history
   (`git filter-repo` or BFG, then force-push and re-clone). → S1
2. **Stop returning password-reset tokens** from `/auth/forgot-password`. Remove or protect
   `/auth/seed-superadmin`. Change the `rotachief` password on the live system. → S2, S4
3. **Add `Depends(require_admin)`** to the members, admin mappings, historical import and
   analysis routers. The roster reset endpoint should require superadmin plus a confirmation
   token, or be removed. → S3, B4
4. **Escape all interpolated strings** in `main.ts`, starting with member names, mapping labels
   and account names. → S5
5. **Lock published months**: reject generate/clear/assign/auto-fill/exchange/scope changes
   when `RotaPeriod.status == "published"` unless the month is explicitly re-opened with a reason;
   snapshot the published rota. → B1

---

## Issue register

| ID | Sev | Persp. | Title | Main location |
|---|---|---|---|---|
| S1 | Critical | Dev | Public repo contains credentials screenshots, DB dump with password hashes, debug screenshots | `cred/`, `backups/`, `Debug/` |
| S2 | Critical | User+Dev | Anyone can reset any account's password (token returned & auto-filled) | `api/v1/auth.py` `forgot_password`; `main.ts` `renderForgotForm` |
| S3 | Critical | Dev | 32 endpoints have no auth, incl. destructive member/import/roster-reset operations | `api/v1/members.py`, `admin_mappings.py`, `historical_imports.py`, `analysis.py` |
| S4 | High | Dev | Hard-coded default superadmin credentials; unauthenticated seed endpoint | `services/auth.py` `seed_superadmin`; `Plan/05_confirmed_decisions.md` |
| S5 | High | User+Dev | Stored XSS: server strings rendered into `innerHTML` unescaped; token in `localStorage` | `main.ts` member rows/cards, mappings, accounts |
| S6 | Medium | Dev | Weak authorisation model: any signed-in role can publish/clear/approve own exchanges; computer admin can create superadmins; manual assignments not attributed to a user | rota routers; `auth.py` `create_account`; `DutyAssignment` |
| S7 | Medium | Dev | No login throttling/lockout; no password policy on create/reset; no server-side sign-out; expired sessions never purged | `services/auth.py`, `api/v1/auth.py` |
| S8 | Low | Dev | Upload endpoints read whole files into memory without a size limit; Swagger `/docs` public in production; localhost CORS origins always allowed | `leave.py`, `unit_management.py`, `main.py` |
| B1 | High | User | Published months are not locked; final export is rebuilt from live data | `rota_publish.py`, `rota_template.py`, `rota_assignment.py`, `rota_auto_fill.py`, `rota_review.py`, `rota_setup.py` |
| B2 | High | User | 24-hour rest rule only partially enforced (one direction, previous day only, not across months; `minimum_gap_after_24hr_hours` and `post_24hr_blocks_next_day_elective` not enforced) | `rota_safety.py` `assignment_indexes`; `rota_rules.py` |
| B3 | High | User+Dev | Historical and live rota periods collide for the same month | `rota_setup.get_or_create_rota_period`; `historical_analysis_dry_run.get_or_create_analysis_period` |
| B4 | High | User+Dev | Roster reset, member merge and invalid-member delete ignore newer FK tables → 500 errors on PostgreSQL | `department_roster_reset.py`, `members.py` |
| B5 | Medium | User | Safety/generation count postings from all sources; Unit Management shows only board postings | `rota_safety.postings_for_month`, `rota_template.postings_for_month` |
| B6 | Medium | User | Unit import "replace existing" deletes multi-month postings for other months | `unit_assignment_import.clear_unit_board_month` |
| B7 | Medium | User | Generating with "replace existing" off can create a second slot for the same day+duty | `rota_template.generate_empty_template` |
| B8 | Medium | User | Exchange approval can overwrite a newer assignment; requester can self-approve | `rota_review.approve_exchange_request` |
| B9 | Medium | User | Non-24h duties without a duration (PAC, shifts, CHAD, RUHSA, Neuro…) become 24-hour slots | `rota_template.slot_bounds`, `rota_rules._default_duty_rule` |
| B10 | Medium | User | "Clone previous month" silently unlocks a locked scope | `rota_setup.clone_previous_scope` |
| B11 | Medium | Dev | Rule "versions" are overwritten in place; runs/publishes cannot be reproduced | `rota_rules.save_phase_one_rules`, `models/rules.py` |
| B12 | Low | User | Auto-fill run marked `completed` up front; a crash leaves partial assignments | `rota_auto_fill.run_safe_auto_fill` |
| B13 | Low | User | Leave type/slot/status are free text; a typo in status makes leave non-blocking | `api/v1/leave.py`, `services/leave.py` |
| B14 | Low | Dev | Call-level vocabularies inconsistent (Co-1st folded into 1st; CO_3RD only in analysis) | `rota_call_levels.py`, `analysis.py`, `domain/call_levels.py` |
| B15 | Low | User | Name filter rejects real names ("Harish", "Prabhu", "Aadil") and any name containing a month word ("May", "Jan") | `services/imports.py` |
| B16 | Low | Dev | Dataset specifics hard-coded (roster sheet names, May 2026 workbook, alias overrides, 2026-03-01 effective date) | `roster_reconciliation.py`, `unitwise_call_levels.py`, `department_roster_reset.py`, `historical_analysis_dry_run.py` |
| B17 | Low | User | Call-level minimums silently ignored when saved without a month; unit minimum not checked against members | `api/v1/unit_management.update_unit_settings` |
| B18 | Low | User | Workload "duty group" taken from duty-key prefix, not the rule family | `rota_review.person_workload_rows` |
| B19 | Low | User | Hard-blocked review items cannot be accepted, so months with forced allocations in small units can be impossible to publish without changing rules | `rota_review.ACCEPTABLE_REVIEW_DECISION_CODES`, `rota_publish` |
| B20 | Low | User | Candidate score counts "same weekday/weekend load" and "weekend 24h" twice | `rota_candidates.candidate_score` |
| P1 | High | User | Candidate ranking and auto-fill re-query the whole month per candidate per slot; full-month auto-fill is very slow | `rota_candidates.py`, `rota_assignment.validate_assignment`, `rota_auto_fill.py` |
| P2 | Medium | Dev | Slot safety recomputes member contexts per slot and runs one cluster query per member per slot | `rota_safety.py` |
| P3 | Low | Dev | Vertical shuffle is O(swaps × n² × n) | `rota_template.optimize_template_slot_layout` |
| P4 | Low | Dev | N+1 queries in leave calendar/pressure and roster reconciliation; analysis loads every assignment | `leave.py`, `roster_reconciliation.py`, `analysis.py` |
| P5 | Low | Dev | GET endpoints write (period, scope, rules, clusters); concurrent first access can raise unique-constraint errors | `rota_setup.py`, `rota_rules.py`, `call_clusters.py` |
| D1 | High | Dev | Import/roster/mapping features cannot work in the Docker/Railway image (data files absent, paths resolve to `/`); historical import writes artefacts into the code directory at runtime | `admin_mappings.HISTORICAL_DIR`, `historical_analysis_dry_run.REPO_DIR`, `analysis.ANALYSIS_REBUILD_DIR`, roster paths |
| D2 | Medium | Dev | No CI; tests only on SQLite (FK behaviour untested); README and Railway docs out of date (old repo name; docs tell you to commit DB dumps) | repo root, `docs/RAILWAY_DEPLOYMENT.md` |
| D3 | Low | Dev | Repository clutter: committed logs, `~$` Excel lock file, two stale `analysis_rebuild_output*` folders, legacy `historical_import.py`, unused `domain/validation.py` | various |
| D4 | Low | User+Dev | Naive UTC datetimes (`datetime.utcnow`, deprecated); frontend default month uses UTC → wrong month for 5.5 h after midnight IST on the 1st | models, `main.ts` state block |
| D5 | Medium | Dev | Maintainability: single 9.4k-line `main.ts`, 4.8k-line CSS, global mutable state, hand-written duplicated API types, very large service functions | `frontend/src`, `rota_template.py` |
| D6 | Medium | Dev | No automated database backups | operations |
| U1 | Medium | User | Session expiry (12 h) is not handled: actions start failing with toasts, no return to login; boot shows "API offline" on auth errors | `api.ts` `request`, `main.ts` `bootApp` |
| U2 | Medium | User | After sign-out → sign-in without reload, document-level listeners are registered again, so profile / change-password forms submit twice (the duplicate change-password call can then report "current password is incorrect"; inferred from code, not reproduced) | `main.ts` `bootApp`/`bindViewEvents` |
| U3 | Low | User | Every 5xx on uploads/downloads is shown as "Backend server is offline or crashed" | `api.ts` `errorFromResponse` |
| U4 | Low | User | No URL routing: refresh/back always returns to Overview and resets selected months | `main.ts` `navigateToView` |
| U5 | Low | User | Long synchronous operations (generate, auto-fill, historical import) give no progress and may time out behind Railway's proxy | rota endpoints |

---

## Details

### Security

**S1 — Public repository with secrets and personal data (Critical).**
`git remote` is `github.com/roshancuddalure/rotaanaesthesiacmc`, which is **public**. Tracked
files include `cred/superad.PNG` and `backups/password.PNG` (credential screenshots, committed
before `cred/` was git-ignored), `backups/duty_rota_2026_05_07.sql` (a full `pg_dump` that
includes `user_accounts` with password hashes plus staff names, leave and postings), 38 `Debug/`
screenshots, and Uvicorn/Vite logs. Ignoring the folders now does not remove them from history.
The untracked `backups/db oct26.txt` and `cred/*.txt` must never be committed.
*Fix:* make the repo private, rotate credentials, rewrite history, and add a pre-commit secret
scan (e.g. gitleaks).

**S2 — Account takeover via forgot-password (Critical).**
`POST /auth/forgot-password` returns `reset_token` for any existing username, and the login page
auto-fills it into the reset form. Anyone can set a new password for `rotachief`.
*Fix:* never return the token; let a superadmin issue resets from Login Accounts (or use
email/SMS); add expiry/attempt limits and a password policy.

**S3 — Unauthenticated endpoints (Critical).**
These routers have no auth dependency at all: members (16 routes, including
`reset-from-trusted-roster`, `merge`, `cleanup-invalid`, `auto-merge-duplicates`), admin mappings
(5), historical imports (2, including `run`) and analysis (3, which expose per-person duty data).
The UI hides admin tools, but the API is open to anyone who can reach the server.
*Fix:* add `_admin: UserAccount = Depends(require_admin)` (or apply `dependencies=[...]` on each
router), then add a test asserting 401 for every non-public route.

**S4 — Default superadmin (High).** `seed_superadmin` creates `rotachief` with a fixed password
that is written in the source and the planning docs, and the seed endpoint is public.
*Fix:* remove the endpoint; seed via a CLI that reads the password from an environment variable.

**S5 — Stored XSS (High).** `main.ts` renders with `innerHTML`; `escapeHtml` is used in many
places but not everywhere. Unescaped examples: `member.canonical_name` (member table, cards, aria
labels), `mapping.source_label` / `mapping.notes`, `account.username` / `display_name`, and the
analysis manual-review `row.reason`. A member can be created without logging in (S3), so a name
like `<img src=x onerror=...>` runs in every admin's browser and can read the token from
`localStorage`. *Fix:* escape every interpolation (or build DOM with `textContent`); consider an
HttpOnly cookie session; add a Content-Security-Policy.

**S6 — Authorisation model (Medium).** Any `rota_board_member` can publish, clear a month
including assignments, approve their own exchange requests, edit unit settings and import data.
`create_account` lets a computer admin create superadmins. `DutyAssignment` stores no user, so
manual changes are not attributable. *Fix:* decide a permission matrix with the rota board (for
example, publish/clear limited to admins, four-eyes approval for exchanges), and add
`created_by_user_id` to assignments.

**S7 / S8** — see the register; standard hardening items (rate limiting, password rules, session
revoke on sign-out, purge job, upload size limits, disable `/docs` in production).

### Data integrity and business logic

**B1 — Published months are editable (High, user-facing).** After publishing, the board can
still regenerate or clear the template (with assignments), assign/clear people, run auto-fill,
approve exchanges and unlock the scope. The period status stays `published`, and the "final"
Excel export is regenerated from the live tables on every download, so it can silently differ
from what was approved. The confirmed decision that violations must not be publishable without
an explicit override is also undermined. *Fix:* enforce a `published` guard in every mutating
service, add an explicit "re-open month" action with a reason, and store a snapshot (assignments
+ rules + checklist) in `RotaPublishApproval.summary` to export from.

**B2 — 24-hour spacing rule gaps (High, user-facing; reproduced).** Blocking is derived only
from a 24h duty on the *previous calendar day* (`previous_day` index):
- If a doctor already has a 24h duty on the 13th, assigning them a 24h duty on the 12th returns
  `clear` — back-to-back 24h duties with no warning (reproduced).
- The previous month's last day is not loaded, so 31st → 1st is never checked.
- `rest_rules.minimum_gap_after_24hr_hours` only affects candidate ranking text/penalty;
  `post_24hr_blocks_next_day_elective` is not read anywhere (the toggle in Rota Rules does
  nothing).
- `domain/validation.validate_24hr_spacing` implements the correct two-sided check but is unused.
*Fix:* index blockers on both sides (`d-1` and `d+1`), load the adjacent days of neighbouring
months, enforce the configured minimum gap from `starts_at/ends_at`, and either use or remove
the unused setting.

**B3 — Period collision (High).** Historical import creates periods named `2026-05`; Rota
Setup looks periods up by start/end date and names new ones `May 2026`. For any month covered
by historical data (Jan 2025–May 2026), Rota Setup picks up the historical period (status
`historical`), so draft slots appear in the analysis dashboard immediately. If both exist,
`db.scalar` picks one arbitrarily. Re-running the historical import resets that period's
status to `historical`, even if it was published. *Fix:* make `(starts_on, ends_on)` unique,
give historical data its own period type/flag, and make both code paths use one lookup.

**B4 — Destructive operations break on PostgreSQL (High).** `clear_operational_data` (roster
reset) deletes from 15 tables but not from 11 newer ones that reference them (cluster
memberships, generation scopes and scope units, generation runs and events, auto-fill runs and
events, exchanges, review decisions, publish approvals, unit call minimums). None of those FKs cascade, so once the rota
features have been used the reset fails with a 500 (the transaction is rolled back). Likewise,
`merge_people` / `delete_invalid_members` do not handle call-cluster memberships, so merging a
member who is in an eligibility group fails. The SQLite test suite cannot catch this because
SQLite does not enforce foreign keys by default. *Fix:* handle the dependants explicitly (or add
`ondelete` rules via migration) and run tests on PostgreSQL.

**B5 — Two sources of truth for unit membership (Medium).** Unit Management and readiness use
`unit_board` postings only. Generation, safety, candidates and review workload use **all**
postings, including historical ones. In months where both exist, eligibility can include people
the board did not post there. *Fix:* filter on `source == UNIT_BOARD_SOURCE` everywhere rota logic
runs (or make the source policy explicit).

**B6 — Unit import replace deletes other months (Medium).** `clear_unit_board_month` deletes
every board posting that overlaps the month, so a posting from 1 May to 31 July is removed
entirely when June is re-imported with "replace existing". *Fix:* trim the posting to the
month boundaries (split it) instead of deleting it.

**B7 — Duplicate slots (Medium).** Existing slots are matched by `(date, duty, unit-label)`. With
`replace_existing=false`, a second generation adds another slot for the same duty and day in a
different unit. *Fix:* treat `(date, duty)` as already covered unless more than one slot per duty
is intended.

**B8 — Stale exchange approval (Medium).** Approval calls `assign_person_to_slot(...,
replace_existing=True)` without checking that `from_assignment_id` is still active. If the slot
was reassigned in the meantime, the newer holder is replaced. The requester can also approve
their own request. *Fix:* verify the assignment and block self-approval.

**B9 — 24-hour windows for short duties (Medium; reproduced).** Default rules set
`duration_hours=0` for duties that are neither 24h nor "12HR"; `slot_bounds` then treats
08:00 → 08:00 as overnight. PAC, shifts, CHAD, RUHSA, Neuro, CB Paeds and similar slots are
stored as 24-hour windows. Exports and rest-gap scoring use these times; historical import uses
12 hours for the same duties. *Fix:* set explicit default durations/start times per duty with the
rota board.

**B10 — Clone unlocks the scope (Medium).** `clone_previous_scope` calls
`update_scope_units(..., lock_scope=False, "Cloned from …")`, so a locked scope is unlocked
without the user asking. *Fix:* keep the current lock state or refuse while locked.

**B11 — No rule history (Medium).** There is one `RuleVersion`, and its JSON setting is
overwritten on save. Generation runs reference a version whose content has since changed.
*Fix:* create a new version per save (effective dates) and store a rules snapshot on runs and
publish approvals.

**B12 – B20** — see the register; each has a matching `KNOWN ISSUE` or docstring note in the
code.

### Performance

**P1 — Candidate ranking and auto-fill (High, user-facing).** For each open slot, auto-fill
rebuilds the full month context. For each candidate, `validate_assignment` reloads every posting,
leave and assignment of the month, recomputes slot safety and runs per-person cluster queries.
`assign_person_to_slot` then validates again and computes slot safety twice more. Cost grows
roughly with slots × candidates × month size, which is minutes for a real month (~800+ slots, as
recorded in the development log). It runs synchronously inside the HTTP request (Railway proxy
timeout risk) and commits per slot. *Fix:* build the month context once and update it
incrementally; preload cluster memberships into a dict; run long jobs in a background worker
with progress polling.

**P2 – P5** — see the register.

### Deployment and maintainability

**D1 — Features that cannot work in production (High).** The Dockerfile copies only
`backend/app`, so the repo-relative paths in `admin_mappings`, `historical_analysis_dry_run`,
`analysis`, `roster_reconciliation`, `department_roster_reset` and `unitwise_call_levels` resolve
under `/` inside the container, where the data does not exist. Historical import, mapping scan,
roster reconcile/reset, call-level prefill and the manual-review tab therefore fail or return
empty results on Railway. The dry run also writes CSVs into the code directory, which is
ephemeral on Railway. *Fix:* make these features upload-based (like leave/unitwise imports), or
mount a volume and configure a `DATA_DIR` setting.

**D2 – D6** — see the register. Additionally: the README still says "Phase 0 foundation";
`docs/RAILWAY_DEPLOYMENT.md` and `Plan/12_railway_deployment_notes.md` reference the repository
`Dutyrotaanaesthesia`, while the current remote is `rotaanaesthesiacmc`.

### User-experience issues

**U1 – U5** — see the register. U2 is a genuine functional bug for users who sign out and back
in without refreshing.

---

## What is in good shape

- Clear layering (API → services → models) and consistent naming; services are testable and
  well covered (157 tests, including detailed template-generation regressions).
- Strong audit trail design: generation events, auto-fill events, review decisions, exchange
  snapshots and publish approvals, all with reasons.
- Thoughtful allocation algorithm with documented fairness policies and an incident history.
- Careful import UX: every import has a preview, manual resolution and "apply only safe rows".
- Good engineering hygiene in the planning folder: decisions log, development log, user guide.
- Passwords and tokens are hashed correctly (PBKDF2, SHA-256 token hashes, constant-time compare).

## Suggested remediation roadmap

| Phase | Items |
|---|---|
| Now (days) | S1, S2, S3, S4, S5, change live passwords, backups (D6) |
| Next (1–2 weeks) | B1 publish lock + snapshot, B2 rest rule, B3 period collision, B4 FK handling, U1/U2, PostgreSQL CI (D2) |
| Then | B5–B11, P1 background jobs + incremental context, D1 upload-based imports, S6 permission matrix |
| Later | D5 frontend modularisation (split `main.ts` per screen, typed API generation from OpenAPI), remaining Low items |
