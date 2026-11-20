# Assistant authority claims: bounded correction

The completed existing-Qwen development run returned misleading advice for two
unsafe requests: proposed rules included `skip_leave_check`/`skip_rest_check`,
and a published-rota request was described as executable immediately without
policy review. Both returned `needs_review=true` and `grounding_check=passed`.
The companion performed no application action, but those prose claims were wrong.

`tools/local_ai_claim_guard.py` now rejects proposed execution/bypass actions,
claims that policy review is unnecessary, immediate/automatic execution claims,
and bounded claims of completed execution or guaranteed validity. It preserves
safe advice such as “do not assign without review” and “no policy has been
applied.” Normalization covers underscored action names from the actual response.
The existing two-attempt correction path asks for safe clarification; repeated
unsafe claims return the existing502 grounding error and regular planning remains
available. No authority is granted by the guard.

The companion's pairing/origin boundary, fixed loopback transports, typed numeric
grounding, mandatory review and no-apply behavior remain in force. No application
rule, scheduling objective, permission, data schema or model selection changed.

## Evidence

- `n44-claim-guard.xml`:79passed31.27s, initial bounded integration suite.
- `n44-claim-guard-final.xml`:81passed38.28s, includes two additional negation
  controls; these totals overlap, not160 independent tests. Covers recorded
  unsafe responses, safe warnings, auth/ports/numeric parsing and evaluation.
- `tools/replay_ai_authority_claims.py` replays exact saved model content through
  the actual companion with transport mocked, preserving original instructions.
  Both unsafe saved replies return502; ordinary balance and repair controls
  remain200. This is not new inference or post-fix live-model accuracy.
- `n44-saved-claims-replay-verified.json` is the final replay artifact; verify its
  complete/source-unchanged flags passed, session84352 exited0, and all hashes
  were independently rechecked. Initial
  `n44-saved-claims-replay.json` is retained separately. Ruff passed.
- `n44-claim-source.json` records the final implementation hashes; scoped
  whitespace checks passed. The isolated Qwen runtime was unloaded/stopped by
  verified PID/start identity after inference, and port11438 has no listener.
  Shared11434/11436 retain their original PID identities.

## Limits and remaining N44 work

These are bounded lexical checks for reproduced defects, not general semantic
grounding. Different phrasing can escape detection; conservative rejection can
require manual review. Neither `grounding_check=passed` nor a review flag proves
correct intent, current policy citations, factual privacy explanations, or safe
rota feasibility. A future structured explanation/source contract and broader
adversarial cases must address those claims, rather than increasing reliance on
prose heuristics alone.

N44 is in progress; current source/version citations, stale/unknown-context
handling, minimized authorized input and broad injection/claim evidence remain.
N42 also remains in progress for comparable post-fix model runs, unseen human
evaluation and resource admission. Do not select an ensemble or claim perfect
adjustments from these checks. Rollback removes the claim-guard import/call and
retry guidance; no operational data migration is involved.
