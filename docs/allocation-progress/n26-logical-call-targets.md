# Logical duty targets with mixed call pools and dated promotions

The month comparison now calculates its fairness targets through the existing `objective_target_basis` implementation. The caller supplies one representative per logical required duty after verifying that both unit alternatives resolve to the same call-level pool. The reporting helper accepts these representatives as an optional input; ordinary production callers continue to load their existing template duties.

Representatives must have distinct identities and dates inside the requested month. Canonical membership still uses the member's first posted day, existing leave treatment and unposted-duty rules. Demand for pooled duties still splits proportionally to monthly member counts. The experiment now records both target values and monthly membership counts in its results. When targets differ, it requires the full shared objective builder and disables the raw squared-load shortcut for certifying equality.

The synthetic mixed fixture has six third-call and two fourth-call monthly members. Fifteen duties require third call; fifteen accept a third/fourth call pool using an existing configured duty type. Pooled demand splits 6:2, giving 26.25 third-call duties and 3.75 fourth-call duties. The corresponding monthly targets are **4.375** and **1.875**. The 60 unit alternatives represent only 30 logical requirements.

One member is promoted from third to fourth call on November 16. Dated eligibility must exclude that member from a strict third-call duty after promotion and retain eligibility for a pooled duty. Monthly fairness membership remains third call under the existing first-posted-day contract. Reversing unit alternatives and representative order must leave targets and membership unchanged. The fixture's OT bands explicitly accept both call levels, preserving the configured identity counts.

The initial target/reporting gate passed seven tests in 180.64 seconds. The first mixed fixture gate recorded two passes and one failure in 124.58 seconds: it attempted to introduce an unregistered synthetic duty type, which the existing rule validator correctly rejected. The fixture was corrected to use the existing fourth-call duty type with an explicit third/fourth pool; this did not weaken the rule validator. Corrected and final results are recorded separately in the execution tracker and JUnit evidence.

These changes make the architecture comparison's fairness basis more representative. Architecture selection, broader representative scenarios, calibrated resource comparisons and the remaining 50-item acceptance requirements remain open. No operational rules or published rota are changed by these disposable fixtures.

The corrected mixed test initially used a November 18 Unit IV pooled duty. Its candidate set was empty because the duty/rest interval would remove staff needed for Thursday OT, so the application correctly rejected it for a separate staffing reason. The eligibility assertion now uses November 16, which isolates the intended promotion/pool behavior. The failed artifact is retained as `n26-mixed-targets-corrected.xml`.

The first expanded final gate recorded **20 passed and one failure in 230.40 seconds**. Mixed target, promotion, order and invalid-representative checks passed. The prior configured-quota regression exhausted its 15-second search allowance before finding any new choices and retained only its saved duty. That is a safe partial timeout result, but insufficient evidence for the test's expected 24-duty ceiling. Its test-only allowance was increased to 60 seconds. Application defaults and the separate 30-second comparison budget remain unchanged. The retry and benchmark run overlap on the workstation, so their durations cannot support controlled performance claims.

The retry (`n26-logical-targets-verified.xml`) passed **21 tests in 169.06 seconds**, zero failures/errors/skips. This includes reporting targets, mixed-call promotion/order checks, objective precedence and independent quota arithmetic.

The first real mixed benchmark (`n26-mixed-call-month.json`) recorded the correct 6:2 member counts and targets. Joint search returned zero new choices before producing a first-tier incumbent; repair retained 28 duties with a severely uneven load and only coverage proofs. This exposed a missing incumbent mechanism in the experiment. The result is retained and is insufficient architecture-quality evidence.

The experiment now builds one common greedy incumbent during recorded preprocessing. Each proposed addition must pass the complete canonical validator, monthly quotas and OT checks; saved signatures remain protected. Each layout receives the applicable subset of that shared seed as hints and a checked incumbent. The final comparison uses the exact shared quality vector and retains the seed if a later solver incumbent is worse. Such fallback discards incompatible objective-proof receipts. Expired searches can retain a validated draft but receive no objective proof.

The updated focused mixed test (`n26-mixed-seed.xml`) passed in **57.74 seconds**, proving target arithmetic, dated eligibility, representative validation/order independence and retention of the actual validated seed under a forced expired search. It overlaps the earlier 21-test gate. The fresh seeded benchmark and final source hashes are recorded separately; timing is uncontrolled because it overlaps the focused worker.

The seeded artifact `n26-mixed-call-month-seeded.json` is complete with recorded source hashes unchanged. Shared setup, including the validated seed, took 8.87 seconds. The methods retained these canonically valid results:

| Method | Covered / required | Member loads | Method wall seconds | Proof limits |
|---|---:|---|---:|---|
| Joint | 29 / 30 | 4, 4, 4, 3, 4, 4, 3, 3 | 26.77 | Required coverage unproved; only conditional coverage receipt thereafter |
| Repair | 27 / 30 | 1, 1, 3, 1, 0, 10, 0, 11 | 30.95 | Required coverage proved only for selected fixed layout; later tiers unreached |

The joint seed already covered 29 duties and survived search. The final repair layout admitted only 12 duties from the shared seed; subsequent fixed-layout search found 27, but did not balance them. This is an unresolved quality gap, not acceptance evidence for the repair architecture. Coverage remains higher priority than equality, so a poorly balanced higher-coverage incumbent can be retained while its lower tiers remain unsearched. A layout-specific validated warm start and better tier-budget allocation require further work.

Neither result proves global maximum coverage or equality; raw squared-load arithmetic is explicitly not a fairness-optimality certificate when call-level targets differ. Every reached receipt matches the shared quality scorer. There were no proposed assignment writes. Joint had no recorded overrun; repair overran its allowance by 0.95 seconds in blocking work. Whole-process sampling observed 166,989,824 bytes/233 observations and 168,026,112 bytes/255 observations, with no sampler errors. These are sampled resident maxima including fixture/native solver, with concurrent test activity and fixed method order; no resource requirement or speed claim follows.

Final provenance is `n26-logical-targets-seeded-source.json`: all 176 captured files were independently rechecked unchanged after focused test and benchmark completion. Scoped Ruff and whitespace checks passed, with existing LF/CRLF warnings. The goal remains at 21 completed tracker items. N26 selection and N05 acceptance remain open.
