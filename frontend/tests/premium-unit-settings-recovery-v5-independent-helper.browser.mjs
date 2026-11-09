import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import {transform} from 'esbuild';
const base=process.env.SETTINGS_PREVIEW ?? 'http://127.0.0.1:5268';
const candidate=process.env.SETTINGS_CANDIDATE ?? '../tmp/unit-settings-recovery-v3';
const output=process.env.SETTINGS_REPORT ?? '../docs/premium-ui/qa-unit-settings-recovery-v3-independent-helper.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashes=Object.fromEntries(await Promise.all(['main.ts','unit-settings-recovery.ts'].map(async name=>[name,sha(await readFile(candidate+'/'+name))])));
const results=[];
const compiled=await transform(await readFile(candidate+'/unit-settings-recovery.ts','utf8'),{loader:'ts',format:'esm',target:'es2022'});
for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})) {
 const browser=await launcher.launch();
 try {for(const width of [320,1280]) for(const scenario of ['superseded-read','canonical-payload','edit-pending-save','edit-pending-read','stale-owner','second-save','retry-with-new-draft','retry-newer-focus']) {
  const page=await browser.newPage({viewport:{width,height:850}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().resourceType()==='document'
   ? route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body></body></html>'})
   : route.request().url().endsWith('/__independent-helper.js') ? route.fulfill({contentType:'text/javascript',body:compiled.code}) : route.continue());
  try {
   await page.goto(base+'/');
   await page.evaluate(async scenario=>{
    const {saveUnitSettingsWithRecovery}=await import('/__independent-helper.js');
    document.body.innerHTML='<form id="independent-form"><input id="unit-minimum-free-people" value="2"><input data-unit-call-minimum="2ND_CALL" value="2"><button type="submit">Save Call-Wise Rules</button></form><button id="outside">Outside</button>';
    // Match the production rule that can override the UA [hidden] display rule.
    const style=document.createElement('style');style.textContent='form button {display:inline-flex}';document.head.append(style);
    const form=document.querySelector('form'),button=form.querySelector('button');
    let owner=true,generation=0,puts=0,gets=0,commits=0,refreshed=0,saveRelease,readRelease;
    const consumed=()=>({minimum_free_people:Math.floor(Number(form.querySelector('#unit-minimum-free-people').value)),call_minimums:[{call_level:'2ND_CALL',minimum_free_people:Math.floor(Number(form.querySelector('[data-unit-call-minimum]').value))}]});
    const bodies=[];
    window.__settings={form,button,bodies,state:()=>({owner,generation,puts,gets,commits,refreshed}),supersede:()=>generation++,stale:()=>owner=false,
     releaseSave:()=>saveRelease?.(),releaseRead:()=>readRelease?.(),
     run:()=>saveUnitSettingsWithRecovery(form,button,{
      current:()=>owner,
      save:async()=>{puts++;bodies.push(consumed());if(puts===1&&['edit-pending-save','stale-owner'].includes(scenario))await new Promise(r=>saveRelease=r);},
      confirmed:()=>{},
      read:async()=>{gets++;const mine=++generation;if((gets===1&&['superseded-read','edit-pending-read'].includes(scenario))||(gets===2&&scenario==='retry-newer-focus'))await new Promise(r=>readRelease=r);if(mine!==generation)throw new Error('A newer unit refresh started. Retry saved rules refresh.');if(gets===1&&['canonical-payload','second-save','retry-with-new-draft','retry-newer-focus'].includes(scenario))throw new Error('Read unavailable');return {saved:true};},
      commit:()=>commits++,refreshed:()=>refreshed++,
     })};
    form.addEventListener('submit',event=>{event.preventDefault();window.__settings.done=window.__settings.run();});
   },scenario);
   const form=page.locator('#independent-form'),save=form.locator('button[type=submit]'),retry=form.locator('[data-retry-unit-settings-read]'),input=form.locator('#unit-minimum-free-people');
   await save.click();
   if(scenario==='superseded-read') {
    await page.waitForFunction(()=>window.__settings.state().gets===1);
    await page.evaluate(()=>{window.__settings.supersede();window.__settings.releaseRead();});
    await form.getByText(/A newer unit refresh started/).waitFor();assert.equal(await retry.isVisible(),true);assert.equal(await save.isDisabled(),true);
    await retry.click();await page.waitForFunction(()=>window.__settings.state().refreshed===1);
    assert.deepEqual(await page.evaluate(()=>window.__settings.state()),{owner:true,generation:3,puts:1,gets:2,commits:1,refreshed:1});
   } else if(scenario==='canonical-payload') {
    await form.getByText(/Read unavailable/).waitFor();
    for(const equivalent of ['2.0','2.9','02']){await input.fill(equivalent);assert.equal(await save.isDisabled(),true);await page.evaluate(()=>window.__settings.run());}
    assert.equal((await page.evaluate(()=>window.__settings.state())).puts,1);
    await input.fill('3');assert.equal(await save.isEnabled(),true);
   } else if(scenario==='edit-pending-save'||scenario==='edit-pending-read') {
    await page.waitForFunction(s=>s==='edit-pending-save'?window.__settings.state().puts===1:window.__settings.state().gets===1,scenario);
    await input.fill('3');await input.focus();assert.equal(await save.isDisabled(),true);
    await page.evaluate(s=>s==='edit-pending-save'?window.__settings.releaseSave():window.__settings.releaseRead(),scenario);
    await form.getByText('Previous rules are saved and refreshed. New edits are not saved yet.',{exact:true}).waitFor();
    assert.equal(await input.inputValue(),'3');assert.equal(await save.isEnabled(),true);assert.equal(await retry.isHidden(),true);assert.equal(await input.evaluate(e=>e===document.activeElement),true);
    const state=await page.evaluate(()=>window.__settings.state());assert.equal(state.puts,1);assert.equal(state.commits,1);assert.equal(state.refreshed,0);
   } else if(scenario==='stale-owner') {
    await page.waitForFunction(()=>window.__settings.state().puts===1);await page.evaluate(()=>{window.__settings.stale();window.__settings.releaseSave();});await page.evaluate(()=>window.__settings.done);
    const state=await page.evaluate(()=>window.__settings.state());assert.equal(state.gets,0);assert.equal(state.commits,0);assert.equal(state.refreshed,0);
   } else if(scenario==='retry-with-new-draft'||scenario==='retry-newer-focus') {
    await form.getByText(/Read unavailable/).waitFor();await input.fill('3');await retry.focus();await page.keyboard.press('Enter');
    if(scenario==='retry-newer-focus') {await page.waitForFunction(()=>window.__settings.state().gets===2);await input.focus();await page.evaluate(()=>window.__settings.releaseRead());}
    const status=form.getByText('Previous rules are saved and refreshed. New edits are not saved yet.',{exact:true});await status.waitFor();
    assert.equal(await retry.isHidden(),true);assert.equal(await (scenario==='retry-newer-focus'?input:status).evaluate(e=>e===document.activeElement),true);
   } else {
    await form.getByText(/Read unavailable/).waitFor();assert.equal(await retry.isVisible(),true);await input.fill('3');await save.click();
    await page.evaluate(()=>window.__settings.done);assert.equal(await retry.isHidden(),true);const state=await page.evaluate(()=>window.__settings.state());assert.equal(state.puts,2);assert.equal(state.gets,2);assert.equal(state.commits,1);assert.equal(state.refreshed,1);
    assert.deepEqual(await page.evaluate(()=>window.__settings.bodies.map(b=>b.minimum_free_people)),[2,3]);
   }
   assert.deepEqual(errors,[]);results.push({engine,width,scenario,state:await page.evaluate(()=>window.__settings.state()),errors});console.log(engine+' '+width+' '+scenario+' passed');
  } finally {await page.close();}
 }} finally {await browser.close();}
}
for(const name of Object.keys(hashes))assert.equal(sha(await readFile(candidate+'/'+name)),hashes[name]);
await writeFile(output,JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/unit_settings_v2_independent_review',scope:'48 isolated browser-helper contexts, not main workflow. Exact frozen helper transformed from TypeScript by esbuild and loaded in blank browser document, native form and production-like hidden override. Simulated adapter follows candidate read generation guard; verifies same connected form supersession, canonical consumed payload, held mutation/read draft and focus, stale owner, subsequent distinct save, successful retry focus recovery and newer focus retention. Main source adapter parity separately reviewed; this does not prove every main-view stale transition.',test_sha256:sha(await readFile(new URL(import.meta.url))),candidate_sha256:hashes,results},null,2)+'\n');
console.log('Independent unit settings helper:48 contexts passed');
