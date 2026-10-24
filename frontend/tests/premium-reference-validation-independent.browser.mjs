import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium, firefox, webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const results=[];
for(const [engine,browserType] of Object.entries({chromium,firefox,webkit})) {
 const browser=await browserType.launch({headless:true});
 try {
  for(const scenario of ['filtered-call-index','nested-duty-behavior','delayed-mapping-focus']) {
   const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],writes=[];
   page.on('pageerror',error=>errors.push(error.message));
   let release,arrived;
   const pending=new Promise(resolve=>{arrived=resolve;});
   await page.route('**/__reference_validation_independent',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open editor</button></body></html>'}));
   await page.route('**/api/v1/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(req.method()==='GET') {
     if(path.endsWith('/suggest-code'))return route.fulfill({json:{code:'TEST'}});
     if(path.endsWith('/units'))return route.fulfill({json:[]});
     if(path.includes('/catalog/'))return route.fulfill({json:[{key:'MAIN',label:'Main duty',active:true,aliases:[],version:1,behavior:{},usage:{records:0}}]});
     throw Error('Unexpected read '+path);
    }
    writes.push({path,method:req.method(),body:req.postDataJSON()});
    if(scenario==='delayed-mapping-focus') {arrived();await new Promise(resolve=>{release=resolve;});}
    const detail=scenario==='filtered-call-index'
     ?[{loc:['body','call_minimums',0,'minimum_free_people'],msg:'Check specific call minimum <script>'},{loc:['body','call_minimums',99,'minimum_free_people'],msg:'Unknown row remains summary only'}]
     :scenario==='nested-duty-behavior'
      ?[{loc:['body','behavior','duration_hours'],msg:'Check duty duration <script>'}]
      :[{loc:['body','source_label'],msg:'Choose another imported spelling <script>'}];
    return route.fulfill({status:422,json:{detail}});
   });
   await page.goto(base+'/__reference_validation_independent');
   await page.evaluate(async scenario=>{
    const {openUnitRegistry,openReferenceCatalog,openMappingCreator}=await import('/src/reference-workspace.ts');
    document.querySelector('#open').onclick=()=>void (scenario==='filtered-call-index'?openUnitRegistry(()=>{},undefined,true):scenario==='nested-duty-behavior'?openReferenceCatalog(()=>{},'duty_type'):openMappingCreator(()=>{}));
   },scenario);
   await page.locator('#open').click();
   const dialog=page.getByRole('dialog');
   if(scenario==='filtered-call-index') {
    await dialog.locator('[name=name]').fill('Independent unit');
    await dialog.locator('[name=code]').fill('INDEPENDENT');
    await dialog.locator('details').getByText('Call-wise staffing minimums',{exact:true}).click();
    const specific=dialog.locator('[data-call-minimum="3RD_CALL"]');
    await specific.fill('3');
    await specific.evaluate(el=>{el.setAttribute('aria-describedby','existing-help');const hint=document.createElement('span');hint.id='existing-help';hint.textContent='Existing call guidance';el.after(hint);});
    await dialog.getByRole('button',{name:'Create unit',exact:true}).click();
    const summary=dialog.locator('[data-error]');
    await summary.getByRole('button').waitFor();
    assert.equal(await specific.getAttribute('aria-invalid'),'true');
    assert.equal(await dialog.locator('[name=minimum_free_people]').getAttribute('aria-invalid'),null);
    assert.equal(await dialog.locator('[aria-invalid=true]').count(),1);
    assert.match(await specific.getAttribute('aria-describedby'),/existing-help/);
    assert.equal(await summary.evaluate(el=>el===document.activeElement),true);
    await dialog.locator('details').evaluate(el=>{el.open=false;});
    await page.keyboard.press('Tab');await page.keyboard.press('Enter');
    assert.equal(await dialog.locator('details').getAttribute('open'),'');
    assert.equal(await specific.evaluate(el=>el===document.activeElement),true);
    await specific.fill('4');
    assert.equal(await specific.getAttribute('aria-invalid'),null);
    assert.equal(await specific.getAttribute('aria-describedby'),'existing-help');
    assert.deepEqual(writes[0].body.call_minimums,[{call_level:'3RD_CALL',minimum_free_people:3}]);
   } else if(scenario==='nested-duty-behavior') {
    await dialog.locator('[name=key]').fill('INDEPENDENT_DUTY');
    await dialog.locator('[name=label]').fill('Independent duty');
    await dialog.locator('[name=allowed_call_levels]').selectOption(['2ND_CALL']);
    await dialog.getByRole('button',{name:'Save reference',exact:true}).click();
    await dialog.locator('[data-error]').getByRole('button').waitFor();
    assert.equal(await dialog.locator('[name=duration_hours]').getAttribute('aria-invalid'),'true');
    assert.equal(await dialog.locator('[aria-invalid=true]').count(),1);
    assert.equal(writes[0].body.behavior.duration_hours,24);
    assert.deepEqual(writes[0].body.behavior.allowed_call_levels,['2ND_CALL']);
   } else {
    await dialog.locator('[name=source_label]').fill('Raw spelling');
    await dialog.locator('[name=target_key]').selectOption('MAIN');
    await dialog.getByRole('button',{name:'Save mapping',exact:true}).click();
    await pending;
    const notes=dialog.locator('[name=notes]');
    await notes.click();
    await notes.fill('Keep editing this draft');
    release();
    await dialog.locator('[data-error]').getByRole('button').waitFor();
    assert.equal(await notes.evaluate(el=>el===document.activeElement),true);
    assert.equal(await notes.inputValue(),'Keep editing this draft');
    assert.equal(writes[0].body.source_label,'Raw spelling');
    assert.equal(writes[0].body.target_key,'MAIN');
    assert.equal(writes[0].body.status,'reviewed');
    assert.equal(writes[0].body.target_label,'Main duty');
   }
   assert.equal(writes.length,1);
   assert.equal(await dialog.locator('script').count(),0);
   assert.deepEqual(errors,[]);
   results.push({engine,scenario,passed:true,mocked_mutation_count:1});
   await page.close();
  }
 } finally {await browser.close();}
}
await writeFile('../docs/premium-ui/qa-reference-validation-independent.json',JSON.stringify({scope:'Independent frontend structured-refusal association, keyboard, draft and request-shape evidence; intercepted responses do not prove backend persistence.',results},null,2)+'\n');
console.log(`Independent reference validation: ${results.length} workflows passed`);
