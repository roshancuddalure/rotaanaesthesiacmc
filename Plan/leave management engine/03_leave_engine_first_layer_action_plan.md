# Leave Engine First Layer Action Plan

Last updated: 2026-05-07

## Goal

Build the first working layer of the leave engine before slot-template/call-level slot design is finalized.

This layer focuses on manual leave storage and board visibility. File upload/import and advanced slot rules come later.

## Micro Action Items

1. [x] Extend leave data model minimally:
   - add `leave_slot`,
   - add `raw_person_name`,
   - add `updated_at`.
2. [x] Add Alembic migration for those columns.
3. [x] Add leave service helpers:
   - month date parsing,
   - date-range overlap filtering,
   - inclusive leave day count,
   - month calendar/day summaries,
   - unit/call-level context from current member/posting data.
4. [x] Add leave API endpoints:
   - list monthly leave requests,
   - create leave request,
   - update leave request,
   - cancel leave request,
   - month summary/calendar dashboard.
5. [x] Add frontend API types and functions.
6. [x] Add board-facing Leave navigation:
   - sidebar item,
   - mobile bottom navigation item.
7. [x] Add basic Leave screen:
   - month selector,
   - summary metrics,
   - manual leave form,
   - calendar/day cards,
   - leave list with cancel action.
8. [x] Keep person entry selector-based:
   - select from Department Members,
   - no free-text person creation.
9. [x] Add first backend tests:
   - create/list leave,
   - summary counts,
   - cancel leaves excluded from active blockers.
10. [x] Update planning/development documentation.

## First Layer Implemented

Implemented on 2026-05-07:

- backend leave model extension,
- Alembic migration `20260507_0007_leave_first_layer`,
- leave service for monthly summary/calendar data,
- authenticated leave API routes,
- frontend Leave navigation and mobile bottom navigation item,
- basic Leave screen with manual add/cancel,
- leave calendar pressure cards,
- first backend tests.

Verification:

- Backend `pytest -q` passed: 52 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

## Deferred to Next Phase

- CSV/XLSX import preview.
- Leave slot template design by call level.
- Configurable leave pressure limits.
- Unit-specific leave limits.
- Rota generator conflict enforcement.
- Approval workflow beyond status storage.
- Leave entitlement/balance tracking.
