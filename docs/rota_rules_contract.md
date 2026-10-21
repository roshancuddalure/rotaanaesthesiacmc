# Rota Rules: eligibility, checks and history (contract)

Written for: the developers rebuilding the Rota Rules page, its API and its tests in parallel.

Owner decisions (21 Oct 2026):
- **Groups define the pool (option 1a).** When a duty has eligibility groups, anyone in a selected active group is eligible, and the duty's effective call levels automatically include each selected group's parent call level.
- **Slot change applies to new templates only.** Newly generated template slots for a duty whose effective call levels number more than one are no longer stamped with one call level guessed from the duty name. Existing slots are unchanged.

All routes require `require_admin`. Errors are 4xx with `detail` set to either a string or `{code, message, ...}`.

## Eligibility (one function, used everywhere)

`app/services/rota_eligibility.py`:

- `effective_call_levels(rule, groups_by_key) -> set[str]` is the union of:
  - the rule's `allowed_call_levels`, or the levels inferred from the duty key when that list is empty;
  - the parent `call_level` of every **active** group in `allowed_cluster_keys`.
- `eligibility(member_context, slot, rule, groups, memberships_on_date) -> Decision{eligible: bool, reason: str | None}` decides in this order:
  1. **Call level.** If the slot has its own `call_level` (a manual override, or an old slot), that level is required. Otherwise the member's call level must be in `effective_call_levels`. Failing reason: "Needs 3rd or 4th call; listed as 2nd call".
  2. **Allowed groups.** If the rule has allowed groups, the member must belong (on the slot date) to at least one *active* allowed group. Failing reason: "Not in PAC SR or PAC Senior".
  3. **Excluded groups.** The member must not belong to an excluded group. Failing reason: "In excluded group Schell".
- Safety (`slot_safety`), manual assignment validation (`rota_assignment`), candidates, auto-fill, the optimizer and compute all use this function. They must not keep their own copies of the logic.
- Template generation (`rota_template.py`, new templates only): the slot `call_level` is `None` when the effective levels number more than one; otherwise it is the single level. Unit staffing and member-counting helpers must accept a set of levels.

## Endpoints

1. `GET /api/v1/admin/rota-rules/phase-one` (existing). Unchanged fields, plus:
   - `revision: str`, a hash of the saved rules, used for conflict checks;
   - `groups: [{key, name, call_level, active, members}]`, where `members` counts active memberships today.
2. `POST /api/v1/admin/rota-rules/phase-one/check`. The body is the same as the PUT. Returns 200 with:
   - `problems: [{duty_key|null, field, code, severity: "error"|"warning", message, fix}]`
   - `duties: {duty_key: {effective_call_levels: [..], eligible_now: int, eligible_by_level: {level: n}}}`, where `eligible_now` counts active members today who pass the eligibility rules for the duty (ignoring leave and units).

   Problem codes:

   | Severity | Code | Meaning |
   |---|---|---|
   | error | `unknown_group` | Group key no longer exists. Fix: remove it. |
   | error | `allowed_and_excluded` | The same group is both allowed and excluded. |
   | error | `unknown_call_level` | Call level not recognised. |
   | error | `unknown_duty` | Duty key not recognised. |
   | error | `bad_group` | Duty category not recognised. |
   | error | `bad_hours` | Hours out of range. |
   | warning | `inactive_group` | Selected group is inactive; its members are not eligible. |
   | warning | `empty_group` | Selected group has no members today. |
   | warning | `nobody_eligible` | No active member is eligible for an active duty. |
   | warning | `label_duplicate` | Two duties share a display label. |
   | warning | `guardrail` | e.g. hard block % below warning %. |

3. `PUT /api/v1/admin/rota-rules/phase-one`. The body is the existing payload plus `base_revision: str | null`.
   - If `base_revision` is given and differs from the current revision: 409 `{code: "stale_rules", message, current_revision}`.
   - Any error-severity problem: 422 `{code: "invalid_rules", message, problems: [...]}` listing **all** of them. Warnings never block a save.
   - Success: the GET shape, and a version snapshot is stored.
4. `GET /api/v1/admin/rota-rules/phase-one/versions` returns, newest first, `[{version_id, saved_at, saved_by, revision, changed_duties: [labels], note}]` (at most 100).
5. `GET /api/v1/admin/rota-rules/phase-one/versions/{version_id}` returns `{version_id, saved_at, saved_by, rules: <payload>}`.
6. `POST /api/v1/admin/rota-rules/phase-one/versions/{version_id}/restore` with body `{base_revision}`:
   - saves that snapshot as the current rules, which creates a new version;
   - 409 `stale_rules` as for the PUT;
   - 404 for an unknown version.
7. `GET /api/v1/admin/rota-rules/eligibility-gaps?month=YYYY-MM` lists active duties for which nobody is eligible in that month (diagnostics): `[{duty_key, label, reason}]`.

Storage: a `rota_rule_versions` table (migration `20261021_0028`, down_revision `20261021_0027`) with `id`, `revision`, `rules` (JSON), `saved_by_id`, `saved_by_name`, `saved_at`, `changed_duties` (JSON) and `note`. The first save after the upgrade also stores the previous rules as a version labelled "Before history".

## Option meanings (use these hints in the page; plain words)

| Option | What it does |
|---|---|
| Active | The duty exists in this department. Inactive duties are hidden from templates and never generated. |
| Mandatory | Generated automatically every day when a month's template is built, and the generator must fill it first. |
| Adjustable | Optional: not generated unless you tick it in the template's duty list for that month. |
| Same-day block | Whoever does this duty cannot take another duty that same day. 24-hour duties always do this. |
| Next-day block | Whoever does this duty is rested the next day and gets no duty then. 24-hour duties always do this. |
| Call levels allowed | Which call levels can do this duty. Selected groups add their own call level automatically. |
| Groups allowed | If any are chosen, only members of at least one chosen group can do the duty (any of them, not all). |
| Groups excluded | Members of these groups can never do this duty, even if otherwise eligible. |
| Duty category | Used for counting and grouping duties in reports and exports. It is not a member list. |
| Hours | Length of the duty. 24-hour duties count towards the 24-hour totals. |

Guardrails:

| Guardrail | What it does |
|---|---|
| Minimum gap after 24hr duty | Hours of rest required after a 24-hour duty before the next duty. |
| Minimum available per unit | The fewest people a unit must keep free each day. |
| Warning unavailable % | Show a warning when this share of a unit is away or on duty. |
| Hard block unavailable % | Refuse more assignments when this share of a unit is away or on duty. |
| Max 24hr duties/month | Cap per person; leave it empty for no cap. |
| Max weekend 24hr/month | Cap per person on weekend 24-hour duties. |
| Post-24hr blocks next-day elective | After a 24-hour duty the person is not available for elective work the next day. |
| Small units use absolute minimum | Small units use the minimum number above instead of percentages. |
