import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['operational-import','member-workspace','import-review-presentation','ui'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>['frontend/src/'+f+'.ts',sha(await readFile('src/'+f+'.ts'))])));
const initial=await hashes(),results=[];
const people=['a','b'].map(id=>({id,canonical_name:'Dr Similar '+id,call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]}));
const multipart=async q=>new Request('http://fixture.invalid',{method:'POST',headers:{'content-type':q.headers()['content-type']},body:q.postDataBuffer()}).formData();
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280])for(const kind of ['units','leave']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],submitted=[];let fail=false,hold=false,release,arrived;
  page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.route('**/__row157',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open import</button></body></html>'}));
   await page.route('**/api/**',async route=>{
    const q=route.request(),path=new URL(q.url()).pathname;
    if(q.method()==='GET'){if(path.endsWith('/admin/members'))return route.fulfill({json:people});if(path.endsWith('/normalization/units'))return route.fulfill({json:[]});throw Error(path);}
    assert.ok(!path.endsWith('/apply'),'No apply allowed');
    if(path.endsWith('/columns'))return route.fulfill({json:{headers:['member_name'],fields:['member_name'],suggested:{member_name:'member_name'}}});
    assert.ok(path.endsWith('/'+kind+'/preview'));
    const form=await multipart(q),settings=JSON.parse(form.get('settings_json'));submitted.push(structuredClone(settings));
    if(fail){fail=false;return route.fulfill({status:503,json:{detail:'Independent row157 retry refusal'}});}
    const rows=Array.from({length:26},(_,index)=>{const key=index===25?'Second sheet:2':index===0?'First sheet:2':'First sheet:'+(index+2),person=settings.corrections[key]?.person_id||((index===0||index===25)?null:'a');return{key,source:{sheet:index===25?'Second sheet':'First sheet',row:index===25?2:index+2},original:{member_name:'Same imported name'},values:{member_name:'Same imported name',starts_on:'2026-11-01',ends_on:'2026-11-02',posting_type:'2ND_CALL',leave_type:'CL',leave_slot:'FULL_DAY',status:'requested'},after:{person_id:person,starts_on:'2026-11-01',ends_on:'2026-11-02',status:'requested'},action:person?'create':'invalid',issues:person?[]:['Unresolved row '+key],warnings:[],person_match:{state:person?'matched':'ambiguous',status:person?'matched':'ambiguous',person_id:person,canonical_name:person?'Dr Similar '+person:null,method:person?'member_id':'name',candidates:[],warnings:[]}};});
    if(hold){hold=false;arrived();await new Promise(r=>release=r);}
    return route.fulfill({json:{id:'row157-'+submitted.length,kind,month:'2026-11',mode:'update_matching',headers:['member_name'],fields:['member_name'],rows,replacement_scope:[]}});
   });
   await page.goto('http://127.0.0.1:5197/__row157');await page.evaluate(async kind=>{document.querySelector('#open').onclick=()=>void import('/src/operational-import.ts').then(m=>m.openOperationalImport(kind,'2026-11',()=>{},true));},kind);
   await page.locator('#open').focus();await page.keyboard.press('Enter');const dialog=page.locator('dialog.operational-import');
   await page.locator('input[type=file]').setInputFiles({name:'same-rows.csv',mimeType:'text/csv',buffer:Buffer.from('member_name\nSame imported name\n')});
   await page.locator('[data-map]').first().waitFor();await page.getByRole('button',{name:'Preview and normalize',exact:true}).click();await page.locator('[data-review-row="First sheet:2"]').waitFor();
   const counts=()=>page.locator('[data-review-counts]').innerText();assert.match(await counts(),/24 ready.*2 need review/);
   const first=page.locator('[data-review-row="First sheet:2"]');await first.locator('details > summary').click();await first.locator('select[data-field=person_id]').selectOption('b');
   assert.match(await page.locator('[data-import-preview-authority]').innerText(),/refresh/i);assert.equal(await page.locator('[data-apply]').getAttribute('aria-disabled'),'true');
   fail=true;await page.locator('[data-refresh]').click();await page.locator('[data-message]').filter({hasText:'Independent row157 retry refusal'}).waitFor();assert.equal(await first.locator('select[data-field=person_id]').inputValue(),'b');assert.match(await counts(),/24 ready.*2 need review/);
   await page.locator('[data-refresh]').click();await page.waitForFunction(()=>document.querySelector('[data-review-counts]')?.textContent.includes('25 ready'));
   assert.equal(submitted.at(-1).corrections['First sheet:2'].person_id,'b');assert.equal(submitted.at(-1).corrections['Second sheet:2'],undefined);
   await page.locator('[data-page="1"]').click();const second=page.locator('[data-review-row="Second sheet:2"]');await second.waitFor();assert.match(await second.innerText(),/Unresolved row Second sheet:2/);
   await second.locator('details > summary').click();await second.locator('select[data-field=person_id]').selectOption('a');
   const pending=new Promise(r=>arrived=r);hold=true;await page.locator('[data-refresh]').click();await pending;
   await second.locator('select[data-field=person_id]').selectOption('b');release();await page.locator('[data-message]').filter({hasText:'Inputs changed while the preview was loading'}).waitFor();assert.equal(await second.locator('select[data-field=person_id]').inputValue(),'b');assert.match(await counts(),/25 ready.*1 need review/);
   await page.locator('[data-refresh]').click();await page.waitForFunction(()=>document.querySelector('[data-review-counts]')?.textContent.includes('26 ready'));
   assert.equal(submitted.at(-1).corrections['First sheet:2'].person_id,'b');assert.equal(submitted.at(-1).corrections['Second sheet:2'].person_id,'b');assert.match(await counts(),/26 ready.*0 need review/);
   assert.deepEqual(errors,[]);results.push({engine,width,kind,matchingSameNamesDifferentSheets:true,paginationPreservesExactKeys:true,failedPreviewRetainsCorrectionsAndOldCounts:true,latePreviewDoesNotClaimCompletion:true,latestAuthoritativeCounts:true,requests:submitted,errors});console.log(engine+' '+width+' '+kind+' row157 pass');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-import157-row-authority-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/reference157158_evidence_audit',scope:'12current isolated operational-import controller cases,26same-name rows with repeated source row2 across distinctsheetkeys,units/leave,3engines320/1280. Corrections/503retry/pagination/heldlatepreview/latestreturnedcounts. Localresponsesonly,noapply/backendoperations. NotmemberCSV/workbook row coverage or full157acceptance.',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,results},null,2)+'\n');console.log('Import157 rows:12cases pass');
