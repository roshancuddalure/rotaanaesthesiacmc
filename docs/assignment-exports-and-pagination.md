# Assignment Excel downloads and pagination

Draft assignments can be downloaded from Template → Export → Draft assignments Excel (Eagle Eye), or directly before the board approval form in Publish & Export. The workbook opens on the assigned-name matrix, retains the unit allocation matrix, includes a filterable assignment register, and labels the download as a draft. Weekend columns are highlighted, headings and duty groups use distinct colors, and panes are frozen.

After approval, Download approved Excel includes the assigned-name matrix, approval details, assignment register, counts, fairness, safety, review decisions, exchange history, and the existing full 360° report: coverage, member workload, individual limits, units, calendar, extra duties, superadmin allocations, compliance, trends, and audit history. The report marks unavailable analysis sections explicitly.

New approvals store an assignment fingerprint, including member and slot identities and shift times. Changed assignments require approval again before downloading an approved workbook. Older approvals without a fingerprint remain compatible; their Summary sheet explicitly says that historical assignment verification is unavailable. This change does not create historical snapshots of rules or analysis inputs.

Excel treats user-entered strings as text. Empty drafts, invalid months, missing approval, stale approval, and unexpected export errors have explicit API responses. Existing client download handling covers timeouts, expired sessions, malformed files, and network failures.

Lists and tables use 10 rows by default, with 20 and 30 available. Existing analysis pagers share page state between desktop tables and mobile cards. Complete record collections use a shared pager that retains existing form nodes, resets when filtered records change, and clamps page boundaries. Unit posting lists and operational import reviews use data-level pagination. Fixed display caps were removed from review, workload, exchange, diagnostic, and candidate lists. Calendar layouts and summary charts retain their existing presentation.

Validation commands:

- Frontend: `npm test`, `npm run test:pagination`, `npm run build`.
- Backend: `.venv\Scripts\python.exe -m pytest tests/test_rota_publish.py tests/test_rota_template.py tests/test_rota_report_360.py -q`.

Focused tests cover workbook content and colors, text/formula handling, missing and stale approvals (including a change of member identity with the same displayed name), API error recovery, row limits, page boundaries, independent lists, filtering, retained form values, and print materialization. Backend tests use isolated SQLite fixtures; browser pagination checks use Chromium fixtures. No production data is changed by these checks.
