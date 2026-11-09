import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),api='http://127.0.0.1:8031';
const baseline=false,base='http://127.0.0.1:5197';
assert.equal(sha(await readFile('src/main.ts')),'976b51d938cb890366cc1e78934faf6acc2c87a31c3fc6358e06fa323c5d3427','Applied V6 source required; do not run against an overlay or prior application.');
const paths=['rota-template/allocation-statistics','rota-safety/month','rota-candidates/month','rota-auto-fill/month'];
const values=await Promise.all(paths.map(async p=>await(await fetch(api+'/api/v1/'+p+'?month=2026-11')).json()));
const template=await(await fetch(api+'/api/v1/rota-template/month?month=2026-11')).json();template.scope.is_locked=true;template.rota_period.status='draft';
values[1].summary.hard_blocked_slots=3;values[1].summary.total_slots=7;
const sources=['src/main.ts','src/rota-compute.ts','src/styles.css','src/premium-theme.css','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes(),results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280])for(const scenario of baseline?['baseline']:['two-round-recovery','navigate','account','month','newer-focus']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[],counts=Array(4).fill(0);let primary=0,release,arrived;
  const held=new Promise(resolve=>arrived=resolve);page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','optional164-fixture');localStorage.setItem('duty_rota_working_month','2026-11');localStorage.setItem('duty_rota_template_overview_mode','statistics');localStorage.removeItem('duty_rota_template_fast_mode');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push(q.method()+' '+u.pathname);return route.abort();}
   if(u.pathname==='/api/v1/rota-template/month'){primary++;return route.fulfill({json:{...template,month:u.searchParams.get('month')||'2026-11'}});}
   const index=paths.findIndex(p=>u.pathname==='/api/v1/'+p);
   if(index>=0){const attempt=++counts[index];if(attempt===1||scenario==='two-round-recovery'&&index===0&&attempt===2)return route.fulfill({status:503,json:{detail:'Injected optional '+index+' unavailable'}});
    if(index===0&&attempt===2&&scenario!=='two-round-recovery'){arrived();await new Promise(resolve=>release=resolve);}
    return route.fulfill({json:{...values[index],month:u.searchParams.get("month")||"2026-11"}});}
   return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search,maxRetries:2})});
  });
  try{await page.goto(base+'/#view=rota-template',{waitUntil:'domcontentloaded',timeout:30000});await page.locator('#generate-rota-template').waitFor();assert.equal(await page.locator('#generate-rota-template').isEnabled(),true);
   if(baseline){assert.equal(await page.locator('[data-retry-template-reports]').count(),0);assert.deepEqual(counts,[1,1,1,1]);results.push({engine,width,baselineNoOptionalRetry:true,essentialBuildEnabled:true,counts,primary,writes,errors});continue;}
   const status=page.locator('[data-template-optional-status]');await status.getByText(/Allocation statistics, Safety checks, Member suggestions, Auto-fill history could not load/).waitFor();
   await page.locator('.template-settings-panel > summary').click();await page.locator('#template-start').fill('2026-11-03');await page.locator('#template-end').fill('2026-11-25');await page.locator('#template-fairness-policy').selectOption('equal_people');await page.locator('#template-weekdays').uncheck();
   const settings=await page.locator('#rota-template-form').evaluate(form=>{window.__optionalForm=form;window.__optionalStart=form.querySelector('#template-start');return new FormData(form).size;});
   await status.locator('[data-retry-template-reports]').focus();await page.keyboard.press('Enter');
   if(scenario==='two-round-recovery'){
    await status.getByText('Allocation statistics could not load. Generation actions remain available.',{exact:true}).waitFor();assert.deepEqual(counts,[2,2,2,2]);assert.equal(await page.locator('[data-template-optional-blocked] > span').innerText(),'3');
    assert.equal(await status.locator('[data-retry-template-reports]').evaluate(e=>document.activeElement===e),true);
    await status.locator('[data-retry-template-reports]').click();await status.getByText('Optional reports are up to date.',{exact:true}).waitFor();assert.deepEqual(counts,[3,2,2,2]);
   }else{
    await held;assert.equal(await status.locator('[data-retry-template-reports]').isDisabled(),true);assert.equal(await page.locator('#generate-rota-template').isEnabled(),true);
    if(scenario==='navigate'){await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();}
    if(scenario==='account'){await page.evaluate(()=>{localStorage.removeItem('duty_rota_auth_token');dispatchEvent(new StorageEvent('storage',{key:'duty_rota_auth_token',oldValue:'optional164-fixture',newValue:null,storageArea:localStorage}));});await page.locator('#login-form').waitFor();}
    if(scenario==='month'){await page.evaluate(()=>{const month=document.querySelector('#working-month');month.value='2026-12';month.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForFunction(()=>document.querySelector('#working-month')?.value==='2026-12');await page.locator('#generate-rota-template').waitFor();}
    if(scenario==='newer-focus'){await page.locator('#template-start').focus();}
    release();await page.waitForTimeout(100);
    if(scenario==='navigate'){assert.equal(await page.locator('#guide-checklist').count(),1);assert.equal(await status.count(),0);}
    if(scenario==='account'){assert.equal(await status.count(),0);assert.equal(await page.locator('#login-form').count(),1);}
    if(scenario==='month'){assert.equal(await page.locator('#working-month').inputValue(),'2026-12');assert.equal(primary,2);assert.equal(await status.evaluate(e=>e.hidden),true);assert.equal(await status.getAttribute('aria-busy'),'false');assert.match(await page.locator('.generation-heading').innerText(),/December 2026/);}
    if(scenario==='newer-focus'){await status.getByText('Optional reports are up to date.',{exact:true}).waitFor();assert.equal(await page.locator('#template-start').evaluate(e=>document.activeElement===e),true);assert.deepEqual(counts,[2,2,2,2]);}
   }
   if(['two-round-recovery','newer-focus'].includes(scenario)){assert.equal(primary,1);assert.equal(await page.locator('#rota-template-form').evaluate(form=>form===window.__optionalForm&&form.querySelector('#template-start')===window.__optionalStart),true);assert.equal(await page.locator('#template-start').inputValue(),'2026-11-03');assert.equal(await page.locator('#template-end').inputValue(),'2026-11-25');assert.equal(await page.locator('#template-fairness-policy').inputValue(),'equal_people');assert.equal(await page.locator('#template-weekdays').isChecked(),false);assert.equal(await page.locator('.template-settings-panel').evaluate(e=>e.open),true);}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);results.push({engine,width,scenario,counts,primary,settings,errors,writes});console.log(engine+' '+width+' '+scenario+' optional recovery passed');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-optional164-v6-integrated-sequenced-r1.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,candidate_sha256:sha(await readFile('src/main.ts')),scope:'Root applied V6 optional failed-read GET-only retry, 30 actual app contexts; V6 preserves figuresDOM and semantic optional focus; all optional failures,subsetretry,settingsDOM identity/value retention,account/route/month ownership,newerfocus,primaryGETcount andzeroPOST. SyntheticreturnedSafetycounts assert exactfragmentupdate,not backendpolicytruth. AllGETlocalmock/fixture;no generation/Apply/GPU.',results},null,2)+'\n');console.log('Optional164 '+(baseline?'baseline':'candidate')+':'+results.length+'contexts');
