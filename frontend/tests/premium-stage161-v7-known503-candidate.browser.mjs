import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),api='http://127.0.0.1:8031',base='http://127.0.0.1:5288';
const files=['src/main.ts','src/premium-theme.css','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
const source=await(await fetch(api+'/api/v1/rota-publish/month?month=2026-11')).json();
const value={...source,blockers:[],warnings:[],can_publish:true,summary:{...source.summary,total_slots:2,assigned_slots:2,open_slots:0},rota_period:{...source.rota_period,status:'published'},latest_publish:{id:'known-stage161',rota_period_id:source.rota_period.id,status:'published',approved_by:'Fixture board',created_at:'2026-11-01T00:00:00Z',confirmed_warnings:true,approval_note:'Local diagnostic'}};
const results=[];await mkdir('../docs/premium-ui/screenshots/stage161-operations-v7',{recursive:true});
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280]){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[];let reads=0;
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','known-stage161');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push(q.method()+' '+u.pathname);return route.abort();}if(u.pathname==='/api/v1/rota-publish/month'){reads++;return route.fulfill(reads===2?{status:503,json:{detail:'Known checklist cannot refresh'}}:{json:value});}return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search,maxRetries:2})});});
  try{
   await page.goto(base+'/#view=rota-publish',{waitUntil:'domcontentloaded'});
   const nav=page.locator('#workflow-tracker [data-workflow-operation]');
   await page.waitForFunction(()=>[...document.querySelectorAll('#workflow-tracker [data-workflow-operation]')].length===5&&[...document.querySelectorAll('#workflow-tracker [data-workflow-operation]')].every(e=>e.dataset.state==='done'));
   assert.deepEqual(await nav.evaluateAll(ns=>ns.map(n=>n.dataset.workflowOperation)),['setup','template','assignment','review','publish']);
   const before=await nav.evaluateAll(ns=>ns.map(n=>({id:n.dataset.workflowOperation,state:n.dataset.state,label:n.querySelector('.nav-step__label')?.textContent,accessibleState:n.querySelector('.visually-hidden')?.textContent})));
   await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();
   await page.evaluate(()=>location.hash='#view=rota-publish');await page.getByText('Publish unavailable',{exact:true}).waitFor();
   await page.locator('#workflow-tracker [data-workflow-freshness]').filter({hasText:'Checklist unavailable; showing last known progress.'}).waitFor({state:'attached'});
   const failed=await nav.evaluateAll(ns=>ns.map(n=>({id:n.dataset.workflowOperation,state:n.dataset.state,accessibleState:n.querySelector('.visually-hidden')?.textContent})));
   assert.equal(reads,2);assert(failed.every(row=>row.state==='unknown'&&row.accessibleState===', Last known: Done'));
   if(engine==='chromium'){if(width===320)await page.locator('#sidebar-toggle').click();await page.screenshot({path:'../docs/premium-ui/screenshots/stage161-operations-v7/'+width+'-unavailable.png',fullPage:true});if(width===320)await page.locator('#sidebar-close').click();}
   await page.locator('[data-retry-publish]').focus();await page.keyboard.press('Enter');
   await page.waitForFunction(()=>[...document.querySelectorAll('#workflow-tracker [data-workflow-operation]')].every(e=>e.dataset.state==='done'));
   assert.equal(reads,3);assert.equal(await page.getByText('Publish unavailable',{exact:true}).count(),0);
   assert.match(await page.locator('#workflow-tracker [data-workflow-freshness]').textContent(),/Checklist checked for this month/);
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
   results.push({engine,width,reads,before,failed,successfulRetryReconfirms:true,errors,writes});console.log(engine+' '+width+' five stages knownDone503/readretry passed');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-stage161-v7-known503-candidate.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/stage161_v4_review',scope:'Scratch V2 author6nativePublish workflows: knownDone→actualGuide→PublishGET503 shows allfive operation indicators unknown plus explicit LastknownDone; existing keyboard retry freshread reestablishesDone. No APIwrites. Notwhole161acceptance.',source_sha256:initial,candidate_main_sha256:sha(await readFile('../tmp/stage161-operations-v7/main.ts')),candidate_css_sha256:sha(await readFile('../tmp/stage161-operations-v7/premium-theme.css')),test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');
console.log('Stage161 V2 recovery:6contexts');
