import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const results=[];
const sourceHash=createHash('sha256').update(await readFile('src/main.ts')).digest('hex');
const original={id:'mapping-1',mapping_type:'duty_label',source_label:'Legacy duty spelling',target_key:'T1',target_label:'First duty',status:'reviewed',notes:'Original notes'};
for(const [engine,type] of Object.entries({chromium,firefox,webkit})) {
 const browser=await type.launch({headless:true});
 try {for(const width of [320,1280]) for(const scenario of ['post-failure','confirmed-read-failure','leave-route','sign-out','save-before-scan','pending-search-focus']) {
  console.log(`Mapping scan: ${engine} ${width} ${scenario}`);
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(12000);
  const errors=[],posts=[];let reads=0,failRead=false,scanned=false,release,releaseSave,savedRow,saveCount=0;
  const held=new Promise(resolve=>release=resolve);
  const heldSave=new Promise(resolve=>releaseSave=resolve);
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','independent-mapping-scan'));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/admin/mappings/mapping-1')) {
    assert.equal(req.method(),'PUT');saveCount++;
    assert.deepEqual(req.postDataJSON(),{target_key:'T2',target_label:'My draft label',status:'suggested',notes:'Keep my local draft'});
    await heldSave;savedRow={...original,...req.postDataJSON()};return route.fulfill({json:savedRow});
   }
   if(url.pathname.endsWith('/mappings/options'))return route.fulfill({json:{duty_types:[{key:'T1',label:'First duty'},{key:'T2',label:'Second duty'}],mapping_types:['duty_label','unit_label']}});
   if(url.pathname.endsWith('/admin/mappings/scan-historical')) {
    assert.equal(req.method(),'POST');assert.deepEqual(req.postDataJSON(),{});posts.push(req.postDataJSON());
    if(posts.length===1)await held;
    if(scenario==='post-failure'&&posts.length===1)return route.fulfill({status:503,json:{detail:'Independent scan unavailable'}});
    scanned=true;return route.fulfill({json:{files_scanned:2,mappings_created:1,mappings_updated:1}});
   }
   if(url.pathname.endsWith('/admin/mappings')) {
    assert.equal(req.method(),'GET');reads++;
    if(failRead)return route.fulfill({status:503,json:{detail:'Independent refreshed list unavailable'}});
    return route.fulfill({json:[...(scanned&&scenario==='confirmed-read-failure'?[]:[savedRow||{...original,notes:scanned?'Server changed note':'Original notes'}]),...(scanned?[{...original,id:'mapping-2',source_label:'Legacy discovered duty',notes:'Scanned note'}]:[]),{...original,id:'mapping-unit',mapping_type:'unit_label',source_label:'Other unit'}]});
   }
   assert.equal(req.method(),'GET','No non-intercepted mutation may reach fixture API');
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=mappings');
  const scan=page.locator('#scan-mappings'),notes=page.getByLabel('Notes for Legacy duty spelling',{exact:true});
  await notes.waitFor();
  await page.locator('[data-filter="duty_label"]').click();
  await page.getByRole('searchbox',{name:'Search mappings'}).fill('Legacy');
  await page.getByLabel('Target key for Legacy duty spelling',{exact:true}).selectOption('T2');
  await page.getByLabel('Target label for Legacy duty spelling',{exact:true}).fill('My draft label');
  await page.getByLabel('Status for Legacy duty spelling',{exact:true}).selectOption('suggested');
  await notes.fill('Keep my local draft');await notes.press('Tab');
  if(scenario==='save-before-scan') {
   await page.locator('[data-save="mapping-1"]').click();
   await page.waitForFunction(()=>document.querySelector('[data-save="mapping-1"]')?.disabled);
   assert.equal(await scan.isDisabled(),true,'Pending mapping save disables scan');
   await scan.dispatchEvent('click');assert.equal(posts.length,0,'Synthetic scan cannot race held PUT');
   await page.locator('[data-filter="all"]').click();await page.locator('[data-filter="duty_label"]').click();
   assert.equal(await scan.isDisabled(),true,'Filter rerender preserves pending-save scan lock');
   await scan.dispatchEvent('click');assert.equal(posts.length,0);
   releaseSave();await page.getByText('Mapping saved',{exact:true}).waitFor();
   await page.waitForFunction(()=>!document.querySelector('#scan-mappings')?.disabled);assert.equal(saveCount,1);
  }
  await scan.click();await page.waitForFunction(()=>document.querySelector('#scan-mappings')?.disabled);
  assert.equal(posts.length,1);assert.equal(await notes.isDisabled(),true,'Draft editor paused while scan is pending');
  assert.equal(await page.locator('[data-save="mapping-1"]').isDisabled(),true);
  assert.equal(await page.locator('[data-create-import-mapping]').isDisabled(),true);
  // Deliberately synthetic event probes handler guard even though native disabled controls cannot activate.
  await scan.dispatchEvent('click');assert.equal(posts.length,1,'Synthetic duplicate click cannot start another scan');
  if(scenario==='pending-search-focus') {
   await page.locator('[data-filter="all"]').click();await page.locator('[data-filter="duty_label"]').click();
   const search=page.getByRole('searchbox',{name:'Search mappings'});
   await search.fill('Legacy');await search.press('Home');await search.press('ArrowRight');await search.press('ArrowRight');
   assert.equal(await search.evaluate(el=>el===document.activeElement),true);
   assert.equal(await notes.isDisabled(),true,'Pending scan still locks rows after filter rerender');
  }
  if(scenario==='leave-route') {
   if(width===320)await page.getByRole('button',{name:'Open menu',exact:true}).click();
   page.once('dialog',dialog=>dialog.accept());
   await page.locator('.sidebar [data-view="overview"]').click();
   await page.waitForFunction(()=>!document.querySelector('#scan-mappings'));
   const readsBefore=reads;release();
   await page.waitForResponse(response=>response.url().endsWith('/scan-historical'));
   await page.waitForTimeout(150);
   assert.equal(reads,readsBefore,'Stale completed scan cannot refresh departed route');
   assert.equal(await page.locator('#scan-mappings').count(),0);
   assert.equal(await page.getByText(/^Historical scan complete/).count(),0);
  } else if(scenario==='sign-out') {
   await page.locator('#account-menu-button').click();await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();
   await page.locator('#login-form').waitFor();const readsBefore=reads;release();
   await page.waitForResponse(response=>response.url().endsWith('/scan-historical'));await page.waitForTimeout(150);
   assert.equal(reads,readsBefore,'Old account scan cannot refresh private mappings');
   assert.equal(await page.locator('#scan-mappings').count(),0);
   assert.equal(await page.getByText(/^Historical scan complete/).count(),0);
  } else {
   if(scenario==='confirmed-read-failure')failRead=true;
   release();
   if(scenario==='post-failure') {
    await page.getByText('Independent scan unavailable',{exact:true}).waitFor();
    assert.equal(await notes.inputValue(),'Keep my local draft');assert.equal(await notes.isEnabled(),true);
    assert.equal(posts.length,1,'Failed mutation never automatically retries');
    await scan.click();
   } else if(scenario==='confirmed-read-failure') {
    await page.getByRole('alert').filter({hasText:'Historical scan completed, but'}).waitFor();
    const retry=page.locator('[data-retry-mappings]');const firstReads=reads;
    await retry.click();await page.waitForFunction(()=>!document.querySelector('[data-retry-mappings]')?.disabled);
    assert.equal(reads,firstReads+1,'Explicit failed read retry performs one GET');assert.equal(posts.length,1);
    assert.equal(await notes.inputValue(),'Keep my local draft');
    failRead=false;await retry.click();
   }
   await page.getByLabel('Notes for Legacy discovered duty',{exact:true}).waitFor();
   assert.equal(await notes.inputValue(),'Keep my local draft','Fresh scan results merge around unsaved edits');
   assert.equal(await page.getByLabel('Target key for Legacy duty spelling',{exact:true}).inputValue(),'T2');
   assert.equal(await page.getByLabel('Target label for Legacy duty spelling',{exact:true}).inputValue(),'My draft label');
   assert.equal(await page.getByLabel('Status for Legacy duty spelling',{exact:true}).inputValue(),'suggested');
   if(scenario!=='save-before-scan')assert.equal(await page.locator('[data-mapping-row="mapping-1"]').getAttribute('class'),'dirty');
   assert.equal(await page.locator('#mapping-search').inputValue(),'Legacy');
   assert.equal(await page.locator('[data-filter="duty_label"]').getAttribute('class'),'selected');
   assert.equal(await page.locator('[data-mapping-row="mapping-unit"]').count(),0);
   assert.equal(await notes.isEnabled(),true);
   assert.equal(await page.locator('[data-retry-mappings]').count(),0);
   assert.equal(posts.length,scenario==='post-failure'?2:1);
   if(scenario==='pending-search-focus') {
    const search=page.locator('#mapping-search');assert.equal(await search.evaluate(el=>el===document.activeElement),true,'Intentional search focus survives completion');
    assert.deepEqual(await search.evaluate(el=>[el.selectionStart,el.selectionEnd]),[2,2],'Search caret survives replacement');
   } else assert.equal(await scan.evaluate(el=>el===document.activeElement),true,'Completion restores focus to scan action');
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  results.push({engine,width,scenario,intercepted_scan_posts:posts.length,intercepted_mapping_puts:saveCount,mapping_gets:reads,exact_empty_object_payload:true,synthetic_duplicate_probe:true,backend_writes:0,no_overflow:true,page_errors:0});
  await context.close();
 }} finally {await browser.close();}
}
assert.equal(createHash('sha256').update(await readFile('src/main.ts')).digest('hex'),sourceHash,'App source stays frozen throughout this QA run');
await writeFile('../docs/premium-ui/qa-mapping-scan-independent.json',JSON.stringify({source_sha256:{'frontend/src/main.ts':sourceHash},results,scope:'Actual app pointer/keyboard controls in three emulated engines; intercepted scan POST and mocked mapping reads; GET-only disposable fixture passthrough. Four editable fields retained, including a dirty row omitted from confirmed refreshed GET. Synthetic duplicate dispatch is separately identified. No backend parser, persistence, physical device or actual browser exit certification.'},null,2)+'\n');
console.log(`Independent mapping scan lifecycle: ${results.length} cases passed`);
