// Actual individual and monthly approval through the existing API, disposable8025 RAM only.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const base='http://127.0.0.1:5197',api='http://127.0.0.1:8025',month='2026-05';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourcePaths=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|css)$/.test(p)).map(p=>'src/'+p);
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>['frontend/'+p,sha(await readFile(p))])));
const initial=await hashes(),testHash=sha(await readFile(new URL(import.meta.url))),results=[];
const fixtureSources=['../tools/leave_approval_smoke_server.py','../tools/compute_smoke_server.py'];
const fixtureText=await Promise.all(fixtureSources.map(p=>readFile(p,'utf8')));
assert.ok(fixtureText[0].includes('import compute_smoke_server as fixture')&&fixtureText[0].includes('host="127.0.0.1", port=8025'));
assert.ok(fixtureText[1].includes('sqlite+pysqlite:///:memory:')&&fixtureText[1].includes('poolclass=StaticPool')&&fixtureText[1].includes('app.dependency_overrides[get_db] = database')&&fixtureText[1].includes('app.dependency_overrides[current_user] = lambda: operator'));
const fixtureHashes=Object.fromEntries(await Promise.all(fixtureSources.map(async p=>[p.replace('../',''),sha(await readFile(p))])));
const get=async path=>{const response=await fetch(api+path);assert.equal(response.status,200,path);return response.json();};
const postFixture=async path=>{assert.ok(['/__fixture/leave-approval','/__fixture/leave-approval-change','/__fixture/leave-approval-board'].includes(path));const response=await fetch(api+path,{method:'POST'});assert.equal(response.status,200,path);return response.json();};
const leaves=()=>get('/api/v1/leave/requests?month='+month);
const assignmentSnapshot=async()=>{
 const template=await get('/api/v1/rota-template/month?month='+month);
 return template.slots.flatMap(slot=>slot.assignments.map(a=>({slot_id:slot.id,date:slot.duty_date,id:a.id,person_id:a.person_id,status:a.status}))).sort((a,b)=>a.id.localeCompare(b.id));
};
const activate=async(page,target)=>{await target.focus();await page.keyboard.press('Enter');};
const pending=rows=>rows.filter(row=>['requested','imported_pending_review'].includes(row.status));
const statuses=rows=>Object.fromEntries(rows.map(row=>[row.id,row.status]));
const engines=process.env.LEAVE_PERSISTENCE_ENGINES?.split(',')||['chromium','firefox','webkit'];
for(const engine of engines){
 const browser=await {chromium,firefox,webkit}[engine].launch();
 try{for(const width of [320,1280])for(const role of ['admin','board']){
  await postFixture('/__fixture/leave-approval');
  if(role==='board')await postFixture('/__fixture/leave-approval-board');
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
  page.setDefaultTimeout(20000);
  const errors=[],unexpected=[],calls=[],dialogs=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>{dialogs.push({type:dialog.type(),message:dialog.message()});return dialog.dismiss();});
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','leave-real-ram');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   const call={method:request.method(),path:url.pathname,query:url.search};
   if(request.method()!=='GET'){
    if(request.method()!=='POST'||!['/api/v1/normalization/records/leave/preview','/api/v1/normalization/records/leave/save','/api/v1/leave/approval-preview','/api/v1/leave/approve-month'].includes(url.pathname)){
     unexpected.push(call);return route.abort();
    }
    call.body=request.postDataJSON();
   }
   const response=await route.fetch({url:api+url.pathname+url.search});
   call.status=response.status();
   if(request.method()!=='GET')call.result=await response.json();
   calls.push(call);return route.fulfill({response});
  });
  await page.goto(base+'/#view=leave');
  await page.locator('[data-add-operational-record=leave]').waitFor();
  await page.waitForLoadState('networkidle');
  const original=await leaves(),beforeAssignments=await assignmentSnapshot(),beforeStatus=statuses(original);
  assert.equal(pending(original).length,2);assert.equal(beforeAssignments.length,1);
  if(role==='board'){
   assert.equal(await page.locator('[data-approve-month-leave]').count(),0,'Monthly approval remains admin-only');
   const forbidden=await fetch(api+'/api/v1/leave/approval-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month})});
   assert.equal(forbidden.status,403,'Existing real RAM authorization refuses board preview');
   assert.deepEqual(statuses(await leaves()),beforeStatus);assert.deepEqual(await assignmentSnapshot(),beforeAssignments);
   assert.equal(calls.filter(c=>c.method!=='GET').length,0);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
   results.push({engine,width,role,monthlyControlHidden:true,realPreviewForbidden403:true,persistedStatusesUnchanged:true,assignmentIdentityUnchanged:true,actualBrowserMutations:0,errors});
   await context.close();console.log(`Leave persistence ${engine} ${width} board`);continue;
  }
  const target=original.find(row=>row.status==='requested'&&row.starts_on==='2026-05-02');assert.ok(target);
  const openEditor=async id=>{
   const prefix=width<=700?'.leave-card':'.hide-mobile tbody tr';
   const edit=page.locator(`${prefix} [data-edit-operational-record="${id}"]`);
   await activate(page,edit.locator('xpath=ancestor::details[1]/summary'));
   await activate(page,edit);
   const editor=page.locator('dialog.record-workspace');await editor.locator('[name=status]').waitFor();return editor;
  };
  let editor=await openEditor(target.id);
  assert.equal(await editor.locator('[name=status]').inputValue(),'requested');
  assert.equal(await editor.locator('[name=person_id]').inputValue(),target.person.id);
  await editor.locator('[name=status]').selectOption('approved');
  assert.equal(await editor.locator('[data-save]').isDisabled(),true);
  await activate(page,editor.getByRole('button',{name:'Review changes',exact:true}));
  await editor.getByRole('heading',{name:'Review proposed changes',exact:true}).waitFor();
  assert.match(await editor.locator('[data-review]').innerText(),/Approved leave blocks availability/);
  assert.match(await editor.locator('[data-review]').innerText(),/1 affected duties/);
  assert.equal(await editor.locator('[data-save]').isEnabled(),true);
  await activate(page,editor.locator('[data-save]'));await editor.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Approve all pending (1)',exact:true}).waitFor();await page.waitForLoadState('networkidle');
  const afterIndividual=await leaves();assert.equal(afterIndividual.find(row=>row.id===target.id).status,'approved');
  for(const row of original.filter(row=>row.id!==target.id))assert.equal(afterIndividual.find(x=>x.id===row.id).status,row.status);
  assert.deepEqual(await assignmentSnapshot(),beforeAssignments,'Individual approval must retain exact existing assignment IDs/person/slot/status');
  editor=await openEditor(target.id);assert.equal(await editor.locator('[name=status]').inputValue(),'approved','Reopened actual editor reads persisted approval');
  await activate(page,editor.getByRole('button',{name:'Close editor',exact:true}));await editor.waitFor({state:'detached'});
  const previewCall=calls.find(c=>c.path==='/api/v1/normalization/records/leave/preview'),saveCall=calls.find(c=>c.path==='/api/v1/normalization/records/leave/save');
  assert.equal(previewCall.body.identity,target.id);assert.equal(saveCall.body.identity,target.id);assert.equal(previewCall.body.values.status,'approved');assert.deepEqual(saveCall.body.values,previewCall.body.values);assert.equal(saveCall.body.review_token,previewCall.result.review_token);assert.equal(saveCall.status,200);assert.equal(saveCall.result.id,target.id);
  // Remaining monthly scope is independent of the already approved individual record.
  await activate(page,page.locator('[data-approve-month-leave]'));
  let monthly=page.locator('dialog.leave-approval-workspace');await monthly.getByText('1 pending request to approve.',{exact:true}).waitFor();
  const remainingPreview=calls.filter(c=>c.path==='/api/v1/leave/approval-preview').at(-1).result;
  assert.equal(remainingPreview.month,month);assert.equal(remainingPreview.pending_count,1);assert.deepEqual(remainingPreview.requests.map(r=>r.id),pending(afterIndividual).map(r=>r.id));
  assert.deepEqual(remainingPreview.affected_duties,[]);assert.equal(await monthly.locator('[data-duty-ack]').count(),0);
  const spanning=remainingPreview.requests[0];assert.equal(spanning.starts_on,'2026-05-31');assert.equal(spanning.ends_on,'2026-06-02');assert.match(await monthly.innerText(),/full date range/);
  assert.equal(await monthly.locator('[data-approve]').isDisabled(),true);await monthly.locator('[data-confirm]').check();assert.equal(await monthly.locator('[data-approve]').isEnabled(),true);
  await activate(page,monthly.locator('[data-approve]'));await monthly.waitFor({state:'detached'});await page.getByRole('button',{name:'Approve all pending (0)',exact:true}).waitFor();await page.waitForLoadState('networkidle');
  const afterRemaining=await leaves();assert.equal(pending(afterRemaining).length,0);assert.equal(afterRemaining.find(row=>row.id===spanning.id).status,'approved');assert.equal(afterRemaining.find(row=>row.id===spanning.id).ends_on,'2026-06-02');assert.deepEqual(await assignmentSnapshot(),beforeAssignments);
  for(const row of original.filter(row=>['cancelled','rejected'].includes(row.status)))assert.equal(afterRemaining.find(x=>x.id===row.id).status,row.status);
  const remainingApply=calls.filter(c=>c.path==='/api/v1/leave/approve-month').at(-1);assert.deepEqual(remainingApply.body,{month,review_token:remainingPreview.review_token,acknowledge_duties:false});assert.equal(remainingApply.status,200);assert.equal(remainingApply.result.approved_count,1);
  // Reset this dedicated RAM service only after all requests for the first scenario settle.
  await page.waitForLoadState('networkidle');await postFixture('/__fixture/leave-approval');await page.reload();await page.getByRole('button',{name:'Approve all pending (2)',exact:true}).waitFor();await page.waitForLoadState('networkidle');
  const staleBefore=await leaves(),staleAssignments=await assignmentSnapshot();
  await activate(page,page.locator('[data-approve-month-leave]'));monthly=page.locator('dialog.leave-approval-workspace');await monthly.getByText('2 pending requests to approve.',{exact:true}).waitFor();
  const stalePreview=calls.filter(c=>c.path==='/api/v1/leave/approval-preview').at(-1).result;
  assert.deepEqual(stalePreview.requests.map(r=>r.id).sort(),pending(staleBefore).map(r=>r.id).sort());assert.equal(stalePreview.affected_duties.length,1);
  assert.deepEqual(stalePreview.affected_duties.map(d=>d.id),staleAssignments.map(a=>a.id));
  assert.equal(await monthly.locator('[data-approve]').isDisabled(),true);await monthly.locator('[data-confirm]').check();assert.equal(await monthly.locator('[data-approve]').isDisabled(),true,'Duty acknowledgement is independent of confirmation');await monthly.locator('[data-duty-ack]').check();assert.equal(await monthly.locator('[data-approve]').isEnabled(),true);
  await postFixture('/__fixture/leave-approval-change');const changed=await leaves();assert.equal(pending(changed).length,3);
  await activate(page,monthly.locator('[data-approve]'));await monthly.getByRole('alert').filter({hasText:/Refresh/}).waitFor();
  const refused=calls.filter(c=>c.path==='/api/v1/leave/approve-month').at(-1);assert.equal(refused.status,409);assert.deepEqual(refused.body,{month,review_token:stalePreview.review_token,acknowledge_duties:true});assert.deepEqual(statuses(await leaves()),statuses(changed),'Actual409 must not partially approve records');assert.deepEqual(await assignmentSnapshot(),staleAssignments);
  assert.equal(await monthly.locator('[data-approve]').isDisabled(),true);assert.equal(await monthly.locator('[data-confirm]').count(),0);
  await activate(page,monthly.locator('[data-refresh]'));await monthly.getByText('3 pending requests to approve.',{exact:true}).waitFor();
  const fresh=calls.filter(c=>c.path==='/api/v1/leave/approval-preview').at(-1).result;assert.notEqual(fresh.review_token,stalePreview.review_token);assert.deepEqual(fresh.requests.map(r=>r.id).sort(),pending(changed).map(r=>r.id).sort());assert.equal(await monthly.locator('[data-confirm]').isChecked(),false);assert.equal(await monthly.locator('[data-duty-ack]').isChecked(),false);
  await monthly.locator('[data-confirm]').check();assert.equal(await monthly.locator('[data-approve]').isDisabled(),true);await monthly.locator('[data-duty-ack]').check();
  await activate(page,monthly.locator('[data-approve]'));await monthly.waitFor({state:'detached'});await page.getByRole('button',{name:'Approve all pending (0)',exact:true}).waitFor();await page.waitForLoadState('networkidle');
  const finalLeaves=await leaves(),finalApply=calls.filter(c=>c.path==='/api/v1/leave/approve-month').at(-1);assert.equal(finalApply.status,200);assert.equal(finalApply.result.approved_count,3);assert.deepEqual(finalApply.body,{month,review_token:fresh.review_token,acknowledge_duties:true});assert.equal(pending(finalLeaves).length,0);
  for(const record of pending(changed))assert.equal(finalLeaves.find(row=>row.id===record.id).status,'approved');
  for(const record of changed.filter(row=>['cancelled','rejected'].includes(row.status)))assert.equal(finalLeaves.find(row=>row.id===record.id).status,record.status);
  assert.deepEqual(await assignmentSnapshot(),staleAssignments,'Monthly approval preserves assignment identity, not just count');assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(dialogs,[]);
  const mutations=calls.filter(c=>c.method!=='GET');assert.equal(mutations.filter(c=>c.path.endsWith('/normalization/records/leave/save')).length,1);assert.equal(mutations.filter(c=>c.path==='/api/v1/leave/approve-month').length,3,'One remaining success, one actual409 and one explicit fresh-token success; no automatic replay');
  results.push({engine,width,role,individualRecordId:target.id,individualNativeReviewAndSave:true,independentGetAndReopenApproved:true,individualSave:saveCall,remainingMonthlyPreview:remainingPreview,remainingMonthlyApply:remainingApply,staleReview409:refused,freshMonthlyApply:finalApply,pendingRecordsApproved:pending(changed).map(row=>row.id),cancelledRejectedUnchanged:true,crossMonthFullRangeRetained:true,assignmentIdentityBefore:staleAssignments,assignmentIdentityAfter:await assignmentSnapshot(),exactAcknowledgementsAndToken:true,noAutomaticReplay:true,mutations,errors});
  console.log(`Leave persistence ${engine} ${width} admin`);await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Application sources held during real RAM matrix');
await writeFile('../docs/premium-ui/qa-leave-approval-extra-guidance-regression'+(process.env.LEAVE_PERSISTENCE_ENGINES?'-probe':'')+'.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,test_sha256:testHash,fixture_source_sha256:fixtureHashes,executed_engines:engines,scope:`Actual shell leave controls, existing normalized individual Review/Save and monthly preview/apply against dedicated hardcoded loopback8025SQLiteRAM only. Executed engines:${engines.join(',')};320/1280admin/board. Real independent GET/reopen verifies individual persisted status, remaining monthly1 scope, fullrange, actual409 refusal and explicit fresh-token monthly3 success. Exact assignment IDs/person/slot/status preserved. No application/backend/service-contract changes or production data.`,limitations:['The test deliberately mutates disposable RAM fixtures; it does not establish PostgreSQL/production concurrency or persistence.','No physical device, actual software keyboard or native assistive technology coverage.','Source inspection proves the launched existing fixture is memory-only; it is not an attestation of an arbitrary remote service.','No uncertain-network mutation failure is injected; existing intercepted monthly recovery suite separately covers unconfirmed503/manual refresh.','This is142persistence evidence, not automatic acceptance of141toolbar/144calendar/145statuses/147safety wording.'],results},null,2)+'\n');
console.log(`Leave approval persistence: ${results.length} contexts passed`);
