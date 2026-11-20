# Actual duty eligibility within monthly capacity (N13 in progress)

The monthly panel now offers an administrator-only saved-duty check at
`/{unit_id}/duty-capacity?day=YYYY-MM-DD`. It uses the normal assignment validator
with one shared candidate context and read-only supplied rules; it does not derive
eligibility by subtracting the matcher's chosen OT identities. The candidate
context's existing callers retain their default rule bootstrap behavior; only
callers explicitly supplying reviewed rules skip that bootstrap.

The response enumerates saved unit-assigned template duties on the selected date.
Each open draft duty has its own clear, no-override candidate count, named people
and blocked issue codes/messages. A person can be individually clear for two
simultaneous duties without both being fillable together. These counts are
independent alternatives, not an allocation or combined coverage proof. Apply
still revalidates inputs and the complete resulting schedule.

No saved duties, excluded/filled duties and protected published periods are
explicit outcomes. Missing rules do not initialize defaults; unresolved OT input
leaves the candidate count uncertified/null. Pending-leave stress duty counts are
explicitly not evaluated: the existing assignment validator evaluates the approved
scenario. This limitation does not change the month view's pending-leave capacity
stress calculation or invent a new allocation policy.

Work is bounded to16saved duties,256person/duty checks and a10second between-check
budget. A budget exit suppresses partial counts. The underlying canonical OT
guard retains its own proof/resource bounds; this is not a guaranteed10second HTTP
latency. Read routes hold the existing scheduling-input lock and perform no
assignment writes. No names/notes beyond the existing administrator authority are
sent to models or a new data route.

Evidence: initial27checks passed;59existing OT integration/reviewed compute checks
passed before the later null-on-unresolved refinement. Current focused5checks
passed13.88s afterward: four individually clear candidates per simultaneous duty,
mandatory shortage rejection, unknown/null, explicit protected/no-saved/filled/
pending outcomes, no default initialization, date validation and administrator gate.
The actual desktop/mobile calendar browser run checks the new button and count4
alongside named detail, stale responses, request error/retry and full-panel Axe.
Production TypeScript/Vite build passed with existing bundle/import warnings.

N13 is not complete. Remaining evidence includes the month view's overnight,
midmonth transfer, partial-demand and multi-unit presentation edge cases, and UI
checks for the new duty-unknown/protected states. These remain explicit work rather
than being inferred from successful rendering of a feasible duty.
