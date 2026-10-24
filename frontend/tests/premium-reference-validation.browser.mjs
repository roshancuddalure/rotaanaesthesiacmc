import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{
  for(const width of [320,1280])for(const kind of ['mapping','unit','reference']){
   const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
   let writes=0;
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/__reference_validation',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open editor</button></body></html>'}));
   const field=kind==='mapping'?'source_label':kind==='unit'?'name':'label';
   await page.route('**/api/v1/**',route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(req.method()!=='GET'){
     writes++;assert.equal(writes,1,'No automatic mutation retry');
     const body=req.postDataJSON();
     if(kind==='mapping')assert.deepEqual(body,{mapping_type:'duty_label',source_label:'Input retained',target_key:'ANNUAL_LEAVE',notes:'Draft notes',status:'reviewed',target_label:'Annual leave'});
     if(kind==='unit'){assert.equal(body.name,'Input retained');assert.equal(body.code,'EXAMPLE');assert.equal(body.notes,'Draft notes');assert.equal(body.minimum_free_people,1);assert.deepEqual(body.call_minimums,[]);}
     if(kind==='reference')assert.deepEqual(body,{label:'Input retained',aliases:[],active:true,version:0,behavior:{}});
     return route.fulfill({status:422,json:{detail:[{loc:['body',field],msg:'Check this value <img src=x>',type:'value_error'},{loc:['body','unknown'],msg:'Review the returned definition',type:'value_error'}]}});
    }
    if(path.endsWith('/suggest-code'))return route.fulfill({json:{code:'EXAMPLE'}});
    return route.fulfill({json:path.endsWith('/units')?[]:[{key:'ANNUAL_LEAVE',label:'Annual leave',active:true,aliases:[],usage:{records:0},behavior:{}}]});
   });
   await page.goto(base+'/__reference_validation');
   await page.evaluate(async kind=>{const m=await import('/src/reference-workspace.ts');document.querySelector('#open').onclick=()=>kind==='mapping'?m.openMappingCreator(()=>{}):kind==='unit'?m.openUnitRegistry(()=>{}):m.openReferenceCatalog(()=>{});},kind);
   await page.locator('#open').click();const dialog=page.locator('dialog'),form=dialog.locator('form');
   const input=form.locator(`[name="${field}"]`);await input.fill('Input retained');
   if(kind==='mapping')await form.locator('[name=target_key]').selectOption('ANNUAL_LEAVE');
   if(kind==='unit'){await form.locator('[name=code]').fill('EXAMPLE');await form.locator('[name=notes]').fill('Draft notes');}
   if(kind==='reference')await form.locator('[name=key]').fill('EXAMPLE');
   if(kind==='mapping')await form.locator('[name=notes]').fill('Draft notes');
   await form.locator('[type=submit]').focus();await page.keyboard.press('Enter');
   await page.waitForFunction(name=>document.querySelector(`[name="${name}"]`)?.getAttribute('aria-invalid')==='true',field);
   assert.equal(await input.inputValue(),'Input retained');assert.equal(await dialog.locator('img').count(),0);
   const summary=form.locator('[data-error]');assert.equal(await summary.evaluate(el=>el===document.activeElement),true);
   const link=summary.locator('button');assert.equal(await link.count(),1,'Unknown error remains text rather than a wrong field link');
   await link.focus();await page.keyboard.press('Enter');assert.equal(await input.evaluate(el=>el===document.activeElement),true);
   const hint=await input.getAttribute('aria-describedby');assert.ok(hint);
   assert.equal(await page.locator(`[id="${hint}"]`).innerText(),'Check this value <img src=x>');
   if(engine==='chromium'){
    const axe=await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(item=>item.id),[]);
   }
   await input.fill('Corrected input');assert.equal(await input.getAttribute('aria-invalid'),null);assert.equal(await input.getAttribute('aria-describedby'),null);assert.equal(await summary.innerText(),'');
   assert.equal(writes,1);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   results.push({engine,width,kind,unchanged_payload:true,draft_retained:true,escaped_server_error:true,field_hint_and_keyboard_summary:true,unknown_error_not_misassociated:true,clear_after_edit:true,mutations:1,backend_writes:0});
   await context.close();
  }
 }finally{await browser.close();}
}
await writeFile('../docs/premium-ui/qa-reference-validation.json',JSON.stringify({results,scope:'Actual mapping/unit/reference editors with intercepted422 mutations; no backend persistence, physical device or screen-reader claims.'},null,2)+'\n');
console.log('Reference validation:18 cross-browser payload, field hint and keyboard workflows passed');
