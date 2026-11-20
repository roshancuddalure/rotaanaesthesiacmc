# N05 preparation: current objective order and denominator review

Source inspection:19November2026. This is preparatory analysis, not N05 completion or approval of new fairness policy. N02 broader baseline is still in progress.

Current rota_optimizer.solve_month uses lexicographic tiers: required coverage, total coverage, changed originals (repair only), preference cost first only in explicit preferences mode, call-level equality, weekend burden, night burden, holiday burden, opportunity-normalized workload, spacing/history, then preference cost if not already prioritized. Hard eligibility/leave/rest/locked-unit scope/OT reservation feasibility is validated separately and cannot become a weighted soft reward. Existing exception workflows retain separate authority. A feasible time-limited result is not an optimality proof for all tiers.

Source fairness calculation: context_targets -> fairness_targets.target_by_level supplies one target per call level. Pool demand splits in proportion to eligible monthly member counts; no member outside the explicitly defined pool becomes eligible. Optimizer incremental equality cost is round((2*(baseline+n)-1-2*level_target)*100). Later burden costs normalize compatible candidate opportunities. Fixed duties contribute baseline load. Zero-capacity people cannot receive duties merely to improve a fairness score.

Current balance contract docs/call_level_pool_and_balance_contract.md amends the older strict-single-level contract. Its section2 defines per-person pro-rata share = slots(level)*available_days_i/sum(available_days), with goal round(share_i). This is an implementation distinction requiring explicit reconciliation before objective tuning: normal optimizer equality currently consumes uniform per-level targets, whereas Balance duties computes personal pro-rata goals. Later opportunity-normalized burden does not establish equivalence to a higher-priority personal-share equality tier. Do not silently change reporting denominators or claim these two mechanisms implement the same objective.

Worked reference examples to implement/verify in N05:
-8duties/4equal-full-capacitypeople ->2each; with2fixed ononeperson,onlyothersreceive remaining work. Existing exact optimizer oracle covers this.
-Oneperson fully unavailable ->0assignments for that person; compatible remainingpeople cover feasible demand. Approved leave remains a hard block, not a penalty.
-8duties, available-day weights31/31/31/15 ->shares approximately2.2963/2.2963/2.2963/1.1111. Raw independent rounding gives2/2/2/1 (sum7), so final feasibility/coverage and remainder treatment must be explained; never promise all rounded goals exactly if their sum differs from requiredduties. Existing allowed-gap contract remains in force unless amended.
-Pool of30seniorlevelA+10levelB:one poolslot contributes0.75/0.25demand; this changes fairness demand allocation, not the fact that any eligible person in the explicit pool can cover the duty once.
-No eligible poolmembers ->configuration/coverage issue and unknown/infeasible staffing evidence; an even reporting split does not create real candidate people.
-OTpressure onThursday can reduce compatible duty opportunities that day. Later compensation cannot override datedeligibility/rest/skills/locks or approved leave. Coverage/OTsafety are not traded for lower raw spread.
-Preference mode deliberately puts authorized explicit preference ahead of equality; default balanced/repair mode does not. Any proposed reordering needs authority, not learned-model consensus.

Next: tie these examples to current-source oracle outputs, describe all rounding/zero-capacity/datedpromotion/pooledlevel cases, and record the objective contract under N05 after baseline readiness. N06 acceptance thresholds and sign-off remain separate. No runtime change or unapproved domain-policy amendment is made by this note.
