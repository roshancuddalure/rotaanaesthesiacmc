import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),results=[];
const unit={id:'settings-unit',name:'Royal Settings Unit',campus:'Main',code:'SET',minimum_free_people:1,active_status:'active',notes:null};
const people=Array.from({length:3},(_,i)=>({id:'settings-person-'+i,canonical_name:'Dr Settings Person '+i,call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]}));
const assignments=people.map((person,i)=>({id:'settings-posting-'+i,person,unit,posting_type:'2ND_CALL',starts_on:'2026-05-01',ends_on:'2026-05-31',source:'manual',notes:null}));
const expectedMain='d13bd73108d89d6efb70a66426e6f8e9f6e50400475575b7a40cb06eef12c1bc',expectedHelper='4cfcd55615c77fa39aa08ee57abb3e807412fb9fb6c42af71dbb86a4458ce51d';
const initial=sha(await readFile('src/main.ts')),initialHelper=sha(await readFile('src/unit-settings-recovery.ts'));assert.equal(initial,expectedMain);assert.equal(initialHelper,expectedHelper);
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const topology of['same','added','removed'])for(const scenario of['pending-new-draft']){
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
    return route.fulfill({json:{month:'2026-05',starts_on:'2026-05-01',ends_on:'2026-05-31',units:[{...unit,name:puts?'Royal Settings Unit Fresh':unit.name,minimum_free_people:puts?2:1},...(puts?[{...unit,id:'settings-unit-next',name:'Royal Next Unit',code:'NEXT'}]:[])],assignments:puts?assignments.slice(0,2):assignments,unit_summaries:[{unit_id:unit.id,assigned_members:puts?2:3,people_with_leave:puts?1:0,leave_days:puts?2:0,leave_by_call_level:{}}],unit_call_minimums:puts&&topology==='removed'?[]:[{unit_id:unit.id,call_level:'2ND_CALL',assigned_members:puts?2:3,minimum_free_people:puts?2:1,max_allowed:puts?2:3},...(puts&&topology==='added'?[{unit_id:unit.id,call_level:'3RD_CALL',assigned_members:1,minimum_free_people:0,max_allowed:1}]:[])],validation_issues:puts?[{severity:'warning',code:'changed-readback',message:'Changed validation returned by fresh read',unit_id:unit.id,posting_id:assignments[0].id,person_id:people[0].id}]:[]}});
   }
   if(u.pathname==='/api/v1/admin/members')return route.fulfill({json:people});
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto('http://127.0.0.1:5285/#view=units',{waitUntil:'domcontentloaded',timeout:60000});await page.locator('input[data-unit-board-search]').fill('Royal');await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Royal');assert.equal(await page.locator('select[data-unit-board-campus]').inputValue(),'campus:Main');await page.locator('input[data-unit-board-search]').evaluate(input=>window.__retainedBoardSearch=input);await page.locator('[data-unit-board-card="unit:settings-unit"] button[data-open-unit-modal]').click();
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
   const observed={engine,width,topology,scenario,puts,reads,returnedMinimums,savedFallbackBefore:1,savedFallbackAfterRefresh:Number(await savedChip.locator('strong').innerText()),newUnsavedDraft:await form.locator('#unit-minimum-free-people').inputValue(),status:await form.locator('[role=status]').innerText(),requests,errors};
   assert.deepEqual(returnedMinimums,[1,2]);assert.equal(observed.newUnsavedDraft,'3');
   observed.dependentRegions={assignedSummary:Number(await modal.locator('.audit-chip-row > span').filter({hasText:'assigned this month'}).locator('strong').innerText()),expectedAssignedSummary:2,memberCards:await modal.locator('[data-unit-row-form]').count(),expectedMemberCards:2,validationSummary:await modal.locator('.unit-modal-validation > summary').innerText(),expectedValidationCount:1,callAssignedText:await form.locator('[data-unit-call-minimum="2ND_CALL"]').locator('..').locator('small').first().innerText(),expectedCallAssigned:2,callMaximum:await form.locator('[data-unit-call-minimum="2ND_CALL"]').getAttribute('max'),expectedCallMaximum:'2'};
   assert.equal(observed.dependentRegions.assignedSummary,2);assert.equal(observed.dependentRegions.memberCards,2);assert.ok(observed.dependentRegions.validationSummary.includes('1'));if(topology==='removed'){assert.equal(await form.locator('[data-unit-call-minimum="2ND_CALL"]').evaluate(input=>input.validity.customError),true);assert.equal(await form.locator('[data-unit-call-unavailable]').count(),1);}else{assert.equal(observed.dependentRegions.callMaximum,'2');assert.match(observed.dependentRegions.callAssignedText,/2 assigned/);}if(topology==='added')assert.equal(await form.locator('[data-unit-call-minimum="3RD_CALL"]').inputValue(),'0');assert.equal(await form.evaluate(form=>form===window.__retainedSettingsForm&&form.querySelector('#unit-minimum-free-people')===window.__retainedSettingsInput&&form.querySelector('[data-unit-call-minimum]')===window.__retainedCallInput),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   observed.recoveryVerified=observed.savedFallbackAfterRefresh===returnedMinimums.at(-1);
   assert.equal(observed.recoveryVerified,true,'Fresh saved fallback summary must match confirmed readback');
   const directory='../docs/premium-ui/screenshots/settings159-readback-regions-v5-author';await mkdir(directory,{recursive:true});await savedChip.scrollIntoViewIfNeeded();await page.screenshot({path:directory+'/'+engine+'-'+width+'-'+topology+'.png',fullPage:false});
   assert.equal(await modal.locator('#unit-modal-title').innerText(),'Royal Settings Unit Fresh');assert.equal(await modal.getByRole('button',{name:'Next unit',exact:true}).isEnabled(),true);
   await modal.getByRole('button',{name:'Close',exact:true}).click();
   assert.equal(await page.locator('input[data-unit-board-search]').evaluate(input=>input===window.__retainedBoardSearch),true);assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Royal');assert.equal(await page.locator('select[data-unit-board-campus]').inputValue(),'campus:Main');
   assert.equal(await page.locator('[data-unit-board-card="unit:settings-unit"]').getByText('Royal Settings Unit Fresh',{exact:true}).count(),1);
   assert.match(await page.locator('.board-metrics .metric').filter({hasText:'Postings'}).innerText(),/^2/);assert.match(await page.locator('.board-metrics .metric').filter({hasText:'Setup issues'}).innerText(),/^1/);
   assert.equal(await page.locator('[data-unit-posting-body] tr').count(),2);assert.equal(await page.locator('[data-unit-posting-body]').getByText('Dr Settings Person 2',{exact:true}).count(),0);
   assert.equal(puts,1);assert.equal(reads,3);assert.deepEqual(errors,[]);observed.boardAfterCloseVerified=true;
   results.push(observed);console.log(engine+' '+width+' confirmed stale saved fallback '+observed.savedFallbackAfterRefresh+' vs returned '+returnedMinimums.at(-1)+' while unsaved draft3 retained');
  }finally{if(readRelease)readRelease();await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile('src/main.ts')),initial);assert.equal(sha(await readFile('src/unit-settings-recovery.ts')),initialHelper);
