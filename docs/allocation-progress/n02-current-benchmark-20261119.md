# N02 current synthetic baseline - 19 November 2026

Fresh existing96member/62slotMay2026 benchmark completed nativeexec97330exit0. DisposableSQLite only. Source/hardware/flags manifest n02-current-source-20261119.json; relevant hashes rechecked unchanged after completion. Python3.11.9/Windows10/i7-10750H6physical12logicalcores. OT integration disabled; noGPU used. Source output n02-current-benchmark-20261119.json.

| Measure | Greedy | Whole-month CPU |
|---|---:|---:|
| Covered duties |62/62|62/62|
| Uncovered |0|0|
| Maximum duties per assigned person |1|1|
| Maximum weekend duties per assigned person |1|1|
| Measured planning wall seconds |25.77371|53.08591|
| Operational assignment writes in disposable fixture |62|0|
| Result |greedy|optimal within modeled candidate set/objective tiers|

Both schedules use62distinctpeople, so34of96 have zero newduties in this deliberatelyoversupplied fixture. This is expected integer rounding, not evidence that everyone received equal nonzero work. The existing wholemonth validate_plan asserted no violations, and optimizer saved no assignments. No holiday dates configured: holiday balancing was not evaluated. Wholemonth53.09s includes candidate/context preparation plus the bounded search, so the30s solver budget is not a totalrequestdeadline.

Wholemonth is slower than greedy in this single run. Do not infer speedup, general regression relative to the historical5.765/12.338s run, or departmental correction rates: host load, power and thermal state were uncontrolled and source changed across historical runs. Candidate membership/CP-SAT proof scope is narrower than universal schedule optimality. No OT-enabled feasibility/performance, GPU timing, saved-proposal correction count or operationalpilot certification is provided by this fixture.

N02 remains Inprogress. Next add/currently measure reproducible real-shaped OTon/off scarcity/datedleave/fixedcommitment/correction scenarios, stage-level timings, all-person workload denominators and failures, with exact source/configuration and verified saved-proposal replay. Existing150member/exactfairness/OTedge/transaction test evidence is retained separately; do not sum overlapping counts or treat past results as fresh benchmark measurements. N05objectiveworkedexamples/N06ratification depend on this fullerbaseline. No runtime/schema/operationaldata/deployment/cloud/model/policychanges.
