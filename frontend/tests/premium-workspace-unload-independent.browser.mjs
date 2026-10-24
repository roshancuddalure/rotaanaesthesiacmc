import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const sourcePaths=['workspace-load-state.ts','record-workspace.ts','reference-workspace.ts','member-workspace.ts','operational-import.ts'];
async function sourceSnapshot(){return Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,createHash('sha256').update(await readFile(new URL('../src/'+p,import.meta.url))).digest('hex')])));}
const sourceHashes=await sourceSnapshot();
const member={id:'member-unload-review',canonical_name:'Dr Review',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],revision:'one'};
// Cancelable synthetic events exercise registration and state predicates. They do
// not prove that a browser will show its native navigation/close confirmation.
async function protectedNow(page){return page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;});}
for(const [engine,width] of [[chromium,320],[chromium,1280],[firefox,320],[webkit,320]]){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width,height:850}}),errors=[],writes=[];
  let acceptConfirmation=true;
  const confirmations=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{confirmations.push({type:d.type(),message:d.message(),accepted:acceptConfirmation});await(acceptConfirmation?d.accept():d.dismiss());});
  let holdMapping=false,releaseMapping;
  await page.route('**/__unload_independent',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open review</button></body></html>'}));
  await page.route('**/api/v1/**',async r=>{
   const req=r.request(),p=new URL(req.url()).pathname;
   if(p==='/api/v1/admin/mappings'){
    writes.push({path:p,body:req.postDataJSON()});
    if(holdMapping)await new Promise(resolve=>releaseMapping=resolve);
    return r.fulfill({status:503,json:{detail:'Review refusal; draft retained'}});
   }
   if(p==='/api/v1/normalization/members/resolve')return r.fulfill({json:{candidates:[]}});
   if(p.endsWith('/columns'))return r.fulfill({json:{headers:['canonical_name'],fields:['canonical_name'],suggested:{canonical_name:'canonical_name'}}});
   assert.equal(req.method(),'GET','No unexpected mutation '+p);
   if(p==='/api/v1/admin/members')return r.fulfill({json:[member]});
   if(p==='/api/v1/normalization/units')return r.fulfill({json:[]});
   if(p.endsWith('/suggest-code'))return r.fulfill({json:{code:'DRAFT'}});
   if(p.includes('/catalog/'))return r.fulfill({json:[{key:'2ND_CALL',label:'Review label',active:true,aliases:[],behavior:{maps_to:'2ND_CALL'},usage:{records:0}}]});
   if(p===`/api/v1/admin/member-workspace/${member.id}`)return r.fulfill({json:{member,impact:{}}});
   if(p.startsWith(`/api/v1/admin/member-workspace/${member.id}/`))return r.fulfill({json:{rows:[]}});
   throw Error('Unexpected read '+p);
  });
  await page.goto(base+'/__unload_independent');
  await page.evaluate(async id=>{
   const members=await import('/src/member-workspace.ts'),references=await import('/src/reference-workspace.ts'),records=await import('/src/record-workspace.ts'),imports=await import('/src/operational-import.ts');
   window.openCase=async kind=>{
    if(kind==='mapping')await references.openMappingCreator(()=>{});
    if(kind==='unit')await references.openUnitRegistry(()=>{});
    if(kind==='catalog')await references.openReferenceCatalog(()=>{});
    if(kind==='record')await records.openRecordEditor('units',id,undefined,true,()=>{});
    if(kind==='member')await members.openMemberWorkspace(id,true,()=>{});
    if(kind==='inline')await imports.createMemberInline('',()=>{});
    if(kind==='memberCSV')members.openMemberCsvImport(()=>{});
    if(kind==='leaveCSV')await imports.openOperationalImport('leave','2026-10',()=>{},true);
   };
  },member.id);
  for(const kind of ['mapping','unit','catalog','record','member','inline','memberCSV','leaveCSV']){
   await page.evaluate(kind=>window.openCase(kind),kind);
   const dialog=page.locator('dialog[open]');await dialog.waitFor();
   assert.equal(await protectedNow(page),false,kind+' pristine');
   if(kind==='member'){await dialog.locator('[data-edit]').click();await dialog.getByRole('tab',{name:'Details',exact:true}).click();await dialog.locator('[data-field=canonical_name]').fill('Dr Unsaved review');}
   else if(kind.endsWith('CSV'))await dialog.locator('input[type=file]').setInputFiles({name:'private-draft.csv',mimeType:'text/csv',buffer:Buffer.from('canonical_name\nDr Unsaved review\n')});
   else await dialog.locator({mapping:'[name=source_label]',unit:'[name=name]',catalog:'[name=label]',record:'[name=notes]',inline:'[name=canonical_name]'}[kind]).fill('Private unsaved review');
   assert.equal(await protectedNow(page),true,kind+' draft');
   // Account reset removes dialogs directly; no stale private closure may keep
   // unload blocked once the modal no longer belongs to the document.
   await dialog.evaluate(el=>el.remove());await page.evaluate(()=>Promise.resolve());
   assert.equal(await protectedNow(page),false,kind+' direct removal');
   results.push({browser:engine.name(),width,kind,pristine_unblocked:true,draft_prevents_synthetic_event:true,direct_removal_unblocked:true});
  }
  for(const kind of ['memberCSV','leaveCSV'])for(const acceptedAction of ['close-button','Escape']){
   await page.evaluate(kind=>window.openCase(kind),kind);
   const dialog=page.locator('dialog[open]');
   const draft='canonical_name\nDr Retained CSV draft\n';
   const file=dialog.locator('input[type=file]');
   await file.setInputFiles({name:'unsaved-before-preview.csv',mimeType:'text/csv',buffer:Buffer.from(draft)});
   const firstConfirmation=confirmations.length;
   acceptConfirmation=false;
   await dialog.locator('[data-close]').first().click();
   assert.equal(await dialog.count(),1,kind+' rejected Close keeps dialog');
   assert.deepEqual(await file.evaluate(async el=>({name:el.files[0].name,text:await el.files[0].text()})),{name:'unsaved-before-preview.csv',text:draft});
   assert.equal(await protectedNow(page),true,kind+' rejected Close keeps protection');
   await page.keyboard.press('Escape');
   assert.equal(await dialog.count(),1,kind+' rejected Escape keeps dialog');
   assert.deepEqual(await file.evaluate(async el=>({name:el.files[0].name,text:await el.files[0].text()})),{name:'unsaved-before-preview.csv',text:draft});
   assert.equal(await protectedNow(page),true,kind+' rejected Escape keeps protection');
   acceptConfirmation=true;
   if(acceptedAction==='Escape')await page.keyboard.press('Escape');
   else await dialog.locator('[data-close]').first().click();
   await dialog.waitFor({state:'detached'});
   assert.equal(await protectedNow(page),false,kind+' accepted discard removes protection');
   assert.equal(writes.length,0,'CSV discard never saves or applies');
   const seen=confirmations.slice(firstConfirmation);
   assert.equal(seen.length,3);assert.deepEqual(seen.map(c=>c.accepted),[false,false,true]);
   seen.forEach(c=>{assert.equal(c.type,'confirm');assert.match(c.message,/Discard this import draft/);assert.match(c.message,/No (member|import) changes have been applied/);});
   results.push({browser:engine.name(),width,kind:kind+'-pre-preview-discard-'+acceptedAction,rejected_close_retains_dialog_and_file:true,rejected_escape_retains_dialog_and_file:true,accepted_discard_closes:true,accepted_action:acceptedAction,no_preview_apply_or_save:true,intercepted_mutating_writes:0,backend_mutations:0});
  }
  // Existing mapping submit enters a pending write. Refusal must retain the
  // guard and draft; no simulated unload is allowed to cause another request.
  await page.evaluate(()=>window.openCase('mapping'));
  const dialog=page.locator('dialog[open]');await dialog.locator('[name=source_label]').fill('CL');await dialog.locator('[name=target_key]').selectOption('2ND_CALL');
  holdMapping=true;await dialog.getByRole('button',{name:'Save mapping',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('dialog[open]'));
  for(let i=0;!releaseMapping&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(typeof releaseMapping,'function');assert.equal(await protectedNow(page),true,'pending mapping protects exit');assert.equal(writes.length,1);
  releaseMapping();await dialog.getByRole('alert').filter({hasText:'Review refusal'}).waitFor();assert.equal(await protectedNow(page),true);
  assert.equal(await dialog.locator('[name=source_label]').inputValue(),'CL');assert.equal(writes.length,1);
  await dialog.locator('[data-close]').first().click();await dialog.waitFor({state:'detached'});assert.equal(await protectedNow(page),false,'normal close removes guard');
  assert.deepEqual(errors,[]);
  results.push({browser:engine.name(),width,kind:'pending-refused-mapping',pending_prevents_synthetic_event:true,refusal_keeps_draft:true,normal_close_unblocked:true,intercepted_writes:1,backend_mutations:0});
  const helperLifecycle=await page.evaluate(async()=>{
   const {protectWorkspaceDraft}=await import('/src/workspace-load-state.ts');
   const check=()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;};
   const make=()=>{const d=document.createElement('dialog');document.body.append(d);d.showModal();protectWorkspaceDraft(d,()=>true);return d;};
   const first=make(),second=make();
   const both=check();second.remove();const oneRemaining=check();
   first.close();
   // Same synchronous task: the queued native close event has not yet cleaned up.
   const closedStillConnected=first.isConnected&&!first.open;
   const afterClose=check();first.remove();
   await Promise.resolve();
   return {both,oneRemaining,closedStillConnected,afterClose,afterCleanup:check()};
  });
  assert.deepEqual(helperLifecycle,{both:true,oneRemaining:true,closedStillConnected:true,afterClose:false,afterCleanup:false});
  results.push({browser:engine.name(),width,kind:'isolated-helper-native-dialog-lifecycle',two_dirty_dialogs_protected:true,removing_one_retains_other_guard:true,closed_connected_immediately_unblocked:true,after_cleanup_unblocked:true,component_predicate_coverage:false});
  await page.close();
 }finally{await browser.close();}
}
assert.deepEqual(await sourceSnapshot(),sourceHashes,'Reviewed source must remain unchanged during the run');
await writeFile('../docs/premium-ui/qa-workspace-unload-independent.json',JSON.stringify({results,sourceHashes,scope:'Real editor/import components, pointer Close and keyboard Escape with actual JavaScript confirm accept/dismiss, exact retained CSV file contents, and intercepted requests. Browser-exit protection uses cancelable synthetic beforeunload only. No native browser-exit confirmation, physical-device, backend-persistence or complete application coverage claim.'},null,2)+'\n');
console.log(`Independent workspace unload: ${results.filter(r=>r.kind!=='isolated-helper-native-dialog-lifecycle').length} component workflows and ${results.filter(r=>r.kind==='isolated-helper-native-dialog-lifecycle').length} isolated helper lifecycle checks passed`);
