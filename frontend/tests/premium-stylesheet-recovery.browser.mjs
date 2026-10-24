import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const baseline=process.env.STYLE_BASELINE==='1',results=[];
const base=process.env.PREMIUM_PRODUCTION_URL||'http://127.0.0.1:5198';
const hash=async()=>createHash('sha256').update(await readFile('public/frontend-bootstrap.js')).digest('hex'),initial=await hash();
assert.equal(createHash('sha256').update(await readFile('dist/frontend-bootstrap.js')).digest('hex'),initial,'Build must contain current bootstrap source');
const healthy=[];
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{
  if(!baseline){
   const page=await browser.newPage();await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(req.method(),'GET');return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+url.pathname+url.search})});});
   await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.frontendReady==='true');await page.waitForLoadState('networkidle');assert.equal(await page.locator('#frontend-style-recovery').count(),0);healthy.push({engine,noFalseWarning:true});await page.close();
  }
  for(const width of baseline?[320]:[320,1280]){
  const page=await browser.newPage({viewport:{width,height:850}}),requests=[],errors=[];let blocked=0,navigations=0;
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','stylesheet-recovery-fixture'));
  await page.route('**/assets/*.css',route=>{blocked++;return route.request().url().includes('/missing-')?route.abort('failed'):route.fulfill({status:404,contentType:'text/css',body:''});});
  await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());requests.push(req.method());assert.equal(req.method(),'GET');return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+url.pathname+url.search})});});
  await page.goto(base+'/#view=overview');await page.waitForFunction(()=>document.documentElement.dataset.frontendReady==='true');await page.waitForLoadState('networkidle');
  const observed={blockedStylesheets:blocked,recoveryPanels:await page.locator('#frontend-style-recovery').count(),appReady:await page.evaluate(()=>document.documentElement.dataset.frontendReady),navigationCount:navigations};
  if(!baseline){
   assert.ok(blocked>0);assert.equal(observed.recoveryPanels,1);const panel=page.locator('#frontend-style-recovery');await panel.getByText(/Appearance could not load/).waitFor();
   let prompt='';page.once('dialog',async d=>{prompt=d.message();await d.dismiss();});await panel.getByRole('link',{name:'Reload app',exact:true}).click();assert.match(prompt,/unsaved changes/);assert.equal(navigations,1,'Declined reload retains current page');
   await panel.getByRole('button',{name:'Keep working',exact:true}).click();assert.equal(await panel.count(),0);assert.equal(await page.locator('#view-root').count(),1);
   // A genuinely failed late stylesheet must surface the same single panel after readiness.
   await page.evaluate(()=>{const link=document.createElement('link');link.rel='stylesheet';link.href='/assets/missing-late.css';document.head.append(link);});await panel.waitFor();
   await page.evaluate(()=>{for(let i=0;i<2;i++){const link=document.createElement('link');link.rel='stylesheet';link.href='/assets/missing-extra-'+i+'.css';document.head.append(link);}});await page.waitForTimeout(80);assert.equal(await panel.count(),1);assert.equal(navigations,1);assert.deepEqual(errors,[]);
  }
  results.push({engine,width,observed,guardedReload:!baseline,keepWorkingPreservesApp:!baseline,lateFailuresDeduplicated:!baseline,automaticReloads:0,mutations:requests.filter(x=>x!=='GET').length});await page.close();
 }}finally{await browser.close();}
}
assert.equal(await hash(),initial);
await writeFile('../docs/premium-ui/'+(baseline?'qa-stylesheet-recovery-before.json':'qa-stylesheet-recovery.json'),JSON.stringify({source_sha256:{'frontend/public/frontend-bootstrap.js':initial},scope:'Built app with initial404stylesheet and lateabortedstylesheet requests, readiness, native reloadconfirmation decline, Keepworking and deduplication.3engines320/1280 plushealthycontrol. GET-only disposablefixture. Native unstyledapp fallback is not premium-layout certification or allmissingasset coverage.',healthy,results},null,2)+'\n');
console.log(`Stylesheet recovery ${baseline?'baseline':'outcomes'}:${results.length}`);
