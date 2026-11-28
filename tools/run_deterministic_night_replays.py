"""Two independent hash-seed November read-only replays, preserving raw receipts."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/allocation-progress'
STEM = 'joint-clinical-night-deterministic-replay'


def main():
    cases = list(ET.parse(OUT / 'joint-clinical-night-deterministic-gate.xml').getroot().iter('testcase'))
    assert len(cases) == 31 and all(all(c.find(tag) is None for tag in ('failure', 'error', 'skipped')) for c in cases)
    path = OUT / (STEM + '-status.json')
    assert not path.exists(), 'Preserve earlier replay receipts'
    sources = ['tools/study_joint_clinical_nights.py', 'tools/study_clinical_night_flow.py',
               'tools/study_night_count_cost.py', 'tools/probe_production_balance_readonly.py']
    status = dict(status='running', started_at=datetime.now(timezone.utc).isoformat(), completed=[],
                  source_sha256={p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in sources},
                  production_writes=0, deterministic_units=40)

    def save():
        path.write_text(json.dumps(status, indent=2)+'\n', encoding='utf-8')

    save()
    reports = []
    for seed in ('17', '91'):
        tag = 'deterministic-seed-' + seed
        receipt = OUT / 'production-nov2026-20261123' / (
            'fairness-modes-engine17-clinical-night-flow-joint-model-' + tag + '.json')
        assert not receipt.exists()
        status['current'] = tag
        save()
        command = ['powershell.exe', '-NoProfile', '-File', str(ROOT / 'tools/run_november_clinical_night_flow.ps1'),
                   '-Joint', '-RunTag', tag, '-StudySeconds', '180', '-DeterministicUnits', '40']
        print('Starting ' + tag, flush=True)
        worker = subprocess.Popen(command, cwd=ROOT, env={**os.environ, 'PYTHONHASHSEED': seed})
        status['worker_pid'] = worker.pid
        save()
        code = worker.wait()
        if code:
            status.update(status='failed', exit_code=code)
            save()
            raise RuntimeError('Readonly replay command failed')
        report = json.loads(receipt.read_text(encoding='utf-8'))
        assert report['status'] == 'simulation_complete' and report['finalization_phase'] == 'completed'
        assert report['database_enforced_readonly'] and report['operational_writes'] == 0
        assert report['independent_final_safety']['ok'] and not report['all_holder_revalidation']['failures']
        assert report['coverage_after'] == dict(slots=840, filled_slots=840, unassigned_slots=0)
        assert all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest() == h for p, h in status['source_sha256'].items())
        reports.append(report)
        status['completed'].append(dict(seed=seed, receipt=str(receipt.relative_to(ROOT)),
            accepted=report['joint_clinical_night_study']['accepted'],
            proposed_assignments_sha256=report['proposed_assignments_sha256']))
        save()
        print('Verified ' + tag, flush=True)
    assert reports[0]['input_assignments_sha256'] == reports[1]['input_assignments_sha256']
    assert reports[0]['scheduling_context_sha256'] == reports[1]['scheduling_context_sha256']
    matched = reports[0]['proposed_assignments_sha256'] == reports[1]['proposed_assignments_sha256']
    both_accepted = all(r['joint_clinical_night_study']['accepted'] for r in reports)
    status.update(status='finished', exit_code=0, hashes_match=matched, both_accepted=both_accepted,
                  deterministic_improvement_verified=matched and both_accepted,
                  worker_pid=None, finished_at=datetime.now(timezone.utc).isoformat())
    save()
    print('Replay parity: ' + str(matched) + '; both accepted: ' + str(both_accepted), flush=True)


if __name__ == '__main__':
    main()
