import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const folder='../tmp/settings159-readback-regions-v7';
const hashes=async()=>Object.fromEntries(await Promise.all(['main.ts','unit-board-filters.ts','unit-settings-recovery.ts'].map(async name=>[name,sha(await readFile(folder+'/'+name))])));
const candidate=await hashes(),applied=sha(await readFile('src/main.ts')),results=[];
const unit={id:'readback-unit',name:'Royal Readback Unit',campus:'Main',code:'RB',minimum_free_people:1,active_status:'active',notes:null};
const people=Array.from({length:61},(_,i)=>({id:'readback-person-'+i,canonical_name:'Readback Person '+i,call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]}));
const assignments=people.map((person,i)=>({id:'readback-posting-'+i,person,unit,posting_type:'2ND_CALL',starts_on:'2026-05-01',ends_on:'2026-05-31',source:'manual',notes:null}));
const excludedUnit={...unit,id:'excluded-unit',name:'Excluded Unit',campus:'Other'};const excludedPosting={...assignments[0],id:'excluded-posting',unit:excludedUnit,person:{...people[0],id:'excluded-person',canonical_name:'Excluded Person'}};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const scenario of['print-event-only','print-media']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],writes=[];let reads=0,release,started;
  const held=new Promise(resolve=>started=resolve);page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','readback-boundaries');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());
   if(q.method()!=='GET'){assert.equal(q.method(),'PUT');assert.equal(u.pathname,'/api/v1/unit-management/units/readback-unit/settings');assert.deepEqual(q.postDataJSON(),{minimum_free_people:2,call_minimums:[{call_level:'2ND_CALL',minimum_free_people:2}]});writes.push(q.postDataJSON());return route.fulfill({json:{...unit,minimum_free_people:2}});}
   if(u.pathname==='/api/v1/admin/members')return route.fulfill({json:people});
   if(u.pathname==='/api/v1/unit-management/month'){
    reads++;if(reads===2){started();await new Promise(resolve=>release=resolve);}
    const missing=scenario==='missing-unit'&&reads===2,updated=reads>1;
    return route.fulfill({json:{month:'2026-05',starts_on:'2026-05-01',ends_on:'2026-05-31',units:missing?[]:[{...unit,name:updated?'Royal Readback Fresh':unit.name,minimum_free_people:updated?2:1},excludedUnit],assignments:missing?[]:[...(updated?assignments.slice(0,60):assignments),excludedPosting],unit_summaries:missing?[]:[{unit_id:unit.id,assigned_members:updated?60:61,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:missing?[]:[{unit_id:unit.id,call_level:'2ND_CALL',assigned_members:updated?60:61,minimum_free_people:updated?2:1,max_allowed:updated?60:61}],validation_issues:[]}});
   }
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto('http://127.0.0.1:5287/#view=units',{waitUntil:'domcontentloaded',timeout:60000});
   await page.locator('input[data-unit-board-search]').fill('Royal');await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
   await page.locator('[data-unit-board-card="unit:readback-unit"] button[data-open-unit-modal]').click();
   const modal=page.locator('#unit-management-modal'),form=modal.locator('#unit-settings-form'),input=form.locator('#unit-minimum-free-people'),save=form.locator('button[type=submit]');
   await form.evaluate(form=>{window.__form=form;window.__input=form.querySelector('#unit-minimum-free-people');window.__call=form.querySelector('[data-unit-call-minimum]');});
   await input.fill('2');await form.locator('[data-unit-call-minimum]').fill('2');await save.focus();await page.keyboard.press('Enter');await held;await input.fill('3');await input.focus();
   assert.equal(await page.locator('[data-unit-posting-body] tr').count(),50,'Normal table is paginated before print');
   if(scenario==='print-event-only') await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
   else await page.emulateMedia({media:'print'});
   assert.equal(await page.locator('[data-unit-posting-body] tr').count(),61,'Print materializes all matching rows');
   assert.equal(await page.evaluate(()=>matchMedia('print').matches),scenario==='print-media');
   release();
   if(scenario==='missing-unit'){
    const retry=form.locator('[data-retry-unit-settings-read]');await form.getByText(/Rules saved, but the refresh failed/).waitFor();await retry.waitFor();
    assert.equal(await modal.locator('[data-unit-readback-unavailable]').count(),1);assert.match(await modal.locator('.audit-chip-row').innerText(),/unavailable/);assert.match(await modal.locator('.unit-modal-validation').innerText(),/Unavailable/);
    assert.equal(await input.evaluate(input=>input.validity.customError),true);assert.equal(await input.inputValue(),'3');assert.equal(writes.length,1);
    await save.click();await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,80)));assert.equal(writes.length,1,'Native invalid draft must not repeat the update');
    await retry.focus();await page.keyboard.press('Enter');await form.getByText('Previous rules are saved and refreshed. New edits are not saved yet.',{exact:true}).waitFor();
    assert.equal(await modal.locator('[data-unit-readback-unavailable]').count(),0);assert.equal(await input.evaluate(input=>input.validity.customError),false);assert.equal(reads,3);
   }else{
    await page.waitForFunction(()=>document.querySelector('#unit-settings-form [role="status"]')?.textContent==='Previous rules are saved and refreshed. New edits are not saved yet.');
    assert.equal(await page.locator('[data-unit-posting-body] tr').count(),60);assert.equal(await page.locator('[data-unit-posting-body]').getByText('Readback Person 60',{exact:true}).count(),0);
    await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.locator('[data-unit-posting-body] tr').count(),50,'Print cleanup restores current page50, not old rows');assert.equal(await page.locator('[data-unit-posting-body]').getByText('Readback Person 60',{exact:true}).count(),0);assert.equal(reads,2);
   }
   assert.equal(await form.evaluate(form=>form===window.__form&&form.querySelector('#unit-minimum-free-people')===window.__input&&form.querySelector('[data-unit-call-minimum]')===window.__call),true);
   assert.equal(await input.inputValue(),'3');assert.equal(await modal.locator('#unit-modal-title').innerText(),'Royal Readback Fresh');assert.equal(writes.length,1);assert.deepEqual(errors,[]);
   await modal.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Royal');assert.equal(await page.locator('select[data-unit-board-campus]').inputValue(),'campus:Main');
   assert.equal(await page.locator('[data-unit-posting-body] tr').count(),50);if(width===320){assert.equal(await page.locator('[data-postings-page="1"]').isHidden(),true);await page.setViewportSize({width:1280,height:900});}await page.locator('[data-postings-page="1"]').click();assert.equal(await page.locator('[data-unit-posting-body] tr').count(),10);assert.equal(await page.locator('[data-unit-posting-body]').getByText('Readback Person 59',{exact:true}).count(),1);assert.equal(await page.locator('[data-unit-posting-body]').getByText('Readback Person 60',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   results.push({engine,width,scenario,reads,writes,errors,formAndInputIdentityRetained:true,newerDraftRetained:true});console.log(engine+' '+width+' '+scenario+' readback boundary passed');
  }finally{if(release)release();await page.emulateMedia({media:'screen'});await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),candidate);assert.equal(sha(await readFile('src/main.ts')),applied);assert.equal(results.length,12);
await writeFile('../docs/premium-ui/qa-settings159-readback-v7-large-print12-r1.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root/settings_v5_finish',scope:'Twelve V6 actual app-preview contexts across3engines320/1280, beforeprint mediafalse and printmediatrue. FilterRoyal andMain; initial61matchingrows normalpaged50, print61; freshread60 whileprintactive must keepall60materialized, afterprint restoresfreshpage50, nextpage10 includeslast59 andexcludesremoved60. Retaineddraft/inputidentity,onePUT/twoGET; mobile print/restore asserted at320 then explicitlyresizedto1280 onlyfornativepagedUIinteraction because Allpostings table is intentionallyhide-mobile; no physicalprinterclaim.',candidate_sha256:candidate,applied_main_sha256:applied,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Settings V5 missing-unit/print boundary:12 contexts passed');
