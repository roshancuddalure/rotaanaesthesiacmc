# Member name resolution: Phase 0 audit

Written for: the rota owner and the developer who builds the single resolver (Phase 1).

Date: 20 Oct 2026. No behaviour was changed in this phase. Every number below was measured on the
database copy `duty_rota_ux_audit`, never on the working database.

## The short answer

Imports put the wrong member on a row mainly because of **saved aliases, not fuzzy matching**.
The historical rebuild created 753 aliases in bulk from fuzzy guesses (`historical_analysis_variant`),
382 of them a single word. Every live import treats an alias as an exact match. Shared short names
are therefore assigned to one fixed person, whatever the call level or date:

| Short name | Always given to | Should depend on context (alias summary) |
|---|---|---|
| Sam | Sujil Ebenezar Sam | Samcharles D (1st/2nd call), Samuel D C (4th call), otherwise ask |
| Daniel | Daniel Jonathan Roy L | Pradeep Daniel (4th), Joel Daniel (1st after Mar 2026) |
| David | David Samson Rontala | Karumuru David Raj (2nd call), otherwise ask |
| Rohan, Rohan C | Rohan Chacko Jacob | Rohan Jacob Titus (3rd call before Apr 2026) |
| Riya | Riya Sarah Abraham | Riya Lal (3rd call) |
| Angeline | Angeline Mary Abraham | Angelin Aniruth (1st–3rd call, ordinary PAC) |
| Priyadarshini / Priyadharshini | one fixed person each | Priyadharshini S (1st/2nd), Priyadarshini Kalahasthi (3rd) |
| Joseph | Chris Maria Joseph | Joseph A P |

The alias summary records "Sam → Sujil" as a bug that was fixed in the analysis, but the alias is
still saved, so live imports still make that mistake.

## Every place a typed name becomes a member

| # | Path (reached from) | Name key | Includes archived / historical | Fuzzy | Assigns without review? |
|---|---|---|---|---|---|
| 1 | `normalization.resolve_member`: unit/leave review import, member CSV, `POST /members/resolve` | `member_key` + aliases | in lookup, never assigned | candidates ≥ 0.65 | Exact or alias only |
| 2 | `leave_import.match_person`: older leave import `/leave/import-*` | slot/code-stripping clean → `member_key` | no | suggestion ≥ 0.90 | Exact or alias only, but see risk 5 |
| 3 | `unit_assignment_import.match_person_for_unit_import`: older unit import `/unit-management/import-*` | `clean_person_name` → `member_key` | no | variant score ≥ 0.65 (suggestion) | Exact or alias only; the `fuzzy_auto` branch (L995) is dead code |
| 4 | `past_duties.preview_past_duties`: `/admin/past-duties/*` | `normalize_member_name` (keeps spaces) | yes | ≥ 0.82 candidates | Unique key only |
| 5 | `member_import.preview_member_import`: member workbook | `compact_name_key` | yes (can update archived members) | ≥ 0.82 → review | Unique key only |
| 6 | `member_csv.build_preview`: member CSV | ID or `member_key` | yes, restore needs confirmation | ≥ 0.85 → review | Exact only |
| 7 | `roster_reconciliation.reconcile_department_roster`: "Reconcile trusted roster" button | `compact_name_key` | yes | prefix (≥ 7 chars) or ratio ≥ 0.94 | **Yes: renames and merges people** |
| 8 | `members.auto_merge_duplicate_candidates`: "Auto-merge duplicates" button | compact canonical + aliases | yes | exact key incl. aliases | **Yes: merges people** |
| 9 | `unitwise_call_levels.match_person`: "Prefill call levels" button | alphanumeric only, no aliases | yes | prefix 0.96 / subset 0.95 / ratio ≥ 0.88 | **Yes: sets call levels** |
| 10 | `historical_analysis_dry_run` (command line) | `clean_person_name` → compact | creates "historical" people | context rules + fuzzy aliases | **Yes: hard-coded context defaults; also writes the bulk aliases** |
| 11 | `historical_import.get_or_create_person` (no route) | `member_key` | yes | none | Exact; else creates a person |
| 12 | `members.normalize_dirty_member_names`: "Clean invalid names" | cleaned exact | yes | none | **Merges when a cleaned name equals another member** |

