import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const source=path.resolve('src/superadmin.ts'),before=await readFile(source,'utf8'),candidate=before;
const recoveryManifest=JSON.parse(await readFile('../tmp/reference-recovery-combined-v1/manifest.json','utf8'));
for(const [file,entry] of Object.entries(recoveryManifest))assert.equal(createHash('sha256').update(await readFile('../'+file)).digest('hex'),entry.after_sha256,'Actual applied combined source '+file);
const results=[],slot={id:'held-slot',duty_date:'2026-06-12',duty_type:'MAIN_1ST_24HR',duty_label:'Main call',unit_id:'u1',unit_name:'Unit I',call_level:'1ST_CALL',is_24hr:true,starts_at:'2026-06-12T08:00:00',ends_at:'2026-06-13T08:00:00',current:[]};
const options={slot,people:[]};
async function createPage(browser,width,base){
 const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],requests=[];
 page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 let hold=false,held=null;
 await page.route('**/__independent_sa',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="outside">Outside destination</button><main id="host"></main></body></html>'}));
 await page.route('**/api/**',async r=>{const q=r.request();requests.push({method:q.method(),path:new URL(q.url()).pathname});assert.equal(q.method(),'GET');assert.match(q.url(),/superadmin-allocation\/options/);if(hold){held=r;return;}await r.fulfill({json:options});});
 await page.goto(base+'/__independent_sa');await page.evaluate(async()=>{
  localStorage.setItem('duty_rota_auth_token','isolated-independent');window.currentRole='superadmin';window.callbackCount=0;
  const m=await import('/src/superadmin.ts');window.saModule=m;
  const checklist={month:'2026-06',rota_period:{id:'rp',status:'draft'},rule_version:{name:'Returned Rules'},summary:{open_slots:1},blockers:[{title:'Open slots',detail:'One slot remains'}],warnings:[],checks:[]};
  document.querySelector('#host').innerHTML=m.superadminSlotAction('A','superadmin',{context:'A'})+m.superadminSlotAction('B','superadmin',{context:'B'})+m.publishAnywayControl(checklist,'superadmin');
  m.installSuperadminActions({role:()=>window.currentRole,onAllocated:()=>window.callbackCount++,publishContext:()=>({month:'2026-06',checklist}),onPublished:()=>window.callbackCount++});
 });
 return{page,errors,requests,hold:()=>{hold=true;},held:()=>held};
}
const active=page=>page.evaluate(()=>({tag:document.activeElement.tagName,allocation:document.activeElement.getAttribute('data-superadmin-allocate'),publish:document.activeElement.hasAttribute('data-superadmin-publish-anyway'),id:document.activeElement.id}));
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280]){
  const state=await createPage(browser,width,'http://127.0.0.1:5197'),{page,requests,errors}=state;
  try{
   const outcome={engine,width};
   const open=async(selector,input='mouse')=>{const hook=page.locator(selector);if(input==='keyboard'){await hook.focus();await page.keyboard.press('Enter');}else await hook.click();await page.locator('dialog[open]').waitFor();return hook;};
   await open('[data-superadmin-allocate="A"]');await page.locator('[data-sa-search]').waitFor();await page.locator('dialog[open] [data-close]').first().click();await page.locator('dialog').waitFor({state:'detached'});outcome.allocationPointerFocus=await active(page);assert.equal(outcome.allocationPointerFocus.allocation,'A');
   await open('[data-superadmin-allocate="B"]','keyboard');await page.locator('[data-sa-search]').waitFor();await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});outcome.latestKeyboardOpener=await active(page);assert.equal(outcome.latestKeyboardOpener.allocation,'B');
   await open('[data-superadmin-publish-anyway]');await page.locator('[data-sa-reason]').waitFor();await page.locator('dialog[open] [data-close]').first().click();await page.locator('dialog').waitFor({state:'detached'});outcome.publishPointerFocus=await active(page);assert.equal(outcome.publishPointerFocus.publish,true);
   await open('[data-superadmin-publish-anyway]','keyboard');await page.locator('[data-sa-reason]').waitFor();await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});assert.equal((await active(page)).publish,true);outcome.publishKeyboardFocus=true;
   await open('[data-superadmin-allocate="A"]');await page.locator('[data-sa-search]').waitFor();await page.evaluate(()=>{document.querySelector('dialog').close();document.querySelector('#outside').focus();});await page.locator('dialog').waitFor({state:'detached'});assert.equal((await active(page)).id,'outside');outcome.newerQueuedCloseDestinationPreserved=true;
   await open('[data-superadmin-allocate="B"]');await page.locator('[data-sa-search]').waitFor();await page.evaluate(()=>{document.querySelector('[data-superadmin-allocate="B"]').remove();document.querySelector('dialog').close();document.querySelector('#outside').focus();});await page.locator('dialog').waitFor({state:'detached'});assert.equal((await active(page)).id,'outside');outcome.disconnectedOpenerDoesNotStealFocus=true;
   const count=requests.length;
   await page.evaluate(()=>{window.currentRole='board';document.querySelector('#outside').focus();document.querySelector('[data-superadmin-allocate="A"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));});assert.equal(await page.locator('dialog').count(),0);assert.equal((await active(page)).id,'outside');assert.equal(requests.length,count);
   await page.evaluate(()=>{window.currentRole='superadmin';const hook=document.querySelector('[data-superadmin-allocate="A"]');hook.disabled=true;hook.dispatchEvent(new MouseEvent('click',{bubbles:true}));});assert.equal(await page.locator('dialog').count(),0);assert.equal((await active(page)).id,'outside');assert.equal(requests.length,count);outcome.deniedAndDisabledSkipFocusAndLaunch=true;
   await page.evaluate(()=>document.querySelector('[data-superadmin-allocate="A"]').disabled=false);state.hold();await open('[data-superadmin-allocate="A"]');await page.waitForFunction(()=>!!document.querySelector('dialog[open]'));
   for(let i=0;!state.held()&&i<100;i++)await page.waitForTimeout(10);assert.ok(state.held(),'Read held before close');await page.locator('dialog[open] [data-close]').first().click();await page.locator('dialog').waitFor({state:'detached'});await page.locator('#outside').focus();try{await state.held().fulfill({json:options});}catch(error){outcome.heldRequestAbort=String(error.message);}
   await page.waitForTimeout(80);assert.equal(await page.locator('dialog').count(),0);assert.equal((await active(page)).id,'outside');assert.equal(await page.evaluate(()=>window.callbackCount),0);outcome.heldReadCloseNoLateReopenOrFocusSteal=true;
   assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'));
   results.push({...outcome,requests,errors});console.log(engine+' '+width+' independent opener/lifecycle/gates passed');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile(source)),sha(Buffer.from(before)));
await writeFile('../docs/premium-ui/qa-recovery-combined-superadmin-integrated.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/combined_recovery_test_preparation; rerun of independent specialist assertions',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:{'frontend/src/superadmin.ts':sha(Buffer.from(before))},current_source_manifest_asserted:true,scope:'Applied-source rerun of six specialist-authored engine/width contexts; no new independent endorsement: with allocation/publish mouse/keyboard,latestB opener,queued-close deliberate outside destination,disconnected opener,denied/disabled gates,held options read close/no late reopen or focus steal; historical baseline comparisons are excluded from this current-source rerun. All GETs fully local fulfilled,zero mutation/callback. Not whole37,backend authorization,real persistence or allsuperadmin mutation/recovery scope.',results},null,2)+'\n');console.log('Applied superadmin opener check:6current contexts, no baseline replay passed');

