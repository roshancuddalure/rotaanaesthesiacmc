"""Record verified receipts and the unresolved goal, without claiming completion."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/allocation-progress'
EVIDENCE = OUT / 'production-nov2026-20261123'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def log(name):
    data = (OUT / name).read_bytes()
    return data.decode('utf-16' if data.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig')


def main():
    now = datetime.now(timezone.utc)
    deadline = datetime.fromisoformat('2026-11-23T16:16:32+00:00')
    assert now < deadline, 'Do not silently extend the authorized timebox'
    receipts = [
        'equality-hour-membership.xml', 'equality-hour-core-final.xml', 'equality-hour-safety-final.xml',
        'equality-hour-refinements-verified.xml', 'equality-hour-final-guards.xml',
        'equality-hour-final-policy-performance.xml', 'equality-hour-ledger-boundary-final.xml',
        'equality-hour-final-coverage-proof.xml', 'equality-hour-capacity-contract-final.xml',
    ]
    cases, batches = {}, []
    for name in receipts:
        counts = Counter()
        for case in ET.parse(OUT / name).getroot().iter('testcase'):
            outcome = ('failed' if case.find('failure') is not None or case.find('error') is not None
                       else 'skipped' if case.find('skipped') is not None else 'passed')
            counts[outcome] += 1
            cases[case.attrib['classname'], case.attrib['name']] = (outcome, name)
        batches.append(dict(file=name, **counts))
    counts = Counter(row[0] for row in cases.values())
    unresolved = [{'case': '.'.join(key), 'receipt': value[1]} for key, value in cases.items()
                  if value[0] != 'passed']
    assert len(unresolved) == 1 and unresolved[0]['case'].endswith('test_full_month_plans_quickly'), unresolved
    production = read(EVIDENCE / 'equality-hour-final-reviewed.json')
    assert production['status'] == 'simulation_complete'
    assert production['database_enforced_readonly'] and production['operational_writes'] == 0
    assert production['rows_after'] == 840 and production['changed_rows'] == 9
    assert production['independent_final_safety']['ok'] and not production['final_changed_holder_failures']
    assert production['orm_dirty_rows'] == production['orm_new_rows'] == 0
    for path, digest in production['service_source_sha256'].items():
        assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == digest, path
    release = read(EVIDENCE / 'scoped-release-r8-manifest.json')
    for path, digest in release['paths'].items():
        assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == digest, path
    cohort = read(EVIDENCE / 'equality-hour-fourth-call-verified.json')
    assert cohort['status'] == 'complete' and cohort['operational_writes'] == 0
    assert all(r['status'] == 'unknown' and r['reason'] == 'required_coverage_not_established'
               for r in cohort['optimizer']['gap_feasibility'])
    assert cohort['changed_rows'] == 0
    assert 'all 143 checks passed' in log('equality-hour-balance-browser.log')
    assert 'all 143 checks passed' in log('equality-hour-isolated-balance-browser.log')
    review_ui = read(OUT / 'equality-hour-review-browser.json')
    assert review_ui['checks'] == 40 and review_ui['writes'] == 0
    assert '"checks":40' in log('equality-hour-isolated-review-browser.log')
    assert 'pass 154' in log('equality-hour-frontend-final-tests.log')
    for file in ('equality-hour-frontend-verified-v2-build.log', 'equality-hour-isolated-build.log'):
        assert 'built in' in log(file)
    assert 'All checks passed!' in log('equality-hour-final-style.log')
    bounds = production['raw_adjusted_compatibility']
    fourth = next(row for row in bounds if row['call_level'] == '4TH_CALL')
    assert fourth['raw_gap_lower_bound_at_saved_adjusted_gap'] == 6
    assert fourth['raw_gap_lower_bound_at_adjusted_gap_two'] == 5
    elapsed = (now-datetime.fromisoformat('2026-11-23T15:16:32+00:00')).total_seconds()
    summary = dict(recorded_at=now.isoformat(), started_at='2026-11-23T15:16:32+00:00',
        deadline=deadline.isoformat(), elapsed_seconds=round(elapsed, 2),
        status='local_refinement_verified_with_unresolved_goal', full_goal_achieved=False,
        backend_distinct=counts, backend_batches=batches, unresolved_tests=unresolved,
        ui_distinct_passed=337, isolated_ui_repeats=183,
        production_writes=0, production_deployed=False,
        production_review_workbook=production['local_proposal_review_workbook'],
        fourth_call_target_span=fourth['exact_personal_target_span'],
        fourth_call_raw_minimum_saved_policy=6, fourth_call_raw_minimum_adjusted_tolerance_two=5,
        whole_month_november_study='183 ordinary fourth-call repairs; required coverage not established; no proposed changes accepted.',
        policy_question='Retain availability-adjusted fairness/comparable cohorts, or explicitly amend pro-rata targets to prioritize raw equality?',
        release_manifest='docs/allocation-progress/production-nov2026-20261123/scoped-release-r8-manifest.json',
        source_hashes=release['paths'], full50_done=21, full50_total=50)
    table = []
    for row, bound in zip(production['after'], bounds):
        full = next(r for r in production['availability_cohorts'] if r['call_level'] == row['call_level'])
        # The cohorts in this field precede the safe nine-change repair; the
        # comparable cohort gaps in the verified final snapshot are below.
        assert full['call_level'] == row['call_level']
        table.append(f"{row['call_level']:10} {row['members']:3}    {row['minimum']:2}-{row['maximum']:<2}       "
                     f"{row['maximum']-row['minimum']:2}          {row['deviation_spread']:7.4f}          "
                     f"{bound['raw_gap_lower_bound_at_saved_adjusted_gap']}")
    text = f'''DUTY ROTA - FOCUSED EQUALITY AUDIT / REVISION8
23 November2026. Local verification checkpoint: {now.isoformat()}
Fixed session:20:46:32-21:46:32IST. Recorded within the authorized hour.

OUTCOME
Local refinements and simulations are verified, but the full requested goal is
NOT achieved. Raw equality within two for everyone conflicts with the existing
availability-based fairness policy in November's fourth-call group. A domain
policy clarification is pending. No production deployment or live rota change.

THE CENTRAL FINDING
Fourth-call personal targets span {fourth['exact_personal_target_span']:.6f} duties.
For every pair, target difference = duty-count difference - target-deviation
difference. Therefore target span <= raw count gap + adjusted deviation gap.
With saved adjusted tolerance1, raw gap must be at least ceil(6.203239-1)=6.
Even at adjusted tolerance2, raw gap must be at least5. The reviewed safe plan's
fourth-call raw gap6 attains that necessary bound at the current fixed targets.
Forcing raw gap2 would change this pro-rata policy. This is a mathematical
target-compatibility result, not a claim that every clinical constraint was
globally optimized. The separate optimistic capacity audit did NOT rule out
raw gap1/2 because it relaxed these personal-target obligations.

WHAT CHANGED
1. Strict dated included-unit membership remains mandatory for ordinary AND
   extra duties. Historical ineligible holders can now be safely replaced in
   reviewed Balance, with deterministic preview hashes, locked re-planning,
   atomic application and ledger-aware transfers. Unsafe/protected unresolved
   repairs block. No posting is invented.
2. Whole-month modes prioritize required/total coverage, worst call-level raw
   gap, total gaps and count targets; hours, extra, weekend, night, holiday and
   workload burdens precede preferences and repair change count. Fixed duties
   and zero-opportunity canonical members count. These whole-month objectives
   still use uniform count targets, not personal pro-rata targets; unifying
   that policy remains an explicit gate. Ordinary Balance retains pro-rata
   shares. Do not deploy this as a universal raw<=2/pro-rata certificate.
3. Gap1/2 probes use a separate model before soft-tier fixes, retain achieved
   coverage and independently validate positive witnesses. Timeouts are unknown.
   A real November study exposed a reporting error when required coverage had
   not been established; corrected receipts now say unknown, not infeasible.
4. Outliers record actual fixed counts, clear opportunities and initial rejected
   candidate restriction counts. Historical proposal descriptions stay historical.
5. Extra-duty repair stays in Balance: the intelligent ordinary repair path now
   refuses extra-duty rows rather than silently voiding their fairness credits.
   Unsafe undo cannot restore an ineligible holder; the review screen discloses it.

REAL NOVEMBER READ-ONLY REPLAY
135 eligible posted people. Seven ineligible historical holder assignments safely
repaired through the actual server Balance plan builder; nine total changes.
All840duties remain filled. All840pass eight independent checks with zero
violations; all nine changed-holder placement/quota checks are clear. The DB
enforced READ ONLY/repeatable read; ORM new/dirty rows0. No writes or apply token.

Call level Members Count range Raw gap Adjusted spread Necessary raw minimum
                                                     at saved adjusted gap1
{chr(10).join(table)}

Final fully available posted-cohort raw gaps:1/0/1/0/0. All comparable cohorts
are within one. Third-call adjusted spread1.5092 remains above saved tolerance1,
although below the requested maximum2. It has not been proved irreducible.

ACTUAL WHOLE-MONTH STUDY
The actual optimizer was also run read-only on183ordinary fourth-call repairs,
with other duties, units and extra-duty ledger rows fixed. It did not establish
required coverage; neither gap1 nor gap2 was proved feasible or infeasible.
The returned incomplete draft was NOT accepted and no rota changes were made.
The corrected coverage-proof receipt is independently regression-tested.

VERIFICATION
{counts['passed']}distinct backend cases passed across the recorded authoritative batches,
including40randomized exhaustive count/hour/extra/rest/quota comparisons and
20independent interval/rest capacity-oracle scenarios. Current coverage-proof
gate70passed; capacity/contract gate22passed; ledger boundary gate26passed.
154frontend unit checks +143Balance UI +40fairness-review UI =337distinct UI
checks passed. The same183browser checks passed against the isolated release;
these are repeats, not additional distinct cases. Light/dark at1280/390/320px,
no tested accessibility violations, escaped names and no review-time writes.
Main and isolated builds passed;176backend module ASTs match. Ruff passed.

ONE PERFORMANCE GATE REMAINS UNMET
The unchanged10-second standard extra preview limit failed at11.05seconds and
16.12seconds. Earlier untouched production-base also failed in the previous
session; timings vary and do not establish regression absence. No threshold
was weakened. Earlier failing policy assertions, test-fixture mistakes and the
initial TypeScript compatibility failure are retained; corrected focused runs
and final builds supersede them. JUnit record_property and build bundle warnings
remain. There is no all-green performance claim.

SAFETY / RELEASE LIMITS
No deployment, migration, inferred posting or live assignment write. The current
production OT guard is disabled, so the eight checks do not certify production
OT coverage or every unchanged monthly quota. Transfer checks preserve affected
staffing safety; this is not a full clinical staffing certificate. Protected
duties and deliberate configured mixed call pools remain protected.

NEXT CONCRETE ACTION
Resolve the raw-equality versus pro-rata policy question, then unify the
whole-month objective with that approved interpretation and establish complete
November feasibility through a reviewed current-context proposal. Resolve the
third-call saved-tolerance and preview-performance gates. Production deployment
and application require separate authority. Preserve the full50-item scope:
21/50Done, unchanged. The full goal is not marked complete.

REVIEW ARTIFACTS
{production['local_proposal_review_workbook']}
Review/November2026_optimistic_capacity_bounds_20261123.xlsx
Review/Allocation_engine_scope_r8_verified.patch
Debug/Allocation-release-r8
docs/allocation-progress/equality-hour-checkpoint.json
'''
    (OUT / 'equality-hour-report.txt').write_text(text, encoding='utf-8')
    (OUT / 'equality-hour-checkpoint.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    live = read(OUT / 'equality-hour-live.json')
    live['phase'] = 'Verification checkpoint: pro-rata policy requires4thrawgap>=6; fullgoalnotachieved. No allocation worker running.'
    live['tasks'][2]['status'] = 'Policy conflict'
    live['metrics'] = {'Backend passed': counts['passed'], 'UI checks passed':337,
                       'Safe review coverage':'840 / 840', 'Production writes':0}
    live['charts'][0]['value'] = f"{counts['passed']} passed"
    live['charts'][3]['value'] = 'Policy conflict'
    live['events'] += [f"VERIFIED:{counts['passed']}distinctbackend/337UI; main+isolatedbuilds/176modulesmatch. One10sperformancegateunmet.",
        'Mathematicalpolicybound:4thrawgap>=6withsavedadjustedtol1;>=5evenattol2. Actualraw6isnecessaryatfixedpro-ratatargets.',
        'Actual183-dutyrepairfailedtoestablishcoverage; correctedgapreceiptsunknown.Nochangesaccepted.Fullgoalnotcomplete;policyanswerpending.']
    (OUT / 'equality-hour-live.json').write_text(json.dumps(live, indent=2), encoding='utf-8')
    state = read(OUT / 'state.json')
    state.update(updated_at=now.isoformat(), work_state='checkpoint',
                 phase='Revision8 local checks verified; raw/pro-rata policy conflict and performance unresolved',
                 current=text, current_focus='Resolve raw versus availability-adjusted fairness; full goal incomplete.',
                 active_execution={})
    state['equality_hour'] = summary
    state['tests'].append(dict(title='Revision8 focused hour',
        result=f"{counts['passed']}distinctbackend/337UIpassed;oneperformancegatefailed;fullgoalnotachieved",
        evidence='docs/allocation-progress/equality-hour-checkpoint.json'))
    (OUT / 'state.json').write_text(json.dumps(state, indent=2), encoding='utf-8')
    handoff = (f"\n\n### Revision8 equality-hour verification checkpoint {now.isoformat()}\n\n"
        f"{counts['passed']}distinctbackend/337UIpassed;183isolatedUIrepeats;2builds/176backendASTmatch. "
        "Oneunchanged10sperformancegateunmet(11.05s/16.12s). Sevenmembershiprepairs/ninechanges/840filled/8checks0violations "
        "in DB-enforcedREADONLYserver-planreplay. Rawgaps2/4/4/6/2;fullyavailable1/0/1/0/0;thirdadjusted1.5092>saved1. "
        "NEWmathematicalfixed-targetbound:fourthtargetspan6.203239requiresrawgap>=6atsavedadjusted1,>=5atadjusted2. "
        "Raw2andoldpro-ratapolicyconflict;askedownerwhichinterpretation. Wholemonthuniformobjectiveversuspro-ratashares "
        "mustbeunifiedbeforeoperationalrelease. Actual183ordinaryfourth-callstudyrequiredcoveragenotestablished; "
        "correctedgapreceiptsunknown;nochangesaccepted. Ordinaryintelligentrepairnowrefusesextra-dutyrowstopreserveledger. "
        "Report:equality-hour-report.txt;manifest:equality-hour-checkpoint.json;patchr8/isolatedr8prepared,notdeployed. "
        "No productionwrites/migrations/postinginference. Full50scope21Doneunchanged;fullgoalNOTcomplete. "
        "Fixed16:16:32UTCcutoffunchanged;noautomaticextension. Nextresolvepolicyandcompletefeasibility/performancegates.\n")
    with (ROOT / 'Plan/to do/November26_allocation_action_tracker.md').open('ab') as stream:
        stream.write(handoff.encode('ascii'))
    continuation = OUT / 'continuation.md'
    continuation.write_bytes((f"# Latest revision8 equality-hour checkpoint {now.isoformat()}\n"+handoff+
        "\nNative light Tk window is a read-only viewer, not allocation activity. Revalidate handles from equality-hour-session-handles.json. "
        "Task Vite5195/5196 must be stopped before final handoff. Dashboard5201 remains dedicated/read-only. "
        "No implementation/allocation worker remains. Existing goal API is blocked; do not falsely mark it complete to replace it. "
        "A renewed time allowance is required for execution after the fixed cutoff. Older checkpoints follow.\n\n").encode('ascii')
        + continuation.read_bytes())
    print(json.dumps({'backend_distinct_passed':counts['passed'], 'unresolved_tests':unresolved,
                      'ui_distinct_passed':337,'full_goal_achieved':False,'within_timebox':True}))


if __name__ == '__main__':
    main()
