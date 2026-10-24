# Strict call level, campus-last fairness, and the superadmin Limits page: contract

Status: binding for the implementing agents. Date: 22 Oct 2026. Builds on `docs/extra_duty_contract.md`,
`docs/extra_duty_fill_all_contract.md` and `docs/superadmin_override_contract.md`. Where this document
disagrees with them, this one wins.

## 0. Owner decisions

1. **Call level is never crossed by any automatic or normal path.** A 2nd-call duty never goes to a 3rd-call member, a
   3rd-call duty never to a 4th-call member, and so on in both directions. The only exception is **superadmin
   allocation**: it may cross, but only after a strict warning and an explicit confirmation.
2. **Campus is considered only once hard limits are reached.** Until then, all members of a call level in all
   units are equal as far as campus goes. Within each call level every member's monthly duty total (all campuses
   together) should be almost equal. The default target is that call level's duty slots in the month ÷ its
   members. The extra-duty layer may break equality and is reported when it does.
3. **Limits** move to a separate premium page, **"Limits"**, for **superadmin only**. It has one Save at the
   bottom with a confirmation, and plain-language hints. Rota Rules shows the limits read-only.

## 1. Strict call level (Agent 1)

- **Single source of truth.** `required_call_level(slot, rule, groups) -> str | None` in `rota_eligibility.py`.
  - It returns the slot's own level if set; otherwise the rule's effective level only if there is **exactly one**.
  - Zero levels, or more than one (including levels added by eligibility groups), returns `None` and the duty is
    *unresolved*.
  - `eligibility()` must refuse with `call_level_mismatch` whenever the member's level differs from the required
    level, and with a new code `call_level_unresolved` ("This duty has no single call level; set one in Rota Rules")
    when the duty is unresolved.
- **Rules check.** New error problem `call_level_not_single` for each active duty whose effective levels are not
  exactly one: "{label}: choose exactly one call level (now: 3rd call, 4th call)". The fix is to set one level or
  remove the groups of other levels.
  - It is reported by `/rota-rules/check` like other problems.
  - It is a **warning** on save, so existing rules still save. It is an **error** for template generation and
    autofill of that duty: such slots stay open, with the reason above.
  - Put it in `rota_rules_admin.rule_problems`.
- **Every assignment path must enforce it.** Audit and add tests:
  - manual `assign_person_to_slot` (already blocks; keep it)
  - auto-fill
  - rota_compute / optimiser / template_compute save paths (any GPU or CPU proposal must be re-validated on save)
  - exchange approval
  - both extra-duty modes
  - recycle-bin restore of an assignment (if a restore can create a mismatch, refuse)

  Historical or imported past-duty records are exempt (they are records, not allocations). Document every path you
  checked, in the test file's docstring.
- **Review and publish.** An active assignment in the month whose member's current call level differs from the slot's
  required level, and whose source is not `superadmin_allocation`, becomes the review error issue
  `call_level_changed` ("Call level no longer matches: X is now 4th call"). It typically appears after a promotion.
  The review summary gains `call_level_mismatch_items: int`. (Agent 2 turns that into a publish blocker.)
- **Superadmin allocation, cross-level** (changes `superadmin_allocation.py`):
  - In options, a person whose level differs gets `status: "cross_level"`. This is a third status, after available
    and before blocked, and carries `warning: "Different call level: needs 3rd call, X is 4th call"`.
  - Leave, rest and overlap still make a person `blocked`. That takes priority.
  - `POST` requires `confirm_cross_level: true` for such a person, otherwise 409 `cross_level_confirmation_required`.
  - The ledger record and batch use the extra code `superadmin_cross_level`, label "Call level crossed by superadmin".
  - The review issue for such a slot is a **warning** with severity text "Call level crossed by superadmin", and
    it is listed separately.
- **Independent checker** (`extra_duty_verify.py`):
  - The superadmin exemption for call level stays.
  - Cross-level superadmin allocations are counted and listed as `superadmin_cross_level` (not hidden).
  - Every other source must match the level exactly.
- **Tests.**
  - Per path tests.
  - A randomised test: random people of random levels pushed through every path; assert zero crossings except
    confirmed superadmin ones.
  - Rules-check tests.
  - The superadmin options, POST and 409.
  - The review issue.
