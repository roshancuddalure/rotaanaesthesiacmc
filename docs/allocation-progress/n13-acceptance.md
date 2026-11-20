# N13 acceptance closure

Original action: monthly unit capacity/pressure heatmaps with posted, unavailable,
OT-required, reserved and duty-eligible counts plus drill-down reasons. Every
displayed count must reconcile to distinct people/intervals; unknown demand and
pending assumptions must be visible and restricted details stay restricted.

| Requirement | Current behavior and inspected evidence |
|---|---|
| Monthly unit view | Existing OT calendar unit selector/month heatmap;1440px/390px actual browser workflows,30datecells, keyboard and full-panel Axe checks |
| Posted/unavailable counts | Canonical dated windows and set difference per interval; leave/rest union test removes one identity once despite both reasons; midmonth transfer changes4to3 with no other-unit roster leakage |
| OT/reserved counts | Existing joint matcher; required role arithmetic per interval and distinct witness identity union; included/additional reserve semantics retained. Unknown proof/null stays separate from explicit closure/zero |
| Duty-eligible counts | Separate actual saved-duty validator drill-down; individually clear/no-override candidates, blocked reasons, unknown/null, protected/filled/no-saved and bounded-work states. Never inferred from the witness's chosen unreserved identities |
| Reasons/identity reconciliation | Named people, source IDs and interval facts; private notes excluded; admin/date tests. Whole-band temporal components include preceding overnight demand and later transitive competitors |
| Unknown/stress | Unknown/partial area configuration visible and reservations null; explicit pending-leave capacity scenario and reported-vs-blocking facts. Duty eligibility remains the official approved scenario, explicitly uncertified during pending stress |
| User-visible recovery | Actual unknown/null, shortage/zero, protected and no-saved-duty states on desktop/mobile; late unit/month responses ignored;503error and successful retry; no page errors/overflow |

Current backend evidence: `n13-edges-current.xml`35passed21.16s after temporal
component extension; `n13-edges-components-final.xml`4passed9.86s after adding the
transitive competitor assertion. Earlier current duty/month tests and privacy,
permissions, timeout and closure checks remain mapped in the two implementation
contracts. Counts overlap; these are not a sum of unique tests.

Browser evidence: `n13-month-edges-browser.json`8cases across1440px/390px plus delayed
unit switch. `n13-month-browser.json`covers feasible named detail, normal duty
count4, keyboard, stress-label/error-retry and full monthly panel accessibility.
No frontend runtime changed in this final edge batch; its preceding successful
production build remains the build evidence. Source fingerprints are in
`n13-edges-source.json`.

Failed evidence retained: first backend edge run13pass2fail (one assertion demanded
optimal infeasibility from a bounded solver which honestly returned time_limited;
another compared tuple to list). The corrected temporal test requires either
proven shortage or an explicit unproven state, independently asserts6roles/4people,
and checks the preceding/transitive demand IDs are present. The first browser run
passed8state cases but its final switch requested an inactive fixture unit that
the selector correctly omitted; fixture activation fixed that harness condition.

The result is selected-unit pressure within loaded dates and linked overlapping
role bands, not a globally optimal monthly unit/person plan or a per-date minimal
shortage explanation. Independent duty alternatives do not prove simultaneous
coverage. These boundaries are visible rather than converted to fabricated counts.
N26/N27 retain global architecture/performance work; N34 retains robustness work.

N13 is Done against the original row. Rollback can remove the new read-only routes
and calendar panel without migrating data or changing allocation records. Existing
OT feature gating remains disabled by default. This closure is not production
deployment, new policy authority, universal perfection or completion of all50items.
