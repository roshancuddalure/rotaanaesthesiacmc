import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),api='http://127.0.0.1:8031',base='http://127.0.0.1:5197';
const files=['src/main.ts','src/styles.css','src/premium-theme.css','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
const source=await(await fetch(api+'/api/v1/rota-publish/month?month=2026-11')).json();
const publish={...source,blockers:[],warnings:[],can_publish:true,rota_period:{...source.rota_period,status:'published'},latest_publish:{id:'known-stage161',rota_period_id:source.rota_period.id,status:'published',approved_by:'Fixture board',created_at:'2026-11-01T00:00:00Z',confirmed_warnings:true,approval_note:'Local diagnostic'}};
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280]){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[];let reads=0;
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','known-stage161');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push(q.method()+' '+u.pathname);return route.abort();}if(u.pathname==='/api/v1/rota-publish/month'){reads++;return route.fulfill(reads===1?{json:publish}:{status:503,json:{detail:'Known checklist cannot refresh'}});}return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search,maxRetries:2})});});
  try{
   await page.goto(base+'/#view=rota-publish',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>[...document.querySelectorAll('[data-workflow-step]')].length===4&&[...document.querySelectorAll('[data-workflow-step]')].every(e=>e.dataset.state==='done'));
   const before=await page.locator('[data-workflow-step]').evaluateAll(ns=>ns.map(n=>({view:n.dataset.workflowStep,state:n.dataset.state,label:n.querySelector('.nav-step__label')?.textContent,accessibleState:n.querySelector('.visually-hidden')?.textContent})));
   await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();
   await page.evaluate(()=>location.hash='#view=rota-publish');await page.getByRole('heading',{name:'Publish unavailable',exact:true}).waitFor();
   await page.waitForTimeout(100);
   const after=await page.locator('[data-workflow-step]').evaluateAll(ns=>ns.map(n=>({view:n.dataset.workflowStep,state:n.dataset.state,label:n.querySelector('.nav-step__label')?.textContent,accessibleState:n.querySelector('.visually-hidden')?.textContent})));
   assert.equal(reads,2);assert.deepEqual(before,after);assert(after.every(row=>row.state==='done'));
   const tracker=await page.locator('#workflow-tracker').innerText();assert.doesNotMatch(tracker,/stale|last checked|last known|could not refresh|unavailable/i);
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
   results.push({engine,width,reads,before,after,failedCurrentPage:'Publish unavailable',trackerText:tracker,observedUnlabelledCachedDone:true,errors,writes});console.log(engine+' '+width+' known checklist503 leaves unlabelledDone');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-stage161-known-state-independent-defect.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/generation161_stage_clarity_current_audit',scope:'Read-only diagnostic6nativePublish workflows. Successfulpublished checklist followedbyactualGuide-away/returnPublishGET503. Confirms stale cachedDone remains unlabelled,not a passing requirement. No APIwrites;localGETfulfilment/RAMfixture only.',source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');
console.log('Known stage161 diagnostic:6 confirmed stale-state presentations');
