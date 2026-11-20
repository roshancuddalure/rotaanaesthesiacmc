# N05 measurable allocation objectives and denominators

Status: In progress, reviewed 20 November 2026. This specification distinguishes existing approved policy, observed implementation and gaps. It does not ratify new priorities or production acceptance thresholds. N02 baseline correction evidence is unavailable; N06 ratification remains separate. The completed n05-objective-oracles.json is historical evidence at its recorded source revision; fresh precedence evidence is in n05-precedence.xml.

## Authority and precedence

The later call_level_pool_and_balance_contract.md amends the older limits_callevel_fairness_contract.md: deliberate multilevel pools are valid; members must belong to the explicitly allowed set; partial availability receives personal pro-rata consideration in Balance duties. The exact scheduling context contains dated eligibility/posting/call/group, approved leave, current rules, existing commitments, locked unit scope and mandatory OT/reserves. It is authoritative. No preference, model explanation, GPU score or numerical objective can grant an eligibility/rest/leave/OT/protected-period exception. Existing superadmin/extra-duty exceptions retain their separately attributed authority.

## Current lexicographic objective vector

Promotion correction, 20 November 2026: optimizer equality now takes each person's monthly level from the same canonical monthly membership used by fairness reporting (first posted day, with the existing unposted-assignment tier). Dated candidate eligibility still follows the actual duty date. Previously the last iterated candidate row selected that person's equality target, so reversing slots changed the same allocation's cost. The reproduced values were 0 versus 300; both are now 300 in the regression fixture. This corrects iteration-dependent target selection; it does not introduce a personal pro-rata objective or reorder tiers. See n05-promotion-and-burdens.md.

Minimize, in order: (-mandatory duties covered, -all duties covered, changed selected originals in repair mode, explicit preference cost only in preferences mode, call-level squared-load deviation, weekend burden, night burden, configured holiday burden, opportunity-normalized workload, spacing/history score, preference cost when not already prioritized). Each later tier can be optimized only without worsening established higher tiers. A time-limited feasible incumbent is usable only after independent final validation; unproven tiers must remain visibly unproven. A reported optimum is restricted to modeled candidate choices/rules, not every conceivable rota.

Coverage denominators are original required template identities, including locked empty slots as unresolved. One assignment cannot cover two required slots. Manual/official preserved commitments remain load and constraints; unchanged commitments are not falsely counted as newly generated duties. Repair may replace only selected unlocked originals, preserves every unselected slot including empty, and cannot cancel an original when no safe replacement exists. The repair change tier measures changed original person identities, not score deltas or cancelled-without-replacement rows.

Current optimizer equality is sum_i(total_month_duties_i - call_level_target_i)^2 up to a constant, represented by rounded integer marginal increments100*(2*(baseline_i+n)-1-2*target_i). Baseline includes preserved month duties. Pool demand is split among its allowed call levels proportionally to available monthly member counts; candidate eligibility still accepts any compatible person in that pool once. No-level duty is unresolved, not universally eligible. The current target_by_level helper provides a uniform target within a level, not an individual pro-rata share.

Current Balance duties uses saved active assignment demand (not hypothetical unfilled template demand), split across pools, and personal share_i = saved_demand(level)*available_days_i/sum available_days. Available days come from dated included-unit posting and existing active leave semantics; that stage currently includes pending requests in availability reduction. It is not identical to official OT approved-only blocking, and this distinction must remain explicit. Goals use Python nearest integer rounding (ties to even); the allowed-gap rule remains the existing contract. A one-size denominator for optimizer, Balance and OT would change policy and is not silently introduced.

Weekend/night/holiday/workload costs normalize compatible candidate opportunities in the current optimizer. NIGHT cost includes24hour duties,18:00-or-later starts, or overnight ends. Holiday balancing is unavailable without configured holiday dates; zero holiday cost with no calendar does not prove equitable holiday allocation. Opportunity counts are not available calendar days, and neither is a personal entitlement. Historical spacing scores must not invent absent history. Fixed duties contribute existing category load.

More precisely, each category uses the same person's total modeled compatible-slot count as its denominator, not a separate count of that category's opportunities. For category baseline b and n new assignments, its incremental integer cost is the sum, for k=1..n, of max(1, round(100*(2*(b+k)-1)/max(1,total_compatible_slots))). This includes rounding and the minimum marginal cost; it is not exactly the unrounded squared-load expression. The final spacing/history tier also contains the existing candidate burden component and pairwise spacing cost; its name alone does not describe all its inputs.

## Worked examples and expected interpretation

