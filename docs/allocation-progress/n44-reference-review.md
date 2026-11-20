# Assistant reference review and stale-mode protection

The assistant panel now displays the authenticated backend's current-rule and
approved-teaching content versions, retrieval timestamp and month. These values
are captured from the actual context sent to the companion, never copied from
model-provided citations. The panel explains that personal availability, private
leave details and unit OT demand are absent, and that a source reference neither
validates a rota nor approves policy changes.

The browser checks a complete known source contract before contacting the model.
Missing, duplicate, unsupported or malformed source references block the request.
It re-fetches context after the model response and again before selecting its
planning mode. Changed rules or teaching versions disable use and require a new
suggestion. Timestamp-only changes and source ordering do not invalidate identical
content. Month and both content versions must match.

Mode selection also requires the original instruction to remain unchanged,
including while the last reference check is awaiting a response. Unsupported
model modes, missing review=true and malformed rule/evidence structures are
rejected. A closed/removed dialog cannot select a mode or make follow-up requests.
Selection changes only the local planning option; all assignment/policy writes
remain explicit existing workflows with canonical validation.

## Verification

- 145 frontend tests passed, including strict reference parsing, unsupported
  source/version handling, reordered/timestamp-only equivalence and changed
  month/rules/teaching detection. `n44-reference-frontend.log`.
- Final TypeScript/Vite build passed22.68s; existing mixed-import/bundle warnings
  remain. `n44-reference-build-final.log` supersedes the initial40.75s build after
  the instruction-race correction.
- `n44-reference-browser-final.json`: actual component at1440/390/320, API/model
  routes mocked and all write requests counted. Visible versions/missing facts,
  stale changes after/during inference, edited instruction during freshness read,
  fresh mode-only selection, missing sources/no model call, malformed mode and
  closed/no follow-up checks all pass. Zero API writes/page errors/overflow and
  zero serious/critical Axe findings in the tested reference section.
- 390px screenshot `n44-reference-390.png` was visually inspected; full hashes wrap
  inside the panel. Initial browser report retained separately. This is UI
  behavior evidence, not new live-model, operational or GPU evidence.

The existing real-model and premium-action browser harness fixtures/notices were
aligned with the new source contract and async use-mode check; syntax checked.
Their full unrelated workflows were not rerun or claimed as new acceptance.
The independent multi-browser lifetime suite has separate terminal evidence;
session23652 exited0:12 cases across Chromium/Firefox/WebKit and320/1280px with
direct removal/confirmed close passed. The component source hash matched the
current source and the evidence was copied to `n44-reference-lifetime.json`.
Task-owned Vite session48969 was stopped with CtrlC after acceptance; it is not
an application deployment. The initial live checkpoint is retained as history.

## Remaining boundaries

The frontend trusts the authenticated backend's content identifiers; they are
references, not signatures or independently verified model claims. A successful
re-fetch is a point-in-time check, not a lock on changing operational data.
Generation/application still reads current rules and performs final validation.
The source contract versions only included constraints/features, not personal
availability, actual OT demand or every rule relevant to allocation. Model
intent accuracy and prose claims are not certified by this panel.

N44 remains in progress for authoritative OT/source scope, unknown/clarification
behavior, privacy explanations and broader semantic/injection evidence. N42 still
needs comparable final-configuration model runs and independently reviewed unseen
cases. No model, allocation objective or domain policy changed. Rollback removes
the panel/helper and freshness hooks; no schema/data migration is needed.
