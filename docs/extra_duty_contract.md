# Extra-duty layer and 360° audit report (contract)

Written for: the developers (and agents) building the extra-duty layer, its API, its report, its UI and its independent checker in parallel. Build against this file; if something here is wrong, say so instead of improvising.

Owner decisions (21 Oct 2026):
- **Q1 Justice.** Whoever did an extra duty goes *down* the list for the next extra duty. The ledger affects **only** extra-duty choices; it never changes normal generation, normal fairness or candidate scores.
- **Q2 Leave.** Every active leave status (`approved`, `requested`, `imported_pending_review`) is a strict block.
- **Q3 Fallback unit.** When a fallback unit is used, the slot moves to that unit (`duty_slots.unit_id` changes); the original template unit is kept in the ledger record and the batch before-image.
- **Q4 Call level and eligibility groups** are strict. No change to call levels or groups, ever.

## 1. What the layer does

A separate stage after Build template → Autoassign members: **Extra-duty layer** → Review → Publish. It only fills **open** slots (no active assignment) of the month's **draft** period. It never changes or removes an existing assignment.

### 1.1 Strict rules (never broken; one function, `strict_blockers`)

For a person P and slot S, P is strictly feasible only if **all** hold:

| Code | Rule |
|---|---|
| `inactive_member` | P is active. |
| `not_in_unit` | P has a posting to the candidate unit covering S.duty_date (`member_contexts_for_day`). |
| `call_level_mismatch` / `call_subgroup_mismatch` | `rota_eligibility.eligibility(context, slot, rule, groups).eligible` is true — the existing single eligibility function, unchanged. |
| `leave` | No leave of P with status in `ACTIVE_LEAVE_STATUSES` (`approved`, `requested`, `imported_pending_review`) that `slot_leave_blocks(leave, S)` on S.duty_date. |
| `same_day_duty` | P has no other active assignment on S.duty_date where either duty blocks the same day (`duty_blocks_same_day`), and no time overlap with any active assignment (`duty_overlap`). |
| `post_24hr_rest` | P has no active assignment on S.duty_date − 1 that blocks the next day (`previous_day_24hr_blocks`). |
| `pre_24hr_rest` | If S blocks the next day, P has no active assignment on S.duty_date + 1. (Forward check — fixes handbook B2 for this layer.) |
| `rest_gap` | For every active assignment A of P (any month, including previous/next month): if A is 24-hour and ends before S starts, the gap ≥ `rest_rules.minimum_gap_after_24hr_hours`; if S is 24-hour and ends before A starts, the same gap holds. |
| `slot_full` | S has fewer active assignments than `max_assignees`. |

"Active assignment" = status in `ACTIVE_ASSIGNMENT_STATUSES` (`assigned`, `draft`, `confirmed`), including assignments proposed earlier in the same plan.

### 1.2 Rules the layer may break (recorded in the ledger)

`unit_safety_hard_block`, `unit_safety_review`, `monthly_24hr_limit`, `monthly_weekend_24hr_limit`, `monthly_same_group_limit`, `monthly_same_campus_limit`, and fairness (equal duties). These are the codes `validate_assignment` already emits, except the strict codes above. A candidate's `overridden_rules` = the codes from `validate_assignment(...)` issues that are in this list.

If the chosen person breaks **no** rule (`overridden_rules == []`), the assignment is made with `ledger = false` and no ledger record is written. Everything else gets a ledger record.

### 1.3 Algorithm (`plan_extra_duties`)

Deterministic: the same database state gives the same plan and the same `plan_hash`.

1. Load the month (draft period, locked scope), rules, postings, leave, and active assignments from the month ± 1 day of the neighbouring months.
2. `open = [slots with no active assignment and template_status != "excluded"]`.
3. Loop until `open` is empty. Each round, for every open slot compute `home = feasible people in slot.unit_id` and `fallback = first fallback unit with ≥ 1 feasible person` (see 1.4). Choose the slot with the **fewest** `len(home)` (falling back to the fallback count; a slot with zero everywhere is removed as `unfilled`). Ties go by `(duty_date, starts_at, duty_type, slot_label)`.
4. Within that slot's chosen unit, rank people by this **justice key** (lower first):
   1. `ledger_count` — the person's active ledger records with `duty_date` in the 12 months before the slot's month start, **plus** records already placed in this plan;
   2. `last_extra_date` — the date of their most recent such record; *never* sorts before any date (people who never did one come first), older dates before newer;
   3. `month_duties` — active assignments this month (including plan);
   4. `month_24hr` — the same, for 24-hour duties;
   5. `-rest_hours` — longer rest since their previous duty first (no previous duty = infinite);
   6. `canonical_name`, then `person_id` (stable tie-break).
