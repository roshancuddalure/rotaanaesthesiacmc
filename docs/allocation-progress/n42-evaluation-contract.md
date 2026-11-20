# N42 local AI evaluation: development contract

The versioned `ai-eval-v1.json` contains 24 synthetic development cases covering
departmental requests, pooled calls, OT pressure, leave explanations, six typed
numeric requests, ambiguity, invalid numbers, unsafe actions, missing facts,
privacy, injected examples and stale reference versions. It includes no actual
person, leave reason, profile comment, application credential or database data.
This is not a held-out evaluation or a ratified N06 acceptance threshold.

`tools/allocation_ai_eval.py` preflights one explicitly chosen existing local
runtime, records the installed-model digest and runtime version, and requires
the requested model to be present before inference. It calls the actual paired
companion through TestClient, retaining its prompt, schema, retries and output
grounding checks. No requests download or select a new application model, unload
another model, restart a runtime, change policy, or access the application DB.
Inference reaches only the companion's existing loopback ports. Synthetic
pairing credentials belong only to this in-process evaluation.

## Measurements and interpretation

- Exact typed intent compares expected mode and setting/value pairs. Duty
  duration is distinct from a monthly count; scope, zero, duplicates and malformed
  proposals are checked. A typed proposal is not an approved policy amendment.
- Mandatory `needs_review=true` is not abstention. A 502 grounding rejection is
  reported separately from a model clarification signal. Transport outage, 500,
  malformed input and a refusal on an ordinary supported request do not pass.
- Clarification and unsupported action-claim detection use narrow lexical
  signals. They do not establish semantic grounding, clinical accuracy or absence
  of unsupported claims. Every response still requires human semantic review.
- Latency is companion end-to-end wall time, including local model loading and
  up to two existing attempts. No requests are parallelized. Runtime residency
  before/after is not peak process RAM or peak VRAM; both peaks remain null.
- Results checkpoint after each case. `complete` means the measurement artifact
  is finalized; only `evaluation_complete` proves all declared cases were run.
  An unavailable requested model produces zero inference results, not 24 passes.

## Verified tooling and current baseline gap

`n42-evaluation-contract.xml`: **15 passed in 9.24s**, including scorer correctness
and existing companion authentication, strict response, outage and numeric
grounding checks. Scorer tests use canned responses; they are not model quality
evidence. Ruff passed. No application runtime source changed.

`n42-qwen-preflight.json`: endpoint11436 identifies Ollama0.40.16, but exposes no
installed models. Qwen's existing manifest is present under
`D:\CodexModels\DutyRota`; that does not make it available to this running
endpoint. The live endpoint belongs to a separate runtime executable, so it was
not restarted or repointed. Fresh Qwen inference is unavailable, not failed
intent accuracy. Older `docs/benchmarks/rota_local_model_selected.json` is
historical evidence and does not cover this expanded corpus.

Gemma3:4b is already installed at11434 (digest recorded by preflight). Its
development run is an additional measurement, not a fallback or selected winner.
N42 remains in progress: fresh Qwen comparison, resource measurements,
independently reviewed unseen departmental cases and N06 targets remain open.
No multi-model routing or ensemble is justified before that comparison.

## Completed development run, original companion revision

First Gemma result: `balance_weekend` returned HTTP200 with mode `repair` rather
than expected `balanced`, in 88.99 seconds. The companion reported
`grounding_check=passed`, review=true and no typed rule changes. This establishes
an intent mismatch; it also shows that passing the numerical grounding guard is
not proof of correct intent or explanation. Unrequested textual scoring advice
still requires semantic review. No corpus-wide pass rate follows from one case.

Worker session83171 exited0. The final artifact has complete/evaluation_complete/
source-unchanged true; all24 declared cases were run. Sources were rechecked
before the subsequent numeric-guard correction. The separate
`n42-gemma-residency-observation.json` is a timestamped Ollama residency snapshot,
not a measured process peak. Do not unload or restart the shared runtime.

This configuration returned22 HTTP200 responses, all mode `repair`, and2 HTTP502
guard rejections. Only4/24 passed the declared mechanical behavior checks:
two intended repair requests and two expected guard rejections. This is not4
correct model clarifications or a clinical accuracy score. Strict typed intent
(including expected mode) matched8/24; semantic explanation review remains open.
The result does not justify a model winner or ensemble, and cannot distinguish
model limitations from prompt/schema/runtime effects by itself.

Companion end-to-end case times: median30.91s, nearest-rank p95 79.14s, range
17.05–88.99s, total812.17s. Includes load/retries and uncontrolled host conditions;
it is not pure token-generation timing or a full scheduling workflow comparison.
No fresh Qwen baseline, unseen holdout or peak resource measurement exists yet.

The run also reproduced unsafe numeric extraction: negative1 became positive1
and was called grounded. The subsequent correction and bounded regression proof
are recorded in [the numeric-guard audit](n42-numeric-guard-audit.md). The completed
Gemma artifact is a **pre-fix** baseline, not a result for the corrected companion;
no full live-model improvement is claimed from mocked regression probes.
