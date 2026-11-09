import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const candidate='src/main.ts',candidateHash=sha(await readFile(candidate));
const api='http://127.0.0.1:8031',base='http://127.0.0.1:5197';
assert.equal(sha(await readFile('src/main.ts')),'976b51d938cb890366cc1e78934faf6acc2c87a31c3fc6358e06fa323c5d3427','Applied V6 source required; do not run against an overlay or prior application.');
const paths=['rota-template/allocation-statistics','rota-safety/month','rota-candidates/month','rota-auto-fill/month'];
const values=await Promise.all(paths.map(async p=>(await fetch(api+'/api/v1/'+p+'?month=2026-11')).json()));
const template=await(await fetch(api+'/api/v1/rota-template/month?month=2026-11')).json();template.scope.is_locked=true;template.rota_period.status='draft';
const sources=['src/rota-compute.ts','src/member-workspace.ts','src/styles.css','src/premium-theme.css','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes(),results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280])for(const destination of ['figures-summary','figures-checkbox','overview-mode','next-step']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[],counts=Array(4).fill(0);let primary=0,release,arrived;const held=new Promise(resolve=>arrived=resolve);
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','optional164-independent');localStorage.setItem('duty_rota_working_month','2026-11');localStorage.setItem('duty_rota_template_overview_mode','statistics');localStorage.removeItem('duty_rota_template_fast_mode');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push(q.method()+' '+u.pathname);return route.abort();}
   if(u.pathname==='/api/v1/rota-template/month'){primary++;return route.fulfill({json:destination==='next-step'?{...template,scope:{...template.scope,is_locked:false}}:template});}
   const index=paths.findIndex(p=>u.pathname==='/api/v1/'+p);
   if(index>=0){const attempt=++counts[index];if(attempt===1)return route.fulfill({status:503,json:{detail:'Independent optional unavailable'}});if(index===0){arrived();await new Promise(resolve=>release=resolve);}return route.fulfill({json:{...values[index],month:u.searchParams.get("month")||"2026-11"}});}
   return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search,maxRetries:2})});
  });
  try{await page.goto(base+'/#view=rota-template',{waitUntil:'domcontentloaded',timeout:30000});const status=page.locator('[data-template-optional-status]');await status.locator('[data-retry-template-reports]').waitFor();
   await status.locator('[data-retry-template-reports]').focus();await page.keyboard.press('Enter');await held;
   const selector=destination==='figures-summary'?'.template-figures > summary':destination==='figures-checkbox'?'#rota-template-fast-mode':destination==='next-step'?'[data-template-optional-next] button':'[data-template-optional-overview] [data-rota-overview-mode]';
   if(destination==='figures-checkbox')await page.locator('.template-figures').evaluate(e=>e.open=true);
   const control=page.locator(selector).first();await control.waitFor();await control.focus();assert.equal(await control.evaluate(e=>e===document.activeElement),true);
   const prior=await control.evaluate(e=>{window.__optionalPrior=e;return{tag:e.tagName,text:e.textContent,id:e.id};});release();await status.getByText('Optional reports are up to date.',{exact:true}).waitFor();
   const after=await page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,text:document.activeElement?.textContent?.slice(0,100)}));
   const preserved=await page.locator(selector).first().evaluate(e=>e===document.activeElement);
   assert.equal(preserved,true,engine+' '+width+' '+destination+' equivalent semantic focus');
   if(destination.startsWith('figures'))assert.equal(await control.evaluate(e=>e===window.__optionalPrior),true,'Figures control identity retained');
   assert.equal(primary,1);assert.deepEqual(counts,[2,2,2,2]);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
   results.push({engine,width,destination,prior,after,preserved,primary,counts,errors,writes});console.log(engine+' '+width+' '+destination+' focus preserved='+preserved+' active='+after.tag);
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile(candidate)),candidateHash);assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-optional164-v6-focus-integrated-sequenced-r1.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root',test_sha256:sha(await readFile(new URL(import.meta.url))),candidate_sha256:candidateHash,source_sha256:initial,scope:'Root applied V6 assertion of intentional newer focus in optional figures summary or overview mode while failed-report retry is held. Actual applied V6 main.ts; no candidate overlay. No backend edits. All GET localmock/fixture,zeroPOST; asserts equivalent focus and figures identity after actual held GET recovery.',results},null,2)+'\n');console.log('Optional164 independent focus diagnostics:'+results.length);