| Example | Arithmetic and invariant |
|---|---|
|8duties/4full-capacity members|2each when compatible;0uncovered;no forced extra duty solely to increase a fractional target|
|2fixed duties on one member,6unfilled|Target applies to total8duties; fixed member may need0new while others receive2each|
|One fully unavailable,8duties|That member receives0; eligible3members get integer2/3loads if feasible; no leave/rest exception to equalize|
|8duties, available days31/31/31/8|Personal shares248/101,248/101,248/101,64/101; pro-rata squared deviation favors a partial member around1, while uniform target2mayfavor2. Exact feasible oracle must determine the gap, not a broad perfection claim|
|8duties, days31/31/31/15|Shares62/27,62/27,62/27,10/9; independent rounded goals2/2/2/1sum7. Coverage remains8, so rounded goals are targets with allowed deviations, not constraints to delete a duty|
|Pool30members at3rdcall,10at4thcall|One poolslot contributes0.75/0.25level demand; never count that one slot twice, and no unapproved substitution outside pool|
|Pool with0members|Even demand-report split does not create candidates or prove capacity; shortage remains explicit|
|OTbusyThursday|Reduce compatible duty opportunities only where actual required people/time/skills/rest compete; compensate later only within all hard constraints|
|Preferences mode|Explicitly authorized preference tier can precede equality, but never coverage/safety; balanced/repair mode keeps normal order|
|No safe repair replacement|Original remains; uncovered/infeasible/unknown outcome is visible; no silent duty deletion|

## Gap to resolve before dependent tuning

Uniform call-level optimizer targets and personal pro-rata Balance targets are currently different objectives with different demand/leave denominators. The approved plan requires preserving existing partial-availability policy while making trade-offs measurable. Exhaustive four-person examples quantify this gap in n05-objective-oracles.json; any subsequent correction must reuse canonical opportunity accounting and update displayed evidence, not silently replace goals with GPU scores or a new second generator. Dated promotions/pool transitions, fixed duties and zero capacity require explicit denominator handling. Do not label current uniform optimization as completed pro-rata optimization merely because later burden scoring normalizes opportunities.

## Evidence and exit criteria

Inspect current independent8duty count enumeration against actual solve_month/finalvalidator, actual Balance shares after saving only inside disposable fixture, fixed/fullleave/pool/rounding examples and existing repair/preferences/coverage regression. Store exact source hashes and fixture rules. N05 cannot be markedDone while implementation/spec contradictions or dependent baseline gaps are unexplained. N06 separately records quantitative improvement thresholds/sign-off, actual human correction evidence remains null unless sourced, and N50 departmental pilots remain required. This document authorizes no new domain policy, automatic apply, operational migration, deployment, model download or cloud route.


## Verified current examples and review disclosure

### Current-contract reconciliation, 20 November 2026

P6's recorded default is to preserve the current contract. No answer to the optional personal pro-rata priority amendment is required to document or test that default. The earlier statement that a separate P6 choice was required applies only to changing priorities, not to continuing existing-policy work. Both the optimizer's uniform target and Balance's personal pro-rata consideration remain explicitly distinguished. N06 must compare the declared existing basis unless a separately approved amendment changes it; it must not treat silence as approval.

Fresh test_allocation_objective_precedence.py uses actual candidate loading, solve_month and independent final validation on disposable SQLite fixtures. Five checks force competing outcomes: balanced equality versus a strong preference, explicit preference priority, safe-original repair stability versus both equality and preferences, coverage versus universally unfavorable preferences, and approved leave versus a favored identity. All five passed in 64.06s (n05-precedence.xml); no operational assignments were written. The repair fixture stores only its two synthetic originals and verifies they remain unchanged. These bounded two-duty cases do not prove every burden trade-off, a global month optimum, or human correction improvement.

N05 remains In progress: its N02 prerequisite is not closed and final acceptance reconciliation remains. Dated call-level transitions, category-specific burdens and opportunity-normalized workload now have bounded actual outcome examples in n05-promotion-and-burdens.md and n05-workload-pools.md. Engine-revision invalidation is verified in n05-engine-revision.md. The missing administrator-correction baseline affects empirical improvement and N06/N50, not the arithmetic definition of a target. Do not represent the optional P6 amendment as the sole blocker or select new policy to close the task. See n05-current-contract-checkpoint.md for the reconciled acceptance map.

n05-objective-oracles.jsoncomplete=true/native24779exit0:equal/fixedcurrentcounts2each,fullunavailable0/3/3/2,partial8daycurrent2eachversuspro-rataoptimalpartial1/others2,2,3;all8/8duties/finalvalidatorclear. Partialcurrent2iswithinexistingallowedgapfromgoal1,sonosafetyviolationisclaimed. AseparateP6prioritychoiceisrequiredandwasaskedasync;noanswerinferred. Actualnewproposalmetadata+generatorReview+selectedExcelnowidentifythecurrentuniformtargetbasis/fixedload;oldmetadataabsenceisexplicit. Backend28+final4/frontend143/build/responsivebrowsergatespass;countsoverlap. See n05-objective-results.md. Objectivepriorities/weights/approvalrulesarenotchanged. N05notDonependingbaseline/policyreconciliation;N06proposalisunratified.
