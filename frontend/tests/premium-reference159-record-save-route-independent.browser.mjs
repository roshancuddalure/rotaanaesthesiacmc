import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['src/main.ts','src/record-workspace.ts','src/operational-import.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
const unit={id:'late-record-unit',name:'Late record unit',campus:'Main',code:'LR',minimum_free_people:1,active_status:'active',notes:null};
const person={id:'late-record-person',canonical_name:'Late record person',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]};
const refs={posting_type:'2ND_CALL',leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',leave_status:'requested'};
const results=[];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280])for(const kind of ['units','leave'])for(const scenario of ['same-view','navigate-guide']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],requests=[];let started,release,finished,reads=0;
  const pending=new Promise(r=>started=r),saved=new Promise(r=>finished=r);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','late-record');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url());requests.push({method:q.method(),path:u.pathname});
   if(q.method()==='POST'&&u.pathname===`/api/v1/normalization/records/${kind}/preview`){const values=q.postDataJSON().values;return route.fulfill({json:{review_token:'local-record-token',after:values,before:null,availability:'Returned context',duties:[]}});}
   if(q.method()==='POST'&&u.pathname===`/api/v1/normalization/records/${kind}/save`){assert.equal(q.postDataJSON().review_token,'local-record-token');started();await new Promise(r=>release=r);await route.fulfill({json:{saved:true}});finished();return;}
   assert.equal(q.method(),'GET','Only local preview/save allowed');
   if(u.pathname==='/api/v1/admin/members')return route.fulfill({json:[person]});
   if(u.pathname==='/api/v1/normalization/units')return route.fulfill({json:[unit]});
   if(u.pathname.startsWith('/api/v1/normalization/catalog/')){const key=u.pathname.split('/').at(-1);return route.fulfill({json:[{key:refs[key],label:refs[key],active:true}]});}
   if(u.pathname==='/api/v1/unit-management/month'){reads++;return route.fulfill({json:{month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units:[unit],assignments:[],unit_summaries:[{unit_id:unit.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[],validation_issues:[]}});}
   if(u.pathname.includes('/leave/'))reads++;
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search})});
  });
  try{
   await page.goto('http://127.0.0.1:5197/#view='+kind);
   const opener=page.locator(`[data-add-operational-record=${kind}]`).first();await opener.waitFor();await opener.click();
   const dialog=page.locator('dialog.record-workspace');await dialog.locator('[name=person_id]').selectOption(person.id);
   if(kind==='units')await dialog.locator('[name=unit_id]').selectOption(unit.id);
   await dialog.locator('[name=starts_on]').fill('2026-10-03');await dialog.locator('[name=ends_on]').fill('2026-10-05');await dialog.locator('[name=notes]').fill('Late record save');
   await dialog.getByRole('button',{name:'Review changes',exact:true}).click();await dialog.locator('[data-save]:not([disabled])').waitFor();await dialog.locator('[data-save]').click();await pending;
   if(scenario==='navigate-guide'){await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();}
   const beforeReads=reads;release();await saved;await dialog.waitFor({state:'detached'});await page.evaluate(()=>new Promise(r=>setTimeout(r,100)));
   if(scenario==='same-view')await page.locator(kind==='units'?'input[data-unit-board-search]':'[data-add-operational-record=leave]').first().waitFor();
   const outcome={hash:await page.evaluate(()=>location.hash),title:await page.locator('#section-title').allTextContents(),guide:await page.locator('#guide-checklist').count(),unitBoard:await page.locator('input[data-unit-board-search]').count(),leaveControls:await page.locator('[data-add-operational-record=leave]').count(),readsBefore:beforeReads,readsAfter:reads};
   if(scenario==='navigate-guide'){assert.equal(outcome.hash,'#view=user-guide');assert.equal(outcome.guide,0,'Diagnostic expects confirmed current late repaint');assert.deepEqual(outcome.title,[kind==='units'?'Monthly unit postings':'Leave calendar and availability']);}
   else assert.ok(reads>beforeReads,'Same-view confirmed callback refreshes');
   assert.deepEqual(errors,[]);results.push({engine,width,kind,scenario,outcome,requests,errors,lateRepaintObserved:scenario==='navigate-guide'});console.log(engine+' '+width+' '+kind+' '+scenario+' diagnostic recorded');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-reference159-record-save-route-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/dependent159_remaining_callback_audit',scope:'Read-only diagnostic of actual main normalized Addposting/Addleave save callback.24states:3engines320/1280×units/leave×sameview/guide navigation during held local save. Only preview/save POSTs locallyfulfilled; other mutations rejected and GETlocalRAM. Test asserts observed defect,not accepted behavior. No product changes.',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,results},null,2)+'\n');
console.log('Record callback diagnostic:24states recorded');
