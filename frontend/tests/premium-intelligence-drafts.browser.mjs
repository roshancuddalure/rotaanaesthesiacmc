// Actual frontend modules; every API request is intercepted. No database mutations.
import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const trackedSources=['frontend/src/rota-intelligence.ts','frontend/src/workspace-load-state.ts','frontend/src/frontend-runtime.ts','frontend/tests/premium-intelligence-drafts.browser.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(trackedSources.map(async path=>[path,createHash('sha256').update(await readFile('../'+path)).digest('hex')])));
const source_start_sha256=await hashes();
const results=[];
const completed={id:'job-one',revision:3,status:'completed',decisions:[{slot_id:'slot-one',date:'2026-05-01',duty:'First call',action:'assigned',person_id:'person-one',person_name:'Asha',reason:'Eligible'}],proposed:1,unresolved:0,engine:'server',context_hash:'test',intelligence:{selected:0,alternatives:[{status:'feasible',uncovered:0,changed:0,elapsed_ms:1,warnings:[],objectives:[],history_window:{start:'2026-01',end:'2026-04',observed_months:[]}}]}};
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{for(const width of [320,1280]){
  const page=await browser.newPage({viewport:{width,height:844}}),calls=[],errors=[];
  let confirmAccept=false,confirms=0,holdCalendar,holdSetup,holdJobs,failTeachingRead=false;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',async d=>{assert.equal(d.type(),'confirm');confirms++;await(confirmAccept?d.accept():d.dismiss());});
  await page.route('**/__intelligence-drafts',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button>Open</button></body></html>'}));
  await page.route('**/api/**',async r=>{
   const req=r.request(),path=new URL(req.url()).pathname,method=req.method(),body=req.postData()?req.postDataJSON():null;calls.push({path,method,body});
   if(path.endsWith('/setup')){if(holdSetup)await holdSetup;return r.fulfill({json:{slots:[{id:'slot-one',date:'2026-05-01',label:'First call',assigned:[]},{id:'slot-two',date:'2026-05-02',label:'Second call',assigned:[]}],people:[{id:'person-one',name:'Asha'},{id:'person-two',name:'Ravi'}],history_lookback:6,history_months:[],rules:{},holiday_dates:[]}});}
   if(path.endsWith('/jobs')&&method==='GET'){if(holdJobs)await holdJobs;return r.fulfill({json:[completed]});}
   if(path.endsWith('/calendar')){if(holdCalendar)await holdCalendar;return r.fulfill({json:{dates:body.dates}});}
   if(path.endsWith('/examples'))return r.fulfill({json:{id:'example-one'}});
   if(path.endsWith('/teaching'))return r.fulfill(failTeachingRead?{status:503,json:{detail:'Examples read unavailable'}}:{json:[]});
   if(path.endsWith('/apply'))return r.fulfill({json:{...completed,status:'applied',result:{assigned:1,replaced:0}}});
   if(path.endsWith('/job-one')&&method==='GET')return r.fulfill({json:completed});
   throw Error(`Unexpected ${method} ${path}`);
  });
  await page.goto(base+'/__intelligence-drafts');
  const open=()=>page.evaluate(async()=>{const {openIntelligentRota}=await import('/src/rota-intelligence.ts');await openIntelligentRota('2026-05',true,()=>{});});
  const unload=()=>page.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true})));
  const tab=t=>page.locator(`[data-tab=${t}]`).click();
  const discard=async()=>{confirmAccept=true;await page.locator('[data-close]').click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));confirmAccept=false;assert.equal(await unload(),false);};
  await open();assert.equal(await unload(),false,'pristine draft does not cancel synthetic unload');
  await page.getByText('Maintain holiday dates',{exact:true}).click();await page.locator('[data-holidays]').fill('2026-05-11');
  await tab('assistant');await tab('plan');assert.equal(await page.locator('[data-holidays]').inputValue(),'2026-05-11');
  await tab('learning');await page.locator('[data-heldout]').fill('2026-03, 2026-04');await tab('plan');await tab('learning');assert.equal(await page.locator('[data-heldout]').inputValue(),'2026-03, 2026-04');
  await tab('plan');await page.getByText('Member preferences',{exact:true}).click();await page.locator('[data-pref-slot]').selectOption('slot-two');await page.locator('[data-pref-person]').selectOption('person-two');await page.locator('[data-pref-cost]').selectOption('100');await tab('assistant');await page.locator('[data-instruction]').fill('Prefer fair spacing');await tab('plan');
  assert.equal(await page.locator('[data-pref-slot]').inputValue(),'slot-two');assert.equal(await page.locator('[data-pref-person]').inputValue(),'person-two');assert.equal(await page.locator('[data-pref-cost]').inputValue(),'100');
  await tab('teaching');await page.locator('[name=note]').fill('Unsent teaching explanation');await tab('assistant');assert.equal(await page.locator('[data-instruction]').inputValue(),'Prefer fair spacing');await tab('teaching');assert.equal(await page.locator('[name=note]').inputValue(),'Unsent teaching explanation');
  assert.equal(await unload(),true,'dirty fields cancel synthetic unload');await page.locator('[data-close]').click();assert.equal(await page.locator('dialog[open]').count(),1);await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),1);assert.equal(confirms,2);assert.equal(await page.locator('[name=note]').inputValue(),'Unsent teaching explanation');
  assert.equal(calls.filter(c=>c.method!=='GET').length,0,'tab/draft/discard decline sends no mutation');await discard();
  results.push({engine,width,case:'all-tab-drafts-close-escape-and-unload',passed:true});

  await open();await page.getByText('Maintain holiday dates',{exact:true}).click();await page.locator('[data-holidays]').fill('2026-05-12, 2026-05-13');await page.locator('[data-save-calendar]').click();await page.getByText('Reviewed holiday calendar saved. Existing proposals must be regenerated.',{exact:true}).waitFor();assert.equal(await unload(),false,'confirmed calendar clears calendar dirty');assert.deepEqual(calls.filter(c=>c.path.endsWith('/calendar')).at(-1).body,{dates:['2026-05-12','2026-05-13']});
  await tab('teaching');await page.locator('[name=note]').fill('A reviewed rationale');failTeachingRead=true;await page.getByRole('button',{name:'Save teaching example',exact:true}).click();await page.getByText('Examples read unavailable',{exact:true}).waitFor();assert.equal(await unload(),false,'confirmed teaching clears only its dirty state despite failed list GET');assert.equal(await page.locator('[name=note]').inputValue(),'A reviewed rationale');assert.deepEqual(calls.filter(c=>c.path.endsWith('/examples')).at(-1).body,{slot_id:'slot-one',kind:'accept',preferred_person_id:null,reason:'burden',note:'A reviewed rationale'});failTeachingRead=false;await page.locator('[data-close]').click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  results.push({engine,width,case:'confirmed-calendar-and-teaching-clean-baselines-exact-payloads',passed:true});

  await open();await page.getByText('Maintain holiday dates',{exact:true}).click();await page.locator('[data-holidays]').fill('2026-05-14');let release;holdCalendar=new Promise(r=>release=r);await page.locator('[data-save-calendar]').click();await page.waitForFunction(()=>document.querySelector('.mw-footer')?.textContent.includes('Working.'));assert.equal(await unload(),true,'pending request guarded');await page.locator('[data-close]').click();assert.equal(await page.locator('dialog[open]').count(),1);confirmAccept=true;await page.locator('[data-close]').click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));release();holdCalendar=undefined;await page.waitForTimeout(100);assert.equal(await unload(),false,'closed listener cleaned');confirmAccept=false;
  results.push({engine,width,case:'pending-request-close-confirmation-and-late-result',passed:true});

  await open();await page.getByText('Member preferences',{exact:true}).click();await page.locator('[data-pref-person]').selectOption('person-two');await page.locator('[data-add-preference]').click();assert.equal(await unload(),true);await tab('review');await page.locator('[data-confirm]').check();await page.locator('[data-apply]').click();await page.getByText('1 assignments saved; 0 replaced. Not published.',{exact:true}).waitFor();assert.equal(await unload(),false,'confirmed apply clears submitted planning selections');assert.deepEqual(calls.filter(c=>c.path.endsWith('/apply')).at(-1).body,{revision:3});await page.locator('[data-close]').click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  results.push({engine,width,case:'confirmed-apply-clears-planning-baseline',passed:true});
  for(const stage of ['setup','jobs']){
   let release;const held=new Promise(r=>release=r);if(stage==='setup')holdSetup=held;else holdJobs=held;
   const before=calls.length;
   await page.evaluate(()=>{window.__draftOpening=import('/src/rota-intelligence.ts').then(m=>m.openIntelligentRota('2026-05',true,()=>{}));});
   await page.waitForFunction(()=>document.querySelector('dialog[open]'));
   while(!calls.slice(before).some(c=>c.path.endsWith('/'+stage)))await page.waitForTimeout(10);
   await page.evaluate(()=>document.querySelector('dialog').remove());release();await page.evaluate(()=>window.__draftOpening);holdSetup=holdJobs=undefined;
   assert.equal(calls.length-before,stage==='setup'?1:2,'removed workspace starts no follow-up requests');assert.equal(await page.locator('dialog').count(),0);assert.equal(await unload(),false);
   results.push({engine,width,case:`direct-removal-during-${stage}-read`,passed:true});
  }
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.close();
 }}finally{await browser.close();}
}
const source_end_sha256=await hashes();assert.deepEqual(source_end_sha256,source_start_sha256,'Reviewed sources stay frozen throughout run');
await writeFile('../docs/premium-ui/qa-intelligence-drafts.json',JSON.stringify({source_start_sha256,source_end_sha256,scope:'Actual source modules with intercepted requests; synthetic beforeunload tests predicate only. No native exit or physical-device claim.',passed:results.length,results},null,2)+'\n');
console.log(`${results.length} intelligent draft workflows passed`);
