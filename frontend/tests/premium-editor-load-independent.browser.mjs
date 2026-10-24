import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true});
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const results=[];
try {
 for(const width of [320,1280]) {
  const page=await browser.newPage({viewport:{width,height:760}}),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.route('**/__independent_editor_load',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open workspace</button></body></html>'}));
  let mappingFail=true, pendingDuty,holdDuty=false;
  await page.route('**/api/v1/**',async r=>{
   const req=r.request(),p=new URL(req.url()).pathname;
   if(req.method()!=='GET') {writes.push({path:p,body:req.postData()});return r.fulfill({json:{}});}
   if(p.endsWith('/catalog/duty_type')) {
    if(holdDuty)await new Promise(resolve=>pendingDuty=resolve);
    if(mappingFail)return r.fulfill({status:503,json:{detail:'Destination service unavailable <script>'}});
    return r.fulfill({json:[{key:'DUTY_A',label:'Duty destination',active:true}]});
   }
   if(p.endsWith('/normalization/units'))return r.fulfill({json:[{id:'unit-1',name:'Unit destination',active_status:'active'}]});
   throw Error('Unexpected '+p);
  });
  await page.goto(base+'/__independent_editor_load');
  await page.evaluate(async()=>{
   const m=await import('/src/reference-workspace.ts');
   document.querySelector('#open').onclick=()=>void m.openMappingCreator(()=>{});
  });
  await page.locator('#open').click();
  let dialog=page.getByRole('dialog');
  const retry=dialog.getByRole('button',{name:/retry|try again/i});
  await retry.waitFor();
  await dialog.locator('[name=source_label]').fill('Keep imported spelling');
  await dialog.locator('[name=notes]').fill('Keep these private notes');
  await dialog.locator('[data-find]').fill('destination');
  assert.equal(await dialog.locator('[name=target_key]').isDisabled(),true);
  assert.equal(await dialog.getByRole('button',{name:'Save mapping',exact:true}).isDisabled(),true);
  assert.equal(await dialog.locator('script').count(),0);
  mappingFail=false;
  await retry.focus();await page.keyboard.press('Enter');
  await dialog.locator('[name=target_key] option[value=DUTY_A]').waitFor({state:'attached'});
  assert.equal(await dialog.locator('[name=source_label]').inputValue(),'Keep imported spelling');
  assert.equal(await dialog.locator('[name=notes]').inputValue(),'Keep these private notes');
  assert.equal(await dialog.locator('[data-find]').inputValue(),'destination');
  assert.equal(await dialog.locator('[name=target_key]').isDisabled(),false);
  assert.equal(await dialog.locator('[name=target_key]').evaluate(e=>e===document.activeElement),true,'Successful keyboard retry should focus the enabled destination');
  assert.equal(writes.length,0);
  results.push({width,case:'mapping failure disables unusable controls; keyboard read retry retains source notes and search',writes:0});

  // The result must preserve a newer deliberate focus chosen during the retry.
  mappingFail=true;
  await dialog.locator('[name=mapping_type]').selectOption('unit_label');
  await dialog.locator('[name=target_key] option[value="unit-1"]').waitFor({state:'attached'});
  await dialog.locator('[name=mapping_type]').selectOption('duty_label');
  await retry.waitFor();
  mappingFail=false;holdDuty=true;pendingDuty=undefined;
  await retry.focus();await page.keyboard.press('Enter');
  assert.ok(pendingDuty);
  await dialog.locator('[name=notes]').focus();
  pendingDuty();await page.waitForLoadState('networkidle');
  assert.equal(await dialog.locator('[name=notes]').evaluate(e=>e===document.activeElement),true,'Retry success must preserve newer notes focus');
  holdDuty=false;
  results.push({width,case:'delayed retry success preserves newer notes focus',writes:0});

  // An old category response cannot replace the newly selected category.
  holdDuty=true;
  await dialog.locator('[name=mapping_type]').selectOption('unit_label');
  await dialog.locator('[name=target_key] option[value="unit-1"]').waitFor({state:'attached'});
  await dialog.locator('[name=mapping_type]').selectOption('duty_label');
  await page.waitForFunction(()=>document.querySelector('[name=target_key]').disabled);
  assert.ok(pendingDuty);
  await dialog.locator('[name=mapping_type]').selectOption('unit_label');
  await dialog.locator('[name=target_key] option[value="unit-1"]').waitFor({state:'attached'});
  pendingDuty();
  await page.waitForLoadState('networkidle');
  assert.equal(await dialog.locator('[name=target_key] option[value=DUTY_A]').count(),0);
  assert.equal(await dialog.locator('[name=mapping_type]').inputValue(),'unit_label');
  assert.equal(await dialog.locator('[name=source_label]').inputValue(),'Keep imported spelling');
  results.push({width,case:'late previous category response cannot replace current destinations',writes:0});

  // Closing during an option request must not resurrect the dialog.
  pendingDuty=undefined;
  await dialog.locator('[name=mapping_type]').selectOption('duty_label');
  await page.waitForFunction(()=>document.querySelector('[name=target_key]').disabled);
  assert.ok(pendingDuty);
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'detached'});
  pendingDuty();await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('dialog').count(),0);
  assert.equal(await page.locator('#open').evaluate(e=>e===document.activeElement),true);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  results.push({width,case:'closed mapping ignores late option response and restores opener',writes:0});
  await page.close();
 }
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-editor-load-independent.json',JSON.stringify({results,scope:'Independent mocked mapping read-failure, keyboard retry, dirty draft retention, category race and closed-dialog checks. No backend persistence claim.'},null,2)+'\n');
console.log(`Independent editor load recovery: ${results.length} workflows passed`);
