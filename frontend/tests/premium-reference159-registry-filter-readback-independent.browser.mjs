import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['main','reference-workspace','record-workspace','unit-board-filters'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async n=>['frontend/src/'+n+'.ts',sha(await readFile('src/'+n+'.ts'))]))),initial=await hashes(),results=[];
const unit={id:'readback-unit',name:'Safety Unit',campus:'Main',code:'SAFE',minimum_free_people:1,active_status:'active',aliases:[],notes:'',call_minimums:[],revision:'one',usage:{postings:0,duties:0,future_postings:0,future_duties:0,selected_members:0}};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280]){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],requests=[];let state={...unit},reads=0,puts=0,release,readStarted;const pending=new Promise(r=>readStarted=r);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','readback-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());requests.push({method:q.method(),path:u.pathname});
   if(q.method()==='PUT'&&u.pathname==='/api/v1/normalization/units/readback-unit'){puts++;state={...state,...q.postDataJSON(),revision:'saved'};assert.equal(state.name,'Safety Unit Saved');return route.fulfill({json:state});}
   assert.equal(q.method(),'GET','No mutation except one confirmed local registry edit');
   if(u.pathname==='/api/v1/normalization/units')return route.fulfill({json:[state]});
   if(u.pathname==='/api/v1/unit-management/month'){reads++;if(reads===2){readStarted();await new Promise(r=>release=r);return route.fulfill({status:503,json:{detail:'Dependent unit read unavailable'}});}return route.fulfill({json:{month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units:[state],assignments:[],unit_summaries:[{unit_id:unit.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[],validation_issues:[]}});}
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
  });
  try{await page.goto('http://127.0.0.1:5197/#view=units');await page.locator('input[data-unit-board-search]').fill('Safety');await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
   await page.locator('[aria-label="Unit actions"] details.row-menu > summary').click();await page.locator('[data-manage-department-units]').click();const dialog=page.getByRole('dialog',{name:'Manage department units',exact:true});await dialog.locator('[data-select-unit="readback-unit"]').click();await dialog.locator('[name=name]').fill('Safety Unit Saved');await dialog.getByRole('button',{name:'Save unit',exact:true}).click();await pending;
   await dialog.getByRole('button',{name:'Save unit',exact:true}).waitFor();await dialog.locator('[name=name]').fill('Unrelated next unit draft');await dialog.locator('[name=notes]').fill('Keep this unsaved note');release();await page.locator('[data-unit-freshness].is-stale').waitFor();
   assert.equal(await dialog.locator('[name=name]').inputValue(),'Unrelated next unit draft');assert.equal(await dialog.locator('[name=notes]').inputValue(),'Keep this unsaved note');assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Safety');assert.equal(await page.locator('select[data-unit-board-campus]').inputValue(),'campus:Main');assert.equal(puts,1);assert.equal(reads,2);
   await dialog.getByRole('button',{name:'Close unit management',exact:true}).click();await dialog.waitFor({state:'detached'});await page.locator('[data-refresh-unit-board]').click();await page.locator('[data-unit-freshness].is-stale').waitFor({state:'detached'});await page.locator('[data-unit-board-card="unit:readback-unit"]').filter({hasText:'Safety Unit Saved'}).waitFor();
   assert.equal(puts,1);assert.equal(reads,3);assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Safety');assert.equal(await page.locator('select[data-unit-board-campus]').inputValue(),'campus:Main');assert.deepEqual(errors,[]);results.push({engine,width,puts,reads,unrelatedDraftPreserved:true,searchCampusPreserved:true,explicitGetOnlyRetry:true,confirmedSavedNameVisible:true,requests,errors});console.log(engine+' '+width+' registry readback/draft/filter passed');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-reference159-registry-filter-readback-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/dependent159_acceptance_gapmap',scope:'New independent six actual main registry edit cases; confirmed PUT then dependentGET503 while unrelated new registry draft typed,manual boardGET retry,unitsearch/campus retained. Locallyfulfilled mutation/GET fixture,not backendpersistence. No expansion requirement claimed for empty member fixture.',source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Registry159 novel readback/filter/draft:6passed');
