import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),results=[];
const unit={id:'settings-unit',name:'Royal Settings Unit',campus:'Main',code:'SET',minimum_free_people:1,active_status:'active',notes:null};
const people=Array.from({length:3},(_,i)=>({id:'settings-person-'+i,canonical_name:'Dr Settings Person '+i,call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]}));
const assignments=people.map((person,i)=>({id:'settings-posting-'+i,person,unit,posting_type:'2ND_CALL',starts_on:'2026-05-01',ends_on:'2026-05-31',source:'manual',notes:null}));
const expectedMain='e88c69570e7faf9b4277b541e073c8bd2ca3805c23f4feead544f16770f6e07a',expectedHelper='4cfcd55615c77fa39aa08ee57abb3e807412fb9fb6c42af71dbb86a4458ce51d';
const initial=sha(await readFile('src/main.ts')),initialHelper=sha(await readFile('src/unit-settings-recovery.ts'));assert.equal(initial,expectedMain);assert.equal(initialHelper,expectedHelper);
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const scenario of['pending-new-draft']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],requests=[];let puts=0,reads=0,release,start,finish,readRelease,readStart;
  const returnedMinimums=[];
  const pending=new Promise(r=>start=r),done=new Promise(r=>finish=r),readPending=new Promise(r=>readStart=r);
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','settings-recovery');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url());requests.push({method:q.method(),path:u.pathname,body:q.method()==='GET'?null:q.postDataJSON()});
   if(q.method()==='PUT'&&u.pathname==='/api/v1/unit-management/units/settings-unit/settings'){
    assert.deepEqual(q.postDataJSON(),{minimum_free_people:2,call_minimums:[{call_level:'2ND_CALL',minimum_free_people:2}]});assert.equal(u.search,'?month=2026-05');puts++;if(puts===1){start();await new Promise(r=>release=r);}
    if(scenario==='unconfirmed-save'&&puts===1){await route.fulfill({status:503,json:{detail:'Settings mutation unconfirmed'}});finish();return;}
    await route.fulfill({json:{...unit,minimum_free_people:2}});finish();return;
   }
   assert.equal(q.method(),'GET');
   if(u.pathname==='/api/v1/unit-management/month'){
    reads++;if(reads===2&&scenario==='pending-new-draft'){readStart();await new Promise(r=>readRelease=r);}
    if(reads===2&&['readback-retry','pending-new-draft'].includes(scenario))return route.fulfill({status:503,json:{detail:'Saved rules read unavailable'}});
    returnedMinimums.push(puts?2:1);
    return route.fulfill({json:{month:'2026-05',starts_on:'2026-05-01',ends_on:'2026-05-31',units:[{...unit,minimum_free_people:puts?2:1}],assignments:puts?assignments.slice(0,2):assignments,unit_summaries:[{unit_id:unit.id,assigned_members:puts?2:3,people_with_leave:puts?1:0,leave_days:puts?2:0,leave_by_call_level:{}}],unit_call_minimums:[{unit_id:unit.id,call_level:'2ND_CALL',assigned_members:puts?2:3,minimum_free_people:puts?2:1,max_allowed:puts?2:3}],validation_issues:puts?[{severity:'warning',code:'changed-readback',message:'Changed validation returned by fresh read',unit_id:unit.id,posting_id:assignments[0].id,person_id:people[0].id}]:[]}});
   }
   if(u.pathname==='/api/v1/admin/members')return route.fulfill({json:people});
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto('http://127.0.0.1:5281/#view=units');await page.locator('[data-unit-board-card="unit:settings-unit"] button[data-open-unit-modal]').click();
   const modal=page.locator('#unit-management-modal');const savedChip=modal.locator('.audit-chip-row > span').filter({hasText:'configured fallback min free'});assert.equal(await savedChip.locator('strong').innerText(),'1');await modal.locator('#unit-minimum-free-people').fill('2');await modal.locator('[data-unit-call-minimum="2ND_CALL"]').fill('2');
   const form=modal.locator('#unit-settings-form'),save=form.locator('button[type=submit]');await form.evaluate(form=>{window.__retainedSettingsForm=form;window.__retainedSettingsInput=form.querySelector('#unit-minimum-free-people');window.__retainedCallInput=form.querySelector('[data-unit-call-minimum]');});await save.focus();await page.keyboard.press('Enter');await pending;assert.equal(await save.isDisabled(),true);
   if(scenario==='late-guide'){await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();assert.equal(await modal.count(),0);}
   release();await done;
   if(scenario==='late-guide'){
    await page.evaluate(()=>new Promise(r=>setTimeout(r,100)));assert.equal(await modal.count(),0);assert.equal(await page.locator('#guide-checklist').count(),1);assert.equal(await page.getByText('Unit call-wise rules saved',{exact:true}).count(),0);assert.equal(reads,1);
   }else if(scenario==='unconfirmed-save'){
    await form.getByText('Settings mutation unconfirmed',{exact:true}).waitFor();assert.equal(await save.isEnabled(),true);assert.equal(await form.locator('[data-retry-unit-settings-read]').isHidden(),true);assert.equal(puts,1);await save.click();await page.getByText('Unit call-wise rules saved',{exact:true}).waitFor();assert.equal(puts,2);assert.equal(reads,2);
   }else{
    if(scenario==='pending-new-draft'){
     await readPending;await form.locator('#unit-minimum-free-people').fill('3');await form.locator('#unit-minimum-free-people').focus();assert.equal(await save.isDisabled(),true);readRelease();
    }
    await form.getByText(/Rules saved, but the refresh failed/).waitFor();const retry=form.locator('[data-retry-unit-settings-read]');await retry.waitFor();assert.equal(puts,1);assert.equal(reads,2);
    assert.equal(await save.isDisabled(),scenario==='readback-retry');
    if(scenario==='readback-retry'){await form.locator('#unit-minimum-free-people').fill('2.0');assert.equal(await save.isDisabled(),true);await form.locator('#unit-minimum-free-people').fill('2');}
    if(scenario==='pending-new-draft'){assert.equal(await form.locator('#unit-minimum-free-people').inputValue(),'3');assert.equal(await form.locator('#unit-minimum-free-people').evaluate(e=>e===document.activeElement),true);}
    await retry.focus();await page.keyboard.press('Enter');
    if(scenario==='pending-new-draft'){await form.getByText('Previous rules are saved and refreshed. New edits are not saved yet.',{exact:true}).waitFor();assert.equal(await form.locator('#unit-minimum-free-people').inputValue(),'3');assert.equal(await save.isEnabled(),true);assert.equal(await retry.isHidden(),true);assert.equal(await form.getByText('Previous rules are saved and refreshed. New edits are not saved yet.',{exact:true}).evaluate(e=>e===document.activeElement),true);}
    else {await page.getByText('Unit call-wise rules saved',{exact:true}).waitFor();assert.equal(await modal.locator('#unit-minimum-free-people').inputValue(),'2');}
    assert.equal(puts,1);assert.equal(reads,3);
   }
   assert.deepEqual(errors,[]);
   const observed={engine,width,scenario,puts,reads,returnedMinimums,savedFallbackBefore:1,savedFallbackAfterRefresh:Number(await savedChip.locator('strong').innerText()),newUnsavedDraft:await form.locator('#unit-minimum-free-people').inputValue(),status:await form.locator('[role=status]').innerText(),requests,errors};
   assert.deepEqual(returnedMinimums,[1,2]);assert.equal(observed.newUnsavedDraft,'3');
   observed.dependentRegions={assignedSummary:Number(await modal.locator('.audit-chip-row > span').filter({hasText:'assigned this month'}).locator('strong').innerText()),expectedAssignedSummary:2,memberCards:await modal.locator('[data-unit-row-form]').count(),expectedMemberCards:2,validationSummary:await modal.locator('.unit-modal-validation > summary').innerText(),expectedValidationCount:1,callAssignedText:await form.locator('.unit-call-minimum-row small').innerText(),expectedCallAssigned:2,callMaximum:await form.locator('[data-unit-call-minimum="2ND_CALL"]').getAttribute('max'),expectedCallMaximum:'2'};
   assert.equal(observed.dependentRegions.assignedSummary,2);assert.equal(observed.dependentRegions.memberCards,2);assert.ok(observed.dependentRegions.validationSummary.includes('1'));assert.equal(observed.dependentRegions.callMaximum,'2');assert.match(observed.dependentRegions.callAssignedText,/2 assigned/);assert.equal(await form.evaluate(form=>form===window.__retainedSettingsForm&&form.querySelector('#unit-minimum-free-people')===window.__retainedSettingsInput&&form.querySelector('[data-unit-call-minimum]')===window.__retainedCallInput),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   observed.recoveryVerified=observed.savedFallbackAfterRefresh===returnedMinimums.at(-1);
   assert.equal(observed.recoveryVerified,true,'Fresh saved fallback summary must match confirmed readback');
   const directory='../docs/premium-ui/screenshots/settings159-readback-regions-v1-author';await mkdir(directory,{recursive:true});await savedChip.scrollIntoViewIfNeeded();await page.screenshot({path:directory+'/'+engine+'-'+width+'.png',fullPage:false});
   results.push(observed);console.log(engine+' '+width+' confirmed stale saved fallback '+observed.savedFallbackAfterRefresh+' vs returned '+returnedMinimums.at(-1)+' while unsaved draft3 retained');
  }finally{if(readRelease)readRelease();await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile('src/main.ts')),initial);assert.equal(sha(await readFile('src/unit-settings-recovery.ts')),initialHelper);
assert.equal(results.length,6);assert.ok(results.every(row=>row.recoveryVerified));
await writeFile('../docs/premium-ui/qa-settings159-readback-regions-v1-author.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/settings_readback_resume',decision:'Scratch V1 six author contexts passed fresh saved-summary, assignment cards, validation and call-bound readback while retaining exact form/input nodes, unsaved draft3, keyboard status focus and GET-only retry.',scope:'3engines320/1280 on frozen scratch5281. Existing diagnostic converted to expected fresh values; all original draft/focus/request assertions retained. All writes local; fresh read intentionally returns concurrent changed summaries/members. Not application integration, not whole159. Candidate main separately bound.',candidate_sha256:sha(await readFile('../tmp/settings159-readback-regions-v1/main.ts')),test_sha256:sha(await readFile(new URL(import.meta.url))),applied_main_sha256:initial,applied_helper_sha256:initialHelper,results},null,2)+'\n');console.log('Scratch settings readback V1:6 contexts passed;159 remains open.');
