import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),api='http://127.0.0.1:8031',base='http://127.0.0.1:5288';
const source=await(await fetch(api+'/api/v1/rota-publish/month?month=2026-11')).json(),initial=sha(await readFile('src/main.ts')),candidate=sha(await readFile('../tmp/stage161-operations-v7/main.ts'));
const scenarios=[['missing',{total_slots:2,open_slots:0}],['fractional',{total_slots:.5,assigned_slots:.5,open_slots:0}],['inconsistent',{total_slots:2,assigned_slots:1,open_slots:0}],['excess',{total_slots:2,assigned_slots:3,open_slots:0}],['enlarged',{total_slots:2,assigned_slots:2,open_slots:0}]],results=[];
await mkdir('../docs/premium-ui/screenshots/stage161-operations-v7',{recursive:true});
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const[scenario,counts]of scenarios){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],writes=[];let reads=0;
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','stage161-invalidcounts');localStorage.setItem('duty_rota_working_month','2026-11');});
  const summary={...source.summary,...counts};if(scenario==='missing')delete summary.assigned_slots;
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push(q.method()+' '+u.pathname);return route.abort();}if(u.pathname==='/api/v1/rota-publish/month'){reads++;return route.fulfill({json:{...source,month:'2026-11',summary,blockers:[],can_publish:true,latest_publish:null}});}return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search,maxRetries:2})});});
  try{
   await page.goto(base+'/#view=rota-publish',{waitUntil:'domcontentloaded'});await page.locator('#workflow-tracker [data-workflow-freshness]').filter({hasText:'Checklist checked for this month.'}).waitFor({state:'attached'});
   const stage=page.locator('#workflow-tracker [data-workflow-operation="assignment"]');
   if(scenario!=='enlarged'){
    assert.equal(await stage.getAttribute('data-state'),'unknown');assert.equal(await stage.locator('.visually-hidden').textContent(),', Open to check');
   }else{
    assert.equal(await stage.getAttribute('data-state'),'done');await page.evaluate(()=>location.hash='#view=overview');await page.locator('.overview-steps').waitFor();await page.waitForLoadState('networkidle');
    await page.addStyleTag({content:'html {font-size:200% !important;} .overview-step__label, .overview-step__state {font-size:32px !important;}'});
    assert.equal(await page.locator('.overview-step__label').first().evaluate(e=>getComputedStyle(e).fontSize),'32px');
    assert.deepEqual(await page.locator('.overview-step').evaluateAll(ns=>ns.map(n=>n.dataset.workflowOperation)),['setup','template','assignment','review','publish']);
    const last=page.locator('.overview-step').last().locator('button');await last.scrollIntoViewIfNeeded();await last.focus();assert.equal(await last.evaluate(e=>e===document.activeElement),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(reads,1);
    if(engine==='chromium')await page.screenshot({path:`../docs/premium-ui/screenshots/stage161-operations-v7/${width}-overview-32px.png`,fullPage:true});
   }
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);results.push({engine,width,scenario,reads,counts,invalidUnknown:scenario!=='enlarged',enlarged32px:scenario==='enlarged',errors,writes});console.log(engine,width,scenario,'candidate verified');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile('src/main.ts')),initial);assert.equal(sha(await readFile('../tmp/stage161-operations-v7/main.ts')),candidate);
await writeFile('../docs/premium-ui/qa-stage161-v7-invalidcounts-text-candidate.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root/stage161_v4_review',candidate_main_sha256:candidate,applied_main_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),scope:'30 actual scratch contexts:24 invalid/missing/fractional/inconsistent/excess assigned-count states showunknown withaccessibleOpen tocheck;6 Overview32px actualcomputedtext cases retain5operations,lastkeyboardbuttonreachability,no pageoverflow andcache-onlyread. Textscaling isnotnativezoom. No writes/actualPublish/Export.',results},null,2)+'\n');
