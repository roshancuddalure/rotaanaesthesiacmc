import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const hashes=async()=>Object.fromEntries(await Promise.all(['workspace-load-state.ts','record-workspace.ts','styles.css','premium-theme.css'].map(async n=>['frontend/src/'+n,createHash('sha256').update(await readFile('src/'+n)).digest('hex')]))),initial=await hashes(),results=[];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const scenario of ['success','closed','failure-retry']){
  const context=await browser.newContext({viewport:{width,height:800},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];let held,arrive,memberReads=0;const pending=new Promise(r=>arrive=r);
  page.on('pageerror',e=>errors.push(e.message));
  const members=[{id:'person-one',canonical_name:'Dr Loading Example',active_status:'active',call_level:'2ND_CALL'}];
  await page.route('**/__editor_skeleton',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open leave editor</button></body></html>'}));
  await page.route('**/api/**',async r=>{assert.equal(r.request().method(),'GET');const p=new URL(r.request().url()).pathname;if(p.endsWith('/admin/members')){memberReads++;if(memberReads===1){held=r;arrive();return;}return r.fulfill({json:members});}if(p.endsWith('/normalization/units'))return r.fulfill({json:[]});const key=p.split('/').at(-1),value={leave_type:'CL',leave_slot:'FULL_DAY',leave_status:'requested'}[key];assert.ok(value,p);return r.fulfill({json:[{key:value,label:'Current choice',active:true}]});});
  await page.goto('http://127.0.0.1:5197/__editor_skeleton');await page.evaluate(()=>{document.querySelector('#open').onclick=()=>import('/src/record-workspace.ts').then(m=>m.openRecordEditor('leave','person-one',undefined,true,()=>{}));});await page.locator('#open').focus();await page.keyboard.press('Enter');await pending;
  const dialog=page.locator('dialog.record-workspace'),shape=dialog.locator('.workspace-load-skeleton');await shape.waitFor();assert.equal(await shape.getAttribute('aria-hidden'),'true');assert.equal(await shape.locator('input,select,textarea,button,a').count(),0);assert.equal(await shape.locator('.workspace-load-skeleton__field').count(),4);assert.equal(await dialog.locator('[aria-busy=true]').count(),1);await dialog.getByRole('status').filter({hasText:'Loading'}).waitFor();
  assert.ok(await shape.locator('.workspace-load-skeleton__control').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().height===44&&getComputedStyle(e).animationName==='none')));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const axe=await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
  const close=dialog.locator('[data-load-close]');await close.focus();
  if(scenario==='closed'){await page.keyboard.press('Enter');await dialog.waitFor({state:'detached'});await held.fulfill({json:members});await page.waitForLoadState('networkidle');assert.equal(await dialog.count(),0);assert.equal(await page.locator('#open').evaluate(e=>e===document.activeElement),true);}
  else{
   if(scenario==='failure-retry'){await held.fulfill({status:503,json:{detail:'Fixture editor read unavailable'}});await dialog.getByText('Fixture editor read unavailable',{exact:true}).waitFor();assert.equal(await shape.count(),0);assert.equal(await dialog.locator('[aria-busy=true]').count(),0);const retry=dialog.locator('[data-load-retry]');await retry.focus();await page.keyboard.press('Enter');}
   else await held.fulfill({json:members});
   await dialog.locator('[name=notes]').waitFor();assert.equal(await shape.count(),0);assert.equal(await dialog.locator('[aria-busy=true]').count(),0);assert.equal(await dialog.locator('[name=person_id]').inputValue(),'person-one');assert.equal(await dialog.locator('[data-save]').isDisabled(),true);assert.equal(memberReads,scenario==='failure-retry'?2:1);await dialog.getByRole('button',{name:'Close editor',exact:true}).click();await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#open').evaluate(e=>e===document.activeElement),true);
  }
  assert.deepEqual(errors,[]);results.push({engine,width,scenario,fields:4,controlPlaceholderHeight:44,notInteractiveOrExposedAsData:true,loadingBusyAndMotionCorrect:true,scopedAxeViolations:0,readCount:memberReads,existingCloseRetryAndSaveGate:true,noWrites:true,errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-editor-skeleton.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Actual leave editor held firstGET, shared hidden four-field skeleton, success/closed/503manualretry.3engines320/1280, interceptedGETs only, no saves/backend writes. Component loading checks, not total form/page CLS certification.',results},null,2)+'\n');console.log(`Editor skeleton: ${results.length} workflows`);
