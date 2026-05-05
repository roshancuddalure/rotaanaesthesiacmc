# Domain Rules and Decision Trees

## Rule Engine Principle

Each parsed duty assignment should store:

- source file,
- sheet,
- row number,
- column number,
- raw row label,
- raw cell value,
- cleaned person name,
- canonical person id if resolved,
- duty date,
- day of week,
- classified duty type,
- whether it counts in main 24-hour total,
- whether it is weekend,
- rule id or rule version used,
- warnings or uncertainties.

## Rota Parsing Decision Tree

1. Read row 1 as date row and row 2 as day-of-week row.
2. For each date column:
   - if date cell is valid for target month/year, use it;
   - otherwise reconstruct date from day name plus occurrence count.
3. For each duty row:
   - read label from column 0;
   - classify label using priority rules;
   - apply contextual overrides such as PAC block after Schell row;
   - clean each assignment cell;
   - discard noise values such as blank, x/xxxx, pure numbers, punctuation-only cells;
   - emit one assignment record per valid person per duty type.
4. For combined Schell plus Floating row:
   - emit two records for the same person/date: Schell and Floating.

## Duty Classification Priority

Order matters. A row should be tested in this priority:

1. PAC override or PAC label.
2. Shift.
3. CART.
4. CHAD.
5. RUHSA.
6. Schell plus Floating combined.
7. Schell.
8. Fifth call.
9. Floating.
10. Caesar.
11. CB.
12. RC/Ranipet.
13. Main.
14. Paeds.
15. Neuro department.
16. Unknown/needs review.

## Main 24-Hour Inclusion

Count in main 24-hour total:

- Main 1st, co-1st, 2nd, 3rd, 4th, co-3rd, co-4th.
- CB 1st, 3rd, 4th, co-3rd, co-4th.
- RC 1st A, 1st B, 2nd, 3rd, 4th, co-3rd, co-4th.
- Caesar B.
- Schell.
- Floating.

Do not count in main 24-hour total:

- Fifth call.
- CART.
- PAC.
- Shift.
- Caesar A.
- CB co 12-hour.
- RC co 12-hour.
- RC 12-hour.
- CHAD.
- RUHSA.
- Neuro department.

## Weekend Rule

Weekend means Saturday or Sunday. Track weekend status for all duty types, even if only some categories get detailed weekend dashboards.

## Unitwise Parsing Decision Tree

1. Read header row.
2. Detect unit columns containing Unit, Dept, Cardiac, or Neuro.
3. Track current category from first column labels.
4. For each unit column cell:
   - split special posting rows by slash or comma;
   - clean each name;
   - map category to call level or posting type;
   - emit person-month unit/call level or posting record.
5. If a unitwise file covers multiple months, apply it to each covered month.

## Name Resolution Decision Tree

1. Clean obvious suffix noise:
   - date ranges,
   - ICU/SICU/MICU/DRP/BP/ONLY markers,
   - parenthetical qualifiers,
   - trailing punctuation.
2. Apply explicit alias table.
3. Apply case normalization and common spelling variant mappings.
4. If confidence is high, link to canonical person.
5. If ambiguous, place into duplicate review queue.
6. Never merge known distinct people automatically.

Known distinct people from the reference guide include:

- Angeline M A and Angeline Anirutha.
- Rohan Chacko Jacob and Rohan Jacob Titus.
- Sharon Kavya and Sharon Ebenezer.
- Samuel D C and Samuel Cherwin Wesley.
- Preethi Kuryan and Preethy A.
- Divya A J and Divyalakshmi.
- Anisha Joy and Anisha Pauline.
- Joel Koil Raj and Joel Daniel.
- Karthik Pandian and Karthik S.
- Jeenu Ann Jose and Jeenu D.

## Leave Conflict Decision Tree

When adding or importing a duty assignment:

1. Check if person exists and is active.
2. Check approved leave for that date.
3. Check requested but pending leave for that date.
4. Check duty spacing rules if configured.
5. Check call level eligibility.
6. Check campus/unit restrictions if configured.
7. If conflict exists:
   - block publish,
   - allow draft with warning,
   - require override reason for manual exception.

## 24-Hour Duty Spacing Rule

Confirmed hard rule: the same person must have at least 24 hours between two 24-hour duties.

Decision tree:

1. When assigning a 24-hour duty, find that person's existing 24-hour duties.
2. Compare the proposed duty start date/time with nearby 24-hour duty start/end date-times.
3. If the gap is less than 24 hours, create a validation error.
4. Draft may keep the assignment for review, but publish/export should be blocked unless an explicit admin override policy is later approved.

Implementation note:

- If source files only contain duty dates and not precise times, define a standard duty start time per duty type in admin settings.
- Until exact start/end times are configured, treat same-day and next-day 24-hour duties as unsafe unless rules explicitly say otherwise.

## Rota Generation Decision Tree

For each duty slot:

1. Determine duty type and required level/eligibility.
2. Build eligible candidate pool.
3. Remove unavailable people:
   - approved leave,
   - existing duty conflict,
   - rest spacing violation if hard rule.
4. Score remaining candidates:
   - lower total duties preferred,
   - lower weekend count preferred for weekend slot,
   - monthly balance,
   - unit distribution,
   - campus fairness,
   - recent duty spacing,
   - special posting restrictions.
5. Suggest ranked candidates.
6. If auto-generation is enabled, assign best candidate and record score/explanation.

## Configurable Duty Limits

Duty limits should not be hardcoded. Admin settings should allow limits by:

- call level,
- duty type or duty group,
- month/period,
- weekday/weekend,
- campus/unit if needed,
- effective date or rule version.

## Validation Issue Levels

- Error: cannot publish until fixed, for example approved leave conflict.
- Warning: allowed but needs review, for example unusual duty count imbalance.
- Info: data quality note, for example reconstructed date or unknown alias resolved manually.
