"""Frozen-source whole-backend audit with durable per-test terminal receipts."""
import ctypes
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'docs/allocation-progress'


def sources():
    return {str(p.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
            for folder in ['backend/app', 'backend/tests'] for p in (ROOT/folder).rglob('*.py')}


def main():
    status = OUT/'fairness-modes-revision11-system-status.json'
    events = OUT/'fairness-modes-revision11-system-events.jsonl'
    if status.exists() or events.exists():
        raise RuntimeError('Preserve existing audit evidence')
    data = {'status': 'waiting_for_bound_checks', 'awaited_pid': int(sys.argv[1])}
    def save():
        status.write_text(json.dumps(data, indent=2), encoding='utf-8')
    save()
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.OpenProcess(0x100000, False, data['awaited_pid'])
    if handle:
        try:
            while kernel.WaitForSingleObject(handle, 1000) == 258:
                pass
        finally:
            kernel.CloseHandle(handle)
    suite = ET.parse(OUT/'fairness-modes-weekend-bounds.xml').getroot().find('testsuite')
    if int(suite.get('failures')) or int(suite.get('errors')):
        data['status'] = 'bound_check_failure'
        save()
        return
    data.update(status='running', source_sha256=sources(),
                started_at=datetime.now(timezone.utc).isoformat())
    env = {**os.environ, 'PYTHONPATH': str(ROOT/'tools')+os.pathsep+os.environ.get('PYTHONPATH', ''),
           'DUTY_FAIRNESS_AUDIT_EVENTS': str(events)}
    command = [str(Path(sys.executable).with_name('python.exe')), '-m', 'pytest',
               '-p', 'fairness_audit_pytest_plugin', 'backend/tests', '-q', '--tb=short',
               f'--junitxml={OUT/"fairness-modes-revision11-system.xml"}']
    with (OUT/'fairness-modes-revision11-system.log').open('wb') as log:
        worker = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        data['worker_pid'] = worker.pid
        save()
        code = worker.wait()
    data.update(status='finished', exit_code=code, source_unchanged=data['source_sha256'] == sources(),
                finished_at=datetime.now(timezone.utc).isoformat())
    save()


if __name__ == '__main__':
    main()
