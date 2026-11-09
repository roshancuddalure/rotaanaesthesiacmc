import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const folder='../tmp/settings159-readback-regions-v4';
const hashes=async()=>Object.fromEntries(await Promise.all(['main.ts','unit-board-filters.ts','unit-settings-recovery.ts'].map(async name=>[name,sha(await readFile(folder+'/'+name))])));
const candidate=await hashes(),applied=sha(await readFile('src/main.ts')),results=[];
const unit={id:'readback-unit',name:'Royal Readback Unit',campus:'Main',code:'RB',minimum_free_people:1,active_status:'active',notes:null};
const people=Array.from({length:3},(_,i)=>({id:'readback-person-'+i,canonical_name:'Readback Person '+i,call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]}));
const assignments=people.map((person,i)=>({id:'readback-posting-'+i,person,unit,posting_type:'2ND_CALL',starts_on:'2026-05-01',ends_on:'2026-05-31',source:'manual',notes:null}));
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const scenario of['wrong-month']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],writes=[];let reads=0,release,started;
  const held=new Promise(resolve=>started=resolve);page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','readback-boundaries');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());
   if(q.method()!=='GET'){assert.equal(q.method(),'PUT');assert.equal(u.pathname,'/api/v1/unit-management/units/readback-unit/settings');assert.deepEqual(q.postDataJSON(),{minimum_free_people:2,call_minimums:[{call_level:'2ND_CALL',minimum_free_people:2}]});writes.push(q.postDataJSON());return route.fulfill({json:{...unit,minimum_free_people:2}});}
   if(u.pathname==='/api/v1/admin/members')return route.fulfill({json:people});
   if(u.pathname==='/api/v1/unit-management/month'){
    reads++;if(reads===2){started();await new Promise(resolve=>release=resolve);}
    const missing=scenario==='missing-unit'&&reads===2,updated=reads>1;
    return route.fulfill({json:{month:reads===2?'2026-06':'2026-05',starts_on:'2026-05-01',ends_on:'2026-05-31',units:missing?[]:[{...unit,name:updated?'Royal Readback Fresh':unit.name,minimum_free_people:updated?2:1}],assignments:missing?[]:updated?assignments.slice(0,2):assignments,unit_summaries:missing?[]:[{unit_id:unit.id,assigned_members:updated?2:3,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:missing?[]:[{unit_id:unit.id,call_level:'2ND_CALL',assigned_members:updated?2:3,minimum_free_people:updated?2:1,max_allowed:updated?2:3}],validation_issues:[]}});
   }
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto('http://127.0.0.1:5284/#view=units',{waitUntil:'domcontentloaded',timeout:60000});
   await page.locator('input[data-unit-board-search]').fill('Royal');await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
   await page.locator('[data-unit-board-card="unit:readback-unit"] button[data-open-unit-modal]').click();
   const modal=page.locator('#unit-management-modal'),form=modal.locator('#unit-settings-form'),input=form.locator('#unit-minimum-free-people'),save=form.locator('button[type=submit]');
   await form.evaluate(form=>{window.__form=form;window.__input=form.querySelector('#unit-minimum-free-people');window.__call=form.querySelector('[data-unit-call-minimum]');});
   await input.fill('2');await form.locator('[data-unit-call-minimum]').fill('2');await save.focus();await page.keyboard.press('Enter');await held;await input.fill('3');await input.focus();
   release();await form.getByText('Previous rules are saved and refreshed. New edits are not saved yet.',{exact:true}).waitFor();
   const header=await modal.locator('.person-modal-header p').innerText();assert.match(header,/2026-06/,'V4 diagnostic expects the wrong-month successful report to repaint modal context');
   assert.equal(await form.locator('[data-retry-unit-settings-read]').isHidden(),true,'V4 wrongly treats the mismatched read as a successful refresh');
   assert.equal(await input.inputValue(),'3');assert.equal(writes.length,1);assert.equal(reads,2);assert.deepEqual(errors,[]);
   results.push({engine,width,scenario,wrongMonthRendered:header,reads,writes,errors,formAndInputIdentityRetained:true,newerDraftRetained:true});console.log(engine+' '+width+' '+scenario+' readback boundary passed');
  }finally{if(release)release();await page.emulateMedia({media:'screen'});await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),candidate);assert.equal(sha(await readFile('src/main.ts')),applied);assert.equal(results.length,6);
await writeFile('../docs/premium-ui/qa-settings159-readback-v4-wrongmonth-diagnostic.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root/settings_readback_resume',scope:'Six frozen V4 scratch defect diagnostics,3engines320/1280. The saved settings read returns successfulHTTP but monthJune instead of capturedMay, with matchingunitID and changed counts. Candidate currently commits that wrong-month report and claimsrefreshsuccess while paintingJune modal context; diagnostic asserts this wrong behavior. One localPUT, no actualDB/appedits. Diagnostic success is a defect reproduction,not accepted behavior.',candidate_sha256:candidate,applied_main_sha256:applied,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Settings V4 wrong-month diagnostic:6 reproductions');
