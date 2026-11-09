import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),base='http://127.0.0.1:5294',api='http://127.0.0.1:8031';
const sourcePaths=['src/main.ts','src/member-workspace.ts','src/record-workspace.ts','src/services/api.ts','src/extra-duty.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
assert.equal(initial['frontend/src/main.ts'],'2b8f68c069e599af50a4ac1b2146a7018d6268f290b90a9949130a057dc91b43');
assert.equal(initial['frontend/src/member-workspace.ts'],'105cc1d91ea4815d565ad4859fc01412cf576a3203c07834f4010e3fef7ef1a5');
const candidatePaths=['../tmp/profile-parent-refresh-v6/main.ts','../tmp/profile-parent-refresh-v6/member-workspace.ts'];
const candidateHashes=Object.fromEntries(await Promise.all(candidatePaths.map(async p=>[p,sha(await readFile(p))])));
assert.equal(candidateHashes[candidatePaths[0]],'6c306cf2cd619a0003ca547c0fdf73a88a1abf95939234cf0d86193624db6404');
assert.equal(candidateHashes[candidatePaths[1]],initial['frontend/src/member-workspace.ts']);
for(const [i,name]of ['main.ts','member-workspace.ts'].entries()){
 const response=await fetch(base+'/src/'+name);assert.equal(response.status,200);const text=await response.text();
 const encoded=text.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(encoded,'Inline original-source map '+name);
 const map=JSON.parse(Buffer.from(encoded[1],'base64').toString());assert.ok(map.sourcesContent.some(s=>sha(s)===candidateHashes[candidatePaths[i]]),'Exact candidate '+name);
}

const member={id:'leave-person',canonical_name:'Dr Dated Leave',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
const siblingMember={...member,id:'leave-sibling-person',canonical_name:'Dr Retained Sibling'};
const results=[];
for(const[engine,launcher]of Object.entries({chromium}))for(const width of[320])for(const scenario of['dated-add']){
 const browser=await launcher.launch(),page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),writes=[],requests=[],errors=[];
 let phase='setup';let saved=false;const counts={calendar:0,requests:0,pressure:0};const failure=scenario.endsWith('read503');
 const sibling={id:'leave-sibling',person:siblingMember,person_id:siblingMember.id,leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',starts_on:'2026-11-06',ends_on:'2026-11-06',status:'approved',days:1,source:'manual',notes:'Retained sibling leave'};
 const added=()=>({id:'leave-added',person:member,person_id:member.id,leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',starts_on:'2026-11-05',ends_on:'2026-11-05',status:'requested',days:1,source:'manual',notes:'Dated leave add NEW'});
 const calendar=()=>({month:'2026-11',summary:{month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',total_requests:saved?2:1,people_on_leave:saved?2:1,total_leave_days:saved?2:1,busiest_day:null,status_counts:saved?{approved:1,requested:1}:{approved:1},type_counts:{ANNUAL_LEAVE:saved?2:1},slot_counts:{FULL_DAY:saved?2:1},unit_counts:{},call_level_counts:{'2ND_CALL':saved?2:1}},days:{'2026-11-06':[{person_name:siblingMember.canonical_name,call_level:'2ND_CALL',unit:null,posting_type:null,status:'approved',leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY'}],...(saved?{'2026-11-05':[{person_name:member.canonical_name,call_level:'2ND_CALL',unit:null,posting_type:null,status:'requested',leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY'}]}:{})}});
 page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','direct-dated-leave-v6');localStorage.setItem('duty_rota_working_month','2026-11');});
 await page.route('**/api/**',async route=>{
  const q=route.request(),u=new URL(q.url()),p=u.pathname;requests.push({method:q.method(),path:p,search:u.search});
  if(q.method()!=='GET'){
   const body=q.postDataJSON();writes.push({method:q.method(),path:p,body});assert.equal(q.method(),'POST');assert.equal(body.identity,undefined,'Dated action is Add, not existing-record overwrite');
   for(const[k,v]of Object.entries({person_id:member.id,starts_on:'2026-11-05',ends_on:'2026-11-05',leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',status:'requested',notes:'Dated leave add NEW'}))assert.equal(body.values[k],v,k+' retains actual reviewed value');
   if(p==='/api/v1/normalization/records/leave/preview')return route.fulfill({json:{review_token:'dated-leave-token',before:null,after:body.values,availability:'Fixture pending leave review',duties:[]}});
   assert.equal(p,'/api/v1/normalization/records/leave/save');assert.equal(body.review_token,'dated-leave-token');assert.equal(saved,false);saved=true;return route.fulfill({json:added()});
  }
  if(p==='/api/v1/admin/members')return route.fulfill({json:[member,siblingMember]});
  if(p==='/api/v1/normalization/units')return route.fulfill({json:[]});
  if(p.startsWith('/api/v1/normalization/catalog/')){
   const kind=p.split('/').at(-1),keys={leave_type:['ANNUAL_LEAVE'],leave_slot:['FULL_DAY'],leave_status:['requested','approved']}[kind]??[];
   return route.fulfill({json:keys.map(key=>({key,label:key,active:true}))});
  }
  if(p==='/api/v1/leave/calendar'){counts.calendar++;return route.fulfill({json:calendar()});}
  if(p==='/api/v1/leave/requests'){
   counts.requests++;if(saved&&failure&&counts.requests===2)return route.fulfill({status:503,json:{detail:'Accepted dated leave; parent request read unavailable'}});
   return route.fulfill({json:saved?[sibling,added()]:[sibling]});
  }
  if(p==='/api/v1/leave/pressure'){counts.pressure++;return route.fulfill({json:{month:'2026-11',days:[],unit_totals:{},call_level_totals:{}}});}
  return route.fulfill({response:await route.fetch({url:api+p+u.search,maxRetries:2})});
 });
 try{
  await page.goto(base+'/#view=leave',{waitUntil:'domcontentloaded'});await page.locator('[data-leave-calendar-view="list"]').click();
  const parent=width===320?page.locator('.card-list[aria-label="Leave this month"]:visible'):page.locator('section[aria-labelledby="leave-list-title"]:visible');
  await parent.locator('[data-admin-select="leave"][value="leave-sibling"]').check();
  await page.locator('.leave-pressure-details > summary').click();
  await page.locator('[data-leave-calendar-view="list"]').evaluate(e=>{window.__retainedDaylistButton=e;window.__retainedLeaveHistory=document.querySelector('#leave-history-host');});
  const before={...counts};assert.deepEqual(before,{calendar:1,requests:1,pressure:1});
  await page.locator('#leave-day-list-view [data-leave-day="2026-11-05"]').click();
  const day=page.locator('#leave-day-modal');await day.locator('[data-add-operational-record="leave"][data-initial-date="2026-11-05"]').click();
  phase='day-add-clicked';const editor=page.getByRole('dialog',{name:'Add leave',exact:true});await editor.waitFor({timeout:2000});phase='editor-opened';
  assert.equal(await day.count(),0,'Intentional day overlay close precedes parent owner capture');
  assert.equal(await editor.locator('[name=starts_on]').inputValue(),'2026-11-05');assert.equal(await editor.locator('[name=ends_on]').inputValue(),'2026-11-05');
  await editor.locator('[name=person_id]').selectOption(member.id);await editor.locator('[name=notes]').fill('Dated leave add NEW');
  assert.equal(await editor.locator('[name=status]').inputValue(),'requested');
  await editor.getByRole('button',{name:'Review changes',exact:true}).click();await editor.locator('[data-save]:enabled').click();await editor.waitFor({state:'detached'});
  if(failure){
   const notice=page.locator('[data-profile-parent-refresh]');await notice.getByText(/Changes are saved, but this view could not refresh/).waitFor();
   assert.equal(await parent.locator('[data-admin-select="leave"]').count(),1);assert.equal(await page.locator('#leave-day-list-view [data-leave-day="2026-11-05"]').getByText(member.canonical_name,{exact:true}).count(),0,'Failed atomic snapshot must not partially paint successful calendar response');
   assert.equal(await parent.locator('[data-admin-select="leave"][value="leave-sibling"]').isChecked(),true);assert.equal(writes.length,2);
   assert.deepEqual(counts,{calendar:2,requests:2,pressure:2});
   const retry=notice.locator('[data-retry-profile-parent]');await retry.focus();await page.keyboard.press('Enter');
  }
  await page.getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();
  assert.equal(await parent.locator('[data-admin-select="leave"]').count(),2);assert.equal(await parent.locator('[data-admin-select="leave"][value="leave-sibling"]').isChecked(),true);
  assert.equal(await parent.locator('[data-admin-select="leave"][value="leave-added"]').isChecked(),false);
  await page.locator('#leave-day-list-view [data-leave-day="2026-11-05"]').getByText(member.canonical_name,{exact:true}).waitFor();
  assert.equal(await page.locator('[data-leave-calendar-view="list"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#working-month').inputValue(),'2026-11');
  assert.equal(await page.locator('[data-leave-calendar-view="list"]').evaluate(e=>e===window.__retainedDaylistButton&&document.querySelector('#leave-history-host')===window.__retainedLeaveHistory),true,'Retain view control/history host identities');
  assert.equal(await page.locator('.leave-pressure-details').getAttribute('open'),'');assert.equal(await day.count(),0,'No stale day overlay resurrection');
  for(const control of await page.locator('[data-delete-selected="leave"]').all()){assert.equal(await control.textContent(),'Delete selected (1)');assert.equal(await control.isEnabled(),true);}
  assert.deepEqual(counts,{calendar:failure?3:2,requests:failure?3:2,pressure:failure?3:2},'One owned3GET group, or failed group plus GET-only retry');
  assert.equal(writes.length,2);assert.equal(writes.filter(w=>w.path.endsWith('/save')).length,1);assert.deepEqual(errors,[]);
  results.push({engine,width,scenario,passed:true,datedActionClosedBeforeCapture:true,initialDateRetained:true,selectedPerson:member.id,savedStatus:'requested',daylistMonthSelectionAndDisclosureRetained:true,viewAndHistoryNodesRetained:true,GETOnlyRetry:failure,counts,writes,requests,errors});console.log(`${engine} ${width} ${scenario} passed`);
 }catch(error){
  const actual=await page.evaluate(()=>({dayModalCount:document.querySelectorAll('#leave-day-modal').length,dayAddButtonCount:document.querySelectorAll('#leave-day-modal [data-add-operational-record="leave"][data-initial-date="2026-11-05"]').length,matchingEditorCount:[...document.querySelectorAll('dialog[open]')].filter(d=>d.querySelector('h2')?.textContent==='Add leave').length,allOpenDialogHeadings:[...document.querySelectorAll('dialog[open] h2')].map(h=>h.textContent),view:location.hash}));
  results.push({engine,width,scenario,passed:false,phase,assertion:error.message,actual,noMutationAfterClick:writes.length===0,acceptedMutationCount:writes.filter(w=>w.path.endsWith('/save')).length,counts,writes,requests,errors});console.log(`${engine} ${width} ${scenario} failed: ${error.message}`);}
 finally{await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
}
assert.deepEqual(await hashes(),initial);for(const p of candidatePaths)assert.equal(sha(await readFile(p)),candidateHashes[p]);
const failed=results.filter(r=>!r.passed);
await writeFile('../docs/premium-ui/qa-original159-leave-day-add-v6-dead-control-diagnostic.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/profile_parent_final_audit',decision:failed.length?'Actual day-modal Add did not satisfy existing editor-opening action contract; diagnostic evidence retained':'Actual one-case day-modal Add opened editor and completed existing flow',scope:'One Chromium320 actual Daylist->Nov5 day modal->existing Add leave button. Explicit2000ms editor-opening expectation. Failure records actual matching editor/day modal/button counts and no-mutation evidence. Expected-correct terminal1 if dead. No forced dispatch, source edits, production writes or whole159 claim.',source_sha256:initial,candidate_sha256:candidateHashes,test_sha256:sha(await readFile(new URL(import.meta.url))),expected_contexts:1,failed_contexts:failed.length,results},null,2)+'\n');
assert.equal(results.length,1);assert.equal(failed.length,0,'Actual day-modal Add must open its editor');console.log('V6 actual day Add one-case passed');
