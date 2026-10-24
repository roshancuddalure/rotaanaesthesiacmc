import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,firefox,webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const results=[];
const unit={id:'independent-unit',name:'Independent unit',code:'INDEPENDENT',campus:'Main',notes:'',aliases:[],active_status:'active',minimum_free_people:1,revision:'revision-2',usage:{selected_members:0,postings:0,duties:0,future_postings:0,future_duties:0}};
const reference={kind:'leave_type',key:'INDEPENDENT',label:'Independent label',active:true,aliases:[],version:2,behavior:{},usage:{records:0}};
for(const [engine,type] of Object.entries({chromium,firefox,webkit})) {
 const browser=await type.launch({headless:true});
 try {
  for(const scenario of ['unit-refusal-lock','unit-readback','reference-readback','unit-readback-close','reference-readback-close']) {
   const page=await browser.newPage({viewport:{width:390,height:844}}),writes=[],errors=[];
   let reads=0,writeConfirmed=false,release,arrived,releaseRead,readArrived;
   const isReference=scenario.startsWith('reference-'),closeRead=scenario.endsWith('-close');
   const pending=new Promise(resolve=>arrived=resolve);
   const readPending=new Promise(resolve=>readArrived=resolve);
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/__normalized_save_independent',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open editor</button></body></html>'}));
   await page.route('**/api/v1/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==='GET') {
     if(path.endsWith('/suggest-code'))return route.fulfill({json:{code:'INDEPENDENT'}});
     if(!path.endsWith('/units')&&!path.includes('/catalog/'))throw Error('Unexpected read '+path);
     reads++;
     if(writeConfirmed&&closeRead&&reads===(isReference?2:3)) {
      readArrived();await new Promise(resolve=>releaseRead=resolve);
      return route.fulfill({json:isReference?[reference]:[unit]});
     }
     if(writeConfirmed&&reads<4)return route.fulfill({status:503,json:{detail:'Refresh temporarily unavailable <script>'}});
     return route.fulfill({json:path.endsWith('/units')?[unit]:[reference]});
    }
    writes.push({method:request.method(),path,body:request.postDataJSON()});
    arrived();await new Promise(resolve=>release=resolve);
    if(scenario==='unit-refusal-lock')return route.fulfill({status:422,json:{detail:[{loc:['body','name'],msg:'Use another unit name'}]}});
    writeConfirmed=true;
    return route.fulfill({json:!isReference?{...unit,name:'Updated unit'}:reference});
   });
   await page.goto(base+'/__normalized_save_independent');
   await page.evaluate(async scenario=>{
    window.savedCalls=0;
    const {openUnitRegistry,openReferenceCatalog}=await import('/src/reference-workspace.ts');
    document.querySelector('#open').onclick=()=>void (scenario.startsWith('reference-')?openReferenceCatalog(()=>window.savedCalls++):openUnitRegistry(()=>window.savedCalls++,'independent-unit'));
   },scenario);
   await page.locator('#open').click();
   const dialog=page.getByRole('dialog');
   if(isReference)await dialog.locator('[data-key="INDEPENDENT"]').click();
   const field=dialog.locator(isReference?'[name=label]':'[name=name]');
   await field.fill(isReference?'Updated label':'Updated unit');
   // A previously disabled field must not become editable after refusal.
   if(scenario==='unit-refusal-lock')await dialog.evaluate(el=>{
    el.querySelector('[name=notes]').disabled=true;
    const link=document.createElement('a');link.href='#unit-guidance';link.tabIndex=0;link.textContent='Read unit guidance';link.dataset.independentGuidance='';
    link.onclick=event=>event.preventDefault();el.querySelector('header').append(link);
   });
   await dialog.getByRole('button',{name:isReference?'Save reference':'Save unit',exact:true}).click();
   await pending;
   const lockState=await dialog.locator('input,select,textarea,button').evaluateAll(els=>els.map(el=>({disabled:el.disabled,tag:el.tagName})));
   assert.ok(lockState.length>8);
   assert.ok(lockState.every(el=>el.disabled),'All editable and navigation controls are locked while mutation is pending');
   await page.keyboard.press('Escape');
   assert.equal(await dialog.count(),1,'Busy dialog cannot be dismissed');
   if(scenario==='unit-refusal-lock') {
    const guidance=dialog.locator('[data-independent-guidance]');
    await guidance.click();
    for(let index=0;index<3&&!await guidance.evaluate(el=>el===document.activeElement);index++)await page.keyboard.press('Tab');
    assert.equal(await guidance.evaluate(el=>el===document.activeElement),true,`${engine}: guidance is deliberately focused before refusal`);
   }
   release();
   if(scenario==='unit-refusal-lock') {
    await dialog.locator('[data-error]').getByRole('button').waitFor();
    assert.equal(await field.inputValue(),'Updated unit');
    assert.equal(await field.isDisabled(),false);
    assert.equal(await dialog.locator('[name=notes]').isDisabled(),true);
    assert.equal(await dialog.getByRole('button',{name:'Save unit',exact:true}).isEnabled(),true);
    assert.equal(await dialog.locator('[data-independent-guidance]').evaluate(el=>el===document.activeElement),true,`${engine}: delayed refusal does not steal a newer deliberate focus destination`);
    assert.equal(await page.evaluate(()=>window.savedCalls),0);
   } else if(closeRead) {
    if(!isReference)await dialog.getByRole('button',{name:'Try again',exact:true}).click();
    await readPending;
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    assert.equal(await page.getByRole('dialog').count(),0,'Read-only loading Close dismisses the dialog');
    releaseRead();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.getByRole('dialog').count(),0,'Late readback cannot resurrect a closed dialog');
    assert.equal(await page.evaluate(()=>window.savedCalls),0,'Late closed-dialog result does not notify completion');
   } else {
    const retry=dialog.getByRole('button',{name:/Refresh saved|Retry refresh|Retry saved|Refresh details|Try again/i});
    await retry.waitFor();
    assert.match(await dialog.innerText(),/saved/i);
    assert.match(await dialog.innerText(),/not.*sav.*again|without.*sav|only.*refresh|do not.*sav|no.*submi/i);
    assert.equal(await dialog.locator('script').count(),0);
    assert.equal(writes.length,1);
    assert.equal(await page.evaluate(()=>window.savedCalls),0,'Failed refresh does not notify completion early');
    await retry.click();
    await retry.waitFor();
    assert.equal(reads,3);
    assert.equal(writes.length,1);
    await retry.click();
    await dialog.locator('form').waitFor();
    assert.equal(reads,4);
    assert.equal(writes.length,1);
    assert.equal(await page.evaluate(()=>window.savedCalls),1,'Callback runs once after successful readback');
    assert.equal(await dialog.locator('input:not([disabled])').count()>0,true);
   }
   assert.equal(writes.length,1);
   assert.equal(writes[0].method,'PUT');
   if(!isReference)assert.equal(writes[0].body.revision,'revision-2');
   else {assert.equal(writes[0].body.version,2);assert.equal(writes[0].body.label,'Updated label');}
   assert.deepEqual(errors,[]);
   results.push({engine,scenario,passed:true,mutation_count:writes.length,read_count:reads});
   await page.close();
  }
 } finally {await browser.close();}
}
await writeFile('../docs/premium-ui/qa-normalized-save-independent.json',JSON.stringify({scope:'Independent native-dialog pending-write locking, refusal restoration, and confirmed-save read-only retry; intercepted requests do not prove backend persistence.',results},null,2)+'\n');
console.log(`Independent normalized-save recovery: ${results.length} workflows passed`);
