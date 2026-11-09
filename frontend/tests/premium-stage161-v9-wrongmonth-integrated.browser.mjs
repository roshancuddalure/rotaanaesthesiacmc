import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
assert.equal(createHash('sha256').update(await readFile('src/main.ts')).digest('hex'),'5311e9933a6614747458418a218ac2b22855c2f7baa574e446557a4aa6d9d13d');
assert.equal(createHash('sha256').update(await readFile('src/premium-theme.css')).digest('hex'),'acc46b2249087f365ca855bcd9630628c390c4cdf013301daaee40ede80e55f4');
const sha=b=>createHash('sha256').update(b).digest('hex'),api='http://127.0.0.1:8031',base='http://127.0.0.1:5197';
const candidate='../tmp/stage161-operations-v9/main.ts',candidateHash=sha(await readFile(candidate)),initial=sha(await readFile('src/main.ts'));
const source=await(await fetch(api+'/api/v1/rota-publish/month?month=2026-11')).json();
const valid={...source,month:'2026-11',blockers:[],can_publish:true,latest_publish:null,summary:{...source.summary,total_slots:2,assigned_slots:2,open_slots:0}};
const wrong={...valid,month:'2026-12',rule_version:{...valid.rule_version,name:'WRONG MONTH CHECKLIST MARKER'}};
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],writes=[],requested=[];let reads=0;
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','wrong-context161');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push(q.method()+' '+u.pathname);return route.abort();}
   if(u.pathname==='/api/v1/rota-publish/month'){requested.push(u.searchParams.get('month'));reads++;return route.fulfill({json:reads%2?wrong:valid});}
   return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto(base+'/#view=rota-publish',{waitUntil:'domcontentloaded'});
   const freshness=page.locator('#workflow-tracker [data-workflow-freshness]');
   await page.getByText('Publish unavailable',{exact:true}).waitFor();
   assert.equal(await freshness.textContent(),'Checklist unavailable; progress unknown.');
   assert.equal(await page.locator('#rota-publish-form, #download-rota-export').count(),0);assert.equal(await page.getByText('WRONG MONTH CHECKLIST MARKER',{exact:false}).count(),0);
   assert.equal(await page.locator('#working-month').inputValue(),'2026-11');
   await page.locator('[data-retry-publish]').click();await freshness.filter({hasText:'Checklist checked for this month.'}).waitFor({state:'attached'});
   assert.equal(reads,2);assert.match(await page.locator('#view-root').innerText(),/November 2026/);assert.equal(await page.locator('#rota-publish-form').count(),1);assert.equal(await page.locator('#download-rota-export').count(),1);assert.equal(await page.locator('#workflow-tracker [data-workflow-operation="assignment"]').getAttribute('data-state'),'done');
   await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();
   await page.evaluate(()=>location.hash='#view=rota-publish');await page.getByText('Publish unavailable',{exact:true}).waitFor();
   assert.equal(await freshness.textContent(),'Checklist unavailable; showing last known progress.');
   assert.equal(await page.locator('#workflow-tracker [data-workflow-operation="assignment"]').getAttribute('data-state'),'unknown');
   assert.match(await page.locator('#workflow-tracker [data-workflow-operation="assignment"] .visually-hidden').textContent(),/Last known: Done/);
   assert.equal(await page.getByText('WRONG MONTH CHECKLIST MARKER',{exact:false}).count(),0);assert.equal(await page.locator('#rota-publish-form, #download-rota-export').count(),0);
   await page.locator('[data-retry-publish]').click();await freshness.filter({hasText:'Checklist checked for this month.'}).waitFor({state:'attached'});
   assert.equal(reads,4);assert.deepEqual(requested,['2026-11','2026-11','2026-11','2026-11']);assert.equal(await page.locator('#working-month').inputValue(),'2026-11');
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   results.push({engine,width,reads,requested,initialWrongMonthRejected:true,knownStateWrongMonthExplicitlyUnavailable:true,wrongDataNeverRendered:true,retryReadOnly:true,errors,writes});console.log(engine,width,'wrongmonth initial/known/read-only retry passed');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile(candidate)),candidateHash);assert.equal(sha(await readFile('src/main.ts')),initial);
await writeFile('../docs/premium-ui/qa-stage161-v9-wrongmonth-integrated.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root/stage161_v4_review',candidate_main_sha256:candidateHash,applied_main_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),scope:'Six frozen candidate contexts3engines320/1280. Initialwrongmonth200 and subsequentknown-state wrongmonth nevercommit/renderwrongdata; checklistunavailable explicitlyunknown/lastknown; manualGETretryrecoverssameworkingmonth. Zero writes; noactualPublish/Export.',results},null,2)+'\n');
