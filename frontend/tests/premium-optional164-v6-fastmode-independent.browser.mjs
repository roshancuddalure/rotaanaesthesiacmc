import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),expected='976b51d938cb890366cc1e78934faf6acc2c87a31c3fc6358e06fa323c5d3427';
assert.equal(sha(await readFile('src/main.ts')),expected);
const api='http://127.0.0.1:8031',base='http://127.0.0.1:5197';
const paths=['rota-template/allocation-statistics','rota-safety/month','rota-candidates/month','rota-auto-fill/month'];
const template=await(await fetch(api+'/api/v1/rota-template/month?month=2026-11')).json();template.scope.is_locked=true;template.rota_period.status='draft';
const stats=await(await fetch(api+'/api/v1/'+paths[0]+'?month=2026-11')).json();
const expectedAutoassign=template.slots.some(slot=>!slot.assignments.some(a=>['assigned','confirmed','draft'].includes(a.status.toLowerCase())));
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280]){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),counts=[0,0,0,0],writes=[],errors=[];let primary=0,release,arrived;const held=new Promise(r=>arrived=r);
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','fast164');localStorage.setItem('duty_rota_working_month','2026-11');localStorage.setItem('duty_rota_template_fast_mode','1');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push(q.method()+' '+u.pathname);return route.abort();}
   if(u.pathname==='/api/v1/rota-template/month'){primary++;return route.fulfill({json:template});}
   const i=paths.findIndex(p=>u.pathname==='/api/v1/'+p);if(i>=0){counts[i]++;assert.equal(i,0,'Fast mode must skip safety/candidates/history reads');if(counts[i]===1)return route.fulfill({status:503,json:{detail:'Fast statistics unavailable'}});arrived();await new Promise(r=>release=r);return route.fulfill({json:stats});}
   return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto(base+'/#view=rota-template',{waitUntil:'domcontentloaded',timeout:30000});const status=page.locator('[data-template-optional-status]');await status.getByText('Allocation statistics could not load. Generation actions remain available.',{exact:true}).waitFor();
   assert.deepEqual(counts,[1,0,0,0]);assert.equal(await page.locator('#generate-rota-template').isEnabled(),true);assert.equal(await page.locator('#run-safe-auto-fill').isEnabled(),expectedAutoassign);
   await page.getByText('Suggestions and auto-fill history are skipped.',{exact:false}).waitFor();
   await page.locator('.template-settings-panel > summary').click();await page.locator('#template-start').fill('2026-11-04');
   await page.locator('#rota-template-form').evaluate(form=>{window.__fastForm=form;window.__fastStart=form.querySelector('#template-start');});
   await status.locator('[data-retry-template-reports]').click();await held;
   assert.equal(await status.locator('[data-retry-template-reports]').isDisabled(),true);assert.equal(await page.locator('#generate-rota-template').isEnabled(),true);assert.equal(await page.locator('#run-safe-auto-fill').isEnabled(),expectedAutoassign);
   await page.locator('#template-start').fill('2026-11-05');release();await status.getByText('Optional reports are up to date.',{exact:true}).waitFor();
   assert.deepEqual(counts,[2,0,0,0]);assert.equal(primary,1);assert.equal(await page.locator('#rota-template-form').evaluate(form=>form===window.__fastForm&&form.querySelector('#template-start')===window.__fastStart),true);assert.equal(await page.locator('#template-start').inputValue(),'2026-11-05');
   assert.equal(await page.locator('#generate-rota-template').isEnabled(),true);assert.equal(await page.locator('#run-safe-auto-fill').isEnabled(),expectedAutoassign);assert.equal(await page.getByText('Suggestions and auto-fill history are skipped.',{exact:false}).isVisible(),true);
   assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   results.push({engine,width,counts,primary,expectedAutoassign,skippedReportNoteVisible:true,primaryNodesAndNewDraftRetained:true,writes,errors});console.log(engine+' '+width+' fast mode stats-only recovery passed');
  }finally{if(release)release();await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile('src/main.ts')),expected);
await writeFile('../docs/premium-ui/qa-optional164-v6-fastmode-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/optional164_v5_metric_diagnostic',source_sha256:{'frontend/src/main.ts':expected},test_sha256:sha(await readFile(new URL(import.meta.url))),scope:'Six actual applied contexts,3engines320/1280. Fast mode reads only allocation statistics; failed read manual retry holds then succeeds, zero safety/candidates/history reads, primary GET once, no writes, primary form/new draft retained and available Build/Autoassign states unchanged. Explicit skip note remains visible; skipped fallback numbers are not certified safety checks.',results},null,2)+'\n');console.log('OptionalV6 fast mode:6 contexts passed');
