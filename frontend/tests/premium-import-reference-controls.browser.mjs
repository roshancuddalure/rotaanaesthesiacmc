import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const results=[],paths=['src/operational-import.ts','src/reference-workspace.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')]))),initial=await hashes();
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const kind of ['units','leave']){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],writes=[];let reads=0,renamed=false,applies=0;
  const catalogKind=kind==='units'?'posting_type':'leave_type',key=kind==='units'?'2ND_CALL':'CL';
  const reference=()=>({kind:catalogKind,key,label:renamed?'Updated display label':'Original display label',aliases:[],active:true,version:renamed?2:1,behavior:{maps_to:key},usage:{records:3}});
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/__import_reference',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open import</button></body></html>'}));
  await page.route('**/api/**',async r=>{
   const q=r.request(),path=new URL(q.url()).pathname;
   if(path.endsWith('/columns'))return r.fulfill({json:{headers:['Name'],fields:['member_name'],suggested:{Name:'member_name'}}});
   if(path.endsWith('/preview'))return r.fulfill({json:{id:'reference-preview',kind,month:'2026-10',mode:'append',headers:['Name'],fields:['member_name'],replacement_scope:[],rows:[]}});
   if(path.endsWith('/apply')){applies++;return r.fulfill({status:599,json:{detail:'Unexpected apply intercepted'}});}
   if(q.method()==='PUT'){assert.equal(path,'/api/v1/normalization/catalog/'+catalogKind+'/'+key);writes.push(q.postDataJSON());if(writes.length===1)return r.fulfill({status:503,json:{detail:'Reference save temporarily unavailable'}});renamed=true;return r.fulfill({json:reference()});}
   assert.equal(q.method(),'GET');if(path.includes('/catalog/')){assert.equal(path,'/api/v1/normalization/catalog/'+catalogKind);reads++;if(reads===1)return r.fulfill({status:503,json:{detail:'Reference choices temporarily unavailable'}});return r.fulfill({json:[reference()]});}
   if(path==='/api/v1/admin/members'||path==='/api/v1/normalization/units')return r.fulfill({json:[]});throw Error('Unexpected request '+path);
  });
  await page.goto('http://127.0.0.1:5197/__import_reference');await page.evaluate(kind=>{document.querySelector('#open').onclick=async()=>{await(await import('/src/operational-import.ts')).openOperationalImport(kind,'2026-10',()=>{},true);};},kind);await page.locator('#open').click();
  const importer=page.locator('dialog.operational-import');await importer.locator('input[type=file]').setInputFiles({name:'references.csv',mimeType:'text/csv',buffer:Buffer.from('Name\nExample\n')});await importer.locator('[data-map]').waitFor();await importer.getByRole('button',{name:'Preview and normalize',exact:true}).click();await importer.locator('[data-refresh]').waitFor();const opener=importer.locator('[data-manage-import-references]');await opener.focus();await page.keyboard.press('Enter');
  const catalog=page.locator('dialog.reference-workspace');await catalog.getByText('Reference choices temporarily unavailable',{exact:true}).waitFor();const loadRetry=catalog.locator('[data-load-retry]');await loadRetry.focus();await page.keyboard.press('Enter');await catalog.locator('[data-kind]').waitFor();assert.equal(await catalog.locator('[data-kind]').inputValue(),catalogKind);
  await catalog.locator('[data-key="'+key+'"]').click();await catalog.locator('[name=label]').fill('Updated display label');await catalog.getByRole('button',{name:'Save reference',exact:true}).click();await catalog.locator('[data-error]').filter({hasText:'Reference save temporarily unavailable'}).waitFor();assert.equal(await catalog.locator('[name=label]').inputValue(),'Updated display label');await catalog.getByRole('button',{name:'Save reference',exact:true}).click();await catalog.locator('[data-key="'+key+'"]').filter({hasText:'Updated display label'}).waitFor();assert.equal(reads,3);assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.deepEqual(writes[1],{label:'Updated display label',aliases:[],active:true,version:1,behavior:{maps_to:key}});
  await catalog.locator('header [data-close]').click();await catalog.waitFor({state:'detached'});assert.equal(await opener.evaluate(n=>n===document.activeElement),true);assert.equal(await importer.locator('input[type=file]').evaluate(n=>n.files[0].name),'references.csv');assert.equal(await importer.locator('[name=month]').inputValue(),'2026-10');assert.equal(await importer.locator('[data-map]').inputValue(),'member_name');assert.equal(await importer.locator('[data-apply]').getAttribute('aria-disabled'),'true');await importer.locator('[data-apply]').focus();await page.keyboard.press('Enter');assert.equal(applies,0);assert.deepEqual(errors,[]);
  results.push({engine,width,kind,initialCatalogKind:catalogKind,readRetryOnly:true,explicitSaveAttempts:2,exactRetryPayload:true,stableKey:true,openerFocus:true,fileMonthMappingRetained:true,previewStaleAfterReferenceSave:true,applyRequests:applies,errors});await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-import-reference-controls.json',JSON.stringify({source_sha256:initial,scope:'Actual import Manage labels and mappings -> matching catalog -> load503/GETretry -> intercepted labelPUT503/manualretry -> close. Unit/leave imports,3engines320/1280. No backend writes or catalog semantics changes.',results},null,2)+'\n');console.log('Import reference control workflows: '+results.length);
