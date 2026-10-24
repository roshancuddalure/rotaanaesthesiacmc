# Fresh generation equivalence

The companion browser report records six original/current comparisons (Chromium,
Firefox and WebKit, at 320 and 1280 pixels). Each UI run restores the same synthetic
SQLite RAM seed and uses the same current backend services. It generates and applies
four template duties, generates and applies four member assignments, reverses the
member generation, and exports the actual Eagle Eye workbook through the app UI.

`report.json` records source hashes and the compared requests, proposal decisions,
scores, burden, saved duty/assignment semantics and reversal outcomes.
`workbook-comparison.json` checks the twelve downloaded workbooks as six pairs.
Formula text, cached values, typed cell values, sheet order and dimensions are exact;
there is no broad timestamp or text exclusion. Individual directories retain the raw
proposal JSON reports, workbook and mutation report.

These are bounded integration checks, not complete item 255 or programme sign-off.
They do not cover imports, publish, optimizer, other fixtures/roles, actual GPU
execution, production database concurrency or physical/native assistive technology.
The single SQLite connection is serialized in this test server to preserve savepoints.
The real admission limiter stays active and starts fresh for each UI run.

Generated job IDs in mutation paths use explicit symbols from observed responses.
Downloaded member-decision slot IDs resolve to saved date/type/unit/call/label keys.
Raw generated IDs, context hashes and timing fields are retained in downloads but
excluded from the selected proposal-field comparison. Saved-state comparison excludes
generated primary keys and creation timestamps. No application/backend sources were
edited for this batch, and their hashes remained stable during execution.

## Reproduce locally

The strengthened test independently checks the exact requested four duty dates,
type/unit/call/label, time bounds and capacity, member identities/postings, and
the fixture's approved leave exclusion. Both previews compare the full saved
semantic state and raw slot ID map. Member apply preserves every template field
and matches the reviewed proposal; member reversal restores the exact
template-only snapshot. These checks do not rely only on baseline equality.
The generator itself is still opened by its exported module entry point. A
second full-app page now also downloads Eagle Eye while the four member
assignments exist, checks that exporting preserves exact saved state, then
leaves the original dialog available for reversal. The original post-reversal
export remains. Eagle Eye is a unit-allocation matrix: member names are not
part of its existing format. Both stages compare typed cells, formulas, cached
values, dimensions and sheet order; expected dates and unit cells are checked
independently. Visible production launchers have a separate six-context report
in `../qa-generation-launchers/report.json`.

Requires the retained, manifest-verified source snapshot at
`tmp/premium-ui-baseline-20261021T130359Z`, its existing node_modules junction,
the installed frontend dependencies/browsers, and backend test dependencies.
The snapshot is not replaced with Git HEAD. No production database is required.

In separate terminals:

1. From the repository root, run
   `backend/.venv/Scripts/python.exe tools/frontend_equivalence_server.py` (loopback port 8032).
2. From the snapshot's `frontend` directory, run
   `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5200 --strictPort`.
3. From the current `frontend` directory, run
   `npm.cmd run dev -- --host 127.0.0.1 --port 5197 --strictPort`.
4. From current `frontend`, run `node tests/premium-generation-equivalence.browser.mjs`.
   Do not run competing tests against port 8032 or edit source during this test.
5. From the repository root, compare each engine/width pair with:

   ```powershell
   backend/.venv/Scripts/python.exe tools/frontend_equivalence_artifacts.py docs/premium-ui/equivalence-generation/chromium-320-baseline docs/premium-ui/equivalence-generation/chromium-320-current
   ```

   Repeat for Chromium 1280 and Firefox/WebKit 320/1280. Exit code 0 means the
   recorded artifacts agree, 1 means differences, and 2 means invalid input.
   Historical files must not be presented as a fresh browser run.

`EQUIVALENCE_QUICK=1` limits execution to one desktop pair; it is diagnostic only.
Failure screenshots from preliminary attempts remain in this folder for diagnosis;
they are not passing evidence. The reviewed final full run is identified by the
timestamps and hashes in the companion reports and
`../reviews/generation-equivalence-current.json`.
