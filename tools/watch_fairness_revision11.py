"""Read-only progress monitoring of the actual revision11 regression process."""
import ctypes
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time

OUT=Path(__file__).resolve().parents[1]/'docs/allocation-progress'
kernel=ctypes.WinDLL('kernel32',use_last_error=True)
kernel.OpenProcess.restype=ctypes.c_void_p
kernel.WaitForSingleObject.argtypes=[ctypes.c_void_p,ctypes.c_ulong]
kernel.CloseHandle.argtypes=[ctypes.c_void_p]
handle=kernel.OpenProcess(0x100000,False,int(sys.argv[1]))
try:
    while True:
        alive=bool(handle and kernel.WaitForSingleObject(handle,0)==258)
        try:
            events=[json.loads(line) for line in (OUT/'fairness-modes-revision11-system-events.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
            total=next((r['collected'] for r in events if r.get('stage')=='collection'),None)
            done={r['nodeid'] for r in events if r.get('stage')=='teardown'}
            bad={r['nodeid'] for r in events if r.get('outcome')=='failed'}
            status=json.loads((OUT/'fairness-modes-revision11-system-status.json').read_text(encoding='utf-8'))
            label=f'{len(done)}/{total}' if total else f'{len(done)} reported'
            phase=f'Revision11 full regression: {label} terminal outcomes; {len(bad)} failures. Worker {"running" if alive else "stopped"}. Policy/hour clarifications remain pending.'
            if status.get('status')=='finished':
                phase+=f' Source unchanged: {status.get("source_unchanged")}. Review terminal evidence before release.'
            path=OUT/'fairness-modes-live.json'
            state=json.loads(path.read_text(encoding='utf-8-sig'))
            state['phase']=phase
            state['metrics']['Full regression']=label
            for chart in state.get('charts',[]):
                if chart['name']=='Full system':
                    chart.update(fraction=len(done)/total if total else 0,value=label)
            temporary=OUT/'fairness-modes-revision11-live.tmp'
            temporary.write_text(json.dumps(state,indent=2),encoding='utf-8')
            temporary.replace(path)
            (OUT/'fairness-modes-revision11-monitor.json').write_text(json.dumps(dict(
                at=datetime.now(timezone.utc).isoformat(),driver_pid=int(sys.argv[1]),
                alive=alive,completed=len(done),collected=total,failures=len(bad))),encoding='utf-8')
        except (OSError,ValueError,KeyError):
            pass
        if not alive:
            break
        time.sleep(5)
finally:
    if handle:
        kernel.CloseHandle(handle)
