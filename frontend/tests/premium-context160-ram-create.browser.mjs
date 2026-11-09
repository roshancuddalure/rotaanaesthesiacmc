import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const api='http://127.0.0.1:5252',base='http://127.0.0.1:5197',results=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['src/main.ts','src/record-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
async function json(path,method='GET'){const r=await fetch(api+path,{method});assert.equal(r.ok,true,path+' '+r.status);return r.json();}
const browser=await chromium.launch();
try{for(const width of [320,1280])for(const kind of ['units','leave']){
 const seed=await json('/__context160/seed','POST');assert.equal(seed.storage,'disposable-sqlite-memory');
 const before=await json('/__equivalence/import-state'),adjacent=await json('/api/v1/unit-management/month?month=2026-06');
 const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[];
 try{
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','context160-ram');localStorage.setItem('duty_rota_working_month','2026-07');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());const response=await route.fetch({url:api+u.pathname+u.search,maxRetries:q.method()==='GET'?2:0});if(q.method()!=='GET')writes.push({method:q.method(),path:u.pathname,status:response.status(),payload:q.postDataJSON()});return route.fulfill({response});});
  await page.goto(base+'/#view='+kind);await page.locator(`[data-add-operational-record=${kind}]`).first().waitFor();assert.equal(await page.locator('#working-month').inputValue(),'2026-07');
  if(kind==='units'){await page.locator(`[data-unit-board-card="unit:${seed.unit_id}"] [data-open-unit-modal]`).click();await page.locator(`#unit-management-modal [data-add-operational-record=units][data-initial-unit="${seed.unit_id}"]`).click();}
  else await page.locator('[data-add-operational-record=leave]').first().click();
  const editor=page.locator('dialog.record-workspace');await editor.locator('[name=person_id]').selectOption(seed.person_id);
  if(kind==='units')assert.equal(await editor.locator('[name=unit_id]').inputValue(),seed.unit_id);
  await editor.locator('[name=starts_on]').fill('2026-07-10');await editor.locator('[name=ends_on]').fill('2026-07-11');
  const note=`Context160 ${kind} ${width}`;await editor.locator('[name=notes]').fill(note);
  await editor.getByRole('button',{name:'Review changes',exact:true}).click();await editor.locator('[data-save]:not([disabled])').waitFor();
  await editor.getByRole('button',{name:'Save reviewed changes',exact:true}).click();await editor.waitFor({state:'detached'});
  const after=await json('/__equivalence/import-state');
  const key=kind==='units'?'postings':'leave',created=after[key].filter(row=>row.notes===note);assert.equal(created.length,1);
  assert.equal(created[0].person,'Context Selected Member');assert.equal(created[0].starts_on,'2026-07-10');assert.equal(created[0].ends_on,'2026-07-11');
  if(kind==='units')assert.equal(created[0].unit,'Context Selected Unit');
  assert.deepEqual(after[key].filter(row=>row.notes!==note),before[key]);
  assert.deepEqual(after[kind==='units'?'leave':'postings'],before[kind==='units'?'leave':'postings']);assert.deepEqual(after.members,before.members);
  assert.deepEqual(await json('/api/v1/unit-management/month?month=2026-06'),adjacent);
  assert.equal(writes.length,2);assert.ok(writes.every(w=>w.status===200));assert.ok(writes[0].path.endsWith('/preview'));assert.ok(writes[1].path.endsWith('/save'));assert.equal(writes[1].payload.identity,undefined);
  assert.equal(writes[1].payload.values.person_id,seed.person_id);if(kind==='units')assert.equal(writes[1].payload.values.unit_id,seed.unit_id);
  assert.deepEqual(errors,[]);results.push({width,kind,selectedMonth:'2026-07',selectedUnit:kind==='units'?seed.unit_id:null,created:created[0],baselineRowsPreserved:true,adjacentJuneUnitReadUnchanged:true,actualRamMutations:writes,errors});console.log(width+' '+kind+' actualRAM create/readback and siblings passed');
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
}}finally{await browser.close();}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-context160-ram-create.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root/context160_fixture_resume',scope:'Four actualfrontend Chromium phone/desktop selectedJuly newposting/leave creations. Real existing APIpreview/save services persist only dedicated5252 SQLiteRAM; freshGET proves exactrowadded and allpriorrows,otherkind,members,adjacentJuneunitread unchanged. Not mockedPOST fulfillment,not production/policy/parser/whole160.',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,results},null,2)+'\n');console.log('Context160 actualRAM:4contexts passed');
