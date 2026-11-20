# Selected OT source contract — 20 November 2026

This batch adds a bounded, administrator-only advisory source contract and a compatible local-companion parser. The browser is not connected to this new contract yet. The existing recorded-demand inspector remains read-only and continues to state that its facts are not sent to a model.

## Authority and scope

`GET /api/v1/rota-intelligence/assistant-context/ot?month=YYYY-MM&unit_id=UUID&day=YYYY-MM-DD` requires the same administrator dependency as the OT calendar, plus both planning and OT feature gates. The date must be in the requested month. Canonical `ot_demand_reference` resolves saved weekday/date exceptions and missing definitions; the new endpoint does not accept client-supplied demand counts.

Contract2 contains the existing minimized rule constraints and approved teaching features, plus an explicit selected-unit/day demand projection. Its third source digest covers both exact typed demand content and the calendar revision. Refreshing the date or calendar therefore changes the reference even if other rules/teaching are unchanged. Retrieval is a snapshot, not an atomic lease or guarantee that later data has not changed. Browser rechecks before/after inference and before use still need to be integrated for this third source.

Area/band labels, source notes, history text, people, leave reasons, profile comments, skill identifiers and qualification bindings remain excluded. Minimum and target stay distinct. Unknown/partial demand stays unknown; no band summation is claimed to count simultaneous or unique people. Demand definitions do not prove available staffing, reserve minima or allocation validity.

The model context supports at most12 bands and12000 serialized characters; it rejects rather than truncates larger selected days. The existing human inspector retains its64-band bound. These are payload bounds, not a measured tokenizer/resource-admission proof for every installed model. Model token/resource admission remains an open N42/N44 gate before browser activation. No model context size, endpoint, installed model or runtime default changed.

## Companion boundary

`local_ai_ot_reference.py` validates exact recognized fields, UUID/month/date, calendar revision, sequential band indices, integer counts, minimum/target relation, known call pools and bounded same-day/overnight intervals. Unknown fields and malformed types reject before inference even when a client recomputes the content hash. The existing source-contract1 path stays supported and strips unsupported extra fields. Contract2 requires all three unique matching content references; a missing or tampered source fails.

The companion receives only a reconstructed typed projection plus its own fixed interpretation limits. Supplied free-text metadata cannot become model instructions. Content hashes are not authentication: the authorized backend route provides source provenance in the application; an arbitrary loopback client can invent its own data/hash. The companion does not turn such supplied data into authority to assign, change a policy or apply a rota.

The current companion still proposes planning modes rather than factual OT or person-availability answers. A factual OT lookup with selected demand returns specific inspector guidance without falsely saying no demand reference exists. Personal-availability questions remain guarded. Numeric-policy and unsupported-action checks remain separate and unchanged in authority.

The base assistant-context endpoint now reads effective rules without first-read initialization writes; when none are saved it uses the same default rule schema. A reference GET does not create rules, proposals or assignments. No alternate leave/profile database or permissions were added.

## Verification and next work

Initial focused gate `n44-ot-context.xml`:45passed129.84s(native44468EXIT0). Later source-version/lookup-guidance refinements are covered by the final regression recorded separately; do not count the initial45 and overlapping final set as independent tests. All model transport is mocked; this is contract integration evidence, not a fresh model accuracy or latency evaluation.

Final gate `n44-ot-context-final.xml`:**101passed170.62s**, native69690EXIT0, no failures/errors/skips. Includes selected-context API/authority/privacy/version/tamper cases, existing source contracts/OT reference, companion pairing/schema/claims/numeric policy and local evaluation scoring. Ruff/scoped whitespace passed. No application UI changed, so no new frontend build or browser acceptance is claimed. Native44468/69690 are terminal; no model runtime or implementation/test worker remains intended live. The optional source/diff collection native50410 also exited0.

Final source hashes are in `n44-ot-context-source.json`; verify them after the final test handle terminates. The local evaluation manifest includes the new parser so later actual model runs identify this input transformation. Historical Qwen/Gemma runs remain at their recorded older contracts and are not retrospectively certified.

N44 remains In progress. Next: conservative complete-prompt/token admission for the existing model configuration, then explicit browser selection/third-source citation and stale-source checks (unit/date changes, refresh, close and races), followed by responsive/browser acceptance and unseen model evaluation. Do not silently append OT facts to the existing browser request or label current fixture tests as N44 completion.

Rollback the explicit endpoint/composite helper and contract2 parser branch only, preserving contract1, the OT inspector and unrelated edits. No schema, operational migration, deployment, new cloud route/model download or operational write occurred.

Subsequent gate: selected-OT prompt admission is verified in `n44-prompt-budget.md` (115tests and real owned-runtime small/oversized probes). It measures rendered prompt tokens, reserves existing output budget, checks version/model identity and disables truncation/shifting. Payload bounds remain separate. Browser integration/freshness, wider resource/model evaluation and contract1 admission remain open.
