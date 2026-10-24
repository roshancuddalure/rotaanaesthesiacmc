# Superadmin allocation, publish anyway, and campus ranking: contract

Status: binding for the implementing agents. Date: 21 Oct 2026. Builds on `docs/extra_duty_contract.md`
and `docs/extra_duty_fill_all_contract.md`.

## 0. Owner decisions

- Only the **superadmin** role (`user.role == "superadmin"`, see `app/api/v1/auth.py require_superadmin`) gets these.
  Computer admin, rota board and HOD do not.
- **Superadmin allocation** can assign **any active person in the department** to a specific slot. It may override call
  level, eligibility groups, the duty's unit rules, posting, individual limits, unit staffing and fairness.
- It never breaks **leave** (any active status), **rest after a 24-hour duty** (both directions and minimum gap), or
  **overlapping or same-day double duty**. If the chosen person falls in one of these, the allocation is refused and the
  superadmin is told the exact reason ("On approved leave 12 Jun", "Resting after 24-hour duty on 11 Jun", "Already on
  Main 1st Call 08:00–08:00 that day").
- A superadmin allocation **counts in the justice ledger**.
- Works on **draft and published** months. On a published month it is recorded as a post-publish change.
- **Publish anyway:** a superadmin may publish with open slots and unresolved blockers or warnings, after a reason and
  confirmation. Everyone else stays blocked, as now.
- **Campus:** keep the same-campus preference, but never stop there. If same-campus candidates are "tight" (§4),
  look further to other units.

## 1. Superadmin allocation backend (Agent E)

Constants: `SUPERADMIN_SOURCE = "superadmin_allocation"`, ledger code `superadmin_allocation`,
label "Superadmin allocation".

Endpoints (new router `app/api/v1/superadmin_allocation.py`, registered in `app/api/routes.py`, all `require_superadmin`):
- `GET /v1/superadmin-allocation/options?slot_id=...` returns
  `{slot: {id, duty_date, duty_type, duty_label, unit_id, unit_name, call_level, is_24hr, starts_at, ends_at,
  current: [{assignment_id, person_id, person_name}]},
  people: [{person_id, person_name, call_level, unit_id, unit_name, status: "available"|"blocked",
  blocked: [{code, label, detail}], overrides: [{code, label}], month_duties}]}`.
  - `people` covers every active person, sorted: available first, then by name. A person already on the slot is
    `available` with a note.
  - `blocked` codes: `on_leave`, `rest_after_24hr`, `overlapping_duty` (strict).
  - `overrides` codes (what this allocation bypasses): `call_level_mismatch`, `not_in_group`, `excluded_group`,
    `unit_rule`, `not_posted`, `monthly_24hr_limit`, `monthly_weekend_24hr_limit`, `monthly_same_group_limit`,
    `monthly_same_campus_limit`, `unit_safety_hard_block`, `unit_safety_review`, `fairness`.
  - The request must stay fast (< 2 s for 200 people). Preload leave, postings and the month's assignments once.
- `POST /v1/superadmin-allocation` takes `{slot_id, person_id, reason (required, 5–500 chars), replace_existing: bool = true}`.
  - Re-check strictly inside a transaction with the extra-duty month lock (`lock_namespace(db, f"extra-duty:{month}")`
    if available). On a strict block it returns 409 `{code: "strict_blocked", message, blocked: [...]}`.
  - Otherwise it replaces the slot's current active holders (cancel them, and void their ledger records via
    `extra_duty_hooks.void_extra_duty_records(..., "replaced")`) and creates a `DutyAssignment(source=SUPERADMIN_SOURCE,
    status="assigned", override_reason="Superadmin allocation: <reason>")`.
  - It creates an `ExtraDutyBatch(month, status="applied", summary={mode: "superadmin_allocation", filled: 1,
    ledger_records: 1, by, reason, post_publish: bool}, decisions=[one decision with display fields], before_image=[entry
    as the planner writes, including the cancelled holders so undo can restore them])` plus one `ExtraDutyRecord`
    (overridden_rules=["superadmin_allocation", *override codes], justice snapshot, reason).
  - It writes an audit log entry (use the existing audit helper used by rota_compute/recycle bin, if one exists).
  - Returns `{assignment_id, batch_id, slot_id, person_id, person_name, overrides, post_publish}`.
  - Works when the period is `published`. `post_publish=true` in that case. Never changes the period status.
  - 403 for non-superadmin. 404 for an unknown slot or person. 422 for a bad reason or an inactive person.
- Undo: existing `POST /v1/extra-duty/batches/{id}/undo` must work for these batches on draft months, restoring the
  replaced holders. If the planner's undo can't restore cancelled holders, add the restore in E's own endpoint
  `POST /v1/superadmin-allocation/{batch_id}/undo` instead. Document which.

Independent checker `app/services/extra_duty_verify.py`: an assignment with `source == "superadmin_allocation"` is
exempt from call level and groups, unit rule, posted-to-unit, and active-member checks. It is **not** exempt from leave,
rest, overlap or capacity. Report the exempt count as `superadmin_exempt`; the CLI prints it.

## 2. Publish anyway and report (Agent F)

