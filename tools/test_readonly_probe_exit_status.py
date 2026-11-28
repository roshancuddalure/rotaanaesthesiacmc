"""A failed read-only diagnostic must fail its real command-line contract."""
import json
from pathlib import Path
import subprocess
import sys


def test_failed_probe_receipt_returns_nonzero_without_connecting_to_database(tmp_path):
    root = Path(__file__).resolve().parents[1]
    receipt = tmp_path / 'failed-probe.json'
    result = subprocess.run([sys.executable, str(root / 'tools/probe_production_balance_readonly.py'),
                             str(receipt)], input='{}', capture_output=True, text=True,
                            cwd=root, timeout=90)
    report = json.loads(receipt.read_text(encoding='utf-8'))
    assert result.returncode != 0
    assert report['status'] == 'failed' and report['error_class'] == 'KeyError'
    assert report['operational_writes'] == 0
    assert 'database_enforced_readonly' not in report  # Failure precedes any connection.
