# Publication equivalence

This full-app test compares the captured frontend baseline with current source
using identical synthetic RAM seeds and the same real backend services. The full
matrix is Chromium, Firefox and WebKit at 320/1280 pixels with four cases:

- Ready: blank note is rejected locally, confirmation refusal makes no request,
  explicit approval creates one persisted publication and enables final export.
- Warnings: publication without warning acknowledgement returns 409 and saves
  nothing; acknowledgement followed by explicit confirmation saves one approval.
- Blocked: an open duty keeps publication disabled and creates no approval.
- View-only publication: the computer-admin role's controls are disabled; an
  explicit API bypass probe returns 403 and creates no approval.

Exact request bodies, statuses and saved approval/checklist semantics compare.
Before/after saved duty and assignment snapshots must also stay identical for
every case, including publication, rejection and workbook download.
Current confirmation text deliberately names May 2026; the old confirmation is
generic, so copy is retained in reports rather than required to be identical.
Current blank-note handling also checks keyboard focus reaches the note field.
Source files are held stable, and baseline hashes must match the captured manifest.

Each successful case downloads the actual final workbook through the app button.
The workbook comparator requires `Summary!A9` to equal `Published at` and
`Summary!B9` to match that run's exact persisted approval instant. Only after that
check does it normalize B9 for comparison. Every other typed cell, formula, cached
value, dimension and sheet order must match exactly. There is no pattern-based
timestamp exclusion. Raw workbook/report hashes and both instants are retained.

Generated approval primary keys and creation instants are excluded from the
cross-run state comparison, with raw instants retained for workbook validation.
No application/backend sources are edited or production database accessed.
SQLite fixture requests are serialized; these checks do not prove production
locking, all permission roles, all blockers/warnings, override publishing, all
exports, native assistive technology, physical devices or whole-item acceptance.

## Reproduce

Use the retained manifest-verified snapshot and the same RAM server/native proxy
setup as [the CSV comparison](../equivalence-import/README.md). Run this suite alone
against port 8032. From current `frontend`:

```powershell
node tests/premium-publish-equivalence.browser.mjs
```

`EQUIVALENCE_QUICK=1` is diagnostic: one desktop browser and four cases. It cannot
substitute for the full 24 pairs. From repository root, compare a workbook pair:

```powershell
backend/.venv/Scripts/python.exe tools/frontend_publish_workbook_comparison.py docs/premium-ui/equivalence-publish/chromium-320-ready-baseline docs/premium-ui/equivalence-publish/chromium-320-ready-current
```

Repeat for each engine/width and successful case (`ready`/`warnings`). The final
aggregate report records twelve workbook pairs. Comparator negative controls:

```powershell
backend/.venv/Scripts/python.exe -m unittest discover -s tools -p test_frontend_publish_workbook_comparison.py -v
```

Preliminary failure artifacts remain diagnostic history and are not passing evidence.