assert.equal(results.length,18);assert.ok(results.every(row=>row.recoveryVerified));
await writeFile('../docs/premium-ui/qa-settings159-readback-regions-v5-author.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/settings_v5_finish',decision:'Scratch V2 eighteen author contexts exercise same/added/removed call rows, current header/navigation and underlying board afterclose in addition to summary/card/validation readback while retaining exact form/input nodes, unsaved draft3, keyboard status focus and GET-only retry.',scope:'3engines320/1280 on frozen scratch5285. Existing diagnostic converted to expected fresh values; all original draft/focus/request assertions retained. All writes local; fresh read intentionally returns concurrent changed summaries/members. Not application integration, not whole159. Candidate main separately bound.',candidate_sha256:sha(await readFile('../tmp/settings159-readback-regions-v5/main.ts')),candidate_board_sha256:sha(await readFile('../tmp/settings159-readback-regions-v5/unit-board-filters.ts')),candidate_helper_sha256:sha(await readFile('../tmp/settings159-readback-regions-v5/unit-settings-recovery.ts')),test_sha256:sha(await readFile(new URL(import.meta.url))),applied_main_sha256:initial,applied_helper_sha256:initialHelper,results},null,2)+'\n');console.log('Scratch settings readback V2:18 contexts passed;159 remains open.');
