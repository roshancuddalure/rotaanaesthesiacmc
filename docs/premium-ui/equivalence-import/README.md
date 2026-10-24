# Fresh CSV import equivalence

The report records six original/current pairs: Chromium, Firefox and WebKit at
320 and 1280 pixels. Each run restores the same synthetic RAM-only database,
imports a member in create-only mode, appends leave and appends a unit posting.
Each file has one included and one excluded row. Operational exclusions are
refreshed before Apply. Every confirmation is first declined, then explicitly
accepted; no save request, callback or persisted change occurs on refusal.

The server captures actual received multipart bodies. File names, MIME types,
byte lengths and SHA256 hashes must match the input fixtures exactly. Plain
multipart field strings, JSON Apply bodies and statuses compare exactly between
frontends. Random multipart boundaries are excluded. Only preview IDs observed
in actual responses are replaced in request paths. Saved-state comparison uses
semantic fields and excludes generated primary keys and creation timestamps.

No API request is intercepted or reconstructed by Playwright in the passing run.
The test-only native Vite proxy preserves browser file uploads, including WebKit.
Preliminary failure screenshots are diagnostic history, not passing evidence.

This does not certify roster sync, member updates, operational updates/replacement,
other fixtures/roles/formats, complete import exports, concurrent production
transactions, real GPU execution, or whole-programme acceptance. Test requests
are serialized because the dedicated SQLite RAM fixture shares one connection.
No application/backend source changes or production operations were performed.

## Reproduce

Requires existing frontend dependencies/browsers, backend test dependencies, and
the captured manifest-verified snapshot in
`tmp/premium-ui-baseline-20261021T130359Z` with its node_modules junction.
Do not use a different source baseline or edit source during the run.

From the repository root in separate PowerShell terminals:

```powershell
backend/.venv/Scripts/python.exe tools/frontend_equivalence_server.py
```

```powershell
$env:FRONTEND_EQ_ROOT='tmp/premium-ui-baseline-20261021T130359Z/frontend'
$env:FRONTEND_EQ_PORT='5201'
node frontend/node_modules/vite/bin/vite.js --config tools/frontend-equivalence-vite.mjs
```

```powershell
$env:FRONTEND_EQ_ROOT='frontend'
$env:FRONTEND_EQ_PORT='5202'
node frontend/node_modules/vite/bin/vite.js --config tools/frontend-equivalence-vite.mjs
```

From current `frontend`:

```powershell
node tests/premium-import-equivalence.browser.mjs
```

Do not run generation equivalence or other tests against port 8032 concurrently:
each restores the disposable fixture. `EQUIVALENCE_QUICK=1` is a diagnostic
single-pair run and cannot substitute for the full matrix.

Parser negative controls, from the repository root:

```powershell
backend/.venv/Scripts/python.exe -m unittest discover -s tools -p test_frontend_equivalence_uploads.py -v
```
