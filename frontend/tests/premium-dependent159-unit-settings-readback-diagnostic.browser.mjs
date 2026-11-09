import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),sources=['main','unit-modal-accessibility','services/api'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async n=>['frontend/src/'+n+'.ts',sha(await readFile('src/'+n+'.ts'))]))),initial=await hashes();
const unit={id:'settings-unit',name:'Royal Settings Unit',campus:'Main',code:'SET',minimum_free_people:1,active_status:'active',notes:null};
const people=Array.from({length:3},(_,i)=>({id:'settings-person-'+i,canonical_name:'Dr Settings Person '+i,call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]}));
const assignments=people.map((person,i)=>({id:'settings-posting-'+i,person,unit,posting_type:'2ND_CALL',starts_on:'2026-05-01',ends_on:'2026-05-31',source:'manual',notes:null}));
const expected={minimum_free_people:2,call_minimums:[{call_level:'2ND_CALL',minimum_free_people:2}]},results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const scenario of['readback-failure','late-guide']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],requests=[];let puts=0,reads=0,release,start,finish;
  const pending=new Promise(r=>start=r),done=new Promise(r=>finish=r);
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','settings-readback-diag');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url());requests.push({method:q.method(),path:u.pathname,body:q.method()==='GET'?null:q.postDataJSON()});
   if(q.method()==='PUT'&&u.pathname==='/api/v1/unit-management/units/settings-unit/settings'){
    assert.deepEqual(q.postDataJSON(),expected);assert.equal(u.search,'?month=2026-05');puts++;if(puts===1){start();await new Promise(r=>release=r);}await route.fulfill({json:{...unit,minimum_free_people:2}});finish();return;
   }
   assert.equal(q.method(),'GET');
   if(u.pathname==='/api/v1/unit-management/month'){
    reads++;if(scenario==='readback-failure'&&reads===2)return route.fulfill({status:503,json:{detail:'Confirmed settings; dependent readback unavailable'}});
    return route.fulfill({json:{month:'2026-05',starts_on:'2026-05-01',ends_on:'2026-05-31',units:[{...unit,minimum_free_people:puts?2:1}],assignments,unit_summaries:[{unit_id:unit.id,assigned_members:3,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[{unit_id:unit.id,call_level:'2ND_CALL',assigned_members:3,minimum_free_people:puts?2:1,max_allowed:3}],validation_issues:[]}});
   }
   if(u.pathname==='/api/v1/admin/members')return route.fulfill({json:people});
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto('http://127.0.0.1:5197/#view=units');await page.locator('[data-unit-board-card="unit:settings-unit"] button[data-open-unit-modal]').click();
   const modal=page.locator('#unit-management-modal');await modal.locator('#unit-minimum-free-people').fill('2');await modal.locator('[data-unit-call-minimum="2ND_CALL"]').fill('2');
   await modal.locator('#unit-settings-form button[type=submit]').click();await pending;
   if(scenario==='late-guide'){await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();}
   const modalBeforeRelease=await modal.count();release();await done;
   let outcome;
   if(scenario==='readback-failure'){
    await page.getByText('Confirmed settings; dependent readback unavailable',{exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('#unit-settings-form button[type=submit]')?.disabled);
    assert.equal(puts,1);assert.equal(reads,2);
    const readRetryControls=await modal.getByRole('button',{name:/retry|refresh/i}).allTextContents();
    await modal.locator('#unit-settings-form button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#unit-settings-form button[type=submit]')?.disabled===false);for(let n=0;puts<2&&n<100;n++)await new Promise(r=>setTimeout(r,20));
    assert.equal(puts,2,'Diagnostic: enabled Save repeats already confirmed PUT after GET failure');assert.equal(reads,3);
    outcome={puts,reads,readRetryControls,confirmedSaveRetriedAsPut:true};
   }else{
    await modal.waitFor();await page.getByText('Unit call-wise rules saved',{exact:true}).waitFor();assert.equal(await page.locator('#guide-checklist').count(),1);assert.equal(await page.evaluate(()=>location.hash),'#view=user-guide');
    outcome={puts,reads,modalBeforeRelease,modalAfterRelease:await modal.count(),lateUnitModalOpenedOverGuide:true};
   }
   assert.deepEqual(errors,[]);results.push({engine,width,scenario,outcome,requests,errors});console.log(engine+' '+width+' '+scenario+' settings diagnostic recorded');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-dependent159-unit-settings-readback-diagnostic.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/dependent159_final_scope_review',scope:'Diagnostic twelve native unit-settings cases: confirmed PUT then dependent GET503 permits same PUT on enabled Save; held success after actual Guide navigation opens unit modal over Guide. All writes locallyfulfilled, GETfixtureonly. Asserts observed defect,not correct accepted behavior.',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,results},null,2)+'\n');console.log('Unit settings159 diagnostic:12states recorded');