Normalisation differs between paths:
- `member_key` strips titles only at the start of a name.
- `normalize_member_name` and `clean_person_name` strip "Dr", "Ms" or "Mr" anywhere in the name.
- Past duties keeps spaces, so "Ann Mary" ≠ "Annmary".
- The member-workbook fuzzy check compares a spaceless key with a spaced one (`member_import.py` L290), which weakens its suggestions.
- `members.identity_conflict` is never called.

## Golden test set

`backend/tests/fixtures/member_resolution_cases.csv` holds 644 cases:
- **275 from `Plan/Alias/Alias_Resolution_Summary.md`.** Each context rule became a structured call level and date. Every short name that the rules give to two or more people also has a no-context case, whose correct outcome is "ask".
- **369 real spellings** from the historical rota and unitwise files and the leave imports. The truth for each row is the member it was actually applied to. Any spelling used for several people must ask when no call level is given. A cell naming two people (for example "Abella, Zakam David") must never be given to one of them.

| Expected outcome | Cases | Meaning |
|---|---|---|
| matched | 228 | Must assign this member |
| member_or_review | 336 | May assign this member or ask; anyone else is wrong |
| needs_review | 42 | Must ask |
| not_auto_assigned | 28 | Placeholders, unresolved names, two-person cells |
| not_found | 3 | No such member in the roster (Divya L, Joanna, Vineeth Indla, per the summary) |
| owner_confirm | 7 | Summary and roster disagree; excluded from scoring until you decide |

The summary's canonical spellings differ from the roster for 17 people, for example "Jerin Daniel" → "Jerin Daniel D", "Sam Charles D" → "Samcharles D" and "Preethi Kuryan" → "Preethi Elizabeth Kurian". The mapping used is in the "identity_mapped" rows and needs your confirmation.

## Baseline accuracy (Phase 0, before any change)

Scored on 637 cases (owner_confirm excluded). "Acceptable" means the matcher assigned the right person or asked.

| Matcher | Acceptable | Wrong person assigned | Assigned when it should ask | Missed a known alias |
|---|---|---|---|---|
| Review import (unit/leave CSV, member CSV) | 75.7% | 25 | 22 | 108 |
| Older leave import | 75.0% | 29 | 22 | 108 |
| Older unit import | 75.0% | 29 | 22 | 108 |
| Call-level prefill | 79.3% | 30 | 22 | 80 |
| Member workbook import | 76.8% | 27 | 22 | 99 |
| Past duties import | 76.3% | 26 | 22 | 103 |
| Historical rebuild (context-aware) | 85.1% | 39 | 55 | 1 |

What the numbers say:
- **No matcher is safe.** Each assigns the wrong person, or assigns when it should ask, 47 to 94 times. Phase 1's target is **zero**.
- **The live imports miss over 100 known aliases from the summary.** "Jerin" and "Pradeep K", for instance, are never found, because those spellings were never saved as aliases.
- **The historical rebuild is the only matcher that uses context.** It is the most accurate overall, but it also assigns most often when it should ask, because its hard-coded defaults guess (for example "Joel" at an unknown level → Joel Koil Raj).

The per-case results are in `docs/member_resolution_baseline.json`.

## Other risks found

1. **Unreviewed merges and renames:** paths 7, 8 and 12 can permanently merge two real people. `ensure_person_alias` can also silently move an alias from one person to another.
2. **Over-eager cleaning:** the leave cleaner strips real initials as if they were slot or leave codes ("Lakshmi SH", "Ravi EL", "A. Ramesh"), which can produce a wrong exact match.
3. **Silent alias overwrite:** the historical alias loader keeps whichever alias is written last when two people share one (`historical_analysis_dry_run.py` L1316).
4. **Likely duplicate people:** 13 pairs, listed in `backend/tests/fixtures/member_suspected_duplicates.csv`. 12 of them are an active member paired with a historical twin, which splits duty history. Examples: Vinobarathi (57 duties) / Vinobharathi E (47), Jasmin J / Jasmine J, Harshvardhini R / Harshavardhini R, Abhinav / Abinav Priyan A, Samuel D C / Samuel David Chandran. There is also an active member called "roshan" with 0 duties.

## Decisions (owner, 20 Oct 2026)

