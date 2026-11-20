# Monthly OT capacity read model (N13 in progress)

`GET /api/v1/admin/ot-calendars/{unit_id}/month-capacity?month=YYYY-MM`
uses the existing administrator and OT feature gates. `include_pending=true` is
an explicitly labeled stress scenario. It reads saved configuration; unsaved
calendar drafts never enter these results. The route holds the shared input lock
for a coherent read and performs no rule initialization or operational writes.

The service resolves the selected unit's month plus adjacent dates for overnight
competition and loads canonical dated availability exactly once. Zero-demand
whole-day anchors allow posted/leave/rest counts even on reviewed closures and
unknown days; these anchors never become staffing requirements. The existing
joint OT/reserve matcher evaluates each day with overlapping whole-band roles.
The result is selected-unit capacity, not simultaneous cross-unit proof.

Interval boundaries include OT roles, dated posting/call windows, merged duty/rest
blocks and source leave intervals. Posted, available, unavailable, witness-reserved
and unreserved sets are distinct identities. Unavailability is a set difference,
so a person on both approved leave and duty/rest is counted once. The fact list
preserves both source reasons without private leave notes. Included reserves can
share OT staff; additional reserves remain distinct through the canonical matcher.
Unreserved people are not certified duty candidates: duty call/group, monthly
limits and future rest effects still require normal assignment validation.

Unknown/partially configured demand never becomes zero. Incomplete rule or
qualification context is explicit. A solver timeout without a witness leaves
reserved and unreserved counts null; it does not make every person available for
duty. An explicit closure has zero OT reservations and still shows dated posted
people. Witness identities on an infeasible day are a partial diagnostic solution,
not an operational staffing commitment or a claimed unique shortage allocation.

Bounds:512rolebands,512postedidentities,2048boundaries/day,200000identity-interval
work units; matcher calls receive at most0.2seconds/day within an8second overall
solve budget. Bound/unknown results do not certify staffing. The bound applies to
solving; database loading and response construction are not a guaranteed8second
HTTP latency. Performance and multi-unit aggregation require measurement before
rollout. This implementation does not sum selected-unit proofs into global proof.

N13 remains In progress. The existing OT calendar now mounts a monthly heatmap
with interval/person/source drill-down. The API supplies canonical names only for
people in its selected-unit availability context; private profile/leave notes are
excluded. Form input invalidates old results immediately, request tickets reject
late responses, disposal invalidates in-flight reads, and errors allow explicit
retry. Saved-revision changes are disclosed without replacing the editor draft.

`n13-month-browser.json` records1440px/390px checks:30dates, named interval drill-down,
keyboard day selection, late response ignored after scenario change,503error and
successful retry into pending-leave stress, no overflow/page errors, no serious or
critical Axe violations across the entire monthly panel. Populated screenshots
were inspected. TypeScript/Vite production build passed; existing bundle warnings
remain. `n13-ui-backend-final.xml`6passed17.87s after the name projection.

Still validate browser
behavior, overnight competition, dated transfers and multi-unit presentation
for scarcity and unknown states, and reconcile actual duty-eligible counts before
marking original N13 acceptance complete. Current unreserved counts deliberately
do not certify duty eligibility. No production deployment is claimed.
