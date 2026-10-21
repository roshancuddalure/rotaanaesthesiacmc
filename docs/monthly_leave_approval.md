# Monthly leave approval

In Leave, choose the working month and select **Approve all pending (N)**. Computer admins and superadmins can review and approve all `requested` and `imported_pending_review` leave overlapping that month. Individual approval remains available through **Edit leave → Approval state**.

The review lists every included request and its full dates. A request spanning adjacent months is approved for its entire date range. Approved, cancelled, rejected and non-overlapping records stay unchanged. The button is disabled when nothing is pending.

Existing active duty assignments overlapping those requests are listed and require explicit acknowledgement. Approval does not cancel or reassign duties; review/repair them separately. Cancelled assignments are excluded from this conflict list.

Both endpoints require admin authorization. Apply checks a review token bound to the admin, month and availability/reference snapshot under the shared transaction lock. Changed data requires a fresh review. Status updates and per-request audit/member activity records commit together; failure rolls back the batch. Repeating or concurrently submitting a completed batch creates no additional approvals or audit records.

Endpoints:

- `POST /api/v1/leave/approval-preview` with `month`.
- `POST /api/v1/leave/approve-month` with `month`, `review_token` and optional `acknowledge_duties`.

Verification:

- Leave API/service tests: 26 passed, including 13 existing leave regressions.
- Disposable PostgreSQL concurrency suite: 13 passed, including simultaneous monthly approval.
- Frontend unit tests: 56 passed; TypeScript/production build passed.
- Browser: complete review/apply at 1280px, 390px and 320px; individual editor preserved; non-admin control hidden/API forbidden; stale review recovery; assignments retained; no horizontal table overflow; no serious/critical axe findings in the dialog.
- Artifact: `docs/benchmarks/leave_approval_browser.json` and `frontend/tests/artifacts/leave-month-approval-mobile.png`.

Run backend checks using `backend/.venv/Scripts/python.exe -m pytest backend/tests/test_leave_approval.py backend/tests/test_leave.py -q` and `backend/.venv/Scripts/python.exe tools/test_compute_postgres.py`. For browser tests, start the disposable loopback fixture `tools/leave_approval_smoke_server.py` (port 8025) and Vite on port 5197, then run `npm run test:leave-approval` in `frontend`. Neither fixture nor tests access production data. No schema migration is needed.
