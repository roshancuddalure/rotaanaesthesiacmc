import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import {slots as originalSlots,candidates as originalCandidates} from './fixtures/rota-day-fixture.mjs';
const slots=originalSlots.map(s=>({...s,duty_date:'2026-11-01'})),candidates=originalCandidates.map(s=>({...s,duty_date:'2026-11-01'}));
const hashes=async()=>Object.fromEntries(await Promise.all(['main.ts','styles.css','premium-theme.css'].map(async n=>['frontend/src/'+n,createHash('sha256').update(await readFile('src/'+n)).digest('hex')]))),initial=await hashes(),results=[];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],held=new Map(),reads=new Map();let arrive;const waiting=new Promise(r=>arrive=r);
  page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','partial-candidates');localStorage.setItem('duty_rota_working_month','2026-11');localStorage.setItem('duty_rota_template_overview_mode','calendar');localStorage.setItem('duty_rota_day_modal_view_mode','full');});
  await page.route('**/api/**',async r=>{const q=r.request(),u=new URL(q.url());assert.equal(q.method(),'GET','Partial candidate display never writes');
   if(u.pathname.startsWith('/api/v1/rota-candidates/slots/')){const id=u.pathname.split('/').at(-1);assert.ok(['day-slot-0','day-slot-1'].includes(id));reads.set(id,(reads.get(id)||0)+1);if(reads.get(id)===1){held.set(id,r);if(held.size===2)arrive();return;}return r.fulfill({json:candidates.find(c=>c.slot_id===id)});}
   const response=await r.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search});
   if(u.pathname==='/api/v1/rota-template/month'){const d=await response.json();d.slots=slots;Object.assign(d.summary,{total_slots:2,ready_slots:2});return r.fulfill({json:d});}
   if(u.pathname==='/api/v1/rota-candidates/month'){const d=await response.json();d.slots=candidates.map(c=>({...c,candidates:c.candidates.slice(0,1)}));return r.fulfill({json:d});}
   return r.fulfill({response});
  });
  await page.goto('http://127.0.0.1:5197/#view=rota-template');const opener=page.locator('.rota-calendar-grid [data-rota-day="2026-11-01"]');await opener.waitFor();await page.waitForLoadState('networkidle');await opener.focus();await page.keyboard.press('Enter');await waiting;
  const modal=page.locator('#rota-day-modal');
  for(const i of [0,1]){await modal.locator(`[data-assign-person="day-slot-${i}"]`).selectOption('candidate-0');await modal.locator(`[data-assign-override="day-slot-${i}"]`).fill('Retained slot '+i);}
  await modal.locator('[data-assign-replace="day-slot-0"]').uncheck();const reason=modal.locator('[data-assign-override="day-slot-1"]');await reason.focus();
  await held.get('day-slot-0').fulfill({status:503,json:{detail:'One slot candidate read failed'}});const retry=modal.locator('[data-retry-rota-day-candidates]');await retry.waitFor();assert.equal(await reason.evaluate(e=>e===document.activeElement),true);
  await held.get('day-slot-1').fulfill({json:candidates[1]});await page.waitForLoadState('networkidle');
  for(const i of [0,1]){assert.equal(await modal.locator(`[data-assign-person="day-slot-${i}"] option`).count(),2,'Existing all-or-nothing read commit remains intact');assert.equal(await modal.locator(`[data-assign-override="day-slot-${i}"]`).inputValue(),'Retained slot '+i);}
  assert.deepEqual([...reads.values()],[1,1],'Failure does not automatically retry either read');
  await retry.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.querySelector('[data-retry-rota-day-candidates]'));await page.waitForLoadState('networkidle');
  assert.deepEqual([...reads.values()],[2,2]);
  for(const i of [0,1]){assert.equal(await modal.locator(`[data-assign-person="day-slot-${i}"] option`).count(),11);assert.equal(await modal.locator(`[data-assign-person="day-slot-${i}"]`).inputValue(),'candidate-0');assert.equal(await modal.locator(`[data-assign-override="day-slot-${i}"]`).inputValue(),'Retained slot '+i);}
  assert.equal(await modal.locator('[data-assign-replace="day-slot-0"]').isChecked(),false);assert.equal(await modal.locator('[data-assign-replace="day-slot-1"]').isChecked(),true);
  for(const mode of ['compact','eagle','full']){await modal.locator(`[data-rota-day-view-mode=${mode}]`).focus();await page.keyboard.press('Enter');}
  for(const i of [0,1])assert.equal(await modal.locator(`[data-assign-override="day-slot-${i}"]`).inputValue(),'Retained slot '+i);
  await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});assert.equal(await opener.evaluate(e=>e===document.activeElement),true);
  await opener.focus();await page.keyboard.press('Enter');await modal.waitFor();assert.equal(await modal.locator('[data-assign-override="day-slot-0"]').inputValue(),'','Closed popup drafts are not persisted to a fresh popup');assert.equal(await modal.locator('[data-assign-person="day-slot-0"]').inputValue(),'');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  results.push({engine,width,slots:2,mixedFailureRetainsOriginalLists:true,lateSiblingDoesNotPartiallyCommit:true,explicitRetryReadsPerSlot:2,distinctSlotDraftsAndCheckboxesPreserved:true,allThreeViewsRetainDraft:true,freshPopupHasNoOldDraft:true,originalOpenerFocus:true,noWrites:true,errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-rota-candidate-partial.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Two-slot actual day popup with one503 and one late successfulGET. Existing Promise.all commit preserved, explicit retry both reads, per-slot drafts across views and fresh-popup isolation. Three engines320/1280; GET-only fixtures, no backend writes.',results},null,2)+'\n');console.log(`Partial candidate recovery: ${results.length} workflows`);
