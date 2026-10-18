# UI and import audit verification — 13 October 2026

Inspected revision: `0b6b85eb33944796009c8f874781d104b6e4f330`. All data below is synthetic.

## Main-screen browser results

| Size | Section | Viewport / document width | Accessibility findings | API failures observed |
|---|---|---|---|---|
| desktop | overview | 1440 / 1440 | None detected in this state | 0 |
| desktop | analysis | 1440 / 1440 | None detected in this state | 0 |
| desktop | members | 1440 / 1440 | aria-allowed-attr (3 nodes); color-contrast (1 nodes) | 0 |
| desktop | leave | 1440 / 1440 | None detected in this state | 0 |
| desktop | units | 1440 / 1440 | None detected in this state | 0 |
| desktop | rota-setup | 1440 / 1440 | select-name (3 nodes) | 0 |
| desktop | rota-template | 1440 / 1502 | aria-allowed-attr (4 nodes); aria-required-children (1 nodes) | 0 |
| desktop | rota-review | 1440 / 1440 | None detected in this state | 0 |
| desktop | rota-publish | 1440 / 1440 | None detected in this state | 0 |
| desktop | user-guide | 1440 / 1440 | None detected in this state | 0 |
| desktop | rota-rules | 1440 / 1440 | None detected in this state | 0 |
| desktop | call-clusters | 1440 / 1440 | None detected in this state | 0 |
| desktop | mappings | 1440 / 1440 | None detected in this state | 0 |
| desktop | imports | 1440 / 1440 | None detected in this state | 0 |
| desktop | accounts | 1440 / 1440 | None detected in this state | 0 |
| desktop | diagnostics | 1440 / 1440 | scrollable-region-focusable (1 nodes) | 0 |
| mobile | overview | 390 / 390 | None detected in this state | 0 |
| mobile | analysis | 390 / 390 | None detected in this state | 0 |
| mobile | members | 390 / 390 | color-contrast (1 nodes) | 0 |
| mobile | leave | 390 / 390 | None detected in this state | 0 |
| mobile | units | 390 / 390 | None detected in this state | 0 |
| mobile | rota-setup | 390 / 390 | select-name (3 nodes) | 0 |
| mobile | rota-template | 390 / 765 | aria-allowed-attr (4 nodes); aria-required-children (1 nodes) | 0 |
| mobile | rota-review | 390 / 767 | scrollable-region-focusable (7 nodes) | 0 |
| mobile | rota-publish | 390 / 390 | None detected in this state | 0 |
| mobile | user-guide | 390 / 390 | None detected in this state | 0 |
| mobile | rota-rules | 390 / 390 | None detected in this state | 0 |
| mobile | call-clusters | 390 / 390 | None detected in this state | 0 |
| mobile | mappings | 390 / 390 | None detected in this state | 0 |
| mobile | imports | 390 / 390 | scrollable-region-focusable (2 nodes) | 0 |
| mobile | accounts | 390 / 390 | None detected in this state | 0 |
| mobile | diagnostics | 390 / 390 | scrollable-region-focusable (1 nodes) | 0 |

No page JavaScript errors were recorded in the corrected main-screen run. Automated checks do not establish full accessibility compliance. Empty rota states do not verify every populated slot or candidate dialog.

## Additional flow states