- `publish_rota_month(..., superadmin_override: bool = False, override_reason: str | None = None, user)`. The publish
  endpoint accepts `superadmin_override` and `override_reason`. Override requires `user.role == "superadmin"` (403
  otherwise) and a reason of 5–500 characters.
  - With the override, blockers and warning confirmation are skipped. `RotaPublishApproval.summary` stores
    `{published_with_override: true, override_reason, override_by, open_slots, blockers: [titles+details],
    warnings_unconfirmed: n}`.
  - `approval_note` gets a plain sentence. Without the override, behaviour is unchanged.
- The checklist response gains `can_superadmin_override: bool`: true when there are blockers and the current user is
  superadmin. The endpoint passes the user to the checklist, or the frontend computes it from the role. Document which.
- Published exports and views must show open slots as **"Unfilled"**, never crash, and never hide them.
- `rota_review`: a slot whose active holder is a superadmin allocation shows issue `superadmin_allocation` as a
  **warning** ("Superadmin allocation by X: reason"), not `hard_blocked`. Summary `superadmin_allocations: int`. The
  publish checklist adds a warning "Superadmin allocations" listing them.
- 360° report:
  - New section `superadmin` "Superadmin actions": the allocations table (date, duty, unit, person, rules overridden,
    reason, by, when, post-publish flag) and a publish-override block (who, when, reason, open slots at publish).
  - The executive summary gets a key finding. The cover shows "Published with superadmin override" when it applies.
  - New xlsx sheet "Superadmin".
  - Ledger labels include `superadmin_allocation`.
- `app/services/extra_duty.py`:
  - `verify_month` gets the same exemptions as the checker (§1).
  - `superadmin_allocation` goes in `LEDGER_ONLY_CODES`/labels so justice counts it.
  - Campus ranking change (§4).

## 3. Frontend (Agent G)

- Only when the signed-in user's role is `superadmin` (see how the app reads the current user and role), show:
  - In the day view, review items and slot detail: a "Superadmin allocation" action on any slot, filled or open, draft
    or published.
    - It opens a polished dialog: duty summary; a searchable list of all department members with call level and
      unit; filters "Available / Blocked / All".
    - Blocked people are shown disabled, with the exact reason (leave, rest, double duty) in red.
    - Choosing an available person shows the rules this allocation overrides in amber. The reason is required.
    - "I understand this overrides the rota rules" checkbox, then **Allocate**. On a published month the dialog shows
      a banner "This changes a published rota".
    - Handle the 409 `strict_blocked` (show the reasons, refresh the list), 403 and others.
  - In Publish: when blockers exist and the user is superadmin, a "Publish anyway (superadmin)" button.
    - Its dialog lists the open slots count, every blocker and warning, a required reason and a confirmation checkbox,
      then publishes with the override.
    - After publishing, the page shows the "Published with superadmin override" state.
  - Labels: `superadmin_allocation` "Superadmin allocation" in the extra-duty code map.
  - Non-superadmins never see these controls. The backend also enforces this.
- Accessible (focus, aria, keyboard), 390 px with no horizontal scroll, light and dark, matching the extra-duty dialog styling.
- Browser tests with a mocked API: new `frontend/tests/superadmin.browser.mjs`. Keep existing suites passing.

## 4. Campus ranking ("not stopping at same campus") (Agent F, in extra_duty.py)

- A candidate is **tight** if placing them would exceed an individual limit (the `LIMIT_CODES`) **or** produce
  `unit_safety_hard_block` for their unit (the staffing limit).
- Both modes rank by `(tight, tier_index, justice key...)`. A non-tight member in any unit, on any campus, beats a tight
  member on the same campus. The same-campus preference only orders candidates that are equally tight.
- Standard mode: an explicit fallback list is the **first** preference, not the only one. After it come same-campus
  in-scope units, then other in-scope units. Inactive units and units refused by the duty's unit rules are never used.
- Update tests that asserted "explicit list only".

## 5. File ownership

- **E:** new `backend/app/services/superadmin_allocation.py`, new `backend/app/api/v1/superadmin_allocation.py`,
  `backend/app/api/routes.py` (one include line), `backend/app/services/extra_duty_verify.py`, `tools/extra_duty_verify.py`,
  new `backend/tests/test_superadmin_allocation.py`, `backend/tests/test_extra_duty_verify.py`.
- **F:** `backend/app/services/rota_publish.py`, `backend/app/api/v1/rota_publish.py`, `backend/app/services/rota_review.py`,
  `backend/app/services/rota_report_360.py`, `backend/app/services/extra_duty.py`, the publish and export services
  needed for "Unfilled", and their tests (`test_rota_publish.py`, `test_rota_review.py`, `test_rota_report_360.py`,
  `test_extra_duty*.py`).
- **G:** `frontend/src/**` as needed (prefer a new module `frontend/src/superadmin.ts`, with minimal hooks in
  `main.ts`), `frontend/src/styles.css` (append only), and `frontend/tests/**`.
- **Another tool (codex-sol) may be editing this repo concurrently.** Before editing any existing file, check
  `git diff -- <file>` and re-read the current content. Make small targeted edits, never rewrite whole files, and never
  revert changes you didn't make. If a file you need changes under you in a conflicting way, stop and report it.
