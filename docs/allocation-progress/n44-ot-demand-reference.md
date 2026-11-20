# Authoritative OT demand-only reference

`GET /api/v1/admin/ot-calendars/{unit_id}/assistant-reference?day=YYYY-MM-DD`
uses the existing OT administrator and feature-gate dependencies. It is a
read-only source foundation for N44; it is not yet forwarded to a model or added
to the assistant browser flow. Existing companion absent-OT guidance stays in
force until explicit source selection, validation and freshness integration pass.

The service calls the canonical saved calendar resolver for the exact unit/date,
including recurring definitions and dated closures/replacements. It does not
reimplement date precedence, infer holiday closures, create calendar records or
run availability/assignment validation.

The reference contains the calendar revision, exact minimized-content digest,
retrieval time, unit/date, configured/unknown/partial status, reserve mode, and
bounded numbered bands with time intervals, explicit call pools, minimum,
target and required-skill count. It excludes staff identities, individual
availability, leave details, area/band labels, free source-reference text,
qualification bindings, skill identifiers and administrator/history notes.

The reference deliberately cannot explain which person or specific qualification
can cover a band. A skill count marks omitted qualification scope; it is not a
substitute for exact qualifications or the OT reservation graph. Reserve mode is
reported but actual reserve-minimum predicates are absent. These limits are
included in the response.

## Correct interpretation

- An absent calendar or undefined unit/day stays unknown, with no invented zero.
- Partial configuration preserves that status and missing-area count; supplied
  bands are not certified as complete demand.
- An explicitly closed, fully configured day can have known zero bands. That
  does not establish that people are free of rest, reserve or other duties.
- Minimum and target remain distinct; targets are not silently mandatory.
- Different bands cannot simply be summed into simultaneous or unique people.
- The selected day content version changes with scope/demand changes. A calendar
  revision identifies saved source; neither hash is a signature, a live lock,
  approval to relax rules or proof of staffing feasibility.

More than64 bands returns a bounded422 response pointing to the OT calendar,
never a truncated demand summary. Normal OT day/calendar APIs remain available.
No new read access is granted to board/member roles; the existing administrator
boundary is retained. No feature flag, model choice, cloud route or domain
policy changes.

## Verification

`test_assistant_ot_reference.py` checks no-record/no-write unknown reads,
canonical saved bands/pools/minimum/target, private-label/note exclusion,
stable/changed content and calendar revisions, date-scope versioning, explicit
closure versus undefined/partial day, oversized rejection, unauthorized roles,
unknown units, disabled feature and invalid date inputs. The existing OT calendar
API suite runs alongside it on disposable SQLite.

Terminal XML/log and final source hashes establish acceptance; a worker being
alive does not. No live-model quality, frontend/browser, full staffing preview,
PostgreSQL concurrency or production-deployment acceptance follows from this
read-only endpoint. N44 still needs selected-source UI/companion validation,
freshness checks, scoped OT explanations and broader semantic evidence. Rollback
removes this route/service; no stored-data migration is required.

Final session15142 exited0: **26passed115.33s** in
`n44-ot-reference.xml`, including six new reference cases and the existing OT
calendar API suite. Ruff/scoped whitespace checks passed. Final implementation,
test and canonical resolver hashes are recorded in `n44-ot-reference-source.json`
and were independently rechecked unchanged after the batch. Tests use only
disposable SQLite; no operational calendar or permission state changed.
