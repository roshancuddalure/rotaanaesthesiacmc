# Isolated existing-Qwen evaluation

The unrelated runtime at11436 exposes no Qwen model. Its process/configuration
was left alone. Qwen's existing store is `D:\CodexModels\DutyRota`; the manifest
and all referenced blob sizes were checked without downloading or registering a
new model. A task-owned hidden Ollama process uses127.0.0.1:11438 with that store
and `OLLAMA_NO_CLOUD=1` in its child-process environment only.

The companion/evaluator now permit11438 alongside existing11434/11436. The
allowlist remains fixed; defaults are unchanged, the host is always127.0.0.1,
port coercion is rejected, and API callers cannot supply endpoints or ports.
`n42-owned-runtime-contract.xml`: **67passed15.50s** (includes the previous57,
not67 additional unique checks). Covers three allowed ports, rejected ports and
types, pairing/origin checks, endpoint injection and numeric/scorer regressions.
Ruff passed. This is a local transport option, not a selected application model.

## Identity and readiness

`n42-owned-qwen-process.json` records PID42700, start identity, executable/store,
port and expected manifest digest. The first listener check occurred before
startup was ready and failed. The evaluator then finalized
`n42-qwen-owned-development.json` with evaluation_complete=false/zero responses;
retain that preflight, not a failed-quality score. No model requests occurred.

The same process remained alive; it was not restarted for the observation
timeout. After GPU discovery, ownership/start identity and installed Qwen digest
were verified, recorded in `n42-owned-qwen-identity.json`. Manifest digest:
`65ec06548149b04c096a120e4a6da9d4017ea809c91734ea5631e89f96ddc57b`.
The corrected evaluation writes `n42-qwen-owned-verified.json/log`. Complete
inference must be established from its terminal process and24 finalized cases.

## Resource observations

`tools/sample_owned_ollama.ps1` verifies root process start and listener ownership,
then samples only that runtime's current descendant tree. It writes working-set
sums and Ollama-reported resident model VRAM allocations, with timestamps, actual
elapsed time, process IDs, snapshot completeness and observation errors.

`n42-resource-sampler-smoke.json` completed one pre-inference sample successfully.
The live run writes `n42-qwen-owned-resources.json/log`, stops on the dedicated
marker, root exit/identity change or its30-minute observation budget, and never
stops or modifies a process. Requested cadence2s is not guaranteed; use actual
timestamps. Sampling itself adds host overhead.

These are **sampled maxima**, not continuous peaks. Working-set sums can include
shared pages and exclude the Python evaluation client; reported VRAM is runtime
allocation, not an independently observed physical GPU peak. No absolute peak or
cross-model memory/speed advantage should be inferred. True resource admission,
unseen human-reviewed evaluation and ratified N06 thresholds remain open.

## Handoff and cleanup

Evaluation session27320/Python5984, resource sampler88249, owned runtime42700.
Revalidate these handles and identity before any reuse. Stop sampling only after
evaluation is terminal; preserve results and source hashes. Then unload only the
owned model on the verified11438 endpoint, and stop only the matching owned
runtime PID/start identity. Verify that11438 has no listener. Do not unload or
restart shared11434/11436. A live runtime is not proof of an evaluation worker.

## Final verified results

Evaluation27320 exited0;24 cases, complete/evaluation_complete/source-unchanged
true. All recorded source hashes, including the numeric parser, were rechecked
before the subsequent claim-guard edit.
**13/24 mechanical behavior passes** comprise six HTTP200 behavior passes
(including the injected-example case) and seven expected guard rejections. Nine total guard rejections also include
two failures to interpret supported requests. Strict typed-intent signals match
10/24, but cases with no expected mode are not a useful independent accuracy
denominator. Human semantic review and an unseen holdout remain required.

Case latency median5.94s, nearest-rank p95 9.59s, sum164.95s. These measurements
include companion retries/model loading but exclude starting the owned server.
They are not an apples-to-apples performance comparison with the pre-fix Gemma
run, which used a different guard, model and runtime configuration. No model
winner, ensemble benefit or scheduling-workflow GPU advantage is established.

Semantic inspection found further concrete defects: bypass-leave output proposed
`skip_leave_check`/`skip_rest_check`; bypass-lock output claimed changes could be
executed immediately without policy review. Both returned review=true and
grounding_check=passed. No assignment/policy was executed; the assistant has no
such authority. This demonstrates that numerical grounding and a review flag
do not ground prose permission claims. The next N44 work must reject unrequested
bypass instructions and contradictory authority claims before exposing them as
grounded advice; inspect unsupported privacy explanations too.

Sampler88249 exited0 after the explicit stop marker,60 samples. Sampled maximum
runtime-tree working set731,299,840 bytes; sampled maximum runtime-reported
VRAM1,169,382,440 bytes. One observation error and one incomplete process-tree
snapshot are retained, not treated as zero use. These maxima are lower-bound
observations with the limits above; true continuous peaks/admission remain open.

After terminal evaluation/sampling, cleanup81125 exited0: verified owned PID/start
and listener identity, unloaded only Qwen from11438, confirmed no resident model,
then stopped only owned server42700. `n42-owned-qwen-cleanup.json` records this.
Port closure and the original shared runtime identities must be checked at the
final checkpoint; no old live handles should be mistaken for active workers.
