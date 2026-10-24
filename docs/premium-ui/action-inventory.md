# Frontend action source inventory

This is source discovery, not browser certification. Baseline: `tmp/premium-ui-baseline-20261021T130359Z`.

959 control candidates across 51 files; 348 event bindings; 184 endpoint expressions; 27 dynamic creation candidates. **Zero actions are marked runtime-passed.**

Run `node frontend/tests/premium-action-inventory.mjs --write` to refresh after source changes; run with `--check` to detect stale digests and malformed traceability.

## Contract and review requirements

Each JSON action records source context, selector candidates, role-gate evidence, month/record context requiring review, outcome category, possible handler references, module endpoint candidates and existing-test candidates. Endpoint and test candidates are not proven action mappings. Populate the exact contract and outcome assertion during workflow review. Static IDs represent template occurrences; expand runtime-generated rows, navigation entries and role variants in browser fixtures. Native fields/disclosures remain in scope even when no JavaScript listener is needed.

Every action and each of the 260 plan items starts with pending visual, responsive, accessibility, reliability, interaction and independent-QA reviews. A completed save requires read-back; a filter needs changed results; a download requires artifact content; cancellation requires absence of unintended mutation. Source findings are investigation candidates, not confirmed no-ops or duplicate handlers. Preserve concurrent source changes and refresh the inventory only from the integrated snapshot.

## Module coverage

| Source | Controls | Event bindings | Dynamic creators |
|---|---:|---:|---:|
| frontend/index.html | 1 | 0 | 0 |
| frontend/src/admin-delete.ts | 4 | 3 | 0 |
| frontend/src/admin-preview.ts | 5 | 2 | 0 |
| frontend/src/analysis-charts.ts | 3 | 0 | 0 |
| frontend/src/api-errors.ts | 0 | 0 | 0 |
| frontend/src/audit-time.ts | 0 | 0 | 0 |
| frontend/src/balance-duties.ts | 18 | 6 | 0 |
| frontend/src/component-reference.ts | 30 | 7 | 0 |
| frontend/src/compute-conflict.ts | 5 | 2 | 0 |
| frontend/src/compute-device.ts | 0 | 1 | 0 |
| frontend/src/compute-protocol.ts | 1 | 0 | 0 |
| frontend/src/compute-worker.ts | 0 | 1 | 0 |
| frontend/src/connection-status.ts | 0 | 10 | 0 |
| frontend/src/data-sync.ts | 0 | 2 | 0 |
| frontend/src/decorative-icons.ts | 0 | 0 | 0 |
| frontend/src/diagnostics-summary.ts | 0 | 0 | 0 |
| frontend/src/extra-duty.ts | 32 | 10 | 1 |
| frontend/src/form-validation.ts | 0 | 4 | 1 |
| frontend/src/frontend-runtime.ts | 0 | 4 | 3 |
| frontend/src/generation-comparison.ts | 3 | 0 | 0 |
| frontend/src/generation-reversal-scope.ts | 0 | 0 | 0 |
| frontend/src/import-report.ts | 0 | 0 | 1 |
| frontend/src/leave-approval.ts | 5 | 4 | 0 |
| frontend/src/limits.ts | 34 | 16 | 0 |
| frontend/src/main.ts | 342 | 43 | 6 |
| frontend/src/member-bulk.ts | 8 | 3 | 0 |
| frontend/src/member-duplicates.ts | 13 | 3 | 0 |
| frontend/src/member-import-history.ts | 4 | 3 | 0 |
| frontend/src/member-import.ts | 18 | 3 | 1 |
| frontend/src/member-profile.ts | 26 | 9 | 0 |
| frontend/src/member-workspace.ts | 73 | 63 | 3 |
| frontend/src/navigation-history.ts | 0 | 0 | 0 |
| frontend/src/operational-import.ts | 45 | 28 | 2 |
| frontend/src/past-duties.ts | 29 | 6 | 1 |
| frontend/src/record-workspace.ts | 15 | 11 | 1 |
| frontend/src/recycle-bin.ts | 10 | 4 | 0 |
| frontend/src/reference-workspace.ts | 52 | 30 | 0 |
| frontend/src/rota-compute.ts | 31 | 9 | 3 |
| frontend/src/rota-intelligence.ts | 60 | 8 | 1 |
| frontend/src/rota-rules.ts | 50 | 13 | 0 |
| frontend/src/services/api.ts | 0 | 2 | 1 |
| frontend/src/session-role.ts | 0 | 0 | 0 |
| frontend/src/shell-accessibility.ts | 0 | 2 | 0 |
| frontend/src/superadmin.ts | 28 | 14 | 0 |
| frontend/src/ui-feedback.ts | 0 | 5 | 1 |
| frontend/src/ui.ts | 1 | 1 | 0 |
| frontend/src/unit-board-filters.ts | 0 | 8 | 1 |
| frontend/src/unit-member-lists.ts | 1 | 0 | 0 |
| frontend/src/vite-env.d.ts | 0 | 0 | 0 |
| frontend/src/workflow-import-history.ts | 9 | 3 | 0 |
| frontend/src/workspace-load-state.ts | 3 | 5 | 0 |

## Actions

