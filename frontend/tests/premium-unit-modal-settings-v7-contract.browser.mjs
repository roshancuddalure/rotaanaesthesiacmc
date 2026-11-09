import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const results=[],api='http://127.0.0.1:8031';
const originalUnit={id:'settings-unit',name:'Royal Settings Unit',campus:'Main',code:'SET',minimum_free_people:1,active_status:'active',notes:null};
const people=Array.from({length:3},(_,i)=>({id:'settings-person-'+i,canonical_name:'Dr Settings Person '+i,call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]}));
const assignments=people.map((person,i)=>({id:'settings-posting-'+i,person,unit:originalUnit,posting_type:'2ND_CALL',starts_on:'2026-05-01',ends_on:'2026-05-31',source:'manual',notes:null}));
const expected={minimum_free_people:2,call_minimums:[{call_level:'2ND_CALL',minimum_free_people:2}]};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const candidate of [false,true]){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],puts=[],unexpected=[];let release,arrive,saved=false;const arrived=new Promise(r=>arrive=r);
  try{
   page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-05-15T12:00:00Z'));
   await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','settings-contract');localStorage.setItem('duty_rota_working_month','2026-05');});
   await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()==='PUT'&&u.pathname==='/api/v1/unit-management/units/settings-unit/settings'){
    assert.equal(u.search,'?month=2026-05');const body=q.postDataJSON();assert.deepEqual(body,expected);puts.push({method:q.method(),path:u.pathname,month:u.searchParams.get('month'),body});
    if(puts.length===1){arrive();await new Promise(r=>release=r);return route.fulfill({status:503,json:{detail:'Unit rule temporarily unavailable'}});}
    assert.equal(puts.length,2);saved=true;return route.fulfill({json:{...originalUnit,minimum_free_people:2}});
   }if(q.method()!=='GET'){unexpected.push({method:q.method(),path:u.pathname});return route.abort();}
   if(u.pathname.endsWith('/unit-management/month'))return route.fulfill({json:{month:'2026-05',starts_on:'2026-05-01',ends_on:'2026-05-31',units:[{...originalUnit,minimum_free_people:saved?2:1}],assignments,unit_summaries:[{unit_id:originalUnit.id,assigned_members:3,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[{unit_id:originalUnit.id,call_level:'2ND_CALL',assigned_members:3,minimum_free_people:saved?2:1,max_allowed:3}],validation_issues:[]}});
   if(u.pathname==='/api/v1/admin/members')return route.fulfill({json:people});return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});});
   await page.goto((candidate?'http://127.0.0.1:5219':'http://127.0.0.1:5197')+'/#view=units');const manage=page.locator('[data-unit-board-card="unit:settings-unit"] button[data-open-unit-modal]');await manage.click();const modal=page.locator('#unit-management-modal');await modal.waitFor();
   await modal.locator('#unit-minimum-free-people').fill('2');await modal.locator('[data-unit-call-minimum="2ND_CALL"]').fill('2');let save=modal.locator('#unit-settings-form button[type=submit]');await save.focus();await page.keyboard.press('Enter');await arrived;assert.equal(await save.isDisabled(),true);assert.equal(await modal.locator('#unit-minimum-free-people').inputValue(),'2');release();await page.getByText('Unit rule temporarily unavailable',{exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('#unit-settings-form button[type=submit]')?.disabled);assert.equal(await modal.locator('[data-unit-call-minimum="2ND_CALL"]').inputValue(),'2');assert.equal(puts.length,1);
   await save.click();await page.waitForFunction(()=>document.querySelector('#unit-settings-form [data-unit-call-minimum="2ND_CALL"]')?.value==='2'&&!document.querySelector('#unit-settings-form button[type=submit]')?.disabled);assert.equal(puts.length,2);assert.equal(await modal.locator('#unit-minimum-free-people').inputValue(),'2');
   await modal.locator('[data-unit-call-minimum="2ND_CALL"]').fill('4');save=modal.locator('#unit-settings-form button[type=submit]');await save.click();assert.equal(puts.length,2,'Native invalid maximum does not create another PUT');assert.equal(await modal.locator('[data-unit-call-minimum="2ND_CALL"]').evaluate(e=>e.validity.rangeOverflow),true);
   await modal.locator('[data-close-unit-modal]').click();await modal.waitFor({state:'detached'});const openerReturned=await manage.evaluate(e=>e===document.activeElement);if(candidate)assert.equal(openerReturned,true);
   assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);results.push({engine,width,candidate,puts,pendingButtonGuard:true,failedSaveRetainsInputs:true,manualRetryExactPayload:true,successfulReadbackValues:true,nativeMaximumPreventsRequest:true,openerReturned,errors,allWritesIntercepted:true});console.log(engine+' '+width+' '+(candidate?'scratch':'applied baseline')+' passed');
  }finally{if(release)release();await page.close();}
 }}finally{await browser.close();}
}
for(const engine of ['chromium','firefox','webkit'])for(const width of [320,1280])assert.deepEqual(results.find(r=>r.engine===engine&&r.width===width&&!r.candidate).puts,results.find(r=>r.engine===engine&&r.width===width&&r.candidate).puts,'Applied baseline and scratch preserve exact settings PUTs');
const sha=b=>createHash('sha256').update(b).digest('hex');await writeFile('../docs/premium-ui/qa-unit-modal-settings-v7-contract.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),test_sha256:sha(await readFile(new URL(import.meta.url))),applied_main_sha256:sha(await readFile('src/main.ts')),candidate_helper_sha256:sha(await readFile('../tmp/unit-modal-accessibility-v7/unit-modal-accessibility.ts')),scope:'Six applied baseline and six scratch actual-controller settings workflows,3engines320/1280. Native edits/submit, locally intercepted held503, retained inputs/manual retry, exact unit+month+PUT payload parity, success readback and HTML maximum validity. No backend writes/persistence or pending-close policy claim. Scratch focus helper remains unapplied.',results},null,2)+'\n');console.log('Unit settings baseline/candidate:12contexts passed');
