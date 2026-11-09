import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),base='http://127.0.0.1:5197',api='http://127.0.0.1:8031';
assert.equal(sha(await readFile('src/main.ts')),'976b51d938cb890366cc1e78934faf6acc2c87a31c3fc6358e06fa323c5d3427','Applied V6 source required; do not run against an overlay or prior application.');
const paths=['rota-template/allocation-statistics','rota-safety/month','rota-candidates/month','rota-auto-fill/month'];
const names=['Allocation statistics','Safety checks','Member suggestions','Auto-fill history'];
const values=await Promise.all(paths.map(async p=>(await fetch(api+'/api/v1/'+p+'?month=2026-11')).json()));
const template=await(await fetch(api+'/api/v1/rota-template/month?month=2026-11')).json();template.scope.is_locked=true;template.rota_period.status='draft';
values[1].summary.hard_blocked_slots=3;values[1].summary.total_slots=7;
const candidate='src/main.ts',candidateHash=sha(await readFile(candidate));
const sources=['src/rota-compute.ts','src/member-workspace.ts','src/styles.css','src/premium-theme.css','src/services/api.ts'];
const visibilityDiagnostics=[];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes(),results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280])for(const target of [0,1,2,3]){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[],counts=[0,0,0,0];let primary=0;
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','malformed164');localStorage.setItem('duty_rota_working_month','2026-11');localStorage.setItem('duty_rota_template_overview_mode','statistics');localStorage.removeItem('duty_rota_template_fast_mode');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push(q.method()+' '+u.pathname);return route.abort();}
   if(u.pathname==='/api/v1/rota-template/month'){primary++;return route.fulfill({json:template});}
   const index=paths.findIndex(p=>u.pathname==='/api/v1/'+p);
   if(index>=0){const attempt=++counts[index];if(index===target){
     if(attempt===1)return route.fulfill({json:null});
     if(attempt===2)return route.fulfill({json:index===3?{month:'2026-11',latest_run:{events:[]}}:{month:'2026-11',summary:null}});
     if(attempt===3)return route.fulfill({json:{...values[index],month:'2026-12'}});
    }return route.fulfill({json:values[index]});}
   return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto(base+'/#view=rota-template');const status=page.locator('[data-template-optional-status]');
   const failed=()=>status.getByText(names[target]+' could not load. Generation actions remain available.',{exact:true});
   await failed().waitFor();assert.equal(await page.locator('#generate-rota-template').isEnabled(),true);
   await page.locator('.template-settings-panel > summary').click();await page.locator('#template-start').fill('2026-11-04');await page.locator('#template-fairness-policy').selectOption('equal_people');await page.locator('#template-weekdays').uncheck();
   await page.locator('#rota-template-form').evaluate(form=>{window.__malformedForm=form;window.__malformedStart=form.querySelector('#template-start');});
   const assertPrimary=async()=>{assert.equal(primary,1);assert.equal(await page.locator('#generate-rota-template').isEnabled(),true);assert.equal(await page.locator('#rota-template-form').evaluate(e=>e===window.__malformedForm&&e.querySelector('#template-start')===window.__malformedStart),true);assert.equal(await page.locator('#template-start').inputValue(),'2026-11-04');assert.equal(await page.locator('#template-fairness-policy').inputValue(),'equal_people');assert.equal(await page.locator('#template-weekdays').isChecked(),false);};
   const assertUnavailable=async()=>{if(target===1)assert.equal(await page.locator('[data-template-optional-blocked] > span').innerText(),'Not reported');if(target===2)assert.equal(await page.locator('.template-figures .metric').filter({hasText:'Suggestion slots'}).locator(':scope > span').innerText(),'Not reported');};
   if(target===2){
    const metric=page.locator('.template-figures .metric').filter({hasText:'Suggestion slots'}).locator(':scope > span');
    const diagnostic=await metric.evaluate(e=>({textContent:e.textContent,innerText:e.innerText,detailsOpen:e.closest('details').open,html:e.outerHTML}));
    assert.equal(diagnostic.textContent,'Not reported');assert.equal(diagnostic.detailsOpen,false);
    visibilityDiagnostics.push({engine,width,...diagnostic});
    await page.locator('.template-figures > summary').click();
    assert.equal(await metric.isVisible(),true);
   }
   await assertUnavailable();
   for(const attempt of [2,3]){await status.locator('[data-retry-template-reports]').click();await failed().waitFor();assert.equal(counts[target],attempt);for(let i=0;i<4;i++)if(i!==target)assert.equal(counts[i],1);await assertPrimary();await assertUnavailable();}
   await status.locator('[data-retry-template-reports]').click();await status.getByText('Optional reports are up to date.',{exact:true}).waitFor();assert.equal(counts[target],4);for(let i=0;i<4;i++)if(i!==target)assert.equal(counts[i],1);
   await assertPrimary();if(target===1)assert.equal(await page.locator('[data-template-optional-blocked] > span').innerText(),'3');
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   results.push({engine,width,target:names[target],invalidInitialNullRejected:true,invalidSummaryOrRunRejected:true,wrongMonthRejected:true,failedSubsetOnlyRetried:true,validRecovery:true,primaryDomAndValuesRetained:true,primary,counts,errors,writes});console.log(engine+' '+width+' '+names[target]+' malformed200/retry/recovery passed');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile(candidate)),candidateHash);assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-optional164-v6-malformed-integrated.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root',candidate_sha256:candidateHash,test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,visibilityDiagnostics,scope:'Root applied V6 24 contexts (closed figure disclosure opened before asserting rendered metric text):each of4reports in3engines320/1280. Initial200null,retry200wrongsummary/run,wrongmonth remain unavailable; finalvalidread recovers onlyfailedreport. EssentialBuild,primaryformDOM/dates/options preserved,explicitNotreported safety/candidate metrics,zeroPOST. This is minimal consumedcontract/renderpreflight resilience,not exhaustive API/schema/backendvalidation.',results},null,2)+'\n');console.log('Optional164 V6 applied malformed:24 contexts passed');
