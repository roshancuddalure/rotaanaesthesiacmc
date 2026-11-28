"""Replay exactly the PostgreSQL-only skips through the guarded disposable-DB runner."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

from run_fairness_revision13_checks import hashes, ROOT, OUT


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--revision', type=int, required=True)
    parser.add_argument('--name', default='postgres-skips')
    parser.add_argument('--wait-status', type=Path)
    parser.add_argument('--suite', type=Path, required=True)
    parser.add_argument('--dependency-wait-hours', type=float, default=3,
                        help='Observation allowance only; timeout never authorises database work')
    parser.add_argument('--allow-failed-dependency-for-discovery', action='store_true',
                        help='Independent PG audit after a completed failing suite; never certifies that suite')
    args = parser.parse_args()
    assert 0 < args.dependency_wait_hours <= 24
    assert args.name.replace('-', '').isalnum()
    stem = OUT / f'fairness-modes-revision{args.revision}-{args.name}'
    status_path = Path(str(stem)+'-status.json')
    if status_path.exists():
        raise RuntimeError('Preserve earlier receipt')
    state = {'status': 'waiting-for-full-suite', 'optimizer_revision': args.revision,
             'started_at': datetime.now(timezone.utc).isoformat()}
    status_path.write_text(json.dumps(state, indent=2), encoding='utf-8')
    try:
        initial = hashes()
        if args.wait_status:
            until = time.monotonic() + args.dependency_wait_hours * 3600
            while True:
                # A detached dependency may still be starting or atomically
                # replacing its receipt. Neither condition authorises DB work.
                try:
                    full = json.loads(args.wait_status.read_text(encoding='utf-8'))
                except (FileNotFoundError, json.JSONDecodeError):
                    if time.monotonic() >= until:
                        raise RuntimeError('Full-suite dependency receipt did not become readable')
                    time.sleep(5)
                    continue
                if full['status'] == 'finished':
                    break
                if time.monotonic() >= until:
                    raise RuntimeError('Full-suite dependency did not finish within observation allowance')
                time.sleep(5)
            assert full['source_unchanged'], 'Full-suite source changed'
            if args.allow_failed_dependency_for_discovery:
                assert full['exit_code'] in (0, 1), 'Interrupted/uncollected suite is not a completed audit'
                assert args.suite.exists(), 'Completed full-suite XML required for exact skip discovery'
                state['full_dependency_exit_code'] = full['exit_code']
                state['independent_postgres_audit_only'] = True
            else:
                assert full['exit_code'] == 0, 'Full-suite dependency not verified'
            initial = hashes()
            assert initial == full['source_sha256'], 'Source changed since full suite'
        else:
            state['historical_suite_used_for_node_discovery_only'] = str(args.suite)
        nodes = []
        for case in ET.parse(args.suite).getroot().iter('testcase'):
            skipped = case.find('skipped')
            if skipped is None:
                continue
            assert skipped.get('message') == 'Set DUTY_ROTA_TEST_POSTGRES_URL to a disposable test database'
            nodes.append(case.get('classname').replace('.', '/')+'.py::'+case.get('name'))
        assert nodes and len(nodes) == len(set(nodes))
        state.update(status='running', nodes=nodes, source_sha256=initial)
        command = [sys.executable, str(ROOT/'tools/test_compute_postgres.py'), '--only-extra-tests',
                   '--junitxml', str(stem)+'.xml']
        for node in nodes:
            command += ['--extra-test', node]
        with Path(str(stem)+'.log').open('wb') as log:
            child = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
            state['worker_pid'] = child.pid
            status_path.write_text(json.dumps(state, indent=2), encoding='utf-8')
            code = child.wait()
        state.update(status='finished', exit_code=code, source_unchanged=initial == hashes())
        return code
    except Exception as exc:
        state.update(status='dependency-refused', reason=str(exc))
        return 1
    finally:
        state['updated_at'] = datetime.now(timezone.utc).isoformat()
        status_path.write_text(json.dumps(state, indent=2), encoding='utf-8')


if __name__ == '__main__':
    sys.exit(main())
