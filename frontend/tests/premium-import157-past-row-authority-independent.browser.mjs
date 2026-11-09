import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const sources=['past-duties.ts','ui.ts','import-report.ts','import-review-presentation.ts','services/api.ts','premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async n=>['frontend/src/'+n,sha(await readFile('src/'+n))]))),initial=await hashes();
const policy={enabled:true,lookback_months:6,total_weight:1,hours24_weight:2,weekend_weight:3,group_weight:4};
const members=[{id:'past-person-a',canonical_name:'Same imported name',active_status:'active'},{id:'past-person-b',canonical_name:'Same imported name',active_status:'active'}];
const status={today:'2026-10-21',policy,coverage:[],duty_types:[{key:'night',label:'Night duty'}],history:[]};
const inspection={header_row:1,fields:['date','name','duty_type'],sheets:['Duties','Other'].map(name=>({name,headers:['Date','Name','Duty'],mapping:{date:0,name:1,duty_type:2}}))};
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280]){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],uploads=[];let release,held=false,failNext=false,previewCount=0;
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__past157',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main><div id="host"></div></main></body></html>'}));
  await page.route('**/api/**',async r=>{
   const q=r.request(),path=new URL(q.url()).pathname;
   if(q.method()==='GET'){
    if(path.endsWith('/status'))return r.fulfill({json:status});
    if(path==='/api/v1/admin/members')return r.fulfill({json:members});
    if(path.endsWith('/recorded'))return r.fulfill({json:{items:[],truncated:false}});
    throw new Error('Unexpected read '+path);
   }
   assert.ok(/\/(inspect|preview)$/.test(path),'No Apply or operational mutation allowed');
   const form=await new Request('http://fixture.invalid',{method:'POST',headers:{'content-type':q.headers()['content-type']},body:q.postDataBuffer()}).formData();
   const options=JSON.parse(form.get('options'));uploads.push({path,options,name:form.get('file').name});
   if(path.endsWith('/inspect'))return r.fulfill({json:inspection});
   previewCount++;
   if(failNext){failNext=false;held=true;await new Promise(resolve=>release=resolve);held=false;return r.fulfill({status:503,json:{detail:'Held row review unavailable; retry preview'}});}
   const rows=[['cell-2-2',2,2],['cell-2-3',2,3]].map(([key,row,column])=>{
    const resolution=options.resolutions[key]??{},matched=Boolean(resolution.person_id);
    return{key,row,column,action:matched?'correct':'needs_review',raw:{name:'Same imported name',date:'2026-09-02'},normalized:matched?{person_id:resolution.person_id,name:'Same imported name'}:{},resolution_status:matched?'matched':'ambiguous',resolution_reason:matched?'Confirmed saved member identity':'Two candidates have the same name',person_candidates:members.map(p=>({id:p.id,name:p.canonical_name})),errors:matched?[]:['Choose member'],conflicts:[],target_assignment:null};
   });
   const correct=rows.filter(x=>x.action==='correct').length;
   return r.fulfill({json:{preview_hash:'past157-'+previewCount,month:options.month,sheet:options.sheet,counts:{create:0,correct,unchanged:0,skip:0,needs_review:2-correct},warnings:[],rows}});
  });
  try{
   await page.goto('http://127.0.0.1:5197/__past157');await page.evaluate(async()=>{await(await import('/src/past-duties.ts')).mountPastDuties(document.querySelector('#host'));});
   const host=page.locator('#host'),control=n=>host.locator('[data-past="'+n+'"]'),row=k=>host.locator('[data-past-row-key="'+k+'"]');
   const idle=async()=>{await page.waitForFunction(()=>![...document.querySelectorAll('#host [role=status]')].some(n=>/Working|Loading past duties/.test(n.textContent||'')));};
   const action=async n=>{await control(n).click();await idle();};
   await control('file').setInputFiles({name:'origin.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('local transport fixture')});await action('inspect');await action('preview');
   assert.equal(await row('cell-2-2').locator('[data-pick-member]').count(),2);assert.equal(await row('cell-2-3').locator('[data-pick-member]').count(),2);
   failNext=true;await row('cell-2-2').locator('[data-pick-member="past-person-b"]').click();await page.waitForFunction(()=>document.querySelector('#host [data-past="preview"]')?.matches(':disabled')===true);
   assert.equal(held,true);assert.equal(await row('cell-2-3').locator('[data-pick-member="past-person-a"]').isDisabled(),true);
   assert.match(await host.locator('[data-import-preview-authority]').innerText(),/changed|again|pending/i);
   release();await idle();assert.match(await host.getByRole('status').first().innerText(),/Held row review unavailable/);
   assert.deepEqual(uploads.at(-1).options.resolutions,{'cell-2-2':{person_id:'past-person-b'}});
   assert.match(await host.locator('#past-apply-blocker').innerText(),/Selections changed/);
   const calls=uploads.length;await action('apply');assert.equal(uploads.length,calls,'No submission from stale review');
   await action('preview');assert.deepEqual(uploads.at(-1).options.resolutions,{'cell-2-2':{person_id:'past-person-b'}});
   assert.equal(await row('cell-2-2').locator('[data-past-resolve-row="cell-2-2"]').filter({hasText:'Undo'}).count(),1);
   assert.equal(await row('cell-2-3').locator('[data-past-resolve-row="cell-2-3"]').filter({hasText:'Undo'}).count(),0);
   await control('filter').selectOption('needs_review');assert.equal(await row('cell-2-2').count(),0);assert.equal(await row('cell-2-3').count(),1);
   await row('cell-2-3').locator('[data-pick-member="past-person-a"]').click();await idle();assert.deepEqual(uploads.at(-1).options.resolutions,{'cell-2-2':{person_id:'past-person-b'},'cell-2-3':{person_id:'past-person-a'}});
   await control('filter').selectOption('all');assert.equal(await host.locator('[data-past-row-key]').count(),2);assert.match(await host.innerText(),/2 correct/);assert.match(await host.innerText(),/0 needs review/);
   for(const[key,id]of [['cell-2-2','past-person-b'],['cell-2-3','past-person-a']]){await row(key).locator('summary').click();assert.equal(await row(key).locator('[data-resolution=person_id]').inputValue(),id);}
   await control('sheet').selectOption('Other');assert.equal(await host.locator('[data-past-row-key]').count(),0);await action('preview');assert.deepEqual(uploads.at(-1).options.resolutions,{});assert.equal(await host.locator('[data-past-row-key]').count(),2);
   await control('file').setInputFiles({name:'replacement.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('replacement local transport')});assert.equal(await host.locator('[data-past-row-key]').count(),0);await action('inspect');await action('preview');assert.deepEqual(uploads.at(-1).options.resolutions,{});assert.equal(uploads.at(-1).name,'replacement.xlsx');
   assert.deepEqual(errors,[]);results.push({engine,width,exactSameRowDifferentColumns:true,held503RetainsOriginAndBlocksCompletion:true,manualRetryUsesSameKeys:true,filterPreservesOtherRowIdentity:true,latestAuthoritativeCounts:true,sheetAndFileReplacementClearCorrections:true,uploads,errors});console.log(engine+' '+width+' Past Duties row157 passed');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-import157-past-row-authority-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/import157_final_scope_audit',scope:'New independent current PastDuties157 actual controller6contexts:3engines320/1280,same source row/differentcolumns,same imported/candidate names with distinctstableIDs,held503preview,manualretry/filter/rerender andlatestcounts,sheet/fileclear. Inspect/preview requests only locallyfulfilled; Apply neverforwarded. Not workbook parsing,backend persistence or whole260.',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,results},null,2)+'\n');console.log('Past Duties157:6currentcontexts passed');
