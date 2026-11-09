import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';
import { observeImportUploads, observedImportFile } from './fixtures/import-upload-observer.mjs';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const engines=process.env.BOUNDARY_ENGINES?.split(',')||['chromium','firefox','webkit'];
const widths=process.env.BOUNDARY_WIDTHS?.split(',').map(Number)||[320,1280];
const surfaces=process.env.BOUNDARY_SURFACES?.split(',')||['workbook','csv','units','leave'];
const paths=['src/ui.ts','src/member-import.ts','src/member-workspace.ts','src/operational-import.ts','src/services/api.ts','src/styles.css','src/premium-theme.css','tests/premium-import-retention-boundaries.browser.mjs','tests/fixtures/import-upload-observer.mjs'];
const sha=x=>createHash('sha256').update(x).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));
const initial=await hashes(),results=[];
const people=['a','b','missing'].map(id=>({id,canonical_name:'Dr '+id,active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[],revision:'one'}));
const candidates=people.slice(0,2).map(p=>({id:p.id,name:p.canonical_name,call_level:p.call_level,status:'active'}));
const bytes=Buffer.from('canonical_name,call_level\nDr Imported,2ND_CALL\nDr Separate,2ND_CALL\n');
const file=name=>({name,mimeType:'text/csv',buffer:bytes});
const activate=async(page,node)=>{await node.focus();await page.keyboard.press('Enter');};
const multipart=async request=>new Request('http://fixture.invalid',{method:'POST',headers:{'content-type':request.headers()['content-type']},body:request.postDataBuffer()}).formData();
async function mount(page,surface){
 await page.evaluate(async surface=>{
  if(surface==='workbook')(await import('/src/member-import.ts')).mountMemberImport(document.querySelector('#host'),async()=>{});
  else document.querySelector('#open').onclick=async()=>surface==='csv'?(await import('/src/member-workspace.ts')).openMemberCsvImport(()=>{}):(await import('/src/operational-import.ts')).openOperationalImport(surface,'2026-10',()=>{},true);
 },surface);
 if(surface!=='workbook')await activate(page,page.locator('#open'));
 else await activate(page,page.locator('#host summary').first());
}
for(const engine of engines){const browser=await({chromium,firefox,webkit})[engine].launch();
 try{for(const width of widths)for(const surface of surfaces){
  const modes=surface==='workbook'?['workbook']:surface==='csv'?['roster_sync','create_only','update_existing']:['update_matching','append','replace_month'];
  for(const mode of engine==='chromium'?modes:modes.slice(0,1)){
   const page=await browser.newPage({viewport:{width,height:width===320?568:900}});page.setDefaultTimeout(12000);
   await observeImportUploads(page);
   const errors=[],previews=[],requests=[],prompts=[];let failPreview=false;
   page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{prompts.push(d.message());await d.accept();});
   await page.route('**/__retention_boundary',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open import</button><main id="host"></main></body></html>'}));
   await page.route('**/api/**',async route=>{
    const q=route.request(),path=new URL(q.url()).pathname;requests.push({method:q.method(),path});
    if(q.method()==='GET'){
     if(path.endsWith('/admin/members'))return route.fulfill({json:people});
     if(path.endsWith('/normalization/units'))return route.fulfill({json:[]});
     throw Error('Unexpected GET '+path);
    }
    assert.ok(!path.endsWith('/apply'),'This retention-boundary suite never applies');
    const form=await multipart(q),observed=await observedImportFile(page,path);assert.equal(observed.filename,form.get('file').name);assert.equal(observed.bytes,bytes.toString());if(engine!=='webkit')assert.equal(await form.get('file').text(),bytes.toString());
    if(path.endsWith('/inspect'))return route.fulfill({json:{header_row:1,fields:['name','call_level'],sheets:[{name:'Members',headers:['canonical_name','call_level'],mapping:{name:0,call_level:1}}]}});
    if(path.endsWith('/columns'))return route.fulfill({json:{headers:['canonical_name','call_level'],fields:['member_name','posting_type'],suggested:{canonical_name:'member_name'}}});
    assert.ok(path.endsWith('/preview'));
    const settings=surface==='workbook'?JSON.parse(form.get('options')):surface==='csv'?{mapping:JSON.parse(form.get('mapping')),corrections:JSON.parse(form.get('corrections')),mode:form.get('mode')}:{...JSON.parse(form.get('settings_json')),mode:form.get('mode'),month:form.get('month')};
    previews.push({file:form.get('file').name,bytes:sha(observed.bytes),byte_observation:engine==='webkit'?'native fetch FormData File; interception protocol omits file bytes':'native fetch FormData File and intercepted multipart',settings});
    if(failPreview){failPreview=false;return route.fulfill({status:503,json:{detail:'Retained choice diagnostic failure'}});}
    const selected=surface==='workbook'?settings.resolutions['2']:surface==='csv'?settings.corrections['2']?.member_id:settings.corrections['CSV:2']?.person_id;
    const chosen=selected||'a';
    if(surface==='workbook')return route.fulfill({json:{preview_hash:'boundary-hash',counts:{create:0,update:1,unchanged:1},rows:[2,3].map(n=>({row:n,raw:{name:n===2?'Imported':'Separate'},normalized:{name:n===2?'Imported':'Separate'},target_id:n===2?chosen:'a',target_name:'Dr '+(n===2?chosen:'a'),action:settings.resolutions[String(n)]==='skip'?'skip':n===2?'update':'unchanged',changes:{},errors:[],candidates:n===2?candidates:[],resolution_status:'matched',resolution_method:'member_id'}))}});
    if(surface==='csv')return route.fulfill({json:{id:'boundary-preview',mode:settings.mode,headers:['canonical_name','call_level'],rows:[2,3].map(n=>({row_number:n,values:{canonical_name:n===2?'Imported':'Separate',...(n===2&&selected?{member_id:selected}:{})},person_id:n===2?chosen:'a',before:{canonical_name:'Dr '+(n===2?chosen:'a'),call_level:'2ND_CALL',active_status:'active'},after:{canonical_name:n===2?'Imported':'Separate',active_status:'active'},revision:'one',action:settings.mode==='create_only'?'invalid':n===2?'update':'unchanged',errors:settings.mode==='create_only'?['Member already exists as active; use update-existing mode']:[],suggestions:[]})),missing:settings.mode==='roster_sync'?[{id:'missing',canonical_name:'Dr missing',call_level:'2ND_CALL'}]:[]}});
    return route.fulfill({json:{id:'boundary-preview',kind:surface,month:settings.month,mode:settings.mode,headers:['canonical_name','call_level'],fields:['member_name'],replacement_scope:settings.mode==='replace_month'?[{person_id:'a',starts_on:'2026-10-01',ends_on:'2026-10-02'}]:[],rows:[2,3].map(n=>({key:'CSV:'+n,source:{sheet:'CSV',row:n},original:{canonical_name:n===2?'Imported':'Separate'},values:{member_name:n===2?'Imported':'Separate',starts_on:'2026-10-01',ends_on:'2026-10-02',posting_type:'2ND_CALL',leave_type:'CL',leave_slot:'FULL_DAY',status:'approved'},after:{person_id:n===2?chosen:'a',posting_type:'2ND_CALL',starts_on:'2026-10-01'},action:'create',issues:[],warnings:[],person_match:{state:'matched',status:'matched',person_id:n===2?chosen:'a',canonical_name:'Dr '+(n===2?chosen:'a'),method:'member_id',candidates:[],warnings:[]}}))}});
   });
   await page.goto(base+'/__retention_boundary');await mount(page,surface);
   const host=()=>surface==='workbook'?page.locator('#host'):page.locator('dialog').last();
   const message=()=>host().locator(surface==='workbook'?'.member-import > p[role=status]':surface==='csv'?'#csv-message':'[data-message]');
   const preview=()=>surface==='workbook'?host().locator('[data-mi=preview]'):host().getByRole('button',{name:surface==='csv'?'Preview import':'Preview and normalize',exact:true});
   const mapping=()=>host().locator(surface==='workbook'?'[data-mi-field]':surface==='csv'?'[data-map-column]':'[data-map]');
   const settled=async()=>page.waitForFunction(()=>!document.querySelector('input[type=file]:disabled')&&!/Reading and validating CSV|Parsing and normalizing records|Working\u2026/.test(document.body.innerText));
   const goodPreview=async()=>{const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/preview')&&r.status()===200);await activate(page,preview());await response;await settled();};
   if(surface!=='workbook')await host().locator('[name=mode]').selectOption(mode);
   await host().locator('input[type=file]').setInputFiles(file('retained.csv'));
   if(surface==='workbook')await activate(page,host().locator('[data-mi=inspect]'));
   await mapping().first().waitFor({state:'attached'});
   if(surface==='workbook')await host().locator('[data-mi-field=call_level]').selectOption('');
   else if(surface==='csv'){await activate(page,host().locator('#csv-column-mapping summary'));await host().locator('[data-map-column="0"]').selectOption('canonical_name');await host().locator('[data-map-column="1"]').selectOption('');}
   else{await host().locator('[data-map="0"]').selectOption('member_name');await host().locator('[name=date_format]').selectOption('DMY');}
   await goodPreview();await host().locator('.member-match__identity').first().waitFor();
   if(surface==='workbook'){
    await activate(page,host().locator('[data-mi-resolve-row="3"][data-mi-resolve=skip]'));await settled();
    failPreview=true;await activate(page,host().locator('[data-pick-member=b]'));
   }else{
    const include=host().locator(surface==='csv'?'[data-include="3"]':'[data-include="CSV:3"]');
    if(surface==='csv'&&mode==='create_only')await include.check();else await include.uncheck();
    if(surface==='csv'&&mode==='roster_sync')await host().locator('[data-archive=missing]').check();
    const row=host().locator(surface==='csv'?'[data-csv-row="2"]':'[data-review-row="CSV:2"]');
    await activate(page,row.locator(surface==='csv'?'.import-row-edit summary':'.import-row__edit summary'));
    if(surface==='csv')await row.locator('[data-key=member_id]').fill('b');
    else await row.locator('[data-field=person_id]').selectOption('b');
    failPreview=true;await activate(page,preview());
   }
   await message().filter({hasText:'Retained choice diagnostic failure'}).waitFor();
   const retained=structuredClone(previews.at(-1));await goodPreview();assert.deepEqual(previews.at(-1),retained,'Failure retry retains file bytes/mapping/corrections/mode context exactly');
   if(surface==='workbook')assert.deepEqual(retained.settings.resolutions,{'2':'b','3':'skip'});
   else if(surface==='csv'){
    assert.equal(await host().locator('[data-include="3"]').isChecked(),mode==='create_only');
    if(mode==='roster_sync')assert.equal(await host().locator('[data-archive=missing]').isChecked(),true);
    assert.equal(retained.settings.corrections['2'].member_id,'b');
   }else{assert.deepEqual(retained.settings.excluded,['CSV:3']);assert.equal(await host().locator('[data-include="CSV:3"]').isChecked(),false);assert.equal(retained.settings.corrections['CSV:2'].person_id,'b');}
   assert.match(await host().innerText(),/Replacing the file resets mappings and review choices/);
   const inspectionResponse=page.waitForResponse(r=>/\/(columns|inspect)$/.test(new URL(r.url()).pathname)&&r.status()===200);
   await host().locator('input[type=file]').setInputFiles(file('replacement.csv'));
   if(surface==='workbook')await activate(page,host().locator('[data-mi=inspect]'));
   await inspectionResponse;await mapping().first().waitFor({state:'attached'});
   assert.equal(await host().locator('.member-match').count(),0,'Ready review removed on native replacement');
   assert.deepEqual(await host().locator('[data-import-steps] .ds-steps__item').evaluateAll(nodes=>nodes.map(n=>n.dataset.state)),['done','current','upcoming','upcoming']);
   await goodPreview();
   const reset=previews.at(-1).settings;
   assert.deepEqual(surface==='workbook'?reset.resolutions:reset.corrections,{});
   if(surface==='csv'){assert.equal(await host().locator('[data-include="3"]').isChecked(),mode!=='create_only');if(mode==='roster_sync')assert.equal(await host().locator('[data-archive=missing]').isChecked(),false);}
   if(surface==='units'||surface==='leave')assert.deepEqual(reset.excluded,[]);
   if(surface!=='workbook'){
    await page.keyboard.press('Escape');await host().waitFor({state:'detached'});assert.match(prompts.at(-1),/Discard this import draft/);
    await activate(page,page.locator('#open'));assert.equal(await host().locator('input[type=file]').evaluate(n=>n.files.length),0);assert.equal(await mapping().count(),0);assert.equal(await host().locator('.member-match').count(),0);
   }
   await page.reload();await mount(page,surface);
   assert.equal(await host().locator('input[type=file]').evaluate(n=>n.files.length),0,'Actual reload does not restore File permissions');
   assert.equal(await mapping().count(),0);assert.equal(await host().locator('.member-match').count(),0);
   assert.deepEqual(await host().locator('[data-import-steps] .ds-steps__item').evaluateAll(nodes=>nodes.map(n=>n.dataset.state)),['current','upcoming','upcoming','upcoming']);
   assert.equal(requests.filter(r=>r.path.endsWith('/apply')).length,0);assert.deepEqual(errors,[]);
   results.push({engine,width,surface,mode,retainedRequest:retained,nonemptyReviewChoiceRetained:true,readyReviewReplacementResetsChoices:true,acceptedDiscardAndReopen:surface!=='workbook',actualReloadStartsEmpty:true,applyRequests:0});
   console.log(`Retention boundary ${engine} ${width} ${surface} ${mode}`);await page.close();
  }
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Held actual app and test sources unchanged');
await writeFile(process.env.BOUNDARY_REPORT||'../docs/premium-ui/qa-import-retention-boundaries.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,status:'Scoped browser evidence, not acceptance',file_byte_evidence:'All engines: passive actual native-fetch FormData File name/text observation without modifying fetch arguments/body/return. Chromium/Firefox additionally assert intercepted multipart bytes; WebKit raw file payload is omitted by interception. No server-received-byte certification.',scope:'Native mapping/member choice plus nonempty CSV inclusion/archive, operational exclusion, workbook skip decisions across preview503/retry; remaining modes in Chromium, default modes in Firefox/WebKit; native ready-review replacement, accepted discard/reopen, actual browser reload. Create-only existing-member fixture remains server-style invalid, with explicit inclusion choice retained. No Apply or persistence claim.',results},null,2)+'\n');
console.log(`Retention boundaries: ${results.length} workflows passed`);
