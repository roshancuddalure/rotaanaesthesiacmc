"""Verify the 61 PostgreSQL-only skips using the existing guarded local runner."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/allocation-progress'
STATUS = OUT / 'fairness-modes-revision11-postgres-skips-status.json'


def hashes():
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for folder in ('backend/app', 'backend/tests')
            for p in sorted((ROOT / folder).rglob('*.py'))}


def main():
    suite = ET.parse(OUT / 'fairness-modes-revision11-system.xml').getroot()
    nodes = []
    for case in suite.iter('testcase'):
        skipped = case.find('skipped')
        if skipped is None:
            continue
        assert skipped.get('message') == 'Set DUTY_ROTA_TEST_POSTGRES_URL to a disposable test database'
        nodes.append(case.get('classname').replace('.', '/') + '.py::' + case.get('name'))
    assert len(nodes) == len(set(nodes)) == 61
    initial = hashes()
    status = {'started_at': datetime.now(timezone.utc).isoformat(), 'status': 'running',
              'nodes': nodes, 'source_sha256': initial}
    STATUS.write_text(json.dumps(status, indent=2), encoding='utf-8')
    command = [sys.executable, str(ROOT / 'tools/test_compute_postgres.py'),
               '--only-extra-tests', '--junitxml',
               str(OUT / 'fairness-modes-revision11-postgres-skips.xml')]
    for node in nodes:
        command.extend(['--extra-test', node])
    with (OUT / 'fairness-modes-revision11-postgres-skips.log').open('wb') as log:
        process = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        status['worker_pid'] = process.pid
        STATUS.write_text(json.dumps(status, indent=2), encoding='utf-8')
        code = process.wait()
    status.update(status='finished', exit_code=code, source_unchanged=initial == hashes(),
                  finished_at=datetime.now(timezone.utc).isoformat())
    STATUS.write_text(json.dumps(status, indent=2), encoding='utf-8')
    return code


if __name__ == '__main__':
    sys.exit(main())
