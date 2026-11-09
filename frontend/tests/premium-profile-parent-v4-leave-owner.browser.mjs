import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const base='http://127.0.0.1:5292',api='http://127.0.0.1:8031';
const paths=['src/main.ts','src/member-workspace.ts','src/record-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))])));
const initial=await hashes(),candidatePaths=['../tmp/profile-parent-refresh-v4/main.ts','../tmp/profile-parent-refresh-v4/member-workspace.ts'];
assert.equal(initial['frontend/src/main.ts'],'5311e9933a6614747458418a218ac2b22855c2f7baa574e446557a4aa6d9d13d');
const candidateHashes=Object.fromEntries(await Promise.all(candidatePaths.map(async p=>[p,sha(await readFile(p))])));
assert.equal(candidateHashes[candidatePaths[0]],'355e71753eb79135d4bdefb94837da4fc1ff727b12a2ed1f9c4bdb4b5d744a07');
assert.equal(candidateHashes[candidatePaths[1]],'105cc1d91ea4815d565ad4859fc01412cf576a3203c07834f4010e3fef7ef1a5');
const previewIntegrity=[];
for(const[i,name]of ['main.ts','member-workspace.ts'].entries()){
 const response=await fetch(base+'/src/'+name);assert.equal(response.status,200);
 const text=await response.text(),match=text.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(match);
 const map=JSON.parse(Buffer.from(match[1],'base64').toString('utf8'));
 assert.ok(map.sourcesContent?.some(source=>typeof source==='string'&&sha(source)===candidateHashes[candidatePaths[i]]));
 previewIntegrity.push({name,sha256:candidateHashes[candidatePaths[i]]});
}
const member={id:'parent-person',canonical_name:'Dr Parent Audit',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
const scenarios=['leave-route-away-return','leave-month-supersession','leave-signout','leave-newer-view-focus'];
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of[320,1280])for(const scenario of scenarios){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],requests=[],writes=[];
  let saved=false,leaveReads=0,calendarReads=0,profileReads=0,holdNextCalendar=false,started,release;
  const held=new Promise(r=>started=r),gate=new Promise(r=>release=r);
  const leave=(month='2026-11')=>({id:month==='2026-11'?'parent-leave':'other-month-leave',person:member,person_id:member.id,leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',starts_on:month+'-05',ends_on:month+'-05',status:month==='2026-11'&&saved?'cancelled':'approved',days:1,source:'manual',raw_person_name:null,notes:'Parent leave target'});
  const calendar=month=>{
   const active=!(month==='2026-11'&&saved),day=month+'-05',last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
   return {month,summary:{month,starts_on:month+'-01',ends_on:last,total_requests:active?1:0,blocking_requests:active?1:0,people_on_leave:active?1:0,total_leave_days:active?1:0,busiest_day:active?{date:day,count:1}:null,status_counts:active?{approved:1}:{},type_counts:{},slot_counts:{},unit_counts:{},call_level_counts:{}},days:active?{[day]:[{leave_id:leave(month).id,person_id:member.id,person_name:member.canonical_name,leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',status:'approved',unit:null,posting_type:null,call_level:'2ND_CALL'}]}:{}};
  };
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','profile-leave-owner');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url()),p=u.pathname;requests.push({method:q.method(),path:p,search:u.search});
   if(q.method()!=='GET'){
    writes.push({method:q.method(),path:p,body:q.postDataJSON()});assert.equal(q.method(),'POST');
    assert.equal(p,'/api/v1/leave/requests/parent-leave/cancel');saved=true;return route.fulfill({json:leave()});
   }
   if(p==='/api/v1/admin/members')return route.fulfill({json:[member]});
   if(p==='/api/v1/admin/member-workspace/parent-person')return route.fulfill({json:{member,impact:{}}});
   if(p.startsWith('/api/v1/admin/member-workspace/parent-person/')){profileReads++;return route.fulfill({json:{rows:p.endsWith('/leave')?[leave()]:[]}});}
   if(p==='/api/v1/leave/requests'){leaveReads++;return route.fulfill({json:[leave(u.searchParams.get('month'))]});}
   if(p==='/api/v1/leave/calendar'){
    calendarReads++;const value=calendar(u.searchParams.get('month'));
    if(holdNextCalendar){holdNextCalendar=false;started();await gate;}
    return route.fulfill({json:value});
   }
   if(p==='/api/v1/leave/pressure')return route.fulfill({json:{month:u.searchParams.get('month'),days:[],unit_totals:{},call_level_totals:{}}});
   return route.fulfill({response:await route.fetch({url:api+p+u.search,maxRetries:2})});
  });
  try{
   await page.goto(base+'/#view=leave',{waitUntil:'domcontentloaded'});
   const parent=width===320?page.locator('.card-list[aria-label="Leave this month"]:visible'):page.locator('section[aria-labelledby="leave-list-title"]:visible');
   await parent.locator('[data-open-member="parent-person"]').waitFor();
   const beforeReads=leaveReads,beforeCalendars=calendarReads;
   await page.evaluate(()=>{
    const selectors=['#leave-month-view','#leave-day-list-view','#leave-history-host','.leave-month-scroll','[data-leave-calendar-view="month"]','[data-leave-calendar-view="list"]'];
    window.__leaveParentSelectors=selectors;window.__leaveParentNodes=selectors.map(selector=>document.querySelector(selector));
   });
   await parent.locator('[data-open-member="parent-person"]').click();
   const profile=page.getByRole('dialog',{name:'Member profile',exact:true});
   await profile.locator('[data-cancel-profile-leave="parent-leave"]').click();await profile.getByText('Cancelled',{exact:true}).waitFor();
   assert.equal(leaveReads,beforeReads,'Parent reads defer until final profile close');assert.equal(calendarReads,beforeCalendars);
   holdNextCalendar=true;await profile.locator('[data-close]').first().click();await profile.waitFor({state:'detached'});await held;
   // Requests and pressure may resolve first; none of their data should paint until the owned group completes.
   assert.match(await parent.innerText(),/Approved/);assert.match(await page.locator('.page-toolbar__context').innerText(),/for 1 person/);
   const outcome={oldParentRetainedWhileGroupHeld:true};
   if(scenario==='leave-newer-view-focus'){
    const toggle=page.locator('[data-leave-calendar-view="list"]');await toggle.click();await toggle.focus();
    release();await page.getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();
    assert.equal(await toggle.getAttribute('aria-pressed'),'true');assert.equal(await toggle.evaluate(e=>e===document.activeElement),true);
    assert.equal(await page.evaluate(()=>window.__leaveParentSelectors.every((selector,index)=>document.querySelector(selector)===window.__leaveParentNodes[index])),true);
    assert.equal(await page.locator('#leave-month-view').evaluate(e=>e.hidden),true);assert.equal(await page.locator('#leave-day-list-view').evaluate(e=>e.hidden),false);
    assert.match(await parent.innerText(),/Cancelled/);assert.doesNotMatch(await parent.innerText(),/Approved/);
    assert.match(await page.locator('.page-toolbar__context').innerText(),/for 0 people/);
    assert.equal(leaveReads,beforeReads+1);assert.equal(calendarReads,beforeCalendars+1);
    outcome.newerViewAndFocusPreserved=true;outcome.originalCalendarAndHistoryHostsRetained=true;outcome.freshCancelledParentAndSummary=true;
   }else if(scenario==='leave-route-away-return'){
    await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();
    release();await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('[data-profile-parent-refresh],#leave-day-modal').count(),0);
    await page.evaluate(()=>location.hash='#view=leave');
    await page.locator('.page-toolbar__context').filter({hasText:'for 0 people'}).waitFor();
    const returned=width===320?page.locator('.card-list[aria-label="Leave this month"]:visible'):page.locator('section[aria-labelledby="leave-list-title"]:visible');
    assert.match(await returned.innerText(),/Cancelled/);assert.doesNotMatch(await returned.innerText(),/Approved/);
    assert.equal(leaveReads,beforeReads+2);assert.equal(calendarReads,beforeCalendars+2);outcome.oldReadCannotRepaintAwayView=true;outcome.returnReadsFresh=true;
   }else if(scenario==='leave-month-supersession'){
    await page.evaluate(()=>{const input=document.querySelector('#working-month');input.value='2026-12';input.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.locator('.page-toolbar__context').filter({hasText:'December 2026'}).waitFor();
    release();await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('#working-month').inputValue(),'2026-12');assert.equal(await page.locator('[data-profile-parent-refresh]').count(),0);
    assert.match(await page.locator('.page-toolbar__context').innerText(),/December 2026.*for 1 person/);
    assert.match(await parent.innerText(),/Approved/);assert.doesNotMatch(await parent.innerText(),/Cancelled/);
    assert.equal(leaveReads,beforeReads+2);assert.equal(calendarReads,beforeCalendars+2);outcome.oldMonthCannotRestoreSnapshotNoticeOrMonth=true;
   }else{
    await page.evaluate(()=>{localStorage.removeItem('duty_rota_auth_token');window.dispatchEvent(new StorageEvent('storage',{key:'duty_rota_auth_token',oldValue:'profile-leave-owner',newValue:null}));});
    await page.locator('#workflow-tracker').waitFor({state:'detached'});release();await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('[data-profile-parent-refresh],#leave-day-modal,[data-open-member="parent-person"]').count(),0);
    assert.equal(leaveReads,beforeReads+1);assert.equal(calendarReads,beforeCalendars+1);outcome.noLatePrivateParentAfterSignout=true;
   }
   assert.equal(writes.length,1);assert.equal(profileReads,2);assert.deepEqual(errors,[]);
   results.push({engine,width,scenario,beforeReads,beforeCalendars,leaveReads,calendarReads,profileReads,...outcome,writes,requests,errors,allWritesLocallyFulfilled:true});
   console.log(engine,width,scenario,'Leave-parent ownership passed');
  }finally{release();await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);for(const[p,digest]of Object.entries(candidateHashes))assert.equal(sha(await readFile(p)),digest);
await writeFile('../docs/premium-ui/qa-profile-parent-v4-leave-owner.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/profile_payload_guard',scope:'24 scratch Leave-parent cancellation contexts, three engines at320/1280. Actual table/card profile entry; final close defers parent group read. Held calendar makes requests/pressure resolve first without painting. Route away/return, requested-month supersession, signout and newer calendar view/focus verify stale suppression and current host retention. No profile-entry-from-day-modal claim: current V4 day modal has no profile control. All writes locally fulfilled; no production/backend changes or whole159 acceptance.',source_sha256:initial,candidate_sha256:candidateHashes,preview_integrity:previewIntegrity,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');
