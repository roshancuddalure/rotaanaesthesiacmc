# Call-level pools and "Balance duties": contract

Status: binding. Date: 22 Oct 2026. Amends `docs/limits_callevel_fairness_contract.md` §1 and §2. Where they
disagree, this document wins.

## 0. Owner decisions

1. If Rota Rules explicitly lists **several call levels** for a duty (for example Main/RC/PB Shift with 3rd and 4th
   call), that is a deliberate **pool**. Any member of those levels may take it, and that is not a crossover.
   - The strict rule is unchanged: a member must have a level inside the duty's defined level set.
   - A duty with **no** level at all is the only *unresolved* case.
2. **Balance duties:** after autofill, a step that makes duty totals equal within each call level, within the allowed
   gap. The only exceptions are the hard rules (leave, rest, overlap, groups, unit rules, hard limits) and partial
   availability: members posted or available for only part of the month get a pro-rata share. Duties may move
   between units for this. Preview first, then Apply and Undo.

## 1. Pools (Agent P)

- `rota_eligibility.required_call_levels(slot, rule, groups) -> set[str]`, the single source of truth:
  - slot stamped with a level → `{that level}`
  - otherwise the rule's effective levels (explicit `allowed_call_levels` ∪ group levels) if non-empty
  - otherwise the empty set (unresolved)
- `required_call_level` stays, returning the single level or `None`, for display only.
- `eligibility()` refuses `call_level_mismatch` if the member's level is not in the set, and `call_level_unresolved`
  if the set is empty.
- Rules check:
  - Remove the `call_level_not_single` warning for multi-level duties.
  - Add `call_level_missing` (warning on save) for active duties with no level.
  - Add `call_level_pool` (info, not counted as a warning) "{label}: open to 3rd call and 4th call (pool)" so the
    owner sees which duties are pools.
- Template, auto-fill, compute and both extra-duty modes: pool duties are filled normally. Only unresolved duties
  are skipped.
- Review (`call_level_changed`), the independent checker, and superadmin `cross_level`: all use "the member's level
  is not in the set".
- `fairness_targets`: a pool slot's demand is split across the pool's levels in proportion to each level's member
  count. Document it. Targets stay per level.
- Template slot stamping: if a duty has exactly one level, keep stamping it. Pool slots stay unstamped
  (`call_level` NULL), and their pool is read from the rule.
- Tests: pool duties are fillable by both levels and refuse other levels; unresolved duties are still skipped;
  update the existing strict tests and the randomised test to include pools.
- Files: `rota_eligibility.py`, `rota_rules_admin.py`, `rota_auto_fill.py`, `rota_template.py`, `rota_compute.py`,
  `extra_duty.py` (eligibility codes only), `extra_duty_verify.py`, `rota_review.py`, `superadmin_allocation.py`,
  `fairness_targets.py` (pool split), and tests. Frontend label change: the "Choose one call level" tag becomes a
  "Pool: 3rd + 4th call" info tag plus a "No call level" problem tag (owned by Agent F).

## 2. Balance duties backend (Agent B)

New module `app/services/balance_duties.py` and API `app/api/v1/balance_duties.py` (`require_admin`; same roles as
the extra-duty layer).

**Shares (per call level L, draft month).**
- `share_i = slots(L) × avail_i / Σ avail`, where `avail_i` = days in the month the member is posted (or
  unposted-eligible), active and not on leave.
- Pool slots count towards their levels as in `fairness_targets`.
- A member's goal is `round(share_i)`. Balanced means every member is within `allowed_gap`
  (`fairness_rules.max_gap_within_call_level`) of their goal.
- Expose `shares(db, month)` for publish and report. Agent P's `fairness_targets` may switch its `target` to this
  pro-rata share. Coordinate by importing it; don't duplicate it.

**Moves.**
- Repeatedly take the member most above goal (the donor) and try to give one of their **movable** duties to the
  member most below goal (the recipient):
  - same call level or the duty's pool, and in the duty's allowed groups (not in excluded ones)
  - passes `extra_duty.strict_blockers` for the slot as it would be placed: leave, rest both ways, overlap, unit
    rule, active
  - does not take the recipient past any individual limit (`duty_count_limits`)
  - does not make the recipient's unit `unit_safety_hard_block` that day
  - does not make the donor's unit worse than before
- If the recipient is in another unit, the slot moves to the recipient's unit (as fallback does), with a
  before-image.
- If no direct move works, try a **swap**: donor duty X ↔ recipient duty Y on different days, if both stay valid.
  Swaps don't change totals but can unlock a later move. Limit search depth so a preview takes under 10 s on
  ~700 slots.
- Stop when everyone is within the gap or no improving move exists.
- Deterministic: same input gives the same plan.

**Movable** = an active assignment whose source is an automatic generation source (`safe_auto_fill_draft`,
rota_compute/optimiser sources, template auto sources; list them). Never: manual, `superadmin_allocation`,
`extra_duty_layer`, `balance` itself, or confirmed/locked rows.

