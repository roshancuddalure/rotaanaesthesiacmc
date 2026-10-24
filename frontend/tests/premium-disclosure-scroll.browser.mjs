import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const baseline=process.env.SCROLL_BASELINE==='1',results=[];
const paths=['src/main.ts','src/styles.css','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const initial=await hashes();
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of baseline?[320]:[320,1280]){
  console.log('Starting '+engine+'/'+width);const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),requests=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','scroll-fixture');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async r=>{const q=r.request(),u=new URL(q.url());assert.equal(q.method(),'GET');requests.push(u.pathname+u.search);return r.fulfill({response:await r.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search})});});
  await page.goto('http://127.0.0.1:5197/#view=overview');await page.locator('.board-hero').waitFor();
  // Exercise the real application-wide enhancer with controlled native disclosure surfaces.
  // This is not a claim that the unused renderManualReview function is a reachable screen.
  await page.evaluate(()=>{
   const host=document.createElement('section');host.id='scroll-contract';host.className='panel';
   host.innerHTML='<h2>Comparison scroll contract</h2><details id="wide-details"><summary>Show comparison</summary><section id="wide-region" class="table-panel" style="width:100%;max-width:100%;overflow:auto"><h3>Fixture comparison</h3><table style="width:1800px;min-width:1800px"><thead><tr><th>Month</th><th>Count</th></tr></thead><tbody><tr><td>November 2026</td><td>14</td></tr></tbody></table></section></details><details id="small-details"><summary>Small comparison</summary><div id="small-region" class="table-scroll" style="overflow:auto">No overflow</div></details><details id="named-details"><summary>Named comparison</summary><div id="named-region" class="table-scroll" tabindex="-1" aria-label="Original region" style="overflow:auto"><div style="width:1800px">Named content</div></div></details>';
   document.querySelector('#view-root').append(host);
  });
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const reads=requests.length,region=page.locator('#wide-region');
  const initialTabindex=await region.getAttribute('tabindex');
  await page.locator('#wide-details > summary').focus();await page.keyboard.press('Enter');
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  if(baseline){results.push({engine,width,tabindexBeforeNativeOpen:initialTabindex,tabindexAfterNativeOpen:await region.getAttribute('tabindex'),regionOverflows:await region.evaluate(n=>n.scrollWidth>n.clientWidth)});await context.close();continue;}
  await page.waitForFunction(()=>document.querySelector('#wide-region').getAttribute('tabindex')==='0');
  assert.equal(await region.getAttribute('aria-label'),'Fixture comparison (scrollable)');assert.equal(await region.getAttribute('role'),'region');
  await page.keyboard.press('Tab');assert.equal(await region.evaluate(n=>n===document.activeElement),true);
  await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('#wide-region').scrollLeft>0);
  const scrollLeft=await region.evaluate(n=>n.scrollLeft);
  for(const id of ['small','named']){await page.locator('#'+id+'-details > summary').focus();await page.keyboard.press('Enter');}
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await page.locator('#small-region').getAttribute('tabindex'),null);assert.equal(await page.locator('#named-region').getAttribute('tabindex'),'-1');assert.equal(await page.locator('#named-region').getAttribute('aria-label'),'Original region');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(requests.length,reads);assert.deepEqual(errors,[]);
  results.push({engine,width,nativeDisclosureAddsRegion:true,keyboardTabAndHorizontalScroll:true,scrollLeft,authorTabindexAndNamePreserved:true,nonoverflowHasNoExtraTabstop:true,noExtraApiRequests:true,pageErrors:errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-disclosure-scroll'+(baseline?'-before':'')+'.json',JSON.stringify({source_sha256:initial,scope:'Real full-app scroll enhancer with injected native details comparison fixture; not route coverage for unused renderManualReview. GET-only disposable API, no mutations. Three engines at320/1280.',results},null,2)+'\n');
console.log('Disclosure scroll contexts: '+results.length);
