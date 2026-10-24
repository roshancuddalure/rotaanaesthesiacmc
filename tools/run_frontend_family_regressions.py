"""Bounded existing-suite wave; immutable source snapshot, isolated mock/disposable API."""
import concurrent.futures, datetime, hashlib, json, os, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
FRONTEND=ROOT/'frontend'
OUT=ROOT/'tmp/frontend-family-wave'
OUT.mkdir(parents=True,exist_ok=True)
SUITES={
 'members':'member-workspace.browser.mjs',
 'normalization':'normalization.browser.mjs',
 'rules':'rota-rules.browser.mjs',
 'extra-duty':'extra-duty.browser.mjs',
 'compute':'premium-compute-focus.browser.mjs',
 'leave':'premium-monthly-leave-review.browser.mjs',
 'generation':'premium-generation-actions.browser.mjs',
 'import':'import-review.browser.mjs',
 'navigation':'premium-role-navigation.browser.mjs',
 'recycle':'recycle-bin.browser.mjs',
}
def snapshot():
 paths=[p for directory in ['src','public'] for p in (FRONTEND/directory).rglob('*') if p.is_file()]
 paths += [FRONTEND/'index.html',FRONTEND/'package.json',FRONTEND/'package-lock.json']
 return {p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}
before=snapshot()
env=os.environ.copy()
env.update(MEMBER_TEST_URL='http://127.0.0.1:5197',UX_AUDIT_API='http://127.0.0.1:8031')
def run(pair):
 family,test=pair;started=time.monotonic();log=OUT/(family+'.log');code=None;timedout=False
 print('START '+family,flush=True)
 with log.open('w',encoding='utf8')as output:
  child=subprocess.Popen(['node','tests/'+test],cwd=FRONTEND,env=env,stdout=output,stderr=subprocess.STDOUT)
  try:code=child.wait(timeout=240)
  except subprocess.TimeoutExpired:
   timedout=True;child.kill();code=child.wait()
 result={'family':family,'test':'frontend/tests/'+test,'test_sha256':hashlib.sha256((FRONTEND/'tests'/test).read_bytes()).hexdigest(),'exit_code':code,'timed_out':timedout,'seconds':round(time.monotonic()-started,2),'log':log.relative_to(ROOT).as_posix()}
 print('END '+family+' '+str(code),flush=True)
 return result
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:results=list(pool.map(run,SUITES.items()))
after=snapshot()
report={'recorded_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Ten existing frontend workflow-family suites; two suites concurrently. Mutation paths use suites own interceptions, companion fixture reads only8031. This wave is not original/current backend equivalence or whole260acceptance.','source_sha256':before,'source_hashes_after':after,'source_inputs_held':before==after,'results':results,'all_suites_passed':all(r['exit_code']==0 for r in results)}
path=ROOT/'docs/premium-ui/qa-family-regressions-current.json'
path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
print(json.dumps({'source_inputs_held':before==after,'passed':sum(r['exit_code']==0 for r in results),'failed':sum(r['exit_code']!=0 for r in results)}),flush=True)
raise SystemExit(0 if before==after and report['all_suites_passed']else 1)
