# Balance duties, option 2: rebalancing extra duties with ledger transfer

Status: binding. Date: 22 Oct 2026. Amends `docs/call_level_pool_and_balance_contract.md` §2.

## 0. Owner decision

Balance duties may also move duties placed by the **extra-duty layer** (both standard and all-units modes). The
justice-ledger record moves with the duty, so the person who actually works the extra duty gets the credit. This
lets the board run Balance again as the final step, so the published rota is equal too. Every hard rule stays
exactly as before.

## 1. Backend: `balance_duties.py` (Agent B2)

- **Movable sources.** The automatic sources plus `extra_duty_layer`, but only if the assignment has exactly one
  **active** `ExtraDutyRecord`; a void record or a duplicate makes it not movable. Still never movable:
  manual, `superadmin_allocation`, `exchange_approved`, `balance_duties` rows created by an earlier balance (these
  are movable again only through a new balance plan; keep the current rule), and confirmed rows.
  - Decision for this build: `balance_duties` rows **become movable** in later balance runs, so a second run can
    keep refining. Make sure undo of the later batch restores the earlier balance state exactly.
- **Checks for an extra duty move.** Exactly the same checks as any move: strict blockers, individual limits, and
  no new unit hard block.
  - Exception: the slot was originally filled by the extra-duty layer, often on a hard-blocked day. The "no new
    unit hard block" check must compare against the state **before the move**. A move must not make any
    (unit, day) worse than it is now, measured by the unavailable count. The rule is the same as today, applied
    honestly to slots that are already blocked.
- **Ledger transfer, inside the apply transaction.**
  - Update the record: `person_id` becomes the recipient; `assigned_unit_id` becomes the slot's unit after the move;
    `fallback_used` and `overridden_rules` are recomputed for the new holder.
  - `overridden_rules` = the override codes the new holder actually triggers. Use the same derivation the planner
    uses: `validate_assignment` against the plan state for the overridable codes, plus the tier code
    (`fallback_unit` / `any_unit` / `outside_scope_unit` / `unposted_member`) by the holder's relation to the
    slot's original home unit. If the new holder triggers no code, keep the code `rebalanced_extra_duty`
    ("Extra duty passed on by Balance duties") so the record still means "this person worked an extra duty".
  - `justice` gets a new snapshot for the recipient at transfer time. Keep the old snapshot inside
    `justice["transfers"]`, a list of
    `{from_person_id, from_person_name, to_person_id, to_person_name, balance_batch_id, at, old_overridden_rules}`.
  - The assignment's `override_reason` becomes "Extra-duty layer: <codes> · balanced from X".
- **Batch.** The balance batch's `before_image` for these rows also stores the full previous record state
  (person_id, assigned_unit_id, fallback_used, overridden_rules, justice). Undo restores the record exactly, pops
  its transfer entry, and restores the assignment. An undo conflict occurs if the record was voided, transferred
  again or changed since.
- **Original extra-duty batch.** Undoing the original extra-duty batch after a balance moved one of its duties must
  return 409 `undo_conflict` with the code `assignment_changed` (existing behaviour). Its message must say: "Undo
  Balance duties first". Add that message in `extra_duty.undo`, with a small targeted edit.
- **Preview response.** Moves gain `extra_duty: bool`, `ledger_from`, `ledger_to` and
  `new_overridden_rules: [codes]`. Summary gains `extra_moves`. Members gain `extra_before` and `extra_after`.
- **Ranking inside balance.** Unchanged (deviation from the pro-rata share). When choosing which donor duty to
  move, prefer extra-duty rows first. They are the ones that broke equality, and moving them also spreads the
  ledger fairly.
- **Justice ledger ranking.** It is unchanged: `ledger_balance` counts active records by `person_id`, so
  transfers count for the new holder automatically. Add a test.
- **Independent checker.** No exemption changes. The `unposted_member` exemption follows the record's codes: if the
  new holder is posted, the code is dropped and the posting check applies.
