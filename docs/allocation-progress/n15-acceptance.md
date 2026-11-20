# N15 original acceptance closure

Original action: reviewed monthly OT-calendar import/export using existing
unit/call mappings, dry-run validation, source traceability and idempotency.
Round-trip, duplicate upload, ambiguous unit, bad weekday and changed mapping must
behave predictably; imports must never silently activate invalid demand.

| Requirement | Current evidence |
|---|---|
| Monthly import/export | Portable dated JSON format and existing calendar panel; semantic round-trip no-op preserves weekly/outside-month settings; explicit closures preserve their source reference on re-export |
| Existing mappings | Operational importer resolves canonical unit labels/reviewed aliases, rejects ambiguous/other-unit matches; existing call normalizer feeds strict band schema |
| Dry-run/review | Preview has no history writes; displays before/after/unknown rows and source hash; apply requires confirmation and current operator/source/context/base revision |
| Traceability | Canonical calendar/version store only; saved actor, filename/month/source/review/mapping hashes in history; source hash explicitly normalized document content, not file bytes |
| Duplicate upload/apply | Semantic no-op creates no redundant version; changing review retry returns durable original result; real two-thread apply yields exactly one new canonical version and one already-applied response |
| Invalid/stale input | Bad weekday/date/call/count/duplicate/oversized rows refused; unknown cannot erase known demand; global reserve/qualification changes require separate review; mapping/source/operator/revision changes refuse apply |
| Atomicity/order | Raw mapping writer actually waits in pg_locks behind reviewed apply; mapping-first refuses new writes; after apply-first mapping change, retry refuses rather than replaying against changed mapping |
| User-visible recovery | Desktop/mobile export/preview/confirm/apply/malformed refusal; stale review and response lost after actual commit each issue exactly one mutation, clear actionable review and recover by explicit read only |
| Permissions | Existing administrator and feature gates enforced on transfer API; tests reject member preview/apply/export and disabled preview |

Final evidence inspected:

- `n15-acceptance-final.xml`:37passed31.61s, zero failures/errors/skips, transfer,
  calendar API and qualification regression on current backend source.
- `n15-races-postgres.xml`:16passed64.34s, including3new transfer race cases plus
  existing13concurrency cases. Runner exited0 after its owned disposable database
  cleanup and migration sentinel checks. Later transfer edits preserve closure
  source on export; they do not change the tested apply locking algorithm.
- `n15-transfer-browser.json`:2viewports1440/390, real disposable backend, saved
  download, preview with unchanged history, explicit confirm, actual saved minimum,
  malformed refusal, no overflow/page errors and no serious/critical panel Axe.
- `n15-recovery-browser.json`:stale and post-commit lost-response scenarios,
  one mutation each and read-only recovery. Both browser suites rerun on final UI.
- TypeScript/Vite production build passed after final UI guard; existing mixed
  import/chunk-size warnings retained. Ruff and scoped whitespace passed.

Failed early artifacts remain: first transfer tests selected an unknown row as
though open; first browser used a wrong exact date selector after successful apply.
Neither is relabeled as green, and final reruns exercise the corrected cases.

N15 is Done. Source fingerprints: `n15-races-source.json`. The format intentionally
uses effective monthly dated replacements, not a second weekly calendar store.
Global reserve/qualification policy, unknown rows and omitted areas retain explicit
boundaries. No automatic mutation retry is introduced. No-op imports do not write
new audit versions; the read-only source hash and existing canonical saved state
remain available for review. Recovery after intervening calendar/mapping edits
requires a fresh review rather than granting a stale retry permission.

Rollback removes the additive API/UI transfer feature without schema migration or
deleting imported canonical history. Reverting an applied calendar is a separately
reviewed calendar operation against its latest revision. No operational database
was imported or migrated, and no production deployment or policy amendment is
authorized by this test closure. All50items are not complete.
