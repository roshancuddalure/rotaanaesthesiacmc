"""Run the unchanged speed gates after both isolated regression workers finish."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import time

from run_fairness_revision13_checks import ROOT, OUT, hashes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--revision', type=int, required=True)
    args = parser.parse_args()
    stem = OUT / f'fairness-modes-revision{args.revision}'
    output = Path(str(stem)+'-performance-queue.json')
    assert not output.exists(), 'Preserve prior queue receipt'
    state = {'status': 'waiting-for-regression-workers', 'started_at': datetime.now(timezone.utc).isoformat()}
    output.write_text(json.dumps(state, indent=2), encoding='utf-8')
    try:
        deadline = time.monotonic()+10800
        while True:
            full = json.loads(Path(str(stem)+'-full-system-status.json').read_text())
            pg = json.loads(Path(str(stem)+'-postgres-skips-status.json').read_text())
            if all(r['status'] == 'finished' for r in (full, pg)):
                break
            if any(r.get('status') == 'dependency-refused' for r in (full, pg)):
                raise RuntimeError('A regression dependency was refused')
            if time.monotonic() >= deadline:
                raise RuntimeError('Regression dependencies did not finish within three hours')
            time.sleep(5)
        assert all(r['exit_code'] == 0 and r['source_unchanged'] for r in (full, pg))
        assert full['source_sha256'] == pg['source_sha256'] == hashes()
        state['status'] = 'running'
        output.write_text(json.dumps(state, indent=2), encoding='utf-8')
        code = subprocess.call([sys.executable, str(ROOT/'tools/run_fairness_revision13_checks.py'),
            '--name', 'serialized-performance',
            'backend/tests/test_extra_duty.py::test_full_month_plans_quickly',
            'backend/tests/test_extra_duty.py::test_full_month_all_units_plans_quickly'], cwd=ROOT)
        state.update(status='finished', exit_code=code)
        return code
    except Exception as exc:
        state.update(status='dependency-refused', reason=str(exc))
        return 1
    finally:
        state['updated_at'] = datetime.now(timezone.utc).isoformat()
        output.write_text(json.dumps(state, indent=2), encoding='utf-8')


if __name__ == '__main__':
    sys.exit(main())
