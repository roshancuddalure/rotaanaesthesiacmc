# Current production responsive audit

The final report records 19 routes × four widths (320, 390, 768, 1280) × light/dark:
152 route checks and eight complete Chromium browser sessions. It checks actual
navigation outcomes, meaningful view content, page overflow, axe WCAG-tagged rules,
per-page errors and all session errors, including startup and between-page events.

152 full-page screenshots and 32 viewport captures are retained. Root inspected
nine viewport images, listed in `../reviews/responsive-refresh-current.json`.
That sample is not a claim that every screenshot, role, dialog or state has been
visually reviewed. Physical devices and native assistive technology remain pending.

The audit uses current production assets on loopback port 5198 and a separate
synthetic superadmin RAM database on port 8033. Unexpected API mutations are blocked;
only the existing read-only rules-validation POST is allowed. The test server
serializes its single SQLite connection. This does not establish production locking
or authentication/session security. No application/backend changes were made.

Build inputs and audit source/dist hashes stayed fixed; audit assets match the
held build manifest. The older `qa-responsive-refresh-20261023` pass is retained
as groundwork and predates the final global-session error gate.

## Reproduce

From repository root, build and start the separate disposable fixture:

```powershell
backend/.venv/Scripts/python.exe tools/verify_frontend_build_snapshot.py
backend/.venv/Scripts/python.exe tools/frontend_visual_fixture_server.py
```

In another terminal from `frontend`:

```powershell
npm.cmd run preview -- --host 127.0.0.1 --port 5198 --strictPort
```

In a third terminal from `frontend`:

```powershell
$env:PREMIUM_TEST_URL='http://127.0.0.1:5198'
$env:PREMIUM_TEST_API='http://127.0.0.1:8033'
$env:PREMIUM_TEST_LIMITS='1'
$env:PREMIUM_TEST_OUTPUT='qa-responsive-new-review'
node tests/premium-regression.browser.mjs
```

Use a new output name to retain historical evidence. Do not edit source or rebuild
while the audit runs. The script fails if its snapshots change, the matrix is
incomplete, a tagged violation/page overflow/route failure occurs, or any browser
session reports an error. A passing page matrix does not verify every action.
