import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const baseline=process.env.LOADING_SHAPE_BASELINE==='1',results=[];
const paths=['src/ui.ts','src/workspace-load-state.ts','src/styles.css','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async n=>['frontend/'+n,createHash('sha256').update(await readFile(n)).digest('hex')]))),initial=await hashes();
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of baseline?[320,390,1280]:[320,390,769,1024,1280]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];let held,arrive;const waiting=new Promise(r=>arrive=r);
  page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','loading-shapes');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async r=>{const q=r.request(),u=new URL(q.url());assert.equal(q.method(),'GET');if(u.pathname.endsWith('/leave/calendar')){held=r;arrive();return;}return r.fulfill({response:await r.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search})});});
  await page.goto('http://127.0.0.1:5197/#view=leave');await waiting;const skeleton=page.locator('.ds-page-skeleton');await skeleton.waitFor();assert.equal(await skeleton.getAttribute('aria-busy'),'true');assert.equal(await skeleton.locator('button,input,select,textarea,a').count(),0);assert.match(await skeleton.innerText(),/Loading leave/);
  const loading=await skeleton.locator('.metric').evaluateAll(es=>es.map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));assert.equal(loading.length,4);
  assert.equal(await skeleton.locator('.skeleton').first().evaluate(e=>getComputedStyle(e).animationName),'none');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const response=await held.fetch({url:'http://127.0.0.1:8031/api/v1/leave/calendar?month=2026-11'});await held.fulfill({response});await page.locator('.board-metrics').waitFor();assert.equal(await skeleton.count(),0);
  const loaded=await page.locator('.board-metrics .metric').evaluateAll(es=>es.map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
  const meanHeightDifference=loading.reduce((n,item,i)=>n+Math.abs(item.height-loaded[i].height),0)/4;
  if(!baseline){assert.ok(meanHeightDifference<=8,JSON.stringify({width,loading,loaded,meanHeightDifference}));assert.deepEqual(errors,[]);}
  results.push({engine,width,loading,loaded,meanHeightDifference,skeletonNotInteractive:true,loadingTextAndBusy:true,reducedMotion:true,noWrites:true,errors});await page.waitForLoadState('networkidle');await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-loading-shapes'+(baseline?'-before':'')+'.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Actual leave page heldGET with empty November fixture. Skeleton metric dimensions vs loaded four metric tiles, noninteractive placeholder,busy/loading/reducedmotion. Three engines/three widths after change. This is component geometry, not wholepage CLS or all loading shapes certification.',results},null,2)+'\n');console.log(`Loading shapes: ${results.length} contexts`);
