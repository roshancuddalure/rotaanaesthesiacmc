"""Rerun unchanged timing gates after the known regression worker exits."""
import ctypes
from datetime import datetime,timezone
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/allocation-progress'


def main():
    status=OUT/'fairness-modes-performance-final-status.json'
    if status.exists():
        raise RuntimeError('Preserve recorded timing evidence')
    pid=int(sys.argv[1])
    data={'status':'waiting_for_regression','awaited_pid':pid,
          'started_at':datetime.now(timezone.utc).isoformat(),
          'limitation':'Other unrelated machine activity is not controlled.'}
    status.write_text(json.dumps(data,indent=2),encoding='utf-8')
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenProcess.restype=ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes=[ctypes.c_void_p,ctypes.c_ulong]
    kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    handle=kernel.OpenProcess(0x100000,False,pid)
    if handle:
        try:
            while kernel.WaitForSingleObject(handle,1000)==258:
                pass
        finally:
            kernel.CloseHandle(handle)
    with (OUT/'fairness-modes-performance-final.log').open('wb') as log:
        worker=subprocess.Popen([str(Path(sys.executable).with_name('python.exe')),'-m','pytest',
            'backend/tests/test_extra_duty.py::test_full_month_plans_quickly',
            'backend/tests/test_extra_duty.py::test_full_month_all_units_plans_quickly',
            '-q','--tb=short',f'--junitxml={OUT/"fairness-modes-performance-final.xml"}'],
            cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
        data.update(status='running',worker_pid=worker.pid)
        status.write_text(json.dumps(data,indent=2),encoding='utf-8')
        code=worker.wait()
    data.update(status='finished',exit_code=code,finished_at=datetime.now(timezone.utc).isoformat())
    status.write_text(json.dumps(data,indent=2),encoding='utf-8')


if __name__=='__main__':
    main()