| Stable source action ID | Location | Element | Label expression | Outcome category | Test candidates | Runtime |
|---|---|---|---|---|---:|---|
| frontend-index-html::-module-::0bf5b6a809b4 | frontend/index.html:14 | a | Reload app | navigation_or_download | 0 | Not exercised |
| admin-delete-ts::render::8344e4732b2a | frontend/src/admin-delete.ts:64 | button | Close ${esc(title)} | dismissal_or_draft_decision | 60 | Not exercised |
| admin-delete-ts::render::9c02931b1b4c | frontend/src/admin-delete.ts:87 | input | text | field_value_or_selection_change | 3 | Not exercised |
| admin-delete-ts::render::2df285d4e820 | frontend/src/admin-delete.ts:94 | button | ${busy ? "Deleting…" : `Delete ${count ? `${count} ` : ""}${noun(kind, count)}`} | reviewed_mutation_candidate | 3 | Not exercised |
| admin-delete-ts::render::8344e4732b2a::2 | frontend/src/admin-delete.ts:95 | button | Cancel | dismissal_or_draft_decision | 60 | Not exercised |
| admin-preview-ts::sectionHtml::dd726b53208d | frontend/src/admin-preview.ts:54 | div | ${esc(section.title)}: proposed member changes | action_requires_contract_review | 0 | Not exercised |
| admin-preview-ts::render::8344e4732b2a | frontend/src/admin-preview.ts:82 | button | Close ${esc(tool.title)} | dismissal_or_draft_decision | 60 | Not exercised |
| admin-preview-ts::render::fd423837caf3 | frontend/src/admin-preview.ts:85 | button | Try again | action_requires_contract_review | 1 | Not exercised |
| admin-preview-ts::render::790ce77da4c5 | frontend/src/admin-preview.ts:89 | button | ${busy ? "Applying…" : `${esc(tool.confirmLabel)}${changes ? ` (${changes})` : ""}`} | reviewed_mutation_candidate | 10 | Not exercised |
| admin-preview-ts::render::8344e4732b2a::2 | frontend/src/admin-preview.ts:91 | button | Cancel | dismissal_or_draft_decision | 60 | Not exercised |
| analysis-charts-ts::renderAnalysisBars::2ecb4af888e8 | frontend/src/analysis-charts.ts:32 | div | ${escapeHtml(title)} visual chart | action_requires_contract_review | 0 | Not exercised |
| analysis-charts-ts::renderAnalysisBars::28aa20ba150d | frontend/src/analysis-charts.ts:34 | summary | View chart data : ${escapeHtml(title)} | native_disclosure | 0 | Not exercised |
| analysis-charts-ts::renderAnalysisBars::6c0521d28076 | frontend/src/analysis-charts.ts:36 | div | ${escapeHtml(title)} data | action_requires_contract_review | 0 | Not exercised |
| balance-duties-ts::balanceStageHtml::0ebf51907860 | frontend/src/balance-duties.ts:155 | button | Balance duties | action_requires_contract_review | 0 | Not exercised |
| balance-duties-ts::aboutHtml::618841c8da18 | frontend/src/balance-duties.ts:186 | summary | What Balance duties does and never breaks | native_disclosure | 0 | Not exercised |
| balance-duties-ts::-callback-::299030cb27e6 | frontend/src/balance-duties.ts:255 | summary | Show ${list.length - show} more in ${esc(name)} | native_disclosure | 0 | Not exercised |
| balance-duties-ts::membersHtml::2c68c5c1ae5f | frontend/src/balance-duties.ts:286 | summary | Every member's share ${esc(plural(members.length, "member"))} · ${esc(`${changed} changed`)} | native_disclosure | 0 | Not exercised |
| balance-duties-ts::noticeHtml::e026b3846900 | frontend/src/balance-duties.ts:356 | div | div | action_requires_contract_review | 1 | Not exercised |
| balance-duties-ts::noticeHtml::13efc2b05749 | frontend/src/balance-duties.ts:359 | button | Preview again | action_requires_contract_review | 1 | Not exercised |
| balance-duties-ts::noticeHtml::13efc2b05749::2 | frontend/src/balance-duties.ts:360 | button | Try again | action_requires_contract_review | 1 | Not exercised |
| balance-duties-ts::-callback-::c309765adba7 | frontend/src/balance-duties.ts:369 | button | Undo this run | action_requires_contract_review | 1 | Not exercised |
| balance-duties-ts::undoHtml::dae3b667628d | frontend/src/balance-duties.ts:377 | section | section | action_requires_contract_review | 1 | Not exercised |
| balance-duties-ts::undoHtml::9762fb901ca9 | frontend/src/balance-duties.ts:383 | button | Close this message | dismissal_or_draft_decision | 0 | Not exercised |
| balance-duties-ts::undoHtml::6950dfbc912a | frontend/src/balance-duties.ts:385 | button | Yes, undo this run | action_requires_contract_review | 0 | Not exercised |
| balance-duties-ts::undoHtml::9762fb901ca9::2 | frontend/src/balance-duties.ts:386 | button | Keep it | action_requires_contract_review | 0 | Not exercised |
| balance-duties-ts::footer::19187599ccf0 | frontend/src/balance-duties.ts:402 | button | Close | dismissal_or_draft_decision | 0 | Not exercised |
| balance-duties-ts::footer::9749a7164c17 | frontend/src/balance-duties.ts:405 | input | checkbox | field_value_or_selection_change | 1 | Not exercised |
| balance-duties-ts::footer::19187599ccf0::2 | frontend/src/balance-duties.ts:408 | button | Cancel | dismissal_or_draft_decision | 0 | Not exercised |
| balance-duties-ts::footer::63a7826e84f8 | frontend/src/balance-duties.ts:409 | button | ${busy === "apply" ? "Applying…" : "Apply balance"} | reviewed_mutation_candidate | 1 | Not exercised |
| balance-duties-ts::render::8344e4732b2a | frontend/src/balance-duties.ts:415 | button | Close balance duties | dismissal_or_draft_decision | 60 | Not exercised |
| balance-duties-ts::render::403cc5af0fd0 | frontend/src/balance-duties.ts:416 | div | Balance report | action_requires_contract_review | 0 | Not exercised |
| component-reference-ts::-callback-::a7a98477f422 | frontend/src/component-reference.ts:24 | button | ${variant.label} sample | action_requires_contract_review | 3 | Not exercised |
| component-reference-ts::-callback-::7f4143fd8be0 | frontend/src/component-reference.ts:24 | button | ${variant.label} unavailable | action_requires_contract_review | 0 | Not exercised |
| component-reference-ts::-callback-::b1b07fb6b76d | frontend/src/component-reference.ts:24 | button | ${variant.label} pending | action_requires_contract_review | 0 | Not exercised |
| component-reference-ts::-module-::9dbf895f3fbc | frontend/src/component-reference.ts:25 | button | Ready sample | action_requires_contract_review | 2 | Not exercised |
| component-reference-ts::-module-::38ac5302cb4e | frontend/src/component-reference.ts:25 | button | Recovery sample | action_requires_contract_review | 1 | Not exercised |
| component-reference-ts::-module-::0e7a004ca9f9 | frontend/src/component-reference.ts:25 | div | reference-panel-ready | action_requires_contract_review | 0 | Not exercised |
| component-reference-ts::-module-::f05b11ecd094 | frontend/src/component-reference.ts:25 | div | reference-panel-recovery | action_requires_contract_review | 1 | Not exercised |
| component-reference-ts::-module-::ddbfcc1bbe39 | frontend/src/component-reference.ts:25 | button | Retry sample | action_requires_contract_review | 0 | Not exercised |
| component-reference-ts::-module-::df0ce5c9b1b9 | frontend/src/component-reference.ts:27 | button | Primary action | action_requires_contract_review | 3 | Not exercised |
| component-reference-ts::-module-::da345f6312f5 | frontend/src/component-reference.ts:28 | button | Secondary action | action_requires_contract_review | 3 | Not exercised |
| component-reference-ts::-module-::1b5df8fcf8cc | frontend/src/component-reference.ts:29 | button | Quiet action | action_requires_contract_review | 3 | Not exercised |
| component-reference-ts::-module-::e46ebb4c8827 | frontend/src/component-reference.ts:30 | button | Destructive sample | action_requires_contract_review | 3 | Not exercised |
| component-reference-ts::-module-::ffcb013f6739 | frontend/src/component-reference.ts:31 | button | Unavailable action | action_requires_contract_review | 0 | Not exercised |
| component-reference-ts::-module-::63bc099fb4d3 | frontend/src/component-reference.ts:32 | button | Saving sample... | action_requires_contract_review | 0 | Not exercised |
| component-reference-ts::-module-::d3b1db12664a | frontend/src/component-reference.ts:34 | form | form | form_submission | 0 | Not exercised |
| component-reference-ts::-module-::fb574fa01095 | frontend/src/component-reference.ts:35 | input | name | field_value_or_selection_change | 0 | Not exercised |
| component-reference-ts::-module-::8c311c1fd2be | frontend/src/component-reference.ts:36 | select | status | field_value_or_selection_change | 0 | Not exercised |
| component-reference-ts::-module-::b79c82f1f428 | frontend/src/component-reference.ts:37 | input | date | field_value_or_selection_change | 0 | Not exercised |
| component-reference-ts::-module-::9b4c6d9b0aef | frontend/src/component-reference.ts:38 | input | input | field_value_or_selection_change | 0 | Not exercised |
| component-reference-ts::-module-::1f809f8a9e1f | frontend/src/component-reference.ts:39 | textarea | notes | field_value_or_selection_change | 0 | Not exercised |
| component-reference-ts::-module-::43b6eab65da2 | frontend/src/component-reference.ts:40 | input | reviewed | field_value_or_selection_change | 0 | Not exercised |
| component-reference-ts::-module-::a9635f544687 | frontend/src/component-reference.ts:41 | button | Validate sample | action_requires_contract_review | 0 | Not exercised |
| component-reference-ts::-module-::acdb1210dc5b | frontend/src/component-reference.ts:41 | button | Show field error | action_requires_contract_review | 0 | Not exercised |
| component-reference-ts::-module-::707ce327b7ca | frontend/src/component-reference.ts:45 | div | Sample member comparison | action_requires_contract_review | 0 | Not exercised |
| component-reference-ts::-module-::8ff3de7ac95c | frontend/src/component-reference.ts:46 | button | Create sample record | action_requires_contract_review | 3 | Not exercised |
| component-reference-ts::-module-::980ea86bdc94 | frontend/src/component-reference.ts:47 | summary | Technical detail example | native_disclosure | 0 | Not exercised |
| component-reference-ts::-module-::e5b4154c741a | frontend/src/component-reference.ts:48 | button | Open review dialog | action_requires_contract_review | 0 | Not exercised |
| component-reference-ts::-callback-::8344e4732b2a | frontend/src/component-reference.ts:99 | button | Close | dismissal_or_draft_decision | 60 | Not exercised |
| component-reference-ts::-callback-::790ce77da4c5 | frontend/src/component-reference.ts:99 | input | checkbox | field_value_or_selection_change | 10 | Not exercised |
| component-reference-ts::-callback-::5fac72371ddb | frontend/src/component-reference.ts:99 | button | Confirm sample | action_requires_contract_review | 0 | Not exercised |
| compute-conflict-ts::render::8344e4732b2a | frontend/src/compute-conflict.ts:41 | button | Close | dismissal_or_draft_decision | 60 | Not exercised |
| compute-conflict-ts::-callback-::0f6c2e54011f | frontend/src/compute-conflict.ts:51 | button | ${c.status === "completed" ? "Open it to review or apply" : "Resume it"} | reviewed_mutation_candidate | 0 | Not exercised |
| compute-conflict-ts::-callback-::539643a574f7 | frontend/src/compute-conflict.ts:53 | button | Yes, discard it${c.month === month ? ` and start ${escape(stageName(stage))}` : ""} | dismissal_or_draft_decision | 0 | Not exercised |
| compute-conflict-ts::-callback-::d438987dada2 | frontend/src/compute-conflict.ts:54 | button | Keep it | action_requires_contract_review | 0 | Not exercised |
| compute-conflict-ts::-callback-::e1344cc7cf5f | frontend/src/compute-conflict.ts:55 | button | Cancel it | dismissal_or_draft_decision | 1 | Not exercised |
| compute-protocol-ts::-callback-::58505bf7efa8 | frontend/src/compute-protocol.ts:62 | input | input | field_value_or_selection_change | 0 | Not exercised |
| extra-duty-ts::auditReportLinks::5f1f1d5362cf | frontend/src/extra-duty.ts:158 | button | Download audit report (HTML) | download_artifact | 0 | Not exercised |
| extra-duty-ts::auditReportLinks::a3703633613b | frontend/src/extra-duty.ts:159 | button | Download audit report (Excel) | download_artifact | 0 | Not exercised |
| extra-duty-ts::overLimitTable::d91f490ac0fa | frontend/src/extra-duty.ts:254 | summary | Show all ${esc(plural(list.length, "member"))} over a limit | native_disclosure | 0 | Not exercised |
| extra-duty-ts::decisionRow::adc6980b0f21 | frontend/src/extra-duty.ts:327 | summary | ${plural(d.alternatives.length, "other person", "other people")} | native_disclosure | 0 | Not exercised |
| extra-duty-ts::causesList::1c886ef43a2d | frontend/src/extra-duty.ts:391 | summary | Every open duty, with the reason (${open.length}) | native_disclosure | 0 | Not exercised |
| extra-duty-ts::fillAllCta::6ca2da05d6c6 | frontend/src/extra-duty.ts:415 | button | Fill remaining duties (all units) | action_requires_contract_review | 2 | Not exercised |
| extra-duty-ts::-callback-::9228dda95cc2 | frontend/src/extra-duty.ts:443 | button | ${sa ? "Undo this allocation" : bal ? "Undo this balance run" : "Undo this batch"} | action_requires_contract_review | 1 | Not exercised |
| extra-duty-ts::undoPanel::f08ff16600e5 | frontend/src/extra-duty.ts:451 | section | section | action_requires_contract_review | 2 | Not exercised |
| extra-duty-ts::undoPanel::fe184179cd3c | frontend/src/extra-duty.ts:457 | button | Close this message | dismissal_or_draft_decision | 0 | Not exercised |
| extra-duty-ts::undoPanel::c591b7af5d70 | frontend/src/extra-duty.ts:460 | button | Yes, undo this run | action_requires_contract_review | 0 | Not exercised |
| extra-duty-ts::undoPanel::fe184179cd3c::2 | frontend/src/extra-duty.ts:461 | button | Keep it | action_requires_contract_review | 0 | Not exercised |
| extra-duty-ts::undoPanel::c591b7af5d70::2 | frontend/src/extra-duty.ts:464 | button | Yes, undo this batch | action_requires_contract_review | 0 | Not exercised |
| extra-duty-ts::undoPanel::fe184179cd3c::3 | frontend/src/extra-duty.ts:465 | button | Keep it | action_requires_contract_review | 0 | Not exercised |
| extra-duty-ts::undoPanel::c591b7af5d70::3 | frontend/src/extra-duty.ts:467 | button | Yes, undo this batch | action_requires_contract_review | 0 | Not exercised |
| extra-duty-ts::undoPanel::fe184179cd3c::4 | frontend/src/extra-duty.ts:468 | button | Keep it | action_requires_contract_review | 0 | Not exercised |
| extra-duty-ts::noticeHtml::ba2383fd56ac | frontend/src/extra-duty.ts:478 | button | Preview again | action_requires_contract_review | 1 | Not exercised |
| extra-duty-ts::noticeHtml::ba2383fd56ac::2 | frontend/src/extra-duty.ts:479 | button | Try again | action_requires_contract_review | 1 | Not exercised |
| extra-duty-ts::footer::dc7792887d61 | frontend/src/extra-duty.ts:497 | button | Close | dismissal_or_draft_decision | 1 | Not exercised |
| extra-duty-ts::footer::46b9c3016064 | frontend/src/extra-duty.ts:500 | input | checkbox | field_value_or_selection_change | 0 | Not exercised |
| extra-duty-ts::footer::dc7792887d61::2 | frontend/src/extra-duty.ts:503 | button | Cancel | dismissal_or_draft_decision | 1 | Not exercised |
| extra-duty-ts::footer::205d96f7336f | frontend/src/extra-duty.ts:504 | button | ${busy === "apply" ? "Applying…" : all ? "Apply" : "Apply extra duties"} | reviewed_mutation_candidate | 2 | Not exercised |
| extra-duty-ts::render::8344e4732b2a | frontend/src/extra-duty.ts:513 | button | Close ${all ?  | dismissal_or_draft_decision | 60 | Not exercised |
| extra-duty-ts::render::420c6bf20df5 | frontend/src/extra-duty.ts:514 | div | Fill-all report | action_requires_contract_review | 0 | Not exercised |
| extra-duty-ts::renderUnitFallbacks::ffd6e88f8b03 | frontend/src/extra-duty.ts:728 | button | Try again | action_requires_contract_review | 1 | Not exercised |
| extra-duty-ts::unitHtml::c63e0c5663eb | frontend/src/extra-duty.ts:748 | summary | ${esc(row.unit_name)} ${list.length ? plural(list.length, "fallback unit") : "Automatic order"}${dirty(id) ? " · not saved" : ""} | native_disclosure | 0 | Not exercised |
| extra-duty-ts::-callback-::fa2824102e1a | frontend/src/extra-duty.ts:752 | button | Move ${esc(name(u))} up | action_requires_contract_review | 1 | Not exercised |
| extra-duty-ts::-callback-::fc289fbe35cf | frontend/src/extra-duty.ts:753 | button | Move ${esc(name(u))} down | action_requires_contract_review | 1 | Not exercised |
| extra-duty-ts::-callback-::fa4f897c5a46 | frontend/src/extra-duty.ts:754 | button | Remove ${esc(name(u))} | reviewed_mutation_candidate | 0 | Not exercised |
| extra-duty-ts::unitHtml::38a02e1db458 | frontend/src/extra-duty.ts:757 | select | select | field_value_or_selection_change | 2 | Not exercised |
| extra-duty-ts::unitHtml::d1912379ee05 | frontend/src/extra-duty.ts:759 | button | Add to the end | action_requires_contract_review | 1 | Not exercised |
| extra-duty-ts::unitHtml::766ff60da703 | frontend/src/extra-duty.ts:760 | button | ${busy ? "Saving…" : "Save order"} | reviewed_mutation_candidate | 2 | Not exercised |
| extra-duty-ts::unitHtml::d5734e711b5a | frontend/src/extra-duty.ts:761 | button | Discard changes | dismissal_or_draft_decision | 1 | Not exercised |
| generation-comparison-ts::workloadComparison::1bac55a33a8d | frontend/src/generation-comparison.ts:9 | summary | ${escape(title)} | native_disclosure | 0 | Not exercised |
| generation-comparison-ts::workloadComparison::7cd562194bdc | frontend/src/generation-comparison.ts:9 | div | Current and proposed workload comparison | action_requires_contract_review | 0 | Not exercised |
| generation-comparison-ts::alternativeComparison::c0ad628dc493 | frontend/src/generation-comparison.ts:13 | div | Whole-month alternatives comparison | action_requires_contract_review | 0 | Not exercised |
| leave-approval-ts::render::8344e4732b2a | frontend/src/leave-approval.ts:19 | button | Close | dismissal_or_draft_decision | 60 | Not exercised |
| leave-approval-ts::render::9fe1d183d588 | frontend/src/leave-approval.ts:25 | input | checkbox | field_value_or_selection_change | 3 | Not exercised |
| leave-approval-ts::render::790ce77da4c5 | frontend/src/leave-approval.ts:26 | input | checkbox | field_value_or_selection_change | 10 | Not exercised |
| leave-approval-ts::render::43e824225d41 | frontend/src/leave-approval.ts:27 | button | Refresh review | action_requires_contract_review | 17 | Not exercised |
| leave-approval-ts::render::9ee33101a502 | frontend/src/leave-approval.ts:27 | button | ${applying ? 'Approving...' : `Approve all ${review?.pending_count ?? ''} pending requests`} | reviewed_mutation_candidate | 5 | Not exercised |
| limits-ts::controlHtml::7f7ccf2ca5b8 | frontend/src/limits.ts:356 | button | ${on ? "On" : "Off"} | action_requires_contract_review | 1 | Not exercised |
| limits-ts::controlHtml::0facdd5bd372 | frontend/src/limits.ts:364 | select | ${id} | field_value_or_selection_change | 0 | Not exercised |
| limits-ts::controlHtml::8b0a1badb296 | frontend/src/limits.ts:369 | input | ${id} | field_value_or_selection_change | 1 | Not exercised |
| limits-ts::targetsHtml::05f7107e39a7 | frontend/src/limits.ts:417 | button | Try again | action_requires_contract_review | 0 | Not exercised |
| limits-ts::targetsHtml::1c0ef4c7cc2b | frontend/src/limits.ts:436 | input | lim-month | field_value_or_selection_change | 1 | Not exercised |
| limits-ts::heroHtml::f565c495217e | frontend/src/limits.ts:474 | button | History | action_requires_contract_review | 1 | Not exercised |
| limits-ts::-callback-::1a2db304c3f2 | frontend/src/limits.ts:485 | a | ${esc(c.title)} | navigation_or_download | 0 | Not exercised |
| limits-ts::noticesHtml::bbf06394631b | frontend/src/limits.ts:500 | button | Got it | action_requires_contract_review | 0 | Not exercised |
| limits-ts::savebarHtml::95221808e156 | frontend/src/limits.ts:519 | button | Keep my changes | action_requires_contract_review | 1 | Not exercised |
| limits-ts::savebarHtml::0cc51ae44467 | frontend/src/limits.ts:520 | button | Yes, reset | action_requires_contract_review | 1 | Not exercised |
| limits-ts::savebarHtml::1314e9b06527 | frontend/src/limits.ts:526 | button | ${esc(reason)} | action_requires_contract_review | 1 | Not exercised |
| limits-ts::savebarHtml::5b0f22549e22 | frontend/src/limits.ts:528 | button | Reset | action_requires_contract_review | 1 | Not exercised |
| limits-ts::savebarHtml::764dc86fe481 | frontend/src/limits.ts:529 | button | Save limits… | reviewed_mutation_candidate | 1 | Not exercised |
| limits-ts::pageHtml::6addc706f0f0 | frontend/src/limits.ts:538 | div | div | action_requires_contract_review | 4 | Not exercised |
| limits-ts::paintStatus::4b0736ac1a17 | frontend/src/limits.ts:614 | button | Dismiss message | action_requires_contract_review | 0 | Not exercised |
| limits-ts::problem::4e8b3ff2811f | frontend/src/limits.ts:737 | button | Go to setting: ${esc(labelOf(p.path))} | action_requires_contract_review | 0 | Not exercised |
| limits-ts::body::23bbd76d53e3 | frontend/src/limits.ts:739 | div | div | action_requires_contract_review | 1 | Not exercised |
| limits-ts::body::88388670c0e0 | frontend/src/limits.ts:741 | button | Load their version and keep my edits | action_requires_contract_review | 0 | Not exercised |
| limits-ts::body::c303a83a3728 | frontend/src/limits.ts:756 | textarea | lim-note | field_value_or_selection_change | 1 | Not exercised |
| limits-ts::body::7ee35884a417 | frontend/src/limits.ts:758 | input | checkbox | field_value_or_selection_change | 0 | Not exercised |
| limits-ts::footer::8344e4732b2a | frontend/src/limits.ts:765 | button | Keep editing | action_requires_contract_review | 60 | Not exercised |
| limits-ts::footer::cdc793e2ca06 | frontend/src/limits.ts:766 | button | ${phase === "saving" ? "Saving…" : "Confirm and save"} | reviewed_mutation_candidate | 1 | Not exercised |
| limits-ts::render::8344e4732b2a | frontend/src/limits.ts:776 | button | Close save limits | dismissal_or_draft_decision | 60 | Not exercised |
| limits-ts::itemHtml::4983dde510c3 | frontend/src/limits.ts:950 | textarea | lim-restore-note-${index} | field_value_or_selection_change | 1 | Not exercised |
| limits-ts::itemHtml::aeadf12d2152 | frontend/src/limits.ts:951 | button | ${busy ? "Restoring…" : "Yes, restore"} | reviewed_mutation_candidate | 1 | Not exercised |
| limits-ts::itemHtml::a598b3c83216 | frontend/src/limits.ts:952 | button | Cancel | dismissal_or_draft_decision | 1 | Not exercised |
| limits-ts::itemHtml::3a4cea7f1dd1 | frontend/src/limits.ts:954 | button | Restore this version from ${esc(formatWhen(entry.saved_at))} | reviewed_mutation_candidate | 2 | Not exercised |
| limits-ts::render::4c0e17e93195 | frontend/src/limits.ts:961 | button | Try again | action_requires_contract_review | 0 | Not exercised |
| limits-ts::render::8344e4732b2a::2 | frontend/src/limits.ts:968 | button | Close history | dismissal_or_draft_decision | 60 | Not exercised |
| limits-ts::render::33d153e3c64c | frontend/src/limits.ts:970 | div | div | action_requires_contract_review | 0 | Not exercised |
| limits-ts::renderLimitsPage::da06bd22b88e | frontend/src/limits.ts:1147 | button | Open Rota Rules | action_requires_contract_review | 0 | Not exercised |
| limits-ts::renderLimitsPage::e62a7562d93d | frontend/src/limits.ts:1149 | button | Try again | action_requires_contract_review | 1 | Not exercised |
| limits-ts::-callback-::d280c2e88b23 | frontend/src/limits.ts:1212 | summary | ${esc(label(l))}: ${esc(plural(off.length, "member"))} off target (target ${esc(fmt(l.target))}) | native_disclosure | 0 | Not exercised |
| limits-ts::limitsSpreadDebrief::bb6efa0b7b2f | frontend/src/limits.ts:1218 | summary | Duty spread by call level · ${esc(uneven.length ? `${plural(uneven.length, "level")} uneven` : "all even")} | native_disclosure | 0 | Not exercised |
| main-ts::navItemButton::6f83e439fcd1 | frontend/src/main.ts:598 | button | ${escapeHtml(item.label)} | action_requires_contract_review | 46 | Not exercised |
| main-ts::reviewButton::2081429707b9 | frontend/src/main.ts:751 | button | ${escapeHtml(label)} | action_requires_contract_review | 0 | Not exercised |
| main-ts::-callback-::7f9394ee07d3 | frontend/src/main.ts:765 | button | ${escapeHtml(action.label)} | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderReviewActionModal::f3cf658112ba | frontend/src/main.ts:782 | button | Close | dismissal_or_draft_decision | 0 | Not exercised |
| main-ts::renderChangePasswordModal::ae847b91b5a7 | frontend/src/main.ts:815 | button | Close | dismissal_or_draft_decision | 1 | Not exercised |
| main-ts::renderChangePasswordModal::25c37118fa95 | frontend/src/main.ts:818 | form | change-password-form | form_submission | 1 | Not exercised |
| main-ts::renderChangePasswordModal::b4ea84f975ce | frontend/src/main.ts:820 | input | current-password | field_value_or_selection_change | 2 | Not exercised |
| main-ts::renderChangePasswordModal::4158a59e2990 | frontend/src/main.ts:822 | input | new-password | field_value_or_selection_change | 2 | Not exercised |
| main-ts::renderChangePasswordModal::0791e56de8e4 | frontend/src/main.ts:824 | input | confirm-password | field_value_or_selection_change | 1 | Not exercised |
| main-ts::renderChangePasswordModal::ae847b91b5a7::2 | frontend/src/main.ts:827 | button | Cancel | dismissal_or_draft_decision | 1 | Not exercised |
| main-ts::renderChangePasswordModal::f6652a369e37 | frontend/src/main.ts:828 | button | Save Password | reviewed_mutation_candidate | 1 | Not exercised |
| main-ts::renderProfileModal::c0b52392027f | frontend/src/main.ts:856 | button | Close | dismissal_or_draft_decision | 1 | Not exercised |
| main-ts::renderProfileModal::37d03759ed53 | frontend/src/main.ts:859 | form | profile-form | form_submission | 9 | Not exercised |
| main-ts::renderProfileModal::4e8df5aabccf | frontend/src/main.ts:861 | input | profile-username | field_value_or_selection_change | 1 | Not exercised |
| main-ts::renderProfileModal::c59af9258b71 | frontend/src/main.ts:863 | input | profile-display-name | field_value_or_selection_change | 3 | Not exercised |
| main-ts::renderProfileModal::e2e7e5593e20 | frontend/src/main.ts:865 | input | profile-email | field_value_or_selection_change | 2 | Not exercised |
| main-ts::renderProfileModal::c0b52392027f::2 | frontend/src/main.ts:868 | button | Cancel | dismissal_or_draft_decision | 1 | Not exercised |
| main-ts::renderProfileModal::164fa31cff21 | frontend/src/main.ts:869 | button | Save Profile | reviewed_mutation_candidate | 3 | Not exercised |
| main-ts::-callback-::18d9c2a335cc | frontend/src/main.ts:899 | button | ${escapeHtml(item.label)} | action_requires_contract_review | 10 | Not exercised |
| main-ts::renderMobileMoreMenu::20ac27bd2965 | frontend/src/main.ts:917 | button | Close | dismissal_or_draft_decision | 0 | Not exercised |
| main-ts::workflowStepButton::8233dfa5e93e | frontend/src/main.ts:981 | button | ${index + 1} ${escapeHtml(item.label)} | action_requires_contract_review | 46 | Not exercised |
| main-ts::-callback-::6f83e439fcd1 | frontend/src/main.ts:1021 | button | ${escapeHtml(item.shortLabel ?? item.label)} | action_requires_contract_review | 46 | Not exercised |
| main-ts::renderShell::e4eb0aedd73c | frontend/src/main.ts:1024 | a | Skip to content | navigation_or_download | 0 | Not exercised |
| main-ts::renderShell::c41370af56c9 | frontend/src/main.ts:1034 | button | Close menu | dismissal_or_draft_decision | 2 | Not exercised |
| main-ts::renderShell::fc0befc51b5f | frontend/src/main.ts:1046 | button | Open menu | action_requires_contract_review | 9 | Not exercised |
| main-ts::renderShell::61ead84308d3 | frontend/src/main.ts:1057 | input | Working month for leave, units and the monthly rota | field_value_or_selection_change | 32 | Not exercised |
| main-ts::renderShell::1a083099c9f4 | frontend/src/main.ts:1060 | summary | Server | native_disclosure | 0 | Not exercised |
| main-ts::renderShell::e6eedd4d524d | frontend/src/main.ts:1061 | button | Check server | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderShell::4e22be09e7d6 | frontend/src/main.ts:1064 | button | Account: ${escapeHtml(currentUser?.display_name \|\| currentUser?.username \|\|  | action_requires_contract_review | 23 | Not exercised |
| main-ts::renderShell::b037da511ebf | frontend/src/main.ts:1070 | button | Profile | action_requires_contract_review | 52 | Not exercised |
| main-ts::renderShell::c82d8ccab801 | frontend/src/main.ts:1071 | button | Change password | action_requires_contract_review | 2 | Not exercised |
| main-ts::renderShell::e4ca792a1ada | frontend/src/main.ts:1072 | button | Sign out | action_requires_contract_review | 16 | Not exercised |
| main-ts::renderShell::603d3a5c70a1 | frontend/src/main.ts:1082 | button | More | action_requires_contract_review | 13 | Not exercised |
| main-ts::renderLogin::c0f7d5a1941f | frontend/src/main.ts:1187 | button | Sign In | action_requires_contract_review | 2 | Not exercised |
| main-ts::renderLogin::c473502e045d | frontend/src/main.ts:1188 | button | Forgot Password | action_requires_contract_review | 2 | Not exercised |
| main-ts::renderSignInForm::7161810b21d5 | frontend/src/main.ts:1209 | form | login-form | form_submission | 5 | Not exercised |
| main-ts::renderSignInForm::45838fe0116e | frontend/src/main.ts:1211 | input | login-username | field_value_or_selection_change | 4 | Not exercised |
| main-ts::renderSignInForm::0ad530fdebf4 | frontend/src/main.ts:1213 | input | login-password | field_value_or_selection_change | 3 | Not exercised |
| main-ts::renderSignInForm::85fdaa534c2c | frontend/src/main.ts:1214 | button | Sign In | action_requires_contract_review | 8 | Not exercised |
| main-ts::renderForgotForm::302a7fd78fae | frontend/src/main.ts:1259 | form | forgot-form | form_submission | 2 | Not exercised |
| main-ts::renderForgotForm::4a1dcd8e5459 | frontend/src/main.ts:1261 | input | forgot-username | field_value_or_selection_change | 1 | Not exercised |
| main-ts::renderForgotForm::c3a68932bb6f | frontend/src/main.ts:1262 | button | Recovery Instructions | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderForgotForm::d62e19cfd969 | frontend/src/main.ts:1265 | form | reset-form | form_submission | 1 | Not exercised |
| main-ts::renderForgotForm::ed6928c0adca | frontend/src/main.ts:1267 | input | reset-token | field_value_or_selection_change | 1 | Not exercised |
| main-ts::renderForgotForm::a7e7b3347d61 | frontend/src/main.ts:1269 | input | reset-password | field_value_or_selection_change | 1 | Not exercised |
| main-ts::renderForgotForm::3a13b4c4fc2f | frontend/src/main.ts:1270 | button | Reset Password | action_requires_contract_review | 1 | Not exercised |
| main-ts::overviewMonthPanel::cc32cc9fa7e3 | frontend/src/main.ts:1427 | button | ${status ? "Continue" : "Open Rota Setup"} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::04af377a4c48 | frontend/src/main.ts:1433 | button | ${index + 1} ${escapeHtml(step.label)} ${state ? labels[state] : "Open to check"} | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderOverview::f098fe01aa34 | frontend/src/main.ts:1458 | button | Try again | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderOverview::229d88660a76 | frontend/src/main.ts:1480 | button | Open Duty Analysis | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderOverview::3ef82fab8f85 | frontend/src/main.ts:1481 | button | Find Member | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderOverview::37d8d47589b0 | frontend/src/main.ts:1493 | button | ${escapeHtml(totalLeader?.name ?? "No data")} | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderOverview::e60e2e35f6a4 | frontend/src/main.ts:1498 | button | ${escapeHtml(weekendLeader?.name ?? "No data")} | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderPaginator::e692aa71eadb | frontend/src/main.ts:1558 | button | &#8592; Prev | action_requires_contract_review | 2 | Not exercised |
| main-ts::renderPaginator::bf83f0c820a3 | frontend/src/main.ts:1559 | button | &#8592; Prev | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderPaginator::801bd2c553cc | frontend/src/main.ts:1561 | button | Next &#8594; | action_requires_contract_review | 2 | Not exercised |
| main-ts::renderPaginator::92673f2fdf47 | frontend/src/main.ts:1562 | button | Next &#8594; | action_requires_contract_review | 0 | Not exercised |
| main-ts::rowMenu::c326b8658f87 | frontend/src/main.ts:1646 | summary | ${escapeHtml(label)} | native_disclosure | 0 | Not exercised |
| main-ts::helpIcon::848be5e49236 | frontend/src/main.ts:1752 | button | Explain this metric | action_requires_contract_review | 2 | Not exercised |
| main-ts::-callback-::edc6db8e8509 | frontend/src/main.ts:1790 | button | ${index + 1}. ${escapeHtml(person.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::edc6db8e8509::2 | frontend/src/main.ts:1804 | button | ${index + 1}. ${escapeHtml(person.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderAnalysisDataCard::a71b9e8539c4 | frontend/src/main.ts:1818 | button | ${escapeHtml(title)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderSortTh::5117e30052a6 | frontend/src/main.ts:1956 | button | ${label}${dir} | action_requires_contract_review | 2 | Not exercised |
| main-ts::-callback-::edc6db8e8509::3 | frontend/src/main.ts:1972 | button | ${offset + index + 1}. ${escapeHtml(person.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::edc6db8e8509::4 | frontend/src/main.ts:1993 | button | ${offset + index + 1}. ${escapeHtml(person.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::edc6db8e8509::5 | frontend/src/main.ts:2023 | button | ${offset + index + 1}. ${escapeHtml(person.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::edc6db8e8509::6 | frontend/src/main.ts:2047 | button | ${offset + index + 1}. ${escapeHtml(person.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderAnalysisPersonnelTab::b45848b33020 | frontend/src/main.ts:2061 | input | Search personnel | field_value_or_selection_change | 1 | Not exercised |
| main-ts::-callback-::5ae1a69bb7df | frontend/src/main.ts:2120 | button | ${offset + i + 1}. ${escapeHtml(p.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::5ae1a69bb7df::2 | frontend/src/main.ts:2151 | button | ${i + 1}. ${escapeHtml(p.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::5ae1a69bb7df::3 | frontend/src/main.ts:2158 | button | ${i + 1}. ${escapeHtml(p.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::5ae1a69bb7df::4 | frontend/src/main.ts:2211 | button | ${offset + i + 1}. ${escapeHtml(p.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::5ae1a69bb7df::5 | frontend/src/main.ts:2272 | button | ${cartOffset + i + 1}. ${escapeHtml(p.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::5ae1a69bb7df::6 | frontend/src/main.ts:2287 | button | ${i + 1}. ${escapeHtml(p.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::5ae1a69bb7df::7 | frontend/src/main.ts:2367 | button | ${offset + i + 1}. ${escapeHtml(p.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::5ae1a69bb7df::8 | frontend/src/main.ts:2433 | button | ${offset + i + 1}. ${escapeHtml(p.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::5ae1a69bb7df::9 | frontend/src/main.ts:2515 | button | ${offset + i + 1}. ${escapeHtml(p.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::053268c65a7e | frontend/src/main.ts:2577 | button | ${escapeHtml(c.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::5ae1a69bb7df::10 | frontend/src/main.ts:2599 | button | ${ppOffset + i + 1}. ${escapeHtml(p.name)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderAnalysisPreflight::0c6fd56e57a2 | frontend/src/main.ts:2685 | summary | Data Quality: ${preflight.safe_to_publish ? "✓ Ready" : "⚠ Needs Review"} ${preflight.included_periods.length} periods | native_disclosure | 0 | Not exercised |
| main-ts::renderManualReview::c7983ebc7c15 | frontend/src/main.ts:2756 | summary | Manual Review ${review.summary.unique_skipped_names} unresolved names | native_disclosure | 0 | Not exercised |
| main-ts::renderAnalysis::229d88660a76 | frontend/src/main.ts:2886 | button | Retry analysis | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::929dc1748c17 | frontend/src/main.ts:2892 | button | ${tab.label} | action_requires_contract_review | 7 | Not exercised |
| main-ts::renderAnalysis::ddedf36fae4e | frontend/src/main.ts:2901 | div | analysis-tab-body | action_requires_contract_review | 2 | Not exercised |
| main-ts::-callback-::ad285df417f3 | frontend/src/main.ts:2910 | button | ${mappingTypeLabel(type)} | action_requires_contract_review | 3 | Not exercised |
| main-ts::renderDutyTarget::0435409a50c5 | frontend/src/main.ts:2931 | select | Target key for ${escapeHtml(mapping.source_label)} | field_value_or_selection_change | 29 | Not exercised |
| main-ts::renderTextTarget::0435409a50c5 | frontend/src/main.ts:2936 | input | Target key for ${escapeHtml(mapping.source_label)} | field_value_or_selection_change | 29 | Not exercised |
| main-ts::-callback-::4c3ec2575c31 | frontend/src/main.ts:2972 | input | Target label for ${escapeHtml(mapping.source_label)} | field_value_or_selection_change | 29 | Not exercised |
| main-ts::-callback-::6018b64734e3 | frontend/src/main.ts:2981 | select | Status for ${escapeHtml(mapping.source_label)} | field_value_or_selection_change | 29 | Not exercised |
| main-ts::-callback-::5dea30683596 | frontend/src/main.ts:2988 | input | Notes for ${escapeHtml(mapping.source_label)} | field_value_or_selection_change | 29 | Not exercised |
| main-ts::-callback-::186be1cf05b1 | frontend/src/main.ts:2991 | button | Save | reviewed_mutation_candidate | 16 | Not exercised |
| main-ts::renderMappings::ca7e33ef6ce7 | frontend/src/main.ts:2999 | button | Try again | action_requires_contract_review | 2 | Not exercised |
| main-ts::renderMappings::dd8e6d397cca | frontend/src/main.ts:3005 | button | Add mapping | action_requires_contract_review | 2 | Not exercised |
| main-ts::renderMappings::b83551a70d70 | frontend/src/main.ts:3006 | button | Scan historical files | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderMappings::b2446482be6e | frontend/src/main.ts:3007 | button | Manage reference labels | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderMappings::0197e29fe009 | frontend/src/main.ts:3013 | input | mapping-search | field_value_or_selection_change | 1 | Not exercised |
| main-ts::adminSelectBox::0bbb677a58d8 | frontend/src/main.ts:3224 | input | Select ${escapeHtml(label)} | field_value_or_selection_change | 3 | Not exercised |
| main-ts::adminDeleteSelectedButton::3349031b1a8a | frontend/src/main.ts:3230 | button | Delete selected (${n}) | reviewed_mutation_candidate | 1 | Not exercised |
| main-ts::memberRowActions::e7375deecd3b | frontend/src/main.ts:3274 | button | Restore member | reviewed_mutation_candidate | 0 | Not exercised |
| main-ts::memberRowActions::00f48706ab74 | frontend/src/main.ts:3275 | button | Archive member… | action_requires_contract_review | 0 | Not exercised |
| main-ts::memberRowActions::daca1b5b61ed | frontend/src/main.ts:3277 | button | Delete member… | reviewed_mutation_candidate | 0 | Not exercised |
| main-ts::memberRowActions::d6ad78cc4fef | frontend/src/main.ts:3280 | button | Open profile | action_requires_contract_review | 9 | Not exercised |
| main-ts::memberRowActions::6237e18060e4 | frontend/src/main.ts:3281 | button | Call history and comments | action_requires_contract_review | 0 | Not exercised |
| main-ts::memberRowActions::01d3b775ffeb | frontend/src/main.ts:3282 | button | Change call level for ${name} | action_requires_contract_review | 9 | Not exercised |
| main-ts::-callback-::d6ad78cc4fef | frontend/src/main.ts:3300 | button | ${escapeHtml(member.canonical_name)} | action_requires_contract_review | 9 | Not exercised |
| main-ts::-callback-::31dc35512306 | frontend/src/main.ts:3394 | button | Remove ${escapeHtml(filter.label)} | reviewed_mutation_candidate | 0 | Not exercised |
| main-ts::-callback-::d6ad78cc4fef::2 | frontend/src/main.ts:3405 | button | ${escapeHtml(member.canonical_name)} | action_requires_contract_review | 9 | Not exercised |
| main-ts::-callback-::250de2a07327 | frontend/src/main.ts:3598 | button | ${escapeHtml(formatDate(day))}: ${entries.length ? `${entries.length} on leave` :  | action_requires_contract_review | 4 | Not exercised |
| main-ts::renderLeaveDayList::250de2a07327 | frontend/src/main.ts:3613 | button | ${escapeHtml(formatDate(day, { weekday: true }))} ${entries.length ? `${entries.length} on leave` : "Nobody on leave"} ${entries.slice(0, 3).map((entry) => ` ${escapeHtml(entry.person_name)} ${escapeH | action_requires_contract_review | 4 | Not exercised |
| main-ts::renderLeaveDayModal::b7d632e2824b | frontend/src/main.ts:3670 | button | Close | dismissal_or_draft_decision | 0 | Not exercised |
| main-ts::renderLeaveDayModal::58f8047a7925 | frontend/src/main.ts:3674 | button | Add leave on this day | action_requires_contract_review | 8 | Not exercised |
| main-ts::-callback-::53a260eea1e9 | frontend/src/main.ts:3698 | button | ${escapeHtml(leave.person.canonical_name)} | action_requires_contract_review | 9 | Not exercised |
| main-ts::-callback-::53a260eea1e9::2 | frontend/src/main.ts:3718 | button | ${escapeHtml(leave.person.canonical_name)} | action_requires_contract_review | 9 | Not exercised |
| main-ts::groups::f871ca0c89a0 | frontend/src/main.ts:3737 | summary | Show remaining ${ordered.length - 8} groups | native_disclosure | 0 | Not exercised |
| main-ts::-callback-::b4f425c1aea4 | frontend/src/main.ts:3756 | button | Review leave on ${escapeHtml(formatDate(day.date))} | action_requires_contract_review | 4 | Not exercised |
| main-ts::leaveRowActions::76a995dab8ab | frontend/src/main.ts:3772 | button | Edit leave | action_requires_contract_review | 1 | Not exercised |
| main-ts::leaveRowActions::f3bdc9d28372 | frontend/src/main.ts:3773 | button | Cancel leave… | dismissal_or_draft_decision | 1 | Not exercised |
| main-ts::leaveRowActions::df8cf0a226af | frontend/src/main.ts:3774 | button | Delete leave… | reviewed_mutation_candidate | 0 | Not exercised |
| main-ts::renderLeave::80278c5d5196 | frontend/src/main.ts:3800 | button | Try again | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderLeave::58331c60d1c2 | frontend/src/main.ts:3814 | button | Add leave | action_requires_contract_review | 8 | Not exercised |
| main-ts::renderLeave::8f84af51c894 | frontend/src/main.ts:3815 | button | Import leave CSV | action_requires_contract_review | 11 | Not exercised |
| main-ts::renderLeave::f6a521184568 | frontend/src/main.ts:3816 | button | Approve all pending (${pendingApprovals}) | reviewed_mutation_candidate | 2 | Not exercised |
| main-ts::renderLeave::43f77b883bd6 | frontend/src/main.ts:3818 | summary | More leave tools | native_disclosure | 0 | Not exercised |
| main-ts::renderLeave::b2446482be6e | frontend/src/main.ts:3820 | button | Labels and mappings | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderLeave::9a7beca3db5c | frontend/src/main.ts:3821 | a | Download CSV template | navigation_or_download | 0 | Not exercised |
| main-ts::renderLeave::82881412753b | frontend/src/main.ts:3822 | a | Download example CSV | navigation_or_download | 0 | Not exercised |
| main-ts::renderLeave::cfbf586fa970 | frontend/src/main.ts:3823 | button | Delete all leave for ${escapeHtml(monthName)}… | reviewed_mutation_candidate | 0 | Not exercised |
| main-ts::renderLeave::dec028a46c74 | frontend/src/main.ts:3838 | button | Month | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderLeave::3da47c8665fb | frontend/src/main.ts:3839 | button | Day list | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderLeave::2a22ba2973f4 | frontend/src/main.ts:3857 | summary | Leave pressure used by the rota generator | native_disclosure | 0 | Not exercised |
| main-ts::-callback-::6be90fd2c6eb | frontend/src/main.ts:3951 | input | ${escapeHtml(callLevelLabel(row.call_level))} minimum free people | field_value_or_selection_change | 0 | Not exercised |
| main-ts::-callback-::65281e432668 | frontend/src/main.ts:3991 | button | ${escapeHtml(assignment.person.canonical_name)} | action_requires_contract_review | 9 | Not exercised |
| main-ts::renderUnitAssignmentsByUnit::232a2c500b5a | frontend/src/main.ts:4015 | button | Add unit | action_requires_contract_review | 3 | Not exercised |
| main-ts::-callback-::5cc621e11da5 | frontend/src/main.ts:4028 | button | Manage ${escapeHtml(label)} postings | action_requires_contract_review | 0 | Not exercised |
| main-ts::-callback-::9b6879e0ee91 | frontend/src/main.ts:4061 | button | Manage ${escapeHtml(unit.name)} | action_requires_contract_review | 4 | Not exercised |
| main-ts::-callback-::65281e432668::2 | frontend/src/main.ts:4086 | button | ${escapeHtml(assignment.person.canonical_name)} | action_requires_contract_review | 9 | Not exercised |
| main-ts::-callback-::d2702dcaba19 | frontend/src/main.ts:4094 | button | Manage ${escapeHtml(assignment.unit.name)} | action_requires_contract_review | 4 | Not exercised |
| main-ts::-callback-::c06ccc6ecd5a | frontend/src/main.ts:4096 | button | Manage ${escapeHtml(codeLabel(assignment.posting_type))} postings | action_requires_contract_review | 0 | Not exercised |
| main-ts::-callback-::0cc77d1dbee2 | frontend/src/main.ts:4099 | button | Delete posting… | reviewed_mutation_candidate | 1 | Not exercised |
| main-ts::renderUnitValidationIssues::a12064323159 | frontend/src/main.ts:4135 | summary | Setup issues ${errors ? badge(`${errors} ${errors === 1 ? "error" : "errors"}`, "danger") : ""} ${warnings ? badge(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`, "warning") : ""} | native_disclosure | 0 | Not exercised |
| main-ts::renderUnitIssueDetails::4eb6868e1d9c | frontend/src/main.ts:4224 | summary | Validation Clear | native_disclosure | 0 | Not exercised |
| main-ts::renderUnitIssueDetails::f7884d7fa890 | frontend/src/main.ts:4231 | summary | Validation ${issues.length} | native_disclosure | 0 | Not exercised |
| main-ts::-callback-::c339c5db6a5e | frontend/src/main.ts:4236 | button | ${escapeHtml(issue.message)} | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderSpecialPostingIssueDetails::10f5d5d8ca42 | frontend/src/main.ts:4265 | summary | Validation Clear | native_disclosure | 0 | Not exercised |
| main-ts::renderSpecialPostingIssueDetails::f7884d7fa890 | frontend/src/main.ts:4272 | summary | Validation ${issues.length} | native_disclosure | 0 | Not exercised |
| main-ts::-callback-::c339c5db6a5e::2 | frontend/src/main.ts:4277 | button | ${escapeHtml(issue.message)} | action_requires_contract_review | 1 | Not exercised |
| main-ts::-callback-::65281e432668::3 | frontend/src/main.ts:4312 | button | ${escapeHtml(assignment.person.canonical_name)} | action_requires_contract_review | 9 | Not exercised |
| main-ts::-callback-::5870efbcb9d2 | frontend/src/main.ts:4315 | button | Edit posting | action_requires_contract_review | 1 | Not exercised |
| main-ts::-callback-::eb4831fbbdcf | frontend/src/main.ts:4316 | button | Remove posting… | reviewed_mutation_candidate | 0 | Not exercised |
| main-ts::renderUnitModal::8bd46cb39d0e | frontend/src/main.ts:4355 | button | Previous unit | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderUnitModal::471c551e48a5 | frontend/src/main.ts:4356 | button | Next unit | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderUnitModal::7fdb9677a835 | frontend/src/main.ts:4357 | button | Close | dismissal_or_draft_decision | 0 | Not exercised |
| main-ts::renderUnitModal::152fb5895747 | frontend/src/main.ts:4369 | form | unit-settings-form | form_submission | 1 | Not exercised |
| main-ts::renderUnitModal::4bffa57abc9e | frontend/src/main.ts:4372 | input | unit-minimum-free-people | field_value_or_selection_change | 1 | Not exercised |
| main-ts::renderUnitModal::ed31d58c4819 | frontend/src/main.ts:4381 | button | Save Call-Wise Rules | reviewed_mutation_candidate | 0 | Not exercised |
| main-ts::renderUnitModal::23bc535d4ed5 | frontend/src/main.ts:4386 | button | Add member posting | action_requires_contract_review | 8 | Not exercised |
| main-ts::renderSpecialPostingModal::7fdb9677a835 | frontend/src/main.ts:4419 | button | Close | dismissal_or_draft_decision | 0 | Not exercised |
| main-ts::renderSpecialPostingModal::95165a0863ff | frontend/src/main.ts:4431 | button | Add member posting | action_requires_contract_review | 8 | Not exercised |
| main-ts::renderUnitManagement::28f49645e3b3 | frontend/src/main.ts:4488 | button | Try again | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderUnitManagement::dbba334f0cf7 | frontend/src/main.ts:4504 | a | Review issues | navigation_or_download | 0 | Not exercised |
| main-ts::renderUnitManagement::c802966f8771 | frontend/src/main.ts:4525 | button | Add posting | action_requires_contract_review | 8 | Not exercised |
| main-ts::renderUnitManagement::87d19e233d6a | frontend/src/main.ts:4526 | button | Import unitwise CSV | action_requires_contract_review | 11 | Not exercised |
| main-ts::renderUnitManagement::6b5d5c81ca51 | frontend/src/main.ts:4527 | button | Refresh postings | action_requires_contract_review | 4 | Not exercised |
| main-ts::renderUnitManagement::232a2c500b5a | frontend/src/main.ts:4528 | button | Add unit | action_requires_contract_review | 3 | Not exercised |
| main-ts::renderUnitManagement::43f77b883bd6 | frontend/src/main.ts:4530 | summary | More unit tools | native_disclosure | 0 | Not exercised |
| main-ts::renderUnitManagement::232a2c500b5a::2 | frontend/src/main.ts:4532 | button | Add unit | action_requires_contract_review | 3 | Not exercised |
| main-ts::renderUnitManagement::836ef268de1b | frontend/src/main.ts:4532 | button | Manage units | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderUnitManagement::b2446482be6e | frontend/src/main.ts:4532 | button | Labels and mappings | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderUnitManagement::02e1ff7f1968 | frontend/src/main.ts:4533 | a | Download CSV template | navigation_or_download | 0 | Not exercised |
| main-ts::renderUnitManagement::aa49d8b66079 | frontend/src/main.ts:4534 | a | Download example CSV | navigation_or_download | 0 | Not exercised |
| main-ts::renderUnitManagement::2295ed3e8b05 | frontend/src/main.ts:4535 | button | Delete all postings for ${escapeHtml(monthName)}… | reviewed_mutation_candidate | 0 | Not exercised |
| main-ts::renderUnitManagement::899c482505bd | frontend/src/main.ts:4553 | input | search | field_value_or_selection_change | 9 | Not exercised |
| main-ts::renderUnitManagement::7aa14cc9021d | frontend/src/main.ts:4554 | select | select | field_value_or_selection_change | 7 | Not exercised |
| main-ts::renderUnitManagement::4f38c93bc540 | frontend/src/main.ts:4555 | button | Clear unit filters | action_requires_contract_review | 0 | Not exercised |
| main-ts::-callback-::7a87238de34c | frontend/src/main.ts:4706 | button | ${count} ${escapeHtml(label)} | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderMembersView::3734325a6076 | frontend/src/main.ts:4715 | summary | ${memberAddPanelOpen ? 'Hide member form' : 'Add member'}${memberAddDraft ? ' Draft ' : ''} | native_disclosure | 0 | Not exercised |
| main-ts::renderMembersView::a752d3091060 | frontend/src/main.ts:4716 | form | create-member-form | form_submission | 3 | Not exercised |
| main-ts::renderMembersView::a1724be464bd | frontend/src/main.ts:4718 | input | new-member-name | field_value_or_selection_change | 6 | Not exercised |
| main-ts::renderMembersView::994226c8c8bd | frontend/src/main.ts:4719 | button | Add member | action_requires_contract_review | 7 | Not exercised |
| main-ts::renderMembersView::0d317eb28b1a | frontend/src/main.ts:4723 | button | Import CSV | action_requires_contract_review | 5 | Not exercised |
| main-ts::renderMembersView::48a2cde5db9a | frontend/src/main.ts:4725 | summary | More member tools | native_disclosure | 0 | Not exercised |
| main-ts::renderMembersView::83139f9dfb36 | frontend/src/main.ts:4727 | a | Download CSV template | navigation_or_download | 0 | Not exercised |
| main-ts::renderMembersView::be8bd4926194 | frontend/src/main.ts:4728 | a | Download example CSV | navigation_or_download | 0 | Not exercised |
| main-ts::renderMembersView::7a7ac59bf28c | frontend/src/main.ts:4729 | button | Clean invalid names | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderMembersView::b56a935a0627 | frontend/src/main.ts:4730 | button | Prefill call levels | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderMembersView::fe2d9233d18b | frontend/src/main.ts:4731 | button | Reconcile trusted roster | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderMembersView::ad52a844b1ea | frontend/src/main.ts:4732 | button | Review possible duplicates | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderMembersView::74f6c8504f4b | frontend/src/main.ts:4733 | button | Clear all members… | action_requires_contract_review | 0 | Not exercised |
| main-ts::-callback-::8a21b3bb33f5 | frontend/src/main.ts:4750 | button | ${label} ${count} | action_requires_contract_review | 5 | Not exercised |
| main-ts::renderMembersView::0e396ef112bf | frontend/src/main.ts:4754 | input | member-search | field_value_or_selection_change | 10 | Not exercised |
| main-ts::renderMembersView::68c254c9a644 | frontend/src/main.ts:4755 | button | Clear filters | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderMembersView::d28f1a2cf17b | frontend/src/main.ts:4758 | select | member-sort | field_value_or_selection_change | 1 | Not exercised |
| main-ts::renderMembersView::ac0e95c33cc9 | frontend/src/main.ts:4761 | summary | Position and call filters ${Number(memberPositionFilter !== 'all') + Number(memberCallLevelFilter !== 'all')} applied | native_disclosure | 0 | Not exercised |
| main-ts::renderMembersView::9224cac31a10 | frontend/src/main.ts:4764 | select | member-position-filter | field_value_or_selection_change | 0 | Not exercised |
| main-ts::renderMembersView::6764be26edab | frontend/src/main.ts:4766 | select | member-call-filter | field_value_or_selection_change | 0 | Not exercised |
| main-ts::-callback-::453f456b3a17 | frontend/src/main.ts:4773 | button | ${label} ${count} | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderMembersView::e36f62f96c59 | frontend/src/main.ts:4785 | a | Member list | navigation_or_download | 0 | Not exercised |
| main-ts::renderMembersView::42d0dfd16d16 | frontend/src/main.ts:4785 | a | Workbook import | navigation_or_download | 0 | Not exercised |
| main-ts::renderMembersView::2ac974103f27 | frontend/src/main.ts:4786 | a | Import history | navigation_or_download | 0 | Not exercised |
| main-ts::renderMembersView::50b5a92d4cae | frontend/src/main.ts:4804 | button | Member${sortIndicator("name")} | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderMembersView::b8753fa59429 | frontend/src/main.ts:4805 | button | Call level${sortIndicator("call_level")} | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderMembersView::5980f8ef1813 | frontend/src/main.ts:4806 | button | Status${sortIndicator("status")} | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderMembersView::57fcd057c50d | frontend/src/main.ts:4817 | summary | Position mix | native_disclosure | 0 | Not exercised |
| main-ts::renderCallClusters::48f38e99e3b2 | frontend/src/main.ts:4938 | button | Try again | action_requires_contract_review | 1 | Not exercised |
| main-ts::-callback-::65a69bb4cb96 | frontend/src/main.ts:4944 | button | ${escapeHtml(cluster.name)} | action_requires_contract_review | 2 | Not exercised |
| main-ts::-callback-::9b6e61af3407 | frontend/src/main.ts:4962 | input | true | field_value_or_selection_change | 1 | Not exercised |
| main-ts::renderCallClusters::55fb9596b61f | frontend/src/main.ts:4975 | button | Open Rota Rules | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderCallClusters::b713a539c32f | frontend/src/main.ts:4978 | form | call-cluster-form | form_submission | 1 | Not exercised |
| main-ts::renderCallClusters::d0092d52e288 | frontend/src/main.ts:4982 | input | call-cluster-name | field_value_or_selection_change | 2 | Not exercised |
| main-ts::renderCallClusters::e9e3cda4569d | frontend/src/main.ts:4983 | select | call-cluster-level | field_value_or_selection_change | 2 | Not exercised |
| main-ts::renderCallClusters::492caf70523b | frontend/src/main.ts:4984 | input | call-cluster-description | field_value_or_selection_change | 2 | Not exercised |
| main-ts::renderCallClusters::02d33c335369 | frontend/src/main.ts:4991 | input | call-cluster-active | field_value_or_selection_change | 0 | Not exercised |
| main-ts::renderCallClusters::7805b665eb42 | frontend/src/main.ts:4993 | button | ${activeCallCluster ? "Save Group" : "Create Group"} | reviewed_mutation_candidate | 2 | Not exercised |
| main-ts::renderCallClusters::44e7046e627d | frontend/src/main.ts:4994 | button | New | action_requires_contract_review | 2 | Not exercised |
| main-ts::renderCallClusters::79e1f1c89273 | frontend/src/main.ts:5005 | form | call-cluster-members-form | form_submission | 1 | Not exercised |
| main-ts::renderCallClusters::7a0ace190902 | frontend/src/main.ts:5011 | input | cluster-member-search | field_value_or_selection_change | 0 | Not exercised |
| main-ts::renderCallClusters::8b09cc56c049 | frontend/src/main.ts:5013 | input | cluster-effective-from | field_value_or_selection_change | 1 | Not exercised |
| main-ts::renderCallClusters::c817185c5096 | frontend/src/main.ts:5014 | button | Save Members | reviewed_mutation_candidate | 2 | Not exercised |
| main-ts::renderRotaSetup::df4693ed94f9 | frontend/src/main.ts:5034 | button | Try again | action_requires_contract_review | 6 | Not exercised |
| main-ts::-callback-::3083e5a10ee8 | frontend/src/main.ts:5080 | select | Include ${escapeHtml(unit.unit_name)} in ${escapeHtml(monthName)} | field_value_or_selection_change | 1 | Not exercised |
| main-ts::renderRotaSetup::edad843daf82 | frontend/src/main.ts:5106 | button | Go to Rota Template | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderRotaSetup::f21a8b66afd2 | frontend/src/main.ts:5125 | form | rota-setup-form | form_submission | 0 | Not exercised |
| main-ts::renderRotaSetup::77b69988754c | frontend/src/main.ts:5129 | button | Copy last month's units | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderRotaSetup::3a83f340c4b5 | frontend/src/main.ts:5130 | button | Save scope | reviewed_mutation_candidate | 1 | Not exercised |
| main-ts::renderRotaSetup::756f72dc3f98 | frontend/src/main.ts:5144 | input | scope-locked | field_value_or_selection_change | 1 | Not exercised |
| main-ts::renderRotaSetup::a7ff0c24c816 | frontend/src/main.ts:5146 | input | scope-lock-reason | field_value_or_selection_change | 1 | Not exercised |
| main-ts::renderRotaSetup::ed2f468657a3 | frontend/src/main.ts:5148 | input | scope-safety-excluded | field_value_or_selection_change | 0 | Not exercised |
| main-ts::-callback-::ef12eb5b85d6 | frontend/src/main.ts:5216 | button | All | action_requires_contract_review | 0 | Not exercised |
| main-ts::-callback-::0a57f5b3e35c | frontend/src/main.ts:5217 | button | Clear | action_requires_contract_review | 0 | Not exercised |
| main-ts::-callback-::8362127d0395 | frontend/src/main.ts:5223 | input | checkbox | field_value_or_selection_change | 0 | Not exercised |
| main-ts::renderCandidateSuggestion::63aa287bd693 | frontend/src/main.ts:5501 | button | ${canAccept ? "Use" : "Review"} | action_requires_contract_review | 211 | Not exercised |
| main-ts::renderCandidateSuggestion::2ccff2ec8ebd | frontend/src/main.ts:5502 | button | Reject | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderCandidateSuggestionSection::8cc74e6cce92 | frontend/src/main.ts:5560 | button | ${expanded ? "Hide" : "Show"} | action_requires_contract_review | 0 | Not exercised |
| main-ts::-callback-::4bf2ebf28c9d | frontend/src/main.ts:5644 | button | Clear assignment… | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderManualAssignmentControls::e949effbb6b4 | frontend/src/main.ts:5669 | select | assign-person-${escapeHtml(slot.id)} | field_value_or_selection_change | 3 | Not exercised |
| main-ts::renderManualAssignmentControls::8e1ea71c0b64 | frontend/src/main.ts:5677 | input | input | field_value_or_selection_change | 3 | Not exercised |
| main-ts::renderManualAssignmentControls::9af406f4a5e8 | frontend/src/main.ts:5679 | input | checkbox | field_value_or_selection_change | 2 | Not exercised |
| main-ts::renderManualAssignmentControls::a343f1c145e9 | frontend/src/main.ts:5682 | button | ${hasAssignments ? "Replace" : "Assign"} | action_requires_contract_review | 1 | Not exercised |
| main-ts::-callback-::8d037281a86a | frontend/src/main.ts:5791 | button | ${slots.length} rota slot${slots.length === 1 ?  | action_requires_contract_review | 3 | Not exercised |
| main-ts::-callback-::a7ee846536e7 | frontend/src/main.ts:6092 | button | ${escapeHtml(mode.label)} | action_requires_contract_review | 0 | Not exercised |
| main-ts::-callback-::91e63dbd888a | frontend/src/main.ts:6116 | article | article | action_requires_contract_review | 3 | Not exercised |
| main-ts::renderRotaTemplateOverview::8da1348b80e8 | frontend/src/main.ts:6181 | summary | Show remaining ${safety.unit_day_safety.length - 100} unit-day checks | native_disclosure | 0 | Not exercised |
| main-ts::renderRotaDayModal::bc0837aaa73f | frontend/src/main.ts:6411 | button | Previous rota day | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderRotaDayModal::033dd583db12 | frontend/src/main.ts:6412 | button | Next rota day | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderRotaDayModal::8992a3df7b95 | frontend/src/main.ts:6413 | button | Close | dismissal_or_draft_decision | 0 | Not exercised |
| main-ts::renderRotaDayModal::90ac2ed394ad | frontend/src/main.ts:6418 | button | Full | action_requires_contract_review | 3 | Not exercised |
| main-ts::renderRotaDayModal::3d6ae4169e17 | frontend/src/main.ts:6419 | button | Compact list | action_requires_contract_review | 3 | Not exercised |
| main-ts::renderRotaDayModal::de0faefda6ee | frontend/src/main.ts:6420 | button | Eagle eye | action_requires_contract_review | 3 | Not exercised |
| main-ts::renderRotaTemplateRecovery::edad843daf82 | frontend/src/main.ts:6563 | button | Try again | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderRotaTemplateRecovery::6d9c58aeb59d | frontend/src/main.ts:6566 | input | rota-template-fast-mode | field_value_or_selection_change | 0 | Not exercised |
| main-ts::renderRotaTemplateRecovery::6ddfeaaacc01 | frontend/src/main.ts:6569 | summary | Clear duties | native_disclosure | 0 | Not exercised |
| main-ts::renderRotaTemplateRecovery::c78a97661549 | frontend/src/main.ts:6571 | button | Clear draft duties… | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderRotaTemplateRecovery::67b29b2098b4 | frontend/src/main.ts:6572 | button | Clear duties and assignments… | action_requires_contract_review | 0 | Not exercised |
| main-ts::templateNextStep::df4693ed94f9 | frontend/src/main.ts:6583 | button | Go to Rota Setup | action_requires_contract_review | 6 | Not exercised |
| main-ts::templateNextStep::bfe5b5c27f76 | frontend/src/main.ts:6594 | button | Go to Rota Review | action_requires_contract_review | 6 | Not exercised |
| main-ts::generationReadiness::ec1f287411b4 | frontend/src/main.ts:6609 | button | ${escapeHtml(computeEngineLabel())} | action_requires_contract_review | 6 | Not exercised |
| main-ts::generationReadiness::0ab7a52febdd | frontend/src/main.ts:6610 | button | Preview extra duties | action_requires_contract_review | 0 | Not exercised |
| main-ts::generationReadiness::0a6f45cd35b8 | frontend/src/main.ts:6610 | button | Fill remaining duties (all units) | action_requires_contract_review | 0 | Not exercised |
| main-ts::generationReadiness::6892d79be96b | frontend/src/main.ts:6612 | button | Build template | action_requires_contract_review | 2 | Not exercised |
| main-ts::generationReadiness::c37e7fee6a4d | frontend/src/main.ts:6612 | button | Autoassign members | action_requires_contract_review | 5 | Not exercised |
| main-ts::generationReadiness::bfe5b5c27f76 | frontend/src/main.ts:6612 | button | Review draft | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderRotaTemplate::1280bba6638a | frontend/src/main.ts:6672 | form | rota-template-form | form_submission | 0 | Not exercised |
| main-ts::renderRotaTemplate::9d2737888a2c | frontend/src/main.ts:6676 | button | ${template.slots.length ? "Preview rebuilt template" : "Build template"} | action_requires_contract_review | 5 | Not exercised |
| main-ts::renderRotaTemplate::c37e7fee6a4d | frontend/src/main.ts:6677 | button | Autoassign members | action_requires_contract_review | 5 | Not exercised |
| main-ts::renderRotaTemplate::1ee62adb8d5b | frontend/src/main.ts:6678 | button | Whole-month optimisation | action_requires_contract_review | 2 | Not exercised |
| main-ts::renderRotaTemplate::d476c0e06788 | frontend/src/main.ts:6680 | summary | Export rota | native_disclosure | 0 | Not exercised |
| main-ts::renderRotaTemplate::8cadafaec4f9 | frontend/src/main.ts:6682 | button | Eagle Eye workbook | action_requires_contract_review | 4 | Not exercised |
| main-ts::renderRotaTemplate::6f56aea09a54 | frontend/src/main.ts:6683 | button | Call-wise workbook | action_requires_contract_review | 2 | Not exercised |
| main-ts::renderRotaTemplate::cd86f9225f3d | frontend/src/main.ts:6687 | summary | Clear duties | native_disclosure | 0 | Not exercised |
| main-ts::renderRotaTemplate::c78a97661549 | frontend/src/main.ts:6689 | button | Clear draft duties… | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderRotaTemplate::67b29b2098b4 | frontend/src/main.ts:6690 | button | Clear duties and assignments… | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderRotaTemplate::6c01856c7b3e | frontend/src/main.ts:6702 | summary | All safety and suggestion figures | native_disclosure | 0 | Not exercised |
| main-ts::renderRotaTemplate::6d9c58aeb59d | frontend/src/main.ts:6718 | input | rota-template-fast-mode | field_value_or_selection_change | 0 | Not exercised |
| main-ts::renderRotaTemplate::4c61d46c1fdb | frontend/src/main.ts:6722 | summary | Template Generation Settings ${selectedDutyCount} of ${template.duty_options.length} duty types selected. ${selectedMandatoryCount} mandatory and ${selectedAdjustableCount} adjustable duties included. | native_disclosure | 0 | Not exercised |
| main-ts::renderRotaTemplate::0c2b5f9bfd88 | frontend/src/main.ts:6733 | input | template-start | field_value_or_selection_change | 1 | Not exercised |
| main-ts::renderRotaTemplate::63794f685be0 | frontend/src/main.ts:6734 | input | template-end | field_value_or_selection_change | 1 | Not exercised |
| main-ts::renderRotaTemplate::55f26f91cba0 | frontend/src/main.ts:6736 | select | template-fairness-policy | field_value_or_selection_change | 0 | Not exercised |
| main-ts::renderRotaTemplate::7d8ad1543cbe | frontend/src/main.ts:6744 | input | template-weekdays | field_value_or_selection_change | 0 | Not exercised |
| main-ts::renderRotaTemplate::249416bd1dd9 | frontend/src/main.ts:6745 | input | template-weekends | field_value_or_selection_change | 0 | Not exercised |
| main-ts::renderRotaTemplate::08753410c4da | frontend/src/main.ts:6746 | input | template-replace | field_value_or_selection_change | 0 | Not exercised |
| main-ts::renderRotaTemplate::dc01d2e8537c | frontend/src/main.ts:6758 | button | Save Settings & Generate Template | reviewed_mutation_candidate | 0 | Not exercised |
| main-ts::-callback-::6ebd84c621e1 | frontend/src/main.ts:6834 | button | ${escapeHtml(filter.label)} ${reviewFilterCount(review, filter.key)} | action_requires_contract_review | 1 | Not exercised |
| main-ts::-callback-::d5acc4be4f08 | frontend/src/main.ts:6905 | button | ${escapeHtml(action)} | action_requires_contract_review | 2 | Not exercised |
| main-ts::-callback-::4b145bcdf98d | frontend/src/main.ts:6906 | button | Day | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderReviewCandidateCards::5fe33160baf8 | frontend/src/main.ts:6946 | button | Load Suggestions | action_requires_contract_review | 0 | Not exercised |
| main-ts::-callback-::f25ca0c15a4d | frontend/src/main.ts:6986 | button | ${issue.code === "override_assignment" ? "Confirm Override" : "Accept Warning"} | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderRotaReviewSlotModal::b0cc438b4292 | frontend/src/main.ts:7005 | button | Close | dismissal_or_draft_decision | 1 | Not exercised |
| main-ts::renderRotaReviewSlotModal::4b145bcdf98d | frontend/src/main.ts:7031 | button | Open Full Day | action_requires_contract_review | 0 | Not exercised |
| main-ts::renderRotaReviewSlotModal::b0cc438b4292::2 | frontend/src/main.ts:7034 | button | Close | dismissal_or_draft_decision | 1 | Not exercised |
| main-ts::-callback-::c829b0d24938 | frontend/src/main.ts:7245 | input | input | field_value_or_selection_change | 0 | Not exercised |
| main-ts::-callback-::9580fa9a0171 | frontend/src/main.ts:7246 | button | Approve | reviewed_mutation_candidate | 0 | Not exercised |
| main-ts::-callback-::6ce48295d6a1 | frontend/src/main.ts:7247 | button | Reject | action_requires_contract_review | 0 | Not exercised |
| main-ts::reviewNextStep::edad843daf82 | frontend/src/main.ts:7260 | button | Go to Rota Template | action_requires_contract_review | 6 | Not exercised |
| main-ts::reviewNextStep::75693eab48ad | frontend/src/main.ts:7273 | button | Go to Publish | reviewed_mutation_candidate | 6 | Not exercised |
| main-ts::renderRotaReview::edad843daf82 | frontend/src/main.ts:7308 | button | Open template | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderRotaReview::75693eab48ad | frontend/src/main.ts:7309 | button | Go to Publish | reviewed_mutation_candidate | 6 | Not exercised |
| main-ts::renderRotaReview::746c96e202dd | frontend/src/main.ts:7319 | summary | Workload and fairness figures | native_disclosure | 0 | Not exercised |
| main-ts::renderRotaReview::da046c04634e | frontend/src/main.ts:7364 | form | rota-exchange-form | form_submission | 0 | Not exercised |
| main-ts::renderRotaReview::e9d4565edab0 | frontend/src/main.ts:7365 | select | exchange-assignment | field_value_or_selection_change | 0 | Not exercised |
| main-ts::renderRotaReview::f6de52960b77 | frontend/src/main.ts:7366 | select | exchange-target | field_value_or_selection_change | 0 | Not exercised |
| main-ts::renderRotaReview::2afaa255b17d | frontend/src/main.ts:7367 | input | exchange-reason | field_value_or_selection_change | 0 | Not exercised |
| main-ts::renderRotaReview::ca831056a554 | frontend/src/main.ts:7368 | button | Request Exchange | action_requires_contract_review | 0 | Not exercised |
| main-ts::-callback-::61c74bd87900 | frontend/src/main.ts:7399 | article | article | action_requires_contract_review | 0 | Not exercised |
| main-ts::-callback-::04eff29c6cfd | frontend/src/main.ts:7457 | button | ${escapeHtml(fix.label)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderRotaPublish::12ebe23da17e | frontend/src/main.ts:7486 | button | Retry checklist | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderRotaPublish::3ab149c92095 | frontend/src/main.ts:7496 | a | Go to export | navigation_or_download | 0 | Not exercised |
| main-ts::renderRotaPublish::bfe5b5c27f76 | frontend/src/main.ts:7504 | button | Open review | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderRotaPublish::bb60aa1a22ce | frontend/src/main.ts:7531 | form | rota-publish-form | form_submission | 4 | Not exercised |
| main-ts::renderRotaPublish::f03e00eeb9d1 | frontend/src/main.ts:7533 | input | publish-confirm-warnings | field_value_or_selection_change | 3 | Not exercised |
| main-ts::renderRotaPublish::b68b831bcf0a | frontend/src/main.ts:7536 | textarea | publish-approval-note | field_value_or_selection_change | 3 | Not exercised |
| main-ts::renderRotaPublish::e4345f0da388 | frontend/src/main.ts:7539 | button | Publish final rota | reviewed_mutation_candidate | 0 | Not exercised |
| main-ts::renderRotaPublish::ddf58f7a0d87 | frontend/src/main.ts:7550 | button | Download Excel | download_artifact | 5 | Not exercised |
| main-ts::renderAccounts::9597199d29c6 | frontend/src/main.ts:7573 | button | Try again | action_requires_contract_review | 1 | Not exercised |
| main-ts::-callback-::b42b8a9202e6 | frontend/src/main.ts:7581 | button | Issue Recovery Code | action_requires_contract_review | 2 | Not exercised |
| main-ts::renderAccounts::1a31269e51f1 | frontend/src/main.ts:7591 | form | account-form | form_submission | 5 | Not exercised |
| main-ts::renderAccounts::827c76912df5 | frontend/src/main.ts:7593 | input | Username | field_value_or_selection_change | 3 | Not exercised |
| main-ts::renderAccounts::7e9be3e18945 | frontend/src/main.ts:7595 | input | Display name | field_value_or_selection_change | 2 | Not exercised |
| main-ts::renderAccounts::a4f73ace700d | frontend/src/main.ts:7597 | input | Password | field_value_or_selection_change | 2 | Not exercised |
| main-ts::renderAccounts::2f421474fcfa | frontend/src/main.ts:7600 | select | Role | field_value_or_selection_change | 3 | Not exercised |
| main-ts::renderAccounts::8c7ded19f4e7 | frontend/src/main.ts:7606 | button | Create | action_requires_contract_review | 2 | Not exercised |
| main-ts::-callback-::b42b8a9202e6::2 | frontend/src/main.ts:7613 | button | Issue Recovery Code | action_requires_contract_review | 2 | Not exercised |
| main-ts::renderDiagnostics::c6975e9207e2 | frontend/src/main.ts:7657 | summary | Invalid-name rules | native_disclosure | 0 | Not exercised |
| main-ts::renderDiagnostics::453879c03b7a | frontend/src/main.ts:7658 | summary | Shareable diagnostics JSON | native_disclosure | 0 | Not exercised |
| main-ts::renderDiagnostics::5f8c6cb67796 | frontend/src/main.ts:7659 | button | Copy JSON | action_requires_contract_review | 1 | Not exercised |
| main-ts::renderDiagnostics::e48e8d7ae8a9 | frontend/src/main.ts:7662 | summary | Support details | native_disclosure | 0 | Not exercised |
| main-ts::renderDiagnostics::d9539d4bd253 | frontend/src/main.ts:7667 | button | Try again | action_requires_contract_review | 1 | Not exercised |
| main-ts::guideAction::17b3b1786796 | frontend/src/main.ts:7680 | button | ${escapeHtml(label)} | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderUserGuide::3ef82fab8f85 | frontend/src/main.ts:7694 | button | Start With Members | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderUserGuide::edad843daf82 | frontend/src/main.ts:7695 | button | Open Template | action_requires_contract_review | 6 | Not exercised |
| main-ts::renderUserGuide::bfe9b6715047 | frontend/src/main.ts:7702 | a | Phase 1: Data Readiness | navigation_or_download | 0 | Not exercised |
| main-ts::renderUserGuide::5a022087173c | frontend/src/main.ts:7703 | a | Phase 2: Rota Generation | navigation_or_download | 0 | Not exercised |
| main-ts::renderUserGuide::e1c57b05e538 | frontend/src/main.ts:7704 | a | Duty Eligibility | navigation_or_download | 0 | Not exercised |
| main-ts::renderUserGuide::4edcdb1815c1 | frontend/src/main.ts:7705 | a | Monthly Workflow | navigation_or_download | 0 | Not exercised |
| main-ts::renderUserGuide::cd4fa18f1cfe | frontend/src/main.ts:7706 | a | Website Sections | navigation_or_download | 0 | Not exercised |
| main-ts::renderUserGuide::8249345c1f43 | frontend/src/main.ts:7707 | a | Admin Tools | navigation_or_download | 0 | Not exercised |
| main-ts::renderUserGuide::2c1b6391690c | frontend/src/main.ts:7708 | a | Important Terms | navigation_or_download | 0 | Not exercised |
| main-ts::renderUserGuide::70c1915d6e15 | frontend/src/main.ts:7709 | a | Scores And Blocks | navigation_or_download | 0 | Not exercised |
| main-ts::renderUserGuide::a2c07a7e0510 | frontend/src/main.ts:7710 | a | Problems And Fixes | navigation_or_download | 0 | Not exercised |
| main-ts::renderUserGuide::d94612616745 | frontend/src/main.ts:7711 | a | Final Checklist | navigation_or_download | 0 | Not exercised |
| main-ts::updateRouteAvailabilityNotice::23ad8b8d0d85 | frontend/src/main.ts:8050 | button | Continue to Overview | action_requires_contract_review | 0 | Not exercised |
| main-ts::-callback-::ed13c67f70ac | frontend/src/main.ts:8155 | button | Try again | action_requires_contract_review | 6 | Not exercised |
| main-ts::bootApp::407dfba1a21e | frontend/src/main.ts:10379 | button | Retry startup | action_requires_contract_review | 2 | Not exercised |
| member-bulk-ts::-callback-::c2abd950bdc2 | frontend/src/member-bulk.ts:42 | button | Restore this batch | reviewed_mutation_candidate | 3 | Not exercised |
| member-bulk-ts::render::8344e4732b2a | frontend/src/member-bulk.ts:50 | button | Close clear all members | dismissal_or_draft_decision | 60 | Not exercised |
| member-bulk-ts::render::d7b4bf00b2a0 | frontend/src/member-bulk.ts:57 | button | Undo: restore these ${result.archived} members | reviewed_mutation_candidate | 3 | Not exercised |
| member-bulk-ts::render::8344e4732b2a::2 | frontend/src/member-bulk.ts:58 | button | Close | dismissal_or_draft_decision | 60 | Not exercised |
| member-bulk-ts::render::818e4c173897 | frontend/src/member-bulk.ts:64 | button | Try again | action_requires_contract_review | 1 | Not exercised |
| member-bulk-ts::render::9c02931b1b4c | frontend/src/member-bulk.ts:76 | input | text | field_value_or_selection_change | 3 | Not exercised |
| member-bulk-ts::render::1937adc952d5 | frontend/src/member-bulk.ts:80 | button | ${busy ? "Archiving…" : `Archive all ${preview.members} members`} | action_requires_contract_review | 5 | Not exercised |
| member-bulk-ts::render::8344e4732b2a::3 | frontend/src/member-bulk.ts:81 | button | Cancel | dismissal_or_draft_decision | 60 | Not exercised |
| member-duplicates-ts::-callback-::a5d00faf55b6 | frontend/src/member-duplicates.ts:56 | input | keep-${index} | field_value_or_selection_change | 0 | Not exercised |
| member-duplicates-ts::cardHtml::b74943113d32 | frontend/src/member-duplicates.ts:59 | button | Review merge into ${esc(keep.canonical_name)}… | action_requires_contract_review | 3 | Not exercised |
| member-duplicates-ts::cardHtml::e27f3a38b943 | frontend/src/member-duplicates.ts:60 | button | Not the same person | action_requires_contract_review | 1 | Not exercised |
| member-duplicates-ts::previewHtml::1c56801eb1c9 | frontend/src/member-duplicates.ts:75 | summary | ${esc(plural(combined.length, "duplicate"))} combined instead of copied | native_disclosure | 0 | Not exercised |
| member-duplicates-ts::-callback-::62901627b830 | frontend/src/member-duplicates.ts:79 | input | conflict-${esc(c.id)} | field_value_or_selection_change | 1 | Not exercised |
| member-duplicates-ts::-callback-::62901627b830::2 | frontend/src/member-duplicates.ts:80 | input | conflict-${esc(c.id)} | field_value_or_selection_change | 1 | Not exercised |
| member-duplicates-ts::previewHtml::84df63717618 | frontend/src/member-duplicates.ts:84 | button | Confirm merge | action_requires_contract_review | 1 | Not exercised |
| member-duplicates-ts::previewHtml::7f723531bfef | frontend/src/member-duplicates.ts:85 | button | Cancel | dismissal_or_draft_decision | 0 | Not exercised |
| member-duplicates-ts::mergesHtml::d73af3525a92 | frontend/src/member-duplicates.ts:92 | summary | Recent merges (${merges.length}) | native_disclosure | 0 | Not exercised |
| member-duplicates-ts::-callback-::3dda0f541814 | frontend/src/member-duplicates.ts:94 | button | Undo merge | action_requires_contract_review | 1 | Not exercised |
| member-duplicates-ts::openSuspectedDuplicates::8344e4732b2a | frontend/src/member-duplicates.ts:102 | button | Close ${TITLE} | dismissal_or_draft_decision | 60 | Not exercised |
| member-duplicates-ts::load::56bb75e41634 | frontend/src/member-duplicates.ts:144 | button | Try again | action_requires_contract_review | 13 | Not exercised |
| member-duplicates-ts::-callback-::ccd3b7527515 | frontend/src/member-duplicates.ts:273 | button | Undo merge | action_requires_contract_review | 1 | Not exercised |
| member-import-history-ts::mountMemberImportHistory::6766a896b21d | frontend/src/member-import-history.ts:30 | div | Member import batch history | action_requires_contract_review | 0 | Not exercised |
| member-import-history-ts::-callback-::ae31f0156904 | frontend/src/member-import-history.ts:34 | button | View Rows | action_requires_contract_review | 1 | Not exercised |
| member-import-history-ts::-callback-::17ef1dfbcadd | frontend/src/member-import-history.ts:49 | div | Recorded member import source rows | action_requires_contract_review | 0 | Not exercised |
| member-import-history-ts::mountMemberImportHistory::f02af18ec95e | frontend/src/member-import-history.ts:61 | button | Try again | action_requires_contract_review | 0 | Not exercised |
| member-import-ts::rowActions::fdc3d8d99653 | frontend/src/member-import.ts:90 | button | ${row.action === "skip" ? "Include this row again" : "Undo my choice"} | action_requires_contract_review | 0 | Not exercised |
| member-import-ts::rowActions::ede6584d03ae | frontend/src/member-import.ts:94 | button | This is a different person | action_requires_contract_review | 0 | Not exercised |
| member-import-ts::rowActions::cf4c37ef7fae | frontend/src/member-import.ts:97 | button | Skip this row | action_requires_contract_review | 0 | Not exercised |
| member-import-ts::render::03f9febc2174 | frontend/src/member-import.ts:117 | summary | Import and Review Members | native_disclosure | 0 | Not exercised |
| member-import-ts::render::b39baa07e542 | frontend/src/member-import.ts:125 | button | Download Excel Template | download_artifact | 1 | Not exercised |
| member-import-ts::render::5271b53f0a6b | frontend/src/member-import.ts:126 | button | Download CSV Template (Name + Call Level) | download_artifact | 1 | Not exercised |
| member-import-ts::render::7ecde553b42e | frontend/src/member-import.ts:127 | input | file | field_value_or_selection_change | 1 | Not exercised |
| member-import-ts::render::235389503a6d | frontend/src/member-import.ts:129 | input | number | field_value_or_selection_change | 1 | Not exercised |
| member-import-ts::render::e9c24c8c361a | frontend/src/member-import.ts:130 | button | Read File and Columns | action_requires_contract_review | 1 | Not exercised |
| member-import-ts::render::af9e7a76c294 | frontend/src/member-import.ts:131 | select | select | field_value_or_selection_change | 1 | Not exercised |
| member-import-ts::-callback-::b46a83d40371 | frontend/src/member-import.ts:134 | select | select | field_value_or_selection_change | 0 | Not exercised |
| member-import-ts::render::abad1c6d7533 | frontend/src/member-import.ts:136 | button | Preview Normalized Members | action_requires_contract_review | 1 | Not exercised |
| member-import-ts::render::7e4c8a60ee8f | frontend/src/member-import.ts:139 | select | select | field_value_or_selection_change | 1 | Not exercised |
| member-import-ts::render::a0bf76413bfe | frontend/src/member-import.ts:141 | button | Download Rejected Rows CSV | download_artifact | 1 | Not exercised |
| member-import-ts::-callback-::4414c597a474 | frontend/src/member-import.ts:149 | summary | Edit row | native_disclosure | 0 | Not exercised |
| member-import-ts::-callback-::c79a1cf7dde4 | frontend/src/member-import.ts:150 | select | Resolve file row ${row.row} | field_value_or_selection_change | 0 | Not exercised |
| member-import-ts::render::db2bfa57bac2 | frontend/src/member-import.ts:158 | input | checkbox | field_value_or_selection_change | 1 | Not exercised |
| member-import-ts::render::001323be2dbf | frontend/src/member-import.ts:161 | button | Apply Reviewed Import | reviewed_mutation_candidate | 1 | Not exercised |
| member-profile-ts::openMemberProfile::ff422bf1b31b | frontend/src/member-profile.ts:23 | button | Close | dismissal_or_draft_decision | 5 | Not exercised |
| member-profile-ts::render::ff422bf1b31b | frontend/src/member-profile.ts:106 | button | Close | dismissal_or_draft_decision | 5 | Not exercised |
| member-profile-ts::render::e8679c16ba63 | frontend/src/member-profile.ts:108 | button | Refresh profile | action_requires_contract_review | 2 | Not exercised |
| member-profile-ts::render::0c0b74f4c97d | frontend/src/member-profile.ts:114 | form | form | form_submission | 8 | Not exercised |
| member-profile-ts::render::1fd8ab6e351b | frontend/src/member-profile.ts:115 | select | call_level | field_value_or_selection_change | 0 | Not exercised |
| member-profile-ts::render::45955852000c | frontend/src/member-profile.ts:116 | input | effective_from | field_value_or_selection_change | 0 | Not exercised |
| member-profile-ts::render::1d38c84e4b2d | frontend/src/member-profile.ts:117 | textarea | reason | field_value_or_selection_change | 0 | Not exercised |
| member-profile-ts::render::154af851d676 | frontend/src/member-profile.ts:118 | button | Record Call Change | action_requires_contract_review | 0 | Not exercised |
| member-profile-ts::render::8cd197c9f718 | frontend/src/member-profile.ts:120 | form | form | form_submission | 8 | Not exercised |
| member-profile-ts::render::829565de894e | frontend/src/member-profile.ts:120 | input | designation | field_value_or_selection_change | 0 | Not exercised |
| member-profile-ts::render::45955852000c::2 | frontend/src/member-profile.ts:120 | input | effective_from | field_value_or_selection_change | 0 | Not exercised |
| member-profile-ts::render::d59598a725fe | frontend/src/member-profile.ts:120 | button | Add Designation | action_requires_contract_review | 0 | Not exercised |
| member-profile-ts::render::db8e13d7d28c | frontend/src/member-profile.ts:122 | form | form | form_submission | 8 | Not exercised |
| member-profile-ts::render::514a149b8351 | frontend/src/member-profile.ts:122 | input | alias | field_value_or_selection_change | 0 | Not exercised |
| member-profile-ts::render::3805784afc46 | frontend/src/member-profile.ts:122 | button | Add Alias | action_requires_contract_review | 0 | Not exercised |
| member-profile-ts::render::08c7ea70114c | frontend/src/member-profile.ts:125 | form | form | form_submission | 8 | Not exercised |
| member-profile-ts::render::0954914c6d7c | frontend/src/member-profile.ts:125 | textarea | body | field_value_or_selection_change | 0 | Not exercised |
| member-profile-ts::render::86f805fab91d | frontend/src/member-profile.ts:125 | button | Add Comment | action_requires_contract_review | 0 | Not exercised |
| member-profile-ts::render::d6d048e29162 | frontend/src/member-profile.ts:126 | summary | Unit Posting and Leave History | native_disclosure | 0 | Not exercised |
| member-profile-ts::render::41f3503c0d84 | frontend/src/member-profile.ts:128 | summary | Member Import Sources | native_disclosure | 0 | Not exercised |
| member-profile-ts::render::bd0bae68323f | frontend/src/member-profile.ts:129 | summary | Edit Member Details | native_disclosure | 0 | Not exercised |
| member-profile-ts::render::3cac959b3681 | frontend/src/member-profile.ts:129 | form | form | form_submission | 8 | Not exercised |
| member-profile-ts::render::fb574fa01095 | frontend/src/member-profile.ts:129 | input | name | field_value_or_selection_change | 0 | Not exercised |
| member-profile-ts::render::8c311c1fd2be | frontend/src/member-profile.ts:129 | select | status | field_value_or_selection_change | 0 | Not exercised |
| member-profile-ts::render::350f7ff04718 | frontend/src/member-profile.ts:129 | button | Save Member Details | reviewed_mutation_candidate | 0 | Not exercised |
| member-profile-ts::openMemberProfile::ff422bf1b31b::2 | frontend/src/member-profile.ts:219 | button | Close | dismissal_or_draft_decision | 5 | Not exercised |
| member-workspace-ts::-callback-::e28ddf80616e | frontend/src/member-workspace.ts:401 | input | input | field_value_or_selection_change | 44 | Not exercised |
| member-workspace-ts::-callback-::12a62788b5bc | frontend/src/member-workspace.ts:401 | input | date | field_value_or_selection_change | 44 | Not exercised |
| member-workspace-ts::-callback-::3a950b0c6810 | frontend/src/member-workspace.ts:401 | input | date | field_value_or_selection_change | 44 | Not exercised |
| member-workspace-ts::-callback-::a1620decdf35 | frontend/src/member-workspace.ts:401 | input | input | field_value_or_selection_change | 44 | Not exercised |
| member-workspace-ts::-callback-::a23bfb28c598 | frontend/src/member-workspace.ts:401 | button | Remove position | reviewed_mutation_candidate | 2 | Not exercised |
| member-workspace-ts::designationEditor::bb11857eba67 | frontend/src/member-workspace.ts:401 | button | Add position | action_requires_contract_review | 2 | Not exercised |
| member-workspace-ts::-callback-::b7ddef6abf5e | frontend/src/member-workspace.ts:419 | select | select | field_value_or_selection_change | 16 | Not exercised |
| member-workspace-ts::-callback-::3a7264a4c425 | frontend/src/member-workspace.ts:419 | input | date | field_value_or_selection_change | 16 | Not exercised |
| member-workspace-ts::-callback-::05f7896c4a71 | frontend/src/member-workspace.ts:419 | input | input | field_value_or_selection_change | 16 | Not exercised |
| member-workspace-ts::-callback-::faf8e9790a45 | frontend/src/member-workspace.ts:419 | button | Remove dated change | reviewed_mutation_candidate | 3 | Not exercised |
| member-workspace-ts::scheduledCalls::ffe0395e68e3 | frontend/src/member-workspace.ts:419 | button | Add dated call-level change | action_requires_contract_review | 3 | Not exercised |
| member-workspace-ts::detailedAnalysis::811ff30827b3 | frontend/src/member-workspace.ts:427 | summary | Day-of-week breakdown | native_disclosure | 0 | Not exercised |
| member-workspace-ts::detailedAnalysis::5595d637b2d1 | frontend/src/member-workspace.ts:433 | summary | Monthly call levels and units | native_disclosure | 0 | Not exercised |
| member-workspace-ts::detailedAnalysis::330d5727c14f | frontend/src/member-workspace.ts:433 | summary | Special postings | native_disclosure | 0 | Not exercised |
| member-workspace-ts::history::56bb75e41634 | frontend/src/member-workspace.ts:453 | button | Retry | action_requires_contract_review | 13 | Not exercised |
| member-workspace-ts::-callback-::923801e09a04 | frontend/src/member-workspace.ts:514 | button | Review duty records for ${esc(month)} | action_requires_contract_review | 1 | Not exercised |
| member-workspace-ts::history::f422df41fe4b | frontend/src/member-workspace.ts:520 | input | date | field_value_or_selection_change | 3 | Not exercised |
| member-workspace-ts::history::4875a27a7efb | frontend/src/member-workspace.ts:520 | input | date | field_value_or_selection_change | 2 | Not exercised |
| member-workspace-ts::history::7c31fac42e15 | frontend/src/member-workspace.ts:520 | button | Show all duty records | action_requires_contract_review | 1 | Not exercised |
| member-workspace-ts::-callback-::c7ebbfb7f18b | frontend/src/member-workspace.ts:545 | button | Edit ${tab === "postings" ? "posting" : "leave"} | action_requires_contract_review | 4 | Not exercised |
| member-workspace-ts::-callback-::1b3d9ae2c592 | frontend/src/member-workspace.ts:545 | button | Cancel leave | dismissal_or_draft_decision | 4 | Not exercised |
| member-workspace-ts::content::49e98a3be37f | frontend/src/member-workspace.ts:563 | button | Add or correct designation | action_requires_contract_review | 2 | Not exercised |
| member-workspace-ts::content::0787a1337c9e | frontend/src/member-workspace.ts:563 | button | Review call level | action_requires_contract_review | 2 | Not exercised |
| member-workspace-ts::content::00cf55e0fc6c | frontend/src/member-workspace.ts:563 | button | Review aliases and possible duplicates | action_requires_contract_review | 2 | Not exercised |
| member-workspace-ts::content::5f0789708acd | frontend/src/member-workspace.ts:565 | input | input | field_value_or_selection_change | 5 | Not exercised |
| member-workspace-ts::content::4960064c4fa0 | frontend/src/member-workspace.ts:565 | button | Copy member ID | action_requires_contract_review | 1 | Not exercised |
| member-workspace-ts::content::2a6d19de39c3 | frontend/src/member-workspace.ts:565 | input | input | field_value_or_selection_change | 29 | Not exercised |
| member-workspace-ts::content::b24131195bf9 | frontend/src/member-workspace.ts:565 | input | checkbox | field_value_or_selection_change | 1 | Not exercised |
| member-workspace-ts::content::f4646b6103e8 | frontend/src/member-workspace.ts:565 | select | select | field_value_or_selection_change | 29 | Not exercised |
| member-workspace-ts::content::80b8fd1ca25d | frontend/src/member-workspace.ts:565 | select | select | field_value_or_selection_change | 29 | Not exercised |
| member-workspace-ts::content::380beccc53be | frontend/src/member-workspace.ts:567 | button | Manage designations and aliases | action_requires_contract_review | 1 | Not exercised |
| member-workspace-ts::-callback-::43dee29265ff | frontend/src/member-workspace.ts:569 | button | Remove alias ${esc(a.alias)} | reviewed_mutation_candidate | 2 | Not exercised |
| member-workspace-ts::content::482eee19afa1 | frontend/src/member-workspace.ts:569 | textarea | textarea | field_value_or_selection_change | 1 | Not exercised |
| member-workspace-ts::-callback-::6e00313362fe | frontend/src/member-workspace.ts:569 | summary | Compare profile details | native_disclosure | 0 | Not exercised |
| member-workspace-ts::-callback-::54da5f01766d | frontend/src/member-workspace.ts:569 | button | Merge into ${esc(member.canonical_name)} | action_requires_contract_review | 2 | Not exercised |
| member-workspace-ts::content::4b07dcfb278d | frontend/src/member-workspace.ts:569 | button | Retry duplicate check | action_requires_contract_review | 1 | Not exercised |
| member-workspace-ts::content::ea07dff923e4 | frontend/src/member-workspace.ts:571 | button | Add Posting | action_requires_contract_review | 0 | Not exercised |
| member-workspace-ts::content::ea07dff923e4::2 | frontend/src/member-workspace.ts:573 | button | Add Leave | action_requires_contract_review | 0 | Not exercised |
| member-workspace-ts::render::8344e4732b2a | frontend/src/member-workspace.ts:603 | button | Close member profile | dismissal_or_draft_decision | 60 | Not exercised |
| member-workspace-ts::-callback-::50387550d7ac | frontend/src/member-workspace.ts:609 | button | ${label}${metadata.markup} | action_requires_contract_review | 21 | Not exercised |
| member-workspace-ts::render::0f15e49854a4 | frontend/src/member-workspace.ts:614 | form | mw-form | form_submission | 5 | Not exercised |
| member-workspace-ts::render::e73b5fbc6951 | frontend/src/member-workspace.ts:614 | section | mw-panel | action_requires_contract_review | 1 | Not exercised |
| member-workspace-ts::render::66786d07b0c5 | frontend/src/member-workspace.ts:614 | button | Cancel | dismissal_or_draft_decision | 4 | Not exercised |
| member-workspace-ts::render::7ab031a1d2a2 | frontend/src/member-workspace.ts:614 | button | ${busy ? "Saving…" : "Save changes"} | reviewed_mutation_candidate | 0 | Not exercised |
| member-workspace-ts::render::ed76e3a2fc19 | frontend/src/member-workspace.ts:614 | button | Edit profile | action_requires_contract_review | 23 | Not exercised |
| member-workspace-ts::render::f2bca99e8c8d | frontend/src/member-workspace.ts:614 | button | Previous | action_requires_contract_review | 4 | Not exercised |
| member-workspace-ts::render::2ba864dd279c | frontend/src/member-workspace.ts:614 | button | = ids.length - 1 ? "disabled" : ""}>Next | action_requires_contract_review | 3 | Not exercised |
| member-workspace-ts::-callback-::274268a8927b | frontend/src/member-workspace.ts:652 | button | Retry extra duties | action_requires_contract_review | 0 | Not exercised |
| member-workspace-ts::openMemberCsvImport::8344e4732b2a | frontend/src/member-workspace.ts:1251 | button | Close import | dismissal_or_draft_decision | 60 | Not exercised |
| member-workspace-ts::openMemberCsvImport::83139f9dfb36 | frontend/src/member-workspace.ts:1251 | a | Download blank CSV template | navigation_or_download | 0 | Not exercised |
| member-workspace-ts::openMemberCsvImport::be8bd4926194 | frontend/src/member-workspace.ts:1251 | a | Download example CSV (filled) | navigation_or_download | 0 | Not exercised |
| member-workspace-ts::openMemberCsvImport::951a1dbec58d | frontend/src/member-workspace.ts:1251 | summary | CSV format and example | native_disclosure | 0 | Not exercised |
| member-workspace-ts::openMemberCsvImport::fd7718f9bfb6 | frontend/src/member-workspace.ts:1257 | form | csv-form | form_submission | 1 | Not exercised |
| member-workspace-ts::openMemberCsvImport::366a4042d6b2 | frontend/src/member-workspace.ts:1257 | input | file | field_value_or_selection_change | 0 | Not exercised |
| member-workspace-ts::openMemberCsvImport::b811adee94cb | frontend/src/member-workspace.ts:1257 | select | mode | field_value_or_selection_change | 0 | Not exercised |
| member-workspace-ts::openMemberCsvImport::3814c917c012 | frontend/src/member-workspace.ts:1257 | button | Preview import | action_requires_contract_review | 0 | Not exercised |
| member-workspace-ts::renderRosterPreview::a3f9cc84ee2c | frontend/src/member-workspace.ts:1362 | button | Tick all | action_requires_contract_review | 2 | Not exercised |
| member-workspace-ts::renderRosterPreview::fd0a59600b34 | frontend/src/member-workspace.ts:1362 | button | Untick all | action_requires_contract_review | 2 | Not exercised |
| member-workspace-ts::-callback-::548ab1328d5e | frontend/src/member-workspace.ts:1362 | input | checkbox | field_value_or_selection_change | 5 | Not exercised |
| member-workspace-ts::-callback-::fe2d26258059 | frontend/src/member-workspace.ts:1362 | button | Review member profile | action_requires_contract_review | 1 | Not exercised |
| member-workspace-ts::actions::43e824225d41 | frontend/src/member-workspace.ts:1365 | button | Refresh preview after corrections | action_requires_contract_review | 17 | Not exercised |
| member-workspace-ts::actions::67ea00c9b56b | frontend/src/member-workspace.ts:1365 | button | Download row report | download_artifact | 3 | Not exercised |
| member-workspace-ts::actions::bcab43224755 | frontend/src/member-workspace.ts:1365 | button | ${preview!.mode === "roster_sync" ? "Apply roster changes" : "Apply selected rows"} | reviewed_mutation_candidate | 35 | Not exercised |
| member-workspace-ts::rowHtml::262e689759c9 | frontend/src/member-workspace.ts:1416 | button | This is a different person | action_requires_contract_review | 1 | Not exercised |
| member-workspace-ts::rowHtml::d9718b0ecdf8 | frontend/src/member-workspace.ts:1417 | button | Undo my choice | action_requires_contract_review | 1 | Not exercised |
| member-workspace-ts::-callback-::338889403689 | frontend/src/member-workspace.ts:1418 | button | Review profile: ${esc(suggestion.name)} | action_requires_contract_review | 1 | Not exercised |
| member-workspace-ts::rowHtml::4a2620087fea | frontend/src/member-workspace.ts:1420 | input | checkbox | field_value_or_selection_change | 9 | Not exercised |
| member-workspace-ts::rowHtml::01fa5fce8a6a | frontend/src/member-workspace.ts:1420 | summary | Edit row | native_disclosure | 0 | Not exercised |
| member-workspace-ts::-callback-::bf3345a5c13d | frontend/src/member-workspace.ts:1420 | input | input | field_value_or_selection_change | 19 | Not exercised |
| member-workspace-ts::rowHtml::496f3e092355 | frontend/src/member-workspace.ts:1420 | summary | Before → After | native_disclosure | 0 | Not exercised |
| member-workspace-ts::-callback-::0e13eda9784f | frontend/src/member-workspace.ts:1615 | button | Open ${esc(m.canonical_name)} | action_requires_contract_review | 2 | Not exercised |
| member-workspace-ts::-callback-::5c986c9e7cd2 | frontend/src/member-workspace.ts:1680 | summary | Map CSV columns | native_disclosure | 0 | Not exercised |
| member-workspace-ts::-callback-::31917eea956f | frontend/src/member-workspace.ts:1686 | select | select | field_value_or_selection_change | 4 | Not exercised |
| operational-import-ts::createMemberInline::8344e4732b2a | frontend/src/operational-import.ts:34 | button | Close member creation | dismissal_or_draft_decision | 60 | Not exercised |
| operational-import-ts::createMemberInline::9fbb953509e8 | frontend/src/operational-import.ts:34 | form | form | form_submission | 0 | Not exercised |
| operational-import-ts::createMemberInline::5eb3d0bbc5f2 | frontend/src/operational-import.ts:34 | input | canonical_name | field_value_or_selection_change | 0 | Not exercised |
| operational-import-ts::createMemberInline::1fd8ab6e351b | frontend/src/operational-import.ts:34 | select | call_level | field_value_or_selection_change | 0 | Not exercised |
| operational-import-ts::createMemberInline::f81ab96e6f5e | frontend/src/operational-import.ts:34 | button | Create member | action_requires_contract_review | 0 | Not exercised |
| operational-import-ts::-callback-::61fd222d9f74 | frontend/src/operational-import.ts:80 | button | Use this member | action_requires_contract_review | 2 | Not exercised |
| operational-import-ts::-callback-::ac917c72a096 | frontend/src/operational-import.ts:80 | button | Review / restore member | reviewed_mutation_candidate | 1 | Not exercised |
| operational-import-ts::openOperationalImport::8344e4732b2a | frontend/src/operational-import.ts:235 | button | Close import review | dismissal_or_draft_decision | 60 | Not exercised |
| operational-import-ts::openOperationalImport::6ad865f29b64 | frontend/src/operational-import.ts:235 | a | Download ${kind === "units" ? "unitwise" : "leave"} CSV template | navigation_or_download | 0 | Not exercised |
| operational-import-ts::openOperationalImport::6ad865f29b64::2 | frontend/src/operational-import.ts:235 | a | Download example CSV | navigation_or_download | 0 | Not exercised |
| operational-import-ts::openOperationalImport::a87b773bb070 | frontend/src/operational-import.ts:235 | button | Manage labels and mappings | action_requires_contract_review | 1 | Not exercised |
| operational-import-ts::openOperationalImport::9ab8b3ad3404 | frontend/src/operational-import.ts:235 | summary | CSV examples | native_disclosure | 0 | Not exercised |
| operational-import-ts::openOperationalImport::277978774269 | frontend/src/operational-import.ts:235 | form | form | form_submission | 0 | Not exercised |
| operational-import-ts::openOperationalImport::134d362d305f | frontend/src/operational-import.ts:235 | input | month | field_value_or_selection_change | 0 | Not exercised |
| operational-import-ts::openOperationalImport::36374abda2f7 | frontend/src/operational-import.ts:235 | input | file | field_value_or_selection_change | 0 | Not exercised |
| operational-import-ts::openOperationalImport::b811adee94cb | frontend/src/operational-import.ts:235 | select | mode | field_value_or_selection_change | 0 | Not exercised |
| operational-import-ts::openOperationalImport::2addd3cac145 | frontend/src/operational-import.ts:235 | select | date_format | field_value_or_selection_change | 0 | Not exercised |
| operational-import-ts::openOperationalImport::0b5307cbdbc8 | frontend/src/operational-import.ts:235 | button | Preview and normalize | action_requires_contract_review | 0 | Not exercised |
| operational-import-ts::renderMapping::20346c503f16 | frontend/src/operational-import.ts:414 | summary | Map columns | native_disclosure | 0 | Not exercised |
| operational-import-ts::-callback-::df5cad5c6eec | frontend/src/operational-import.ts:414 | select | select | field_value_or_selection_change | 20 | Not exercised |
| operational-import-ts::rowHtml::b0cbbc7d1ad7 | frontend/src/operational-import.ts:485 | input | checkbox | field_value_or_selection_change | 9 | Not exercised |
| operational-import-ts::rowHtml::975a29700844 | frontend/src/operational-import.ts:495 | button | Create new member | action_requires_contract_review | 2 | Not exercised |
| operational-import-ts::rowHtml::b6ab0b3a7fd9 | frontend/src/operational-import.ts:496 | button | Use this member for every “${esc(row.values.member_name)}” row | action_requires_contract_review | 1 | Not exercised |
| operational-import-ts::rowHtml::353293c98981 | frontend/src/operational-import.ts:497 | input | checkbox | field_value_or_selection_change | 31 | Not exercised |
| operational-import-ts::rowHtml::ec40717f3b75 | frontend/src/operational-import.ts:500 | summary | Edit row | native_disclosure | 0 | Not exercised |
| operational-import-ts::rowHtml::8b27c10ed68f | frontend/src/operational-import.ts:502 | input | search | field_value_or_selection_change | 1 | Not exercised |
| operational-import-ts::rowHtml::2e0d6fe21ad7 | frontend/src/operational-import.ts:503 | select | select | field_value_or_selection_change | 31 | Not exercised |
| operational-import-ts::rowHtml::e1ed3cc5acb4 | frontend/src/operational-import.ts:505 | input | search | field_value_or_selection_change | 1 | Not exercised |
| operational-import-ts::rowHtml::6244f5d3bacc | frontend/src/operational-import.ts:506 | select | select | field_value_or_selection_change | 31 | Not exercised |
| operational-import-ts::rowHtml::efafedc44b79 | frontend/src/operational-import.ts:507 | button | Create unit | action_requires_contract_review | 1 | Not exercised |
| operational-import-ts::rowHtml::909cb50d0426 | frontend/src/operational-import.ts:508 | input | input | field_value_or_selection_change | 31 | Not exercised |
| operational-import-ts::rowHtml::e56c852ff0e2 | frontend/src/operational-import.ts:509 | input | checkbox | field_value_or_selection_change | 31 | Not exercised |
| operational-import-ts::rowHtml::51d317f2db5a | frontend/src/operational-import.ts:510 | button | Use this unit for repeated labels | action_requires_contract_review | 1 | Not exercised |
| operational-import-ts::-callback-::bbd392acbc1c | frontend/src/operational-import.ts:511 | input | input | field_value_or_selection_change | 31 | Not exercised |
| operational-import-ts::rowHtml::c74944e2202a | frontend/src/operational-import.ts:512 | input | input | field_value_or_selection_change | 31 | Not exercised |
| operational-import-ts::rowHtml::8521377a9abd | frontend/src/operational-import.ts:513 | input | input | field_value_or_selection_change | 31 | Not exercised |
| operational-import-ts::-callback-::6224227e343d | frontend/src/operational-import.ts:516 | button | ${c.status === "active" ? "Open profile:" : "Review / restore"} ${esc(c.name)} | reviewed_mutation_candidate | 1 | Not exercised |
| operational-import-ts::renderReview::8e3d2370d8e7 | frontend/src/operational-import.ts:527 | summary | ${preview.replacement_scope.length} existing records affected by replacement | native_disclosure | 0 | Not exercised |
| operational-import-ts::renderReview::96571f6b326d | frontend/src/operational-import.ts:527 | button | Previous rows | action_requires_contract_review | 1 | Not exercised |
| operational-import-ts::renderReview::f0f71febdf77 | frontend/src/operational-import.ts:527 | button | = preview.rows.length ? "disabled" : ""}>Next rows | action_requires_contract_review | 1 | Not exercised |
| operational-import-ts::renderReview::9a648e25e699 | frontend/src/operational-import.ts:527 | input | checkbox | field_value_or_selection_change | 2 | Not exercised |
| operational-import-ts::renderReview::43e824225d41 | frontend/src/operational-import.ts:527 | button | Refresh normalized preview | action_requires_contract_review | 17 | Not exercised |
| operational-import-ts::renderReview::67ea00c9b56b | frontend/src/operational-import.ts:527 | button | Download row report | download_artifact | 3 | Not exercised |
| operational-import-ts::renderReview::bcab43224755 | frontend/src/operational-import.ts:527 | button | Apply reviewed rows | reviewed_mutation_candidate | 35 | Not exercised |
| operational-import-ts::-callback-::c2ca159c9602 | frontend/src/operational-import.ts:853 | button | Download applied / excluded row report | download_artifact | 3 | Not exercised |
| past-duties-ts::mountPastDuties::ed43bdaca359 | frontend/src/past-duties.ts:58 | button | Try again | action_requires_contract_review | 0 | Not exercised |
| past-duties-ts::render::2feab62492b2 | frontend/src/past-duties.ts:120 | button | Download Duty Template | download_artifact | 3 | Not exercised |
| past-duties-ts::render::b3296c978182 | frontend/src/past-duties.ts:121 | input | file | field_value_or_selection_change | 3 | Not exercised |
| past-duties-ts::render::6c1cf52bb367 | frontend/src/past-duties.ts:122 | input | month | field_value_or_selection_change | 3 | Not exercised |
| past-duties-ts::render::ce8e912a1026 | frontend/src/past-duties.ts:123 | select | select | field_value_or_selection_change | 3 | Not exercised |
| past-duties-ts::render::b9ae869557f2 | frontend/src/past-duties.ts:124 | input | number | field_value_or_selection_change | 3 | Not exercised |
| past-duties-ts::render::05472acf0019 | frontend/src/past-duties.ts:125 | button | Read Worksheets | action_requires_contract_review | 3 | Not exercised |
| past-duties-ts::render::ed94df3957e4 | frontend/src/past-duties.ts:126 | select | select | field_value_or_selection_change | 3 | Not exercised |
| past-duties-ts::-callback-::2c8f2acc63e7 | frontend/src/past-duties.ts:127 | select | select | field_value_or_selection_change | 1 | Not exercised |
| past-duties-ts::render::efa722117552 | frontend/src/past-duties.ts:128 | button | Preview Past Duties | action_requires_contract_review | 3 | Not exercised |
| past-duties-ts::render::3f494b20c2c1 | frontend/src/past-duties.ts:132 | select | select | field_value_or_selection_change | 3 | Not exercised |
| past-duties-ts::render::90a6f9199dca | frontend/src/past-duties.ts:133 | button | Download Rejected Rows CSV | download_artifact | 3 | Not exercised |
| past-duties-ts::-callback-::0c58469035d0 | frontend/src/past-duties.ts:140 | button | Undo member choice | action_requires_contract_review | 0 | Not exercised |
| past-duties-ts::-callback-::cb4499a18ce5 | frontend/src/past-duties.ts:141 | button | Include this row again | action_requires_contract_review | 0 | Not exercised |
| past-duties-ts::-callback-::c6d1926b14a1 | frontend/src/past-duties.ts:142 | button | Skip this row | action_requires_contract_review | 0 | Not exercised |
| past-duties-ts::-callback-::294a45ade6b6 | frontend/src/past-duties.ts:143 | select | select | field_value_or_selection_change | 1 | Not exercised |
| past-duties-ts::-callback-::f48d538ecdd0 | frontend/src/past-duties.ts:144 | summary | Edit row | native_disclosure | 0 | Not exercised |
| past-duties-ts::-callback-::daf03b4e61f6 | frontend/src/past-duties.ts:145 | select | select | field_value_or_selection_change | 1 | Not exercised |
| past-duties-ts::-callback-::6f0aa3b707c3 | frontend/src/past-duties.ts:146 | select | select | field_value_or_selection_change | 1 | Not exercised |
| past-duties-ts::-callback-::6721a573caf9 | frontend/src/past-duties.ts:147 | select | select | field_value_or_selection_change | 1 | Not exercised |
| past-duties-ts::render::7f30b3e13810 | frontend/src/past-duties.ts:150 | input | checkbox | field_value_or_selection_change | 3 | Not exercised |
| past-duties-ts::render::b4344213f227 | frontend/src/past-duties.ts:151 | input | checkbox | field_value_or_selection_change | 3 | Not exercised |
| past-duties-ts::render::71ef12145403 | frontend/src/past-duties.ts:152 | button | Apply Reviewed Past Duties | reviewed_mutation_candidate | 3 | Not exercised |
| past-duties-ts::render::dbf996f2ea15 | frontend/src/past-duties.ts:155 | button | Refresh saved details | reviewed_mutation_candidate | 3 | Not exercised |
| past-duties-ts::render::ac4f5f6edb39 | frontend/src/past-duties.ts:159 | input | checkbox | field_value_or_selection_change | 1 | Not exercised |
| past-duties-ts::render::28254431d971 | frontend/src/past-duties.ts:160 | input | date | field_value_or_selection_change | 3 | Not exercised |
| past-duties-ts::-callback-::6f3061cf2b80 | frontend/src/past-duties.ts:161 | input | number | field_value_or_selection_change | 1 | Not exercised |
| past-duties-ts::render::f1bf6425307e | frontend/src/past-duties.ts:162 | button | Save Fairness Settings | reviewed_mutation_candidate | 3 | Not exercised |
| past-duties-ts::-callback-::132acc7ab52c | frontend/src/past-duties.ts:163 | button | View Rows | action_requires_contract_review | 1 | Not exercised |
| record-workspace-ts::select::53c20af14d45 | frontend/src/record-workspace.ts:95 | select | ${field} | field_value_or_selection_change | 0 | Not exercised |
| record-workspace-ts::render::8344e4732b2a | frontend/src/record-workspace.ts:102 | button | Close editor | dismissal_or_draft_decision | 60 | Not exercised |
| record-workspace-ts::render::2d421ea162a9 | frontend/src/record-workspace.ts:102 | form | form | form_submission | 0 | Not exercised |
| record-workspace-ts::render::7cae22f7d11e | frontend/src/record-workspace.ts:102 | input | search | field_value_or_selection_change | 3 | Not exercised |
| record-workspace-ts::render::5112cf3c05f9 | frontend/src/record-workspace.ts:102 | select | person_id | field_value_or_selection_change | 0 | Not exercised |
| record-workspace-ts::render::44a979f9b2fe | frontend/src/record-workspace.ts:110 | button | Create member | action_requires_contract_review | 1 | Not exercised |
| record-workspace-ts::render::abbd8a790c71 | frontend/src/record-workspace.ts:112 | select | unit_id | field_value_or_selection_change | 0 | Not exercised |
| record-workspace-ts::render::8b6e927ad9df | frontend/src/record-workspace.ts:122 | button | Create unit | action_requires_contract_review | 1 | Not exercised |
| record-workspace-ts::render::23bd58073775 | frontend/src/record-workspace.ts:124 | button | Manage labels and mappings | action_requires_contract_review | 1 | Not exercised |
| record-workspace-ts::render::965d4e82b08e | frontend/src/record-workspace.ts:124 | input | starts_on | field_value_or_selection_change | 0 | Not exercised |
| record-workspace-ts::render::44388b98696b | frontend/src/record-workspace.ts:124 | input | ends_on | field_value_or_selection_change | 0 | Not exercised |
| record-workspace-ts::render::1f809f8a9e1f | frontend/src/record-workspace.ts:124 | textarea | notes | field_value_or_selection_change | 0 | Not exercised |
| record-workspace-ts::render::8344e4732b2a::2 | frontend/src/record-workspace.ts:124 | button | Cancel | dismissal_or_draft_decision | 60 | Not exercised |
| record-workspace-ts::render::b3f415417387 | frontend/src/record-workspace.ts:124 | button | Review changes | action_requires_contract_review | 0 | Not exercised |
| record-workspace-ts::render::b5579d8ed3c0 | frontend/src/record-workspace.ts:124 | button | Save reviewed changes | reviewed_mutation_candidate | 16 | Not exercised |
| recycle-bin-ts::batchCard::927ceaba92e6 | frontend/src/recycle-bin.ts:58 | button | Restore | reviewed_mutation_candidate | 3 | Not exercised |
| recycle-bin-ts::batchCard::e865921ff303 | frontend/src/recycle-bin.ts:59 | button | Delete forever… | reviewed_mutation_candidate | 2 | Not exercised |
| recycle-bin-ts::render::fba2d91f7e97 | frontend/src/recycle-bin.ts:110 | button | Try again | action_requires_contract_review | 1 | Not exercised |
| recycle-bin-ts::render::fba2d91f7e97::2 | frontend/src/recycle-bin.ts:122 | button | Refresh list | action_requires_contract_review | 1 | Not exercised |
| recycle-bin-ts::render::fa9bcf07c62b | frontend/src/recycle-bin.ts:236 | button | Try again | action_requires_contract_review | 2 | Not exercised |
| recycle-bin-ts::render::60243a0bfbed | frontend/src/recycle-bin.ts:243 | input | Select all past duties shown | field_value_or_selection_change | 1 | Not exercised |
| recycle-bin-ts::-callback-::63e439329931 | frontend/src/recycle-bin.ts:247 | input | Select ${esc(`${item.member_name ??  | field_value_or_selection_change | 2 | Not exercised |
| recycle-bin-ts::render::de57863ddef0 | frontend/src/recycle-bin.ts:261 | input | month | field_value_or_selection_change | 2 | Not exercised |
| recycle-bin-ts::render::f93a300472f8 | frontend/src/recycle-bin.ts:262 | button | Delete selected (${selected.size}) | reviewed_mutation_candidate | 2 | Not exercised |
| recycle-bin-ts::render::f83be2a6f9e6 | frontend/src/recycle-bin.ts:263 | button | Delete all past duties for ${esc(monthName)}… | reviewed_mutation_candidate | 2 | Not exercised |
| reference-workspace-ts::openMappingCreator::8344e4732b2a | frontend/src/reference-workspace.ts:37 | button | Close mapping creation | dismissal_or_draft_decision | 60 | Not exercised |
| reference-workspace-ts::openMappingCreator::ad1b96970e4c | frontend/src/reference-workspace.ts:37 | form | form | form_submission | 0 | Not exercised |
| reference-workspace-ts::openMappingCreator::27663e5ee3fc | frontend/src/reference-workspace.ts:37 | select | mapping_type | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::openMappingCreator::9ba91fa9a9f4 | frontend/src/reference-workspace.ts:37 | input | source_label | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::openMappingCreator::70460115628c | frontend/src/reference-workspace.ts:37 | input | search | field_value_or_selection_change | 5 | Not exercised |
| reference-workspace-ts::openMappingCreator::0c05a5eb90e7 | frontend/src/reference-workspace.ts:37 | select | target_key | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::openMappingCreator::1f809f8a9e1f | frontend/src/reference-workspace.ts:37 | textarea | notes | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::openMappingCreator::8344e4732b2a::2 | frontend/src/reference-workspace.ts:37 | button | Cancel | dismissal_or_draft_decision | 60 | Not exercised |
| reference-workspace-ts::openMappingCreator::e35a79ba4bbd | frontend/src/reference-workspace.ts:37 | button | Save mapping | reviewed_mutation_candidate | 0 | Not exercised |
| reference-workspace-ts::load::77153a6c0c46 | frontend/src/reference-workspace.ts:87 | button | Retry destinations | action_requires_contract_review | 0 | Not exercised |
| reference-workspace-ts::loadActivity::8344e4732b2a | frontend/src/reference-workspace.ts:179 | button | Close activity | dismissal_or_draft_decision | 60 | Not exercised |
| reference-workspace-ts::render::8344e4732b2a | frontend/src/reference-workspace.ts:332 | button | Close unit management | dismissal_or_draft_decision | 60 | Not exercised |
| reference-workspace-ts::render::140c4d3ab3a2 | frontend/src/reference-workspace.ts:332 | input | search | field_value_or_selection_change | 4 | Not exercised |
| reference-workspace-ts::render::a9a2220d1cdc | frontend/src/reference-workspace.ts:332 | input | month | field_value_or_selection_change | 3 | Not exercised |
| reference-workspace-ts::render::5521657dac0f | frontend/src/reference-workspace.ts:332 | select | select | field_value_or_selection_change | 2 | Not exercised |
| reference-workspace-ts::render::7dc6f680abb6 | frontend/src/reference-workspace.ts:332 | button | Add Unit | action_requires_contract_review | 4 | Not exercised |
| reference-workspace-ts::render::2c6d073a50ae | frontend/src/reference-workspace.ts:332 | button | Retry member counts | action_requires_contract_review | 0 | Not exercised |
| reference-workspace-ts::-callback-::ffb4e43d2c0b | frontend/src/reference-workspace.ts:332 | button | ${esc(u.name)} · ${esc(u.campus \|\| "Campus not specified")} · ${esc(u.code)} · ${esc(u.active_status)} &middot; ${u.usage.selected_members === undefined ? `Member count unavailable for ${countsMonth}` | action_requires_contract_review | 3 | Not exercised |
| reference-workspace-ts::render::07fa3c19c802 | frontend/src/reference-workspace.ts:332 | button | View unit activity | action_requires_contract_review | 1 | Not exercised |
| reference-workspace-ts::render::a53f63a35cd7 | frontend/src/reference-workspace.ts:332 | form | registry-unit-form | form_submission | 3 | Not exercised |
| reference-workspace-ts::render::fb574fa01095 | frontend/src/reference-workspace.ts:332 | input | name | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::fd8369e92043 | frontend/src/reference-workspace.ts:332 | input | campus | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::b1351501929a | frontend/src/reference-workspace.ts:332 | input | code | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::dee5ba4fd21c | frontend/src/reference-workspace.ts:332 | input | minimum_free_people | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::a5dfc302b97d | frontend/src/reference-workspace.ts:332 | summary | Call-wise staffing minimums | native_disclosure | 0 | Not exercised |
| reference-workspace-ts::-callback-::fda9652a5259 | frontend/src/reference-workspace.ts:332 | input | number | field_value_or_selection_change | 2 | Not exercised |
| reference-workspace-ts::render::37ea8ee9d0dd | frontend/src/reference-workspace.ts:332 | textarea | aliases | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::1f809f8a9e1f | frontend/src/reference-workspace.ts:332 | textarea | notes | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::2db8a6424990 | frontend/src/reference-workspace.ts:332 | select | active_status | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::8344e4732b2a::2 | frontend/src/reference-workspace.ts:332 | button | Cancel | dismissal_or_draft_decision | 60 | Not exercised |
| reference-workspace-ts::render::6b5ba6bd90a9 | frontend/src/reference-workspace.ts:332 | button | ${selected ? "Save unit" : "Create unit"} | reviewed_mutation_candidate | 0 | Not exercised |
| reference-workspace-ts::render::8344e4732b2a::3 | frontend/src/reference-workspace.ts:588 | button | Close reference management | dismissal_or_draft_decision | 60 | Not exercised |
| reference-workspace-ts::render::2be5413d8f00 | frontend/src/reference-workspace.ts:588 | select | select | field_value_or_selection_change | 5 | Not exercised |
| reference-workspace-ts::render::140c4d3ab3a2::2 | frontend/src/reference-workspace.ts:597 | input | search | field_value_or_selection_change | 4 | Not exercised |
| reference-workspace-ts::render::7dc6f680abb6::2 | frontend/src/reference-workspace.ts:597 | button | Add ${kind.replace(/_/g, " ")} | action_requires_contract_review | 4 | Not exercised |
| reference-workspace-ts::render::6021da08b569 | frontend/src/reference-workspace.ts:597 | button | Add Mapping | action_requires_contract_review | 1 | Not exercised |
| reference-workspace-ts::-callback-::7786519f4005 | frontend/src/reference-workspace.ts:597 | button | ${esc(i.label)} · ${i.active ? "Active" : "Archived"} · ${i.usage.records} linked records | action_requires_contract_review | 14 | Not exercised |
| reference-workspace-ts::render::e63d6af8fe9b | frontend/src/reference-workspace.ts:597 | form | form | form_submission | 0 | Not exercised |
| reference-workspace-ts::render::26e27a6c2ac2 | frontend/src/reference-workspace.ts:597 | input | key | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::8c4faca98c3c | frontend/src/reference-workspace.ts:597 | input | label | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::37ea8ee9d0dd::2 | frontend/src/reference-workspace.ts:597 | textarea | aliases | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::585583e118e7 | frontend/src/reference-workspace.ts:599 | select | maps_to | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::887b43ba1975 | frontend/src/reference-workspace.ts:611 | select | group | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::dd8b1021462f | frontend/src/reference-workspace.ts:611 | input | duration_hours | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::12472801a827 | frontend/src/reference-workspace.ts:611 | input | start_time | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::fdb560e7e7cd | frontend/src/reference-workspace.ts:611 | input | end_time | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::74ada2440b0d | frontend/src/reference-workspace.ts:611 | select | allowed_call_levels | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::-callback-::53c20af14d45 | frontend/src/reference-workspace.ts:625 | input | ${field} | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::8cfe02eacff6 | frontend/src/reference-workspace.ts:631 | select | active | field_value_or_selection_change | 0 | Not exercised |
| reference-workspace-ts::render::dbb08dda09eb | frontend/src/reference-workspace.ts:631 | button | View reference activity | action_requires_contract_review | 2 | Not exercised |
| reference-workspace-ts::render::8344e4732b2a::4 | frontend/src/reference-workspace.ts:631 | button | Cancel | dismissal_or_draft_decision | 60 | Not exercised |
| reference-workspace-ts::render::be3cdfd6162c | frontend/src/reference-workspace.ts:631 | button | Save reference | reviewed_mutation_candidate | 0 | Not exercised |
| rota-compute-ts::renderComputeSettings::a5de0d522c8e | frontend/src/rota-compute.ts:50 | button | Try again | action_requires_contract_review | 1 | Not exercised |
| rota-compute-ts::gpuSummary::bd1b41388f34 | frontend/src/rota-compute.ts:61 | summary | GPU setup checklist | native_disclosure | 0 | Not exercised |
| rota-compute-ts::render::48723412d0d6 | frontend/src/rota-compute.ts:99 | input | checkbox | field_value_or_selection_change | 8 | Not exercised |
| rota-compute-ts::render::e990be1a37af | frontend/src/rota-compute.ts:101 | select | select | field_value_or_selection_change | 7 | Not exercised |
| rota-compute-ts::render::2f1267e456b4 | frontend/src/rota-compute.ts:105 | select | select | field_value_or_selection_change | 4 | Not exercised |
| rota-compute-ts::render::8f604eb256bf | frontend/src/rota-compute.ts:111 | button | Test Device | action_requires_contract_review | 5 | Not exercised |
| rota-compute-ts::render::2a3afb96f655 | frontend/src/rota-compute.ts:112 | button | Reset device settings | action_requires_contract_review | 3 | Not exercised |
| rota-compute-ts::render::5ad1cdd15446 | frontend/src/rota-compute.ts:113 | summary | GPU selection and Automatic mode explained | native_disclosure | 0 | Not exercised |
| rota-compute-ts::render::59bcc0b0b380 | frontend/src/rota-compute.ts:116 | summary | NVIDIA or another GPU is missing | native_disclosure | 0 | Not exercised |
| rota-compute-ts::render::6910f5bdb120 | frontend/src/rota-compute.ts:132 | button | Download GPU diagnostics | download_artifact | 4 | Not exercised |
| rota-compute-ts::render::8a0945d51cf3 | frontend/src/rota-compute.ts:134 | input | month | field_value_or_selection_change | 7 | Not exercised |
| rota-compute-ts::render::3cc8149f7a44 | frontend/src/rota-compute.ts:135 | select | select | field_value_or_selection_change | 5 | Not exercised |
| rota-compute-ts::render::338692b2fc07 | frontend/src/rota-compute.ts:141 | button | Compare engines on this month | action_requires_contract_review | 7 | Not exercised |
| rota-compute-ts::openRotaCompute::8344e4732b2a | frontend/src/rota-compute.ts:293 | button | Close | dismissal_or_draft_decision | 60 | Not exercised |
| rota-compute-ts::option::c6828eacf5ca | frontend/src/rota-compute.ts:303 | input | compute-engine | field_value_or_selection_change | 2 | Not exercised |
| rota-compute-ts::engineChoice::c9d01f2939c0 | frontend/src/rota-compute.ts:310 | button | Open Compute Settings (test device, power, compare) | action_requires_contract_review | 2 | Not exercised |
| rota-compute-ts::render::8344e4732b2a | frontend/src/rota-compute.ts:325 | button | Close compute review | dismissal_or_draft_decision | 60 | Not exercised |
| rota-compute-ts::render::6e2d8f8cd7fc | frontend/src/rota-compute.ts:334 | div | Proposed rota changes | action_requires_contract_review | 0 | Not exercised |
| rota-compute-ts::render::43372de523aa | frontend/src/rota-compute.ts:338 | summary | Reverse this generation | native_disclosure | 0 | Not exercised |
| rota-compute-ts::render::38161acb5011 | frontend/src/rota-compute.ts:338 | input | checkbox | field_value_or_selection_change | 5 | Not exercised |
| rota-compute-ts::render::dede873ea5dd | frontend/src/rota-compute.ts:338 | button | Validate and reverse | action_requires_contract_review | 6 | Not exercised |
| rota-compute-ts::render::d76d6e95a7dc | frontend/src/rota-compute.ts:340 | button | Generate proposal | action_requires_contract_review | 14 | Not exercised |
| rota-compute-ts::render::30472a2d929d | frontend/src/rota-compute.ts:341 | button | Continue generation | action_requires_contract_review | 3 | Not exercised |
| rota-compute-ts::render::7c2838c73f37 | frontend/src/rota-compute.ts:342 | button | Continue on server | action_requires_contract_review | 1 | Not exercised |
| rota-compute-ts::render::9fb4adb0d96d | frontend/src/rota-compute.ts:343 | button | Cancel proposal | dismissal_or_draft_decision | 14 | Not exercised |
| rota-compute-ts::render::5cef538c762a | frontend/src/rota-compute.ts:344 | input | checkbox | field_value_or_selection_change | 6 | Not exercised |
| rota-compute-ts::render::bcab43224755 | frontend/src/rota-compute.ts:344 | button | Apply reviewed draft | reviewed_mutation_candidate | 35 | Not exercised |
| rota-compute-ts::render::2c2185d11301 | frontend/src/rota-compute.ts:345 | button | Download report | download_artifact | 7 | Not exercised |
| rota-compute-ts::openAutoassign::8344e4732b2a | frontend/src/rota-compute.ts:482 | button | Close | dismissal_or_draft_decision | 60 | Not exercised |
| rota-compute-ts::openAutoassign::d9839e2e78b4 | frontend/src/rota-compute.ts:483 | button | Prepare quick draft | action_requires_contract_review | 5 | Not exercised |
| rota-compute-ts::openAutoassign::b844169d2dc4 | frontend/src/rota-compute.ts:484 | button | Optimise the month | action_requires_contract_review | 2 | Not exercised |
| rota-intelligence-ts::openIntelligentRota::8344e4732b2a | frontend/src/rota-intelligence.ts:76 | button | Close | dismissal_or_draft_decision | 60 | Not exercised |
| rota-intelligence-ts::render::8344e4732b2a | frontend/src/rota-intelligence.ts:96 | button | Close | dismissal_or_draft_decision | 60 | Not exercised |
| rota-intelligence-ts::-callback-::8928ef6d1840 | frontend/src/rota-intelligence.ts:97 | button | ${t[0].toUpperCase()+t.slice(1)} | action_requires_contract_review | 21 | Not exercised |
| rota-intelligence-ts::render::62690759255c | frontend/src/rota-intelligence.ts:100 | select | select | field_value_or_selection_change | 5 | Not exercised |
| rota-intelligence-ts::render::7b5989429efe | frontend/src/rota-intelligence.ts:101 | select | select | field_value_or_selection_change | 1 | Not exercised |
| rota-intelligence-ts::render::fea68881cf2d | frontend/src/rota-intelligence.ts:104 | summary | Maintain holiday dates | native_disclosure | 0 | Not exercised |
| rota-intelligence-ts::render::d5aaee010125 | frontend/src/rota-intelligence.ts:104 | input | input | field_value_or_selection_change | 2 | Not exercised |
| rota-intelligence-ts::render::207ecf32541d | frontend/src/rota-intelligence.ts:104 | button | Save reviewed calendar | reviewed_mutation_candidate | 2 | Not exercised |
| rota-intelligence-ts::render::8a65e9750de6 | frontend/src/rota-intelligence.ts:105 | summary | Locks and repair scope | native_disclosure | 0 | Not exercised |
| rota-intelligence-ts::-callback-::ea6c2c71bafe | frontend/src/rota-intelligence.ts:107 | input | true | field_value_or_selection_change | 3 | Not exercised |
| rota-intelligence-ts::-callback-::834dd76b6c28 | frontend/src/rota-intelligence.ts:108 | input | true | field_value_or_selection_change | 3 | Not exercised |
| rota-intelligence-ts::render::9c1e64ab1314 | frontend/src/rota-intelligence.ts:109 | summary | Member preferences | native_disclosure | 0 | Not exercised |
| rota-intelligence-ts::render::8f969c0aaed4 | frontend/src/rota-intelligence.ts:109 | select | select | field_value_or_selection_change | 2 | Not exercised |
| rota-intelligence-ts::render::5a1bc7ba4859 | frontend/src/rota-intelligence.ts:109 | select | select | field_value_or_selection_change | 2 | Not exercised |
| rota-intelligence-ts::render::3294cc68364b | frontend/src/rota-intelligence.ts:109 | select | select | field_value_or_selection_change | 1 | Not exercised |
| rota-intelligence-ts::render::f265baa04b0b | frontend/src/rota-intelligence.ts:109 | button | Add preference | action_requires_contract_review | 3 | Not exercised |
| rota-intelligence-ts::render::d175fface03d | frontend/src/rota-intelligence.ts:110 | summary | Configured safety rules | native_disclosure | 0 | Not exercised |
| rota-intelligence-ts::render::d76d6e95a7dc | frontend/src/rota-intelligence.ts:111 | button | Generate intelligent draft | action_requires_contract_review | 14 | Not exercised |
| rota-intelligence-ts::render::30472a2d929d | frontend/src/rota-intelligence.ts:112 | button | Resume generation | action_requires_contract_review | 3 | Not exercised |
| rota-intelligence-ts::render::ff3e0d426a3f | frontend/src/rota-intelligence.ts:112 | button | Continue on server | action_requires_contract_review | 0 | Not exercised |
| rota-intelligence-ts::render::1ce41a2151de | frontend/src/rota-intelligence.ts:116 | select | select | field_value_or_selection_change | 4 | Not exercised |
| rota-intelligence-ts::render::1dcaab130533 | frontend/src/rota-intelligence.ts:117 | summary | Optimization evidence | native_disclosure | 0 | Not exercised |
| rota-intelligence-ts::-callback-::4a0faeedae35 | frontend/src/rota-intelligence.ts:118 | summary | Why this choice? | native_disclosure | 0 | Not exercised |
| rota-intelligence-ts::-callback-::da782520fb3c | frontend/src/rota-intelligence.ts:118 | button | Teach this decision | action_requires_contract_review | 2 | Not exercised |
| rota-intelligence-ts::render::1ff405a8f563 | frontend/src/rota-intelligence.ts:119 | button | =3?'disabled':''}>Find another alternative | action_requires_contract_review | 3 | Not exercised |
| rota-intelligence-ts::render::790ce77da4c5 | frontend/src/rota-intelligence.ts:119 | input | checkbox | field_value_or_selection_change | 10 | Not exercised |
| rota-intelligence-ts::render::bcab43224755 | frontend/src/rota-intelligence.ts:119 | button | Apply reviewed draft | reviewed_mutation_candidate | 35 | Not exercised |
| rota-intelligence-ts::render::0e844de794f9 | frontend/src/rota-intelligence.ts:120 | summary | Reverse this generation | native_disclosure | 0 | Not exercised |
| rota-intelligence-ts::render::38161acb5011 | frontend/src/rota-intelligence.ts:120 | input | checkbox | field_value_or_selection_change | 5 | Not exercised |
| rota-intelligence-ts::render::dede873ea5dd | frontend/src/rota-intelligence.ts:120 | button | Validate and reverse | action_requires_contract_review | 6 | Not exercised |
| rota-intelligence-ts::render::9fb4adb0d96d | frontend/src/rota-intelligence.ts:121 | button | Cancel proposal | dismissal_or_draft_decision | 14 | Not exercised |
| rota-intelligence-ts::render::2c2185d11301 | frontend/src/rota-intelligence.ts:121 | button | Download evidence | download_artifact | 7 | Not exercised |
| rota-intelligence-ts::render::5838b7411dfe | frontend/src/rota-intelligence.ts:123 | form | form | form_submission | 0 | Not exercised |
| rota-intelligence-ts::render::c54c0bb1ee68 | frontend/src/rota-intelligence.ts:123 | select | slot_id | field_value_or_selection_change | 0 | Not exercised |
| rota-intelligence-ts::render::8d9de8eb843e | frontend/src/rota-intelligence.ts:124 | select | kind | field_value_or_selection_change | 0 | Not exercised |
| rota-intelligence-ts::render::34fc7f31c73d | frontend/src/rota-intelligence.ts:125 | select | preferred_person_id | field_value_or_selection_change | 0 | Not exercised |
| rota-intelligence-ts::render::1d38c84e4b2d | frontend/src/rota-intelligence.ts:126 | select | reason | field_value_or_selection_change | 0 | Not exercised |
| rota-intelligence-ts::render::e2547ecf013c | frontend/src/rota-intelligence.ts:126 | textarea | note | field_value_or_selection_change | 0 | Not exercised |
| rota-intelligence-ts::render::380592c8797c | frontend/src/rota-intelligence.ts:126 | button | Save teaching example | reviewed_mutation_candidate | 0 | Not exercised |
| rota-intelligence-ts::render::b5c46fe70c66 | frontend/src/rota-intelligence.ts:127 | button | Refresh examples | action_requires_contract_review | 1 | Not exercised |
| rota-intelligence-ts::render::6d5103340a56 | frontend/src/rota-intelligence.ts:127 | button | Choose historical examples | action_requires_contract_review | 1 | Not exercised |
| rota-intelligence-ts::render::beaf2d694b4c | frontend/src/rota-intelligence.ts:127 | select | select | field_value_or_selection_change | 1 | Not exercised |
| rota-intelligence-ts::render::edf4766790a6 | frontend/src/rota-intelligence.ts:127 | button | Prepare unverified references | action_requires_contract_review | 1 | Not exercised |
| rota-intelligence-ts::-callback-::20f5dee7d66a | frontend/src/rota-intelligence.ts:128 | input | checkbox | field_value_or_selection_change | 0 | Not exercised |
| rota-intelligence-ts::-callback-::bb4677ad426b | frontend/src/rota-intelligence.ts:128 | button | Approve reviewed example | reviewed_mutation_candidate | 2 | Not exercised |
| rota-intelligence-ts::-callback-::a6c4f6274a03 | frontend/src/rota-intelligence.ts:128 | button | Exclude from future training | action_requires_contract_review | 1 | Not exercised |
| rota-intelligence-ts::render::98a3ed5c6462 | frontend/src/rota-intelligence.ts:130 | input | checkbox | field_value_or_selection_change | 2 | Not exercised |
| rota-intelligence-ts::render::1b6dc173032b | frontend/src/rota-intelligence.ts:131 | input | password | field_value_or_selection_change | 2 | Not exercised |
| rota-intelligence-ts::render::4f5f6274aa5f | frontend/src/rota-intelligence.ts:132 | input | number | field_value_or_selection_change | 0 | Not exercised |
| rota-intelligence-ts::render::5cc06765bef1 | frontend/src/rota-intelligence.ts:133 | summary | Start the local assistant | native_disclosure | 0 | Not exercised |
| rota-intelligence-ts::render::617a3bbf5006 | frontend/src/rota-intelligence.ts:134 | textarea | textarea | field_value_or_selection_change | 3 | Not exercised |
| rota-intelligence-ts::render::52a17a554679 | frontend/src/rota-intelligence.ts:134 | button | Ask local assistant | action_requires_contract_review | 1 | Not exercised |
| rota-intelligence-ts::render::d3cf92baac57 | frontend/src/rota-intelligence.ts:135 | summary | Quoted instruction for proposed settings | native_disclosure | 0 | Not exercised |
| rota-intelligence-ts::render::32cf714f08c7 | frontend/src/rota-intelligence.ts:135 | button | Use suggested planning mode | action_requires_contract_review | 2 | Not exercised |
| rota-intelligence-ts::render::cb5c78d7b30d | frontend/src/rota-intelligence.ts:136 | button | Refresh versions | action_requires_contract_review | 1 | Not exercised |
| rota-intelligence-ts::render::7fcde93ac747 | frontend/src/rota-intelligence.ts:136 | button | Prepare candidate version | action_requires_contract_review | 1 | Not exercised |
| rota-intelligence-ts::render::0473bcb23834 | frontend/src/rota-intelligence.ts:137 | input | input | field_value_or_selection_change | 2 | Not exercised |
| rota-intelligence-ts::-callback-::e551822640a3 | frontend/src/rota-intelligence.ts:138 | button | Evaluate on held-out months | action_requires_contract_review | 1 | Not exercised |
| rota-intelligence-ts::-callback-::377ffd06dd3b | frontend/src/rota-intelligence.ts:138 | button | Activate evaluated version | action_requires_contract_review | 2 | Not exercised |
| rota-intelligence-ts::-callback-::c27b5183af70 | frontend/src/rota-intelligence.ts:138 | button | Restore this version | reviewed_mutation_candidate | 1 | Not exercised |
| rota-rules-ts::helpButton::58a839a6acd9 | frontend/src/rota-rules.ts:500 | button | More about ${esc(label)} | action_requires_contract_review | 4 | Not exercised |
| rota-rules-ts::chip::bfe9834e46f9 | frontend/src/rota-rules.ts:515 | button | ${CHECK_ICON} ${esc(options.label)} ${options.sub ? ` ${esc(options.sub)} ` : ""} ${options.note ? ` . ${esc(options.note)} ` : ""} | action_requires_contract_review | 38 | Not exercised |
| rota-rules-ts::switchHtml::076641bce175 | frontend/src/rota-rules.ts:525 | button |  | action_requires_contract_review | 2 | Not exercised |
| rota-rules-ts::tile::671d6cf3aed3 | frontend/src/rota-rules.ts:555 | button | ${inner} | action_requires_contract_review | 4 | Not exercised |
| rota-rules-ts::noticesHtml::51ac2d97578e | frontend/src/rota-rules.ts:575 | button | Try again | action_requires_contract_review | 0 | Not exercised |
| rota-rules-ts::noticesHtml::5201ea70463a | frontend/src/rota-rules.ts:584 | button | Remove missing groups | reviewed_mutation_candidate | 0 | Not exercised |
| rota-rules-ts::noticesHtml::0f7e8a72468f | frontend/src/rota-rules.ts:593 | button | Remove missing units | reviewed_mutation_candidate | 0 | Not exercised |
| rota-rules-ts::noticesHtml::f987cc799777 | frontend/src/rota-rules.ts:601 | button | Manage eligibility groups | action_requires_contract_review | 3 | Not exercised |
| rota-rules-ts::headHtml::7fd37bfa1c02 | frontend/src/rota-rules.ts:630 | button | ${CHEVRON} ${esc(rule.label \|\| "Untitled duty")} ${esc(meta)}${changed ? ` Edited ` : ""} | action_requires_contract_review | 2 | Not exercised |
| rota-rules-ts::previewHtml::51ac2d97578e | frontend/src/rota-rules.ts:691 | button | Try again | action_requires_contract_review | 0 | Not exercised |
| rota-rules-ts::groupChips::f987cc799777 | frontend/src/rota-rules.ts:745 | button | Create one in Eligibility groups | action_requires_contract_review | 3 | Not exercised |
| rota-rules-ts::editorHtml::fdb4370bbe8b | frontend/src/rota-rules.ts:812 | button | Remove missing groups | reviewed_mutation_candidate | 0 | Not exercised |
| rota-rules-ts::editorHtml::53c8d032b871 | frontend/src/rota-rules.ts:823 | button | Remove missing units | reviewed_mutation_candidate | 0 | Not exercised |
| rota-rules-ts::editorHtml::5436f2bc51f0 | frontend/src/rota-rules.ts:830 | input | rr-${id}-label-input | field_value_or_selection_change | 14 | Not exercised |
| rota-rules-ts::editorHtml::af03f498caa9 | frontend/src/rota-rules.ts:835 | select | rr-${id}-group-input | field_value_or_selection_change | 14 | Not exercised |
| rota-rules-ts::editorHtml::4795533536ef | frontend/src/rota-rules.ts:841 | input | rr-${id}-hours-input | field_value_or_selection_change | 14 | Not exercised |
| rota-rules-ts::editorHtml::dc3de307517b | frontend/src/rota-rules.ts:851 | button | Reset this duty | action_requires_contract_review | 3 | Not exercised |
| rota-rules-ts::editorHtml::5fa5df7fc388 | frontend/src/rota-rules.ts:852 | button | Done | action_requires_contract_review | 2 | Not exercised |
| rota-rules-ts::listHtml::d2a59370fcd2 | frontend/src/rota-rules.ts:871 | button | Show all duties | action_requires_contract_review | 1 | Not exercised |
| rota-rules-ts::-callback-::0d894361ee19 | frontend/src/rota-rules.ts:889 | button | ${CHEVRON} ${esc(categoryLabel(cat, true))} ${rules.length === total ? plural(total, "duty", "duties") : `${rules.length} of ${total} duties`} ${edited ? ` ${edited} edited ` : ""} ${nobody ? ` ${nobo | action_requires_contract_review | 2 | Not exercised |
| rota-rules-ts::guardHtml::a084fb0ae48c | frontend/src/rota-rules.ts:929 | button | Edit in Limits | action_requires_contract_review | 5 | Not exercised |
| rota-rules-ts::guardHtml::1f1f90ec099c | frontend/src/rota-rules.ts:932 | button | ${CHEVRON} Limits Monthly caps, rest, unit cover and equal duties · read-only here ${problems.length ? ` ${problems.length} to check ` : ""} | action_requires_contract_review | 3 | Not exercised |
| rota-rules-ts::dockHtml::c0f7016b78b9 | frontend/src/rota-rules.ts:990 | button | ${saving.confirmed ? "Reload saved rules" : "Saving..."} | reviewed_mutation_candidate | 3 | Not exercised |
| rota-rules-ts::dockHtml::72ce8eb1bfd0 | frontend/src/rota-rules.ts:990 | button | Discard | dismissal_or_draft_decision | 3 | Not exercised |
| rota-rules-ts::dockHtml::57ab87d37ae5 | frontend/src/rota-rules.ts:991 | button | Review &amp; save | reviewed_mutation_candidate | 28 | Not exercised |
| rota-rules-ts::setStatus::4b0736ac1a17 | frontend/src/rota-rules.ts:1092 | button | Dismiss message | action_requires_contract_review | 0 | Not exercised |
| rota-rules-ts::render::8344e4732b2a | frontend/src/rota-rules.ts:1493 | button | Close review | dismissal_or_draft_decision | 60 | Not exercised |
| rota-rules-ts::render::90f9288ecff0 | frontend/src/rota-rules.ts:1498 | button | ${saved.busy ? "Loading saved rules..." : "Reload saved rules"} | reviewed_mutation_candidate | 1 | Not exercised |
| rota-rules-ts::render::8344e4732b2a::2 | frontend/src/rota-rules.ts:1501 | button | Keep editing | action_requires_contract_review | 60 | Not exercised |
| rota-rules-ts::item::f025cf3b8ee0 | frontend/src/rota-rules.ts:1514 | button | ${esc(p.duty_key ? `Go to duty: ${label(p.duty_key)}` :  | action_requires_contract_review | 1 | Not exercised |
| rota-rules-ts::render::8344e4732b2a::3 | frontend/src/rota-rules.ts:1516 | button | Close review | dismissal_or_draft_decision | 60 | Not exercised |
| rota-rules-ts::render::d0b167ea605d | frontend/src/rota-rules.ts:1524 | button | Reload (discard mine) | dismissal_or_draft_decision | 1 | Not exercised |
| rota-rules-ts::render::a8f888856f44 | frontend/src/rota-rules.ts:1524 | button | Review again | action_requires_contract_review | 0 | Not exercised |
| rota-rules-ts::render::b5579d8ed3c0 | frontend/src/rota-rules.ts:1531 | button | ${esc(saveLabel)} | reviewed_mutation_candidate | 16 | Not exercised |
| rota-rules-ts::render::8344e4732b2a::4 | frontend/src/rota-rules.ts:1532 | button | Keep editing | action_requires_contract_review | 60 | Not exercised |
| rota-rules-ts::-callback-::3fa9184fcbd5 | frontend/src/rota-rules.ts:1778 | button | Compare with current | action_requires_contract_review | 1 | Not exercised |
| rota-rules-ts::-callback-::be99175bf73d | frontend/src/rota-rules.ts:1779 | button | Restore… | reviewed_mutation_candidate | 2 | Not exercised |
| rota-rules-ts::-callback-::de370ca3167f | frontend/src/rota-rules.ts:1784 | button | ${busy ? "Restoring…" : "Restore this version"} | reviewed_mutation_candidate | 1 | Not exercised |
| rota-rules-ts::-callback-::ffe9198195b0 | frontend/src/rota-rules.ts:1785 | button | Cancel | dismissal_or_draft_decision | 1 | Not exercised |
| rota-rules-ts::render::8344e4732b2a::5 | frontend/src/rota-rules.ts:1789 | button | Close history | dismissal_or_draft_decision | 60 | Not exercised |
| rota-rules-ts::render::689222e6351a | frontend/src/rota-rules.ts:1791 | button | Try again | action_requires_contract_review | 0 | Not exercised |
| rota-rules-ts::render::624534e07afc | frontend/src/rota-rules.ts:1792 | button | Reload rules | action_requires_contract_review | 0 | Not exercised |
| rota-rules-ts::render::8344e4732b2a::6 | frontend/src/rota-rules.ts:1795 | button | Close | dismissal_or_draft_decision | 60 | Not exercised |
| rota-rules-ts::pageHtml::f987cc799777 | frontend/src/rota-rules.ts:1912 | button | Manage eligibility groups | action_requires_contract_review | 3 | Not exercised |
| rota-rules-ts::pageHtml::4b40998d9c1a | frontend/src/rota-rules.ts:1913 | button | History | action_requires_contract_review | 3 | Not exercised |
| rota-rules-ts::pageHtml::a5c2bc8942da | frontend/src/rota-rules.ts:1928 | input | rr-search | field_value_or_selection_change | 7 | Not exercised |
| rota-rules-ts::-callback-::8caa7fdbaaf7 | frontend/src/rota-rules.ts:1931 | button | ${esc(f.label)} 0 | action_requires_contract_review | 4 | Not exercised |
| rota-rules-ts::pageHtml::3053ae7b0b35 | frontend/src/rota-rules.ts:1935 | button | Expand all | action_requires_contract_review | 1 | Not exercised |
| rota-rules-ts::pageHtml::d7b33c60a139 | frontend/src/rota-rules.ts:1936 | button | Collapse all | action_requires_contract_review | 1 | Not exercised |
| rota-rules-ts::renderRotaRulesPage::698500bdf04f | frontend/src/rota-rules.ts:2123 | button | Try again | action_requires_contract_review | 0 | Not exercised |
| superadmin-ts::superadminSlotAction::659d9709fe77 | frontend/src/superadmin.ts:112 | button | ${esc(label)} | action_requires_contract_review | 1 | Not exercised |
| superadmin-ts::publishAnywayControl::076693bdbacc | frontend/src/superadmin.ts:124 | button | Publish anyway (superadmin) | reviewed_mutation_candidate | 1 | Not exercised |
| superadmin-ts::reasonBlock::fc5adffb2680 | frontend/src/superadmin.ts:180 | textarea | ${prefix}-reason | field_value_or_selection_change | 1 | Not exercised |
| superadmin-ts::reasonBlock::f79849324041 | frontend/src/superadmin.ts:186 | input | checkbox | field_value_or_selection_change | 1 | Not exercised |
| superadmin-ts::header::8344e4732b2a | frontend/src/superadmin.ts:270 | button | Close superadmin allocation | dismissal_or_draft_decision | 60 | Not exercised |
| superadmin-ts::noticeHtml::470f978f2413 | frontend/src/superadmin.ts:289 | div | div | action_requires_contract_review | 1 | Not exercised |
| superadmin-ts::chip::00709f1e6110 | frontend/src/superadmin.ts:295 | button | ${label} ${c[key]} | action_requires_contract_review | 1 | Not exercised |
| superadmin-ts::personRow::6cf5b45c7749 | frontend/src/superadmin.ts:307 | input | sa-person | field_value_or_selection_change | 0 | Not exercised |
| superadmin-ts::crossPanel::d14bf34009de | frontend/src/superadmin.ts:346 | input | checkbox | field_value_or_selection_change | 1 | Not exercised |
| superadmin-ts::footer::dda4009b735b | frontend/src/superadmin.ts:358 | button | Close | dismissal_or_draft_decision | 60 | Not exercised |
| superadmin-ts::footer::8344e4732b2a | frontend/src/superadmin.ts:360 | button | Cancel | dismissal_or_draft_decision | 60 | Not exercised |
| superadmin-ts::footer::7d45161b4814 | frontend/src/superadmin.ts:361 | button | ${busy === "save" ? "Allocating…" : "Allocate"} | reviewed_mutation_candidate | 1 | Not exercised |
| superadmin-ts::body::51a31eb6687d | frontend/src/superadmin.ts:366 | button | Try again | action_requires_contract_review | 1 | Not exercised |
| superadmin-ts::body::4bb8944a3afb | frontend/src/superadmin.ts:377 | input | sa-search | field_value_or_selection_change | 1 | Not exercised |
| superadmin-ts::successHtml::8416c77b4c71 | frontend/src/superadmin.ts:391 | section | section | action_requires_contract_review | 1 | Not exercised |
| superadmin-ts::undoHtml::987955cda5fc | frontend/src/superadmin.ts:402 | button | Undo this allocation | action_requires_contract_review | 1 | Not exercised |
| superadmin-ts::undoHtml::87badc7de4a1 | frontend/src/superadmin.ts:405 | button | Yes, undo it | action_requires_contract_review | 1 | Not exercised |
| superadmin-ts::undoHtml::dc447f63e21d | frontend/src/superadmin.ts:405 | button | Keep it | action_requires_contract_review | 0 | Not exercised |
| superadmin-ts::undoHtml::dc447f63e21d::2 | frontend/src/superadmin.ts:409 | button | Close this message | dismissal_or_draft_decision | 0 | Not exercised |
| superadmin-ts::undoHtml::987955cda5fc::2 | frontend/src/superadmin.ts:412 | button | Try again | action_requires_contract_review | 1 | Not exercised |
| superadmin-ts::undoHtml::b597c352ee96 | frontend/src/superadmin.ts:413 | section | section | action_requires_contract_review | 1 | Not exercised |
| superadmin-ts::allocate::dacab68ad6d2 | frontend/src/superadmin.ts:560 | button | Refresh the list | action_requires_contract_review | 0 | Not exercised |
| superadmin-ts::body::8416c77b4c71 | frontend/src/superadmin.ts:632 | section | section | action_requires_contract_review | 1 | Not exercised |
| superadmin-ts::body::470f978f2413 | frontend/src/superadmin.ts:642 | div | div | action_requires_contract_review | 1 | Not exercised |
| superadmin-ts::footer::8344e4732b2a::2 | frontend/src/superadmin.ts:655 | button | Close | dismissal_or_draft_decision | 60 | Not exercised |
| superadmin-ts::footer::8344e4732b2a::3 | frontend/src/superadmin.ts:657 | button | Cancel | dismissal_or_draft_decision | 60 | Not exercised |
| superadmin-ts::footer::5e5e25650309 | frontend/src/superadmin.ts:658 | button | ${busy ? "Publishing…" : "Publish anyway"} | reviewed_mutation_candidate | 1 | Not exercised |
| superadmin-ts::render::8344e4732b2a | frontend/src/superadmin.ts:665 | button | Close publish anyway | dismissal_or_draft_decision | 60 | Not exercised |
| ui-ts::-callback-::5fc5d008f207 | frontend/src/ui.ts:227 | button | ${matched ? "Use " : ""}${esc(c.name)} ${esc(candidateLine(c) \|\| c.reason \|\| "")} | action_requires_contract_review | 5 | Not exercised |
| unit-member-lists-ts::action::a9f1661f0d50 | frontend/src/unit-member-lists.ts:24 | button | ${text} | action_requires_contract_review | 2 | Not exercised |
| workflow-import-history-ts::render::49876d9de6a4 | frontend/src/workflow-import-history.ts:38 | div | Import batch history | action_requires_contract_review | 0 | Not exercised |
| workflow-import-history-ts::-callback-::443416306831 | frontend/src/workflow-import-history.ts:40 | button | View rows | action_requires_contract_review | 5 | Not exercised |
| workflow-import-history-ts::-callback-::62ca81ca4578 | frontend/src/workflow-import-history.ts:41 | button | Rejected rows CSV | action_requires_contract_review | 5 | Not exercised |
| workflow-import-history-ts::render::391b47b05ca9 | frontend/src/workflow-import-history.ts:42 | button | Previous batches | action_requires_contract_review | 3 | Not exercised |
| workflow-import-history-ts::render::6613f536e0ac | frontend/src/workflow-import-history.ts:42 | button | Next batches | action_requires_contract_review | 3 | Not exercised |
| workflow-import-history-ts::render::c77d4251334a | frontend/src/workflow-import-history.ts:43 | div | Recorded import source rows | action_requires_contract_review | 0 | Not exercised |
| workflow-import-history-ts::render::a11de9414481 | frontend/src/workflow-import-history.ts:44 | button | Previous rows | action_requires_contract_review | 3 | Not exercised |
| workflow-import-history-ts::render::6a519b57db58 | frontend/src/workflow-import-history.ts:44 | button | Next rows | action_requires_contract_review | 3 | Not exercised |
| workflow-import-history-ts::mountWorkflowImportHistory::689222e6351a | frontend/src/workflow-import-history.ts:55 | button | Try again | action_requires_contract_review | 0 | Not exercised |
| workspace-load-state-ts::workspaceLoading::31df60554107 | frontend/src/workspace-load-state.ts:28 | button | Close | dismissal_or_draft_decision | 1 | Not exercised |
| workspace-load-state-ts::workspaceLoadFailure::31df60554107 | frontend/src/workspace-load-state.ts:41 | button | Close | dismissal_or_draft_decision | 1 | Not exercised |
| workspace-load-state-ts::workspaceLoadFailure::f75ebf1b2fe4 | frontend/src/workspace-load-state.ts:41 | button | Try again | action_requires_contract_review | 3 | Not exercised |

## Investigation candidates

- repeated_binding_candidate: frontend/src/limits.ts:686,931 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/limits.ts:691,932 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/limits.ts:890,1023 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/limits.ts:903,1027 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/main.ts:1138,1196,8169 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/main.ts:1163,1660,9986,9991 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/main.ts:1666,10089 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/member-import-history.ts:23,36 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/member-profile.ts:25,76 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/member-workspace.ts:381,1285 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/member-workspace.ts:660,779,799,844,855,891,988,1004,1175,1471,1480,1489,1518,1621 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/member-workspace.ts:758,947,964,1530 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/member-workspace.ts:1099,1715 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/member-workspace.ts:1465,1511 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/member-workspace.ts:1467,1512 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/operational-import.ts:53,251 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/operational-import.ts:54,252 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/operational-import.ts:84,122,531,539,628,642,720 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/operational-import.ts:591,601 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/past-duties.ts:50,196 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/past-duties.ts:51,165 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/recycle-bin.ts:202,335 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/reference-workspace.ts:33,167,233,557 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/reference-workspace.ts:40,335,350,634,653 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/reference-workspace.ts:101,405,687 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/reference-workspace.ts:106,433,699 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/reference-workspace.ts:341,668 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/reference-workspace.ts:378,643 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/rota-compute.ts:279,486 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/rota-compute.ts:412,487 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/rota-intelligence.ts:37,59 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/rota-rules.ts:1452,1464 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/rota-rules.ts:1597,1813 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/rota-rules.ts:1601,1817 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/superadmin.ts:237,624 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/superadmin.ts:238,625 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/superadmin.ts:565,700 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/superadmin.ts:570,703 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/superadmin.ts:573,706 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/superadmin.ts:590,709 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/unit-board-filters.ts:49,69 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/workflow-import-history.ts:51,64 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.
- repeated_binding_candidate: frontend/src/workspace-load-state.ts:29,42 — Repeated source expressions may refer to different lifecycles or instances. Prove duplicate activation before calling this a defect.

## Limitations

AST and markup discovery cannot prove live control visibility, final labels, permissions, exact endpoint ownership, request count, DOM geometry or persisted outcomes. Template interpolation can create many runtime controls from one source occurrence. Shared event delegation can bind controls in other modules. Candidate test matches are lexical and may include unrelated uses of a common selector. Manual ownership mapping and production-serving browser outcome checks remain required.
