# Measured selected-OT prompt admission — 20 November 2026

Selected OT context now uses measured token admission under the existing4096-token context and600-token response configuration. It no longer treats the12-band/12000-character payload bounds as proof that a complete prompt fits. Browser activation remains disconnected pending explicit selection/citation/freshness work.

## Runtime contract and data routing

`local_ai_prompt_budget.py` verifies runtime0.40.16 and installed model inventory before sending OT facts for inference. Only the previously present Gemma3:4b and Qwen2.5:1.5b manifest digests are recognized; changed/missing/remote-tagged models fail before the prompt probe. This is a compatibility allowlist of existing local models, not a new model selection, download or ensemble. Unknown runtime versions require verification rather than guessing flag/counter semantics.

The request sets `truncate:false` and `shift:false`. A copy of the exact messages/schema/configuration requests one discarded token, obtains full `prompt_eval_count`, and admits the600-token suggestion only when prompt+600+32guard <=4096. The probe is real local inference, not a zero-cost tokenizer API or zero model calls on over-budget input. Neither source bands nor instructions are shortened. Completion must report the same prompt count, a valid bounded output count, done=true and stop rather than a length cutoff before output is exposed. Existing numerical/action/schema checks still govern the suggestion.

Published implementation reviewed at the installed version: [API types](https://github.com/ollama/ollama/blob/v0.40.16/api/types.go), [prompt rendering](https://github.com/ollama/ollama/blob/v0.40.16/server/prompt.go), [request handling](https://github.com/ollama/ollama/blob/v0.40.16/server/routes.go), and [cached plus newly evaluated token accounting](https://github.com/ollama/ollama/blob/v0.40.16/llm/llama_server.go). Semantics are pinned to this version and corroborated by the actual cached-prompt observation below, not claimed for another runtime/backend.

The new budget path applies to selected-OT contract2. Contract1/legacy requests retain their current behavior and latency; extending admission and broader model/runtime verification remain N42/N44 work. Hashes/local inventory are not signatures or protection against a malicious runtime. Source reads are not atomic leases on later calendar/model changes; browser freshness checks remain necessary.

## Actual verification

- `n44-prompt-budget-verified.xml`: **115passed46.72s**, native51861EXIT0. Exact3464-token boundary; over-budget/missing/fractional/boolean counters; unverified runtimes; changed/remote models before prompts; incomplete/different-count completions; source/privacy/authority and existing pairing/numeric/claim/evaluation guards. Earlier110/111 runs overlap, not additional independent samples.
- `n44-prompt-budget-local-model.json`: complete/source_unchanged, native3671EXIT0. Task-owned hidden Ollama49168 at127.0.0.1:11438, cloud disabled, existing Gemma manifest/blob sizes/digest checked. No model registration/download or shared runtime restart/unload.
- Small synthetic reference: probe972prompt tokens/1generated; full suggestion972prompt tokens/53generated, stop, HTTP200/review required. Full run reports967cached prompt tokens while total remains972, corroborating cache-inclusive counting.
- Oversized synthetic12-band request with multibyte text: probe3854prompt tokens/1generated;3854+600+32 exceeds4096, so HTTP502 and **no600-token suggestion call**. No data dropped to fit. This tests actual request formatting rather than a character/token estimate.
- Two preceding live runs are retained: first demonstrated behavior; second added assertions and removed an unused import caught by Ruff. Final run includes local-model inventory verification. Runs overlap; no independent quality/throughput claim.
- Live-artifact and seven-file checkpoint hashes independently rechecked. Ruff/scoped whitespace passed; existing LF/CRLF warnings remain. No frontend build/browser, PostgreSQL, peak memory, clinical accuracy or unseen-model evaluation claim.

## Cleanup, limits and next action

Owned model explicitly unloaded, resident count0, process start/listener identity checked, PID49168 stopped and port11438 closed (`n44-budget-runtime-cleanup.json`). Test/probe handles52802/50316/90103/45615/51861/3671 terminal. No implementation/model/test worker remains intended live; dashboard5201 is a viewer.

The probe adds local work and may load the existing model at unchanged context size; it is not peak RAM/VRAM admission or a latency improvement. Each HTTP call retains its timeout; overall stage deadlines/circuit breakers remain N43/N45. Qwen's digest is recognized but this live protocol path was verified only on Gemma; no winner or broad certification implied.

N44 remains In progress. Next integrate explicit browser opt-in to contract2 with selected unit/date, third-source version, refetch after inference/before use, reset on selection changes/close, permission/error recovery and responsive/race acceptance. Keep factual availability questions separate from mode suggestions. No operational assignments, policy authority, feature default, schema, deployment or cloud route changed.

Subsequent evidence: `n44-ot-browser-optin.md` verifies the explicit browser flow and consent/freshness handling. `n44-standard-reference-budget.md` extends admission to contract1 and records119regressions plus actual Qwen standard/OT/oversized protocol checks and scoped resource observations. The earlier contract1/Qwen gaps above describe this report's original checkpoint; they are no longer proposed work. Broader semantic/resource/deadline acceptance remains open.
