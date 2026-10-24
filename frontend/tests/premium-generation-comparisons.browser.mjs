import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const paths=['rota-compute.ts','rota-intelligence.ts','generation-comparison.ts','styles.css','premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async n=>['frontend/src/'+n,createHash('sha256').update(await readFile('src/'+n)).digest('hex')]))),initial=await hashes(),results=[];
await mkdir('../docs/premium-ui/screenshots/comparisons',{recursive:true});
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const kind of ['members','intelligent'])for(const fixture of ['reported','missing']){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',colorScheme:width===320?'dark':'light'}),page=await context.newPage(),errors=[],posts=[];
  const burden={members:12,before:{total:{min:0,max:1234567,mean:2.5},hours24:{min:0,max:0,mean:0},weekend24:{min:0,max:1,mean:0.25}},after:{total:{min:1,max:5,mean:3},hours24:{min:0,max:0,mean:0},weekend24:{min:0,max:1,mean:0.5}}};
  if(fixture==='missing'){burden.after.total.mean=null;delete burden.before.weekend24.max;}
  const objectives=[{name:'server objective <img src=x>',value:42,proven:false}],alternatives=[{status:'feasible',uncovered:2,changed:1,elapsed_ms:1000,warnings:['Server warning retained'],objectives},{status:'optimal',uncovered:1,changed:3,elapsed_ms:2000,warnings:[],objectives},{status:'unknown <img src=x>',uncovered:3,changed:0,elapsed_ms:3000,warnings:[],objectives:[{name:'Third alternative objective',value:99,proven:true}]}];
  let job={id:'comparison-job',month:'2026-11',status:'completed',engine:'server',requested_engine:'server',revision:7,processed:2,total:2,proposed:1,unresolved:1,kind,context_hash:'fixture',metrics:{planning_ms:1,steps:1},burden,decisions:[{slot_id:'slot-one',date:'2026-11-01',duty:'Main duty',unit:'Unit One',action:'assign',person_id:'person-one',person_name:'Dr Reported Candidate',reason:'Server reason <img src=x>',score:7},{slot_id:'slot-two',date:'2026-11-02',duty:'Main duty',unit:'Unit One',action:'blocked',person_id:null,person_name:null,reason:'Blocked by approved leave',score:null}],...(kind==='intelligent'?{intelligence:{selected:0,alternatives}}:{})};
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__generation_comparison',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open comparison</button></body></html>'}));
  await page.route('**/api/**',async r=>{const q=r.request(),p=new URL(q.url()).pathname;
   if(q.method()==='POST'){assert.equal(p,'/api/v1/rota-intelligence/jobs/comparison-job/select');assert.deepEqual(q.postDataJSON(),{index:2,revision:7});posts.push(q.postDataJSON());job={...job,intelligence:{...job.intelligence,selected:2}};return r.fulfill({json:job});}
   assert.equal(q.method(),'GET');if(p.endsWith('/capabilities'))return r.fulfill({json:{enabled:true,browser_gpu:false,context_hash:'fixture'}});if(p.endsWith('/setup'))return r.fulfill({json:{slots:[],people:[],history_lookback:6,history_months:[],rules:{},holiday_dates:[]}});assert.ok(p.endsWith('/jobs'),p);return r.fulfill({json:[job]});
  });
  await page.goto('http://127.0.0.1:5197/__generation_comparison');await page.evaluate(kind=>{document.querySelector('#open').onclick=()=>kind==='intelligent'?import('/src/rota-intelligence.ts').then(m=>m.openIntelligentRota('2026-11',true,()=>{})):import('/src/rota-compute.ts').then(m=>m.openRotaCompute('2026-11',true,()=>{}));},kind);
  await page.locator('#open').focus();await page.keyboard.press('Enter');const dialog=page.locator('dialog');if(kind==='intelligent'){await dialog.locator('[data-tab=review]').waitFor();await dialog.locator('[data-tab=review]').click();}
  const details=dialog.locator('[data-workload-comparison]');await details.waitFor();await details.locator('summary').focus();await page.keyboard.press('Enter');
  const rows=details.locator('tbody tr');assert.equal(await rows.count(),3);
  assert.deepEqual(await rows.nth(0).locator('th,td').allTextContents(),['All duties','0 to 1234567','1 to 5','2.5',fixture==='missing'?'Not reported':'3']);
  assert.deepEqual(await rows.nth(1).locator('th,td').allTextContents(),['24-hour duties','0 to 0','0 to 0','0','0']);
  assert.deepEqual(await rows.nth(2).locator('th,td').allTextContents(),['Weekend 24-hour duties',fixture==='missing'?'0 to Not reported':'0 to 1','0 to 1','0.25','0.5']);
  assert.deepEqual(await details.locator('thead th').allTextContents(),['Measure','Current range','Proposed range','Current mean','Proposed mean']);
  if(width===320){assert.equal(await rows.first().evaluate(e=>getComputedStyle(e).display),'table-row');assert.equal(await details.locator('thead').evaluate(e=>getComputedStyle(e).display),'table-header-group');assert.equal(await details.locator('.generation-comparison').getAttribute('role'),'region');assert.equal(await details.locator('.comparison-scroll-cue').isVisible(),true);assert.equal(await details.locator('.generation-comparison').evaluate(e=>e.scrollWidth>e.clientWidth),true,'Genuine comparison grid scrolls inside its panel');}
  if(kind==='intelligent'){
   const table=dialog.locator('[aria-label="Whole-month alternatives comparison"]');assert.equal(await table.locator('tbody tr').count(),3);assert.deepEqual(await table.locator('tbody tr').evaluateAll(es=>es.map(e=>[...e.children].map(c=>c.textContent))),[['1 (selected)','2','1','feasible'],['2','1','3','optimal'],['3','3','0','unknown <img src=x>']]);
   await dialog.locator('[data-alternative]').selectOption('2');await page.waitForFunction(()=>document.querySelector('[aria-label="Whole-month alternatives comparison"] tbody tr:last-child')?.getAttribute('aria-current')==='true');assert.equal(await details.evaluate(e=>e.open),true,'Comparing alternatives keeps workload disclosure open');assert.equal(await dialog.locator('[data-alternative]').inputValue(),'2');assert.equal(posts.length,1);
   const evidence=dialog.locator('details').filter({has:page.getByText('Optimization evidence',{exact:true})});await evidence.locator('summary').click();assert.deepEqual(JSON.parse(await evidence.locator('pre').innerText()),alternatives[2].objectives);
   const why=dialog.locator('details').filter({has:page.getByText('Why this choice?',{exact:true})});await why.locator('summary').click();await why.getByText('Server reason <img src=x>',{exact:true}).waitFor();
  }else{assert.equal(posts.length,0);await dialog.getByText('Server reason <img src=x>',{exact:true}).waitFor();}
  await dialog.getByText('Blocked by approved leave',{exact:true}).waitFor();assert.equal(await dialog.locator('img').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const axe=await new AxeBuilder({page}).include('[data-workload-comparison]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
  if(engine==='chromium'&&kind==='members'&&fixture==='reported'){await details.scrollIntoViewIfNeeded();await page.screenshot({path:`../docs/premium-ui/screenshots/comparisons/workload-${width}.png`});}
  assert.deepEqual(errors,[]);results.push({engine,width,kind,fixture,exactReportedRangesMeansAndZero:true,missingDoesNotBecomeZero:true,serverReasonsAndBlockedEvidenceRetained:true,alternativeOrderAndExactSelection:kind==='intelligent',selectedObjectivesUnchanged:kind==='intelligent',workloadStaysOpen:kind==='intelligent',scopedAxeViolations:0,noApplyGeneratePublishWrites:true,errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-generation-comparisons.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Existing quick/whole-month review with reported/defensive missing burden fixtures, exact ranges/means/zero, three alternatives and unchanged reasons/objectives/selection request. Three engines dark320/light1280; all API intercepted, no operational writes.',results},null,2)+'\n');console.log(`Generation comparisons: ${results.length} workflows`);
