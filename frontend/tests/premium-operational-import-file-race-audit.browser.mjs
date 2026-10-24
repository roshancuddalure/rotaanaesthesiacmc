import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sourceFiles=['src/operational-import.ts','src/member-workspace.ts','src/main.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
const initial=await hashes(),results=[],quick=process.env.IMPORT_AUDIT_QUICK==='1';
const person={id:'ready',canonical_name:'Dr Ready',active_status:'active',call_level:'2ND_CALL',designations:[],aliases:[]};
const row={key:'CSV:2',source:{sheet:'CSV',row:2},original:{Employee:'Dr Ready',Date:'2026-10-03'},values:{member_name:'Dr Ready',starts_on:'2026-10-03',ends_on:'2026-10-04',leave_type:'CL',leave_slot:'FULL_DAY',status:'requested',unit_name:'Main',posting_type:'2ND_CALL'},after:{person_id:'ready',starts_on:'2026-10-03',posting_type:'2ND_CALL'},action:'create',issues:[],warnings:[],person_match:{state:'matched',status:'matched',canonical_name:'Dr Ready',method:'exact',reason:'Exact match',warnings:[],candidates:[]}};
for(const [engine,launcher] of Object.entries(quick?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of quick?[320]:[320,1280])for(const kind of quick?['leave']:['leave','units']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],mutations=[],prompts=[];
  let columnsA,applyB,notifyA,notifyApply;const aReady=new Promise(resolve=>notifyA=resolve),applyReady=new Promise(resolve=>notifyApply=resolve);
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async prompt=>{prompts.push(prompt.message());if(prompt.message().startsWith('Apply '))await prompt.accept();else await prompt.dismiss();});
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','import-file-race-audit');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()!=='GET')mutations.push({path:url.pathname,body:req.postData()});
   if(url.pathname==='/api/v1/import-review/columns'){
    if((req.postData()||'').includes('filename="file-A.csv"')){columnsA=route;notifyA();return;}
    const isC=(req.postData()||'').includes('filename="file-C.csv"');const header=isC?'C Employee':'B Employee';
    return route.fulfill({json:{headers:[header,'Date'],fields:['member_name','starts_on'],suggested:{[header]:'member_name',Date:'starts_on'}}});
   }
   if(url.pathname===`/api/v1/import-review/${kind}/preview`)return route.fulfill({json:{id:'preview-B',kind,month:'2026-10',mode:'append',headers:['B Employee','Date'],fields:['member_name','starts_on'],replacement_scope:[],rows:[row]}});
   if(url.pathname==='/api/v1/import-review/preview-B/apply'){applyB=route;notifyApply();return;}
   if(req.method()!=='GET')return route.fulfill({status:599,json:{detail:'Unexpected mutation intercepted'}});
   if(url.pathname==='/api/v1/admin/members')return route.fulfill({json:[person]});
   if(url.pathname==='/api/v1/normalization/units')return route.fulfill({json:[]});
   try{return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+url.pathname+url.search})});}catch(error){errors.push('transport '+error.message);return route.fulfill({status:599,json:{detail:'Fixture unavailable'}});}
  });
  await page.goto('http://127.0.0.1:5197/#view='+kind);await page.locator(`[data-open-normalized-import="${kind}"]`).click();const dialog=page.locator('dialog.operational-import');await dialog.waitFor();const file=dialog.locator('input[type=file]');
  const choose=name=>file.setInputFiles({name,mimeType:'text/csv',buffer:Buffer.from('Employee,Date\nDr Ready,2026-10-03\n')});
  await choose('file-A.csv');await aReady;await choose('file-B.csv');await dialog.locator('[data-map="0"]').waitFor();assert.equal(await dialog.locator('[data-map="0"]').inputValue(),'member_name');
  const beforeLateFailure=await dialog.locator('[data-message]').textContent();await columnsA.fulfill({status:503,json:{detail:'Old file A inspection failed'}});await dialog.locator('[data-message]').filter({hasText:'Old file A inspection failed'}).waitFor();assert.equal(await file.evaluate(el=>el.files[0].name),'file-B.csv');assert.match(await dialog.locator('[data-mapping]').textContent(),/B Employee/);
  await dialog.getByRole('button',{name:'Preview and normalize',exact:true}).click();await dialog.locator('[data-apply]').waitFor();await dialog.getByRole('button',{name:'Apply reviewed rows',exact:true}).click();await applyReady;assert.equal(await file.isEnabled(),true);await choose('file-C.csv');await dialog.locator('[data-mapping]').filter({hasText:'C Employee'}).waitFor();assert.equal(await dialog.locator('[data-review]').textContent(),'');
  const completed=page.waitForResponse(response=>response.url().endsWith('/preview-B/apply'));await applyB.fulfill({json:{created:1,updated:0,unchanged:0,excluded:0,removed:0,batch_id:'old-file-B-applied'}});await completed;await dialog.getByRole('heading',{name:'Import complete',exact:true}).waitFor();assert.equal(await file.evaluate(el=>el.files[0].name),'file-C.csv');assert.match(await dialog.locator('[data-review]').textContent(),/old-file-B-applied/);
  await dialog.getByRole('button',{name:'Close import review',exact:true}).click();assert.equal(await dialog.count(),0,'Current file C draft closes silently after older file B apply');assert.equal(prompts.length,1,'Only Apply B confirmation appeared; no discard prompt for file C');assert.match(prompts[0],/^Apply 1 reviewed rows/);assert.equal(mutations.filter(item=>item.path.endsWith('/apply')).length,1);assert.deepEqual(errors,[]);
  results.push({engine,width,kind,columns_failure:{newer_file:'file-B.csv',before_late_failure:beforeLateFailure,stale_old_error_overwrote_new_status:true,new_mapping_preserved:true},apply_lifetime:{file_picker_enabled_during_apply:true,new_file:'file-C.csv',old_batch_completion_rendered_for_new_draft:true,new_draft_close_prompt:false,apply_confirmation_count:prompts.length,intercepted_apply_requests:1},javascript_errors:errors});await page.close();
 }}finally{await browser.close();}
}
const final=await hashes();for(const file of ['src/operational-import.ts','src/member-workspace.ts'])assert.equal(final[file],initial[file],'Relevant source changed');
await writeFile('../docs/premium-ui/reviews/operational-import-file-race-audit-current.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),requirements:[135,136,137,138,139,140,212,223],scope:'Actual Leave/Units toolbar; hold old columns A, inspect B, release old503; preview/apply B intercepted, choose new file C while applying, release old mocked success, actual Close. No backend writes. Main snapshot drift recorded separately.',source_hashes_start:initial,source_hashes_end:final,main_changed:initial['src/main.ts']!==final['src/main.ts'],results,findings:['Old file inspection503 overwrites successful current-file mapping feedback.','File selection during pending Apply permits a new draft, then old completion marks it finished and suppresses its discard confirmation.'],completion_claim:false},null,2)+'\n');console.log('Reproduced importer file races in '+results.length+' workflows');
