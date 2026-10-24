import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const files=['src/operational-import.ts','src/member-workspace.ts','src/main.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const initial=await hashes(),results=[];
const person={id:'ready',canonical_name:'Dr Ready',active_status:'active',call_level:'2ND_CALL',designations:[],aliases:[]};
const row={key:'CSV:2',source:{sheet:'CSV',row:2},original:{Employee:'Dr Ready',Date:'invalid'},values:{member_name:'Dr Ready',starts_on:'invalid',ends_on:'2026-10-04',leave_type:'CL',leave_slot:'FULL_DAY',status:'requested',unit_name:'Main',posting_type:'2ND_CALL'},after:{person_id:'ready',starts_on:null,posting_type:'2ND_CALL'},action:'needs_review',issues:['Invalid start date'],warnings:[],person_match:{state:'matched',status:'matched',canonical_name:'Dr Ready',method:'exact',reason:'Exact match',warnings:[],candidates:[]}};
for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try { for(const width of [320,1280]) for(const kind of ['leave','units']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],requests=[];let attempts=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','import-keyboard-audit');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());requests.push({path:url.pathname,method:req.method()});
   if(url.pathname==='/api/v1/import-review/columns')return route.fulfill({json:{headers:['Employee','Date'],fields:['member_name','starts_on'],suggested:{Employee:'member_name',Date:'starts_on'}}});
   if(url.pathname===`/api/v1/import-review/${kind}/preview`){attempts++;if(attempts===2)return route.fulfill({status:503,json:{detail:'Preview temporarily unavailable. Try again.'}});const returned=structuredClone(row);if(attempts===3){returned.values.starts_on='2026-10-03';returned.after.starts_on='2026-10-03';returned.issues=[];returned.action='create';}return route.fulfill({json:{id:'preview-batch',kind,month:'2026-10',mode:'append',headers:['Employee','Date'],fields:['member_name','starts_on'],replacement_scope:[],rows:[returned]}});}
   if(req.method()!=='GET')return route.fulfill({status:599,json:{detail:'Unexpected mutation intercepted'}});
   if(url.pathname==='/api/v1/admin/members')return route.fulfill({json:[person]});
   if(url.pathname==='/api/v1/normalization/units')return route.fulfill({json:[]});
   try {return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+url.pathname+url.search})});}catch(error){errors.push('transport '+error.message);return route.fulfill({status:599,json:{detail:'Fixture unavailable'}});}
  });
  await page.goto('http://127.0.0.1:5197/#view='+kind);await page.locator(`[data-open-normalized-import="${kind}"]`).click();const dialog=page.locator('dialog.operational-import');await dialog.waitFor();await dialog.locator('input[type=file]').setInputFiles({name:kind+'.csv',mimeType:'text/csv',buffer:Buffer.from('Employee,Date\nDr Ready,invalid\n')});await dialog.locator('[data-map="0"]').waitFor();await dialog.getByRole('button',{name:'Preview and normalize',exact:true}).click();await dialog.locator('[data-refresh]').waitFor();
  await dialog.locator('[data-review-row="CSV:2"] summary').click();const start=dialog.locator('[data-row="CSV:2"][data-field=starts_on]');await start.fill('2026-10-03');await start.press('Tab');assert.equal(await dialog.locator('[data-apply]').getAttribute('aria-disabled'),'true');const refresh=dialog.locator('[data-refresh]');await refresh.focus();await page.keyboard.press('Enter');await dialog.locator('[data-message]').filter({hasText:'Preview temporarily unavailable'}).waitFor();
  const failure={top:await dialog.locator('[data-message]').textContent(),footer:await dialog.locator('[data-apply-status]').textContent(),draft:await start.inputValue(),focus:await page.evaluate(()=>({tag:document.activeElement?.tagName,refresh:document.activeElement?.hasAttribute('data-refresh')}))};
  assert.match(failure.top,/Preview temporarily unavailable/);assert.doesNotMatch(failure.footer,/Preview temporarily unavailable/);assert.equal(failure.draft,'2026-10-03');assert.equal(failure.focus.refresh,true);
  await page.keyboard.press('Space');await dialog.locator('[data-message]').filter({hasText:'1 rows normalized'}).waitFor();
  const successFocus=await page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,refresh:document.activeElement?.hasAttribute('data-refresh'),insideImport:!!document.activeElement?.closest('dialog.operational-import')}));
  assert.equal(successFocus.refresh,false);assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.method!=='GET').length,4);results.push({engine,width,kind,failure,success_focus:successFocus,preview_attempts:attempts,apply_requests:0,javascript_errors:errors});await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Sources changed during run');
await writeFile('../docs/premium-ui/reviews/operational-import-keyboard-audit-current.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),requirements:[135,136,137,138,139,140,212,223],source_hashes:initial,scope:'Actual application Leave/Units toolbar to file selection and normalized preview. Correct date, blur, keyboardEnter Refresh returning intercepted503, then nativeSpace retry success. Three engines320/1280. Intercepted columns/preview only; no apply.',results,findings:['Refresh503 failure is written only to top status; adjacent footer status retains stale correction instructions. Date draft and keyboard refresh focus survive failure.','Successful refresh removes the focused footer button and leaves keyboard focus on BODY, losing the review context.'],completion_claim:false},null,2)+'\n');
console.log('Reproduced normalized importer footer error/focus defects in '+results.length+' workflows');
