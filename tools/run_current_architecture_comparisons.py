"""Run current-policy comparisons sequentially after the arithmetic gate passes."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/allocation-progress'
PREFIX = 'n26-revision17-enhanced-objectives'


def main():
    gate = OUT / 'n26-revision17-current-objective-harness-verified.xml'
    cases = list(ET.parse(gate).getroot().iter('testcase'))
    assert len(cases) == 6 and all(
        all(row.find(tag) is None for tag in ('error', 'failure', 'skipped')) for row in cases)
    status_path = OUT / (PREFIX + '-batch-status.json')
    assert not status_path.exists(), 'Preserve earlier run receipts'
    names = [('equal-forward', 'equal_counts', False),
             ('equal-reverse', 'equal_counts', True),
             ('availability-forward', 'availability', False)]
    assert all(not (OUT / (PREFIX + '-' + name + suffix)).exists()
               for name, _, _ in names for suffix in ('.json', '.log'))
    script = ROOT / 'tools/compare_month_allocation_architectures.py'
    digest = hashlib.sha256(script.read_bytes()).hexdigest()
    status = {'status': 'running', 'started_at': datetime.now(timezone.utc).isoformat(),
              'harness_sha256': digest, 'completed': [], 'production_writes': 0,
              'scope': 'Three synthetic current-policy comparisons; no architecture selection or production activation.'}

    def save():
        status_path.write_text(json.dumps(status, indent=2) + '\n', encoding='utf-8')

    save()
    for name, policy, reverse in names:
        output = OUT / (PREFIX + '-' + name + '.json')
        status['current'] = name
        save()
        command = [sys.executable, str(script), '--output', str(output), '--seconds', '30',
                   '--full-objectives', '--mixed-calls', '--count-limited', '--preserved',
                   '--fairness-mode', policy]
        if reverse:
            command.append('--reverse-methods')
        print('Starting ' + name, flush=True)
        with (OUT / (PREFIX + '-' + name + '.log')).open('w', encoding='utf-8') as log:
            worker = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
            status['worker_pid'] = worker.pid
            save()
            result = worker.wait()
        if result:
            status.update(status='failed', exit_code=result)
            save()
            raise RuntimeError('Comparison failed: ' + name)
        report = json.loads(output.read_text(encoding='utf-8'))
        assert report['complete'] and report['source_unchanged'] and report['assignment_writes'] == 0
        assert all(r['preserved_signatures_unchanged'] for r in report['methods'].values())
        assert all(len(r['objective_tiers']) == 13 for r in report['methods'].values())
        assert hashlib.sha256(script.read_bytes()).hexdigest() == digest
        status['completed'].append(name)
        save()
        print('Verified ' + name, flush=True)
    status.update(status='finished', exit_code=0, finished_at=datetime.now(timezone.utc).isoformat(), worker_pid=None)
    save()


if __name__ == '__main__':
    main()
