import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),results=[];
const unit={id:'settings-unit',name:'Royal Settings Unit',campus:'Main',code:'SET',minimum_free_people:1,active_status:'active',notes:null};
const people=Array.from({length:3},(_,i)=>({id:'settings-person-'+i,canonical_name:'Dr Settings Person '+i,call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]}));
const assignments=people.map((person,i)=>({id:'settings-posting-'+i,person,unit,posting_type:'2ND_CALL',starts_on:'2026-05-01',ends_on:'2026-05-31',source:'manual',notes:null}));
const expectedMain='e88c69570e7faf9b4277b541e073c8bd2ca3805c23f4feead544f16770f6e07a',expectedHelper='4cfcd55615c77fa39aa08ee57abb3e807412fb9fb6c42af71dbb86a4458ce51d';
const initial=sha(await readFile('src/main.ts')),initialHelper=sha(await readFile('src/unit-settings-recovery.ts'));assert.equal(initial,expectedMain);assert.equal(initialHelper,expectedHelper);
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const scenario of['late-close','late-away-return']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],requests=[];let puts=0,reads=0,release,start,finish,readRelease,readStart;
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
    return route.fulfill({json:{month:'2026-05',starts_on:'2026-05-01',ends_on:'2026-05-31',units:[{...unit,minimum_free_people:puts?2:1}],assignments,unit_summaries:[{unit_id:unit.id,assigned_members:3,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[{unit_id:unit.id,call_level:'2ND_CALL',assigned_members:3,minimum_free_people:puts?2:1,max_allowed:3}],validation_issues:[]}});
   }
   if(u.pathname==='/api/v1/admin/members')return route.fulfill({json:people});
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto('http://127.0.0.1:5197/#view=units');await page.locator('[data-unit-board-card="unit:settings-unit"] button[data-open-unit-modal]').click();
   const modal=page.locator('#unit-management-modal');await modal.locator('#unit-minimum-free-people').fill('2');await modal.locator('[data-unit-call-minimum="2ND_CALL"]').fill('2');
   const form=modal.locator('#unit-settings-form'),save=form.locator('button[type=submit]');await save.focus();await page.keyboard.press('Enter');await pending;assert.equal(await save.isDisabled(),true);
   if(scenario==='late-close') {await modal.locator('button[data-close-unit-modal]').first().click();assert.equal(await modal.count(),0);}
   else {await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();await page.evaluate(()=>location.hash='#view=units');await page.locator('[data-unit-board-card="unit:settings-unit"]').waitFor();if(await modal.count())await modal.locator('button[data-close-unit-modal]').first().click();await modal.waitFor({state:'detached'});}
   const readsBeforeRelease=reads;
   release();await done;
   await page.evaluate(()=>new Promise(r=>setTimeout(r,150)));
   assert.equal(await modal.count(),0);assert.equal(await page.getByText('Unit call-wise rules saved',{exact:true}).count(),0);assert.equal(reads,readsBeforeRelease);assert.equal(puts,1);
   assert.deepEqual(errors,[]);results.push({engine,width,scenario,puts,reads,requests,errors});console.log(engine+' '+width+' '+scenario+' recovery candidate passed');
  }finally{if(readRelease)readRelease();await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile('src/main.ts')),initial);assert.equal(sha(await readFile('src/unit-settings-recovery.ts')),initialHelper);await writeFile('../docs/premium-ui/qa-unit-settings-recovery-v6-integrated-stale12.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/unit_settings_v2_independent_review',scope:'Applied frontend independent12nativecontexts:3engines320/1280 actual modalclose or Guide-away-and-return while PUT held, then confirmed success must not reopen dialog, toast, or launch readback in obsolete form. All PUT locally intercepted; GET fixture only. Applied source is byte guarded; no real DB writes.',test_sha256:sha(await readFile(new URL(import.meta.url))),applied_main_sha256:initial,applied_helper_sha256:initialHelper,results},null,2)+'\n');console.log('Unit settings recovery independent stale:12contexts passed');