- **Files:** `rota_eligibility.py`, `rota_assignment.py`, `rota_auto_fill.py` (only the validation part),
  `rota_compute.py` / `template_compute.py` / `rota_optimizer.py` (only the validation-on-save part, coordinate via
  small edits), `rota_review.py` (exchange + review issue), `superadmin_allocation.py`, `rota_rules_admin.py`,
  `extra_duty_verify.py`, `tools/extra_duty_verify.py`, `rota_template.py` (skip unresolved duties' auto-fill only),
  new `backend/tests/test_call_level_strict.py`, and existing tests touched by the change.

## 2. Campus-last fairness and equal duties (Agent 2)

- **New module `app/services/fairness_targets.py`.**
  - `call_level_targets(db, month, rules=None) -> list[{call_level, label, slots, members, target, min_expected,
    max_expected}]`
    - `slots` = non-excluded template slots needing that level (via `required_call_level`).
    - `members` = active members of that level available in the month: posted in the month, or used by the
      unposted tier, if any. If unsure, count active members of that level with a posting overlapping the month.
      Document it.
    - `target = slots / members` (2 decimals), `min_expected = floor(target)`, `max_expected = ceil(target)`.
  - `call_level_spread(db, month, rules=None) -> list[{call_level, target, min, max, gap, allowed_gap, ok,
    members: [{person_id, name, duties, extra_duties, diff_from_target}]}]`
    - `gap` = max − min of duty totals, all campuses together.
    - `allowed_gap` comes from Limits (`fairness_rules.max_gap_within_call_level`, default 1).
    - Duties placed by the extra-duty layer and superadmin allocations are reported separately (`extra_duties`). They
      may cause `ok=false`, and the reason says so.
- **Ranking**, in normal generation (`rota_candidates` scoring, `rota_auto_fill`, `rota_optimizer` objective,
  `template_compute` / `rota_compute` proposal scoring as applicable) and in both extra-duty modes (`extra_duty.py`):
  1. not tight (no hard limit hit: individual limits, unit staffing hard block)
  2. justice ledger count (**extra-duty layer only**)
  3. distance below the call-level target: furthest below target first, then fewest month duties (all campuses)
  4. home unit (extra-duty layer only, as a tie-break; no longer a strict tier before other units)
  5. **campus preference only when the candidate is tight**
  6. stable id
  - Remove the campus term (`same_campus * 2`) from normal scoring for non-tight candidates.
  - The `max_same_campus_per_month` individual limit stays a hard limit as configured.
  - The extra-duty `tier` field stays for reporting, but no longer outranks equality.
- **Publish and report:**
  - `rota_publish` checklist: a **blocker** "Call level mismatches" when the review summary
    `call_level_mismatch_items > 0` (Agent 1 provides the count).
  - A **warning** "Duty totals uneven within a call level", listing each level where `gap > allowed_gap` with min/max
    and target, plus the full `call_level_spread` in the response.
  - 360° report: the fairness section shows target, min, max and gap per level, and a list of members off target;
    the executive summary has a finding for it.
- **Simulation test:** build a realistic month (6 units, 5 levels, ~150 members, leave, 24h rest) and run autofill.
  Assert that the gap within each call level is ≤ allowed_gap wherever there are enough members, except where leave
  or rest make it impossible; any such exception is explained in the spread output.
- **Files:** new `fairness_targets.py`, `rota_candidates.py`, `rota_auto_fill.py` (ranking part), `rota_optimizer.py`
  (objective), `template_compute.py` / `rota_compute.py` (scoring only), `extra_duty.py`, `rota_publish.py`,
  `rota_report_360.py`, and tests (`test_fairness_targets.py` new, `test_extra_duty*.py`, `test_rota_publish.py`,
  `test_rota_report_360.py`, existing candidate/autofill tests).
  - Agent 1 also edits the validation parts of auto-fill / compute / optimiser. Keep edits small, re-read the file
    right before each edit, and never revert the other agent's lines.

## 3. Limits backend (Agent 3)

- **New settings in `RotaPhaseOneRules`** (defaults keep old behaviour):
  - `fairness_rules: {max_gap_within_call_level: int = 1 (0–10), target_mode: "auto" = "auto"}`
  - `extra_duty_rules: {justice_lookback_months: int = 12 (1–36)}`

  Agent 2's `extra_duty.ledger_balance` must read `justice_lookback_months` when `months` is not given. Agent 2 does
  this; Agent 3 only adds the model fields.
- The **limit sections** are `duty_count_limits`, `rest_rules`, `unit_staffing_rules`, `fairness_rules` and
  `extra_duty_rules`. They stay inside the rules JSON (versioned as now) but can only be changed through the
  Limits API.
  - The Rota Rules PUT and restore must keep the stored values of these sections, ignoring incoming ones, unless
    the caller is superadmin *and* uses the Limits API.
  - If a rules PUT payload carries different values for them, respond 403 `limits_superadmin_only` with a pointer to
    the Limits page. The frontend will stop sending them.
- **API** (`app/api/v1/limits.py`, all `require_superadmin`; GET may also be `require_admin` read-only, see below):
  - `GET /v1/admin/limits?month=YYYY-MM` returns:
    - `{version_id, saved_at, saved_by, limits: {<the five sections>}, defaults: {...}`
    - `fields: [{path, section, label, help, example, kind: "int"|"bool"|"percent"|"hours"|"choice",
      min, max, unit, blank_means, hard_or_soft: "hard"|"soft"|"guide"}]` (server-side plain-language help so
      the page and the docs agree)
    - `targets: call_level_targets(month)` (Agent 2's function; until it exists, return `[]` guarded)
    - `can_edit: bool` (true only for superadmin)
  - Computer admin and rota board may GET read-only (`can_edit=false`).
  - `POST /v1/admin/limits/preview {limits, month}` returns:
    - `{changes: [{path, label, before, after, sentence}]` (plain sentence, e.g. "Max 24-hour duties per member per
      month: no limit → 6")
    - `problems: [{path, severity, message}]`
    - `impact: {over_limit_people: n, members_over: [...first 10 names...]}` for the month using the current
      assignments and `individual_limit_breaches` with the new limits.
  - `PUT /v1/admin/limits {limits, base_version_id, note}`:
    - 409 `stale_limits` if the current version differs from base.
    - 422 `invalid_limits` with problems, for example: warning % must be below hard-block %; percent 0–100; hours
      0–168; minimum available ≥ 0; gap 0–10; look-back 1–36.
    - Saves a new rules version (reuse the rules versioning) labelled "Limits changed", and an audit entry.
    - Returns the GET shape.
  - `GET /v1/admin/limits/history` lists `[{version_id, saved_at, saved_by, note, changes: [...]}]`, limited to
    versions whose limits changed.
  - `POST /v1/admin/limits/restore {version_id, note}` restores only the limit sections from that version, as a new
    version.
- **Tests:** permissions (superadmin edit; admin and board read-only; others 403), validation, stale 409, rules PUT
  can't change limits, history and restore, the preview sentences and impact.
- **Files:** `rota_rules.py` (model fields only), new `app/services/limits.py`, new `app/api/v1/limits.py`,
  `app/api/routes.py` (include line), the rota-rules API/admin save path (the limits guard only), and new
  `backend/tests/test_limits.py`.

## 4. Frontend (Agent 4)

- **Limits page.** New nav item **"Limits"** under Admin Tools, visible only to superadmin. New module
  `frontend/src/limits.ts`.
  - **Layout:** a premium, calm, well-organised page.
    - Intro: what limits are, hard vs soft, and who can change them.
    - Grouped cards: "Per member each month" (individual limits), "Rest after a 24-hour duty", "Unit staffing",
      "Equal duties within a call level" (gap + computed targets table per call level for the chosen month), and
      "Extra duties (justice)".
  - **Each setting shows:**
    - a label and a plain explanation (from the API `fields`)
    - a worked example
    - a hard / can-be-exceeded badge
    - "blank = no limit" where it applies
    - its unit
    - the current saved value, with a changed indicator
    - inline validation
  - **Saving:**
    - One sticky Save bar at the bottom: unsaved count, Reset and **Save limits…**.
    - Save opens a confirmation dialog listing each change as plain sentences, plus the preview problems and impact
      ("With these limits, 6 members in Jun 2026 would be over a limit"), an optional note, a required "I understand
      this changes how every rota is generated" checkbox, then **Confirm and save**.
    - Handle 409 stale (offer reload while keeping my changes visible), 422 and 403.
  - **History drawer:** versions with who, when, note and changes, and "Restore this version" (with confirm).
  - **Guards:** an unsaved-changes guard on navigation and unload, consistent with Rota Rules.
  - **Quality:** accessible, keyboard-friendly, 390 px with no horizontal scroll, light and dark, premium styling
    consistent with the extra-duty and superadmin dialogs.
- **Rota Rules:**
  - The limits area becomes read-only, showing a summary with "Edit in Limits" (superadmin) or "Only a superadmin
    can change limits" (others).
  - Stop sending the limit sections on save; the server keeps stored values.
  - Show the new `call_level_not_single` problem like other duty problems, including on the duty head.
- **Superadmin allocation dialog:**
  - The new `cross_level` status gets its own filter chip, "Different call level", with a strong red-amber warning
    on the row.
  - Choosing such a person shows a prominent strict warning panel: "This crosses call level. Needs 3rd call; X is
    4th call. This is recorded and shown in Publish and the audit report."
  - It needs a separate confirmation checkbox, then sends `confirm_cross_level: true`. Handle 409
    `cross_level_confirmation_required`.
- **Publish screen:**
  - Show the "Call level mismatches" blocker.
  - Show the "Duty totals uneven within a call level" warning, with a compact spread table per level (target,
    min, max, gap, members off target, collapsible).
- **Tests:** new `frontend/tests/limits.browser.mjs` (gating, grouping, validation, the save/confirm/stale/422 flow,
  history and restore, unsaved guard, axe light and dark, 390 px). Extend `superadmin.browser.mjs`,
  `rota-rules.browser.mjs` and the publish checks. All existing suites keep passing.
- **Files:** new `limits.ts`, `rota-rules.ts`, `superadmin.ts`, `main.ts` (nav + publish hooks only, small edits),
  `services/api.ts` (types), `styles.css` (append, scoped `limits-` classes), and tests.

## 5. Working rules for all agents

- **Another tool (codex-sol) may edit this repo concurrently**, and so may the other agents on shared files.
  - Before each edit to an existing file, run `git diff -- <file>` and re-read the current content.
  - Make small targeted edits; never rewrite whole files; never revert lines you didn't write.
  - On a conflicting change, stop and report.
- **Don't commit.** Don't touch the PostgreSQL databases `duty_rota` or `duty_rota_test` (the integrator uses
  `duty_rota_test`). No alembic: none of this needs a migration, since everything lives in the rules JSON.
- Tests use the existing SQLite test patterns.
