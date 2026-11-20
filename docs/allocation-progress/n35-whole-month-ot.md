# N35: whole-month duty/rest, OT identities and monthly equality

This gate exercises the existing real `solve_month` optimizer for all 30 days of November 2026. Four synthetic third-call members share a unit. Every day has one required 08:00-to-next-day-08:00 duty and an 08:00–16:00 OT band requiring three distinct members; the configured post-duty gap is 24 hours. The fixture uses the existing rules, candidate context, joint OT constraints and final-plan validator without changing clinical policy or writing proposed assignments.

The independent finite-state oracle does not import availability, duty-window, reservation-matching or objective helpers. At each day it explores an empty duty or each of the four holders, retaining the previous holder and complete four-person load vector. A person cannot hold adjacent duties. OT availability subtracts the **union** of previous/current duty holders and that day's full-band leave identities, requiring at least three remaining people. It retains every reachable state, computes maximum coverage, and then the smallest sum of squared monthly loads at that coverage. With a common call level and fixed coverage, the existing common target terms cancel, making this an independent check of the equality tier's ordering.

Two scenarios cover the full month: a control, and a preserved October 31 duty combined with approved November 3–7 leave for another member. The latter is repeated with reversed input slot order. The October duty is explicitly linked to October's rota period; assertions require it to be in nearby safety commitments and outside November's monthly assignment totals. December 1 is checked for rest/OT staffing caused by a November 30 duty. Required empty duties remain in the 30-slot denominator.

For each returned plan, the test separately reconstructs day-by-day distinct blocked identities, verifies no adjacent holder or same-day leave assignment, and checks monthly coverage and squared loads against the exhaustive oracle. The canonical final validator must also accept the complete plan. The preserved duty remains assigned; the number of saved assignments remains zero or the single boundary commitment. JUnit properties retain actual and oracle coverage, squared loads, member counts, optimizer status, elapsed time, cut count and objective proof receipts.

The earlier two-case run is retained in `n35-whole-month-ot.xml`. The final expanded gate and its source snapshot are `n35-whole-month-ot-final.xml` and `n35-whole-month-source.json`; final outcomes belong in the tracker and continuation log after the process terminates.

Final native session 59459 exited zero: **49 passed in 134.32 seconds**, no failures, errors or skips. This includes three new whole-month cases and 46 existing joint/integration cases. The initial two cases overlap the expanded gate. Scoped Ruff and whitespace checks passed; all 174 captured source hashes were rechecked unchanged after completion.

| Scenario | Oracle / actual coverage | Oracle / actual squared loads | Actual member duties |
|---|---:|---:|---|
| Control | 15 / 15 | 57 / 57 | 4, 4, 4, 3 |
| Boundary duty and approved leave | 13 / 13 | 43 / 43 | 3, 4, 3, 3 |
| Same, reversed slot order | 13 / 13 | 43 / 43 | 3, 4, 3, 3 |

All three optimizer results reported optimal with zero validator-guided cuts. Recorded optimizer times were 15.96, 9.93 and 7.72 seconds, respectively; the suite time includes setup, oracle enumeration, canonical validation and existing regressions. These uncontrolled single-run timings are not a speed improvement or resource benchmark. The remaining 15 or 17 required duties are honestly uncovered: the independent oracle proves that the fixture cannot safely cover more. A full rota must not be fabricated by bypassing the three-person OT requirement or duty/rest rules.

Limits: this is a deliberately small four-person whole-month fixture, not a representative departmental month, a GPU benchmark, or an architecture comparison. The independent oracle proves the stated daily OT/rest/leave-union and common-call-level equality arithmetic, not arbitrary duty/leave interval policy, partial leave, dated promotions, skill matching, reserve modes, locks, published-month authority or all lower objective tiers. Those require their separate tests and remaining acceptance work. An independently optimal coverage/equality pair does not imply that every optimizer tier was proved. N35 and the N26/N27 architecture work remain open; no N06/P9 acceptance targets are inferred from the result.
