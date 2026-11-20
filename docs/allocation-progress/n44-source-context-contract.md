# Versioned minimized assistant context

The authenticated assistant-context endpoint now delegates to
`app.services.assistant_sources.assistant_source_context`. It retains current
rule limits/rest/staffing and at most five approved non-exception teaching
examples. Normal API teaching reasons are already enumerated; this change
preserves those categories and adds a defensive boundary for historical or
malformed stored payloads.

Only supported kind/reason categories, boolean-or-unknown weekend status, and
known bounded finite numeric score components enter teaching context. Names,
person IDs, private notes, arbitrary reason text, unknown feature keys, numeric
strings, booleans masquerading as numbers, nonfinite and out-of-range values are
excluded. Invalid example shapes are omitted or represented with empty typed
features. Selection relevance uses reason categories; it no longer consults
private note text. Existing saved teaching data is preserved unchanged.

The response adds source_contract1, a snapshot timestamp, and SHA256 content
versions for the exact minimized constraints and teaching feature list. Private
note edits cannot change those content versions; actual constraint or included
feature changes can. Content versions identify supplied facts, not policy
approval, authenticity of an arbitrary client payload, or live freshness.

The response explicitly lists facts not included: person identity, personal
availability, leave reasons, profile comments, unit OT demand and assignment
validity. Their absence cannot be interpreted as zero demand, available people,
no leave or a validated rota. The model receives advisory snapshot context;
canonical planning, final validation and separate policy review remain required.

## Verification scope

`backend/tests/test_assistant_sources.py` checks minimized shapes, malformed
legacy data, unapproved/exception exclusion, finite/typed numeric limits, stable
content versions, actual version changes, five-example cap, authenticated endpoint
serialization and private content absence. The existing assistant authorization
test is included as regression. Disposable in-memory SQLite only; no operational
data or model inference.

Final session65644 exited0: `n44-source-context-final.xml` **5passed72.93s**.
The initial run66418 exited1 with3pass/2fail: omission label `person_identity`
matched the existing broad privacy assertion for substring `person_id`; no actual
identifier was exposed. Renamed that label `member_identity`, retaining the
privacy assertions and failed artifact. Final Ruff/scoped whitespace passed;
`n44-source-context-final-source.json` records final source hashes.

No frontend rendering, full live-model grounding,
OT source contract, citation display or stale-client handling is claimed in this
batch. Those remain N44 work; hashes alone do not make model prose grounded.
No domain rule, policy weight, learning activation, assignment or model changes.

Rollback restores the endpoint's former payload builder and removes the new
service module; no migration or stored-data rollback is needed. The new response
fields are additive for current clients; former constraints/example field names
remain, with unsafe/malformed feature content filtered.
