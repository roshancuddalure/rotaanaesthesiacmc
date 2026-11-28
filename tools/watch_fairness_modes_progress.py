"""Read-only worker monitor for the native fairness audit window; never allocates duties."""
import ctypes
import json
from pathlib import Path
import re
import sys
import time
from datetime import datetime, timezone
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/allocation-progress'
PID = int(sys.argv[1])
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.OpenProcess.restype = ctypes.c_void_p
kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
kernel.CloseHandle.argtypes = [ctypes.c_void_p]


def alive():
    handle = kernel.OpenProcess(0x1000, False, PID)
    if not handle:
        return False
    result = ctypes.c_ulong()
    try:
        return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(result))) and result.value == 259
    finally:
        kernel.CloseHandle(handle)


def read_log(path):
    raw = path.read_bytes() if path.exists() else b''
    return raw.decode('utf-16' if raw.startswith(b'\xff\xfe') else 'utf-8-sig', errors='replace')


while True:
    now = datetime.now(timezone.utc).isoformat()
    text = read_log(OUT / 'fairness-modes-full-system.log')
    lines = re.findall(r'^([.FEsxX]+)\s+\[\s*\d+%\]', text, re.MULTILINE)
    completed = sum(map(len, lines))
    failures = sum(line.count('F')+line.count('E') for line in lines)
    live = alive()
    phase = f'Full-system regression: {completed}/2256 reported; {failures} failure(s) observed. '
    phase += 'Worker running; focused corrections are tracked separately.' if live else 'Worker stopped; review terminal results.'
    receipt = OUT / 'fairness-modes-full-system.xml'
    fraction = completed/2256
    progress_label = f'{completed}/2256'
    if '--files' in sys.argv:
        try:
            audit = json.loads((OUT/'fairness-system/status.json').read_text(encoding='utf-8'))
            completed = sum(int(row.get('tests') or 0) for row in audit['files'])
            failures = sum(int(row.get('failures') or 0)+int(row.get('errors') or 0) for row in audit['files'])
            phase = (f"System audit: {len(audit['files'])}/{audit['total_files']} modules finished; "
                     f"{completed} terminal test receipts; {failures} failures/errors. "
                     f"Current: {audit.get('current')}. Worker {'running' if live else 'stopped'}.")
            fraction = len(audit['files'])/max(1,audit['total_files'])
            progress_label = f"{len(audit['files'])}/{audit['total_files']} modules"
        except (OSError, ValueError):
            pass
    if '--batch' in sys.argv:
        try:
            batch=json.loads((OUT/'fairness-modes-system-batch.json').read_text(encoding='utf-8'))
            records=[json.loads(line) for line in read_log(OUT/'fairness-modes-system-events.jsonl').splitlines() if line.strip()]
            done={r['nodeid'] for r in records if r.get('stage')=='teardown'}
            bad={r['nodeid'] for r in records if r.get('outcome')=='failed'}
            total=next((r['collected'] for r in records if r.get('stage')=='collection'),None)
            completed=len(done)
            failures=len(bad)
            progress_label=f'{completed}/{total}' if total is not None else f'{completed} reported'
            fraction=completed/max(1,total) if total is not None else 0
            current=next((r.get('nodeid') for r in reversed(records) if r.get('nodeid')), 'Collecting tests')
            phase=f"Remaining-system batch: {progress_label} terminal outcomes; {failures} failures. {current}. Worker {'running' if live else 'stopped'}."
            if batch['status']=='waiting_for_existing_module':
                phase='Finishing the existing test module before the consolidated regression starts.'
        except (OSError, ValueError, KeyError):
            phase='Preparing consolidated regression; earlier per-module receipts are retained.'
    if receipt.exists():
        try:
            suite = ET.parse(receipt).getroot().find('testsuite')
            phase = f"Full-system batch ended: {suite.get('tests')} tests; {suite.get('failures')} failures; {suite.get('errors')} errors. Review corrective results before release."
        except (ET.ParseError, AttributeError):
            pass
    try:
        path = OUT / 'fairness-modes-live.json'
        state = json.loads(path.read_text(encoding='utf-8-sig'))
        state['phase'] = phase
        state['metrics']['System regression'] = progress_label if live else 'Review results'
        for chart in state.get('charts', []):
            if chart['name'] == 'Full system':
                chart.update(fraction=fraction, value=progress_label)
        path.write_text(json.dumps(state, indent=2), encoding='utf-8')
        (OUT / 'fairness-modes-monitor.json').write_text(json.dumps(dict(
            updated_at=now, worker_pid=PID, worker_alive=live, reported_cases=completed,
            observed_failures=failures, phase=phase), indent=2), encoding='utf-8')
    except (OSError, ValueError):
        pass
    if not live:
        break
    time.sleep(5)
