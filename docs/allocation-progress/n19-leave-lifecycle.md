# N19: attributable leave lifecycle - acceptance complete

Status: Done against the original N19 tracker criteria, 14 November 2026. Total completed: 15/50. Profile interface integration and reporting remain N20-N25; the full goal remains active.

## Implementation and acceptance map

| Original requirement | Current implementation and evidence |
|---|---|
| Reconstruct create/edit/approve/cancel | Existing canonical LeaveRequest and NormalizationEvent, exposed by leave_history.py / GET /leave/requests/{id}/history. Actual API lifecycle tests assert before/after status and session, actor UUID/name and UTC timestamps. Missing legacy facts are not invented. |
| Retain original import reference | Reuses ImportSourceRecord/ImportBatch and reviewed ImportReviewBatch. Actual spreadsheet upload followed by correction retains the original filename/sheet/row/actor; normalized month replacement preserves imported spelling and records parent-child split ancestry. |
| Preserve amendments, approval/cancellation actor and reason | Existing audit/activity stores remain canonical. Optional <=2000-character manual change_reason, reviewed values.change_reason, monthly approval reason and cancellation reason are trimmed and recorded. Reviewed change reasons bind to the existing review token, so changing a reason requires a new review. Bodyless/empty cancellation clients and prior approval payloads remain compatible. Legacy missing reasons remain null. |
| Avoid destructive overwrite of history | Leave delete/restore append safe permanent audit/activity before/after, surviving existing 30-day recovery-payload expiry; old bin-only evidence remains readable. Actual delete/restore plus payload-removal test preserves attribution. Normal canonical edits append events and never rewrite older audit/source records. |
| Preserve identity merge lineage | Existing MemberMerge recovery evidence exposes moves, duplicate removal and undo. Future duplicate merges store exact removed->surviving leave IDs in additive top-level payload.leave_survivors; source history is accessible from either ID. Existing undo-step dictionary shape is preserved. Actual move/drop/undo tests verify original source and identity. Legacy absent survivor links are disclosed, never guessed by name/date. |
| No parallel source of truth | No new schema/table or leave database. History is a projection of existing canonical/audit/import/bin/merge stores. Statistical absence counts remain separate downstream work. |

## Read contract, limits and privacy

- GET /leave/requests/{id}/history is an administrator audit endpoint for computer_admin/superadmin. Existing list/create/edit/cancel authorities remain unchanged. The existing normalization transaction namespace gives coherent reads against participating application writers; real PostgreSQL testing observed the cancellation writer blocked on the reader's advisory lock.
- Current canonical state is separate from events and sources. Record presence is explicit, so retained deleted/merged-away IDs are readable without pretending the row still exists. Actor IDs/names and timestamps are returned only when recorded. Old restore/undo stores may supply a name without actor ID.
- Safe projections omit private leave notes, raw imported names/cells/files, bin labels/payloads and unrelated merge steps. Reasons are explicit administrative audit inputs; clinical notes are not repurposed as reasons. Imported normalized state is allowlisted, bounded to 1 MB before parsing, and malformed legacy evidence is disclosed.
- The overview follows at most 64 related record IDs, with 200 backing rows per evidence category. Its evidence_pages links expose GET /leave/requests/{id}/history/page?category=audit|imports|recycle|merges. limit is 1-200; next_cursor/has_more uses (UTC timestamp, UUID) seek ordering and is bound to record/category. Invalid/mismatched/oversized cursors return 422. Equal timestamps, every category beyond 200, empty projected merge pages and strict role gates are tested.
- Page limits apply to backing rows; a merge or bin row can produce multiple events or no projected events. Clients follow next_cursor even for an empty projected page. Bin fallback is suppressed when exact action/batch/record audit evidence already exists, including across pages.
- unvisited_record_ids allows ancestry beyond 64 to be followed; related_record_ids and parent/survivor IDs from later evidence pages expose links that were beyond the overview cap. A test retrieves a parent source whose split event is beyond the first 200 audit entries.
- Paging reads live retained evidence, not a frozen historical-as-of ledger. Each response is coherent at its application transaction boundary. Retention, unknown old actors/reasons and missing legacy survivor links remain visible. coverage.complete stays false because available records cannot prove complete historical attendance or approval history. No attendance, entitlement, working-day calendar, carry-forward or disciplinary inference.

## Verification

- Previous foundation: n19-history-regression.xml 101 passed; n19-history-current.xml 12 passed; n19-history-postgres.xml 14 passed. Earlier expired-ID fixture and indentation failures remain documented in prior execution logs.
- n19-paging-first.xml 19 passed/1 failed: old duplicate test expected the former missing-survivor warning; updated to assert explicit survivor/source linkage. No actual product regression in that artifact.
- n19-paging-current.xml 27 passed after correcting the old expectation and adding paging fixtures.
- n19-paging-regression.xml 112 passed, zero failures/errors/skips, covering leave/approval/profile/operational import/admin delete/merge plus new lifecycle/paging cases.
- n19-paging-final.xml 22 passed after empty-category warning refinement and late-parent retrieval cases.
- Final compatible payload/source: n19-paging-compatible-final.xml 65 passed; n19-paging-postgres-final.xml 15 passed. The latter includes 13 existing races, history-versus-cancel ordering and real PostgreSQL UUID seek/JSON batch dedup/import-page/exact survivor-source/undo verification. Owned runner42678 exited0 after migration sentinel and guarded disposable DB cleanup. The earlier PostgreSQL run also passed15 before the payload compatibility refinement.
- Suites overlap and counts are not additive. Ruff and scoped whitespace checks pass. Final runtime hashes/reports are n19-paging-source.json. No runtime edits followed the final compatible and PostgreSQL verification.

## Remaining work and rollback

N20 centralizes status/interval calculations without silently amending 24-hour/start-hour duty rules. N21 integrates history/source navigation and reason input in the existing workspace, preserving canonical forms and their recovery behavior. N22-N25 deliver reconciled statistics, explicit coverage and impact/correction flows.

Rollback requires no schema migration. Preserve existing audit/source evidence and recovery payloads. New survivor metadata is a top-level addition; existing undo-step shape remains readable by the prior undo implementation, and exact undo passes. Reverting new writers only stops future attribution. Reverting the history reader removes the new endpoints, not historical data. No frontend edits, operational migration, production deployment, cloud routing, model installation or clinical-policy amendment occurred in this batch.
