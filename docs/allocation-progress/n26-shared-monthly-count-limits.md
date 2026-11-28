# Shared monthly quota constraints and configured month comparison

The production optimizer and architecture experiment now call `allocation_count_constraints.add_monthly_count_limits`. The original predicate and constraint statements moved verbatim from `rota_optimizer.py`; the helper adds only constraint-count metadata. It enforces the configured monthly 24-hour, weekend 24-hour, same-group and same-campus limits using the caller's active monthly saved assignments.

A saved November duty reduces that person's remaining quota. Nearby October and December duties remain safety commitments and do not consume November totals. If a saved category already exceeds its configured quota, the existing formula allows zero additional duties in that category; it does not invalidate the saved record or authorize more exceptions. Duties with no campus retain the existing campus-count behavior. No clinical rule, objective order or optimizer revision changed.

The experiment's previous unlimited-count assertion is removed. Its `--count-limited` fixture explicitly configures three 24-hour duties, one weekend 24-hour duty, three same-group duties and three same-campus duties per person. Both units use the synthetic MAIN campus so every limit is exercised. All 30 logical November requirements remain visible. Three saved October/November/December commitments are preserved, and the full shared balanced objective tiers are available.

The seven independent quota tests enumerate 112 selected-duty subsets with explicit category facts. They cover unlimited and zero quotas, exhausted and already-excessive saved baselines, multiple duty types in one group, multiple campuses and a missing campus, plus intersecting limits. They compare CP feasibility against direct arithmetic without using canonical group/campus classification helpers to calculate expected results.

A real month regression uses the canonical candidates, coupled OT model and final validator. Eight people capped at three duties give an independent upper bound of 24 covered duties, including the saved November duty. It checks 23 new choices, three duties for each member, at most one weekend duty per member, all 32 modeled per-person quota constraints, and exact preservation of the three saved assignments.

The baseline `n26-count-constraints-before.xml` recorded 17 production tests passing in 28.67 seconds. The initial extraction gate passed 71 tests in 51.48 seconds; the later gate adds explicit configured-month coverage and exercises a populated campus. Earlier gate totals overlap. The before-file archive and `n26-count-extraction.json` preserve structural extraction provenance; behavioral results and final source hashes are recorded separately.

The complete month comparison reports each objective proof in its search scope. A proof for one fixed repair layout does not establish the best value across every possible unit layout. All later tiers remain conditional on values fixed for earlier tiers. The logical-coverage upper bound based only on candidate presence can be loose under quotas; the independent 24-duty quota bound is the relevant coverage certificate for this fixture.

N26 still needs representative scenarios, complete acceptance criteria and architecture selection. N05 retains its baseline and policy acceptance dependencies. This implementation keeps the existing framework and shared canonical checks; it does not complete the original 50-item goal or authorize production deployment.

Final verification: `n26-count-constraints-verified.xml`, native session 60015 exit zero, records **72 passed**, with no failures/errors/skips. Recorded wall time is 2070.52 seconds; the cause of that long elapsed interval is unestablished and it must not be treated as calibrated solver timing. Scoped Ruff and whitespace checks passed, with existing LF/CRLF warnings. All 177 captured final source hashes were independently rechecked unchanged.

The full month artifact, `n26-count-limited-month-final.json`, native session 34974 exit zero, is complete with 175 recorded source hashes unchanged. Both methods covered **24 of 30 required duties**, comprising 23 new choices plus one fixed November duty. Each of the eight members has three November duties; all three saved signatures remained unchanged. Both methods modeled 32 quota constraints and passed the canonical final validator. The six remaining duties are mathematically unavoidable under the configured total quota and remain visible.

| Method | Method wall seconds | Calls | Weekend score | Spacing/history score | Proof status |
|---|---:|---:|---:|---:|---|
| Joint | 8.04 | 1 | 6 | 66 | All nine modeled tiers proved in the joint model |
| Repair | 30.14 | 10 | 21 | 74 | Spacing/history unproved; preferences unreached; other receipts apply to the chosen fixed layout |

The 30-second allowance recorded no joint overrun and a 0.14-second repair overrun. Every reached objective receipt agrees with the shared scorer. Sampled whole-process working sets peaked at observed values 167,608,320 bytes/69 observations for joint and 183,767,040 bytes/255 observations for repair, with no sampler errors. Sampling requested 100 ms intervals and retains actual offsets. These observations include native solver, common fixture and retained allocations; they are not continuous peaks, isolated incremental memory or minimum hardware requirements. Sequential method order, shared caches and uncontrolled machine activity prevent causal performance claims.

The preliminary month artifact used units without campus values; its 24 constraints exercised the other three categories. It is retained separately. The final populated-campus run and configured-month regression exercise all four categories. `n26-count-constraints-final-source.json` retains final source/evidence provenance, and `n26-count-extraction.json` identifies the moved canonical statements.
