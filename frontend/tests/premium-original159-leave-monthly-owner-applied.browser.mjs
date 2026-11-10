import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

// Root-coordinated execution only. This test has no scratch source dependency.
// Every non-GET is locally fulfilled/refused; remaining GETs use RAM8031 only.
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceNames=['main','leave-approval','member-workspace','services/api'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceNames.map(async name=>['frontend/src/'+name+'.ts',sha(await readFile('src/'+name+'.ts'))])));
const initial=await hashes();
assert.equal(initial['frontend/src/main.ts'],'15b79223710a53a9e0ccdd70373a92e568f6ee603f56e3747454ab25ac258cc0');
assert.equal(initial['frontend/src/leave-approval.ts'],'42e5a47751ae081d1b97108209c7a2b53272985251d153aa065f7718f43e544f');
assert.equal(initial['frontend/src/member-workspace.ts'],'88774f277131a1ed83174d288d882653fc04add295b8237fefa62636e08617ea');
assert.equal(initial['frontend/src/services/api.ts'],'5167f842eb4e07cf5216d18bde2ef48ded1a6692490d80dd261e4ceb038a5e3c');
const base='http://127.0.0.1:5197',report='../docs/premium-ui/qa-original159-leave-monthly-owner-applied.json';
await assert.rejects(access(report),{code:'ENOENT'});
for(const name of sourceNames){
 const response=await fetch(base+'/src/'+name+'.ts');assert.equal(response.status,200);
 const encoded=(await response.text()).match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(encoded);
 assert.ok(JSON.parse(Buffer.from(encoded[1],'base64').toString()).sourcesContent.some(s=>sha(s)===initial['frontend/src/'+name+'.ts']),'Exact applied source '+name);
}
const results=[],browser=await chromium.launch();
try{for(const width of[320,1280])for(const boundary of['approval-response','parent-requests-response'])for(const steering of['route','month','account']){
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(14000);
 const writes=[],reads=[],errors=[],routeErrors=[];let approved=false,held=false,released=false;
 let releaseGate,reachGate;
 const gate=new Promise(resolve=>{releaseGate=()=>{released=true;resolve();};}),reached=new Promise(resolve=>{reachGate=resolve;});
 const waitForReached=async()=>{let timer;try{await Promise.race([reached,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Actual intercepted network boundary not reached')),14000);})]);}finally{clearTimeout(timer);}};
 const member={id:'monthly-owner-person',canonical_name:'Dr Monthly Owner',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
 const leave=()=>({id:'monthly-owner-leave',person:member,person_id:member.id,leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',starts_on:'2026-11-05',ends_on:'2026-11-05',status:approved?'approved':'requested',days:1,source:'manual',notes:null});
 const calendar=month=>({month,summary:{month,starts_on:month+'-01',ends_on:month+(month==='2026-12'?'-31':'-30'),total_requests:month==='2026-11'?1:0,people_on_leave:month==='2026-11'?1:0,total_leave_days:month==='2026-11'?1:0,busiest_day:null,status_counts:{},type_counts:{},slot_counts:{},unit_counts:{},call_level_counts:{}},days:{}});
 const readCounts=()=>Object.fromEntries(['calendar','requests','pressure'].map(key=>[key,reads.filter(r=>r.path==='/api/v1/leave/'+key&&r.month==='2026-11').length]));
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','monthly-owner-local');localStorage.setItem('duty_rota_working_month','2026-11');});
 await page.route('**/api/**',async route=>{
  try{
   const q=route.request(),url=new URL(q.url()),path=url.pathname,month=url.searchParams.get('month')||'2026-11';
   if(q.method()!=='GET'){
    const body=q.postDataJSON();writes.push({method:q.method(),path,body});assert.equal(q.method(),'POST');
    if(path==='/api/v1/leave/approval-preview'){
     assert.deepEqual(body,{month:'2026-11'});
     return route.fulfill({json:{month:'2026-11',pending_count:1,review_token:'monthly-owner-exact-token',requests:[{id:'monthly-owner-leave',person_name:member.canonical_name,starts_on:'2026-11-05',ends_on:'2026-11-05',status:'requested'}],affected_duties:[{id:'monthly-owner-duty',person_id:member.id,person_name:member.canonical_name,date:'2026-11-05',duty:'Existing fixture duty'}]}});
    }
    assert.equal(path,'/api/v1/leave/approve-month');assert.deepEqual(body,{month:'2026-11',review_token:'monthly-owner-exact-token',acknowledge_duties:true});
    assert.equal(approved,false,'Only one accepted approval');approved=true;
    if(boundary==='approval-response'){held=true;reachGate();await gate;}
    return route.fulfill({json:{approved_count:1}});
   }
   reads.push({path,month,search:url.search});
   if(path==='/api/v1/admin/members')return route.fulfill({json:[member]});
   if(path==='/api/v1/leave/calendar')return route.fulfill({json:calendar(month)});
   if(path==='/api/v1/leave/requests'){
    if(boundary==='parent-requests-response'&&approved&&month==='2026-11'&&!held){const snapshot=[leave()];held=true;reachGate();await gate;return route.fulfill({json:snapshot});}
    return route.fulfill({json:month==='2026-11'?[leave()]:[]});
   }
   if(path==='/api/v1/leave/pressure')return route.fulfill({json:{month,days:[],unit_totals:{},call_level_totals:{}}});
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+path+url.search,maxRetries:2})});
  }catch(error){routeErrors.push(error.message);await route.abort().catch(()=>{});}
 });
 let initialReads,beforeRelease,afterRelease;
 try{
  await page.goto(base+'/#view=leave',{waitUntil:'domcontentloaded'});
  await page.locator('[data-approve-month-leave]:enabled').waitFor();initialReads=readCounts();
  for(const n of Object.values(initialReads))assert.equal(n,1,'One initial month read');
  await page.locator('[data-approve-month-leave]').click();const modal=page.locator('dialog.leave-approval-workspace');
  await modal.locator('[data-confirm]').check();assert.equal(await modal.locator('[data-approve]').isDisabled(),true,'Affected duties require separate acknowledgement');
  await modal.locator('[data-duty-ack]').check();await modal.locator('[data-approve]:enabled').click();
  // Await the real intercepted POST/GET boundary before owner steering. In the
  // POST case the dialog cannot close until gate release; never await it first.
  await waitForReached();assert.equal(held,true);assert.equal(released,false);
  const atBoundary=readCounts();for(const[key,value]of Object.entries(atBoundary))assert.equal(value,initialReads[key]+(boundary==='parent-requests-response'?1:0),key+' boundary reads');
  if(steering==='route'){
   await page.evaluate(()=>{location.hash='#view=user-guide';});await page.locator('#guide-checklist').waitFor();
  }else if(steering==='month'){
   await page.evaluate(()=>{const input=document.querySelector('#working-month');input.value='2026-12';input.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.waitForFunction(()=>document.querySelector('#working-month')?.value==='2026-12'&&document.querySelector('[aria-label="Leave actions"] .page-toolbar__context')?.textContent?.includes('0 leave records'));
  }else{
   await page.evaluate(()=>{localStorage.removeItem('duty_rota_auth_token');window.dispatchEvent(new StorageEvent('storage',{key:'duty_rota_auth_token',oldValue:'monthly-owner-local',newValue:null,storageArea:localStorage}));});
   await page.waitForFunction(()=>!document.querySelector('#section-title'));
  }
  beforeRelease=readCounts();assert.deepEqual(beforeRelease,atBoundary,'Steering never requests expired November data');
  const noticesBeforeRelease=await page.locator('[data-profile-parent-refresh]').count();assert.equal(noticesBeforeRelease,0,'New owner has no old pending notice');
  releaseGate();
  // Now the held response can settle and the approval dialog can actually close.
  await modal.waitFor({state:'detached'});await page.waitForLoadState('networkidle');
  afterRelease=readCounts();assert.deepEqual(afterRelease,beforeRelease,'Late accepted response/read cannot initiate old-owner refresh');
  assert.equal(await page.locator('[data-profile-parent-refresh]').count(),0,'Late read cannot paint an expired-owner success/failure notice');
  if(steering==='route')assert.equal(await page.evaluate(()=>location.hash),'#view=user-guide');
  else if(steering==='month'){
   assert.equal(await page.locator('#working-month').inputValue(),'2026-12');assert.match(await page.locator('[aria-label="Leave actions"] .page-toolbar__context').innerText(),/0 leave records/);
   assert.equal(await page.locator('[data-edit-operational-record="monthly-owner-leave"]').count(),0,'Late November result cannot replace newer empty December records');
   for(const key of['calendar','requests','pressure'])assert.equal(reads.filter(r=>r.path==='/api/v1/leave/'+key&&r.month==='2026-12').length,1,'One newer December '+key+' read');
  }else assert.equal(await page.locator('#section-title').count(),0,'Late response cannot recreate private application shell');
  assert.equal(approved,true);assert.equal(writes.length,2);assert.equal(writes.filter(w=>w.path==='/api/v1/leave/approval-preview').length,1);assert.equal(writes.filter(w=>w.path==='/api/v1/leave/approve-month').length,1);
  assert.deepEqual(errors,[]);assert.deepEqual(routeErrors,[]);
  results.push({engine:'chromium',width,boundary,steering,passed:true,approved,held,released,initialReads,atBoundary,beforeRelease,afterRelease,writes,reads,errors,routeErrors});
 }catch(error){results.push({engine:'chromium',width,boundary,steering,passed:false,assertion:error.message,approved,held,released,initialReads,beforeRelease,afterRelease,observed:{hash:await page.evaluate(()=>location.hash).catch(()=>null),notices:await page.locator('[data-profile-parent-refresh]').allTextContents().catch(()=>[])},writes,reads,errors,routeErrors});}
 finally{releaseGate();await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
}}finally{await browser.close();}
assert.deepEqual(await hashes(),initial,'Applied source held throughout');
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/leave159_nondelete_groundwork',operator:'/root when actually executed',execution_target:'current applied source5197 only; no scratch dependency',application_changed_by_test:false,source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),scope:'12 Chromium320/1280 monthly approval owner contexts: actual locally accepted approval POST held before response, or actual parent requestsGET held after accepted callback, each followed by route/month/account supersession before release. Exact one preview and one approved mutation with exact review token and duty acknowledgement. Actual network gate reached before steering; dialog detachment awaited only after held response released. No expired November reads/notices/repaint or mutation replay; newer December snapshot and logout shell preserved. Other GETs RAM8031 only.',limits:['Author has not executed browsers.','Chromium only; no claim of equivalent Firefox/WebKit race coverage.','These are owner lifetime checks, not general monthly approval eligibility/adjacent-month semantics or whole original159 completion.','Physical-device and native assistive-technology checks pending.'],results},null,2)+'\n');
assert.equal(results.length,12);assert.ok(results.every(r=>r.passed),'All monthly late-owner contexts must pass');
