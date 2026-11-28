"""Record existing aggregate evidence locally; never connects to production."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/allocation-progress'
OUT = BASE / 'production-nov2026-20261123'


def main():
    snapshot = json.loads((OUT / 'baseline-readonly-v4.json').read_text())
    archived = OUT / 'audit-script-v4.py.txt'
    assert hashlib.sha256(archived.read_bytes()).hexdigest() == snapshot['audit_script_sha256']
    assert snapshot['database_enforced_readonly'] and snapshot['status'] == 'read_only_snapshot_complete'
    assert snapshot['active_assignment_rows'] == snapshot['filled_distinct_slots'] == 840
    check = snapshot['independent_safety_check']
    assert check['ok'] and len(check['checks']) == 8 and not check['violation_codes']
    now = datetime.now(timezone.utc).isoformat()
    lines = [
        'PRODUCTION NOVEMBER 2026 - FOCUSED ALLOCATION AUDIT',
        f"Snapshot: {snapshot['recorded_at']}",
        f"App: {snapshot['app_url']}",
        '',
        'FINDING: material residual unfairness in 1st and 2nd calls.',
        'All 840 saved template slots have one active assignment (840 rows).',
        'The period is draft. 579 template slots are ready; 261 need review.',
        'A needs_review flag alone does not establish a safety violation.',
        '',
        'Level | Members | All-member duties | Raw gap | Full-month available duties | Adjusted deviation spread',
    ]
    for row, adjusted in zip(snapshot['levels'], snapshot['availability_adjusted_balance']):
        assert row['call_level'] == adjusted['call_level']
        full = row['full_availability_cohort']
        lines.append(f"{row['call_level']} | {row['member_count']} | {row['min']}-{row['max']} | "
                     f"{row['gap']} | {full['minimum']}-{full['maximum']} ({full['members']} people) | "
                     f"{adjusted['deviation_spread']:.2f}")
    lines += [
        '',
        'Interpretation:',
        '- 1st and 2nd calls exceed the requested maximum gap of 2 even within the full-month availability cohort.',
        '- Saved fairness tolerance is 1. Their availability-adjusted deviation spreads are 4 and 6.',
        '- Availability alone does not explain this. Unit/group eligibility and dated opportunities can still constrain moves; infeasibility has NOT been proved.',
        '- 3rd calls have a full-availability gap of 1; adjusted spread 1.51 exceeds the saved tolerance of 1 but falls within the requested outer bound of 2.',
        '- 4th and 5th raw ranges reflect partial availability; the existing pro-rata balance assessment considers them balanced.',
        '- Preserve existing approved call pools. Fractional 3rd/4th target demand is pool apportionment, not evidence of unauthorized crossover.',
        '',
        'SAFETY CHECK - EXACT SCOPE',
        'Existing independent check_month evaluated 840 assignments and returned zero violations in:',
    ]
    lines += [f"- {item['name']}" for item in check['checks']]
    lines += [
        f"Explicit unposted ledger exemptions: {check['unposted_exempt']}; superadmin exemptions: {check['superadmin_exempt']}; superadmin cross-level count: {check['superadmin_cross_level_count']}.",
        'These eight checks do not certify every domain rule. No OT check or monthly-quota check is listed in this response.',
        '',
        'DEPLOYMENT AND HISTORY',
        'Railway domain matches the screenshot; app DATABASE_URL matches the production Postgres service (values never exported).',
        'Recorded successful app deployment: 2026-11-20T11:18:13.548Z, commit 95e97e28e6693a24f9050bf240451d648dc8dc8a.',
        'That commit uses allocation objective revision 2. The later local revision-4 tuning is not in this recorded deployment.',
        'Assignment sources: 574 reviewed_compute_draft, 230 balance_duties, 36 extra_duty_layer.',
        'The latest five recorded compute jobs were cancelled; this does not establish the status of every earlier job.',
        'Recent history includes multiple applied Balance duties batches; residual unfairness remains. History alone does not prove its algorithmic cause.',
        '',
        'NEXT TROUBLESHOOTING ACTION',
        'Build a no-write reproduction of the 1st/2nd-call transfer and swap opportunities, preserving all dated eligibility, leave, rest, fixed duties and quotas.',
        'Explain every remaining above-threshold gap with blocked opportunities or a feasible validated proposal.',
        'Require full-plan validation, unchanged coverage and preview/Excel review before any authorized operational application.',
        'Local unit-layout repair integration remains unfinished. No claim of universal zero holes or gap <=2 is supported yet.',
        '',
        'AUTHORITY AND VERIFICATION',
        'This extension inspected production read-only. PostgreSQL enforced repeatable-read/read-only and the transaction was rolled back.',
        'No assignment, schema, login session or deployment was changed. No personal identifiers or credentials were exported.',
        'Historical local verification: 168 allocation/compute cases and 54 separate balance cases passed on Nov20; not rerun against production.',
        'Original Nov20 one-hour implementation timer stays closed; it has not been restarted.',
        'Full 50-item scope preserved; 21/50 Done unchanged. This report is a baseline, not a completed production fix.',
        '',
        'Evidence: baseline-readonly-v4.json, deployment-identity.json, database-association.json, audit-script-v4.py.txt.',
        'The exact executed script archive matches the hash recorded in the snapshot. Later source changes only format exception handlers.',
    ]
    report = OUT / 'production-allocation-audit-report.txt'
    report.write_text('\n'.join(lines) + '\n', encoding='utf-8-sig')
    main_report = BASE / 'focused-allocation-audit-report.txt'
    previous = main_report.read_text(encoding='utf-8-sig')
    marker = 'PRODUCTION BASELINE ADDED 23 NOVEMBER 2026'
    if marker not in previous:
        main_report.write_text(marker + '\nActual production audit: ' + str(report) +
                               '\n840/840 filled; 1st/2nd-call full-availability gaps 4/6. No production changes.\n\n' + previous,
                               encoding='utf-8-sig')
    state_path = BASE / 'state.json'
    state = json.loads(state_path.read_text(encoding='utf-8-sig'))
    state.update(updated_at=now, work_state='checkpoint',
                 phase='Production read-only baseline verified; 1st/2nd-call fairness repair remains open',
                 current='21/50 Done unchanged. Production840/840filled; full-availability gaps1st4/2nd6. Eight existing safety checks return0violations, with6ledger unposted exemptions. Localrevision4notdeployed. No implementation/test worker active.')
    focus = state['focused_audit']
    focus.pop('blocker', None)
    focus.update(status='production_baseline_verified_repair_pending', native_gui_parent_pid=21572,
                 native_gui_child_pid=8264, active_sessions=[],
                 next_action='No-write reproduction of production 1st/2nd-call transfer/swap constraints, then validated reviewed repair. Production deployment/application requires separate authority.')
    state['production_readonly_audit'].update(status='complete', session=None,
        current='Actual production snapshot verified:840/840coverage, residual1st/2ndfairness gaps, eight safety categories clear within explicit exemption scope.',
        report=str(report.relative_to(ROOT)), evidence=str((OUT / 'baseline-readonly-v4.json').relative_to(ROOT)))
    state.setdefault('timeline', []).append(dict(at=now, title='Actual production November baseline verified',
        detail='840filled;full-availability1st/2ndgaps4/6;8safetychecks0violationswith6unpostedexemptions. No production writes.21Doneunchanged.'))
    state_path.write_text(json.dumps(state, indent=2) + '\n', encoding='utf-8')
    live_path = BASE / 'focused-audit-live.json'
    live = json.loads(live_path.read_text(encoding='utf-8-sig'))
    live.update(phase='Production November2026 baseline verified / READ ONLY. First + second call fairness repair remains open.',
                metrics={'Production coverage':'840 / 840', '1st-call full-month gap':4,
                         '2nd-call full-month gap':6, 'Safety check violations':'0 / 8 checks',
                         'Unposted exemptions':6, 'Production writes':0})
    live['events'].append('Actualproductionbaseline:840/840filled;1st/2ndfull-monthgaps4/6. Existing8safetychecks0violations,6unpostedledgerexemptions;OT/quotasnotcertifiedbythisresponse. Localrevision4notdeployed. Productionreportrecorded;noallocationworkeractive.')
    for suite in live.get('suites', []):
        if not suite['name'].startswith('Nov20 '):
            suite['name'] = 'Nov20 ' + suite['name']
    live_path.write_text(json.dumps(live, indent=2) + '\n', encoding='utf-8')
    continuation = BASE / 'continuation.md'
    handoff = f'''# Production November baseline verified - {now}

User screenshot resolves the actual-app blocker: {snapshot['app_url']}. Read-only production extension performed; original Nov20 implementation timer remains closed. Full50scope preserved,21Done unchanged; production fairness is not fixed.

- Evidence/report: docs/allocation-progress/production-nov2026-20261123/production-allocation-audit-report.txt and baseline-readonly-v4.json. DB-enforced repeatable-read/read-only; rollback; no assignment/schema/login/deployment writes or identifier/credential exports.
-840slots/840activeassignments; draft;261needs_review flags. 1st/2nd raw AND full-availability gaps4/6; adjusted deviations4/6. 3rd full-month gap1/adjusted1.51;4th/5thadjusted0.90/1.00. Eligibility constraints may still block moves; infeasibility notproved.
-Existing independent checker840assignments/8categories/0violations,6explicit unpostedledgerexemptions,0superadminexempt/crossover. NoOT/monthlyquota category returned; don't overclaim safety scope.
-Deployment metadata commit95e97e2 onNov20 11:18UTC matcheslocalHEADrevision2; subsequentworkingtree revision4fixesnotdeployed. Exact executed script archived/hashverified. Historical168+54tests remainhistorical.
-Read-only workers24815/38695 terminal0. No implementation/test/allocation worker active. NativeGUIparent21572/child8264 live command-line verified; originaldeadlineunchanged. Dashboard5201 vieweronly. Revalidatehandlesonresume.
-NEXT: no-write reproduction of1st/2ndtransfer/swap constraints and validated reviewed repair; preserve840coverage,datedcall/unit/groupeligibility,leave/rest,quotas,fixedassignments. Do not call persistent preview/apply/start generation againstproduction. Local50-itemimplementationapprovalstands;productiondeploy/applicationseparateauthority. Unit-layoutpreview/Excel/atomicapplyintegrationstillunfinished.

Earlier checkpoints below are historical; missing-URL/dataset blocker has been resolved.

'''
    continuation.write_text(handoff + continuation.read_text(encoding='utf-8-sig'), encoding='utf-8')
    tracker = ROOT / 'Plan/to do/November26_allocation_action_tracker.md'
    with tracker.open('a', encoding='utf-8') as handle:
        handle.write(f'\n\n### {now} - Production November read-only baseline\n\n'
                     'User supplied actual app screenshot; authenticated Railway domain/database association verified. PostgreSQL enforced repeatable-read/read-only. '
                     '840/840 slots filled; full-month available first/second-call gaps4/6 confirm residual unfairness. Eight existing safety checks found0violations with6explicit unposted exemptions; OT/quotas not certified by that checker response. '
                     'Recorded deployment95e97e2 predates localrevision4fixes. No operational writes/deployment. '
                     'Report: docs/allocation-progress/production-nov2026-20261123/production-allocation-audit-report.txt. '
                     'Full50scope/21Done unchanged; actual-dataset blocker resolved; repair and independent review remain outstanding. Native GUI21572/8264 vieweronly; no allocation worker active.\n')
    print('Production report, tracker, handoff and native dashboard state recorded; no production connection made.')


if __name__ == '__main__':
    main()
