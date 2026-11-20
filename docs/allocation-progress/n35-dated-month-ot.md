# N35: dated call pools, unit postings and partial leave across a month

The real optimizer is exercised against an independent finite-state oracle for all 30 November dates. The existing four-person fixture has a daily 24-hour third-call duty, 24 hours of subsequent rest, and three-person third-call OT demand. This gate splits OT into independently staffed 08:00–12:00 and 12:00–16:00 bands.

Three cases introduce explicit dated changes:

1. One member changes from third to fourth call on November 16. No substitution into the third-call duty or OT pool is allowed.
2. The same promotion plus another member's approved AM leave on November 10.
3. Instead of promotion, the member's original-unit posting ends November 15 and a different-unit posting begins November 16, plus the AM leave.

The oracle receives fixture-declared per-day duty and OT identity sets; it does not derive them from the application's posting or promotion helpers. It enumerates previous duty holders and complete monthly count vectors. It checks distinct available identities, maximum coverage, and minimum squared monthly load at maximum coverage. Since both OT bands have the same pool and minimum, the morning leave-affected band is the binding capacity condition; the afternoon cannot make that condition weaker. A separate assertion verifies that canonical availability does preserve the leave member's afternoon eligibility. Existing duty policy still treats AM leave as blocking a 24-hour duty on its stored date.

Canonical window assertions verify the affected member can cover the November 15 morning OT band and cannot cover November 16. Complete returned plans pass the canonical final validator and an independent day-by-day pool/leave/rest reconstruction. Monthly targets continue to use the existing first-posted-day membership policy; the experiment does not amend fairness priorities or infer new substitution authority. No proposed assignments are saved.

The initial two promotion cases passed in 53.38 seconds (`n35-dated-month-ot.xml`): each matched eight covered duties, squared load 16 and two duties per member. The expanded gate includes the posting variant, the preceding three whole-month cases, and existing joint reservation, ordinary assignment, availability and qualification tests. Source windows are retained separately for each gate.

The first expanded gate (`n35-dated-month-ot-final.xml`) recorded **71 passed and one fixture failure in 178.34 seconds**. The newly active destination unit had no reviewed OT calendar. The application correctly returned an unresolved shared context; the test's expectation of a reviewed context was wrong. The fixture was corrected to give the destination an explicitly reviewed zero-demand weekly calendar, preserving the distinction between unknown demand and zero demand. No application guard or policy was weakened. The corrected full rerun is recorded separately in `n35-dated-month-ot-corrected.xml`; consult its terminal outcome and tracker before citing it as passing evidence.

Corrected native session 77302 exited zero: **72 passed in 139.35 seconds**, no failures/errors/skips. All 174 source-window hashes were independently rechecked unchanged. Scoped Ruff and whitespace checks passed. These 72 cases include the three new dated month cases, three prior month cases and existing OT regressions; earlier gate totals overlap and must not be added.

| Dated case | Oracle / actual coverage | Oracle / actual squared load | Actual member duties |
|---|---:|---:|---|
| Promotion | 8 / 8 | 16 / 16 | 2, 2, 2, 2 |
| Promotion and AM leave | 8 / 8 | 16 / 16 | 2, 2, 2, 2 |
| Unit transfer and AM leave | 8 / 8 | 16 / 16 | 2, 2, 2, 2 |

All three results reported optimal with zero validator-guided cuts. Individual optimizer times were 3.79, 3.28 and 3.56 seconds in this run; uncontrolled timing differences from preceding runs do not establish a speed improvement. The 22 uncovered duties in each fixture are retained explicitly. After the dated change, all three remaining compatible people are needed for OT; filling a duty by reusing an expired posting or old call level would manufacture coverage.

This is targeted synthetic verification of the current person-allocation path. It does not choose the N26 architecture, implement N27's new unit-choice path, independently prove all partial-leave interval rules, or establish departmental release targets. The oracle uses the declared legacy duty-date leave policy; whole-band OT interval eligibility remains separate. Broader skills/reserve-mode interactions, representative months, real GPU benefit and operational acceptance remain required by their tracker items. N35 remains In progress.
