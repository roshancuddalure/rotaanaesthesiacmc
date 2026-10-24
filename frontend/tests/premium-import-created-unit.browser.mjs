import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const baseline=process.env.UNIT_IMPORT_BASELINE==='1',results=[];
const sourcePaths=['src/operational-import.ts','src/reference-workspace.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const initial=await hashes();
const member={id:'member-a',canonical_name:'Dr Alpha',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[]};
const unit={id:'new-unit',name:'Created unit',code:'CREATED',campus:'Main',notes:'Keep unit notes',aliases:['Imported unit'],active_status:'active',minimum_free_people:2,revision:'one',call_minimums:[],usage:{selected_members:0,postings:0,duties:0,future_postings:0,future_duties:0}};
const row={key:'CSV:2',source:{sheet:'CSV',row:2},original:{Name:'Dr Alpha'},values:{member_name:'Dr Alpha',unit_name:'Imported unit',posting_type:'2ND_CALL',starts_on:'2026-10-01',ends_on:'2026-10-31'},after:{person_id:'member-a'},action:'needs_review',issues:['Unit not found'],warnings:[],person_match:{state:'matched',canonical_name:'Dr Alpha',method:'exact',candidates:[]}};
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of baseline?[320]:[320,1280])for(const scenario of baseline?['retry']:['retry','new-file']){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],writes=[],previews=[];
  let created=false,optionsReads=0,release,arrived;const pending=new Promise(resolve=>arrived=resolve);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/__created_unit',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Import units</button></body></html>'}));
  await page.route('**/api/**',async r=>{
   const q=r.request(),url=new URL(q.url()),path=url.pathname;
   if(path.endsWith('/columns'))return r.fulfill({json:{headers:['Name'],fields:['member_name'],suggested:{Name:'member_name'}}});
   if(path.endsWith('/units/preview')){const s=JSON.parse(q.postData().match(/name="settings_json"\r?\n\r?\n([^\r\n]+)/)[1]);previews.push(s);return r.fulfill({json:{id:'preview-'+previews.length,kind:'units',month:'2026-10',mode:'append',headers:['Name'],fields:['member_name'],replacement_scope:[],rows:[structuredClone(row)]}});}
   if(q.method()!=='GET'){
    writes.push({method:q.method(),path,body:q.postDataJSON()});assert.equal(path,'/api/v1/normalization/units');assert.equal(q.method(),'POST');
    if(scenario==='retry'&&writes.length===1)return r.fulfill({status:503,json:{detail:'Creation temporarily unavailable'}});
    created=true;return r.fulfill({json:unit});
   }
   if(path==='/api/v1/admin/members')return r.fulfill({json:[member]});
   if(path.endsWith('/suggest-code'))return r.fulfill({json:{code:'CREATED'}});
   if(path==='/api/v1/normalization/units'){
    if(!created)return r.fulfill({json:[]});
    optionsReads++;
    if(scenario==='retry'&&optionsReads===1)return r.fulfill({status:503,json:{detail:'Choices temporarily unavailable'}});
    if((scenario==='new-file'&&optionsReads===1)||(scenario==='retry'&&optionsReads===2)){arrived();await new Promise(resolve=>release=resolve);}
    return r.fulfill({json:[unit]});
   }
   throw Error('Unexpected request '+path);
  });
  await page.goto('http://127.0.0.1:5197/__created_unit');await page.evaluate(()=>{document.querySelector('#open').onclick=async()=>{await(await import('/src/operational-import.ts')).openOperationalImport('units','2026-10',()=>{},true);};});await page.locator('#open').click();
  const dialog=page.locator('dialog.operational-import'),file=dialog.locator('input[type=file]');
  await file.setInputFiles({name:'original.csv',mimeType:'text/csv',buffer:Buffer.from('Name\nDr Alpha\n')});await dialog.locator('[data-map]').waitFor();await dialog.getByRole('button',{name:'Preview and normalize',exact:true}).click();
  const review=dialog.locator('[data-review-row="CSV:2"]');await review.locator('summary').click();await review.locator('[data-field=starts_on]').fill('2026-10-09');await review.locator('[data-field=starts_on]').press('Tab');
  const create=review.locator('[data-create-unit]');await create.focus();await page.keyboard.press('Enter');const registry=page.locator('dialog.reference-workspace');await registry.locator('#registry-unit-form').waitFor();
  await registry.locator('[name=campus]').fill('Main');await registry.locator('[name=name]').fill('Created unit');await registry.locator('[name=code]').fill('CREATED');await registry.locator('[name=minimum_free_people]').fill('2');await registry.locator('[name=aliases]').fill('Imported unit');await registry.locator('[name=notes]').fill('Keep unit notes');
  await registry.getByRole('button',{name:'Create unit',exact:true}).click();
  if(scenario==='retry'){await registry.locator('[data-error]').filter({hasText:'Creation temporarily unavailable'}).waitFor();assert.equal(await registry.locator('[name=notes]').inputValue(),'Keep unit notes');await registry.getByRole('button',{name:'Create unit',exact:true}).click();}
  await registry.waitFor({state:'detached'});
  if(baseline){await page.waitForFunction(()=>document.querySelector('dialog.operational-import [data-message]')?.textContent||false);await page.waitForTimeout(100);results.push({engine,width,scenario,errors,writes,optionsReads,staleApply:await dialog.locator('[data-apply]').getAttribute('aria-disabled'),retryVisible:await dialog.locator('[data-retry-unit-options]').count()});}
  else if(scenario==='retry'){
   await dialog.locator('[data-message]').filter({hasText:'Unit created'}).waitFor();const retry=dialog.locator('[data-retry-unit-options]');await retry.waitFor();assert.equal(await retry.evaluate(n=>n===document.activeElement),true);const retryBox=await retry.boundingBox();assert.ok(retryBox.y>=0&&retryBox.y+retryBox.height<=900);const messageBox=await dialog.locator('[data-message]').boundingBox(),headerBox=await dialog.locator('.mw-header').boundingBox();assert.ok(messageBox.y>=headerBox.y+headerBox.height,'Entire recovery message must be below the header');const accessibility=await new AxeBuilder({page}).include('dialog.operational-import').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(accessibility.violations,[]);if(engine==='chromium')await page.screenshot({path:'../docs/premium-ui/screenshots/recovery/import-unit-choices-'+width+'.png'});assert.equal(await dialog.locator('[data-apply]').getAttribute('aria-disabled'),'true');assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);
   await retry.focus();await page.keyboard.press('Enter');await pending;assert.equal(await retry.getAttribute('aria-disabled'),'true');await page.keyboard.press('Enter');assert.equal(optionsReads,2);release();await review.locator('[data-field=unit_id] option[value=new-unit]').waitFor({state:'attached'});assert.equal(await review.locator('[data-field=unit_id]').inputValue(),'new-unit');assert.equal(await review.locator('[data-field=starts_on]').inputValue(),'2026-10-09');assert.equal(await review.locator('summary').evaluate(n=>n===document.activeElement),true);const box=await review.locator('summary').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=900);assert.equal(writes.length,2);assert.equal(optionsReads,2);
   await dialog.locator('[data-refresh]').click();await dialog.locator('[data-message]').filter({hasText:'1 rows normalized'}).waitFor();assert.deepEqual(previews.at(-1).corrections,{'CSV:2':{starts_on:'2026-10-09',unit_id:'new-unit'}});assert.equal(await file.evaluate(n=>n.files[0].name),'original.csv');assert.deepEqual(errors,[]);
   results.push({engine,width,scenario,explicitCreateAttempts:2,optionReads:2,retryIsGetOnly:true,exactCorrection:true,draftAndFileRetained:true,visibleOwnedRowFocus:true,visibleRecoveryFocus:true,taggedAxeViolations:0,errors});
  }else{
   await pending;await file.setInputFiles({name:'replacement.csv',mimeType:'text/csv',buffer:Buffer.from('Name\nReplacement\n')});await dialog.locator('[data-map]').waitFor();release();await page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/normalization/units');await dialog.getByRole('button',{name:'Preview and normalize',exact:true}).click();await dialog.locator('[data-message]').filter({hasText:'1 rows normalized'}).waitFor();assert.deepEqual(previews.at(-1).corrections,{});assert.equal(await file.evaluate(n=>n.files[0].name),'replacement.csv');assert.equal(await dialog.locator('[data-retry-unit-options]').count(),0);assert.equal(writes.length,1);assert.deepEqual(errors,[]);
   results.push({engine,width,scenario,explicitCreateAttempts:1,lateOptionsIgnored:true,newFileUnchanged:true,correctionsCleared:true,errors});
  }
  await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-import-created-unit'+(baseline?'-before':'')+'.json',JSON.stringify({source_sha256:initial,scope:'Actual normalized import -> Create unit -> intercepted create refusal/retry or held choices GET/new file. All writes intercepted; no server persistence claim.',results},null,2)+'\n');console.log('Created unit import workflows: '+results.length);
