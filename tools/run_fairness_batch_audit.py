"""Resume unfinished modules in one pytest process, retaining streaming receipts."""
import ctypes
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/allocation-progress'


def now():
    return datetime.now(timezone.utc).isoformat()


def source():
    return {str(p.relative_to(ROOT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (ROOT/'backend/app').rglob('*.py')}


def main():
    receipt=OUT/'fairness-modes-system-resumed.xml'
    events=OUT/'fairness-modes-system-events.jsonl'
    status=OUT/'fairness-modes-system-batch.json'
    if events.exists() or receipt.exists() or status.exists():
        raise RuntimeError('Preserve previous batch evidence')
    previous=json.loads((OUT/'fairness-system/status.json').read_text(encoding='utf-8'))
    completed={r['file'] for r in previous['files'] if r['exit_code']==0}
    # Finish the already-running module before starting another test process.
    pid=int(sys.argv[1])
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenProcess.restype=ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes=[ctypes.c_void_p,ctypes.c_ulong]
    kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    handle=kernel.OpenProcess(0x100000,False,pid)
    if handle:
        try:
            while kernel.WaitForSingleObject(handle,1000)==258:
                status.write_text(json.dumps({'status':'waiting_for_existing_module',
                    'previous_worker':pid,'updated_at':now()},indent=2),encoding='utf-8')
        finally:
            kernel.CloseHandle(handle)
    current=previous.get('current')
    old_receipt=OUT/'fairness-system'/Path(current).with_suffix('.xml').name if current else None
    if old_receipt and old_receipt.exists():
        suite=ET.parse(old_receipt).getroot().find('testsuite')
        if int(suite.get('failures','0'))+int(suite.get('errors','0'))==0:
            completed.add(current)
    files=[p for p in sorted((ROOT/'backend/tests').glob('test_*.py')) if p.name not in completed]
    data={'status':'running','started_at':now(),'completed_prior_modules':sorted(completed),
          'files':[p.name for p in files],'source_sha256':source()}
    env={**os.environ,'PYTHONPATH':str(ROOT/'tools')+os.pathsep+os.environ.get('PYTHONPATH',''),
         'DUTY_FAIRNESS_AUDIT_EVENTS':str(events)}
    python=str(Path(sys.executable).with_name('python.exe'))
    with (OUT/'fairness-modes-system-resumed.log').open('wb') as log:
        child=subprocess.Popen([python,'-m','pytest','-p','fairness_audit_pytest_plugin',
            *map(str,files),'-q','--tb=short',f'--junitxml={receipt}'],
            cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
        data['worker_pid']=child.pid
        status.write_text(json.dumps(data,indent=2),encoding='utf-8')
        code=child.wait()
    data.update(status='finished',exit_code=code,finished_at=now(),source_unchanged=data['source_sha256']==source())
    status.write_text(json.dumps(data,indent=2),encoding='utf-8')


if __name__=='__main__':
    main()
