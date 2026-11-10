import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Fresh applied verification. Root coordinates execution. Every mutation is fulfilled locally;
// remaining reads go only to the explicitly selected RAM fixture on port 8031.
const sha=x=>createHash('sha256').update(x).digest('hex');
const sourcePaths=['main','leave-approval','member-workspace','services/api'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>['frontend/src/'+p+'.ts',sha(await readFile('src/'+p+'.ts'))])));
const initial=await hashes();
assert.equal(initial['frontend/src/main.ts'],'15b79223710a53a9e0ccdd70373a92e568f6ee603f56e3747454ab25ac258cc0');
const candidatePath='../tmp/leave-nondelete-v1r2/main.ts',candidate=await readFile(candidatePath),candidateSha=sha(candidate);
assert.equal(candidateSha,'15b79223710a53a9e0ccdd70373a92e568f6ee603f56e3747454ab25ac258cc0');
const base='http://127.0.0.1:5197',report='../docs/premium-ui/qa-original159-leave-nondelete-v1r2-recovery-r1-integrated.json';
await assert.rejects(access(report),{code:'ENOENT'});
const served=await(await fetch(base+'/src/main.ts')).text();
const encoded=served.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
assert.ok(encoded);assert.equal(sha(Buffer.from(JSON.parse(Buffer.from(encoded[1],'base64').toString()).sourcesContent[0])),candidateSha);
const results=[];
for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const action of ['cancel','approve-month'])for(const failure of ['none','requests503']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),writes=[],reads=[],errors=[];
  let confirmed=false,failedRead=false;const parentReads=()=>Object.fromEntries(['calendar','requests','pressure'].map(k=>[k,reads.filter(r=>r.path==='/api/v1/leave/'+k).length]));
  const members=['target','other'].map((id,i)=>({id:'nondelete-person-'+id,canonical_name:i?'Dr Unrelated Selection':'Dr Target Decision',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]}));
  const original=members.map((person,i)=>({id:'nondelete-leave-'+(i?'other':'target'),person,person_id:person.id,leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',starts_on:'2026-11-05',ends_on:'2026-11-05',status:i?'approved':'requested',days:1,source:'manual',notes:null}));
  const live=()=>original.map((r,i)=>i||!confirmed?r:{...r,status:action==='cancel'?'cancelled':'approved'});
  const calendar=()=>({month:'2026-11',summary:{month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',total_requests:2,blocking_requests:2,people_on_leave:2,total_leave_days:2,busiest_day:{date:'2026-11-05',count:2},status_counts:{},type_counts:{ANNUAL_LEAVE:2},slot_counts:{FULL_DAY:2},unit_counts:{},call_level_counts:{'2ND_CALL':2}},days:{'2026-11-05':live().map(r=>({person_id:r.person.id,person_name:r.person.canonical_name,status:r.status,leave_type:r.leave_type,leave_slot:r.leave_slot,unit:null,posting_type:null,call_level:'2ND_CALL'}))}});
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','leave-nondelete-local');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;
   if(req.method()!=='GET'){
    const body=req.postDataJSON();writes.push({method:req.method(),path,body});assert.equal(req.method(),'POST');
    if(action==='cancel'){
     assert.equal(path,'/api/v1/leave/requests/nondelete-leave-target/cancel');assert.deepEqual(body,{});confirmed=true;return route.fulfill({json:live()[0]});
    }
    if(path==='/api/v1/leave/approval-preview'){
     assert.deepEqual(body,{month:'2026-11'});return route.fulfill({json:{month:'2026-11',pending_count:1,review_token:'nondelete-review-token',requests:[{id:original[0].id,person_name:members[0].canonical_name,starts_on:'2026-11-05',ends_on:'2026-11-05',status:'requested'}],affected_duties:[]}});
    }
    assert.equal(path,'/api/v1/leave/approve-month');assert.deepEqual(body,{month:'2026-11',review_token:'nondelete-review-token',acknowledge_duties:false});confirmed=true;return route.fulfill({json:{approved_count:1}});
   }
   reads.push({path,search:url.search});
   if(path==='/api/v1/admin/members')return route.fulfill({json:members});
   if(path==='/api/v1/leave/calendar')return route.fulfill({json:calendar()});
   if(path==='/api/v1/leave/requests'){
    if(confirmed&&failure==='requests503'&&!failedRead){failedRead=true;return route.fulfill({status:503,json:{detail:'Local confirmed-decision readback failure'}});}
    return route.fulfill({json:live()});
   }
   if(path==='/api/v1/leave/pressure')return route.fulfill({json:{month:'2026-11',days:[{date:'2026-11-05',total_people:2,blocking_people:2}],call_level_totals:{'2ND_CALL':2},unit_totals:{}}});
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+path+url.search,maxRetries:2})});
  });
  const scope=()=>width===320?page.locator('section.card-list[aria-label="Leave this month"]:visible'):page.locator('section[aria-labelledby="leave-list-title"]:visible');
  const observe=()=>page.evaluate(()=>({controlRetained:document.querySelector('[data-leave-calendar-view="list"]')===window.__nondeleteControl,pressureRetained:document.querySelector('.leave-pressure-details')===window.__nondeletePressure,pressureOpen:document.querySelector('.leave-pressure-details')?.open??null,listPressed:document.querySelector('[data-leave-calendar-view="list"]')?.getAttribute('aria-pressed')??null,selected:[...document.querySelectorAll('[data-admin-select="leave"]:checked')].map(e=>e.value),targetRecords:document.querySelectorAll('[data-edit-operational-record="nondelete-leave-target"]').length,loadFailure:document.body.innerText.includes('Leave could not load'),readOnlyRetry:!!document.querySelector('[data-retry-profile-parent]'),status:document.querySelector('[data-profile-parent-refresh]')?.textContent??null}));
  try{
   await page.goto(base+'/#view=leave',{waitUntil:'domcontentloaded'});
   await scope().locator('[data-admin-select="leave"][value="nondelete-leave-other"]').check();
   await page.locator('[data-leave-calendar-view="list"]').click();await page.locator('.leave-pressure-details > summary').click();
   await page.evaluate(()=>{window.__nondeleteControl=document.querySelector('[data-leave-calendar-view="list"]');window.__nondeletePressure=document.querySelector('.leave-pressure-details');});
   const initialReads=parentReads();
   if(action==='cancel'){
    const row=scope().locator(width===320?'article.leave-card':'tbody tr').filter({has:page.locator('[data-cancel-leave="nondelete-leave-target"]')});
    await row.locator('details.row-menu > summary').click();await row.locator('[data-cancel-leave="nondelete-leave-target"]').click();
   }else{
    await page.locator('[data-approve-month-leave]').click();const modal=page.locator('dialog.leave-approval-workspace');
    await modal.locator('[data-confirm]').check();await modal.locator('[data-approve]:enabled').click();await modal.waitFor({state:'detached'});
   }
   await page.waitForFunction(({action,failure})=>{
    const failed=document.body.innerText.includes('Leave could not load')||document.querySelector('[data-profile-parent-refresh]')?.textContent?.includes('could not refresh');
    if(failure==='requests503')return failed;
    const returned=document.querySelectorAll('[data-edit-operational-record="nondelete-leave-target"]').length===2;
    return failed||(returned&&(action==='cancel'?document.querySelector('[data-cancel-leave="nondelete-leave-target"]')===null:document.querySelector('[data-approve-month-leave]')?.disabled));
   },{action,failure});
   const assertRetained=async(stage)=>{const o=await observe();assert.equal(o.controlRetained,true,stage+' Day list identity');assert.equal(o.pressureRetained,true,stage+' pressure identity');assert.equal(o.pressureOpen,true,stage+' disclosure');assert.equal(o.listPressed,'true',stage+' list mode');assert.deepEqual([...new Set(o.selected)],['nondelete-leave-other'],stage+' unrelated selection');assert.equal(o.targetRecords,2,stage+' both target records');assert.equal(o.loadFailure,false,stage+' last-known view');return o;};
   const mutationPath=action==='cancel'?'/api/v1/leave/requests/nondelete-leave-target/cancel':'/api/v1/leave/approve-month';
   assert.equal(confirmed,true);assert.equal(writes.filter(w=>w.path===mutationPath).length,1);
   let failedObserved=null;
   if(failure==='requests503'){
    failedObserved=await assertRetained('failed read');assert.equal(failedObserved.readOnlyRetry,true);
    assert.match(failedObserved.status,/Changes are saved, but this view could not refresh/);
    if(action==='cancel'){
     const copies=page.locator('[data-cancel-leave="nondelete-leave-target"]');assert.equal(await copies.count(),2);
     for(const button of await copies.all()){assert.equal(await button.isDisabled(),true);assert.equal((await button.textContent())?.trim(),'Cancellation saved');assert.equal(await button.locator('.spinner').count(),0);}
    }
    for(const[k,count]of Object.entries(parentReads()))assert.equal(count,initialReads[k]+1,k+' first read attempt');
    const retry=page.locator('[data-profile-parent-refresh] [data-retry-profile-parent]');await retry.focus();await page.keyboard.press('Enter');
   }
   await page.locator('[data-profile-parent-refresh]').getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();
   assert.equal(await page.locator('dialog.leave-approval-workspace').count(),0,'Approval modal removed before successful parent-state observation');
   const observed=await assertRetained('recovered read'),expectedStatus=action==='cancel'?'Cancelled':'Approved';
   const statusCopies=await page.locator('[data-edit-operational-record="nondelete-leave-target"]').evaluateAll(nodes=>nodes.map(n=>n.closest('tr, .leave-card')?.querySelector('.ds-badge')?.textContent?.trim()));
   assert.deepEqual(statusCopies,[expectedStatus,expectedStatus],'Returned status in desktop row and mobile card');
   if(action==='cancel')assert.equal(await page.locator('[data-cancel-leave="nondelete-leave-target"]').count(),0,'Confirmed cancelled snapshot has no replay action');
   else assert.equal(await page.locator('[data-approve-month-leave]').isDisabled(),true,'Returned pending count controls approval');
   assert.equal(writes.filter(w=>w.path===mutationPath).length,1,'No accepted mutation replay after GET retry');assert.equal(writes.length,action==='cancel'?1:2,'One preview only for monthly approval');
   for(const[k,count]of Object.entries(parentReads()))assert.equal(count,initialReads[k]+(failure==='requests503'?2:1),k+' read attempts excluding initial');
   assert.deepEqual(errors,[]);results.push({engine,width,action,failure,passed:true,observed,failedObserved,statusCopies,initialReads,parentReads:parentReads(),writes,reads,errors});
  }catch(error){results.push({engine,width,action,failure,passed:false,assertion:error.message,confirmed,failedRead,observed:await observe().catch(()=>null),writes,reads,errors});}
  finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);assert.equal(sha(await readFile(candidatePath)),candidateSha);
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/leave159_nondelete_groundwork',operator:'/root when actually executed',execution_target:'applied V1r2 source',candidate_sha256:candidateSha,source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),application_changed_by_test:false,scope:'24 isolated V1r2 contexts: cancellation and monthly approval, normal and accepted-write requestsGET503 with keyboard GET-only retry, three engines at320/1280. Local writes only; remaining GETs RAM8031. Checks unrelated selection, existing Day list/pressure controls, disclosure, stale last-known records, exact read counts excluding initial, both returned status presentations, accepted cancellation controls not replayable, and one mutation only.',limits:['Author has not executed this test.','This does not prove every original159 family.','No physical-device or native assistive-technology checks.','Monthly approval uses no affected duties; existing duty acknowledgement coverage remains separate.'],results},null,2)+'\n');
assert.equal(results.length,24);assert.ok(results.every(r=>r.passed),'All retention/recovery expectations must hold to pass');
