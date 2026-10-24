import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Presentation and ReviewedTool callback boundary only. No real admin API/persistence.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const paths=['src/generation-comparison.ts','src/analysis-charts.ts','src/admin-preview.ts','src/styles.css','src/premium-theme.css','src/member-workspace.ts','src/ui.ts'];
const digest=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,await digest(p)])));
const initial=await hashes(),testHash=await digest('tests/premium-comparison-regions.browser.mjs');
const hostile='Member <img src=x onerror="window.__injected=true"> & "Royal"';
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const [width,theme]of [[320,'dark'],[700,'light'],[701,'dark'],[1280,'light']]){
  const context=await browser.newContext({viewport:{width,height:1000},colorScheme:theme,reducedMotion:'reduce'});
  try{
   const page=await context.newPage(),errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/**',async route=>{network.push({method:route.request().method(),url:route.request().url()});await route.abort();});
   await page.route('**/__comparison-regions',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en" data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main style="max-width:100%;min-width:0;padding:12px"><button id="start">Start keyboard walkthrough</button><div class="compute-workspace"><section id="workload"></section><section id="alternatives"></section></div><section id="analysis"></section><button id="open-admin">Review member changes</button></main></body></html>`}));
   await page.goto(base+'/__comparison-regions');
   await page.evaluate(async({hostile})=>{
    const generation=await import('/src/generation-comparison.ts'),analysis=await import('/src/analysis-charts.ts'),admin=await import('/src/admin-preview.ts');
    document.querySelector('#workload').innerHTML=generation.workloadComparison('Workload <review> & safety',{members:0,before:{total:{min:0,max:9,mean:2.5},hours24:{min:0,max:0,mean:0}},after:{total:{min:1,max:8,mean:3},hours24:{min:0,max:2,mean:1}}});
    document.querySelector('#alternatives').innerHTML=generation.alternativeComparison([{uncovered:0,changed:12,status:hostile},{uncovered:3,changed:0,status:'Reported server status'}],0);
    document.querySelector('#analysis').innerHTML=analysis.renderAnalysisBars([{label:'Zero',title:hostile,total:0,weekend:0},{label:'Missing',total:NaN},{label:'Returned negative',total:-3,weekend:1}],'Monthly <analysis> & totals');
    window.__runs=[];window.__applied=[];window.__openAdmin=()=>admin.reviewAndApply({title:'Review member changes',intro:'Inspect the reported proposal.',confirmLabel:'Apply reviewed changes',run:async token=>{window.__runs.push(token??null);return {preview_token:'exact-local-preview-token',applied:!!token};},sections:()=>[{title:'Proposed <members> & changes',tone:'warning',note:'Nothing changes before confirmation.',rows:[{current_name:hostile,cleaned_name:'Cleaned & exact',reason:'Reported <reason> & detail'},{current_name:'Second member',action:'create',reason:'Zero substitutions'}]}],changeCount:()=>2,onApplied:result=>window.__applied.push(result)});
    document.querySelector('#open-admin').addEventListener('click',()=>void window.__openAdmin());
   },{hostile});
   const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Document stays within viewport');
   const tabTo=async locator=>{for(let i=0;i<35;i++){if(await locator.evaluate(n=>n===document.activeElement))return;await page.keyboard.press('Tab');}assert.fail('Named comparison region must be reachable with native Tab');};
   const inspectRegion=async(name,caption,columns,rows,requireGrid=true)=>{
    const region=page.getByRole('region',{name,exact:true});assert.equal(await region.count(),1);assert.equal(await region.getAttribute('tabindex'),'0');
    const table=region.locator('table');assert.equal(await table.count(),1);assert.equal(await table.locator('caption').innerText(),caption);assert.equal(await table.locator('thead th[scope="col"]').count(),columns);assert.equal(await table.locator('tbody tr').count(),rows);assert.equal(await table.locator('tbody th[scope="row"]').count(),rows);
    if(requireGrid)assert.deepEqual(await table.evaluate(n=>[getComputedStyle(n).display,getComputedStyle(n.tBodies[0]).display,getComputedStyle(n.tBodies[0].rows[0]).display]),['table','table-row-group','table-row'],'Mobile comparison retains aligned table columns');
    await tabTo(region);assert.equal(await region.evaluate(n=>n===document.activeElement),true);
    const before=await region.evaluate(n=>({left:n.scrollLeft,overflow:n.scrollWidth>n.clientWidth+1}));
    if(width===320 && (name==='Current and proposed workload comparison'||name==='Whole-month alternatives comparison'))assert.equal(before.overflow,true,'Both mobile generation grids must demonstrate real local overflow');
    if(before.overflow){await page.keyboard.press('ArrowRight');await page.waitForTimeout(250);assert.ok(await region.evaluate(n=>n.scrollLeft)>before.left,'ArrowRight moves the focused overflowing comparison region');}
    await noOverflow();return {name,keyboard_tab_reachable:true,overflow:before.overflow,arrow_scroll_verified:before.overflow};
   };
   await page.locator('#start').click();await page.keyboard.press('Tab');assert.equal(await page.locator('#workload summary').evaluate(n=>n===document.activeElement),true);assert.equal(await page.locator('#workload details').getAttribute('open'),null);await page.keyboard.press('Enter');await page.locator('#workload details[open]').waitFor();
   assert.equal(await page.locator('#workload summary').innerText(),'Workload <review> & safety');assert.match(await page.locator('#workload').innerText(),/0 active posted members/);
   const regions=[];
   regions.push(await inspectRegion('Current and proposed workload comparison','Reported monthly duties per member',5,3));
   assert.deepEqual(await page.locator('#workload tbody tr').allTextContents(),['All duties0 to 91 to 82.53','24-hour duties0 to 00 to 201','Weekend 24-hour dutiesNot reported to Not reportedNot reported to Not reportedNot reportedNot reported']);
   regions.push(await inspectRegion('Whole-month alternatives comparison','Whole-month alternatives reported by the server',4,2));
   assert.deepEqual(await page.locator('#alternatives tbody tr:first-child td').allTextContents(),['0','12',hostile]);assert.equal(await page.locator('#alternatives [aria-current="true"]').count(),1);
   const chartSummary=page.locator('#analysis details summary');await tabTo(chartSummary);await page.keyboard.press('Enter');await page.locator('#analysis details[open]').waitFor();
   regions.push(await inspectRegion('Monthly <analysis> & totals data','Monthly <analysis> & totals',4,3));
   assert.deepEqual(await page.locator('#analysis tbody tr').allTextContents(),[hostile+'000','MissingUnavailableUnavailableUnavailable','Returned negative-31-4']);
   assert.equal(await page.locator('#analysis .bar-col').count(),3);assert.equal(await page.locator('#analysis .bar-col[aria-hidden="true"]').count(),3);assert.equal(await page.locator('#analysis .chart-data-note').count(),1);
   assert.equal(await page.locator('.comparison-scroll-cue').count(),3);assert.equal(await page.locator('#workload table').count(),1);assert.equal(await page.locator('#alternatives table').count(),1);assert.equal(await page.locator('#analysis table').count(),1);
   await page.locator('#open-admin').click();const dialog=page.getByRole('dialog',{name:'Review member changes',exact:true});await dialog.locator('[data-confirm]:not([disabled])').waitFor();
   regions.push(await inspectRegion('Proposed <members> & changes: proposed member changes','Proposed <members> & changes: proposed member changes',3,2));
   assert.deepEqual(await dialog.locator('tbody tr:first-child').locator('th,td').allTextContents(),[hostile,hostile+' → Cleaned & exact','Reported <reason> & detail']);
   assert.equal(await dialog.locator('.comparison-scroll-cue').count(),1);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});assert.deepEqual(await page.evaluate(()=>({runs:window.__runs,applied:window.__applied})),{runs:[null],applied:[]},'Cancel never applies preview');
   await page.locator('#open-admin').click();await dialog.locator('[data-confirm]:not([disabled])').waitFor();await dialog.locator('[data-confirm]').click();await dialog.waitFor({state:'detached'});assert.deepEqual(await page.evaluate(()=>({runs:window.__runs,applied:window.__applied})),{runs:[null,null,'exact-local-preview-token'],applied:[{preview_token:'exact-local-preview-token',applied:true}]},'Confirmation passes exactly the preview token to the existing ReviewedTool callback');
   assert.equal(await page.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.__injected===undefined),true);assert.deepEqual(network,[],'No admin API is called by this callback-boundary fixture');assert.deepEqual(errors,[]);await noOverflow();
   results.push({engine,width,theme,regions,exact_reported_values_zero_missing_and_escaped_labels:true,single_semantic_table_per_surface:true,native_disclosure_keyboard:true,admin_cancel_no_apply:true,admin_confirm_exact_callback_token:true,document_overflow:false,api_requests:0});
  }finally{await context.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Declared sources changed during execution');assert.equal(await digest('tests/premium-comparison-regions.browser.mjs'),testHash,'Test changed during execution');
await writeFile('../docs/premium-ui/qa-comparison-regions.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,test_sha256:testHash,scope:'Actual exported comparison/chart renderers and admin reviewAndApply. Three engines at320 dark/700 light/701 dark/1280 light, twelve contexts, four surfaces each. Native Tab/ArrowRight/disclosure; exact values and escaped labels, responsive comparison grid, no document overflow. Admin callback fixture proves Cancel and exact preview-token forwarding only; no real API, persistence, production bundle, native AT, physical device or full theme/width cross-product certification.',results},null,2)+'\n');
console.log('Comparison regions: '+results.length+' contexts complete');
