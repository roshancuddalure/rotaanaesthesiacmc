"""Collect terminal snapshot evidence before isolated checks and cold timing."""
import ctypes
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'docs/allocation-progress'


def main():
    status = OUT/'fairness-modes-slot-followup-status.json'
    if status.exists():
        raise RuntimeError('Preserve earlier follow-up evidence')
    data = {'status': 'waiting', 'awaited_pid': int(sys.argv[1]),
            'started_at': datetime.now(timezone.utc).isoformat()}
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
    receipt = OUT/'fairness-modes-slot-snapshot.xml'
    suite = ET.parse(receipt).getroot().find('testsuite')
    errors = [case.get('name') for case in suite.findall('testcase')
              if case.find('error') is not None or case.find('failure') is not None]
    # An unchanged latency gate can fail without concealing functional failures.
    if any(name not in {'test_full_month_plans_quickly',
                         'test_full_month_all_units_plans_quickly'} for name in errors):
        data.update(status='functional_failure', failures=errors)
        save()
        return
    python = str(Path(sys.executable).with_name('python.exe'))
    commands = [
        ('release', ROOT, [python, 'tools/prepare_fairness_modes_release.py', '--refresh-owned-release']),
        ('isolated', ROOT/'Debug/Allocation-release-r9', [python, '-m', 'pytest',
            'backend/tests/test_fairness_burden_oracle.py',
            'backend/tests/test_candidate_scope_snapshot_cache.py',
            'backend/tests/test_ot_validation_lazy_import.py',
            'backend/tests/test_extra_fairness_cache.py', '-q', '--tb=short',
            f'--junitxml={OUT/"fairness-modes-slot-isolated.xml"}']),
        ('timing', ROOT, [python, '-m', 'pytest',
            'backend/tests/test_extra_duty.py::test_full_month_plans_quickly',
            'backend/tests/test_extra_duty.py::test_full_month_all_units_plans_quickly',
            '-q', '--tb=short', f'--junitxml={OUT/"fairness-modes-slot-cold-timing.xml"}']),
    ]
    for name, cwd, command in commands:
        with (OUT/f'fairness-modes-slot-followup-{name}.log').open('wb') as log:
            worker = subprocess.Popen(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT)
            data.update(status='running', phase=name, worker_pid=worker.pid)
            save()
            code = worker.wait()
        data[name+'_exit_code'] = code
        if code and name != 'timing':
            data.update(status='failed')
            save()
            return
    data.update(status='finished', finished_at=datetime.now(timezone.utc).isoformat())
    save()


if __name__ == '__main__':
    main()
