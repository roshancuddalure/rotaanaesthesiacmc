import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const api='http://127.0.0.1:5270',base='http://127.0.0.1:5197',results=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['src/main.ts','src/record-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
async function json(path,method='GET'){const r=await fetch(api+path,{method});assert.equal(r.ok,true,path+' '+r.status);return r.json();}
const browser=await chromium.launch();
try{for(const width of [320,1280])for(const accept of [false,true]){
 const seed=await json('/__context160/edit-seed','POST');assert.equal(seed.storage,'disposable-sqlite-memory');
 const before=await json('/__equivalence/import-state'),adjacent=await json('/api/v1/unit-management/month?month=2026-06');
 const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[],dialogs=[];
 try{
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());if(accept)await d.accept();else await d.dismiss();});
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','context160-cancel-ram');localStorage.setItem('duty_rota_working_month','2026-07');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());const response=await route.fetch({url:api+u.pathname+u.search,maxRetries:q.method()==='GET'?2:0});if(q.method()!=='GET')writes.push({method:q.method(),path:u.pathname,status:response.status(),payload:q.postDataJSON()});return route.fulfill({response});});
  await page.goto(base+'/#view=leave');await page.locator('[data-add-operational-record=leave]').first().waitFor();assert.equal(await page.locator('#working-month').inputValue(),'2026-07');
  const menu=page.locator('details.row-menu:visible').filter({has:page.locator(`[data-cancel-leave="${seed.leave_id}"]`)}).first();await menu.locator('summary').click();
  await page.locator(`[data-cancel-leave="${seed.leave_id}"]:visible`).click();
  if(accept)await page.getByText('Leave cancelled',{exact:true}).waitFor();
  assert.equal(dialogs.length,1);assert.ok(dialogs[0].includes(seed.leave_id));assert.ok(dialogs[0].includes('Context Selected Member'));assert.ok(dialogs[0].includes('History is retained. Existing duties remain assigned'));
  const after=await json('/__equivalence/import-state');
  if(accept){
   const target=after.leave.filter(row=>row.notes==='selected leave before edit');assert.equal(target.length,1);assert.equal(target[0].status,'cancelled');
   const original=before.leave.find(row=>row.notes==='selected leave before edit');assert.deepEqual(target[0],{...original,status:'cancelled'});
   assert.deepEqual(after.leave.filter(row=>row.notes!=='selected leave before edit'),before.leave.filter(row=>row.notes!=='selected leave before edit'));
   assert.deepEqual(after.postings,before.postings);assert.deepEqual(after.members,before.members);assert.equal(after.leave.length,before.leave.length);
   assert.deepEqual(writes,[{method:'POST',path:`/api/v1/leave/requests/${seed.leave_id}/cancel`,status:200,payload:{}}]);
  }else{assert.deepEqual(after,before);assert.deepEqual(writes,[]);}
  assert.deepEqual(await json('/api/v1/unit-management/month?month=2026-06'),adjacent);
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  results.push({width,accept,selectedMonth:'2026-07',targetId:seed.leave_id,confirmation:dialogs[0],exactTargetStateChangedOnly:accept,declineNoMutation:!accept,otherLeavePostingsMembersAndAdjacentJuneUnchanged:true,writes,errors});console.log(width+' '+(accept?'confirm':'decline')+' actualRAM cancellation and sentinels passed');
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
}}finally{await browser.close();}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-context160-ram-cancel-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root/frontend160_remaining_scope_map',scope:'Four actual currentfrontend Chromium320/1280 leave-row confirmation/decline cases against dedicated5270 SQLiteRAM and existing APIs. Fresh GET proves exact selectedJuly leave status-only cancellation, unchanged same-month sibling/adjacentJune leave/postings/members; decline zero writes. No backend/product edits,not whole160,crossbrowser/nativeAT/physical/production certification.',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,results},null,2)+'\n');console.log('Context160 actualRAM cancellation:4contexts passed');
