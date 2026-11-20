# N42: frozen versioned-reference development comparison

20 November 2026. N42 remains In progress. No model selected.

Both installed models completed the same 28 synthetic development cases under identical recorded companion sources, the 90-second request budget, measured prompt admission, and fresh correction receipts. Corpus `ai-eval-v2.json` SHA-256: `36cf82514c76afba2dc3543d92b268a524a14cefc29119904329313f6e67779e`. The contract and expected behavior were frozen before inference in `n42-v2-study-contract.md`. These are development cases, not an unseen human acceptance set.

| Observation | Qwen2.5 1.5b | Gemma3 4b |
|---|---:|---:|
| Supported mode and typed-change matches | 7/15 | 3/15 |
| Negative mechanical behavior matches | 11/13 | 9/13 |
| Numeric field matches, ignoring mode | 4/6 | 5/6 |
| HTTP 200 / 502 / 504 | 15 / 13 / 0 | 17 / 10 / 1 |
| Probe / suggestion requests | 33 / 33 | 30 / 30 |
| Median elapsed, all cases | 5.57 seconds | 23.40 seconds |
| Nearest-rank p95, all cases | 10.07 seconds | 86.34 seconds |

`n42-v2-comparison.json` separates these counts. The summary script validates complete case identity, frozen corpus hash, identical historical source maps, and replayed scorer results. Five cases made no model protocol calls in either run; deterministic application refusals must not be credited as model reasoning. Mechanical success does not validate explanation truth or free-form proposed rules. The timings include refusals, admission overhead and retries; sequential runs, different sizes/quantization and uncontrolled cold/warm state prevent causal performance claims.

The Qwen bypass-leave case returned HTTP 200 with review required, but claimed checks could be nullified. Ambiguous-adjustment and personal-request responses also demonstrate unsupported policy-text risk. Review flags did not prevent these misleading explanations. Preserve both original reports; neither is acceptance evidence for the subsequently changed guard revision.

Qwen resource sampling completed with 121 observations, one observation error and no incomplete process trees: maximum observed summed process working set 721,195,008 bytes and reported VRAM 1,169,382,440 bytes. Gemma sampling terminated with a Windows file-sharing write error: the partial file records maxima of 2,479,177,728 and 1,606,177,259 bytes respectively, but **does not cover the full run**. No comparable full-run resource conclusion is available. Samples are not continuous physical peaks, unique RAM, or client-inclusive system requirements.

Both owned runtimes were unloaded, checked empty, stopped, and port 11438 was verified closed; see the two cleanup JSON files. Shared services were untouched. No model downloads, cloud routing or operational allocation writes occurred.

Next: verify post-fix model behavior in a separately labeled study, address unsupported semantic policy claims, obtain an independently authored human holdout and ratified N06/P9 targets, and collect reliable resource traces. Do not tune acceptance thresholds from these results or mark N42 complete.
