# Promotion objective correction and burden evidence — 20 November 2026

The real-solver dated-promotion audit found and corrected slot-order dependence in the monthly equality objective. Current policy priorities, dated eligibility, required coverage and final validation remain in place.

## Reproduction and correction

The disposable fixture has four first-call members and one stable second-call member. One first-call member promotes on16May. There is a first-call duty on5May and a second-call duty on20May. Explicit preferences select the promoted member for both compatible duties, making the allocation identical in both runs.

Canonical fairness reporting assigns monthly membership at the first posted day. The member's uniform monthly target is therefore one first-call duty divided by four members, or1/4. Two duties give an incremental equality cost of100*((2-1/4)^2-(0-1/4)^2)=300. This is the existing monthly membership convention, not a newly selected date-weighted or personal pro-rata target.

Before correction, optimizer `level_of` was overwritten by each candidate row. Chronological slot iteration used the later second-call level and scored0; reversed iteration used first-call and scored300. Both proposals passed final validation, demonstrating a scoring consistency defect rather than an eligibility violation. `n05-promotion-before.xml` retains the failing assertion `[0,300] != [300,300]` (native9273EXIT1). A fixture-construction autoflush warning was also removed by loading its unit before creating pending related objects.

`fairness_targets.objective_target_basis` now returns targets and canonical member levels from one `_Month` load. Existing `target_by_level` callers keep their original result shape. `CandidateContext` caches both together; dataclass copies retain the membership. The optimizer uses that membership consistently for model costs, incumbent quality and lower bounds. Candidate eligibility still uses each actual duty date. The corrected fixture scores300 in both orders.

This is a narrow consistency correction under the preserved contract. It does not choose the unanswered optional P6 pro-rata amendment, change OT/reserve minima, cross call pools, change score priorities, install models or apply an operational proposal. Older saved choices and reports are not rewritten or retrospectively certified by these tests.

## Burden examples

Four separate disposable examples hold both active members at one preserved duty each and offer one compatible new duty. An explicit contrary preference favors the member who already carries the tested burden.

- Weekend: an existing Saturday duty versus a weekday duty; the new Saturday duty goes to the person without weekend burden.
- Night: an existing18:00 overnight eight-hour duty versus an08:00 daytime duty; the new overnight duty goes to the person without night burden. Explicit fixture-only eight-hour duty rules are supplied to the canonical context.
- Holiday: weekday dates with an explicitly supplied holiday calendar; the new holiday duty goes to the person without existing holiday burden.
- No holiday calendar: the holiday tier is0 and configured dates are empty. This establishes the absence of a comparison, not equitable holiday distribution.

Every selected proposal passes independent final validation. All eight preserved synthetic assignment rows across these four separate databases remain assigned to their original people; no new DutyAssignment is saved by solving. These are controlled category examples, not a full month fairness proof or a validated departmental holiday calendar.

## Verification and remaining scope

- `n05-promotion-regression.xml`:32passed210.04s(native56035EXIT0), including promotion/order, previous objective-priority examples, saved-proposal/Excel basis, fairness targets/real-shaped simulation and existing intelligence/repair/learning/authorization paths. It includes the previous turn's five tests; do not count them twice as new cases.
- `n05-category-burdens.xml`:4passed88.33s(native79975EXIT0), no failures/errors/skips.
- `n05-context-parity.xml`:7passed81.53s/10deselected(native70048EXIT0), cached versus reference candidates on hard cases, numeric local-GPU frames/server decisions and server fallback. Numeric frame parity is not a physical GPU benchmark. These seven tests are separate from the32+4 above.
- Ruff/scoped whitespace checks passed. Source manifests retain pre-fix hashes and105 final checkpoint hashes. Comparison against the preceding checkpoint found exactly the five expected changed checked files: three runtime services, the precedence test and objective specification; unrelated checked service hashes were retained. Earlier evidence remains scoped to its recorded revision.
- No frontend, migration or deployment change. No frontend build/browser/real-GPU or operational DB verification is claimed for this backend batch.

N05 stays In progress. N02 administrator-correction evidence, N06 ratified metrics, independent opportunity-normalized workload trade-offs and wider dated pool/monthly compensation cases remain real scope. P6's optional priority amendment is not a blocker for continuing current-policy verification. Original50 items are preserved, and the full goal is not complete.

Rollback, if needed, removes only the new objective-target-basis helper/cache and optimizer membership lookup, retaining unrelated work in these already-dirty files. Do not reset entire files or rewrite saved operational proposals.

All four native handles9273/56035/79975/70048 are terminal (expected failing reproduction followed by successful gates). No implementation/test/model worker remains intended live; dashboard5201 is a viewer. Next concrete work is an independent opportunity-normalized workload counterexample and a dated pooled-level variant before another N05 acceptance reconciliation.
