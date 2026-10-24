import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const paths=['src/main.ts','src/ui.ts','src/services/api.ts','src/styles.css','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async n=>['frontend/'+n,createHash('sha256').update(await readFile(n)).digest('hex')]))),initial=await hashes(),results=[];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const scenario of ['refused','confirmed-read-failure','initial-read-failure','late-navigation','late-month','view-only','blocked']){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],posts=[],confirmations=[];let reads=0,published=false,held,arrive,allowInitialRead=false,allowConfirmedRead=false;const pending=new Promise(r=>arrive=r);
  const snapshot=(month='2026-11')=>({month,rota_period:{id:'publish-period',name:month,starts_on:month+'-01',ends_on:month+'-30',status:published&&month==='2026-11'?'published':'draft'},rule_version:{id:'rule-one',name:'Existing reviewed policy'},summary:{total_slots:1,assigned_slots:1,open_slots:0},can_publish:scenario!=='blocked',requires_warning_confirmation:true,checks:[],blockers:scenario==='blocked'?[{status:'error',title:'Scope must be reviewed',detail:'Existing server blocker'}]:[],warnings:[{status:'warning',title:'Review acknowledged warning',detail:'Server-provided warning remains visible'}],latest_publish:published&&month==='2026-11'?{id:'approval-one',rota_period_id:'publish-period',approved_by:'Fixture board',status:'published',confirmed_warnings:true,approval_note:'Board note retained',summary:{},created_at:'2026-11-01T10:00:00Z'}:null});
  page.on('pageerror',e=>errors.push(e.message));let accept=false;page.on('dialog',d=>{confirmations.push(d.message());return accept?d.accept():d.dismiss();});
  await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','publish-recovery');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async r=>{const q=r.request(),u=new URL(q.url());
   if(u.pathname==='/api/v1/rota-publish/publish'){assert.equal(q.method(),'POST');assert.equal(u.searchParams.get('month'),'2026-11');assert.deepEqual(q.postDataJSON(),{confirm_warnings:true,approval_note:'Board note retained'});posts.push(q.postDataJSON());held=r;arrive();return;}
   assert.equal(q.method(),'GET','Only intercepted publish can mutate');
   if(u.pathname==='/api/v1/rota-publish/month'){reads++;if((scenario==='initial-read-failure'&&!allowInitialRead)||(scenario==='confirmed-read-failure'&&published&&!allowConfirmedRead))return r.fulfill({status:503,json:{detail:'Checklist read unavailable'}});return r.fulfill({json:snapshot(u.searchParams.get('month'))});}
   const response=await r.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search});if(u.pathname.endsWith('/auth/me')){const user=await response.json();return r.fulfill({json:{...user,role:scenario==='view-only'?'computer_admin':'rota_board_member',permissions:scenario==='view-only'?[]:['publish_rota']}});}return r.fulfill({response});
  });
  await page.goto('http://127.0.0.1:5197/#view=rota-publish');
  if(scenario==='initial-read-failure'){const retry=page.locator('[data-retry-publish]');await retry.waitFor();assert.equal(posts.length,0);const beforeRetry=reads;allowInitialRead=true;await retry.focus();await page.keyboard.press('Enter');await page.locator('#rota-publish-form').waitFor();assert.equal(await page.locator('#publish-approval-note').evaluate(e=>e===document.activeElement),true);assert.ok(reads>beforeRetry);assert.equal(posts.length,0);}
  const form=page.locator('#rota-publish-form');await form.waitFor();const note=page.locator('#publish-approval-note'),button=form.locator('button[type=submit]');
  assert.match(await page.locator('[data-publish-consequence]').innerText(),/November 2026/);assert.match(await page.locator('[data-publish-consequence]').innerText(),/Applying a generated draft does not publish it/);assert.equal(await page.locator('#download-rota-export').isDisabled(),true);
  if(['view-only','blocked'].includes(scenario)){
   assert.equal(await button.isDisabled(),true);assert.equal(await page.locator('#publish-disabled-reason').innerText(),scenario==='view-only'?'Your account can view but not approve.':'Resolve the checklist blockers above first.');if(scenario==='view-only')assert.equal(await note.isDisabled(),true);assert.equal(confirmations.length,0);
  }else if(scenario!=='initial-read-failure'){
   await button.focus();await page.keyboard.press('Enter');await page.getByText('Approval note is required',{exact:true}).waitFor();assert.equal(await note.evaluate(e=>e===document.activeElement),true);assert.equal(await note.getAttribute('aria-invalid'),'true');assert.equal(posts.length,0);
   await note.fill('Board note retained');assert.equal(await note.getAttribute('aria-invalid'),null);await page.locator('#publish-confirm-warnings').check();
   await button.focus();await page.keyboard.press('Enter');assert.deepEqual(confirmations,['Publish November 2026 as final?']);assert.equal(posts.length,0);assert.equal(await note.inputValue(),'Board note retained');
   const beforePublishReads=reads;accept=true;await button.focus();await page.keyboard.press('Enter');await pending;assert.equal(await form.getAttribute('aria-busy'),'true');
   await form.evaluate(e=>e.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(posts.length,1);assert.equal(confirmations.length,2,'Pending form blocks duplicate submission before confirmation');
   if(scenario==='late-navigation'){await page.evaluate(()=>{location.hash='view=user-guide';});await page.locator('#guide-checklist').waitFor();}
   if(scenario==='late-month'){await page.locator('#working-month').fill('2026-12');await page.locator('#working-month').press('Tab');await page.getByText('December 2026',{exact:true}).first().waitFor();}
   const delivered=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/rota-publish/publish');
   if(scenario==='refused')await held.fulfill({status:503,json:{detail:'Publication could not be confirmed'}});else{published=true;await held.fulfill({json:snapshot()});}
   await delivered;await page.waitForLoadState('networkidle');
   if(scenario==='refused'){await page.getByText('Publication could not be confirmed',{exact:true}).waitFor();assert.equal(await note.inputValue(),'Board note retained');assert.equal(await page.locator('#publish-confirm-warnings').isChecked(),true);assert.equal(await button.isEnabled(),true);assert.equal(await form.getAttribute('aria-busy'),null);assert.equal(await page.locator('#download-rota-export').isDisabled(),true);assert.equal(reads,beforePublishReads);}
   if(scenario==='confirmed-read-failure'){await page.getByText('Publication recorded; checklist could not refresh',{exact:true}).waitFor();assert.match(await page.locator('#view-root').innerText(),/server confirmed publication for November 2026/);assert.equal(await form.count(),0);const retry=page.locator('[data-retry-publish=confirmed]');const beforeRetry=reads;allowConfirmedRead=true;await retry.focus();await page.keyboard.press('Enter');await page.locator('#download-rota-export:not(:disabled)').waitFor();assert.equal(await page.locator('#download-rota-export').evaluate(e=>e===document.activeElement),true);assert.equal(posts.length,1);assert.ok(reads>beforeRetry);await page.getByText('Board note retained',{exact:true}).waitFor();}
   if(scenario==='late-navigation'){assert.match(page.url(),/#view=user-guide$/);assert.equal(await form.count(),0);}
   if(scenario==='late-month'){assert.equal(await page.locator('#working-month').inputValue(),'2026-12');assert.equal(await note.inputValue(),'');assert.equal(await page.locator('#download-rota-export').isDisabled(),true);}
   if(['late-navigation','late-month'].includes(scenario))assert.equal(await page.getByText('Final rota published',{exact:true}).count(),0,'Late result cannot announce current-screen success');
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  let axe=null;if(engine==='chromium'&&['refused','confirmed-read-failure'].includes(scenario)){const a=await new AxeBuilder({page}).include('#view-root').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(a.violations.map(v=>v.id),[]);axe=0;}
  results.push({engine,width,scenario,readCount:reads,interceptedPublishCount:posts.length,monthScopedConfirmation:true,existingPayload:true,noDuplicateOrAutomaticReplay:true,noOtherBackendWrites:true,scopedAxeViolations:axe,errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-publish-recovery.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Actual publish page with existing role gates and intercepted publish. Missing note, cancel, duplicate guard,503 refusal, confirmedPOST/read503 thenGET-only retry, initialGETretry, late route/month outcomes. Three engines320/1280; no actual publication/backend writes.',results},null,2)+'\n');console.log(`Publish recovery: ${results.length} workflows`);
