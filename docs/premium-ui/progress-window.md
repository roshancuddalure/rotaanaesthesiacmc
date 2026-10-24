# Local progress window

Open **http://127.0.0.1:5199** in a separate browser window. If the local server has stopped, run from the repository root:

```powershell
python tools/frontend_progress_window.py --port 5199
```

This is a separate read-only progress viewer, not a new screen in the rota application. It does not connect to the rota API, credentials or database, and it does not add application dependencies. Its HTTP listener binds only to loopback. It serves the dashboard and an allowlisted progress snapshot; it offers no file browser or write endpoint.

The window reads the approved 260-item traceability ledger, acceptance audit and verification records. It shows partly implemented/evidenced, pending and dependency counts, with whole-requirement certification reported separately. Passed verification batches are listed as bounded results; they never become whole-requirement completion automatically.

Use search, the status filter, Previous/Next and each row's evidence disclosure to inspect all 260 items. The view refreshes repository data every five seconds and keeps the last data if a refresh fails. A manual Refresh button retries immediately. All times are shown in India Standard Time.

Current work notes come from `live-work.json`. Their timestamp is displayed; these are implementer updates, not independent proof that a process or agent is running. Do not infer active execution from an old note. Browser emulation and pending physical checks are explicitly identified.

The dashboard received six Chromium/Firefox/WebKit mobile/desktop checks covering count agreement, actual filters/pagination/disclosures, failed-refresh recovery, keyboard interaction, zero tagged axe violations, no horizontal page overflow, rejection of arbitrary paths and rejection of writes. Evidence: `qa-progress-window.json`. This does not establish physical-device or native screen-reader acceptance.

Automatic approval review rejected the attempt to open the browser with `Start-Process` as a command blocked by policy. The running loopback URL is available for the user to open directly; no repeated launch workaround was attempted.
