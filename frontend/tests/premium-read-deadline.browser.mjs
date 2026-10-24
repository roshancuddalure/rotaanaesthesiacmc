import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const baseline=process.env.READ_DEADLINE_BASELINE==='1',results=[];
const paths=['src/main.ts','src/styles.css','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')]))),initial=await hashes();
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of baseline?[320]:[320,1280]){
  console.log('Starting '+engine+'/'+width);const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),requests=[],errors=[];let mode='held',release,deliver;const deliveredRead=new Promise(r=>deliver=r);
  const held=new Promise(r=>release=r);
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','deadline-fixture');localStorage.setItem('duty_rota_working_month','2026-11');const original=window.setTimeout;window.setTimeout=function(fn,ms,...args){return original.call(window,fn,ms===25000?250:ms,...args);};});
  await page.route('**/api/**',async r=>{const q=r.request(),u=new URL(q.url());assert.equal(q.method(),'GET');requests.push({method:q.method(),path:u.pathname,search:u.search});const wasHeld=u.pathname==='/api/v1/rota-review/month'&&mode==='held';if(wasHeld)await held;else if(u.pathname==='/api/v1/rota-review/month'&&mode==='refused')return r.fulfill({status:503,json:{detail:'Review service unavailable fixture'}});await r.fulfill({response:await r.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search})});if(wasHeld)deliver();});
  await page.goto('http://127.0.0.1:5197/#view=rota-review');await page.getByRole('heading',{name:'Rota review unavailable',exact:true}).waitFor();
  const toast=await page.locator('.toast').allTextContents();
  if(baseline){assert.ok(toast.some(t=>/clear the generated draft duties/i.test(t)));results.push({engine,width,message:toast});release();await deliveredRead;await page.waitForLoadState('networkidle');await context.close();continue;}
  assert.ok(toast.some(t=>/stopped waiting.*server may still be processing/i.test(t)));assert.ok(toast.some(t=>/No saved duties were changed by this read/i.test(t)));assert.ok(toast.every(t=>!/clear.*duties|rolled back|server.*cancelled/i.test(t)));
  await page.evaluate(()=>location.hash='#view=overview');await page.locator('.board-hero').waitFor();mode='ready';release();
  // Wait for the exact held route to deliver before checking stale-render protection.
  await deliveredRead;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(new URL(page.url()).hash,'#view=overview');assert.equal(await page.locator('#section-title').innerText(),'CMC Anaesthesia rota board');
  const retry=page.locator('.overview-step [data-view-shortcut="rota-review"]');await retry.focus();await page.keyboard.press('Enter');await page.locator('.page-toolbar[aria-label="Review actions"]').waitFor();assert.equal(await page.locator('#working-month').inputValue(),'2026-11');
  await page.evaluate(()=>location.hash='#view=overview');await page.locator('.board-hero').waitFor();mode='refused';await page.locator('.overview-step [data-view-shortcut="rota-review"]').focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Rota review unavailable',exact:true}).waitFor();assert.ok((await page.locator('.toast').allTextContents()).some(t=>/Review service unavailable fixture/.test(t)));
  assert.ok(requests.filter(r=>r.path==='/api/v1/rota-review/month').every(r=>r.search==='?month=2026-11'));assert.deepEqual(errors,[]);
  results.push({engine,width,truthfulLocalDeadline:true,noDestructiveGuidance:true,lateReadDoesNotReplaceNewerView:true,explicitExistingNavigationRetry:true,selectedMonthPreserved:true,serverRefusalDistinct:true,zeroMutations:true,errors});await page.waitForLoadState('networkidle');await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-read-deadline'+(baseline?'-before':'')+'.json',JSON.stringify({source_sha256:initial,scope:'Actual Rota Review GET held past its local wait limit; only25000ms timer accelerated to250ms in fixture. Existing Overview navigation retries read. Three engines320/1280, GET-only disposableAPI; no assertion of underlying cancellation or physical checks.',results},null,2)+'\n');console.log('Read deadline workflows: '+results.length);
