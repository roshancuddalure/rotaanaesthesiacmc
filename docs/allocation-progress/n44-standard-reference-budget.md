# Standard reference prompt admission and Qwen protocol — 20 November 2026

The standard versioned Assistant context now uses the same measured admission and completion checks as selected OT context. Every browser-supported reference contract (1 and2) verifies runtime/model identity, disables truncation/shifting, measures a full prompt with one discarded token, reserves600output+32guard within4096, and rejects changed/incomplete completion counters. Existing numerical/action/schema checks remain authoritative for suggestions; no policy or allocation can be applied by a model.

Helpers and errors now refer to a reference rather than assuming OT was selected. Empty/unversioned legacy companion inputs retain their explicitly unversioned behavior; they are not the application's authenticated source contracts and are not certified by this admission path. Runtime0.40.16 and the existing two model digests remain the verified compatibility set. Another runtime/model requires verification, not a download or cloud fallback.

## Verification

`n44-standard-budget.xml`:**119passed83.66s**, native26319EXIT0, no failures/errors/skips. Four new real-companion contract1 cases prove rejection of unverified runtime, over-budget prompt, boolean token count and a changed completion count. They verify exact network-call bounds; invalid pre-probe references still make no model calls. The set includes preceding selected-OT/privacy/numeric/claim/schema/evaluation regressions and overlaps older counts. Ruff/scoped whitespace passed; existing LF/CRLF warning remains. No frontend source changed or browser/build gate claimed in this backend batch.

`n44-qwen-standard-live.json`:complete/source_unchanged, native56510EXIT0, actual in-process companion and isolated existing Qwen2.5:1.5b at127.0.0.1:11438. Each request uses synthetic minimized facts only. Model digest and all existing manifest blob sizes were verified; cloud disabled in the child environment, parent environment restored. No registration/download or shared runtime modification.

| Case | Probe tokens | Suggestion | Observed outcome |
|---|---:|---|---|
| Standard contract1 |521prompt/1generated|521prompt,119output,520cached|HTTP200, stop, review required|
| Selected OT contract2 |910prompt/1generated|910prompt,104output,909cached|HTTP200, stop, review required|
| Oversized selected OT |3705prompt/1generated|No600-token suggestion requested|HTTP502 budget guidance;3705+600+32>4096|

All probe/suggestion requests used no-truncate/no-shift. The harness preserves complete messages/schema and asserts matching prompt counts and reserved budget. It can record an explicit runtime over-context error without treating an outage as successful budget refusal; this run obtained measured counts in all three probes. These are protocol/counter/schema observations, not an unseen semantic evaluation, correction-rate proof or model-selection comparison. Single-run wall times38.15/5.50/10.38s mix cold/warm conditions and are not a speedup claim.

## Sampled resources and cleanup

`n44-standard-resource.json`:50owned-process-tree samples from05:23:55Z to05:26:26Z, requested2s interval, actual timestamps retained. Maximum sampled working-set sum690909184bytes; maximum Ollama-reported VRAM allocation1169382440bytes;0runtime observation errors. The sampler excludes the evaluation client, can count shared pages more than once, and observes snapshots rather than continuous physical peaks. These values are not minimum hardware requirements, precise unique RAM or guaranteed resource admission. Inspect per-sample completeness before extrapolating.

Owned runtime PID28008 was checked by start/listener identity, model explicitly unloaded, resident count0, process stopped and11438verified closed (`n44-standard-runtime-cleanup.json`). Sampler19894 stopped via its explicit marker after the probe; cleanup29599 and all test/probe handles are terminal. The graphical progress service remains a viewer only.

Current source hashes and the live run's source window were independently verified. Previous Gemma evidence remains at its recorded version; no fresh Gemma standard-context quality comparison is implied. There is no new model endpoint, clinical priority, schema, deployment or operational data write.

N44/N42 remain In progress. Next freeze a synthetic post-change development evaluation with versioned references and run both existing models against the same final configuration, keeping held-out departmental/pilot authority separate. Broader paraphrase/invented-fact semantics, overall request deadlines/circuit breakers, memory admission and N06/N50 acceptance remain open. Preserve all50items; protocol correctness alone does not establish allocation perfection.

Subsequent deadline evidence: `n44-shared-deadline.md` verifies a single90-second companion admission/result budget and independent measurement of changed correction prompts. Hard worker cancellation, full operation recovery/circuit breakers and memory admission remain open; this does not retrospectively rerun the Qwen observations above.
