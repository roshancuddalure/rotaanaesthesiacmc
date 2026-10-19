# UI/UX upgrade: phase report and evidence

Written for: the rota team and anyone reviewing the UI/UX upgrade.

This folder holds the evidence for the UI/UX upgrade goal (Plan/UX). Every section of the app
was audited before and after the work with the same automated script, on a copy of the
department database (never the working database).

## Results

| Check (136 checks: 17 sections × 4 widths × light/dark) | Before | After |
|---|---|---|
| Serious or critical accessibility issues (axe, WCAG 2.2 AA) | **1,596** | **0** |
| Checks where the page scrolls sideways | 46 | 0 |
| Checks with cut-off controls | 34 | 0 |
| Checks showing internal codes (`UNIT_I`, `2ND_CALL`, raw IDs) | 24 | 0 |
| JavaScript errors | 0 | 0 |

The before accessibility issues were 1,434 colour-contrast failures (mostly dark mode),
64 unlabelled selects, 44 misused ARIA attributes, 38 scroll areas keyboards could not reach,
8 tab lists without tabs and 8 undersized targets.

A second after-run uses May 2026 (`after-may/`), the month with leave, postings and 1,698 rota
slots on record, so full pages are covered as well as empty ones.

| Other goal checks | Result |
|---|---|
| Backend tests | 340 passed, 8 skipped (same as before) |
| Typecheck, unit tests, production build | Pass (11 unit tests, including new `ui.test.mjs`) |
| Browser suites: normalization, members, compute, intelligence | Pass (11, 8, 14, all) |
| New: `test:navigation` | 6 workflows pass: no stale screens on fast switching, shared month survives reload, keyboard account menu, phone header, timing |
| New: `test:keyboard` | 1,510 focus stops across all sections in light and dark, every one with a visible focus outline |
| Layout on navigation | First frame within 2–6 ms on every section (goal: under 100 ms) |
| Overview first content | 26 ms (goal: under 1 s); layout shift 0.003 (goal: under 0.1) |
| Same data and export as before | Identical, at 1440 px and 390 px (see below) |

## Same data, same export (goal item 9)

`equivalence/` holds two runs of the same month workflow on two fresh copies of the real
database: one through the previous UI, one through the new UI. Each run saves the unit scope
and locks it, generates the November 2026 template, imports leave, unit postings and a member,
and exports the Eagle Eye workbook.

`tools/compare_workflow_runs.py` found them identical:
- the same 11 data-changing requests, in the same order with the same bodies
- 8 scope rows, 720 duty slots, 5 leave records, 12 postings, 313 members, 18 member-activity rows
- the exported workbook, cell for cell

The new UI was also run at 390 px wide: identical again.

## What changed, by phase

**Phase 0: shared foundations.** `frontend/src/ui.ts`: readable labels for stored codes,
dates like "Mon 19 Oct 2026", badges, empty states, loading placeholders, next-step callouts,
step indicators. A design-system layer at the end of `styles.css`:
- one button set (main, secondary, quiet, danger), with disabled buttons that look switched off
- styled form fields everywhere, including month and date pickers
- neutral number tiles; red only for the main action and real problems
- one badge set, compact tables and one window style with one close button
- complete dark-mode colours and an always-visible keyboard focus outline

**Phase 1: frame and navigation.**
- **Account menu:** Profile, Change password and Sign out in one menu; the connection status is a dot.
- **Working month:** one month selector in the header, shared by Leave, Units and the four rota steps, and remembered between visits.
- **Sidebar workflow:** Setup ① Template ② Review ③ Publish ④, each with a done or needs-action marker.
- **Loading:** pages show their layout immediately, and a slow page can no longer paint over the one you moved to.
- **Start-up:** navigation works immediately after sign-in instead of waiting for Overview data.

**Phase 2: sections.**
- **Members:** one roster card, status filters with counts, compact rows with an actions menu (archive moved out of the row), a data-quality strip.
- **Units:** a next-step notice, one toolbar, availability bars, honest labels with no unit codes, and a real "Manage" button instead of clickable cards.
- **Leave:** a Monday–Sunday month calendar showing who is away, shaded against the month's busiest day, with "Add leave on this day"; cancelling leave now asks for confirmation.
- **Rota Setup / Template / Review / Publish:**
  - each page opens with what blocks the next step and a button to fix it
  - Template shows 4 key figures instead of 16, with Export and Clear in menus
  - Publish is one checklist where each blocker links to the page that fixes it
- **Overview:** a "This month" panel with the four steps.
- **Import windows:**
  - one step indicator (Upload → Map columns → Review rows → Apply)
  - results grouped as new, updates, unchanged and need attention
  - example CSVs for members, unit postings and leave
- **Admin pages:** the same toolbar, table and empty-state patterns; no internal keys on screen.

## Problems found and fixed along the way

- The previous UI let a slow page overwrite the page you had switched to (seen: Leave showing
  Duty Analysis; Leave showing the Overview title).
- In the unit and leave import window, a file chosen before the member list finished loading was
  silently ignored. Present in the previous UI as well.
- The Rota Template toolbar ran past the right edge, leaving export buttons unreachable by pointer.
- The new sidebar tracker initially raced the Setup page to create a new month's rota period;
  it now refreshes only after the page has loaded.

## Running the checks again

Start the Vite dev server on 5178 and `tools/ux_audit_server.py` (port 8020; it refuses to use the
working database), then from `frontend/`:

```
npm run test:ux-audit -- after --strict          # all sections, 4 widths, light and dark
npm run test:ux-audit -- after-may --month=2026-05 --strict
npm run test:navigation
npm run test:keyboard
```

Browser suites need `MEMBER_TEST_BROWSER` pointing at a full Chromium build (headless shell has
no GPU for the compute suite). Screenshots: `<section>-<width>-<scheme>.png` (full page) and
`-top.png` (first screen) in `before/`, `after/` and `after-may/`; `README.md` and `results.json`
in each folder list every finding.

## Sign-off

- **Item 9 (same data and export):** accepted as done on 20 Oct 2026. The comparison ran on fresh copies of the local `duty_rota` database rather than a production snapshot.
- **Phase approvals:** the goal asked for a pause after each phase; the owner later asked for the work to be finished without stopping. Phases 0, 1 and 2 were reviewed and approved together on 20 Oct 2026.
