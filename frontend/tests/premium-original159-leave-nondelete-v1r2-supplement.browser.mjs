import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

// Authoring only; root owns execution. Every write is locally fulfilled.
const sha=x=>createHash('sha256').update(x).digest('hex');
const paths=['main','leave-approval','member-workspace','services/api'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/src/'+p+'.ts',sha(await readFile('src/'+p+'.ts'))])));
const initial=await hashes();
assert.equal(initial['frontend/src/main.ts'],'45743fb64260289e50526480572bf25e33d8dc1a69f83397286660a03951cfba');
assert.equal(initial['frontend/src/leave-approval.ts'],'42e5a47751ae081d1b97108209c7a2b53272985251d153aa065f7718f43e544f');
assert.equal(initial['frontend/src/member-workspace.ts'],'88774f277131a1ed83174d288d882653fc04add295b8237fefa62636e08617ea');
assert.equal(initial['frontend/src/services/api.ts'],'5167f842eb4e07cf5216d18bde2ef48ded1a6692490d80dd261e4ceb038a5e3c');
const candidatePath='../tmp/leave-nondelete-v1r2/main.ts',candidateSha=sha(await readFile(candidatePath));
assert.equal(candidateSha,'15b79223710a53a9e0ccdd70373a92e568f6ee603f56e3747454ab25ac258cc0');
const base='http://127.0.0.1:5306',report='../docs/premium-ui/qa-original159-leave-nondelete-v1r2-supplement.json';
await assert.rejects(access(report),{code:'ENOENT'});
for(const p of ['main','leave-approval']){
 const text=await(await fetch(base+'/src/'+p+'.ts')).text(),match=text.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
 assert.ok(match);assert.equal(sha(Buffer.from(JSON.parse(Buffer.from(match[1],'base64').toString()).sourcesContent[0])),p==='main'?candidateSha:initial['frontend/src/'+p+'.ts']);
}
const scenarios=['marking-fault-recovery','monthly-duty','monthly-preview-failure','monthly-apply-failure','cancel-refused','cancel-mutation-failure','mutation-route','mutation-month','mutation-account','read-route','read-month','read-account'];
const results=[],browser=await chromium.launch();
try{for(const width of [320,1280])for(const scenario of scenarios){
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),writes=[],reads=[],errors=[],routeErrors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 let confirmed=false,failedRead=false,previewCount=0,applyCount=0,mutationHeld=false,readHeld=false;
 let releaseMutation,releaseRead;
 const mutationGate=new Promise(resolve=>{releaseMutation=resolve;}),readGate=new Promise(resolve=>{releaseRead=resolve;});
 const monthly=scenario.startsWith('monthly-'),owner=scenario.startsWith('mutation-')||scenario.startsWith('read-');
 const members=['target','other'].map((id,i)=>({id:'nondelete-person-'+id,canonical_name:i?'Dr Unrelated Selection':'Dr Target Decision',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]}));
 const original=members.map((person,i)=>({id:'nondelete-leave-'+(i?'other':'target'),person,person_id:person.id,leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',starts_on:'2026-11-05',ends_on:'2026-11-05',status:i?'approved':'requested',days:1,source:'manual',notes:null}));
 const live=()=>original.map((r,i)=>i||!confirmed?r:{...r,status:monthly?'approved':'cancelled'});
 const calendar=(month='2026-11')=>({month,summary:{month,starts_on:month+'-01',ends_on:month+(month==='2026-11'?'-30':'-31'),total_requests:month==='2026-11'?2:0,blocking_requests:2,people_on_leave:2,total_leave_days:2,busiest_day:null,status_counts:{},type_counts:{ANNUAL_LEAVE:2},slot_counts:{FULL_DAY:2},unit_counts:{},call_level_counts:{'2ND_CALL':2}},days:month==='2026-11'?{'2026-11-05':live().map(r=>({person_id:r.person.id,person_name:r.person.canonical_name,status:r.status,leave_type:r.leave_type,leave_slot:r.leave_slot,unit:null,posting_type:null,call_level:'2ND_CALL'}))}:{}});
 const parentReads=()=>Object.fromEntries(['calendar','requests','pressure'].map(k=>[k,reads.filter(r=>r.path==='/api/v1/leave/'+k&&r.search==='?month=2026-11').length]));
 const settle=async()=>{await page.waitForLoadState('networkidle');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
 page.on('dialog',dialog=>scenario==='cancel-refused'?dialog.dismiss():dialog.accept());
 await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','leave-nondelete-local');localStorage.setItem('duty_rota_working_month','2026-11');});
 await page.route('**/api/**',async route=>{
  try{
   const req=route.request(),url=new URL(req.url()),path=url.pathname,month=url.searchParams.get('month')||'2026-11';
   if(req.method()!=='GET'){
    const body=req.postDataJSON();writes.push({method:req.method(),path,body});assert.equal(req.method(),'POST');
    if(path==='/api/v1/leave/approval-preview'){
     previewCount++;assert.deepEqual(body,{month:'2026-11'});
     if(scenario==='monthly-preview-failure'&&previewCount===1)return route.fulfill({status:503,json:{detail:'Local review unavailable'}});
     return route.fulfill({json:{month:'2026-11',pending_count:1,review_token:'nondelete-token-'+previewCount,requests:[{id:original[0].id,person_name:members[0].canonical_name,starts_on:'2026-11-05',ends_on:'2026-11-05',status:'requested'}],affected_duties:[{id:'nondelete-duty',person_id:members[0].id,person_name:members[0].canonical_name,date:'2026-11-05',duty:'2ND_CALL'}]}});
    }
    if(path==='/api/v1/leave/approve-month'){
     applyCount++;assert.deepEqual(body,{month:'2026-11',review_token:'nondelete-token-'+previewCount,acknowledge_duties:true});
     if(scenario==='monthly-apply-failure'&&applyCount===1)return route.fulfill({status:503,json:{detail:'Local approval not confirmed'}});
     confirmed=true;return route.fulfill({json:{approved_count:1}});
    }
    assert.equal(path,'/api/v1/leave/requests/nondelete-leave-target/cancel');assert.deepEqual(body,{});
    if(scenario==='cancel-mutation-failure')return route.fulfill({status:503,json:{detail:'Local cancellation not confirmed'}});
    confirmed=true;
    if(scenario==='marking-fault-recovery')await page.evaluate(()=>{
     const button=window.__nondeleteClicked,descriptor=Object.getOwnPropertyDescriptor(Node.prototype,'textContent');
     if(!button||!descriptor?.set||!descriptor.get)throw new Error('Actual clicked button and native textContent descriptor required');
     let thrown=false;window.__nondeleteMarkFaults=0;
     Object.defineProperty(button,'textContent',{configurable:true,get(){return descriptor.get.call(this);},set(value){if(value==='Cancellation saved'&&!thrown){thrown=true;window.__nondeleteMarkFaults++;throw new Error('Local one-shot accepted action-label fault');}descriptor.set.call(this,value);}});
    });
    if(scenario.startsWith('mutation-')){mutationHeld=true;await mutationGate;}
    return route.fulfill({json:live()[0]});
   }
   reads.push({path,search:url.search});
   if(path==='/api/v1/admin/members')return route.fulfill({json:members});
   if(path==='/api/v1/leave/calendar')return route.fulfill({json:calendar(month)});
   if(path==='/api/v1/leave/requests'){
    if(confirmed&&month==='2026-11'&&scenario==='marking-fault-recovery'&&!failedRead){failedRead=true;return route.fulfill({status:503,json:{detail:'Local accepted-action readback failure'}});}
    if(confirmed&&month==='2026-11'&&scenario.startsWith('read-')&&!readHeld){const snapshot=live();readHeld=true;await readGate;return route.fulfill({json:snapshot});}
    return route.fulfill({json:month==='2026-11'?live():[]});
   }
   if(path==='/api/v1/leave/pressure')return route.fulfill({json:{month,days:[],call_level_totals:{},unit_totals:{}}});
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+path+url.search,maxRetries:2})});
  }catch(error){routeErrors.push(error.message);await route.abort().catch(()=>{});}
 });
 const scope=()=>width===320?page.locator('section.card-list[aria-label="Leave this month"]:visible'):page.locator('section[aria-labelledby="leave-list-title"]:visible');
 const clickCancel=async()=>{const row=scope().locator(width===320?'article.leave-card':'tbody tr').filter({has:page.locator('[data-cancel-leave="nondelete-leave-target"]')});await row.locator('details.row-menu > summary').click();const button=row.locator('[data-cancel-leave="nondelete-leave-target"]');await button.evaluate(e=>{window.__nondeleteClicked=e;});await button.click();};
 const observe=()=>page.evaluate(()=>({controlRetained:document.querySelector('[data-leave-calendar-view="list"]')===window.__nondeleteControl,pressureRetained:document.querySelector('.leave-pressure-details')===window.__nondeletePressure,pressureOpen:document.querySelector('.leave-pressure-details')?.open??null,listPressed:document.querySelector('[data-leave-calendar-view="list"]')?.getAttribute('aria-pressed')??null,selected:[...document.querySelectorAll('[data-admin-select="leave"]:checked')].map(e=>e.value),targetRecords:document.querySelectorAll('[data-edit-operational-record="nondelete-leave-target"]').length,status:document.querySelector('[data-profile-parent-refresh]')?.textContent??null,markFaults:window.__nondeleteMarkFaults??0,month:document.querySelector('#working-month')?.value,hash:location.hash}));
 let initialReads,failedObserved=null;
 try{
  await page.goto(base+'/#view=leave',{waitUntil:'domcontentloaded'});
  await scope().locator('[data-admin-select="leave"][value="nondelete-leave-other"]').check();
  await page.locator('[data-leave-calendar-view="list"]').click();await page.locator('.leave-pressure-details > summary').click();
  await page.evaluate(()=>{window.__nondeleteControl=document.querySelector('[data-leave-calendar-view="list"]');window.__nondeletePressure=document.querySelector('.leave-pressure-details');});
  initialReads=parentReads();
  if(monthly){
   await page.locator('[data-approve-month-leave]').click();const modal=page.locator('dialog.leave-approval-workspace');
   if(scenario==='monthly-preview-failure'){
    await modal.getByRole('alert').filter({hasText:'Local review unavailable'}).waitFor();assert.equal(await modal.locator('[data-approve]').isDisabled(),true);assert.deepEqual(parentReads(),initialReads);assert.equal(writes.length,1);
    await modal.locator('[data-refresh]').click();
   }
   await modal.locator('[data-confirm]').check();assert.equal(await modal.locator('[data-approve]').isDisabled(),true,'Duty acknowledgement is independently required');
   await modal.locator('[data-duty-ack]').check();assert.equal(await modal.locator('[data-approve]').isEnabled(),true);
   await modal.locator('[data-approve]').click();
   if(scenario==='monthly-apply-failure'){
    await modal.getByRole('alert').filter({hasText:'Refresh the review before trying again'}).waitFor();await settle();
    assert.equal(applyCount,1,'No automatic uncertain approval replay');assert.equal(await modal.locator('[data-approve]').isDisabled(),true);assert.deepEqual(parentReads(),initialReads);assert.equal(await modal.locator('[data-confirm]').count(),0,'Failed apply discards token/acknowledgements');
    await modal.locator('[data-refresh]').click();await modal.locator('[data-confirm]').waitFor();assert.equal(await modal.locator('[data-confirm]').isChecked(),false);assert.equal(await modal.locator('[data-duty-ack]').isChecked(),false);assert.equal(await modal.locator('[data-approve]').isDisabled(),true);
    await modal.locator('[data-confirm]').check();await modal.locator('[data-duty-ack]').check();await modal.locator('[data-approve]').click();
   }
   await modal.waitFor({state:'detached'});
  }else await clickCancel();
  if(owner){
   await assert.doesNotReject(async()=>{await page.waitForFunction(()=>true);});
   // Node-side flag observes the actual intercepted boundary, not a fabricated UI event.
   for(let i=0;i<120&&!(scenario.startsWith('mutation-')?mutationHeld:readHeld);i++)await page.waitForTimeout(25);
   assert.equal(scenario.startsWith('mutation-')?mutationHeld:readHeld,true,'Expected actual delayed request boundary');
   const steering=scenario.split('-')[1];
   if(steering==='route'){await page.evaluate(()=>{location.hash='#view=user-guide';});await page.locator('#guide-checklist').waitFor();}
   else if(steering==='month'){await page.evaluate(()=>{const input=document.querySelector('#working-month');input.value='2026-12';input.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForFunction(()=>document.querySelector('#working-month')?.value==='2026-12');}
   else{await page.evaluate(()=>{localStorage.removeItem('duty_rota_auth_token');window.dispatchEvent(new StorageEvent('storage',{key:'duty_rota_auth_token',oldValue:'leave-nondelete-local',newValue:null,storageArea:localStorage}));});await page.waitForFunction(()=>!document.querySelector('#section-title'));}
   const beforeRelease=parentReads();releaseMutation();releaseRead();await settle();
   assert.deepEqual(parentReads(),beforeRelease,'Expired response cannot initiate another old-month dependent read');assert.equal(await page.locator('[data-profile-parent-refresh]').count(),0,'No stale saved notice on newer owner');
   if(steering==='route')assert.equal(await page.evaluate(()=>location.hash),'#view=user-guide');else if(steering==='month')assert.equal(await page.locator('#working-month').inputValue(),'2026-12');else assert.equal(await page.locator('#section-title').count(),0);
   assert.equal(writes.length,1);assert.equal(confirmed,true);
  }else if(scenario==='cancel-refused'||scenario==='cancel-mutation-failure'){
   if(scenario==='cancel-mutation-failure')await page.getByText('Local cancellation not confirmed',{exact:true}).waitFor();await settle();
   assert.equal(confirmed,false);assert.deepEqual(parentReads(),initialReads);assert.equal(writes.length,scenario==='cancel-refused'?0:1);assert.equal(await scope().locator('[data-cancel-leave="nondelete-leave-target"]').isEnabled(),true);assert.equal(await page.locator('[data-profile-parent-refresh]').count(),0);
  }else{
   if(scenario==='marking-fault-recovery'){
    await page.locator('[data-profile-parent-refresh]').getByText(/Changes are saved, but this view could not refresh/).waitFor();failedObserved=await observe();assert.equal(failedObserved.markFaults,1);assert.equal(failedObserved.targetRecords,2);assert.equal(failedObserved.controlRetained,true);assert.equal(failedObserved.pressureRetained,true);
    assert.equal(writes.length,1);for(const[k,count]of Object.entries(parentReads()))assert.equal(count,initialReads[k]+1,k+' first GET attempt');
    await page.locator('[data-retry-profile-parent]').focus();await page.keyboard.press('Enter');
   }
   await page.locator('[data-profile-parent-refresh]').getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();
   const observed=await observe();assert.equal(observed.controlRetained,true);assert.equal(observed.pressureRetained,true);assert.equal(observed.pressureOpen,true);assert.equal(observed.listPressed,'true');assert.deepEqual([...new Set(observed.selected)],['nondelete-leave-other']);
   const statusCopies=await page.locator('[data-edit-operational-record="nondelete-leave-target"]').evaluateAll(nodes=>nodes.map(n=>n.closest('tr, .leave-card')?.querySelector('.ds-badge')?.textContent?.trim()));assert.deepEqual(statusCopies,[monthly?'Approved':'Cancelled',monthly?'Approved':'Cancelled']);
   assert.equal(await page.locator('dialog.leave-approval-workspace').count(),0);assert.equal(confirmed,true);
   for(const[k,count]of Object.entries(parentReads()))assert.equal(count,initialReads[k]+(scenario==='marking-fault-recovery'?2:1),k+' GET attempts');
   assert.equal(writes.filter(w=>w.path==='/api/v1/leave/approve-month').length,monthly?(scenario==='monthly-apply-failure'?2:1):0);
   if(!monthly){assert.equal(writes.length,1);assert.equal(await page.locator('[data-cancel-leave="nondelete-leave-target"]').count(),0);}
   else assert.equal(previewCount,scenario==='monthly-duty'?1:2);
  }
  assert.deepEqual(routeErrors,[]);assert.deepEqual(errors,[]);results.push({engine:'chromium',width,scenario,passed:true,confirmed,failedRead,previewCount,applyCount,mutationHeld,readHeld,failedObserved,observed:await observe(),initialReads,parentReads:parentReads(),writes,reads,errors,routeErrors});
 }catch(error){results.push({engine:'chromium',width,scenario,passed:false,assertion:error.message,confirmed,failedRead,previewCount,applyCount,mutationHeld,readHeld,failedObserved,observed:await observe().catch(()=>null),initialReads,parentReads:parentReads(),writes,reads,errors,routeErrors});}
 finally{releaseMutation();releaseRead();await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
}}finally{await browser.close();}
assert.deepEqual(await hashes(),initial);assert.equal(sha(await readFile(candidatePath)),candidateSha);
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/core_v12_final_review',operator:'/root when actually executed',execution_target:'isolated V1r2 source overlay',candidate_sha256:candidateSha,source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),application_changed_by_test:false,scope:'24 Chromium contexts:320/1280 x accepted cancellation one-shot button-label fault plus GET503/keyboard read-only retry; duty acknowledgement and exact token body; preview503/manual review; approval503/fresh-token explicit retry; native refusal; cancellation503; actual delayed mutation response or in-flight parent requestsGET then route/month/account supersession. Writes locally fulfilled; remaining GETs RAM8031. No broader engine/physical/nativeAT/all159 claim.',results},null,2)+'\n');
assert.equal(results.length,24);assert.ok(results.every(r=>r.passed),'All bounded Leave nondelete supplement expectations must hold');
