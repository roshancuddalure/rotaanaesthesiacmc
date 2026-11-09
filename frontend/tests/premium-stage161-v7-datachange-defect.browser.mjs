import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),api='http://127.0.0.1:8031',base='http://127.0.0.1:5288';
const initial=sha(await readFile('src/main.ts')),candidate=sha(await readFile('../tmp/stage161-operations-v7/main.ts'));
const source=await(await fetch(api+'/api/v1/rota-publish/month?month=2026-11')).json();
const old={...source,month:'2026-11',summary:{...source.summary,total_slots:2,assigned_slots:2,open_slots:0},blockers:[],can_publish:true,latest_publish:null,rule_version:{...source.rule_version,name:'OLD CHECKLIST BEFORE CHANGE'}};
const fresh={...old,rule_version:{...old.rule_version,name:'FRESH CHECKLIST AFTER CHANGE'}};
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],writes=[];let reads=0,release,started;
  const arrived=new Promise(r=>started=r),pending=new Promise(r=>release=r);
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','datachange161');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push(q.method()+' '+u.pathname);return route.abort();}if(u.pathname==='/api/v1/rota-publish/month'){reads++;if(reads===1){started();await pending;return route.fulfill({json:old});}return route.fulfill({json:fresh});}return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search,maxRetries:2})});});
  try{
   await page.goto(base+'/#view=rota-publish',{waitUntil:'domcontentloaded'});await arrived;
   await page.evaluate(()=>window.dispatchEvent(new CustomEvent('duty-rota:data-change',{detail:{path:'/api/v1/unit-management/units/fixture/settings',at:Date.now()}})));
   release();await page.getByText('Ready for board approval',{exact:true}).waitFor();
   assert.match(await page.locator('#view-root').innerText(),/OLD CHECKLIST BEFORE CHANGE/);assert.equal(await page.locator('#rota-publish-form').count(),1);assert.equal(await page.locator('#download-rota-export').count(),1);
   assert.equal(await page.locator('#workflow-tracker [data-workflow-operation="assignment"]').getAttribute('data-state'),'unknown');assert.equal(reads,1);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
   results.push({engine,width,reads,oldChecklistRenderedAfterChange:true,pageApprovalControlsPresent:true,trackerUnknown:true,errors,writes});console.log(engine,width,'datachange stale page reproduced');
  }finally{release();await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile('src/main.ts')),initial);assert.equal(sha(await readFile('../tmp/stage161-operations-v7/main.ts')),candidate);
await writeFile('../docs/premium-ui/qa-stage161-v7-datachange-independent-defect.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/stage161_v4_review',candidate_main_sha256:candidate,applied_main_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),scope:'Six actualV7scratch same-view Publish read held, then locally dispatched actual data-change notification type and oldresponse released. No actualmutationPOST. Diagnostic proves stale oldpageReady/approval/exportcontrols rendered after readgeneration invalidation while trackerunknown. Success is defect reproduction, not acceptedbehavior.',results},null,2)+'\n');