- `analysis-overview` — captured in `tmp/ui_audit/flow-analysis-overview.png`.
- `analysis-personnel` — captured in `tmp/ui_audit/flow-analysis-personnel.png`.
- `analysis-weekend` — captured in `tmp/ui_audit/flow-analysis-weekend.png`.
- `analysis-duty-types` — captured in `tmp/ui_audit/flow-analysis-duty-types.png`.
- `analysis-cart-schell` — captured in `tmp/ui_audit/flow-analysis-cart-schell.png`.
- `analysis-fifth-call` — captured in `tmp/ui_audit/flow-analysis-fifth-call.png`.
- `analysis-shifts-pac` — captured in `tmp/ui_audit/flow-analysis-shifts-pac.png`.
- `analysis-postings` — captured in `tmp/ui_audit/flow-analysis-postings.png`.
- `analysis-promotions` — captured in `tmp/ui_audit/flow-analysis-promotions.png`.
- `unit-editor` — captured in `tmp/ui_audit/flow-unit-editor.png`.
- `member-columns` — captured in `tmp/ui_audit/flow-member-columns.png`.
- `member-preview` — captured in `tmp/ui_audit/flow-member-preview.png`.
- `leave-preview` — captured in `tmp/ui_audit/flow-leave-preview.png`.
- `unit-preview` — captured in `tmp/ui_audit/flow-unit-preview.png`.
- `past-columns` — captured in `tmp/ui_audit/flow-past-columns.png`.
- `past-preview` — captured in `tmp/ui_audit/flow-past-preview.png`.

Member preview: alphabetic synthetic names produced one unchanged existing member and one proposed new member with first/second-call normalization. Leave preview matched the synthetic member. A department-style unit matrix reached the unit review workflow. Past-duty workbook inspection and preview reached review without applying. Profiles were captured at both sizes; the unit editor and phone login were also captured. Screenshots are local and ignored by Git.

## Isolated API results

| Check | Result |
|---|---|
| Anonymous GET `/api/v1/admin/members` | HTTP 200 |
| Anonymous GET `/api/v1/admin/mappings` | HTTP 200 |
| Anonymous GET `/api/v1/analysis/dashboard` | HTTP 200 |
| Anonymous GET `/api/v1/admin/imports/historical/status` | HTTP 200 |
| Anonymous GET `/api/v1/auth/accounts` | HTTP 401 |
| Forgot-password using a known synthetic HOD username | HTTP 200; reset token returned: True |
| CSV preview `/api/v1/admin/members/import/preview` | HTTP 200; {'create': 0, 'update': 0, 'unchanged': 0, 'needs_review': 2, 'skip': 0} |
| CSV preview `/api/v1/leave/import-preview?month=2026-10` | HTTP 200; {'total_rows': 2} |
| CSV preview `/api/v1/unit-management/import-preview?month=2026-10` | HTTP 200; {'total_rows': 0} |
| Cross-month unit-board clear routine | 36 ongoing January postings before; 36 removed by October clear; transaction rolled back |

The first API member fixture deliberately used numbered synthetic names, which the strict importer rejected as invalid names. This was not recorded as an importer defect. The browser flow used alphabetic synthetic names and confirmed the normal unchanged/create pathway. Within-file duplicate leave rows were correctly marked for review. A conventional unit CSV yielded zero rows through the existing sectioned-text parser; the workbook matrix was inspected separately. These differences informed A051 and A115 rather than suggesting every importer fails.

The runtime cross-month check exercised `clear_unit_board_month` directly in a disposable transaction, not the live import endpoint. Source inspection confirms `apply_unit_assignment_import` calls this routine before its safe-row loop when replacement is selected.

## Harness and safety boundaries

- `tmp/ui_audit/server.py`: SQLite-only synthetic backend with database and authentication dependency overrides.
- `tmp/ui_audit/browser.cjs`: both viewport passes, screenshots and corrected axe scans.
- `tmp/ui_audit/flows.cjs`: analysis tabs and import review states, without import application.
- `tmp/ui_audit/api_checks.py`: separate in-memory API probes and rolled-back posting removal.
- `tmp/ui_audit/browser-results.json`, `flow-results.json`, `api-results.json`: raw synthetic results.
- `tmp/ui_audit/make_report.py`: backlog validation and document generation.

No real local/Public/Railway database was connected for the audit. Dependencies were installed only under the ignored audit directory; the application's package manifests and lockfiles were unchanged. Application build/tests were not rerun because this task changed documentation only. Regression testing is an acceptance gate for implementation after approval.