1. **Shared short names** are decided by call level and date using the rules, otherwise the import asks. Saved aliases stay in the database but are no longer trusted blindly.
2. **The context rules live in one shared table** (`member_resolution_rules`), seeded from the alias summary. Live imports and the historical rebuild both read it, and admins can edit it.
3. **Confirmed mappings:** SERINA → Serina Ruth Salin, KAREN → Karen Ruby Lionel, ANITA → Anita Shirley Joselyn, SATHISH → Sathish Kumar D, SREE → Anjane Sree, and Joanna → Joanna Emmanuel. The 17 spelling mappings are confirmed.
4. **Samuel D C (historical) and Samuel David Chandran (active) are one person.** Rules point to the active record, and the pair goes to the reviewed merge.
5. **No duplicate members.** New members that resemble an existing one need review, and a reviewed merge screen handles existing pairs. Admins keep the power to override and edit any detail at any time.
6. **The three unreviewed admin buttons** (reconcile roster, auto-merge, prefill call levels) become preview + confirm.

Found during Phase 1:
- **"Anirudha"** is a separate historical record, but the summary says the name is Angelin Aniruth. It is added to the suspected duplicates.
- **The historical rebuild checked its old-file spelling table before its call-level rules,** so "sam", "joel", "david" and 9 other shared names always went to one fixed person. Those 12 entries are removed, and the rebuild now uses the shared rules.

## Phase 1 result: one shared resolver

`backend/app/services/member_resolver.py` is now the only code that turns a written name into a member. The context rules live in the `member_resolution_rules` table (migration `20261020_0023`, seeded from the alias summary).

Switched to the shared resolver:
- the unit/leave review import and the member CSV import (via `normalization.resolve_member`);
- the older leave and unit imports;
- past duties and the member workbook import;
- the historical importer and the historical rebuild's call-level rules.

The three admin buttons (reconcile roster, prefill call levels, clean invalid names) and auto-merge now show a preview and change nothing until an admin confirms that exact preview. If the data changed in between, the server answers 409 and the preview is shown again. Adding a member whose name resembles an existing one asks "different person?" first.

| Matcher (644 golden cases) | Acceptable | Wrong or premature assignments |
|---|---|---|
| Before: review import | 75.7% | 47 |
| Before: older leave/unit import | 75.0% | 51 |
| Before: call-level prefill | 79.3% | 52 |
| Before: member workbook import | 76.8% | 49 |
| Before: past duties | 76.3% | 48 |
| Before: historical rebuild | 85.1% | 94 |
| **After: shared resolver, live imports** | **100%** | **0** |
| **After: shared resolver, history imports** | **100%** | **0** |
| **After: historical rebuild** | **100%** | **0** |

"Before" figures are scored against the Phase 0 labels; the owner's decisions have since settled some of those cases.

The historical rebuild also resolves through the shared resolver. Its 768 old-file spellings (`backend/app/services/historical_spellings.py`) became "history"-scope rules (migration `20261020_0025`). Live leave and unit imports never use them, and owner-reviewed rules win where a spelling disagrees.

14 doubtful spellings are left out and are asked about instead, pending the owner's decision. They are listed in `historical_spellings.DOUBTFUL`, for example:
- "Priyadharshini K" → Priyadharshini S (the initials differ);
- "Franklin J" → Franklin Vedha Prabhu;
- "Abella, Zakam David", a cell naming two people;
- "APARANJITH" → Aparanjit Paul;
- "Vineeth" → a person not in the roster.

To approve one, add it as a rule (or remove it from `DOUBTFUL`).

Results: `docs/member_resolution_after_phase1.json`.

## Phase 2 result: review screens and error handling

**Review screens.** Every import that names members now shows each row the same way, using `memberMatch` and `applyBlocker` in `frontend/src/ui.ts`. This covers unit and leave imports, member CSV, the member workbook and past duties.

Each row shows:
- the written name, the proposed member and how they were matched ("exact name", "approved alias", "name rule for this call level", "chosen by you");
- any warnings, and the likely alternatives as one-click buttons. A click saves the choice and re-checks the row.

Other edits are in a collapsed "Edit row". A new member that resembles an existing one offers "This is a different person". Next to Apply, one plain sentence says what still blocks it (for example "1 row needs a decision… First: row 2 "Sam""). The server refuses the same rows.

**Errors.**
- Bad files and bad rows return 4xx messages naming the row and the written name, never a traceback. Covered: empty, headings only, missing name column, corrupt workbook, duplicates, conflicts, unknown units, inactive members, missing member IDs, stale previews and unresolved rows.
- Every apply is all-or-nothing; tests force a failure after the first row and find nothing written.
- The tests are in `backend/tests/test_import_error_handling.py` (25 tests).