- **Tests (in `tests/test_balance_duties.py`):**
  - an extra duty moves and the ledger record follows (person, unit, codes, transfers entry)
  - `ledger_balance` before and after
  - undo restores the record exactly
  - undo conflict when the record was voided or transferred again
  - the original extra-duty batch undo is refused with "Undo Balance duties first"
  - an `unposted_member` code is dropped when moving to a posted member
  - the "no worse than now" staffing rule on already hard-blocked days
  - a second balance run moves `balance_duties` rows and undo order works
  - simulation: autofill → balance → extra-duty (standard and all-units) → balance again; every level with enough
    members ends within the allowed gap, and the independent checker passes
- **Files:** `backend/app/services/balance_duties.py`, `backend/tests/test_balance_duties.py`, and a targeted
  message edit in `backend/app/services/extra_duty.py` (`undo` conflict message only).

## 2. Ledger views and report (Agent R)

- `extra_duty.person_ledger` and `month_ledger` rows gain `transfers` (from `justice.transfers`, in display form:
  "Passed on from Asha by Balance duties on 22 Oct") and `rebalanced: bool`. Targeted edits in those two
  functions only.
- 360° report:
  - The extra-duties ledger section shows a "Passed on from" column.
  - The Balancing subsection lists extra-duty moves with the ledger transfer.
  - The executive summary gets a finding: "N extra duties were passed on by Balance duties to even out totals".
  - The xlsx gets the same in the ledger and Fairness sheets.
  - Label `rebalanced_extra_duty` → "Extra duty passed on by Balance duties" in `OVERRIDE_LABELS` and in
    `extra_duty` `LEDGER_CODE_LABELS` / `LEDGER_ONLY_CODES`. Add the code to `LEDGER_ONLY_CODES` so it ledgers.
- Tests in `tests/test_rota_report_360.py`, plus a small ledger-view test in `tests/test_extra_duty.py`.
- **Files:** `backend/app/services/rota_report_360.py`, `backend/app/services/extra_duty.py` (only
  `person_ledger` / `month_ledger` and the label/code constants), and those tests.

## 3. Frontend (Agent F2)

- **Balance dialog** (`frontend/src/balance-duties.ts`):
  - Extra-duty moves get an "Extra duty" badge and the line "Ledger credit moves to Y". The summary gets a chip
    "N extra duties passed on".
  - The member table shows extra duties before → after.
  - The "What this does" box adds one sentence: "Extra duties can be passed on too; the justice-ledger credit
    moves with the duty."
- **Rota Template stage:** after the extra-duty steps have run, the Balance status line says "Run Balance duties
  again to even out the extra duties" when uneven.
- **Ledger displays** (member profile extra-duty section and the extra-duty window's ledger lists, wherever ledger
  rows are shown): a "Passed on from X" note when `transfers` is non-empty.
- **Labels:** `rebalanced_extra_duty` → "Extra duty passed on by Balance duties".
- **Tests:** extend `frontend/tests/balance.browser.mjs` and `extra-duty.browser.mjs`. Keep all suites green.
- **Files:** `balance-duties.ts`, `extra-duty.ts` (labels and ledger rows), `member-workspace.ts` or wherever the
  member's ledger is rendered (small targeted edit), `main.ts` (stage status text only, if needed),
  `services/api.ts` (types), `styles.css` (append `balance-`), and tests.

## 4. Coordination

- Another tool (**codex**) is building concurrently in this repo and can't be messaged. Its files must not be
  disturbed.
  - Before every edit, run `git diff -- <file>` and re-read the file. Edit with small exact-match replacements;
    never rewrite or reformat a file, and never change line endings.
  - Never revert or "fix" lines you didn't write. If a file you need changes under you in a conflicting way, stop
    and report it.
  - Don't run formatters or `npm install`. Don't touch unrelated files.
- No commits. Don't touch the `duty_rota` or `duty_rota_test` databases. No alembic: everything fits in the
  existing JSON columns.
