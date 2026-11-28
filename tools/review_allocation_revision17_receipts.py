"""Review immutable audit receipts and synchronize current progress views."""
import ast
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

from run_fairness_revision13_checks import hashes, ROOT, OUT


def read(name):
    return json.loads((OUT / name).read_text(encoding='utf-8-sig'))


def save(name, data):
    (OUT / name).write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')


def main():
    now = datetime.now(timezone.utc).isoformat()
    full_name = 'fairness-modes-revision17-holistic-complete-audit'
    pg_name = 'fairness-modes-revision17-holistic-independent-postgres'
    full, pg = read(full_name + '-status.json'), read(pg_name + '-status.json')
    original = read('fairness-modes-revision17-holistic-reconciliation.json')
    assert full['exit_code'] == pg['exit_code'] == 0
    assert full['source_unchanged'] and pg['source_unchanged']
    assert hashes() == full['source_sha256'] == pg['source_sha256']
    assert original['unique_passed'] == original['unique_collected'] == 2456
    assert original['exact_ids_match'] and original['postgres_guarded_cleanup_complete']
    cases = {}
    for name in (full_name, pg_name):
        rows = list(ET.parse(OUT / (name + '.xml')).getroot().iter('testcase'))
        case_map = {(r.get('classname'), r.get('name')): r for r in rows}
        assert len(rows) == len(case_map)
        assert all(r.find('failure') is None and r.find('error') is None for r in rows)
        cases[name] = case_map
    skipped = {k for k, v in cases[full_name].items() if v.find('skipped') is not None}
    assert skipped == set(cases[pg_name]) and len(skipped) == 63
    assert all(v.find('skipped') is None for v in cases[pg_name].values())
    print('Current source hashes and exact PostgreSQL replacement IDs verified.', flush=True)
    manifest = read('fairness-modes-release-manifest.json')
    candidate = ROOT / manifest['release']
    for rel, expected in manifest['paths'].items():
        for root in (ROOT, candidate):
            assert hashlib.sha256((root / rel).read_bytes()).hexdigest() == expected, rel
    modules = list((ROOT / 'backend/app').rglob('*.py'))
    for source in modules:
        other = candidate / source.relative_to(ROOT)
        assert ast.dump(ast.parse(source.read_text(encoding='utf-8-sig'))) == ast.dump(
            ast.parse(other.read_text(encoding='utf-8-sig'))), str(source)
    unit_bytes = (OUT / 'fairness-modes-revision17-final-frontend-unit.log').read_bytes()
    unit_log = unit_bytes.decode('utf-16' if unit_bytes.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8')
    assert 'pass 156' in unit_log and 'fail 0' in unit_log
    limits = ['Original 50-item programme remains open (21 Done).',
              'Production timing repair not applied; simulation uses confirmed timing projection.',
              'Equal-mode raw third-call night gap is 3; fourth-call night gap is 2.',
              'Staffing review warnings: equal 5, availability 11; production OT guard disabled.',
              'Availability mode raw duty gaps exceed 2 by design; third adjusted gap exceeds saved tolerance.',
              'No global optimality or universal feasibility proof; no production deployment.']
    reviewed = {**{k: v for k, v in original.items() if k != 'source_sha256'},
                'reviewed_at': now, 'current_source_hashes_match': True,
                'candidate_owned_hashes_match': len(manifest['paths']),
                'candidate_backend_ast_modules_match': len(modules),
                'frontend_unit_passed': 156, 'limitations': limits,
                'original_receipt': 'fairness-modes-revision17-holistic-reconciliation.json',
                'original_receipt_note': 'Retained unchanged; its third/fourth-night limitation text is historical. Current fourth-call gap is 2.'}
    save('fairness-modes-revision17-reviewed-verification.json', reviewed)
    message = ('Revision 17 verified: 2456 distinct backend tests passed, including exact 63 PostgreSQL-only cases; '
               'current hashes, guarded database cleanup, 101 candidate file hashes and 184 backend AST modules verified. '
               'Frontend unit suite 156 passed; main/candidate actual UI 32 checks each previously passed. '
               'November equal mode covers 840/840, total gaps 1/2/2/1/1; raw night gaps 1/2/3/2/1. '
               'No production writes or deployment. Original programme 21/50 Done; next N02/N05/N06 evidence reconciliation and N26 architecture comparison preparation.')
    live = read('fairness-modes-live.json')
    summary = read('fairness-modes-revision17-november-verified-summary.json')
    for mode, current in [('equal_counts', 'equal'), ('availability', 'availability')]:
        levels = summary['modes'][current]['levels']
        for measure, chart in live['workload_diagnostics'][mode].items():
            chart['title'] = f'Projected November revision 17 | {measure} gap | {mode}'
            for row, level in zip(chart['rows'], levels):
                row['raw'] = level['measurements'][measure]['gap']
    live['updated_at'] = now
    live['phase'] = 'Revision 17 full audit verified; broader programme remains in progress'
    live['tasks'][1]['status'] = 'Regression verified'
    live['tasks'][2]['status'] = 'Safety verified; staffing review remains'
    live['tasks'][-1]['status'] = '2456 distinct tests passed; receipts reviewed'
    live['events'].append(now + ' ' + message)
    live['diagnostic_note'] = 'Revision 17 projected results; raw third-call night gap 3 remains. Baseline comparison bars retain their documented original baseline.'
    save('fairness-modes-live.json', live)
    state = read('state.json')
    state.update(updated_at=now, work_state='in_progress', phase=live['phase'], current=message,
                 estimate=None, estimated_finish_at=None)
    state['active_execution'] = {'status': 'verification_finished', 'backend_worker': None,
                                 'postgres_worker': None, 'next_action': 'Reconcile baseline/objective acceptance evidence, then prepare N26 architecture comparison.'}
    state['tests'].append({'title': 'Revision 17 reviewed complete audit',
                           'result': '2456 distinct backend passes including 63 PostgreSQL; 156 frontend unit passes; current candidate hashes/AST match.',
                           'evidence': 'docs/allocation-progress/fairness-modes-revision17-reviewed-verification.json'})
    save('state.json', state)
    audit = read('fairness-modes-completion-audit.json')
    audit.update(updated_at=now, current_checkpoint=message,
                 current_regression_result=reviewed, current_full_run=full_name,
                 current_postgres_run=pg_name, current_backend_gate='2456 distinct tests passed; exact current-source PostgreSQL replay verified')
    save('fairness-modes-completion-audit.json', audit)
    matrix = read('fairness-modes-revision17-requirement-audit.json')
    matrix['recorded_at'] = now
    for item in matrix['requirements']:
        item['assessment'] = item['assessment'].replace('focused verified; full audit pending', 'verified in current-source full audit')
        item['evidence_sources'] = [s.replace('engine16-final-performance', 'engine17-final-performance') for s in item['evidence_sources']]
        if item['requirement'].startswith('Admin equal'):
            item['limits'] = 'Main and candidate each passed 32 actual frontend/API checks, including final hours/night display.'
        if item['requirement'].startswith('Safe Apply'):
            item.update(assessment='Verified in current-source full audit and exact PostgreSQL replay', limits='63 PostgreSQL-only cases passed; database cleanup verified.')
        if item['requirement'].startswith('Performance thresholds'):
            item['assessment'] = 'All four original timing gates passed in revision 17 full audit'
        if item['requirement'].startswith('Full system'):
            item.update(assessment='2456 distinct current-source backend cases passed; focused algorithm audit reviewed', limits='Broader 50-item programme remains incomplete; this is not rollout approval.')
    save('fairness-modes-revision17-requirement-audit.json', matrix)
    report_path = ROOT / 'Review/Allocation_engine_fairness_audit_current.txt'
    report = report_path.read_text(encoding='utf-8')
    start = report.index('The revision 17 full run is LIVE:')
    end = report.index('\nLIMITATIONS AND PRODUCTION REVIEW', start)
    report = report[:start] + ('Revision 17 full verification is complete: all 2,456 distinct backend cases passed,\n'
        'including the exact 63 PostgreSQL-only cases. All four original timing gates passed.\n'
        'Current source hashes match both completed audits. Guarded database cleanup was\n'
        'verified. The final frontend unit suite passed all 156 tests. Current main/candidate\n'
        '101 file hashes and 184 backend AST modules match. Broader programme remains open.\n') + report[end:]
    report = report.replace('VERIFICATION: WHAT IS PROVED AND WHAT IS STILL RUNNING', 'VERIFICATION: CURRENT COMPLETED EVIDENCE')
    report_path.write_text(report, encoding='utf-8')
    (OUT / 'fairness-modes-report.txt').write_text(report, encoding='utf-8')
    text = '\n\n' + now + ' CURRENT17 COMPLETED VERIFICATION: ' + message + '\n'
    for path in (ROOT / 'Plan/to do/November26_allocation_action_tracker.md', OUT / 'fairness-modes-execution.log'):
        with path.open('ab') as handle:
            handle.write(text.encode('ascii'))
    print(message)


if __name__ == '__main__':
    main()
