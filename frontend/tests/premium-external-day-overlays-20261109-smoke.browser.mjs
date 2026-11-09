import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Source-held current application smoke. No application/style changes or synthetic DOM events.
const base='http://127.0.0.1:5197',ram='http://127.0.0.1:8031',report='../docs/premium-ui/qa-external-day-overlays-20261109-smoke.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
const expected={'src/main.ts':'2b8f68c069e599af50a4ac1b2146a7018d6268f290b90a9949130a057dc91b43','src/member-workspace.ts':'105cc1d91ea4815d565ad4859fc01412cf576a3203c07834f4010e3fef7ef1a5','src/styles.css':'306928f568686cfc453178f73731a797f7fe5b9f016d7128bf9cd68dc6e1fb86','src/premium-theme.css':'acc46b2249087f365ca855bcd9630628c390c4cdf013301daaee40ede80e55f4'};
const hashes=async()=>Object.fromEntries(await Promise.all(Object.keys(expected).map(async f=>[f,sha(await readFile(f))])));
await assert.rejects(access(report),{code:'ENOENT'});assert.deepEqual(await hashes(),expected);
const member={id:'overlay-person',canonical_name:'Dr Overlay Smoke',call_level:'1ST_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
const day='2026-11-05',leave={id:'overlay-leave',person:member,leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',starts_on:day,ends_on:day,status:'approved',source:'manual',raw_person_name:null,notes:null,days:1};
const calendar={month:'2026-11',summary:{month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',total_requests:1,blocking_requests:1,people_on_leave:1,total_leave_days:1,busiest_day:{date:day,count:1},status_counts:{approved:1},type_counts:{ANNUAL_LEAVE:1},slot_counts:{FULL_DAY:1},unit_counts:{},call_level_counts:{'1ST_CALL':1}},days:{[day]:[{leave_id:leave.id,person_id:member.id,person_name:member.canonical_name,leave_type:leave.leave_type,leave_slot:leave.leave_slot,status:leave.status,unit:null,posting_type:null,call_level:member.call_level}]}};
const slots=['2026-11-01','2026-11-02'].map((date,i)=>({id:'overlay-slot-'+i,unit_id:'overlay-unit',unit_name:'Overlay Unit',unit_code:'ONE',unit_assignment_label:null,unit_cluster_suffix:null,duty_date:date,duty_type:'MAIN_1ST_24HR',call_level:'1ST_CALL',slot_label:'Main duty',starts_at:date+'T08:00:00',ends_at:date+'T20:00:00',is_24hr:false,max_assignees:1,source:'template',template_status:'ready',is_forced_allocation:false,template_reason:'Fixture ready',assignments:[],notes:null}));
const candidates=slots.map(slot=>({slot_id:slot.id,duty_date:slot.duty_date,duty_type:slot.duty_type,unit_id:slot.unit_id,unit_name:slot.unit_name,unit_code:'ONE',safety_status:'safe',candidates:[]}));
const results=[];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of[320,1280])for(const scenario of['leave','rota']){
  assert.deepEqual(await hashes(),expected);
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:'light',reducedMotion:'reduce'}),reads=[],writes=[],errors=[],outcomes=[];
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','external-overlay-smoke');localStorage.setItem('duty_rota_working_month','2026-11');localStorage.setItem('duty_rota_template_overview_mode','calendar');localStorage.setItem('duty_rota_day_modal_view_mode','full');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url());
   if(q.method()!=='GET'){writes.push({method:q.method(),path:u.pathname});return route.fulfill({status:599,json:{detail:'Smoke blocks every mutation; none forwarded'}});}
   reads.push(u.pathname+u.search);
   const fixture={'/api/v1/admin/members':[member],'/api/v1/leave/calendar':calendar,'/api/v1/leave/requests':[leave],'/api/v1/leave/pressure':{month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',days:[],call_level_totals:{},unit_totals:{}}};
   if(Object.hasOwn(fixture,u.pathname))return route.fulfill({json:fixture[u.pathname]});
   const response=await route.fetch({url:ram+u.pathname+u.search,maxRetries:2});
   if(u.pathname==='/api/v1/rota-template/month'){const data=await response.json();data.slots=slots;Object.assign(data.summary,{total_slots:2,ready_slots:2,needs_review_slots:0,forced_review_slots:0});return route.fulfill({json:data});}
   if(u.pathname==='/api/v1/rota-candidates/month'){const data=await response.json();data.slots=candidates;return route.fulfill({json:data});}
   return route.fulfill({response});
  });
  const record=async(name,action,check)=>{
   try{await action();await check();outcomes.push({name,passed:true});}
   catch(error){outcomes.push({name,passed:false,error:String(error.message)});}
  };
  try{
   await page.goto(base+'/#view='+(scenario==='leave'?'leave':'rota-template'),{waitUntil:'domcontentloaded'});
   const id=scenario==='leave'?'leave-day-modal':'rota-day-modal',modal=page.locator('#'+id);
   const opener=page.locator(scenario==='leave'?'#leave-month-view [data-leave-day="2026-11-05"]':'.rota-calendar-grid [data-rota-day="2026-11-01"]');await opener.waitFor();
   await page.evaluate(()=>{window.overlayClickTargets=[];document.addEventListener('click',event=>{const t=event.target;if(t instanceof Element&&t.closest('#leave-day-modal,#rota-day-modal'))window.overlayClickTargets.push({tag:t.tagName,id:t.id,classes:t.getAttribute('class'),closeButton:!!t.closest('[data-close-leave-day-modal],[data-close-rota-day-modal]'),matchesClose:t.matches('[data-close-leave-day-modal],[data-close-rota-day-modal]')});},{capture:true});});
   const open=async()=>{if(await modal.count()){await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});}await opener.click();await modal.waitFor({state:'visible'});assert.equal(await modal.evaluate(e=>e.parentElement===document.body),true);};
   const detached=()=>modal.waitFor({state:'detached',timeout:2500});
   for(const method of scenario==='leave'?['center','svg-coordinate','escape','backdrop']:['center','escape','backdrop']){
    await open();const before=reads.length;
    await record('close-'+method,async()=>{
     const close=modal.locator(scenario==='leave'?'[data-close-leave-day-modal]':'[data-close-rota-day-modal]');
     if(method==='center')await close.click();
     else if(method==='svg-coordinate'){const box=await close.locator('svg').boundingBox();assert.ok(box);await page.mouse.click(box.x+box.width/2,box.y+box.height/2);}
     else if(method==='escape')await page.keyboard.press('Escape');
     else {const point=await modal.evaluate(e=>{const panel=e.querySelector('section').getBoundingClientRect();for(const p of [{x:2,y:2},{x:innerWidth-2,y:2},{x:2,y:innerHeight-2}])if(!(p.x>=panel.left&&p.x<=panel.right&&p.y>=panel.top&&p.y<=panel.bottom)&&document.elementFromPoint(p.x,p.y)===e)return p;throw new Error('No reachable backdrop point at viewport');});await page.mouse.click(point.x,point.y);}
    },async()=>{await detached();assert.equal(reads.length,before,'Closing overlay should not read or mutate');});
   }
   if(scenario==='leave'){
    await open();
    await record('external-add-leave-opens-editor-with-date',()=>modal.locator('[data-add-operational-record="leave"]').click(),async()=>{const editor=page.getByRole('dialog',{name:'Add leave',exact:true});await editor.waitFor({timeout:4000});await editor.locator('[name=starts_on]').waitFor();assert.equal(await editor.locator('[name=starts_on]').inputValue(),day);assert.equal(await editor.locator('[name=ends_on]').inputValue(),day);await modal.waitFor({state:'detached'});await page.keyboard.press('Escape');await editor.waitFor({state:'detached'});});
   }else{
    await open();
    await record('external-rota-view-control',()=>modal.locator('[data-rota-day-view-mode="compact"]').click(),async()=>{assert.equal(await modal.locator('[data-rota-day-view-mode="compact"]').getAttribute('aria-pressed'),'true');await modal.locator('.rota-day-compact-panel').waitFor();});
    await record('external-rota-next-day-control',()=>modal.locator('[data-rota-day-modal-nav="2026-11-02"]').click(),async()=>{await page.waitForFunction(()=>document.querySelector('#rota-day-modal')?.getAttribute('data-rota-day-modal-day')==='2026-11-02',null,{timeout:3000});});
    await record('external-rota-close-after-actions',()=>modal.locator('[data-close-rota-day-modal]').click(),detached);
   }
   results.push({engine,width,scenario,outcomes,actualClickTargets:await page.evaluate(()=>window.overlayClickTargets),reads,writes,errors,selectedMonth:await page.locator('#working-month').inputValue()});
  }catch(error){results.push({engine,width,scenario,outcomes,setupOrRecoveryFailure:String(error.message),reads,writes,errors});}
  finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(results.length,12);assert.deepEqual(await hashes(),expected);
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Twelve actual external Leave/Rota day-overlay contexts across3engines320/1280; realpointer/keyboard actions, noforce/detached synthetic events, noapp/style edits. Every nonGET blocked. Locallyfulfilled Leave/rota fixtures, otherGETsRAM8031. Not whole260/action/physical acceptance.',source_sha256:expected,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');
assert.ok(results.every(r=>!r.setupOrRecoveryFailure&&r.errors.length===0&&r.writes.length===0&&r.selectedMonth==='2026-11'&&r.outcomes.every(o=>o.passed)),'External-overlay smoke failures retained in report');
