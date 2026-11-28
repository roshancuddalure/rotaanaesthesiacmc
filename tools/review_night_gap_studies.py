"""Reconcile scoped night-gap evidence; do not certify a diagnostic as a rota."""
from datetime import datetime, timezone
import hashlib
import json

from run_fairness_revision13_checks import ROOT, OUT, hashes


def read(name):
    return json.loads((OUT / name).read_text(encoding='utf-8-sig'))


def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def main():
    now = datetime.now(timezone.utc).isoformat()
    folder = 'production-nov2026-20261123/'
    prefix = folder + 'fairness-modes-engine17-night-gap-two-relaxation'
    names = [prefix + suffix + '.json' for suffix in (
        '-exact-flow', '-exact-flow-flexible-counts', '-exact-flow-flexible-counts-count-cost-verified')]
    reports = [read(name) for name in names]
    assert len({r['input_assignments_sha256'] for r in reports}) == 1
    assert len({r['scheduling_context_sha256'] for r in reports}) == 1
    for report in reports:
        assert report['status'] == 'simulation_complete' and report['database_enforced_readonly']
        assert report['operational_writes'] == report['orm_dirty_rows'] == report['orm_new_rows'] == 0
        assert report['coverage_after'] == dict(slots=840, filled_slots=840, unassigned_slots=0)
        assert report['independent_final_safety']['ok']
        assert report['all_holder_revalidation']['checked'] == 840
        assert not report['all_holder_revalidation']['failures']
    assert reports[-1]['finalization_phase'] == 'completed'
    failed = read(prefix + '-exact-flow-flexible-counts-count-cost.json')
    assert failed['status'] == 'failed' and failed['error_class'] == 'OperationalError'
    fixed, flexible, cost = [r['night_gap_relaxation_study'] for r in reports]
    assert fixed['status'] == 'infeasible_in_relaxed_model' and fixed['all_minima_exhausted']
    assert flexible['night_gap'] == flexible['total_gap'] == 2
    assert cost['count_cost_proven'] and cost['minimum_squared_counts'] == 2777
    assert cost['original_squared_counts'] == 2785 and cost['can_preserve_count_cost']
    assert not cost['clinical_feasibility_proved']
    assert hashes() == read('fairness-modes-revision17-holistic-complete-audit-status.json')['source_sha256']
    for file in ('study_night_gap_relaxation.py', 'study_night_count_cost.py'):
        source = ROOT / 'tools' / file
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        archive = OUT / (source.stem + '-' + digest + '-source.py.txt')
        if archive.exists():
            assert archive.read_bytes() == source.read_bytes()
        else:
            archive.write_bytes(source.read_bytes())
    text = f'''NOVEMBER 2026: THIRD-CALL NIGHT GAP - ROOT CAUSE AND NEXT SAFE STEP
Reviewed UTC: {now}

The verified revision17 server-plan projection covers all840duties. Total-duty
gaps by call level are1/2/2/1/1. Third-call doctors still have night counts3-6.
This report identifies a missed search direction; it does not supply a new rota.

1. Keeping each doctor's current duty count cannot reduce the third-call night
gap to2 within the declared current duty rows, eligibility and protected/extra
holders. Exact flow checked every possible night band:58people,401duties,
10033eligible edges,9fixed rows; no complete matching. This is a restricted-family
proof, not global impossibility for the whole rota.

2. Allowing totals to change within6-8 permits nights3-5 at the structural level.
Posting, call/group, unit and active-leave checks and protected holders remain.
Rest, overlaps, staffing/OT, weekends, hours and other quotas are omitted here.
Therefore this diagnostic matching is NOT a clinically safe proposal.

3. Exact minimum-cost flow shows that this direction can improve count equality:
five doctors on6duties and53on7, with nights3-5. Squared total-count cost improves
2785to2777, the arithmetic minimum for401duties among58people. At fixed covered
demand and uniform targets, squared-deviation cost differs only by a constant.
All possible night bands were considered. Clinical feasibility remains unproved.

The present night pass preserves individual counts, so cannot reach this profile.
Next: minimize unnecessary changes in the structural witness, then test a bounded
multi-row refinement through atomic placement and independent clinical checks.
Keep higher objectives, protected/extra rows and approved rules. Reject unsafe
witnesses; never Apply the diagnostic directly or claim a global optimum.

VERIFICATION AND LIMITS
All three successful diagnostics have identical assignment AND scheduling-context
hashes, database-enforced read-only transactions, zero operational writes and zero
dirty/new ORM rows. Baseline server-plan coverage remains840/840; all840holders
pass placement/individual-limit replay and all eight clinical checks have zero
violations. Those clinical checks refer to the BASELINE SERVER PLAN, not the
diagnostic matching. Staffing retains5review warnings and OT guarding is disabled.
The390timing repairs remain hypothetical; production has not been changed.

The first minimum-cost replay lost its DB connection during final cleanup after
a long environment interruption. Its failed receipt is retained and EXCLUDED.
It is not a runtime benchmark. The fresh verified replay completed rollback and
reproduced the result. The probe now exits nonzero on failure, and the wrapper
independently checks the receipt. The real CLI failure-contract test passed.
Ten matching/minimum-cost tests passed, including independent exhaustive oracles,
input-order invariance, protected holders, invalid input and timeout inference.
New diagnostic modules pass Ruff; the existing probe's unrelated old E702 remains.
The initial CP-SAT attempt timed out UNKNOWN; that receipt is also retained.

Application/test hashes still match2456distinct passing backend cases. Prior
156frontend unit passes and main/candidate32actualUIchecks each remain evidence
for unchanged product code. No application/frontend/release-owned code changed
in this diagnostic batch. A separate architecture-harness objective mismatch was
corrected; three current13-tier comparisons and six focused checks passed.

Overall goal remains incomplete. Original50-item programme remains21Done.
'''
    (ROOT / 'Review/November2026_night_gap_root_cause_current.txt').write_text(text, encoding='utf-8')
    assessment = dict(recorded_at=now, status='structural-opportunity-verified-clinical-prototype-pending',
        input_assignments_sha256=reports[0]['input_assignments_sha256'],
        scheduling_context_sha256=reports[0]['scheduling_context_sha256'],
        fixed_counts_gap2_infeasible=True, variable_counts_gap2_necessary_condition_feasible=True,
        minimum_count_cost=2777, current_count_cost=2785, diagnostic_witness_clinically_verified=False,
        baseline_server_plan_840_checks_clear=True, application_source_matches_full_audit=True,
        source_reports=['docs/allocation-progress/' + name for name in names],
        excluded_failed_receipt=prefix + '-exact-flow-flexible-counts-count-cost.json',
        production_writes=0, overall_goal_complete=False,
        next_action='Minimum-change structural witness, bounded clinical-guided cuts, atomic Planner.transfer and full840checks; no engine promotion before verified safe benefit.')
    save('fairness-modes-revision17-night-gap-root-cause-assessment.json', assessment)
    addition = '''
NEW26NOV FINDING: count-preserving swaps cannot attain a third-call night gap2
within the declared eligible/protected family (exact flow proof). Varying totals
inside6-8 permits a structural6-7total/3-5night matching with better count cost
2777vs2785. Clinical interactions are omitted: NOT a safe proposal. Next bounded
multi-row clinical refinement. Review/November2026_night_gap_root_cause_current.txt
'''
    report_path = ROOT / 'Review/Allocation_engine_fairness_audit_current.txt'
    report = report_path.read_text(encoding='utf-8')
    if 'NEW26NOV FINDING' not in report:
        report = report.replace('\nLIMITATIONS AND PRODUCTION REVIEW', addition + '\nLIMITATIONS AND PRODUCTION REVIEW')
    report_path.write_text(report, encoding='utf-8')
    (OUT / 'fairness-modes-report.txt').write_text(report, encoding='utf-8')
    matrix = read('fairness-modes-revision17-requirement-audit.json')
    for item in matrix['requirements']:
        if item['requirement'] == 'Fair weekends,night/24h,hours,extra burden':
            source = 'docs/allocation-progress/fairness-modes-revision17-night-gap-root-cause-assessment.json'
            if source not in item['evidence_sources']:
                item['evidence_sources'].append(source)
                item['limits'] += ' Fixed-count nightgap2 infeasible; variable6-8totals admit a lower-cost structural6-7/3-5matching, NOT clinically verified. Next bounded multi-row clinical refinement.'
    matrix['recorded_at'] = now
    save('fairness-modes-revision17-requirement-audit.json', matrix)
    lines = ['CURRENT ALLOCATION REQUIREMENT AUDIT - REVISION17', 'Reviewed UTC: ' + now, '']
    for number, item in enumerate(matrix['requirements'], 1):
        lines.extend([str(number) + '. ' + item['requirement'], item['assessment'], 'Limits: ' + item['limits'],
                      'Evidence: ' + ', '.join(item['evidence_sources']), ''])
    (ROOT / 'Review/Allocation_engine_requirement_audit_current.txt').write_text('\n'.join(lines), encoding='utf-8')
    message = ('PROGRESS VERIFIED: exact-count thirdnightgap2 impossible in declared structural/protected family; '
        'variable6-8totals allow structural6-7totals/3-5nights at proven countcost2777vs2785. '
        'Fresh minimum-cost retry simulation_complete/finalization completed; same input+context as other2successful studies; '
        'all840BASEserverplan clinical/quota checks clear/coverage840; diagnostic witness NOT clinically verified. '
        'Original mincost receipt failed OperationalError during cleanup after long environment interruption; preserved/excluded, '
        'not a runtime benchmark. Fixed false-zero CLI exit; actualfailure contract1PASS53.82s. '
        'Ten purematching/cost testsPASS2.86s+newmoduleRuffPASS; app/tests hashes reverified match2456full audit/156frontend unchanged. '
        'N26 harness corrected13tiers/6focusedPASS/3comparisonruns verified. Root-causeReviewTXT/JSON/currentreports/matrix updated; '
        'source archives bySHA. No app/frontend/releaseowned changes or productionwrites/deploy; 50scope21Done/390timingproposal/'
        'OTdisabled/5equal-11availability staffingreviews remain. All batch/study/test workers terminal, including69589 and73098; '
        'no implementationworker remains. NEXT: ' + assessment['next_action'] + ' Goalactive/NOTcomplete.')
    state = read('state.json')
    state.update(updated_at=now, phase='Structural night-gap opportunity verified; clinical prototype next', current=message,
        active_execution=dict(status='finished', workers_running=False, last_session=69589, last_exit_code=0,
                              next_action=assessment['next_action']))
    state['tests'].append(dict(title='Night matching/cost diagnostics and failed-exit contract',
        result='10 matching/cost tests passed2.86s; real CLI failure-contract1passed53.82s. Successful read-only retry finalized; diagnostic is not a safe rota.',
        evidence='docs/allocation-progress/fairness-modes-revision17-night-gap-root-cause-assessment.json'))
    save('state.json', state)
    live = read('fairness-modes-live.json')
    live.update(updated_at=now, phase=state['phase'])
    live['events'].append(now + ' ' + message)
    save('fairness-modes-live.json', live)
    audit = read('fairness-modes-completion-audit.json')
    audit.update(updated_at=now, current_checkpoint=message, night_gap_root_cause=assessment)
    save('fairness-modes-completion-audit.json', audit)
    for path in (ROOT / 'Plan/to do/November26_allocation_action_tracker.md', OUT / 'fairness-modes-execution.log'):
        with path.open('ab') as handle:
            handle.write(('\n\n' + now + ' ' + message + '\n').encode('ascii'))
    print(message)


if __name__ == '__main__':
    main()
