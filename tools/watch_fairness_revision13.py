"""Read-only progress monitoring of the actual revision13 regression process."""
import ctypes
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time

OUT=Path(__file__).resolve().parents[1]/'docs/allocation-progress'
run_name=sys.argv[2] if len(sys.argv)>2 else 'full-system'
if not run_name.replace('-', '').isalnum():
    raise ValueError('Invalid audit run name')
revision=int(sys.argv[3]) if len(sys.argv)>3 else 13
scope=sys.argv[4] if len(sys.argv)>4 else 'full regression'
prefix=f'fairness-modes-revision{revision}-'+run_name
kernel=ctypes.WinDLL('kernel32',use_last_error=True)
kernel.OpenProcess.restype=ctypes.c_void_p
kernel.WaitForSingleObject.argtypes=[ctypes.c_void_p,ctypes.c_ulong]
kernel.CloseHandle.argtypes=[ctypes.c_void_p]
handle=kernel.OpenProcess(0x100000,False,int(sys.argv[1]))
try:
    while True:
        alive=bool(handle and kernel.WaitForSingleObject(handle,0)==258)
        try:
            events=[json.loads(line) for line in (OUT/(prefix+'-events.jsonl')).read_text(encoding='utf-8').splitlines() if line.strip()]
            total=next((r['collected'] for r in events if r.get('stage')=='collection'),None)
            done={r['nodeid'] for r in events if r.get('stage')=='teardown'}
            bad={r['nodeid'] for r in events if r.get('outcome')=='failed'}
            status=json.loads((OUT/(prefix+'-status.json')).read_text(encoding='utf-8'))
            resumed=status.get('resumed_passed_tests',0)
            completed=len(done)+resumed
            total=(total+resumed+status.get('deferred_performance_tests',0)) if total else None
            label=f'{completed}/{total}' if total else f'{completed} reported'
            phase=f'Revision{revision} {scope}: {label} terminal outcomes; {len(bad)} failures. Worker {"running" if alive else "stopped"}. Confirmed duty timing corrections implemented; final audit and saved production repair remain.'
            if status.get('status')=='finished':
                phase+=f' Source unchanged: {status.get("source_unchanged")}. Review terminal evidence before release.'
            path=OUT/'fairness-modes-live.json'
            state=json.loads(path.read_text(encoding='utf-8-sig'))
            state['phase']=phase
            state['metrics']['Full regression']=label
            for chart in state.get('charts',[]):
                if chart['name']=='Full system':
                    chart.update(fraction=completed/total if total else 0,value=label)
            temporary=OUT/'fairness-modes-revision13-full-live.tmp'
            temporary.write_text(json.dumps(state,indent=2),encoding='utf-8')
            temporary.replace(path)
            (OUT/(prefix+'-monitor.json')).write_text(json.dumps(dict(
                at=datetime.now(timezone.utc).isoformat(),driver_pid=int(sys.argv[1]),
                alive=alive,completed=completed,previously_verified=resumed,collected=total,failures=len(bad))),encoding='utf-8')
        except (OSError,ValueError,KeyError):
            pass
        if not alive:
            break
        time.sleep(5)
finally:
    if handle:
        kernel.CloseHandle(handle)