5. Place the provisional assignment (it affects later slots' strict checks and counts) and record the decision.
6. The output for each slot is a decision `{slot_id, action: "assign"|"assign_fallback"|"unfilled", person_id, person_name, home_unit_id, assigned_unit_id, overridden_rules, ledger, justice: {ledger_count, last_extra_date, month_duties, month_24hr, rest_hours}, reason, alternatives: [first 3 ranked people with their justice keys]}`. For `unfilled`, `reason` lists why per unit (e.g. "UNIT I: 3 on leave, 2 resting after 24h; UNIT II: …").

### 1.4 Fallback unit order

The candidate units for a slot, in order:
1. The slot's own template unit (`home`).
2. If an admin set an explicit fallback list for the home unit (`unit_fallbacks`, ordered), those units in order.
3. Otherwise, the scope's other **included** units: same `campus` as the home unit first, then the fewest slots of the same duty already owned this month, then the fewest fallback receipts this month in the plan, then unit name.

A unit is used only if it has ≥ 1 strictly feasible person. The `rota_rules` duty `allowed_units` / `excluded_units` are respected (an excluded unit is never a fallback).

## 2. Storage (migration `20261022_0029_extra_duty_layer`, down_revision `20261021_0028`)

```
extra_duty_batches
  id uuid pk, rota_period_id fk rota_periods, month varchar(7) index,
  status varchar(20)  -- "applied" | "undone"
  plan_hash varchar(64), context_hash varchar(64), rules_revision varchar(64) null,
  summary json        -- {filled, fallback, ledger_records, unfilled, slots_considered}
  decisions json      -- the full decision list (1.3.6), for audit and reports
  before_image json   -- [{slot_id, unit_id_before, assignment_ids_before: []}]
  created_by_id uuid null, created_by_name varchar(255) null,
  created_at datetime, undone_at datetime null, undone_by_name varchar(255) null

extra_duty_records            -- the justice ledger; rows are never deleted
  id uuid pk, batch_id fk extra_duty_batches index,
  person_id fk persons index, assignment_id uuid index (no FK: survives assignment deletion),
  slot_id uuid index, month varchar(7) index, duty_date date index, duty_type varchar(100),
  home_unit_id uuid null, assigned_unit_id uuid null, fallback_used bool,
  overridden_rules json, justice json, reason text,
  status varchar(20) index    -- "active" | "void"
  void_reason varchar(255) null, voided_at datetime null, created_at datetime

unit_fallbacks
  id uuid pk, unit_id fk units index, fallback_unit_id fk units, position int,
  unique(unit_id, fallback_unit_id)
```

Models: `app/models/extra_duty.py` (`ExtraDutyBatch`, `ExtraDutyRecord`, `UnitFallback`), exported from `app/models/__init__.py`. Assignments made by the layer use `source="extra_duty_layer"`; `override_reason` = `"Extra-duty layer: " + ", ".join(overridden_rules)` (None when `ledger` is false).

**Ledger voiding:** when an assignment that has an active record is cleared, deleted, replaced, undone or moved to the recycle bin, the record becomes `void` with a reason. This is done by `void_records_for_assignments(db, assignment_ids, reason)`, called from `rota_assignment.clear_assignment`, assignment replacement in `assign_person_to_slot`, the admin delete/recycle bin for past duties, generation undo, and the extra-duty undo. Restoring from the recycle bin does **not** reactivate it (a new extra-duty run would).

**Ledger balance helper:** `ledger_balance(db, person_ids, before: date, months=12) -> dict[UUID, {count, last_date}]` counts only `status="active"`.

## 3. Service API (`app/services/extra_duty.py`)

```python
EXTRA_DUTY_SOURCE = "extra_duty_layer"
STRICT_CODES = {...}            # 1.1
OVERRIDABLE_CODES = {...}       # 1.2
class ExtraDutyError(Exception): code: str; message: str; status_code: int; extra: dict

def strict_blockers(ctx, person_id, slot, unit_id) -> list[dict]   # [{code, label}]; [] = feasible
def plan_extra_duties(db, month) -> dict   # {month, plan_hash, context_hash, decisions, summary, generated_at}
def preview(db, month, user) -> dict       # plan + token = HMAC(plan_hash|context_hash|month|user.id)
def apply(db, month, token, plan_hash, user) -> dict   # {batch_id, summary, decisions}
def undo(db, batch_id, user, dry_run=False) -> dict    # {batch_id, restored, conflicts: [...]}
def verify_month(db, month) -> dict        # {ok, checked, violations: [{slot_id, person_id, code, message}]}
def ledger_balance(db, person_ids, before, months=12) -> dict
def void_records_for_assignments(db, assignment_ids, reason) -> int
def person_ledger(db, person_id) -> list[dict]
def month_ledger(db, month) -> list[dict]
```

`apply`: advisory lock `extra-duty:<month>` (use `reference_registry.lock_namespace`) → recompute the plan → if its `plan_hash` differs from the previewed one, raise 409 `stale_preview` (nothing written) → write slot unit moves, assignments, records and the batch in one transaction → run `verify_month` restricted to the new assignments; on any violation roll back everything and raise 500 `verification_failed` with the violations → commit. Applying the same token twice returns the existing batch (idempotent: look up the batch by `plan_hash` + month with status `applied`).

`undo`: refuses (409 `undo_conflict`, listing slots) if any batch assignment is no longer active, was changed, or its slot has other new assignments, unless `dry_run`. Otherwise it removes the batch's assignments, restores `unit_id_before`, voids the records ("undone"), sets the batch to `undone`. Undo is allowed only while the period is a draft.

## 4. HTTP API (`app/api/v1/extra_duty.py`, prefix `/api/v1/extra-duty`, all `require_admin`)

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/status?month=` | | `{enabled, month, open_slots, batches: [{id, status, created_at, created_by_name, summary}]}` |
| POST | `/preview` | `{month}` | preview (section 3) |
| POST | `/apply` | `{month, token, plan_hash}` | apply result |
| POST | `/batches/{id}/undo` | `{dry_run: bool}` | undo result |
| GET | `/verify?month=` | | `verify_month` |
| GET | `/ledger?month=` or `?person_id=` | | ledger rows: `{id, person_id, person_name, duty_date, duty_type, home_unit, assigned_unit, fallback_used, overridden_rules, status, void_reason, batch_id, created_at}` |
| GET | `/unit-fallbacks` | | `[{unit_id, unit_name, fallbacks: [{unit_id, unit_name}]}]` |
| PUT | `/unit-fallbacks/{unit_id}` | `{fallback_unit_ids: [..]}` | same row |
| GET | `/report?month=&format=html\|xlsx` | | file download (section 6) |

Errors: `{detail: {code, message, ...}}`. Codes:

| Status | Code | When |
|---|---|---|
| 503 | `disabled` | `settings.extra_duty_layer_enabled` is false |
| 409 | `not_draft` | The period is not a draft (published/locked) |
| 409 | `scope_unlocked` | The month scope is not locked / no template |
| 409 | `nothing_to_fill` | No open slots |
| 409 | `proposal_active` | An active rota-compute proposal exists for the month — include the `conflict_summary` fields (`job_id, kind, status, processed, total, owned, operator_name`) so the UI's Resume/Cancel panel can be reused |
| 409 | `stale_preview` | The plan changed since preview |
| 403 | `bad_token` | The token does not match |
| 409 | `undo_conflict` | See undo |
| 500 | `verification_failed` | A post-write check failed; nothing saved |

Setting: `extra_duty_layer_enabled: bool = True` in `app/core/config.py` (env `EXTRA_DUTY_LAYER_ENABLED`).

## 5. Publish and review integration

In `rota_review.review_items`: if a slot's `hard_blocked` issue exists **and** the slot has an active assignment with an active extra-duty record, emit a `warning` issue `extra_duty_exception` ("Covered by the extra-duty layer: <person>; rules overridden: …") instead of the `error` `hard_blocked`. The publish checklist then treats it as a warning needing confirmation, not a blocker, and adds the line "Extra duties (ledger): N".

## 6. 360° audit report (`app/services/rota_report_360.py`)

`build_report_data(db, month) -> dict` assembles everything once (pure data, JSON-serialisable). `render_html(data) -> str` (fully self-contained: inline CSS, inline SVG charts, no external requests, `@media print` with A4 page breaks, light theme for print) and `render_xlsx(data) -> bytes` (xlsxwriter). Data shape:

```
{ meta: {department, month, month_label, period_status, generated_at, generated_by,
         rules_revision, data_fingerprint (sha256 of the assignment set), published_at, published_by},
  summary: {slots, filled, open, coverage_pct, members, duties_total, duties_24hr,
            extra_duties, fallback_duties, override_assignments, hard_blocked_covered},
  coverage: {by_day: [{date, weekday, slots, filled}], by_unit: [{unit, slots, filled}],
             by_duty: [{duty_type, label, slots, filled}]},
  workload: [{person_id, name, call_level, unit, total, hours24, weekend, weekend24, nights,
              holidays, extra, deviation_from_mean}],
  fairness: {by_call_level: [{call_level, members, mean, min, max, std, gini, spread}], overall: {...}},
  units: [{unit, campus, slots, filled, extra_received, fallback_received}],
  calendar: [{date, unit, duty_type, person}]   # for the heatmap/grid
  extra_duties: [ledger rows for the month + home/assigned unit + overridden rules + justice keys],
  compliance: {checks: [{name, passed, checked, violations}], all_passed},  # from verify_month + independent checks
  trend: [{month, filled, extra, gini}]          # up to the previous 5 months that have data
  audit_trail: [{at, actor, action, detail}]     # template runs, autofill runs, extra batches, publish
}
```

The compliance section must use `tools/extra_duty_verify.py`'s checking functions (import `check_month` from `app.services.extra_duty_verify`) — **not** the planner's own `strict_blockers` — so the report shows an independent check.

Report sections (HTML and xlsx sheets in this order): Cover & sign-off · Executive summary · Coverage · Member workload · Fairness · Units · Rota calendar · Extra duties (ledger) · Compliance · Trend · Audit trail. Fallback: if a chart fails, render its table; if xlsx rendering fails, the API returns 500 `report_failed` for xlsx, but html still works.

## 7. Independent checker (`app/services/extra_duty_verify.py` + `tools/extra_duty_verify.py`)

Written **only from section 1.1 of this contract**, not from `extra_duty.py`. `check_month(db, month) -> {ok, checked, violations: [{slot_id, person_id, code, message}], checks: [{name, passed, checked, violations}]}` checks every active assignment in the month (not just the layer's) against the strict rules; checks named: "Leave respected", "Rest after 24-hour duty", "No double booking", "Call level and groups", "Posted to the duty's unit", "Slot capacity". The CLI tool prints a report, and refuses to run on the working database (`duty_rota`) unless `--i-know-this-is-production` (same guard as `tools/merge_dry_run.py`).

## 8. Frontend (`frontend/src/extra-duty.ts`)

- On the Rota Template generation overview, add a 3rd stage card **"Extra-duty layer"** after "Autoassign members": text "Fills duties that are still open, even when the unit is short-staffed. Leave and rest are never broken." Button **Preview extra duties** → opens `openExtraDuty(month, onApplied)` (a `workspaceDialog`).
- Dialog: summary chips (to fill / with fallback unit / ledger records / cannot be filled); table: date · duty · unit (badge "Fallback from UNIT X" when fallback) · person · rules overridden (plain words) · why this person (justice key in words: "0 extra duties in the last 12 months · 3 duties this month") · alternatives (details); a separate "Cannot be filled" list with reasons. Footer: checkbox "I reviewed these extra duties" → **Apply extra duties**; status line; **Download audit report (HTML)** and **(Excel)** links after apply; **Undo this batch** with a confirmation (shows undo conflicts if any). For a 409 `proposal_active`, use `showProposalConflict` from `compute-conflict.ts`.
- Member profile: an **Extra duties** section listing that person's ledger rows (active and void).
- The Rota Review / Publish page: **Download audit report** buttons (HTML, Excel) for the month.
- Unit Management: per-unit **Fallback units** ordered list editor (`/unit-fallbacks`).
- Plain-word labels for codes: `unit_safety_hard_block` "Unit short-staffed (hard block)", `unit_safety_review` "Unit staffing warning", `monthly_24hr_limit` "Over monthly 24-hour limit", `monthly_weekend_24hr_limit` "Over weekend 24-hour limit", `monthly_same_group_limit` "Over monthly limit for this duty type", `monthly_same_campus_limit` "Over monthly limit for this campus".

## 9. Tests (minimum)

- Backend `tests/test_extra_duty.py`: strict rules one by one (each blocks); overridable rules are broken and recorded; fallback order (explicit list, campus, load); justice ordering (a person with an extra duty goes down the list; never-did-one first; ledger does not change `rota_candidates` scores); determinism (same plan_hash twice); idempotent apply; stale preview 409; undo exact restore + conflict; voiding on clear; verification failure rolls back everything (monkeypatch); publish shows `extra_duty_exception` as a warning.
- `tests/test_extra_duty_invariants.py` (independent): random rosters (seeded `random.Random`, ≥ 200 cases) → plan + apply → `check_month` ok; nothing strict ever violated; every new assignment is in the home unit or a recorded fallback.
- `tests/test_rota_report_360.py`: data totals add up; HTML is self-contained (no `http://`/`https://` src/href); xlsx opens with openpyxl and has the sheets.
- Frontend `tests/extra-duty.browser.mjs` (mocked APIs, axe, 390px no horizontal scroll).
