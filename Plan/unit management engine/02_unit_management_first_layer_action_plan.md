# Unit Management First Layer Action Plan

Last updated: 2026-05-07

## Goal

Build only after user approval.

The first layer should create a usable monthly unit assignment board without enforcing final staffing thresholds yet.

## Implementation Status

Implemented on 2026-05-07.

This first layer is now a manual, month-based Unit Management board backed by `PersonPosting`.
It is ready for rota-board testing before staffing threshold rules are added.

## Implemented First Layer

1. Added board-facing `Unit Management` navigation item.
2. Added backend API for active units.
3. Added backend API for monthly unit assignments from `PersonPosting`.
4. Added create/update/delete APIs for monthly assignments.
5. Added frontend monthly unit assignment board.
6. Used Department Member picker only; no free-text member names.
7. Assignment fields supported:
   - member,
   - unit,
   - call level/posting type,
   - start date,
   - end date,
   - notes.
8. Shows unit/call-level grouped roster for selected month.
9. Shows leave-aware summary per unit:
   - assigned members,
   - people with approved leave,
   - total leave days,
   - rough available count.
10. Added basic validation:
    - duplicate overlapping primary unit assignment,
    - missing call level/posting type,
    - inactive member assigned,
    - no unit selected for primary assignment.
11. Added responsive unit cards.
12. Added tests for:
    - creating monthly assignment,
    - listing monthly assignment matrix,
    - duplicate overlap warning,
    - leave-aware unit summary.

## Verification

- Backend `pytest -q` passed: 54 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

## Phase 2 Workflow Update

Implemented on 2026-05-07.

User clarification:

- Unit Management should be fresh for a selected month.
- It should not automatically display historical/imported unitwise assignments.
- It should preserve only assignments created by the rota team from the Unit Management board.
- Warnings should be collapsible and should not consume the main page height.
- Unit cards should open a popup where members can be managed in place.

Implemented behavior:

1. Unit Management only reads `PersonPosting` rows with `source = "unit_board"`.
2. New assignments created from Unit Management are saved with `source = "unit_board"`.
3. Historical/imported postings remain in the database but are ignored by this board.
4. Month cards now act as the primary workflow entry point.
5. Clicking a unit card opens a unit popup for the selected month.
6. The popup supports:
   - adding a member,
   - editing member/unit/posting/dates/notes,
   - moving a member to another unit,
   - removing a member.
7. Page-level validation is now a collapsible panel.
8. Unit-level validation inside the popup is also collapsible.

Verification:

- Backend `pytest tests/test_unit_management.py -q` passed.
- Backend `pytest -q` passed: 54 tests.
- Frontend `npm run build` passed after Windows/Vite sandbox escalation.

## Not in First Layer

- final staffing thresholds,
- automatic duty-slot adjustment,
- rota generator blocking,
- unitwise Excel import,
- approval/lock workflow,
- holiday-specific elective rules,
- post-duty elective availability rules.

## Next Layer After User Provides Rules

1. Add unit staffing rules table.
2. Add daily required count by unit/call level.
3. Add leave/duty/rest-aware availability engine.
4. Add unsafe-date warnings.
5. Integrate with rota slot generator.
6. Add automatic duty-slot adjustment policy.
