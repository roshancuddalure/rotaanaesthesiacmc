# N35: dated specialist matching across the complete month

The real whole-month optimizer is checked against independent injective identity matching, not aggregate qualified headcounts. Four synthetic third-call members have 30 daily 24-hour duties, 24-hour subsequent rest, and three simultaneous 08:00–16:00 OT roles: cardiac, neuro and general. Each role needs one different identity.

The fixture declares cardiac membership for member 0, neuro membership for members 0 and 1, and new cardiac membership for member 2 beginning November 16. One case retains member 0's cardiac membership; another ends it on November 15. The expiry case is repeated with reversed duty-slot order. Configuration uses explicit reviewed skill-to-group bindings and dated memberships; skill labels do not grant authority by themselves.

Before November 16, removing member 1 for duty leaves three people and an eligible person for every role separately, but the only cardiac and neuro candidate is then the same member 0. Injective matching correctly rejects that apparently sufficient headcount. Qualification gain/loss changes which simultaneous identities can be reserved and therefore who can take duties on the affected dates.

The finite-state oracle retains previous-duty identity and the complete four-person monthly count vector. For each day, it explicitly enumerates permutations of remaining people into the fixture's three declared role lists. It does not call canonical role eligibility, windows, matching graphs or objective helpers. The oracle then computes maximum coverage and minimum squared monthly load at that coverage. December 1 is explicitly included with no new duty, checking that November 30 duty/rest does not consume the only qualified successor. The earlier cardinality-only month cases now use the same explicit next-month check.

Canonical dated eligibility is separately checked on November 15 and 16. Every complete returned plan passes the existing final validator and an independent per-day reconstruction of rest blocks and distinct specialist matching. No proposed assignments are saved. Equality follows the existing common-call-level target policy; no new fairness precedence is introduced.

Initial gate `n35-skilled-month-ot.xml` passed three tests in 70.16 seconds, native session 15562 exit zero. Each case matched 15 covered duties and the independently minimal squared load of 57, with member counts forming 4/4/4/3. Source hashes were independently rechecked unchanged before the combined regression began. Initial tests overlap the final gate; totals must not be added.

The combined gate is `n35-skilled-month-ot-final.xml` with `n35-skilled-month-final-source.json`. Its terminal outcome is recorded in the tracker before it is cited as passing evidence. The scope includes the new specialist cases, earlier full-month/date/leave cases and existing joint, assignment, availability and qualification regressions.

Final native session 38022 exited zero: **75 passed in 157.90 seconds**, with no failures, errors or skips. All 178 captured source hashes were independently rechecked unchanged. Scoped Ruff and whitespace checks passed. The three new specialist cases overlap the initial gate; the total also includes the preceding 72 cases.

| Scenario | Oracle / actual coverage | Oracle / actual squared load | Actual member duties |
|---|---:|---:|---|
| Cardiac qualification gained | 15 / 15 | 57 / 57 | 4, 3, 4, 4 |
| Original qualification expires; successor begins | 15 / 15 | 57 / 57 | 4, 4, 3, 4 |
| Same expiry/successor, reversed slot order | 15 / 15 | 57 / 57 | 4, 4, 3, 4 |

All three optimizer results reported optimal with zero validator-guided cuts. Their recorded optimizer times were 9.31, 6.40 and 6.18 seconds; these uncontrolled single runs do not establish a performance improvement or hardware requirement. The remaining 15 duties are still required and honestly uncovered. For this fixture, the independent oracle proves that extra coverage would violate the stated duty/rest/OT staffing constraints.

These are deliberately bounded synthetic proofs of the existing person-allocation path. They do not establish departmental acceptance, all interval/skill/reserve combinations, unit-choice architecture quality, actual GPU gain, minimum hardware or production readiness. N35 remains In progress; N26/N27 and the other 50-item requirements retain their full scope. Uncovered requirements stay visible rather than being filled by double-using a qualified person.
