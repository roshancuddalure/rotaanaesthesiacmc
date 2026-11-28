"""Run the archived pre-audit optimizer on fresh disposable corpus fixtures.

Compare coverage/load with focused-corpus-final.json, not runtime: concurrent
workers and an uncontrolled host make causal speed claims inappropriate.
"""
import hashlib
import json
from pathlib import Path
import sys
import types

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT / 'backend'))
import benchmark_allocation_corpus as corpus  # noqa: E402


def main():
    source = ROOT / 'docs/allocation-progress/focused-before/rota_optimizer.py.txt'
    archived = types.ModuleType('focused_archived_optimizer')
    exec(compile(source.read_text(encoding='utf-8'), str(source), 'exec'), archived.__dict__)
    output = ROOT / 'docs/allocation-progress/focused-archived-comparison.json'
    if output.exists():
        raise RuntimeError('Keep historical evidence; select a new output path')
    report = dict(complete=False, archived_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                  scope='Pre-audit optimizer function with current shared helpers; isolated SQLite only.',
                  limitations='Concurrent workers; no causal runtime claim. Compare equal semantic fixtures.',
                  settings=dict(members=48, slots=62, seconds=20), runs=[])
    current = corpus.optimizer.solve_month
    try:
        corpus.optimizer.solve_month = archived.solve_month
        for case in ('control', 'dated_fixed'):
            print('Archived optimizer: '+case, flush=True)
            report['runs'].append(corpus.run_case(case, 48, 62, 20))
            output.write_text(json.dumps(report, indent=2, default=str), encoding='utf-8')
        report['complete'] = True
    finally:
        corpus.optimizer.solve_month = current
        output.write_text(json.dumps(report, indent=2, default=str), encoding='utf-8')


if __name__ == '__main__':
    main()
