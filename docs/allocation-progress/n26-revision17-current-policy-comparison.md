# N26 current enhanced-objective comparison

2026-11-26T01:09:52.836992+00:00

The earlier legacy-objective 24-versus-22 run is retained separately. These three runs explicitly enable the current 13 balanced objective tiers and normalize 60 physical unit alternatives to 30 logical requirements. Main application/test source hashes still match the completed 2456-case backend audit. Six focused harness tests passed, including independent arithmetic in both fairness policies.

| Run | Method | Safe coverage / 30 | Method seconds | Overrun seconds | Proven tiers |
|---|---|---:|---:|---:|---:|
| equal-forward | joint | 24 / 30 | 27.63 | 0.00 | 7 |
| equal-forward | repair | 23 / 30 | 30.19 | 0.19 | 1 |
| equal-reverse | repair | 22 / 30 | 30.80 | 0.80 | 1 |
| equal-reverse | joint | 24 / 30 | 27.35 | 0.00 | 7 |
| availability-forward | joint | 24 / 30 | 10.77 | 0.00 | 1 |
| availability-forward | repair | 23 / 30 | 30.53 | 0.53 | 1 |

All returned plans passed canonical final checks, with no assignment writes. Both equal-count joint runs reach three duties per doctor and a zero raw count gap within both call-level groups. Under this fixture's explicit all-24-hour/no-exception assumptions, eight people times the hard three-duty monthly limit is an independent ceiling of 24. The six uncovered requirements therefore do not authorize a safety override. This is a synthetic scarcity case, separate from November's 840/840 projection.

The two equal-count joint runs prove the first seven modeled tiers; later weekend/night/holiday/workload/history/preferences tiers remain unproven. Availability joint proves required coverage, not its remaining fairness tiers. Repair proofs concern each final fixed unit layout; they are not global unit/person proofs.

Shared setup is outside the 30-second per-method allowance (recorded separately); actual overrun remains explicit. Whole-process sampled RSS includes fixtures and retained allocations and is not isolated method peak memory. Fixtures use newly generated UUIDs across runs, so forward/reverse results are semantically comparable observations, not a controlled causal test of execution order, deterministic schedule identity, statistical speedup or production p95.

Maintenance: joint modeling reuses canonical candidates, count constraints, OT reservations and objective builders, while needing a canonical logical-requirement and unit-choice interface. Repair reuses the same person model but adds neighbor selection, repeated solver calls, plateau handling and incumbent/proof bookkeeping. Neither experimental orchestration is activated in production. The current evidence favors further development of joint choices; architecture selection and N27 activation remain gated by the original N05/N06 and representative-corpus requirements.

No acceptance threshold, application behavior, deployment, cloud route or clinical policy changed. Original 50-item scope remains 21 Done.

Evidence: n26-revision17-enhanced-objectives-batch-status.json and the three named JSON/log pairs.
