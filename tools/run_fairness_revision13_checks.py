"""Durable revision13 regression receipts; never overwrite a previous run."""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/allocation-progress'


def hashes():
    return {str(p.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
            for folder in ('backend/app', 'backend/tests')
            for p in sorted((ROOT / folder).rglob('*.py'))}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', required=True)
    parser.add_argument('--resume-passed', type=Path)
    parser.add_argument('--defer-performance', action='store_true')
    parser.add_argument('--preview-latency', action='store_true', help='Diagnostic wall/CPU receipt; assertions unchanged')
    parser.add_argument('--preview-profile', action='store_true', help='Instrument preview only; diagnostic, not a latency certificate')
    parser.add_argument('tests', nargs='+')
    args = parser.parse_args()
    assert args.name.replace('-', '').isalnum()
    objective = ast.parse((ROOT/'backend/app/services/allocation_objectives.py').read_text(encoding='utf-8-sig'))
    revision = next(ast.literal_eval(node.value) for node in objective.body
                    if isinstance(node, ast.Assign) and any(
                        isinstance(target, ast.Name) and target.id == 'OPTIMIZER_OBJECTIVE_REVISION'
                        for target in node.targets))
    stem = OUT / (f'fairness-modes-revision{revision}-' + args.name)
    status, events = Path(str(stem)+'-status.json'), Path(str(stem)+'-events.jsonl')
    assert not status.exists() and not events.exists(), 'Preserve existing receipts'
    data = {'status': 'running', 'optimizer_revision': revision, 'started_at': datetime.now(timezone.utc).isoformat(),
            'tests': args.tests, 'source_sha256': hashes()}
    env = {**os.environ, 'PYTHONPATH': str(ROOT/'tools')+os.pathsep+os.environ.get('PYTHONPATH', ''),
           'DUTY_FAIRNESS_AUDIT_EVENTS': str(events)}
    if args.resume_passed:
        manifest = json.loads(args.resume_passed.read_text(encoding='utf-8'))
        assert manifest['source_sha256'] == hashes(), 'Cannot reuse results from different source'
        env['DUTY_FAIRNESS_RESUME_PASSED'] = str(args.resume_passed.resolve())
        data['resumed_passed_tests'] = len(manifest['passed_nodeids'])
        data['resume_manifest'] = str(args.resume_passed)
    if args.defer_performance:
        env['DUTY_FAIRNESS_DEFER_PERFORMANCE'] = '1'
        data['deferred_performance_tests'] = 2
    command = [sys.executable, '-m', 'pytest', '-p', 'fairness_audit_pytest_plugin',
               *args.tests, '-q', '--tb=short', '--junitxml='+str(stem)+'.xml']
    if args.preview_latency or args.preview_profile:
        env['DUTY_PREVIEW_LATENCY_RECEIPT'] = str(stem)+'-latency.jsonl'
        command += ['-p', 'allocation_preview_latency']
        data['diagnostic_only'] = True
        if args.preview_profile:
            env['DUTY_PREVIEW_PROFILE_BASE'] = str(stem)
    with Path(str(stem)+'.log').open('wb') as log:
        child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        data['worker_pid'] = child.pid
        status.write_text(json.dumps(data, indent=2), encoding='utf-8')
        code = child.wait()
    data.update(status='finished', exit_code=code, source_unchanged=data['source_sha256']==hashes(),
                finished_at=datetime.now(timezone.utc).isoformat())
    status.write_text(json.dumps(data, indent=2), encoding='utf-8')
    return code


if __name__ == '__main__':
    sys.exit(main())
