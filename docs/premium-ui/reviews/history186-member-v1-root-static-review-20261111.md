# Member import history: root static review

This reviews the staged component of requirement186, not a product integration or acceptance. Root read the genuine baseline and candidate in `tmp/import186-member-v1/` after the specialist handoff.

Baseline SHA-256: `0357db668bac46f7c4c28c575e2f7c688b00c95671acb1f475aea0946e89ec92`.
Candidate SHA-256: `7a97dcafc17024d438d2c4c0353c0d6f5073a87bb02e0933b853de1a7f13a762`.

The original displayed table cells, local-zone timestamp formatter and source-row `fields()` renderer are retained. Search uses the same displayed filename, worksheet, time/status, account and result labels. Existing row nodes are hidden in place; batch action attributes retain immutable IDs. Array indexes only associate each unchanged returned row with its unchanged row node; filtering does not reorder that array or derive action IDs from indexes.

The initial history endpoint is unchanged. Detail requests now use a captured and validated batch ID rather than reading the old button attribute after asynchronous work. This is a value-preservation claim, not an exact-expression claim. The new detail retry repeats that same read. No mutation, download endpoint or CSV serialization was introduced. A mismatched detail ID becomes a visible error instead of attaching another batch's rows. That defensive branch needs a runtime fixture.

The query input and list rows survive detail reads. The existing focus-restoration helper is retained; the fallback now rejects a filtered-out action and uses the search input. Detail text identifies its batch separately and remains associated with the old successful selection when a different read fails. All displayed server strings added by this candidate use the existing escaping function or `textContent`. The existing global disabling of batch buttons is retained during a detail read, with current-owner/request-sequence guards on updates and cleanup. Remount resets `oninput` and `onclick`; per-host query persistence uses a WeakMap.

No static integration blocker was found. This does not establish runtime behavior or security for malformed API schemas. The existing numeric `count`/`row.row` HTML interpolations were not independently hardened by this candidate. The new hint says “people” while the searchable displayed field is the importing account; refine that wording before integration. Clear search remains visible when empty; this is a presentation choice, not a correctness claim.

Required gates remain: whole-project virtual typecheck; current/staged API and timestamp equality fixtures; file/worksheet/account/outcome literal matching and zero-result/clear tests; ID/action association; pending/failing/retried/mismatched/stale reads; filtered-out old detail; actual input node/caret and focus preservation; malicious text/HTML escaping; responsive three-engine/theme/enlarged-text checks. The broader186 named-download and unavailable/empty-report recovery criteria remain separate and unaccepted. The helper's seven contract tests and staged syntax checks do not replace these browser gates.

No product source, API contract, backend, database, persisted value or export content was changed by this review.
