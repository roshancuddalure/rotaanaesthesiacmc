# Extra-duty layer — runbook

Written for: the rota administrator and whoever maintains the server.

## What it is

After **Build template** and **Autoassign members**, some duties may still be open, usually because the unit is short-staffed ("hard blocked"). The **Extra-duty layer** fills those duties anyway, under strict limits:

- **Never broken:** leave (approved, requested or awaiting review), rest after a 24-hour duty (day before and day after, and the minimum gap), two duties on the same day or at overlapping times, call level, eligibility groups.
- **May be exceeded:** unit staffing limits, monthly duty caps, equal-duty fairness. Each such duty is written to the **extra-duty ledger**.
- **Fallback unit:** if nobody in the template's unit can do the duty, the next suitable unit is used. Units with an admin-set fallback list are tried in that order first, then units on the same campus, then the least-loaded unit. The duty moves to that unit, and the original unit is recorded.
- **Justice:** whoever has done extra duties in the last 12 months goes down the list for the next one. The ledger never changes normal duty generation.

## Everyday use

1. Rota Template → **Extra-duty layer** → **Preview extra duties**.
2. Read the table. It shows, for each duty, who would get it, which limits are exceeded, and why that person was chosen. Duties that cannot be filled are listed with the reason.
3. Tick **I reviewed these extra duties** → **Apply extra duties**.
4. Review → Publish as usual. Covered hard blocks now appear as warnings to confirm, not blockers.
5. **Download audit report** (HTML or Excel) for the audit file. The HTML version prints cleanly to PDF.

## When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| "The plan changed since preview" | Someone changed duties, leave or postings after your preview. | Preview again. Nothing was saved. |
| "Another proposal is in progress" | A generation proposal is open for this month. | Use **Resume it** or **Cancel it** in the same window. |
| "Verification failed" | The final safety check found a problem just before saving. | Nothing was saved. Download the details and report them; preview again after fixing the data. |
| Duty listed under "Cannot be filled" | Every possible person is on leave, resting or ineligible, in every suitable unit. | Assign it by hand, adjust leave or postings, or add a fallback unit in Unit Management. |
| Wrong batch applied | — | **Undo this batch** (only while the month is a draft). If duties were changed since, the undo lists them and stops; fix or clear those first. |

## Disaster recovery

- **Undo a batch:** exact restore of the duties and units the batch changed. Ledger rows are kept and marked *void (undone)*.
- **The ledger is never deleted.** Clearing, replacing or deleting an extra duty marks its ledger row *void* with the reason.
- **Turn the feature off:** set `EXTRA_DUTY_LAYER_ENABLED=false` in the backend `.env` and restart. Existing duties and the ledger stay; the reports still list them.
- **Independent check:** `backend/.venv/Scripts/python.exe tools/extra_duty_verify.py --month 2026-06 --database-url <copy>` re-checks every duty of the month for leave, rest, double booking, call level, groups, unit posting and capacity. It refuses the working database unless explicitly forced. It only reads.
- **Before the first use on the real database:** back up, then `cd backend && .venv/Scripts/alembic upgrade head` (adds three tables; no existing data changes).
