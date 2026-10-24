import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const baseline=process.env.FORCED_BASELINE==='1',results=[];
const hash=async()=>createHash('sha256').update(await readFile('src/rota-compute.ts')).digest('hex'),before=await hash();
await mkdir('../docs/premium-ui/screenshots/generation',{recursive:true});
const decisions=[{slot_id:'forced-slot',date:'2026-11-03',duty:'24 hour <img src=x>',unit:'Long University Department <img src=x> '+ 'Intensive '.repeat(8),action:'allocate',person_id:null,person_name:null,reason:'Server supplied forced reason <script>bad()</script> '+ 'Retained explanatory text. '.repeat(10),score:null,forced:true},{slot_id:'ordinary-slot',date:'2026-11-01',duty:'Night',unit:'Unit B',action:'allocate',person_id:null,person_name:null,reason:'Ordinary returned reason',score:17,forced:false},{slot_id:'legacy-slot',date:'2026-11-02',duty:'Day',unit:'Unit C',action:'allocate',person_id:null,person_name:null,reason:'Flag absent; no inferred outcome',score:8}];
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of baseline?[320]:[320,1280])for(const theme of baseline?['light']:['light','dark']){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,reducedMotion:'reduce'}),page=await context.newPage(),requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','forced-fixture');localStorage.setItem('duty_rota_working_month','2026-11');});
  let kind='template';const job=()=>({id:'forced-fixture-job',kind,month:'2026-11',status:'completed',engine:'server',requested_engine:'server',revision:27,processed:3,total:3,proposed:3,unresolved:1,decisions,metrics:{planning_ms:120,steps:3},context_hash:'fixture-context',burden:null});
  await page.route('**/api/**',async r=>{const q=r.request(),u=new URL(q.url());requests.push({method:q.method(),path:u.pathname,body:q.postData()});
   if(q.method()==='POST'){assert.equal(u.pathname,'/api/v1/rota-compute/jobs/forced-fixture-job/apply');assert.deepEqual(q.postDataJSON(),{revision:27});return r.fulfill({json:{...job(),status:'applied',revision:28,result:{assigned:0,created_slots:3}}});}
   assert.equal(q.method(),'GET');if(u.pathname.endsWith('/auth/me'))return r.fulfill({json:{id:'fixture-admin',username:'forced',display_name:'Fixture admin',role:'computer_admin',active_status:'active'}});
   if(u.pathname==='/api/v1/rota-compute/capabilities')return r.fulfill({json:{enabled:true,browser_gpu:false,template_compute:true,template_gpu:false,context_hash:'fixture-context'}});
   if(u.pathname==='/api/v1/rota-compute/jobs')return r.fulfill({json:[job()]});
   return r.fulfill({response:await r.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search})});
  });
  await page.goto('http://127.0.0.1:5197/#view=user-guide');await page.locator('#guide-checklist').waitFor();
  await page.evaluate(()=>import('/src/rota-compute.ts').then(m=>m.openRotaCompute('2026-11',true,()=>{window.forcedApplied=(window.forcedApplied||0)+1;},{include_weekdays:true,include_weekends:true})));
  let dialog=page.getByRole('dialog',{name:'Preview template allocation',exact:true});await dialog.locator('tbody tr').first().waitFor();
  const markers=await dialog.locator('[data-forced-allocation]').count();
  if(baseline){results.push({engine,width,theme,returnedForcedTrue:true,visibleExplicitMarkers:markers,introClaimsMarked:await dialog.getByText(/Forced allocations remain marked/).count()});await context.close();continue;}
  assert.equal(markers,1);assert.equal(await dialog.locator('[data-forced-allocation]').innerText(),'Forced allocation · Review required');
  const rows=dialog.locator('tbody tr');assert.equal(await rows.count(),3);
  for(let i=0;i<decisions.length;i++){const row=rows.nth(i),d=decisions[i];assert.match(await row.locator('td').nth(0).innerText(),new RegExp(d.date));assert.equal((await row.locator('[data-label="Proposal"]').innerText()).replace('Forced allocation · Review required','').trim(),d.unit.trim());assert.equal(await row.locator('[data-label="Reason"]').innerText(),d.reason.trim());assert.equal(await row.locator('[data-forced-allocation]').count(),i===0?1:0);}
  assert.equal(await dialog.locator('img,script').count(),0);assert.match(await dialog.innerText(),/3 of 3 slots checked · 3 proposed · 1 need review/);
  const scroll=dialog.locator('.table-scroll');await scroll.focus();assert.equal(await scroll.evaluate(el=>el===document.activeElement),true);await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const axe=await new AxeBuilder({page}).include('dialog.compute-workspace').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(axe.violations,[]);
  if(engine==='chromium'){await rows.first().scrollIntoViewIfNeeded();await page.screenshot({path:`../docs/premium-ui/screenshots/generation/forced-${width}-${theme}.png`});}
  assert.equal(await dialog.locator('[data-apply]').isDisabled(),true);assert.equal(requests.filter(q=>q.method==='POST').length,0);
  await dialog.locator('[data-review-confirm]').focus();await page.keyboard.press('Space');assert.equal(await dialog.locator('[data-apply]').isEnabled(),true);await dialog.locator('[data-apply]').focus();await page.keyboard.press('Enter');await dialog.getByText('3 template duties applied. Next: Autoassign members.',{exact:true}).waitFor();assert.equal(requests.filter(q=>q.method==='POST').length,1);assert.equal(await page.evaluate(()=>window.forcedApplied),1);
  await dialog.locator('[data-close]').focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'detached'});
  kind='members';await page.evaluate(()=>import('/src/rota-compute.ts').then(m=>m.openRotaCompute('2026-11',true,()=>{})));dialog=page.getByRole('dialog',{name:'Autoassign members - quick safe fill',exact:true});await dialog.locator('tbody tr').first().waitFor();assert.equal(await dialog.locator('[data-forced-allocation]').count(),0);assert.equal(await dialog.locator('tbody tr').count(),3);await dialog.locator('[data-close]').click();await dialog.waitFor({state:'detached'});
  assert.deepEqual(errors,[]);results.push({engine,width,theme,forcedTrueOnly:true,absentFlagNotInferred:true,memberRendererUnchanged:true,datesUnitsReasonsOrderAndCountsRetained:true,htmlEscaped:true,keyboardTableAndReviewApply:true,exactInterceptedApplyRevision:27,applyRequests:1,callbacks:1,pageOverflow:false,taggedAxeViolations:0,errors});await context.close();
 }}finally{await browser.close();}
}
assert.equal(await hash(),before);await writeFile('../docs/premium-ui/qa-template-forced'+(baseline?'-before':'-current')+'.json',JSON.stringify({source_sha256:{'frontend/src/rota-compute.ts':before},scope:'Actual-app proposal DOM; mocked completed jobs/capabilities and intercepted apply only. All remaining GETs disposable8031. Forced marker derives only template decision forced===true. No real mutation/GPU/backend correctness claim.',results},null,2)+'\n');console.log('Forced allocation workflows: '+results.length);
