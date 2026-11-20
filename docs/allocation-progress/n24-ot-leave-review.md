# N24 proposed-leave OT impact reviews

This is an implementation checkpoint, not N24 completion. The full 50-item goal remains active at 19 completed items.

## Behavior

`LeaveProjection` contains immutable scheduling values, without notes, raw names or an ORM relationship. Explicit identities replace only their matching saved leave records in canonical OT availability. Other records survive. A proposal can change a request's person, dates, session or status, or introduce a new identity. Cancellation and rejection remove the selected record's block in the hypothetical context without changing its saved status. Pending requests block only in explicit stress mode.

`leave_ot_impact.compare_month` reuses the existing all-unit monthly assignment guard, including shared identities, reviewed qualification bindings, staffing reserves, preceding overnight requirements and month-end rest. Saved duties remain in both scenarios. It compares current approved-leave availability against specified replacements and reports coverage, requirement eligibility and shortages. It does not independently sum unit headcounts or generate a replacement rota.

The `changed` field refers to canonical leave availability, not a promise that coverage changed. A proposed leave interval can overlap an existing duty/rest block and leave coverage unchanged. The comparison avoids treating interchangeable solver witnesses as deterministic leave effects. Missing rules, incomplete calendars, resource limits and uncertain solver results remain explicitly unknown.

`review_impacts` connects this evidence to monthly pending-request approval and manual/profile record reviews. Monthly approval projects its selected pending records as approved. Manual reviews project their proposed values and include former dates when determining affected months. Review tokens include the canonical scheduling snapshot digest, which captures OT calendar changes without including solver timing or witness choices. This invalidation supplements the existing duty-impact and operational fingerprints.

The existing OT feature flag remains authoritative. When disabled, reviews explicitly say OT impact was not evaluated. No calendar, rule or model is initialized by this review path. More than four affected months returns an explicit unevaluated result rather than a partial proof. Each solver comparison has a one-second budget; this is not a total request deadline, since context loading is additional. Assignment loading rejects more than 5,000 rows rather than truncating them.

## Authority and limitations

This evidence does not grant leave approval authority, introduce a clinical leave rejection policy, waive an allocation validator, reassign duties, clear locks or modify published periods. The caller still owns authorization and transaction consistency. The final approval/allocation concurrency gate is pending; sequential snapshot rejection is not proof of transaction isolation.

The repair-engine connection, administrator rendering of OT evidence, explicit acknowledgement design where required by approved policy, import consistency, and real PostgreSQL approval-versus-allocation races remain N24 work. Existing frontend behavior was not changed or newly browser-tested in this batch.

## Verification evidence

Initial projection and existing OT suites: 30 passed in 22.50 seconds (`n24-ot-projection-first.xml`), with one fixture warning subsequently corrected. Integrated monthly/manual API, snapshot invalidation and existing allocation-input/import suites: 74 passed in 88.96 seconds (`n24-ot-review-first.xml`). These counts overlap. The final expanded suite additionally covers retained duties, redundant leave/rest blocking, disabled and oversized reviews: 88 passed in 102.24 seconds, zero failures/errors/skips (`n24-ot-review-final.xml`). Ruff and scoped whitespace checks passed. Final source hashes are recorded in `n24-ot-source.json`.
