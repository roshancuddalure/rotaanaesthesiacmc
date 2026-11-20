# Reviewed monthly OT transfer (N15 in progress)

The existing administrator calendar exposes JSON export and preview/apply routes
under `/{unit_id}/transfer`. Files declare `duty-rota-ot-month-v1`, month, unit
label, explicit reserve mode, reviewed qualification bindings and dated area rows.
Rows state open, closed or unknown and include a matching weekday, bands and source
reference. Monthly changes create canonical dated exceptions; weekly definitions
and dates outside the file's month stay unchanged. Omitted areas are preserved;
unknown rows cannot erase reviewed demand or closure.

This intentionally transfers effective monthly demand rather than editing global
weekly templates. Global reserve/qualification differences are rejected for separate
calendar review. Existing units and reviewed unit aliases resolve through the
canonical operational importer; ambiguous or other-unit matches fail explicitly.
Call labels use the existing normalizer and strict canonical band schema. Invalid
weekdays, dates, duplicate area/date rows, negative/invalid counts and overlapping
definitions cannot silently activate.

Preview is read-only and returns before/after staffing rows, unknown rows, canonical
source-document hash, base revision and operator-bound review hash. Source hash is
of validated/normalized document content, not byte-for-byte file formatting.
Apply reacquires normalization/input locks and recomputes the review. Mapping,
scheduling context, source filename/document, operator or saved revision changes
refuse application. Existing calendar/version tables remain the source of truth;
the save history note records file/month/source/review/mapping hashes and actor.
No parallel calendar database or migration is introduced.

Changing imports are idempotent through their existing attributable calendar
history and current revision. Retry must match actor/source/mapping/current saved
revision; an intervening change prevents replay. Semantic round-trip no-ops create
no redundant calendar version. Review hashes are context identity checks used
under administrator authority, not a separate authorization grant.

The native calendar panel downloads JSON, reads a bounded file, previews explicit
dated changes, requires confirmation and applies once. Existing drafts must be
saved/discarded first; applying participates in the editor's saving guard. A failed
or uncertain apply clears actionable review and requires reading the latest saved
state; the client never retries a mutation automatically. Month files are limited
to2000area rows and4096role bands; UI rejects files over2MB. These are input bounds,
not a measured response-time guarantee.

Evidence: first backend run3pass2fail18.51s from tests wrongly selecting an unknown
first row as open; corrected row selection. Subsequent25core/26expanded tests passed;
latest6focused transfer tests passed16.75s after Unicode audit-note handling.
Desktop/mobile browser workflows verify download, read-only preview/history count,
explicit confirm/apply, malformed JSON refusal, no serious/critical Axe violations
in the transfer panel, no overflow/page errors. The first browser attempt used an
incorrect exact date selector; corrected full rerun passed. Production build passed
with existing mixed-import/chunk-size warnings.

N15 is Done following the original acceptance audit in `n15-acceptance.md`.
Final37backend checks,16realPostgreSQL checks, desktop/mobile transfer workflows
and stale/post-commit lost-response recovery passed. Closure source references
are preserved on re-export. Invalid input and actual writer ordering are verified;
explicit read recovery never automatically retries apply. No operational data was
imported and no production deployment or policy amendment is authorized here.
