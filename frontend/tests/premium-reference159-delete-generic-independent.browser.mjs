import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['src/main.ts','src/admin-delete.ts','src/member-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes(),results=[];
const person={id:'generic-member',canonical_name:'Generic Delete Member',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]};
const unit={id:'generic-unit',name:'Generic Delete Unit',campus:'Main',code:'GEN',active_status:'active',minimum_free_people:1,notes:null};
const posting={id:'generic-posting',person,unit,posting_type:'2ND_CALL',starts_on:'2026-10-03',ends_on:'2026-10-13',notes:'Existing posting',source:'manual'};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const kind of['member','posting'])for(const scenario of['same-view','navigate-guide']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],requests=[];let release,started,finished,deletes=0,reads=0;
  const pending=new Promise(r=>started=r),done=new Promise(r=>finished=r),id=kind==='member'?person.id:posting.id,view=kind==='member'?'members':'units';
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','generic-delete-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());requests.push({method:q.method(),path:u.pathname});
   if(q.method()==='POST'&&u.pathname==='/api/v1/admin/delete/preview'){assert.deepEqual(q.postDataJSON(),{kind,ids:[id]});return route.fulfill({json:{kind,count:1,items:[{id,label:kind==='member'?person.canonical_name:person.canonical_name+' posting'}],blocked:[],effects:{linked_records:0},preview_token:'generic-delete-token',confirm_phrase:null}});}
   if(q.method()==='POST'&&u.pathname==='/api/v1/admin/delete'){assert.deepEqual(q.postDataJSON(),{kind,ids:[id],preview_token:'generic-delete-token'});deletes++;started();await new Promise(r=>release=r);await route.fulfill({json:{batch_id:'generic-deleted',deleted:1}});finished();return;}
   assert.equal(q.method(),'GET','Only locallyfulfilled delete mutations permitted');
   if(u.pathname==='/api/v1/admin/members'){if(kind==='member')reads++;return route.fulfill({json:kind==='member'&&deletes?[]:[person]});}
   if(u.pathname==='/api/v1/unit-management/month'){if(kind==='posting')reads++;return route.fulfill({json:{month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units:[unit],assignments:deletes?[]:[posting],unit_summaries:[{unit_id:unit.id,assigned_members:deletes?0:1,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[],validation_issues:[]}});}
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
  });
  try{await page.goto('http://127.0.0.1:5257/#view='+view);
   if(kind==='member'){const menu=page.locator('details.row-menu').filter({has:page.locator('[data-delete-member="'+id+'"]')}).filter({visible:true}).first();await menu.locator('summary').click();await menu.locator('[data-delete-member]').click();}
   else{await page.locator('[data-unit-board-card="unit:'+unit.id+'"] button[data-open-unit-modal]').click();await page.locator('#unit-management-modal [data-delete-unit-assignment="'+id+'"]').click();}
   const dialog=page.locator('dialog.admin-delete');await dialog.locator('.admin-delete__count').waitFor();await dialog.locator('[data-delete]').click();await pending;
   if(scenario==='navigate-guide'){await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();}
   const before=reads;release();await done;await dialog.waitFor({state:'detached'});await page.evaluate(()=>new Promise(r=>setTimeout(r,100)));
   if(scenario==='same-view'){for(let i=0;reads===before&&i<100;i++)await page.waitForTimeout(20);assert.ok(reads>before);}
   else{assert.equal(reads,before);assert.equal(await page.locator('#guide-checklist').count(),1);assert.equal(await page.evaluate(()=>location.hash),'#view=user-guide');await page.evaluate(view=>location.hash='#view='+view,view);if(kind==='posting'){await page.locator('input[data-unit-board-search]').waitFor();assert.ok(reads>before,'Explicit return must read invalidated posting data');}else await page.locator('#section-title').waitFor();}
   assert.equal(deletes,1);assert.deepEqual(errors,[]);results.push({engine,width,kind,scenario,readsBefore:before,readsAfter:reads,deletes,requests,errors,explicitPostingReturnFresh:kind==='posting'&&scenario==='navigate-guide'});console.log(engine+' '+width+' '+kind+' '+scenario+' generic delete passed');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-reference159-delete-generic-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/delete159_owner_independent_review',scope:'New independent24actualmain member and posting Delete contexts:3engines320/1280 sameview/Guide while heldlocalDelete. Native memberrowmenu and unitmodalRemove posting paths,exactpreview/deletepayload,oneDelete,staleparentread suppression and explicitpostingreturnfreshread. Allmutationslocallyfulfilled;GETfixtureonly. No app edits/backend persistence/allgenericselection claim.',source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Generic deletion independent24contexts passed');
