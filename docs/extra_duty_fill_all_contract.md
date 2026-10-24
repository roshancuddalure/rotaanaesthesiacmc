# Fill remaining duties ("all units" mode) and unit rules in "Who can do it": contract

Status: binding for the implementing agents. Date: 21 Oct 2026. Builds on `docs/extra_duty_contract.md`
(read it first; everything there still holds unless changed here).

## 0. Owner decisions (verbatim intent)

- **Never broken, strictly, in every mode:** leave (any status), rest after 24-hour duty, overlapping or
  same-day duties, **call level** (no crossover, ever), **eligibility groups** (allowed and excluded
  groups, no crossover, ever), and the duty's **unit rules** (section 5). There is no setting that loosens these.
- **May be exceeded:** an individual's duty limits (`duty_count_limits`, counted across all units for the
  person, as `validate_assignment` already does), unit staffing, fairness.
  Every individual over a limit must be listed in the pre-apply dialog, in the publish section
  (review/checklist "debrief"), and in the 360° audit report.
- **May be used:** members of the *same* call level and groups from *any other unit*.
- Fill-all is a **separate button** with a polished dialog that shows the report and conflicts **before**
  anything is applied. Nothing runs automatically.

## 1. Data finding that drives the design

On the database copy, June 2026 has 63 active 3rd-call, 22 4th-call and 15 5th-call members, but none of them has a
June posting (May had postings such as `3RD_CALL`, `4TH_CALLS`). These duties stay open because nobody
of the right level is posted anywhere, not because a rule blocks them. So fill-all also considers
**unposted members**: active members of the exact required call level and groups who have **no posting
covering the duty date**. They are flagged, listed in the dialog and ledgered. The dialog also
shows a diagnostic ("63 3rd-call members have no posting this month") so the board can fix the
postings instead.

## 2. Mode

`mode: "standard" | "all_units"`, default `"standard"` (existing behaviour, unchanged).
- `POST /v1/extra-duty/preview` body `{month, mode?}`; `POST /v1/extra-duty/apply` body
  `{month, token, plan_hash, mode?}`. `mode` is part of `plan_hash`/token, so applying with a
  mode different from the preview is `stale_preview` (409).
- The batch stores `summary.mode` (no migration; `summary` is JSON). Undo is identical for both modes.
- `nothing_to_fill`, `not_draft`, `scope_unlocked`, `proposal_active`, `disabled` behave as today.

## 3. All-units candidate search (service: `app/services/extra_duty.py`)

For each open, non-excluded template slot (same slot order as standard mode), candidates come from these
unit tiers. Every candidate must pass `strict_blockers` (leave, rest, overlap, call level, groups, active,
existing row, **unit rule**) for the slot as it would be placed.
1. `home`: members posted to the slot's unit on that date.
2. `fallback`: the explicit fallback list (in order).
3. `same_campus`: other in-scope units on the same campus.
4. `any_unit`: every other in-scope unit.
5. `outside_scope`: active units excluded from this month's scope.
6. `unposted`: active members with no posting covering the duty date.

The slot moves to the chosen member's unit for tiers 2–5, exactly as fallback does today. For tier 6 the slot keeps its unit
(`assigned_unit_id = home_unit_id`). A unit is usable only if it is active and
`rule_applies_to_unit(rule, unit)`.

**Ranking across all tiers**, lowest key wins and the result is deterministic:
`(exceeds_individual_limit: bool, tier_index, *existing justice key: ledger_count, month_duties, ..., person_id)`.
So a member within their limits in any unit beats a member over their limit at home.
`exceeds_individual_limit` = `validate_assignment` against the plan state returns any of
`monthly_24hr_limit`, `monthly_weekend_24hr_limit`, `monthly_same_group_limit`, `monthly_same_campus_limit`.

**Ledger codes** (added to `overridden_rules` and `OVERRIDABLE_CODES`/`LEDGER_ONLY_CODES`, deterministic
order: validate_assignment codes first, then these):
- `fallback_unit` for tier 2–3 (existing), `any_unit` "Covered from another unit" for tier 4,
  `outside_scope_unit` "Covered from a unit outside this month's scope" for tier 5,
  `unposted_member` "Member has no posting this month" for tier 6.
- Each decision also carries `tier` (one of the six names).

**Strict-code addition:** `unit_rule` "Duty not allowed for this unit". It applies if the final unit fails
`rule_applies_to_unit`. Add it to `STRICT_CODES`, `strict_blockers` and `verify_month`.

**`verify_month` / posted-to-unit check:** an assignment backed by an active ledger record with
`unposted_member` is exempt from the "posted to the duty's unit" check. All other checks still apply
to it: leave, rest, overlap, call level, groups, unit rule, capacity and active.

## 4. Preview/apply response additions (both modes; empty lists in standard mode are fine)

