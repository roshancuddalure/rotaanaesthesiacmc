# Merging, deleting and recovering member records

Written for: rota admins and whoever maintains the Duty Rota system.

## What went wrong before (21 Oct 2026)

On the real roster, 26 of the 54 suggested duplicate pairs failed to merge, all with the same message, "Merge produced a duplicate record". There were three causes:

1. **Name rules pointed at the record being removed.** The merge didn't move name rules (`member_resolution_rules`), so the database refused to delete the merged-away record. This is the Joel V Peter case. The message wrongly called it a duplicate.
2. **Position histories clashed.** When both records had the same position from the same date with different end dates or notes, the merge refused.
3. **The duplicates list suggested different people.** Many pairs came only from one-word aliases ("Joseph", "Daniel", "Samuel") or fragments ("Priya S" / "RIYA S"), so different people were offered for merging.

## How merging works now

Code: `backend/app/services/member_merge.py`. Every merge path goes through it: the duplicates window, the member profile, roster reconciliation and auto-merge.

1. **Preview.** "Review merge…" runs the whole merge inside a database savepoint and rolls it back. It shows what will move (counts per kind), what will be combined, any conflicts (with a choice for each) and warnings, for example "both were on duty on the same days".
2. **Every reference.** The columns that refer to a member are discovered from the database model. Tables added later are covered without code changes.
3. **Duplicates combined, not refused:**
   - Same duty slot: one assignment is kept.
   - Same posting, leave record, name rule or "different person" decision: the kept member's is kept.
   - Same position, or same eligibility group, from the same date: their dates and notes are combined.
   - Same date with a different call level: this is a conflict. The default keeps the kept member's level; the admin can choose the other.
4. **Verified before saving.** After the changes, nothing may still refer to the merged-away record. If anything does, the merge is rolled back and nothing changes.
5. **Exact token.** Confirming sends the preview's token. If any record changed in between, the server refuses (409 `stale_preview`) and the window shows the new plan.
6. **Clear errors.** Every failure returns a plain reason and says that nothing was changed.

## Undoing a merge (disaster recovery)

- Each merge stores its before-image in `member_merges`. The image covers every moved, combined, edited, added and removed row.
- **Undo** is in the duplicates window, both straight after the merge and under "Recent merges". `POST /api/v1/admin/members/merges/{id}/undo` re-creates the merged-away record and puts every row back exactly, including automatic timestamps.
- If records were edited or deleted after the merge, undo refuses (409 `cannot_undo`) and lists exactly what changed, so the admin can fix those first. A refused undo changes nothing.
- An undone merge cannot be undone twice (409 `already_undone`).

## Deleting and the recycle bin

- **What can be deleted:** members (only when they have no duties, leave or postings; otherwise archive or merge instead), leave, unit postings and past duties. You can delete one, a selection, or a whole month (the month version needs a typed phrase).
- **Where deleted items go:** to the **Recycle bin** (Admin tools) for 30 days. **Restore** puts them back with the same ids. Items that can't come back are listed with the reason, and the rest are restored. **Delete forever** removes them at once.
- **Contract:** `docs/admin_delete_contract.md`.

## Checks you can run (on a database copy)

- From `backend/`: `.venv/Scripts/python.exe ../tools/merge_dry_run.py duty_rota_ux_audit`. For every suggested pair it previews, merges, verifies, undoes and compares every table with its state before; everything is rolled back. On 21 Oct 2026: 16 of 16 pairs passed.
- `.venv/Scripts/python.exe -m pytest tests/test_member_merge.py tests/test_member_bulk.py tests/test_admin_delete.py`
- `npm run test:duplicates`, `npm run test:admin-delete`, `npm run test:recycle-bin`, run in `frontend/`.

Both scripts refuse to run against the working database.

## Before using this on the real database

1. **Back up first:** `pg_dump -Fc duty_rota > duty_rota_before_merges.dump`. This is the last-resort recovery if something unexpected happens outside the app.
2. **Update the database:** run `alembic upgrade head` in `backend/`. Migrations `0023`–`0027` add tables and rows only.
3. **Merge from the list:** use "Review possible duplicates". Read each plan, especially the warnings, before confirming.
