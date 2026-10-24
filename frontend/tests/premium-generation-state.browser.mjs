import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const results=[],paths=['src/rota-compute.ts','src/styles.css','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')]))),initial=await hashes();
const states={queued:'Queued',running:'Generating proposal',completed:'Ready for review',applied:'Applied to draft',failed:'Failed',cancelled:'Cancelled',reverted:'Reversed','future_<img src=x>':'Status: future_<img src=x>'};
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),calls=[],errors=[];let state='queued';
  page.on('pageerror',e=>errors.push(e.message));const known=()=>['queued','running','completed','applied'].includes(state);
  const job=()=>({id:'state-fixture',kind:'members',month:'2026-11',status:state,engine:'server',requested_engine:'server',revision:9,processed:state==='queued'?0:3,total:state==='queued'?0:7,proposed:2,unresolved:1,decisions:[],metrics:{planning_ms:1,steps:1},context_hash:'fixture',error:'Returned error <img src=x>',fallback_reason:'Returned fallback <script>fixture</script>',burden:null});
  await page.route('**/__generation_state',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open compute</button></body></html>'}));
  await page.route('**/api/**',r=>{const q=r.request(),u=new URL(q.url());calls.push({method:q.method(),path:u.pathname,body:q.postData()});if(q.method()==='POST'){assert.equal(u.pathname,'/api/v1/rota-compute/jobs');return r.fulfill({json:job()});}assert.equal(q.method(),'GET');if(u.pathname.endsWith('/capabilities'))return r.fulfill({json:{enabled:true,browser_gpu:false,context_hash:'fixture'}});assert.equal(u.pathname,'/api/v1/rota-compute/jobs');return r.fulfill({json:known()?[job()]:[]});});
  await page.goto('http://127.0.0.1:5197/__generation_state');await page.evaluate(()=>{document.querySelector('#open').onclick=async()=>await(await import('/src/rota-compute.ts')).openRotaCompute('2026-11',true,()=>{});});
  for(const [returned,label]of Object.entries(states)){
   state=returned;const before=calls.length;await page.locator('#open').focus();await page.keyboard.press('Enter');const dialog=page.locator('dialog.compute-workspace');
   if(!known()){await dialog.locator('[data-generate]').waitFor();await dialog.locator('[data-generate]').focus();await page.keyboard.press('Enter');}
   await dialog.locator('[data-job-state]').waitFor();assert.equal(await dialog.locator('[data-job-state]').innerText(),label);assert.equal(await dialog.locator('[data-job-error]').innerText(),'Returned error <img src=x>');assert.match(await dialog.innerText(),/Returned fallback <script>fixture<\/script>/);assert.equal(await dialog.locator('img,script').count(),0);
   const progress=dialog.locator('progress');if(returned==='queued'){assert.equal(await progress.count(),1);assert.equal(await progress.getAttribute('value'),null);assert.equal(await progress.getAttribute('max'),null);}else if(returned==='running'){assert.equal(await progress.getAttribute('max'),'7');assert.equal(await progress.getAttribute('value'),'3');}else assert.equal(await progress.count(),0);
   assert.match(await dialog.innerText(),new RegExp(returned==='queued'?'0 of 0 slots checked':'3 of 7 slots checked'));assert.equal(await dialog.locator('[data-apply]').count(),returned==='completed'?1:0);if(returned==='completed')assert.equal(await dialog.locator('[data-apply]').isDisabled(),true);assert.equal(await dialog.locator('[data-revert]').count(),returned==='applied'?1:0);assert.equal(await dialog.locator('[data-cancel]').count(),['queued','running','completed'].includes(returned)?1:0);
   if(returned==='completed')assert.deepEqual((await new AxeBuilder({page}).include('dialog.compute-workspace').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(calls.slice(before).filter(c=>c.method==='POST').length,known()?0:1);await dialog.locator('[data-close]').focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#open').evaluate(n=>n===document.activeElement),true);results.push({engine,width,returned,label,errorsAndFallbackCoexist:true,progressTruthful:true,existingActionGatesPreserved:true,unknownStateEscaped:true,closeRestoresOpener:true,backendWrites:0});
  }
  assert.deepEqual(errors,[]);await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-generation-state.json',JSON.stringify({source_sha256:initial,scope:'Actual exported compute proposal dialog,8returned statesx3enginesx320/1280. Known resumable/review/applied states via recentGET; failed/cancelled/reverted/unknown use defensive mocked create responses, not proof server creates these states. Allcalls intercepted, no worker/GPU/persistence/physical claim.',results},null,2)+'\n');console.log('Generation state cases: '+results.length);