```
summary: {..., mode, over_limit_people: int, cross_unit: int, unposted_used: int}
over_limit_people: [{person_id, person_name, call_level, home_unit_name,
                     month_duties, month_24hr,
                     limits: [{code, label, limit, actual}]}]      # after the plan, sorted by name
unfilled_causes: [{cause, label, count, fix, examples: [{slot_id, duty_date, duty_label, unit_name}] (max 5)}]
diagnostics: {unposted_by_level: {"3RD_CALL": 63, ...}, unposted_by_group: {"3rd_call_a": 10, ...}}
```
`cause` is one of: `no_member_at_level` (no active member of the call level and groups exists at all),
`unit_rule` (the duty's unit rules exclude every unit that has suitable members),
`all_on_leave`, `all_resting`, `all_double_booked`, `other`. Each cause has a plain-words `fix`, e.g.
"Add or activate 3rd-call members in Member management", "Enter June postings", "Review leave".
`over_limit_people` is computed for **every** active assignment of the month after the plan, not only
for extra-duty people, so the dialog shows the true picture.

Shared helper for publish/report: `app.services.extra_duty.individual_limit_breaches(db, month) ->
list[same shape as over_limit_people]`. It reads the current saved state, computing limits from the saved rules.

## 5. Unit rules in "Who can do it"

`DutyRule.allowed_units` / `excluded_units` already exist (tokens matched by `token_matches_unit`:
id, code or name, case-insensitive). They control which units a template slot is generated for
(`rule_applies_to_unit`) and are honoured by fallback.
- The UI writes **unit ids**. Legacy code/name tokens still match.
- The rules check (`/rota-rules/check` and rule save validation) reports `missing_unit`
  ("Selected unit no longer exists") for a token matching no unit, `inactive_unit` (warning) and
  `unit_in_both` (error) if a unit is in both lists.
- Strictness: `strict_blockers` and the independent checker (`extra_duty_verify.check_month`, `tools/extra_duty_verify.py`)
  fail an assignment whose slot's final unit fails `rule_applies_to_unit` (code `unit_rule`). Normal
  generation already only creates slots for allowed units. Make sure manual `assign_person_to_slot`
  validation does not allow moving a slot to a disallowed unit; it does not move slots today, so nothing changes there.

## 6. Publish debrief and report

- `rota_review` summary gains `over_limit_members: int`. `rota_publish` checklist gains a **warning**
  (not a blocker) "Members over their individual limit". Its detail is
  "N member(s) above an individual duty limit: Name (24-hour 7/6), ...", truncated to 5 names plus "and N more",
  and the response includes `over_limit_people` (full list) so the publish screen can show a table.
- 360° report: a new section `individual_limits` "Individual limits exceeded", after Fairness, with a table
  (member, call level, unit, duties, each limit actual/limit). It goes in the executive summary key findings
  and in the xlsx as a sheet "Over limit". Ledger section labels the new codes.
- Code → label map (frontend `CODE_LABELS`, report `OVERRIDE_LABELS`, review `EXTRA_DUTY_RULE_LABELS`):
  `any_unit` "Covered from another unit", `outside_scope_unit` "Covered from a unit outside this month's
  scope", `unposted_member` "Member has no posting this month", `unit_rule` "Duty not allowed for this unit".

## 7. File ownership (agents edit only their files; the integrator handles the rest)

- **Agent A (planner):** `backend/app/services/extra_duty.py`, `backend/app/api/v1/extra_duty.py`,
  `backend/tests/test_extra_duty.py`, `backend/tests/test_extra_duty_api.py`, `backend/tests/test_extra_duty_invariants.py`.
- **Agent B (unit rules and checker):** `backend/app/services/rota_rules.py`, `backend/app/api/v1/rota_rules*.py`,
  `backend/app/services/rota_eligibility.py` (only if needed), `backend/app/services/extra_duty_verify.py`,
  `tools/extra_duty_verify.py`, `backend/tests/test_extra_duty_verify.py`, new `backend/tests/test_rule_units.py`,
  existing rota-rules tests.
- **Agent C (frontend):** `frontend/src/extra-duty.ts`, `frontend/src/rota-rules.ts`, `frontend/src/services/api.ts`
  (types only), `frontend/src/styles.css` (append only, scoped classes), the publish-screen part of `frontend/src/main.ts`,
  `frontend/tests/extra-duty.browser.mjs`, `frontend/tests/rota-rules.browser.mjs`, new `frontend/tests/fill-all.browser.mjs`.
- **Agent D (publish and report):** `backend/app/services/rota_review.py`, `backend/app/services/rota_publish.py`,
  `backend/app/services/rota_report_360.py`, `backend/tests/test_rota_report_360.py`, review/publish tests.
  It imports `individual_limit_breaches` from Agent A. Until A lands, it codes against the shape in section 4 with a local
  fallback that it removes at the end.
