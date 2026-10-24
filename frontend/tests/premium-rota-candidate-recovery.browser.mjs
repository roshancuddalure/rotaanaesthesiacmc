import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import {slots,candidates} from './fixtures/rota-day-fixture.mjs';
const baseline=process.env.CANDIDATE_RECOVERY_BASELINE==='1',results=[];
const hashes=async()=>Object.fromEntries(await Promise.all(['main.ts','styles.css','premium-theme.css'].map(async n=>['frontend/src/'+n,createHash('sha256').update(await readFile('src/'+n)).digest('hex')]))),initial=await hashes();
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of baseline?[320]:[320,1280])for(const scenario of baseline?['late-focus']:['late-focus','late-mode','mode-roundtrip','removed-choice','empty-choice','closed','next-day','navigate-away','failure-retry']){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];let held,arrive,reads=0;const pending=new Promise(r=>arrive=r);
  page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','candidate-recovery');localStorage.setItem('duty_rota_working_month','2026-11');localStorage.setItem('duty_rota_template_overview_mode','calendar');localStorage.setItem('duty_rota_day_modal_view_mode','full');});
  await page.route('**/api/**',async r=>{const q=r.request(),u=new URL(q.url());assert.equal(q.method(),'GET','Candidate display/retry never writes');
   if(u.pathname==='/api/v1/rota-candidates/slots/day-slot-0'){reads++;if(reads===1){held=r;arrive();return;}return r.fulfill({json:candidates[0]});}
   const response=await r.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search});
   if(u.pathname==='/api/v1/rota-template/month'){const data=await response.json();data.slots=slots;Object.assign(data.summary,{total_slots:2,ready_slots:2,needs_review_slots:0,forced_review_slots:0});return r.fulfill({json:data});}
   if(u.pathname==='/api/v1/rota-candidates/month'){const data=await response.json();data.slots=[{...candidates[0],candidates:candidates[0].candidates.slice(0,1)},candidates[1]];return r.fulfill({json:data});}
   return r.fulfill({response});
  });
  await page.goto('http://127.0.0.1:5197/#view=rota-template');const opener=page.locator('.rota-calendar-grid [data-rota-day="2026-11-01"]');await opener.waitFor();await page.waitForLoadState('networkidle');await opener.focus();await page.keyboard.press('Enter');await pending;
  const modal=page.locator('#rota-day-modal'),person=modal.locator('[data-assign-person="day-slot-0"]'),reason=modal.locator('[data-assign-override="day-slot-0"]');await person.selectOption('candidate-0');await reason.fill('Unsaved manual override');await modal.locator('[data-assign-replace="day-slot-0"]').uncheck();await reason.focus();
  await modal.evaluate(e=>{window.heldDayRoot=e;});
  if(scenario==='late-mode'){await modal.locator('[data-rota-day-view-mode=compact]').focus();await page.keyboard.press('Enter');}
  if(scenario==='mode-roundtrip'){
   for(const mode of ['compact','eagle','full']){await modal.locator(`[data-rota-day-view-mode=${mode}]`).focus();await page.keyboard.press('Enter');}
   assert.equal(await reason.inputValue(),'Unsaved manual override');assert.equal(await person.inputValue(),'candidate-0');assert.equal(await modal.locator('[data-assign-replace="day-slot-0"]').isChecked(),false);await reason.focus();
  }
  if(scenario==='closed'){await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});}
  if(scenario==='next-day'){await modal.getByRole('button',{name:'Next rota day',exact:true}).click();await modal.locator('[data-rota-day-view-date="2026-11-02"]').first().waitFor();}
  if(scenario==='navigate-away'){await page.evaluate(()=>{location.hash='view=user-guide';});await page.locator('#guide-checklist').waitFor();}
  const delivered=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/rota-candidates/slots/day-slot-0');
  if(scenario==='failure-retry')await held.fulfill({status:503,json:{detail:'Candidate refresh unavailable'}});
  else await held.fulfill({json:['removed-choice','empty-choice'].includes(scenario)?{...candidates[0],candidates:scenario==='empty-choice'?[]:candidates[0].candidates.slice(1)}:candidates[0]});
  await delivered;await page.waitForLoadState('networkidle');
  const facts={sameRoot:await modal.count()?await modal.evaluate(e=>e===window.heldDayRoot):false,reasonRetained:await reason.count()?(await reason.inputValue())==='Unsaved manual override':false,person:await person.count()?await person.inputValue():null,focusReason:await reason.count()?await reason.evaluate(e=>e===document.activeElement):false};
  if(!baseline){
   if(['closed','navigate-away'].includes(scenario)){assert.equal(await modal.count(),0);if(scenario==='closed')assert.equal(await opener.evaluate(e=>e===document.activeElement),true);}
   else if(scenario==='next-day'){assert.equal(await modal.getAttribute('data-rota-day-modal-day'),'2026-11-02');assert.equal(facts.sameRoot,true);}
   else if(scenario==='late-mode'){assert.equal(await modal.locator('[data-rota-day-view-mode=compact]').getAttribute('aria-pressed'),'true');assert.equal(await modal.locator('[data-rota-day-view-mode=compact]').evaluate(e=>e===document.activeElement),true);assert.equal(facts.sameRoot,true);await modal.locator('[data-rota-day-view-mode=full]').click();assert.equal(await reason.inputValue(),'Unsaved manual override');assert.equal(await person.inputValue(),'candidate-0');assert.equal(await modal.locator('[data-assign-replace="day-slot-0"]').isChecked(),false);}
   else{
    assert.equal(facts.sameRoot,true);assert.equal(facts.reasonRetained,true);assert.equal(facts.focusReason,true);assert.equal(await modal.locator('[data-assign-replace="day-slot-0"]').isChecked(),false);
    assert.equal(facts.person,['removed-choice','empty-choice'].includes(scenario)?'':'candidate-0');
    if(['removed-choice','empty-choice'].includes(scenario))await modal.getByText('The previously selected member is not in the refreshed suggestions. Select a member again.',{exact:true}).waitFor();
    if(scenario==='failure-retry'){
     const retry=modal.locator('[data-retry-rota-day-candidates]');await retry.waitFor();assert.match(await modal.innerText(),/Candidate refresh unavailable/);assert.equal(reads,1);await retry.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('[data-retry-rota-day-candidates]')===null);assert.equal(reads,2);assert.equal(await reason.inputValue(),'Unsaved manual override');assert.equal(await person.inputValue(),'candidate-0');assert.equal(await modal.locator('[data-rota-day-view-mode=full]').evaluate(e=>e===document.activeElement),true);
    }
    await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});assert.equal(await opener.evaluate(e=>e===document.activeElement),true);
   }
   assert.deepEqual(errors,[]);
  }
  results.push({engine,width,scenario,...facts,reads,verified:!baseline,noWrites:true,errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-rota-candidate-recovery'+(baseline?'-before':'')+'.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Actual day popup with held per-slot GET, one cached/ten refreshed candidates; draft/focus, changed mode/day, closed/navigation, removed selection and explicit503retry. GET-only disposable companion shell. No eligibility/persistence/backend certification.',results},null,2)+'\n');console.log(`Rota candidate recovery: ${results.length} workflows`);
