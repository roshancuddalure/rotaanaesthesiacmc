# Rota Board UX Plan

Last updated: 2026-05-07

## Direction

The main website should serve the rota board, not expose computer-admin cleanup machinery. Analysis cleanup, alias review, duplicate review, historical import diagnostics, parser warnings, and mapping controls are backend/admin concerns.

The board-facing UI should focus on:

- Duty distribution
- Person-level workload
- Weekend and weekday burden
- Duty-type breakdown
- Monthly trends
- Department member lookup
- Posting and call-level history when useful for rota decisions

## Board-Facing Navigation

Visible to rota board users:

- Overview
- Duty Analysis
- Department Members
- Rota Board, coming soon
- Leave, coming soon
- Exports, coming soon

Hidden from rota board users:

- Mappings
- Historical Import
- Manual Review
- Skipped Names
- Alias Review
- Duplicate Review
- Member Cleanup
- Diagnostics
- Login Accounts
- Raw JSON/API/debug screens

## Admin Navigation

Visible only to `computer_admin` and `superadmin`:

- Mappings
- Historical Import
- Login Accounts
- Diagnostics

Admin/member cleanup tools remain available only to admin roles.

## Phase 1 Implemented

Phase 1 goal: hide admin/debug UX from the rota board experience.

Completed:

- Changed sidebar branding from admin console to rota board.
- Removed admin/import/mapping/diagnostic navigation for rota board users.
- Added an `Admin tools` navigation group for `computer_admin` and `superadmin`.
- Changed Overview from mapping/import counts to board-facing duty metrics.
- Overview now shows total 24hr duties, weekend 24hr duties, active personnel, months analysed, and top duty-load lists.
- Department Members now hides audit chips, duplicate review tables, cleanup buttons, reconciliation buttons, and creation tools from rota board users.
- Department Members shows call level as read-only for rota board users.
- Admin users can still edit call levels and use member cleanup/reconciliation tools.
- Direct access attempts to hidden admin frontend views redirect non-admin users back to Overview.

Verification:

- Frontend production build passed.
- Backend tests passed: 50 tests.

## Phase 2 Implemented

Clean the board-facing pages visually and ergonomically:

- Improved Overview layout hierarchy with a board summary header, primary workload metrics, and quick insight cards.
- Added direct Overview actions for Duty Analysis and Department Members.
- Highlighted total 24hr duties, weekend duties, weekend share, and average duties per active person.
- Added board-facing insight cards for highest total load, highest weekend load, and active personnel coverage.
- Renamed Analysis tabs to board-friendly labels:
  - Board Summary
  - People
  - Weekend Load
  - Duty Mix
  - CART / Schell
  - PAC / Shifts
  - Call Changes
- Renamed analysis chart headings away from database-style wording.
- Changed `Total records` wording to `Assignments reviewed`.
- Grouped individual person popup metrics into Duty Load, Campus Calls, and Special Duties.
- Improved Department Members summary chips for active/historical members and assigned call levels.
- Renamed `Designation / Position Stats` to `Position Mix`.

## Phase 3 Implemented

Mobile conversion:

- Added mobile card fallbacks for analysis tables beyond the People tab:
  - Weekend Load
  - Duty Mix
  - CART / Schell
  - 5th Call
  - PAC / Shifts
  - Postings
  - Call Changes
- Kept desktop analysis tables intact while hiding them on mobile where card views are available.
- Made the individual person popup full-screen on mobile.
- Improved mobile analysis tabs with larger touch targets and horizontal snap scrolling.
- Improved mobile analysis search layout and count wrapping.
- Reduced chart height and bar width on smaller screens.
- Improved member/filter touch layout and mobile card text wrapping.
- Added a mobile-only bottom navigation bar for Overview, Analysis, and Members.
- Synced active navigation state between the sidebar and mobile bottom navigation.
- Added stronger overflow protection for long names, duty labels, and month lists.

Verification:

- Frontend production build passed.

## Phase 4 Next

Visual QA and interaction polish:

- Run desktop and mobile screenshot checks.
- Inspect `1440x900`, `1280x720`, `1024x768`, `430x932`, `390x844`, and `375x667`.
- Verify no board-facing page exposes admin/debug language.
- Verify no incoherent overlap or horizontal page overflow.
- Tune spacing, chart readability, modal scrolling, and long-name wrapping.
- Check keyboard focus states and tab order for core board workflows.

## UX Audit Checklist

Desktop:

- Check `1440x900`, `1280x720`, and `1024x768`.
- Verify no board-facing page shows admin language.
- Verify all main actions are clear.
- Verify long names and duty labels do not overflow.

Mobile:

- Check `430x932`, `390x844`, and `375x667`.
- Verify no horizontal scrolling.
- Verify modals fit the viewport.
- Verify filters and cards remain usable.

Role visibility:

- Rota board member should not see admin tools.
- Computer admin should see admin tools.
- Superadmin should see admin tools.
- Board users should not see duplicate review, manual review, alias review, import status, or diagnostics.
