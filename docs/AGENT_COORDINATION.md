# Agent coordination note

Several AI tools are editing this repository at the same time. Please read this before editing a file listed here.

**Claude Code, Balance duties option 2** (22 Oct 2026, FINISHED: these files are no longer being edited). Spec: `docs/balance_extra_duties_contract.md`.

Files being edited (small, targeted edits only):

- backend/app/services/balance_duties.py
- backend/app/services/extra_duty.py (ledger views, labels and the undo message only)
- backend/app/services/rota_report_360.py
- backend/tests/test_balance_duties.py, backend/tests/test_rota_report_360.py, backend/tests/test_extra_duty.py
- frontend/src/balance-duties.ts, frontend/src/extra-duty.ts
- frontend/src/main.ts, frontend/src/member-workspace.ts and frontend/src/styles.css (tiny edits only; styles.css is append-only with `balance-` classes)
- frontend/src/services/api.ts (types only)
- frontend/tests/balance.browser.mjs, frontend/tests/extra-duty.browser.mjs

If you need to change one of these files, re-read it immediately before editing. Never revert lines you didn't write.
