import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const api='http://127.0.0.1:5273',base='http://127.0.0.1:5197',results=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['src/main.ts','src/admin-delete.ts','src/services/api.ts','src/member-workspace.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
async function json(path,method='GET'){const r=await fetch(api+path,{method});assert.equal(r.ok,true,path+' '+r.status);return r.json();}
const browser=await chromium.launch();
try{for(const width of [320,1280])for(const kind of ['leave','posting'])for(const confirm of [false,true]){
 const seed=await json('/__context160/edit-seed','POST');assert.equal(seed.storage,'disposable-sqlite-memory');
 const before=await json('/__context160/delete-state'),adjacent=await json('/api/v1/unit-management/month?month=2026-06');
 const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[];
 try{
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','context160-delete-ram');localStorage.setItem('duty_rota_working_month','2026-07');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());const response=await route.fetch({url:api+u.pathname+u.search,maxRetries:q.method()==='GET'?2:0});if(q.method()!=='GET')writes.push({method:q.method(),path:u.pathname,status:response.status(),payload:q.postDataJSON(),result:await response.json()});return route.fulfill({response});});
  await page.goto(base+'/#view='+(kind==='leave'?'leave':'units'));await page.locator(`[data-add-operational-record=${kind==='leave'?'leave':'units'}]`).first().waitFor();assert.equal(await page.locator('#working-month').inputValue(),'2026-07');
  const targetId=kind==='leave'?seed.leave_id:seed.posting_id,table=kind==='leave'?'leave_requests':'person_postings';
  if(kind==='posting'){
   await page.locator(`[data-unit-board-card="unit:${seed.unit_id}"] [data-open-unit-modal]`).click();
   await page.locator(`[data-delete-unit-assignment="${targetId}"]:visible`).click();
  }else{
   const menu=page.locator('details.row-menu:visible').filter({has:page.locator(`[data-delete-leave="${targetId}"]`)}).first();await menu.locator('summary').click();
   await page.locator(`[data-delete-leave="${targetId}"]:visible`).click();
  }
  const dialog=page.locator('dialog.admin-delete');await dialog.locator('.admin-delete__items').waitFor();
  assert.equal(writes.length,1);assert.equal(writes[0].path,'/api/v1/admin/delete/preview');assert.equal(writes[0].status,200);assert.deepEqual(writes[0].payload,{kind,ids:[targetId]});
  const preview=writes[0].result;assert.equal(preview.count,1);assert.deepEqual(preview.items.map(i=>i.id),[targetId]);assert.deepEqual(preview.blocked,[]);assert.ok(preview.preview_token);assert.equal(preview.confirm_phrase,null);
  assert.ok((await dialog.locator('.admin-delete__items').innerText()).includes('Context Selected Member'));assert.ok((await dialog.innerText()).includes('Deleted items can be restored from the Recycle bin for 30 days.'));
  assert.deepEqual(await json('/__context160/delete-state'),before);
  if(confirm)await dialog.locator('[data-delete]').click();else await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  const after=await json('/__context160/delete-state');
  if(confirm){
   assert.equal(writes.length,2);assert.deepEqual(writes[1].payload,{kind,ids:[targetId],preview_token:preview.preview_token});assert.equal(writes[1].path,'/api/v1/admin/delete');assert.equal(writes[1].status,200);assert.equal(writes[1].result.deleted,1);
   assert.deepEqual(after[table],before[table].filter(row=>row.id!==targetId));
   for(const key of Object.keys(before).filter(k=>k!==table&&k!=='deleted_records'))assert.deepEqual(after[key],before[key],key+' sentinel changed');
   const entries=after.deleted_records.filter(row=>row.batch_id===writes[1].result.batch_id);assert.equal(entries.length,1);const entry=entries[0];assert.equal(entry.kind,kind);assert.equal(entry.entity_id,targetId);assert.equal(entry.restored_at,null);
   const original=before[table].find(row=>row.id===targetId);assert.deepEqual(entry.payload[table],[original]);
   assert.deepEqual(after.deleted_records.filter(row=>row.batch_id!==writes[1].result.batch_id),before.deleted_records);
   assert.equal(Date.parse(entry.purge_after)-Date.parse(entry.deleted_at),30*24*60*60*1000);
  }else{assert.equal(writes.length,1);assert.deepEqual(after,before);}
  assert.deepEqual(await json('/api/v1/unit-management/month?month=2026-06'),adjacent);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  results.push({width,kind,confirm,selectedMonth:'2026-07',selectedUnit:kind==='posting'?seed.unit_id:null,targetId,previewNoMutation:true,exactTargetAndRecyclePayload:confirm,declineNoMutation:!confirm,allSiblingUnitMemberLeavePostingDutyAndAdjacentJuneSentinelsUnchanged:true,writes,errors});console.log(width+' '+kind+' '+(confirm?'confirm':'decline')+' actualRAM deletion, recycle and sentinels passed');
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
}}finally{await browser.close();}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-context160-ram-delete-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root/frontend160_remaining_scope_map',scope:'Eight native currentfrontend Chromium320/1280 single-leave deletion and selected-unit posting removal preview/confirm/decline cases using real APIs and dedicated5273 asserted RAM. Read-only SQL fixture snapshot checks exact identity removal/recycle payload, unchanged all other records and existing duties; preview/decline no mutation. Not selected/month delete,not restore,not whole160/crossbrowser/physical/production.',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,results},null,2)+'\n');console.log('Context160 actualRAM deletion:8contexts passed');