**API.**
- `GET /v1/balance-duties/status?month` returns `{month, enabled, balanced: bool, levels: [...spread...], batches: [...]}`.
- `POST /v1/balance-duties/preview {month}` returns
  `{month, plan_hash, context_hash, token, summary: {moves, swaps, cross_unit, levels_balanced_before,
  levels_balanced_after}, levels: [{call_level, label, goal_range, before: {min, max, gap}, after: {min, max, gap},
  ok_after, reason_if_not}], moves: [{kind: "move"|"swap", slot_id, duty_date, duty_label, from_person, from_unit,
  to_person, to_unit, cross_unit, reason}], members: [{person_id, name, call_level, unit, before, after, goal,
  avail_days}]}`
- `POST /v1/balance-duties/apply {month, token, plan_hash}`:
  - 409 `stale_preview` if anything changed; the same lock order as extra-duty (`balance:<month>`, then
    `extra-duty:<month>`, then `rota-compute:<month>`).
  - Re-validates every move. Runs the independent checker (`extra_duty_verify.check_month`) on the touched
    assignments and rolls back on any violation (500 `verification_failed`).
  - Records an `ExtraDutyBatch` with `summary.mode="balance"`, `before_image` (old person, old unit and assignment
    ids), and decisions. **No justice-ledger records**: balancing is not extra duty.
  - Moved assignments keep source `balance_duties`, with override_reason "Balanced: from X to Y".
  - Returns the preview shape plus `batch_id`.
- `POST /v1/balance-duties/batches/{id}/undo {dry_run?}`: exact restore; 409 `undo_conflict` with the changed slots.
  The extra-duty planner's undo must refuse `mode == "balance"` batches. Add that small guard in `extra_duty.py`.
- Errors as in extra-duty: `not_draft`, `scope_unlocked`, `nothing_to_balance` (already balanced, or no movable
  duties), `proposal_active`, `disabled` (env `BALANCE_DUTIES_ENABLED`, default true).

**Report and publish.**
- 360° report: a "Balancing" subsection in Fairness showing batches and moves (with cross-unit flags), and the
  before/after gap per level.
- Publish: the uneven-duties warning text adds "Run Balance duties on Rota Template" when movable duties exist.
- The independent checker accepts `balance_duties` like other normal sources: strict, no exemptions.

**Tests.** Shares with leave or partial posting; moves respect every hard rule (one test per rule); cross-unit move
updates the slot unit; swap; determinism; stale; undo exact and with a conflict; the planner refuses balance
batches; a simulation (6 units, uneven per-unit ratios) where gaps before > 1 and after ≤ 1 for every level with
enough members.

**Files:** new `balance_duties.py`, `api/v1/balance_duties.py`, `api/routes.py` (include line),
`tools/permissions_manifest.py` (only if a new gate name is used; prefer `require_admin`), `extra_duty.py` (undo
guard only), `rota_publish.py` (warning text only), `rota_report_360.py` (balancing subsection), and tests.

## 3. Frontend (Agent F)

- **Rota Template stage:** a "Balance duties" button after "Autoassign members", before the extra-duty buttons.
  It shows a small status line: "Duties are balanced" or "1st call: 5–9 duties (target 6–7)".
- **Balance dialog**, in the premium style matching the extra-duty and fill-all dialogs:
  - Header and a "What this does" note: equal duties within each call level; never breaks leave, rest, call level,
    groups, unit rules or limits; members on leave or with partial postings get a fair smaller share.
  - Before → after per level, in cards or a table: min–max, gap, goal range, ok badge.
  - A moves list grouped by level, showing "Date · Duty: X → Y", a cross-unit badge, swaps marked and reasons. A
    member table, collapsible, showing before, after and goal.
  - Review tick → Apply. A result state with Undo and audit report links. Handle stale, proposal_active,
    nothing_to_balance ("Already balanced"), verification_failed and undo_conflict.
- **Extra-duty window:** batches with mode `balance` are labelled "Balance duties" and use the balance undo.
- **Rota Rules:**
  - "Pool: 3rd + 4th call" info tag on pool duties.
  - "No call level" problem tag for `call_level_missing`.
  - Remove the "Choose one call level" tag.
- **Tests:** new `frontend/tests/balance.browser.mjs` (flow, errors, a11y light/dark, 390 px); update
  `rota-rules.browser.mjs` for the pool and missing tags. Keep all suites passing.
- **Files:** new `frontend/src/balance-duties.ts`, `main.ts` (stage hook only), `extra-duty.ts` (batch label and
  undo routing), `rota-rules.ts` (tags), `services/api.ts` (types), `styles.css` (append, `balance-` classes), tests.

## 4. Rules for all agents

Same as before:
- codex-sol may edit concurrently: run `git diff` and re-read before each edit, make small edits, never revert
  others' lines, and stop and report on conflicts.
- No commits. Don't touch the `duty_rota` or `duty_rota_test` databases. No alembic.
