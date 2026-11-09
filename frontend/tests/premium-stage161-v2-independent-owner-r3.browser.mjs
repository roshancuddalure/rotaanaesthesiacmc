import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),api='http://127.0.0.1:8031',base='http://127.0.0.1:5277';
const initial=sha(await readFile('src/main.ts')),candidate=sha(await readFile('../tmp/stage161-operations-v2/main.ts'));
const source=await(await fetch(api+'/api/v1/rota-publish/month?month=2026-11')).json();
const report=month=>({...source,month,blockers:[],summary:{...source.summary,total_slots:2,assigned_slots:2,open_slots:0},latest_publish:null});
const results=[];await mkdir('../docs/premium-ui/screenshots/stage161-v2-independent',{recursive:true});
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const scenario of['route-away','month-supersession','enlarged-text']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],writes=[];let reads=0,held,release;
  const pending=new Promise(resolve=>held=resolve),done=new Promise(resolve=>release=resolve);let holding=false;
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','independent161');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push(q.method()+' '+u.pathname);return route.abort();}
   if(u.pathname==='/api/v1/rota-publish/month'){reads++;const value=report(u.searchParams.get('month'));if(holding){holding=false;held();await done;}return route.fulfill({json:value});}
   return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search,maxRetries:2})});});
  try{
   await page.goto(base+'/#view=rota-publish',{waitUntil:'domcontentloaded'});
   const freshness=()=>page.locator('#workflow-tracker [data-workflow-freshness]');
   await freshness().filter({hasText:'Checklist checked for this month.'}).waitFor({state:'attached'});
   if(scenario==='enlarged-text'){
    await page.addStyleTag({content:'html {font-size:200% !important;} .overview-step__label, .overview-step__state {font-size:32px !important;}'});
    await page.evaluate(()=>location.hash='#view=overview');await page.locator('.overview-steps').waitFor();await page.waitForLoadState('networkidle');
    await page.waitForFunction(()=>{const e=document.querySelector('.overview-step__label');return e&&getComputedStyle(e).fontSize==='32px';});
    assert.equal(await page.locator('.overview-step__label').first().evaluate(e=>getComputedStyle(e).fontSize),'32px');
    const ids=await page.locator('.overview-step').evaluateAll(es=>es.map(e=>e.dataset.workflowOperation));assert.deepEqual(ids,['setup','template','assignment','review','publish']);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('.overview-step').last().scrollIntoViewIfNeeded();
    if(engine==='chromium')await page.screenshot({path:`../docs/premium-ui/screenshots/stage161-v2-independent/${width}-overview-200.png`,fullPage:true});
    assert.equal(reads,1);results.push({engine,width,scenario,reads,ids,pageOverflow:false,errors,writes});
   }else{
    await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();holding=true;
    await page.evaluate(()=>location.hash='#view=rota-publish');await pending;
    if(scenario==='route-away'){
     await page.evaluate(()=>location.hash='#view=overview');await page.locator('.overview-steps').waitFor();const before=reads;
     release();await page.waitForLoadState('networkidle');
     const text=await page.locator('.overview-month [data-workflow-freshness]').innerText();
     assert.equal(reads,before);assert.equal(text,'Checking checklist; showing last known progress.');
     results.push({engine,width,scenario,reads,terminalReadStillLabelledChecking:true,text,errors,writes});
    }else{
     await page.locator('#working-month').fill('2026-12');await page.locator('#working-month').dispatchEvent('change');
     await freshness().filter({hasText:'Checklist checked for this month.'}).waitFor({state:'attached'});
     assert.match(await page.locator('#workflow-tracker [data-workflow-month]').innerText(),/December/i);
     release();await page.waitForLoadState('networkidle');
     assert.equal(await freshness().textContent(),'Checklist checked for this month.');assert.match(await page.locator('#workflow-tracker [data-workflow-month]').innerText(),/December/i);
     results.push({engine,width,scenario,reads,lateOldMonthCannotRepaint:true,errors,writes});
    }
   }
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log(engine,width,scenario,'independent observed');
  }finally{release();await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile('src/main.ts')),initial);assert.equal(sha(await readFile('../tmp/stage161-operations-v2/main.ts')),candidate);
await writeFile('../docs/premium-ui/qa-stage161-v2-independent-owner-r3.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/stage161_v2_independent_resume',applied_main_sha256:initial,candidate_main_sha256:candidate,test_sha256:sha(await readFile(new URL(import.meta.url))),scope:'18 actual scratch contexts: route-away read completion freshness diagnostic6, month supersession6, Overview32px label/state text6 (explicit computed value;not nativezoom). Route-away asserts reproduced defect, not accepted behavior. No app/API writes. No whole161 acceptance.',results},null,2)+'\n');
