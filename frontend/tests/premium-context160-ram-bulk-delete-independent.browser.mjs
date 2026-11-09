import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const api='http://127.0.0.1:5274',base='http://127.0.0.1:5197',results=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['src/main.ts','src/admin-delete.ts','src/services/api.ts','src/member-workspace.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
async function json(path,method='GET'){const r=await fetch(api+path,{method});assert.equal(r.ok,true,path+' '+r.status);return r.json();}
const browser=await chromium.launch();
try{for(const width of [320,1280])for(const mode of ['selected','month'])for(const confirm of [false,true]){
 const seed=await json('/__context160/edit-seed','POST');assert.equal(seed.storage,'disposable-sqlite-memory');
 const before=await json('/__context160/delete-state'),adjacent=await json('/api/v1/unit-management/month?month=2026-06');
 const expectedIds=(mode==='selected'?[seed.leave_id,seed.third_leave_id]:before.leave_requests.filter(row=>row.starts_on>='2026-07-01'&&row.starts_on<='2026-07-31').map(row=>row.id)).sort();
 assert.equal(expectedIds.length,mode==='selected'?2:3);assert.ok(!expectedIds.includes(seed.overlap_leave_id));assert.ok(expectedIds.includes(seed.third_leave_id));
 const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[];
 try{
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','context160-bulk-delete-ram');localStorage.setItem('duty_rota_working_month','2026-07');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());const response=await route.fetch({url:api+u.pathname+u.search,maxRetries:q.method()==='GET'?2:0});if(q.method()!=='GET')writes.push({method:q.method(),path:u.pathname,status:response.status(),payload:q.postDataJSON(),result:await response.json()});return route.fulfill({response});});
  await page.goto(base+'/#view=leave');await page.locator('[data-add-operational-record=leave]').first().waitFor();assert.equal(await page.locator('#working-month').inputValue(),'2026-07');
  if(mode==='selected'){
   for(const id of expectedIds)await page.locator(`[data-admin-select=leave][value="${id}"]:visible`).check();
   const button=page.locator('[data-delete-selected=leave]:visible').first();assert.equal(await button.innerText(),'Delete selected (2)');await button.click();
  }else{
   await page.locator('[aria-label="Leave actions"] details.row-menu > summary').click();
   const button=page.locator('[data-delete-month=leave]:visible');assert.ok((await button.innerText()).includes('July 2026'));await button.click();
  }
  const dialog=page.locator('dialog.admin-delete');await dialog.locator('.admin-delete__items').waitFor();
  assert.equal(writes.length,1);const inspected=writes[0],preview=inspected.result;
  assert.equal(inspected.path,'/api/v1/admin/delete/preview');assert.equal(inspected.status,200);
  if(mode==='selected'){assert.equal(inspected.payload.kind,'leave');assert.deepEqual([...inspected.payload.ids].sort(),expectedIds);assert.equal('month'in inspected.payload,false);}
  else assert.deepEqual(inspected.payload,{kind:'leave',month:'2026-07'});
  assert.equal(preview.count,expectedIds.length);assert.deepEqual(preview.items.map(i=>i.id).sort(),expectedIds);assert.deepEqual(preview.blocked,[]);assert.ok(preview.preview_token);
  assert.deepEqual(await json('/__context160/delete-state'),before);
  if(mode==='month'){
   assert.equal(preview.confirm_phrase,'DELETE LEAVE 2026-07');assert.equal(await dialog.locator('[data-delete]').isDisabled(),true);
   await dialog.locator('[data-phrase]').fill('DELETE LEAVE 2026-06');assert.equal(await dialog.locator('[data-delete]').isDisabled(),true);
   await dialog.locator('[data-phrase]').fill(preview.confirm_phrase);assert.equal(await dialog.locator('[data-delete]').isEnabled(),true);
  }else assert.equal(preview.confirm_phrase,null);
  if(confirm)await dialog.locator('[data-delete]').click();else await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await dialog.waitFor({state:'detached'});const after=await json('/__context160/delete-state');
  if(confirm){
   assert.equal(writes.length,2);assert.equal(writes[1].path,'/api/v1/admin/delete');assert.equal(writes[1].status,200);assert.deepEqual(writes[1].payload,{...inspected.payload,preview_token:preview.preview_token,...(mode==='month'?{confirm_phrase:preview.confirm_phrase}:{})});assert.equal(writes[1].result.deleted,expectedIds.length);
   assert.deepEqual(after.leave_requests,before.leave_requests.filter(row=>!expectedIds.includes(row.id)));
   for(const key of Object.keys(before).filter(k=>k!=='leave_requests'&&k!=='deleted_records'))assert.deepEqual(after[key],before[key],key+' sentinel changed');
   const entries=after.deleted_records.filter(row=>row.batch_id===writes[1].result.batch_id);assert.equal(entries.length,expectedIds.length);assert.deepEqual(entries.map(row=>row.entity_id).sort(),expectedIds);
   for(const entry of entries){assert.equal(entry.kind,'leave');assert.equal(entry.restored_at,null);assert.deepEqual(entry.payload.leave_requests,[before.leave_requests.find(row=>row.id===entry.entity_id)]);assert.equal(Date.parse(entry.purge_after)-Date.parse(entry.deleted_at),30*24*60*60*1000);}
   assert.deepEqual(after.deleted_records.filter(row=>row.batch_id!==writes[1].result.batch_id),before.deleted_records);
  }else{assert.equal(writes.length,1);assert.deepEqual(after,before);}
  assert.deepEqual(after.leave_requests.find(row=>row.id===seed.overlap_leave_id),before.leave_requests.find(row=>row.id===seed.overlap_leave_id));
  assert.deepEqual(await json('/api/v1/unit-management/month?month=2026-06'),adjacent);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  results.push({width,mode,confirm,selectedMonth:'2026-07',expectedIds,previewNoMutation:true,phraseGuard:mode==='month',startsJuneEndsJulyUntouched:true,startsJulyEndsAugustInScope:true,exactDeletionAndRecyclePayload:confirm,declineNoMutation:!confirm,allOtherSqlRowsAndAdjacentJuneUnchanged:true,writes,errors});console.log(width+' '+mode+' '+(confirm?'confirm':'decline')+' actualRAM deletion, cross-boundary scope and sentinels passed');
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
}}finally{await browser.close();}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-context160-ram-bulk-delete-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root/frontend160_remaining_scope_map',scope:'Eight actual native Chromium320/1280 selected-two and selectedJuly Leave deletion preview/confirm/decline workflows. Dedicated5274 assertedRAM+existing API. Independently derived expected IDs,starts_on month boundary semantics,typedphrase/token,full SQL affected-row/recycle and unaffected sentinel readback. Not posting bulk,hidden-selection pruning,restore,whole160,crossbrowser,physical/production.',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,results},null,2)+'\n');console.log('Context160 actualRAM bulk deletion:8contexts passed');
