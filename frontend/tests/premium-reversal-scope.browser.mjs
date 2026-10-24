import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const paths=['rota-compute.ts','rota-intelligence.ts','generation-reversal-scope.ts','styles.css','premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async n=>['frontend/src/'+n,createHash('sha256').update(await readFile('src/'+n)).digest('hex')]))),initial=await hashes(),results=[];
await mkdir('../docs/premium-ui/screenshots/reversal',{recursive:true});
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const kind of ['members','template','intelligent']){
  const context=await browser.newContext({viewport:{width,height:700},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],posts=[];let checks=0,reverts=0;
  const id='generation-'+kind+'-'+'x'.repeat(70),revision=8;
  let job={id,month:'2026-11',status:'applied',kind,engine:'server',requested_engine:'server',revision,processed:1,total:1,proposed:1,unresolved:0,decisions:[],context_hash:'scope-fixture',metrics:{planning_ms:1,steps:1},burden:null,result:{assigned:1,created_slots:1,replaced:0},...(kind==='intelligent'?{intelligence:{selected:0,alternatives:[{status:'feasible',uncovered:0,changed:0,elapsed_ms:1,warnings:[],objectives:[],history_window:{start:'2026-01',end:'2026-10',observed_months:[]}}]}}:{})};
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__reversal_scope',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open generation review</button></body></html>'}));
  await page.route('**/api/**',async r=>{const q=r.request(),p=new URL(q.url()).pathname;
   if(q.method()==='GET'){
    if(p.endsWith('/capabilities'))return r.fulfill({json:{enabled:true,browser_gpu:false,context_hash:'scope-fixture',template_compute:true,template_gpu:false}});
    if(p.endsWith('/setup'))return r.fulfill({json:{slots:[],people:[],history_lookback:6,history_months:[],rules:{},holiday_dates:[]}});
    if(p.endsWith('/jobs'))return r.fulfill({json:[job]});
    assert.equal(p,'/api/v1/rota-compute/jobs/'+id);return r.fulfill({json:job});
   }
   assert.equal(q.method(),'POST');const body=q.postDataJSON();assert.deepEqual(body,{revision});posts.push({path:p,body});
   if(p.endsWith('/reversal-check')){assert.equal(p,'/api/v1/rota-compute/jobs/'+id+'/reversal-check');checks++;return checks===1?r.fulfill({status:409,json:{detail:'Draft changed after apply; reversal is unavailable'}}):r.fulfill({json:{allowed:true}});}
   assert.equal(p,'/api/v1/rota-compute/jobs/'+id+'/revert');reverts++;if(reverts===1)return r.fulfill({status:503,json:{detail:'Reversal could not be confirmed'}});job={...job,status:'reverted',revision:9};return r.fulfill({json:job});
  });
  await page.goto('http://127.0.0.1:5197/__reversal_scope');await page.evaluate(kind=>{document.querySelector('#open').onclick=()=>kind==='intelligent'?import('/src/rota-intelligence.ts').then(m=>m.openIntelligentRota('2026-11',true,()=>{window.applied=(window.applied||0)+1;})):import('/src/rota-compute.ts').then(m=>m.openRotaCompute('2026-11',true,()=>{window.applied=(window.applied||0)+1;},kind==='template'?{duty_keys:['MAIN_1ST_24HR']}:undefined));},kind);
  await page.locator('#open').focus();await page.keyboard.press('Enter');const dialog=page.locator('dialog');if(kind==='intelligent'){await dialog.locator('[data-tab=review]').waitFor();await dialog.locator('[data-tab=review]').click();}
  const details=dialog.locator('[data-reversal-review]');await details.waitFor();await details.locator('summary').focus();await page.keyboard.press('Enter');
  const scope=details.locator('.generation-reversal-scope');assert.equal(await scope.locator('code').textContent(),id);assert.match(await scope.innerText(),/2026-11/);assert.match(await scope.innerText(),/Job revision\s+8/);
  assert.equal(await details.evaluate(e=>Boolean(e.closest('.mw-footer'))),false,'Reversal review scrolls in content instead of growing sticky footer');
  const confirm=details.locator('[data-reversal-confirm]'),reverse=details.locator('[data-revert]');assert.equal(await reverse.isDisabled(),true);
  await confirm.scrollIntoViewIfNeeded();const box=await confirm.boundingBox(),footer=await dialog.locator('.mw-footer').boundingBox();assert.ok(box.y+box.height<=footer.y+1,'Confirmation remains above sticky footer');
  assert.equal(await scope.locator('dd').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth+1)),true,'Long job identity wraps');
  if(engine==='chromium'&&kind==='members')await page.screenshot({path:`../docs/premium-ui/screenshots/reversal/scope-${width}.png`});
  for(const message of ['Draft changed after apply; reversal is unavailable','Reversal could not be confirmed']){
   await confirm.check();await reverse.focus();await page.keyboard.press('Enter');await dialog.getByText(message,{exact:true}).waitFor();
   assert.equal(await details.evaluate(e=>e.open),true);assert.equal(await confirm.isChecked(),false);assert.equal(await reverse.isDisabled(),true);assert.equal(await confirm.evaluate(e=>e===document.activeElement),true,'Failed reversal returns to fresh confirmation');
   assert.equal(await scope.locator('code').textContent(),id);assert.equal(await page.evaluate(()=>window.applied||0),0);
  }
  assert.equal(checks,2);assert.equal(reverts,1,'Failed validation never calls revert; revert refusal never auto-replays');
  const axe=await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
  await confirm.check();await reverse.focus();await page.keyboard.press('Enter');await details.waitFor({state:'detached'});assert.equal(checks,3);assert.equal(reverts,2);assert.equal(await page.evaluate(()=>window.applied||0),1);assert.equal(posts.length,5);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  await dialog.locator('[data-close]').click();await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#open').evaluate(e=>e===document.activeElement),true);
  results.push({engine,width,kind,exactGenerationMonthRevision:true,reversalInScrollableContent:true,validationConflictBlocksRevert:true,unconfirmedRevertDoesNotReplay:true,freshAcknowledgementAndFocus:true,exactPostCount:5,successfulCallbackCount:1,scopedAxeViolations:0,openerFocus:true,allPostsIntercepted:true,errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-reversal-scope.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Three generation reviews with applied long-ID fixture.409 validation refusal,503 reversal refusal then explicit successful retry; exact existing endpoints/revision bodies and fresh acknowledgement. Three engines320/1280, intercepted API only; no actual reversals/backend writes.',results},null,2)+'\n');console.log(`Reversal scope: ${results.length} workflows`);
