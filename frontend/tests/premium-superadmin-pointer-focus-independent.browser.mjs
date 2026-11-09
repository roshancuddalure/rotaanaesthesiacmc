import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {createServer} from 'vite';
import ts from 'typescript';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const source=path.resolve('src/superadmin.ts'),before=await readFile(source,'utf8'),candidate=await readFile('../tmp/superadmin-pointer-focus-v1/superadmin.ts','utf8');
const addition='    button.focus({ preventScroll: true });\n';
assert.equal(candidate.split(addition).length,2);assert.equal(candidate.replace(addition,''),before);
const parsed=ts.getParsedCommandLineOfConfigFile(path.resolve('tsconfig.json'),{},ts.sys),host=ts.createCompilerHost(parsed.options),read=host.readFile.bind(host);
host.readFile=f=>path.resolve(f)===source?candidate:read(f);
const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames,{...parsed.options,noEmit:true},host));
assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));
const server=await createServer({root:process.cwd(),server:{host:'127.0.0.1',port:5240,strictPort:true},plugins:[{name:'independent-superadmin-pointer-candidate',enforce:'pre',load(id){if(path.resolve(id.split('?')[0])===source)return candidate;}}]});
await server.listen();
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
try{for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280]){
  // Fresh actual baseline comparison remains a diagnostic, never focus correctness acceptance.
  const baseline=await createPage(browser,width,'http://127.0.0.1:5197');
  let baselineFocus;
  try{await baseline.page.locator('[data-superadmin-allocate="A"]').click();await baseline.page.locator('[data-sa-search]').waitFor();await baseline.page.locator('dialog[open] [data-close]').first().click();await baseline.page.locator('dialog').waitFor({state:'detached'});baselineFocus=await active(baseline.page);assert.deepEqual(baseline.errors,[]);}finally{await baseline.page.close();}
  const state=await createPage(browser,width,'http://127.0.0.1:5240'),{page,requests,errors}=state;
  try{
   const outcome={engine,width,baselineAllocationPointerFocus:baselineFocus};
   const open=async(selector,input='mouse')=>{const hook=page.locator(selector);if(input==='keyboard'){await hook.focus();await page.keyboard.press('Enter');}else await hook.click();await page.locator('dialog[open]').waitFor();return hook;};
   await open('[data-superadmin-allocate="A"]');await page.locator('[data-sa-search]').waitFor();await page.locator('dialog[open] [data-close]').first().click();await page.locator('dialog').waitFor({state:'detached'});outcome.allocationPointerFocus=await active(page);assert.equal(outcome.allocationPointerFocus.allocation,'A');
   if(engine==='webkit')assert.equal(baselineFocus.tag,'BODY');else assert.equal(baselineFocus.allocation,'A');
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
assert.equal(sha(await readFile(source)),sha(Buffer.from(before)));assert.equal(sha(await readFile('../tmp/superadmin-pointer-focus-v1/superadmin.ts')),sha(Buffer.from(candidate)));
await writeFile('../docs/premium-ui/qa-superadmin-pointer-focus-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/superadmin_pointer_independent_review',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:{before:sha(Buffer.from(before)),candidate:sha(Buffer.from(candidate))},source_exact_one_line_reversal:true,typecheck_diagnostics:0,scope:'Own six engine/width contexts with allocation/publish mouse/keyboard,latestB opener,queued-close deliberate outside destination,disconnected opener,denied/disabled gates,held options read close/no late reopen or focus steal; six own baseline allocation-pointer comparisons. All GETs fully local fulfilled,zero mutation/callback. Not whole37,backend authorization,real persistence or allsuperadmin mutation/recovery scope.',results},null,2)+'\n');console.log('Independent superadmin opener review:6contexts and6baseline comparisons passed');
}finally{await server.close();}
