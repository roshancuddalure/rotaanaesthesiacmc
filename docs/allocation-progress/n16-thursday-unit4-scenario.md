# Actual Thursday Unit IV demand and compensation scenario

`tools/audit_thursday_unit4.py` exercises the current template generator, person
optimizer, ordinary final validator and whole-month OT guard on disposable SQLite.
It does not inject unit choices, use another scheduler, change numeric objectives
or write operational assignments. The selected generation windows are deliberately
small; this is not a full-month fairness proof or N16 completion by itself.

Two included units, IV and V, each have four synthetic third-call members posted
from1October2026. All weekday OT calendars are explicitly reviewed: no missing
definition is treated as zero. The matched control has mandatory OT minimum0;
the pressure case changes only Unit IV Thursday minimum/target to4 during08–16.
One MAIN_3RD_24HR duty is required on each selected date. No leave, historical
assignment, preference, holiday or unequal capacity changes between the pair.

## Matched results under current policy

| Window | Reviewed-zero control | Thursday pressure |
| --- | --- | --- |
|19November Thursday |Unit IV duty|Unit V duty|
|20November Friday |Unit V duty|Unit IV duty|
|Two-day totals |One duty per unit|One duty per unit|
|24November Tuesday, separate matched window |Unit IV duty|Unit IV duty|

The pressure case protects all four Unit IV members for mandatory Thursday OT.
The later required Friday duty supplies feasible compensation without increasing
the requirement count. Every duty in these windows is safely covered; template
slots are ready, ordinary final checks have zero failures, the OT final proof is
feasible and zero assignments are saved.

The Tuesday result is unchanged because the increased Thursday demand does not
overlap that duty's protection window under current rules: the24-hour Tuesday duty
and24-hour rest finish at Thursday08:00, exactly when the OT band starts. This is
an observed compatible boundary, not permission to shorten rest or reuse a person
across overlapping requirements.

A third window includes only Thursday's required duty. Under pressure it goes
to Unit V; totals are IV0/V1. There is no later required duty in that selected
window, so compensation cannot be promised. No extra duty is invented, no OT
minimum is relaxed, and no requirement is removed to manufacture equal totals.
This demonstrates lack of a later opportunity, not every kind of infeasible
month-wide compensation caused by skills, leave, locks or continuity.

## Evidence and remaining scope

Initial session68521 exited0 (`n16-thursday-unit4.json`, three cases), complete/
source-unchanged and hashes verified. Expanded session72751 exited0
(`n16-thursday-unit4-final.json`, five cases), unchanged Tuesday included;
source hashes were rechecked before adjusting the fixture. Those exploratory
runs used an explicit free-person minimum0. The final verified run uses minimum1
with explicitly included OT reserve mode, testing that ordinary reserve protection
is not bypassed. Its separate output is `n16-thursday-unit4-verified.json`.
Final session84853 exited0: all five cases complete/source-unchanged, final
hashes independently rechecked and Ruff/scoped whitespace passed. Outcomes match
the table with free-person minimum1 and included reserves. All seven required
duties across these separate windows are covered, ordinary final failures0,
whole-month OT final status feasible in each fixture, saved assignments0.
The three exploratory runs overlap and are not13 independent scenarios.

No policy choice is made between uniform person targets and pro-rata deviation:
both units/members have the same dated capacity here. N05/P6/N06 broader decisions,
representative contrasting months, multi-level skills/reserves and all remaining
original tasks retain their scope. N16 is in progress, notDone. The saved scenario
and command are reproducible; no browser, live-model or physical GPU performance
claim follows from this verification-only tool.
