import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium, firefox, webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const sourceFiles=['src/main.ts','src/operational-import.ts','src/import-report.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
const initialHashes=await hashes();
const results=[];
const cell=value=>'"'+String(value??'').replace(/^[\s]*[=+@-]|^[\t\r\n]/,"'$&").replaceAll('"','""')+'"';
const header=['sheet','row','name','action','issues','warnings','original_values','proposed_values','excluded'];
const rows=[
 {key:'CSV:2',source:{sheet:'=SUM(1,2)',row:2},original:{Employee:'=HYPERLINK("bad")',Date:'invalid'},values:{member_name:'=HYPERLINK("bad")',unit_name:'Main',starts_on:'invalid',ends_on:'2026-10-31',leave_type:'CL',leave_slot:'FULL_DAY',status:'requested',posting_type:'2ND_CALL'},after:{person_id:null},action:'needs_review',issues:['Invalid date, "check"\nline two'],warnings:['+formula warning'],person_match:{state:'needs_review',status:'needs_review',reason:'Choose a department member',warnings:[],candidates:[]}},
 {key:'CSV:3',source:{sheet:'CSV',row:3},original:{Employee:' Dr Ready',Date:'2026-10-03'},values:{member_name:' Dr Ready',unit_name:'Main',starts_on:'2026-10-03',ends_on:'2026-10-04',leave_type:'CL',leave_slot:'FULL_DAY',status:'requested',posting_type:'2ND_CALL'},after:{person_id:'ready',starts_on:'2026-10-03'},action:'create',issues:[],warnings:[],person_match:{state:'matched',status:'matched',canonical_name:'Dr Ready',method:'exact',reason:'Exact match',warnings:[],candidates:[]}},
 {key:'CSV:4',source:{sheet:'\t@import',row:4},original:{Employee:'  +Danger',Date:'2026-10-05'},values:{member_name:'  +Danger',unit_name:'Main',starts_on:'2026-10-05',ends_on:'2026-10-06',leave_type:'CL',leave_slot:'FULL_DAY',status:'requested',posting_type:'2ND_CALL'},after:{person_id:null},action:'needs_review',issues:['-Unresolved department member'],warnings:['Review source'],person_match:{state:'needs_review',status:'needs_review',reason:'Unresolved department member',warnings:[],candidates:[]}}
];
function expected(excluded){return '\ufeff'+[header,...rows.map(row=>[row.source.sheet,row.source.row,row.values.member_name,row.action,row.issues.join('; '),row.warnings.join('; '),JSON.stringify(row.original),JSON.stringify(row.after),excluded.includes(row.key)?'Yes':'No'])].map(row=>row.map(cell).join(',')).join('\r\n');}
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{for(const width of [320,1280])for(const kind of ['leave','units']){
  const context=await browser.newContext({viewport:{width,height:850},acceptDownloads:true,reducedMotion:'reduce'}),page=await context.newPage();
  const errors=[],writes=[],downloads=[],previews=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('download',download=>downloads.push(download));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','preview-report-test');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()!=='GET'){
    writes.push(url.pathname);
    if(url.pathname==='/api/v1/import-review/columns')return route.fulfill({json:{headers:['Employee','Date'],fields:['member_name','starts_on'],suggested:{Employee:'member_name',Date:'starts_on'}}});
    if(url.pathname===`/api/v1/import-review/${kind}/preview`){previews.push(req.postData());return route.fulfill({json:{id:'preview-batch',kind,month:'2026-10',mode:'append',headers:['Employee','Date'],fields:['member_name','starts_on'],replacement_scope:[],rows}});}
    throw new Error('Unexpected mutation '+req.method()+' '+url.pathname);
   }
   if(url.pathname==='/api/v1/admin/members')return route.fulfill({json:[{id:'ready',canonical_name:'Dr Ready',active_status:'active',call_level:'2ND_CALL',designations:[],aliases:[]}]});
   if(url.pathname==='/api/v1/normalization/units')return route.fulfill({json:[]});
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view='+kind);
  await page.locator(`[data-open-normalized-import="${kind}"]`).click();
  const dialog=page.locator('dialog.operational-import');
  await dialog.waitFor();
  assert.equal(await dialog.locator('[data-report]').count(),0,'No report action before a preview exists');
  assert.equal(await page.locator('[data-preview-rejections]').count(),0,'Legacy rejected-row controls are unreachable in the current rendered app');
  assert.equal(downloads.length,0);
  assert.equal(await dialog.locator('input[name="month"]').inputValue(),'2026-10');
  await dialog.locator('input[type="file"]').setInputFiles({name:kind+'.csv',mimeType:'text/csv',buffer:Buffer.from('Employee,Date\nDr Ready,2026-10-03\n')});
  await dialog.locator('[data-map="0"]').waitFor();
  assert.equal(await dialog.locator('[data-report]').count(),0,'Column inspection alone does not create a report artifact');
  await dialog.getByRole('button',{name:'Preview and normalize',exact:true}).click();
  await dialog.locator('[data-report]').waitFor();
  assert.equal(previews.length,1);assert.match(previews[0],/name="month"\r?\n\r?\n2026-10/);
  const reviewBefore=await dialog.locator('[data-review]').innerText();
  const report=dialog.getByRole('button',{name:'Download row report',exact:true});
  await report.focus();
  const firstEvent=page.waitForEvent('download');await page.keyboard.press('Enter');const first=await firstEvent;
  assert.equal(first.suggestedFilename(),kind+'-normalization-report.csv');
  assert.equal(await readFile(await first.path(),'utf8'),expected([]),'Exact BOM CSV including ready and rejected rows, reasons, original/proposed values and formula-neutralized cells');
  assert.equal(await dialog.locator('[data-review]').innerText(),reviewBefore,'Downloading preserves the review');
  assert.equal(await dialog.locator('input[name="month"]').inputValue(),'2026-10');
  await dialog.locator('[data-include="CSV:4"]').uncheck();
  await report.focus();const secondEvent=page.waitForEvent('download');await page.keyboard.press('Space');const second=await secondEvent;
  assert.equal(second.suggestedFilename(),kind+'-normalization-report.csv');
  assert.equal(await readFile(await second.path(),'utf8'),expected(['CSV:4']),'Report preserves excluded rows and their reasons');
  assert.equal(await dialog.locator('[data-include="CSV:4"]').isChecked(),false);
  assert.equal(await dialog.locator('[data-apply]').getAttribute('aria-disabled'),'true','Excluded-row draft keeps apply pending a fresh preview');
  assert.equal(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
  assert.deepEqual(writes,['/api/v1/import-review/columns',`/api/v1/import-review/${kind}/preview`]);
  assert.equal(downloads.length,2);assert.deepEqual(errors,[]);
  results.push({engine,width,kind,toolbar_entry:true,no_report_without_preview:true,keyboard_enter_and_space:true,filename:first.suggestedFilename(),exact_csv_bytes:true,formula_cells_neutralized:true,multiline_and_quote_escaping:true,ready_rejected_and_excluded_rows:true,month_and_review_preserved:true,apply_mutations:0,preview_requests:1,download_count:2,javascript_errors:errors});
  await context.close();
 }}finally{await browser.close();}
}
const finalHashes=await hashes();assert.deepEqual(finalHashes,initialHashes,'Source changed during the run; repeat on a stable snapshot');
await writeFile('../docs/premium-ui/qa-preview-rejections.json',JSON.stringify({scope:'Actual app toolbar → normalized leave/unit import → real file selection → intercepted columns/preview → real CSV downloads. All requests intercepted; only GET forwarded to disposable in-memory fixture. Current row report intentionally contains all preview rows, not rejected rows only. Legacy main.ts data-preview-rejections controls have no render call sites and are absent from actual UI; they are not runtime-certified. Synthetic formula values verify CSV escaping, not spreadsheet execution. Physical devices and screen readers pending.',sourceHashes:finalHashes,results},null,2)+'\n');
console.log(`${results.length} actual-app normalization report workflows passed`);