**Tests.**
- Backend: 447 passed, 8 skipped.
- Browser: members 10, imports 11, and the new review screen 2. The review screen test includes an axe scan with no serious or critical issues in light or dark.
- Page audit: 0 findings on Members, Units and Leave.

## Phase 3 result: clear all members and reviewed merging

**Clear all members** (Department Members → More → "Clear all members…", admins only).
- Clearing **archives** every active member; nothing is deleted. Duties, leave, postings and history keep their links.
- The window shows the counts first (members, duties, upcoming duties, leave, postings), with a warning about upcoming duties.
- The danger button works only after typing ARCHIVE ALL MEMBERS exactly.
- The server checks admin rights (403), the phrase (422) and the preview token (409 if members changed since the counts, after which the counts are re-shown).
- Everything happens in one transaction, with one activity record per member under a shared batch id.
- "Undo" restores exactly that batch. Members changed since are skipped and reported. "Earlier clears" lists past batches with their own restore buttons.
- Code: `app/api/v1/member_bulk.py`, `app/services/member_bulk.py` and `frontend/src/member-bulk.ts`.
- Tested end to end on the database copy: 223 archived, 223 restored, then 0 on a second undo.

**No duplicate members.**
- Adding a member whose name resembles an existing one asks "different person?" first (Phase 1).
- "Review possible duplicates" (More menu, and the data-quality strip) lists suspected pairs side by side, with duties, postings, leave and aliases. Each merge is chosen and confirmed by an admin and recorded as activity. "Not the same person" is remembered (`member_distinct_pairs`, migration `20261020_0024`).
- Pairs the reviewed name rules already tell apart are never offered, for example Angelin Aniruth / Angeline Mary Abraham. On the real roster this leaves 54 pairs to review, including the confirmed Samuel D C / Samuel David Chandran.
- Code: `frontend/src/member-duplicates.ts`.

## Phase 4: final checks (20 Oct 2026)

| Check | Result |
|---|---|
| Golden set, shared resolver, live imports | 644 cases, 0 wrong automatic assignments |
| Golden set, shared resolver, history imports | 644 cases, 0 wrong |
| Golden set, historical rebuild | 644 cases, 0 wrong |
| Same decision through every import path (`tests/test_resolver_entry_points.py`) | 7 paths, 9 tests pass |
| Property tests: case, spacing, punctuation, titles, database order | Pass (`tests/test_member_resolver.py`) |
| Error handling: every bad-input case gives a row-specific 4xx, nothing half-applied | Pass (`tests/test_import_error_handling.py`, 25 tests) |
| Clear all and duplicates | Pass (`tests/test_member_bulk.py`, 9 tests; browser `test:clear-all`, `test:duplicates`) |
| Full backend suite | 465 passed, 8 skipped |
| Frontend typecheck, unit tests, build | Pass (52 unit tests) |
| Browser: members, imports, review screen, duplicates, clear all | 10, 11, 2, 3 and 2 pass (axe: no serious/critical issues, light and dark) |
| UX audit, 17 sections × 4 widths × light/dark, strict | 0 findings on 136 checks |
| Keyboard and navigation | 1,510 focus stops all visible; 6 navigation workflows pass |

The before and after comparison is the "Phase 1 result" table above.

## How to rerun

Before using this on a database, apply the migrations: `0023` adds the rules table, `0024` adds clear-all batches and "not the same person" pairs, and `0025` adds the history-only spellings. From `backend/`, run `.venv/Scripts/python.exe -m alembic upgrade head`. Only rows are added; nothing existing is changed.

Scoring on a database copy (the script refuses the working database), from `backend/`:

```
.venv/Scripts/python.exe ../tools/member_resolution_eval.py tests/fixtures/member_resolution_cases.csv out.json duty_rota_ux_audit
```

Tests:
- Backend: `.venv/Scripts/python.exe -m pytest -q tests/test_member_resolver.py tests/test_resolver_entry_points.py tests/test_import_error_handling.py tests/test_member_bulk.py`
- Frontend: `npm run test:import-review`, `npm run test:duplicates`, `npm run test:clear-all`, `npm run test:members`, `npm run test:normalization`
