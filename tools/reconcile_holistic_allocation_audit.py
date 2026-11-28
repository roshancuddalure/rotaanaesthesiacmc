"""Reconcile completed SQLite/PG cases without concealing failed timing gates."""
from datetime import datetime, timezone
import argparse
import json
from pathlib import Path
import time
import xml.etree.ElementTree as ET

from run_fairness_revision13_checks import hashes, OUT

parser = argparse.ArgumentParser()
parser.add_argument('--revision', type=int, default=16)
parser.add_argument('--full-name', default='holistic-complete-audit')
parser.add_argument('--postgres-name', default='holistic-independent-postgres')
parser.add_argument('--receipt-name', default='holistic-reconciliation')
parser.add_argument('--wait-hours', type=float, default=4)
args = parser.parse_args()
assert 16 <= args.revision <= 99
assert all(name.replace('-', '').isalnum() for name in (args.full_name, args.postgres_name, args.receipt_name))
assert 0 < args.wait_hours <= 24
FULL = OUT / f'fairness-modes-revision{args.revision}-{args.full_name}'
PG = OUT / f'fairness-modes-revision{args.revision}-{args.postgres_name}'
RECEIPT = OUT / f'fairness-modes-revision{args.revision}-{args.receipt_name}.json'
PERFORMANCE = {
    ('tests.test_extra_duty', 'test_full_month_plans_quickly'),
    ('tests.test_extra_duty', 'test_full_month_all_units_plans_quickly'),
    ('tests.test_extra_duty_verify', 'test_three_hundred_slots_in_under_two_seconds'),
    ('tests.test_rota_report_360', 'test_performance_300_slots_150_members'),
}


def status(stem):
    return json.loads(Path(str(stem) + '-status.json').read_text(encoding='utf-8'))


def cases(stem):
    result = {}
    for case in ET.parse(str(stem) + '.xml').getroot().iter('testcase'):
        key = (case.get('classname'), case.get('name'))
        assert key not in result, 'Duplicate test ID is not distinct evidence'
        outcome = next((name for name in ('failure', 'error', 'skipped')
                        if case.find(name) is not None), 'passed')
        result[key] = outcome
    return result


def main():
    assert not RECEIPT.exists(), 'Preserve prior reconciliation'
    deadline = time.monotonic() + args.wait_hours * 3600
    while True:
        try:
            full, pg = status(FULL), status(PG)
            if full['status'] == 'finished' and pg['status'] in ('finished', 'dependency-refused'):
                break
        except (OSError, json.JSONDecodeError):
            pass
        if time.monotonic() > deadline:
            raise RuntimeError('Observation deadline reached; inspect the same workers before any restart')
        time.sleep(10)
    assert full['exit_code'] in (0, 1) and full['source_unchanged'], 'Full audit interrupted or source changed'
    assert pg['status'] == 'finished' and pg['exit_code'] == 0 and pg['source_unchanged'], 'PG audit not verified'
    assert full['source_sha256'] == pg['source_sha256'] == hashes(), 'Current source differs from tested source'
    sqlite, postgres = cases(FULL), cases(PG)
    skipped = {key for key, outcome in sqlite.items() if outcome == 'skipped'}
    assert skipped == set(postgres), 'PG cases do not exactly replace SQLite skips'
    assert all(outcome == 'passed' for outcome in postgres.values()), 'PG cases did not all pass'
    failed = {key for key, outcome in sqlite.items() if outcome in ('failure', 'error')}
    unique_passed = {key for key, outcome in sqlite.items() if outcome == 'passed'} | set(postgres)
    assert unique_passed.isdisjoint(failed) and len(unique_passed) + len(failed) == len(sqlite)
    receipt = {
        'recorded_at': datetime.now(timezone.utc).isoformat(),
        'status': 'all_test_cases_passed' if not failed else 'completed_with_failures',
        'unique_collected': len(sqlite), 'unique_passed': len(unique_passed),
        'failed': [list(key) for key in sorted(failed)],
        'performance_failures': [list(key) for key in sorted(failed & PERFORMANCE)],
        'other_failures': [list(key) for key in sorted(failed - PERFORMANCE)],
        'postgres_replaced_skips': len(postgres), 'exact_ids_match': True,
        'current_source_hashes_match': True, 'source_sha256': hashes(),
        'postgres_guarded_cleanup_complete': True,
        'production_deployed': False, 'overall_goal_complete': False,
        'limitations': ['Full original50-item scope remains open',
                        'Production timing repair not applied',
                        ('Current confirmed-timing equal-mode replay meets total/night gap<=2; availability raw counts may exceed2'
                         if args.revision >= 18 else 'Third/fourth night-duty gaps of3 remain'),
                        'Staffing review warnings5/11 remain; production OT guard disabled'],
    }
    RECEIPT.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    live_path = OUT / 'fairness-modes-live.json'
    live = json.loads(live_path.read_text(encoding='utf-8'))
    live['phase'] = (f"Holistic audit reconciled: {len(unique_passed)}/{len(sqlite)} distinct passes; "
                     f"{len(failed)} failures. Review receipt; overall goal remains incomplete.")
    live['metrics']['Full regression'] = f'{len(unique_passed)}/{len(sqlite)} passed'
    live['tasks'][-1]['status'] = 'Audit results need review'
    live['events'].append(receipt['recorded_at'] + ' ' + live['phase'])
    live_path.write_text(json.dumps(live, indent=2), encoding='utf-8')
    print(live['phase'])


if __name__ == '__main__':
    main()
