// Full-app publishing on real API services + identical disposable RAM seeds.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const api='http://127.0.0.1:8032',out=resolve('../docs/premium-ui/equivalence-publish');
const baseline=resolve('../tmp/premium-ui-baseline-20261021T130359Z');
const sha=data=>createHash('sha256').update(data).digest('hex');
async function hashes(root,directory='src'){
 const rows={};for(const item of await readdir(join(root,directory),{withFileTypes:true})){
  if(item.name==='__pycache__')continue;const file=directory+'/'+item.name;
  if(item.isDirectory())Object.assign(rows,await hashes(root,file));else rows[file]=sha(await readFile(join(root,file)));
 }return rows;
}
const initialHashes=await hashes(resolve('.')),baselineHashes=await hashes(join(baseline,'frontend')),backendHashes=await hashes(resolve('../backend'),'app');
const manifest=JSON.parse(await readFile(join(baseline,'manifest.json'),'utf8'));
for(const [path,digest]of Object.entries(baselineHashes))assert.equal(digest,manifest.files['frontend/'+path],path);
const get=async(path,init)=>{const response=await fetch(api+path,init);assert.ok(response.ok,path);return response.json();};
function semantic(state){
 const value=structuredClone(state);delete value.approval_instants;
 if(value.checklist.latest_publish){delete value.checklist.latest_publish.id;delete value.checklist.latest_publish.created_at;}
 return value;
}
const quick=process.env.EQUIVALENCE_QUICK==='1',results=[];
await mkdir(out,{recursive:true});
for(const [engine,launcher]of Object.entries(quick?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of quick?[1280]:[320,1280])for(const variant of ['ready','warnings','blocked','viewer']){
  const runs=[];
  for(const [label,origin]of [['baseline','http://127.0.0.1:5201'],['current','http://127.0.0.1:5202']]){
   assert.equal((await get('/__equivalence/publish/reset?variant='+variant,{method:'POST'})).restored,true);
   const initial=await get('/__equivalence/publish/state');assert.equal(initial.approvals.length,0);
   const rotaBefore=await get('/__equivalence/state');
   const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[],confirmations=[];
   page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(error.message));
   let permit=false;page.on('dialog',dialog=>{confirmations.push(dialog.message());return permit?dialog.accept():dialog.dismiss();});
   await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','disposable-publish');localStorage.setItem('duty_rota_working_month','2026-05');});
   const runDir=join(out,`${engine}-${width}-${variant}-${label}`);await mkdir(runDir,{recursive:true});
   try{
    await page.goto(origin+'/');
    const nav=page.locator('[data-view="rota-publish"]').first();await nav.waitFor({state:'attached'});
    if(width<=768){await page.locator('#sidebar-toggle').focus();await page.keyboard.press('Enter');}
    await nav.focus();await page.keyboard.press('Enter');
    const form=page.locator('#rota-publish-form');await form.waitFor();await page.waitForLoadState('networkidle');
    const submit=form.locator('button[type=submit]'),note=form.locator('#publish-approval-note'),warning=form.locator('#publish-confirm-warnings');
    assert.equal(await page.locator('#download-rota-export').isDisabled(),true);
    assert.deepEqual(await get('/__equivalence/publish/state'),initial,'Opening publication leaves state unchanged');
    if(variant==='blocked'||variant==='viewer'){
     assert.equal(await submit.isDisabled(),true);
     if(variant==='viewer'){
      assert.equal(await note.isDisabled(),true);
      // Explicit bypass probe tests existing API authority as well as disabled frontend.
      const status=await page.evaluate(async()=>{const response=await fetch('/api/v1/rota-publish/publish?month=2026-05',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approval_note:'Unauthorized synthetic probe',confirm_warnings:true})});return response.status;});
      assert.equal(status,403);
     }else assert.equal(initial.checklist.can_publish,false);
     assert.deepEqual(await get('/__equivalence/publish/state'),initial,'Blocked publication creates no approval');
    }else{
     assert.equal(await submit.isEnabled(),true);
     await submit.focus();await page.keyboard.press('Enter');
     assert.equal((await get('/__equivalence/requests')).length,0,'Blank note sends no mutation');
     assert.equal(confirmations.length,0,'Blank note does not open confirmation');
     if(label==='current')assert.equal(await note.evaluate(element=>element===document.activeElement),true);
     await note.fill('Synthetic board reviewed May 2026.');
     const refused=page.waitForEvent('dialog');await submit.focus();await page.keyboard.press('Enter');await refused;
     await page.waitForLoadState('networkidle');
     assert.equal((await get('/__equivalence/requests')).length,0,'Refusal sends no publication');
     assert.deepEqual(await get('/__equivalence/publish/state'),initial);
     if(label==='current')assert.match(confirmations[0],/May 2026/);
     permit=true;
     if(variant==='warnings'){
      assert.equal(initial.checklist.requires_warning_confirmation,true);assert.equal(await warning.isChecked(),false);
      const rejected=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/rota-publish/publish'&&response.request().method()==='POST');
      await submit.focus();await page.keyboard.press('Enter');assert.equal((await rejected).status(),409);
      await page.waitForLoadState('networkidle');
      assert.deepEqual(await get('/__equivalence/publish/state'),initial,'Unconfirmed warnings rejected without approval');
      assert.equal(await note.inputValue(),'Synthetic board reviewed May 2026.');
      await warning.check();
     }
     const accepted=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/rota-publish/publish'&&response.request().method()==='POST');
     await submit.focus();await page.keyboard.press('Enter');assert.equal((await accepted).status(),200);
     const downloadButton=page.locator('#download-rota-export');await downloadButton.waitFor();
     await page.waitForFunction(()=>!document.querySelector('#download-rota-export')?.disabled);
     const saved=await get('/__equivalence/publish/state');
     assert.equal(saved.approvals.length,1);assert.equal(saved.approvals[0].approval_note,'Synthetic board reviewed May 2026.');
     assert.equal(saved.approvals[0].confirmed_warnings,true);assert.equal(saved.checklist.rota_period.status,'published');
     const downloadReady=page.waitForEvent('download');await downloadButton.focus();await page.keyboard.press('Enter');
     const download=await downloadReady;assert.equal(download.suggestedFilename(),'final-rota-2026-05.xlsx');
     await download.saveAs(join(runDir,'final-rota.xlsx'));
    }
    await page.waitForLoadState('networkidle');assert.deepEqual(errors,[]);
    const state=await get('/__equivalence/publish/state'),requests=await get('/__equivalence/requests');
    const rotaAfter=await get('/__equivalence/state');
    assert.deepEqual(rotaAfter,rotaBefore,'Publication, rejected attempts and workbook download preserve all saved duty/assignment fields');
    assert.equal(requests.length,variant==='ready'?1:variant==='warnings'?2:variant==='viewer'?1:0);
    assert.ok(requests.every(request=>request.path==='/api/v1/rota-publish/publish'&&request.query==='month=2026-05'));
    const run={label,initial:semantic(initial),saved:semantic(state),rota_before:rotaBefore,rota_after:rotaAfter,approval_instants:state.approval_instants,requests,errors,confirmations};runs.push(run);
    await writeFile(join(runDir,'report.json'),JSON.stringify(run,null,2)+'\n');
   }catch(error){console.error(JSON.stringify({engine,width,variant,label,errors,text:(await page.locator('body').innerText()).slice(-5000)}));await page.screenshot({path:join(runDir,'failure.png')}).catch(()=>{});throw error;}
   finally{await context.close();}
  }
  for(const field of ['initial','saved','rota_before','rota_after','requests','errors'])assert.deepEqual(runs[1][field],runs[0][field],`${engine}/${width}/${variant}: ${field}`);
  results.push({engine,width,variant,passed:true,runs});console.log(`${engine}/${width}/${variant}: publish authority, requests and persisted state match`);
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(resolve('.')),initialHashes,'Current source held');assert.deepEqual(await hashes(join(baseline,'frontend')),baselineHashes,'Baseline source held');
assert.deepEqual(await hashes(resolve('../backend'),'app'),backendHashes,'Backend app source held');
await writeFile(join(out,'report.json'),JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Full-app publish UI against real API/disposable RAM, same captured baseline/current source with native proxy. Board-ready, warning rejection/acknowledgement, open-slot blocker and computer-admin view-only403 probe. Exact requests/persisted approval/checklist semantics. Generated approval IDs and instants excluded from cross-run state; raw instants retained for exact one-cell workbook verification. Current month confirmation copy intentionally richer. No complete role/fixture/concurrency or whole-item certification.',whole_requirement_completion_proven:false,baseline_manifest_verified:true,backend_source_held:true,source_sha256:Object.fromEntries(Object.entries(initialHashes).map(([file,digest])=>['frontend/'+file,digest])),results},null,2)+'\n');
