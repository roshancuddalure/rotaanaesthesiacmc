# Admin delete and recycle bin: API contract

Written for: the developers building the backend and frontend of this feature in parallel.

Owner decisions (21 Oct 2026):
- **Who and what:** admins can delete members, leave records, unit postings and past duties.
- **How many:** one row, selected rows, or everything in a month.
- **Recycle bin:** deleted items disappear everywhere but stay restorable for 30 days, then are removed for good.

All routes require `require_admin` on the server. Errors are 4xx with `detail` either a string or `{code, message, ...}`.

## Kinds

| kind | What one item is | Select by | Notes |
|---|---|---|---|
| `member` | a `persons` row | `ids` | **Blocked** (not deleted, listed in `blocked`) when the member has duty assignments, leave or postings. The reason gives the counts and suggests archiving or merging; delete their leave and postings first if really needed. Deleting also removes, into the same bin entry: aliases, designations, call-level changes (both tables), eligibility-group memberships, comments, member activity, and resolution rules pointing at them. |
| `leave` | a `leave_requests` row | `ids` or `month` | `month` = leave whose `starts_on` falls in the month. |
| `posting` | a `person_postings` row | `ids` or `month` | `month` = postings whose `starts_on` falls in the month. Replaces the old `DELETE /unit-management/assignments/{id}`, which must now go through the bin. |
| `past_duty` | a `duty_assignments` row whose slot date is **before today** | `ids` or `month` | `month` = such assignments in the month. If the slot is left with no assignments and its `source` is an upload or historical source (not a live rota template), the slot goes into the same bin entry. Assignments dated today or later are refused (blocked: "not a past duty"). |

## Endpoints

1. `POST /api/v1/admin/delete/preview` with body `{"kind", "ids"?: [uuid], "month"?: "YYYY-MM"}` (exactly one of `ids`/`month`). Returns 200:
   - `kind`, `count` (items that will be deleted)
   - `items: [{id, label}]` (first 50), where `label` is human text such as "Asha AJ · Annual leave · 3–4 Oct 2026"
   - `blocked: [{id, label, reason}]`
   - `effects: {extra_slots?: int, linked_records?: int}`
   - `preview_token: str` (a hash of the exact ids that will be deleted)
   - `confirm_phrase: str | null`: set only for `month` deletes, e.g. `"DELETE LEAVE 2026-10"`
2. `POST /api/v1/admin/delete` with body `{"kind", "ids"?, "month"?, "preview_token", "confirm_phrase"?}`. Returns 200 `{"batch_id", "deleted": int}`.
   - All in one transaction.
   - A stale token (data changed since the preview) gives 409 `{code:"stale_preview"}`.
   - A wrong or missing phrase on a month delete gives 422 `{code:"confirm_phrase"}`.
   - Nothing deletable (all blocked or empty) gives 422 `{code:"nothing_to_delete"}`.
   - Records one `member_activity` per deleted member (action `member_deleted`). Other kinds are recorded in the bin entry itself.
3. `GET /api/v1/admin/recycle-bin`. First permanently purges entries past `purge_after`, then returns the newest first:
   - `batch_id`, `kind`, `count`
   - `labels` (first 5)
   - `deleted_at`, `deleted_by`, `purge_after` (ISO)
   - `restored_at`, `restored_by`
4. `POST /api/v1/admin/recycle-bin/{batch_id}/restore` returns 200 `{"restored": int, "failed": [{label, reason}]}`.
   - Re-inserts the saved rows (same ids) in dependency order, in one transaction per item.
   - An item that cannot come back fails alone with a reason, for example: its member was deleted or merged, an identical record now exists, or its slot is gone.
   - A second restore returns 409 `{code:"already_restored"}`. An unknown batch returns 404.
5. `DELETE /api/v1/admin/recycle-bin/{batch_id}` with body `{"confirm": true}` deletes permanently now (no undo). Returns 200 `{"purged": int}`.
6. `GET /api/v1/admin/past-duties/recorded?month=YYYY-MM` lists past duty assignments in the month for the delete UI:
   - `[{id, date, duty_type, duty_label, member_id, member_name, source, status}]`, sorted by date then duty.
   - Admin only; at most 2,000 rows (a `truncated` flag says if there were more).

## Storage

Table `deleted_records` (migration `20261021_0026`):
- `id`, `batch_id` (indexed), `kind`
- `entity_id` (the item's id), `label`
- `payload` JSON (`{table_name: [row dicts]}` for the item and its dependent rows)
- `deleted_by_id`, `deleted_by_name`, `deleted_at`
- `purge_after` (deleted_at + 30 days)
- `restored_at`, `restored_by_name`

One row per deleted item; a batch is one delete action. Column values are serialised to JSON-safe values (UUIDs, dates and datetimes as ISO) and restored with the column types.

## Frontend

- **Shared pieces:**
  - `frontend/src/admin-delete.ts`: `confirmAdminDelete({kind, ids?, month?, title})` opens the preview window and returns the result or null. The window shows the count, the blocked rows and the typed phrase for month deletes, and states "Deleted items can be restored from the Recycle bin for 30 days".
  - `frontend/src/services/api.ts`: functions for every endpoint above.
- **Members:** the row menu gains "Delete member…"; the table and cards get selection checkboxes with "Delete selected (n)".
- **Leave:** each table row gets "Delete leave…" plus selection; the toolbar "More" menu gets "Delete all leave for <month>…".
- **Units:** the postings table gets the same as Leave ("Delete all postings for <month>…").
- **Past duties page:** a new "Recorded past duties · <month>" table with selection, "Delete selected" and "Delete all past duties for <month>…".
- **Recycle bin:** a new admin-tools section (`data-view="recycle-bin"`) lists bin batches with **Restore** and **Delete forever** (the latter with a confirm). Failed restores show their reasons.
