import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const paths=['../tmp/profile-parent-refresh-v5/main.ts','../tmp/profile-parent-refresh-v5/member-workspace.ts','src/unit-board-filters.ts','src/unit-settings-recovery.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));
const candidate=await hashes(),applied=sha(await readFile('src/main.ts')),results=[];
assert.equal(applied,'5311e9933a6614747458418a218ac2b22855c2f7baa574e446557a4aa6d9d13d');
assert.equal(candidate[paths[0]],'2b8f68c069e599af50a4ac1b2146a7018d6268f290b90a9949130a057dc91b43');
const served=await (await fetch('http://127.0.0.1:5293/src/main.ts')).text();
const encoded=served.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(encoded);
const mapped=JSON.parse(Buffer.from(encoded[1],'base64').toString());assert.ok(mapped.sourcesContent.some(source=>sha(source)===candidate[paths[0]]),'Exact V5 source served');
const unit={id:'readback-unit',name:'Royal Readback Unit',campus:'Main',code:'RB',minimum_free_people:1,active_status:'active',notes:null};
const people=Array.from({length:3},(_,i)=>({id:'readback-person-'+i,canonical_name:'Readback Person '+i,call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]}));
const assignments=people.map((person,i)=>({id:'readback-posting-'+i,person,unit,posting_type:'2ND_CALL',starts_on:'2026-05-01',ends_on:'2026-05-31',source:'manual',notes:null}));
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const scenario of['missing-unit']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],writes=[];let reads=0,release,started,retryRelease,retryStarted;
  const retryHeld=new Promise(resolve=>retryStarted=resolve);const held=new Promise(resolve=>started=resolve);page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','readback-boundaries');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());
   if(q.method()!=='GET'){assert.equal(q.method(),'PUT');assert.equal(u.pathname,'/api/v1/unit-management/units/readback-unit/settings');assert.deepEqual(q.postDataJSON(),{minimum_free_people:2,call_minimums:[{call_level:'2ND_CALL',minimum_free_people:2}]});writes.push(q.postDataJSON());return route.fulfill({json:{...unit,minimum_free_people:2}});}
   if(u.pathname==='/api/v1/admin/members')return route.fulfill({json:people});
   if(u.pathname==='/api/v1/unit-management/month'){
    reads++;if(reads===3){retryStarted();await new Promise(resolve=>retryRelease=resolve);}if(reads===2){started();await new Promise(resolve=>release=resolve);}
    const missing=scenario==='missing-unit'&&reads===2,updated=reads>1;
    return route.fulfill({json:{month:'2026-05',starts_on:'2026-05-01',ends_on:'2026-05-31',units:missing?[]:[{...unit,name:updated?'Royal Readback Fresh':unit.name,minimum_free_people:updated?2:1}],assignments:missing?[]:updated?assignments.slice(0,2):assignments,unit_summaries:missing?[]:[{unit_id:unit.id,assigned_members:updated?2:3,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:missing?[]:[{unit_id:unit.id,call_level:'2ND_CALL',assigned_members:updated?2:3,minimum_free_people:updated?2:1,max_allowed:updated?2:3}],validation_issues:[]}});
   }
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto('http://127.0.0.1:5293/#view=units',{waitUntil:'domcontentloaded',timeout:60000});
   await page.locator('input[data-unit-board-search]').fill('Royal');await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
   await page.locator('[data-unit-board-card="unit:readback-unit"] button[data-open-unit-modal]').click();
   const modal=page.locator('#unit-management-modal'),form=modal.locator('#unit-settings-form'),input=form.locator('#unit-minimum-free-people'),save=form.locator('button[type=submit]');
   await form.evaluate(form=>{window.__form=form;window.__input=form.querySelector('#unit-minimum-free-people');window.__call=form.querySelector('[data-unit-call-minimum]');});
   await input.fill('2');await form.locator('[data-unit-call-minimum]').fill('2');await save.focus();await page.keyboard.press('Enter');await held;await input.fill('3');await input.focus();
   if(scenario==='active-print'){
    await page.emulateMedia({media:'print'});assert.equal(await page.locator('[data-unit-posting-body] tr').count(),3);
   }
   release();
   if(scenario==='missing-unit'){
    const retry=form.locator('[data-retry-unit-settings-read]');await form.getByText(/Rules saved, but the refresh failed/).waitFor();await retry.waitFor();
    assert.equal(await modal.locator('[data-unit-readback-unavailable]').count(),1);assert.match(await modal.locator('.audit-chip-row').innerText(),/unavailable/);assert.match(await modal.locator('.unit-modal-validation').innerText(),/Unavailable/);
    assert.equal(await input.evaluate(input=>input.validity.customError),true);assert.equal(await input.inputValue(),'3');assert.equal(writes.length,1);
    await save.click();await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,80)));assert.equal(writes.length,1,'Native invalid draft must not repeat the update');
    await retry.focus();await page.keyboard.press('Enter');await retryHeld;const retainedFocus=input;await retainedFocus.focus();assert.equal(await retainedFocus.evaluate(e=>e===document.activeElement),true);retryRelease();await form.getByText('Previous rules are saved and refreshed. New edits are not saved yet.',{exact:true}).waitFor();assert.equal(await input.evaluate(e=>e===document.activeElement),true);
    assert.equal(await modal.locator('[data-unit-readback-unavailable]').count(),0);assert.equal(await input.evaluate(input=>input.validity.customError),false);assert.equal(reads,3);
   }else{
    await page.waitForFunction(()=>document.querySelector('#unit-settings-form [role="status"]')?.textContent==='Previous rules are saved and refreshed. New edits are not saved yet.');
    assert.equal(await page.locator('[data-unit-posting-body] tr').count(),2);assert.equal(await page.locator('[data-unit-posting-body]').getByText('Readback Person 2',{exact:true}).count(),0);
    await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.locator('[data-unit-posting-body] tr').count(),2,'Print cleanup must not restore the old three-row snapshot');assert.equal(await page.locator('[data-unit-posting-body]').getByText('Readback Person 2',{exact:true}).count(),0);assert.equal(reads,2);
   }
   assert.equal(await form.evaluate(form=>form===window.__form&&form.querySelector('#unit-minimum-free-people')===window.__input&&form.querySelector('[data-unit-call-minimum]')===window.__call),true);
   assert.equal(await input.inputValue(),'3');assert.equal(await modal.locator('#unit-modal-title').innerText(),'Royal Readback Fresh');assert.equal(writes.length,1);assert.deepEqual(errors,[]);
   await modal.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Royal');assert.equal(await page.locator('select[data-unit-board-campus]').inputValue(),'campus:Main');
   assert.equal(await page.locator('[data-unit-posting-body] tr').count(),2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   results.push({engine,width,scenario,reads,writes,errors,formAndInputIdentityRetained:true,newerDraftRetained:true});console.log(engine+' '+width+' '+scenario+' readback boundary passed');
  }finally{if(release)release();if(retryRelease)retryRelease();await page.emulateMedia({media:'screen'});await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),candidate);assert.equal(sha(await readFile('src/main.ts')),applied);assert.equal(results.length,6);
await writeFile('../docs/premium-ui/qa-profile-parent-v5-settings-newer-input-focus6.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root',scope:'Six V5 profile-candidate shared settings helper contexts,3engines320/1280: missingunit response retainsdraft and nativevalidity. ThirdGET held; newer input focus not stolen is explicitly asserted after returnedunit removesunavailablenotice. Exactform/inputnodes preserved, onePUT and threeGETs; noapp edits or realDB/printercertification.',candidate_sha256:candidate,applied_main_sha256:applied,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Profile V5 shared settings newer-input-focus6:6 contexts passed');
