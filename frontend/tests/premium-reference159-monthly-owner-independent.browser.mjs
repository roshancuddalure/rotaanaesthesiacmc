import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const sources=['src/main.ts','src/leave-approval.ts','src/member-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes(),results=[];
const row={id:'approval-late-row',person_id:'approval-late-person',person_name:'Approval Late Person',person:{id:'approval-late-person',canonical_name:'Approval Late Person',call_level:'2ND_CALL',active_status:'active',designations:[]},starts_on:'2026-10-12',ends_on:'2026-10-13',leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',status:'requested',notes:null,source:'manual',days:2,raw_person_name:null};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const scenario of['same-view','navigate-guide','away-back','account-reset','newer-month']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],requests=[];let reads=0,applies=0,release,started,finished;
  const pending=new Promise(r=>started=r),done=new Promise(r=>finished=r);
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','monthly-late-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url());requests.push({method:q.method(),path:u.pathname});
   if(q.method()==='POST'&&u.pathname==='/api/v1/leave/approval-preview'){assert.deepEqual(q.postDataJSON(),{month:'2026-10'});return route.fulfill({json:{month:'2026-10',pending_count:1,review_token:'held-monthly-token',requests:[row],affected_duties:[]}});}
   if(q.method()==='POST'&&u.pathname==='/api/v1/leave/approve-month'){applies++;assert.deepEqual(q.postDataJSON(),{month:'2026-10',review_token:'held-monthly-token',acknowledge_duties:false});started();await new Promise(r=>release=r);await route.fulfill({json:{approved_count:1}});finished();return;}
   assert.equal(q.method(),'GET','All operational mutations must be locally fulfilled');
   if(u.pathname==='/api/v1/leave/requests'){reads++;return route.fulfill({json:[{...row,status:applies?'approved':'requested'}]});}
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto('http://127.0.0.1:5256/#view=leave');const button=page.locator('[data-approve-month-leave]');await button.waitFor();await button.click();
   const dialog=page.locator('dialog.leave-approval-workspace');await dialog.locator('[data-confirm]').check();await dialog.locator('[data-approve]').click();await pending;
   if(scenario==='navigate-guide'||scenario==='away-back'){await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();if(scenario==='away-back'){await page.evaluate(()=>location.hash='#view=leave');await page.locator('[data-add-operational-record=leave]').first().waitFor();}}
   if(scenario==='account-reset'){await page.evaluate(()=>{localStorage.removeItem('duty_rota_auth_token');window.dispatchEvent(new StorageEvent('storage',{key:'duty_rota_auth_token',oldValue:'monthly-late-fixture',newValue:null,storageArea:localStorage}));});await dialog.waitFor({state:'detached'});}
   if(scenario==='newer-month'){const prior=reads;await page.evaluate(()=>{const input=document.querySelector('#working-month');input.value='2026-11';input.dispatchEvent(new Event('change',{bubbles:true}));});for(let i=0;reads===prior&&i<100;i++)await new Promise(r=>setTimeout(r,20));assert.ok(reads>prior);await page.locator('[data-add-operational-record=leave]').first().waitFor();}
   const before=reads;release();await done;await dialog.waitFor({state:'detached'});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   if(scenario==='same-view'){await page.locator('[data-add-operational-record=leave]').first().waitFor();for(let i=0;reads===before&&i<100;i++)await new Promise(r=>setTimeout(r,20));assert.ok(reads>before);await page.getByText('1 leave request approved for October 2026',{exact:true}).waitFor();}
   else assert.equal(reads,before,'Late callback starts no new dependent read');
   const outcome={hash:await page.evaluate(()=>location.hash),guide:await page.locator('#guide-checklist').count(),title:await page.locator('#section-title').allTextContents(),readsBefore:before,readsAfter:reads};
   if(scenario==='navigate-guide'){assert.equal(outcome.hash,'#view=user-guide');assert.equal(outcome.guide,1);assert.deepEqual(outcome.title,['End-to-end rota website guide']);}
   if(scenario==='away-back')assert.equal(outcome.hash,'#view=leave');
   if(scenario==='account-reset')assert.deepEqual(outcome.title,[]);
   if(scenario==='newer-month')assert.equal(await page.locator('#working-month').inputValue(),'2026-11');
   if(scenario!=='same-view')assert.equal(await page.getByText('1 leave request approved for October 2026',{exact:true}).count(),0,'Stale success toast suppressed');
   assert.equal(applies,1);assert.deepEqual(errors,[]);results.push({engine,width,scenario,outcome,applies,requests,errors,staleParentSuppressed:scenario!=='same-view'});console.log(engine+' '+width+' '+scenario+' monthly diagnostic');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-reference159-monthly-owner-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/monthly159_independent_review',scope:'Independent operator rerun of specialist-authored assertions; monthly-owner30states:3engines320/1280 sameview,Guide,awayback,accountreset andprogrammaticnewmonth duringheldlocalapproval. Confirmedcurrent toast/refresh retained;stale callback doesnottoast/repaint. AllPOSTlocallyfulfilled,GETfixtureonly;noapplicationchanges; candidate review only, not appliedsource or whole159 acceptance.',source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Independent monthly owner:30states passed');
