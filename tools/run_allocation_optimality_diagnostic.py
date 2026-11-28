"""Run one unchanged failing fixture after the frozen full/PG audit reconciles."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from run_fairness_revision13_checks import ROOT, OUT, hashes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reconciliation', type=Path, required=True)
    parser.add_argument('--name', required=True)
    args = parser.parse_args()
    assert args.name.replace('-', '').isalnum()
    stem = OUT / args.name
    status_path = Path(str(stem) + '-status.json')
    trace_path = Path(str(stem) + '-trace.json')
    log_path = Path(str(stem) + '.log')
    xml_path = Path(str(stem) + '.xml')
    assert not any(p.exists() for p in (status_path, trace_path, log_path, xml_path))
    state = {'status': 'waiting-for-reconciliation', 'started_at': datetime.now(timezone.utc).isoformat(),
             'driver_pid': os.getpid(), 'source_sha256': hashes(),
             'dependency': str(args.reconciliation), 'diagnostic_only': True,
             'original_assertions_unchanged': True, 'original_budget_unchanged': True}

    def save():
        status_path.write_text(json.dumps(state, indent=2), encoding='utf-8')

    save()
    deadline = time.monotonic() + 24 * 3600
    while not args.reconciliation.exists():
        if time.monotonic() > deadline:
            state.update(status='observation-expired', finished_at=datetime.now(timezone.utc).isoformat())
            save()
            return 2
        time.sleep(10)
    dependency = json.loads(args.reconciliation.read_text(encoding='utf-8'))
    assert dependency['exact_ids_match'] and dependency['postgres_guarded_cleanup_complete']
    assert dependency['current_source_hashes_match']
    assert dependency['source_sha256'] == state['source_sha256'] == hashes()
    # A diagnostic pass never replaces the original full-run failure receipt.
    env = {**os.environ, 'PYTHONPATH': str(ROOT / 'tools') + os.pathsep + os.environ.get('PYTHONPATH', ''),
           'DUTY_OPTIMALITY_TRACE': str(trace_path)}
    command = [sys.executable, '-m', 'pytest', '-p', 'allocation_optimality_trace',
               'backend/tests/test_generation_reliability.py::test_optimizer_gpu_hints_are_validated_and_keep_server_safety[server]',
               '-q', '--tb=short', '--junitxml=' + str(xml_path)]
    with log_path.open('xb') as log:
        child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        state.update(status='running', worker_pid=child.pid)
        save()
        code = child.wait()
    state.update(status='finished', exit_code=code,
                 source_unchanged=state['source_sha256'] == hashes(),
                 trace_recorded=trace_path.exists(), finished_at=datetime.now(timezone.utc).isoformat())
    save()
    return code


if __name__ == '__main__':
    sys.exit(main())
