import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const sources=['src/main.ts','src/admin-delete.ts','src/member-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes(),results=[];
const row={id:'approval-late-row',person_id:'approval-late-person',person_name:'Approval Late Person',person:{id:'approval-late-person',canonical_name:'Approval Late Person',call_level:'2ND_CALL',active_status:'active',designations:[]},starts_on:'2026-10-12',ends_on:'2026-10-13',leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',status:'requested',notes:null,source:'manual',days:2,raw_person_name:null};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const scenario of['same-view','navigate-guide']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],requests=[];let reads=0,applies=0,release,started,finished;
  const pending=new Promise(r=>started=r),done=new Promise(r=>finished=r);
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','monthly-late-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url());requests.push({method:q.method(),path:u.pathname});
   if(q.method()==='POST'&&u.pathname==='/api/v1/admin/delete/preview'){assert.deepEqual(q.postDataJSON(),{kind:'leave',ids:[row.id]});return route.fulfill({json:{kind:'leave',count:1,items:[{id:row.id,label:'Approval Late Person · Annual leave · 12–13 October 2026'}],blocked:[],effects:{linked_records:0},preview_token:'held-delete-token',confirm_phrase:null}});}
   if(q.method()==='POST'&&u.pathname==='/api/v1/admin/delete'){applies++;assert.deepEqual(q.postDataJSON(),{kind:'leave',ids:[row.id],preview_token:'held-delete-token'});started();await new Promise(r=>release=r);await route.fulfill({json:{batch_id:'local-deleted',deleted:1}});finished();return;}
   assert.equal(q.method(),'GET','All operational mutations must be locally fulfilled');
   if(u.pathname==='/api/v1/leave/requests'){reads++;return route.fulfill({json:applies?[]:[row]});}
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto('http://127.0.0.1:5197/#view=leave');
   await page.locator('[data-leave-calendar-view=list]').click();
   const menu=page.locator('details.row-menu').filter({has:page.locator('[data-delete-leave="'+row.id+'"]')}).filter({visible:true}).first();
   await menu.locator('summary').click();await menu.locator('[data-delete-leave]').click();
   const dialog=page.locator('dialog.admin-delete');await dialog.locator('.admin-delete__count').waitFor();await dialog.locator('[data-delete]').click();await pending;
   if(scenario==='navigate-guide'){await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();}
   const before=reads;release();await done;await dialog.waitFor({state:'detached'});await page.locator('[data-add-operational-record=leave]').first().waitFor();
   const outcome={hash:await page.evaluate(()=>location.hash),guide:await page.locator('#guide-checklist').count(),title:await page.locator('#section-title').allTextContents(),readsBefore:before,readsAfter:reads};
   assert.ok(reads>before);assert.equal(outcome.guide,0);if(scenario==='navigate-guide')assert.equal(outcome.hash,'#view=user-guide');
   assert.equal(applies,1);assert.deepEqual(errors,[]);results.push({engine,width,scenario,outcome,applies,requests,errors,lateRepaintObserved:scenario==='navigate-guide'});console.log(engine+' '+width+' '+scenario+' monthly diagnostic');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-reference159-delete-route-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/delete159_actual_parent_audit',scope:'Diagnostic actual main leave-row Delete via native admin preview with held locally fulfilled Delete POST.12states:3engines320/1280 sameviewcontrol versus actualGuidehashnavigation duringheldApply. AllPOSTlocallyfulfilled,GETfixtureonly; observes defect,not accepted behavior.',source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Delete parent159 diagnostic:12states');
