import assert from 'node:assert/strict';import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';import{chromium,firefox,webkit}from'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),base='http://127.0.0.1:5197',api='http://127.0.0.1:8031';
const held={"main.ts": "9f5359ad9e8014098bc12c8ed3f9e1c6b1a06d1a4f92797b7f9da24bfba6e6b8", "reference-workspace.ts": "dbd6d1bdb13893ee49d3f004518177b964101520e2bd2034d8639f1c76f134bd", "extra-duty.ts": "529e420fc05ce5bfa42655b8863e449e09e22a7c0abe9baf4db5c94c4797b8c3", "member-workspace.ts": "105cc1d91ea4815d565ad4859fc01412cf576a3203c07834f4010e3fef7ef1a5", "operational-import.ts": "1ccbcf4181330a5f66c59b0723ec02f878a268b6b3030aa99b177de1b7070355", "record-workspace.ts": "469fd6bf2e4118b15ad343d8059cd3cfb0acbc6483bea969ca5fb93488644335", "services/api.ts": "5167f842eb4e07cf5216d18bde2ef48ded1a6692490d80dd261e4ceb038a5e3c"},candidates={"main.ts": "9f5359ad9e8014098bc12c8ed3f9e1c6b1a06d1a4f92797b7f9da24bfba6e6b8", "reference-workspace.ts": "dbd6d1bdb13893ee49d3f004518177b964101520e2bd2034d8639f1c76f134bd", "extra-duty.ts": "529e420fc05ce5bfa42655b8863e449e09e22a7c0abe9baf4db5c94c4797b8c3", "member-workspace.ts": "105cc1d91ea4815d565ad4859fc01412cf576a3203c07834f4010e3fef7ef1a5", "operational-import.ts": "1ccbcf4181330a5f66c59b0723ec02f878a268b6b3030aa99b177de1b7070355", "record-workspace.ts": "469fd6bf2e4118b15ad343d8059cd3cfb0acbc6483bea969ca5fb93488644335", "services/api.ts": "5167f842eb4e07cf5216d18bde2ef48ded1a6692490d80dd261e4ceb038a5e3c"};
const sourcePath=n=>['main.ts','reference-workspace.ts','extra-duty.ts'].includes(n)?'../tmp/registry-parent-refresh-v10r4/'+n:'src/'+n;
const hashes=async()=>Object.fromEntries(await Promise.all(Object.keys(held).map(async n=>['frontend/src/'+n,sha(await readFile('src/'+n))]))),initial=await hashes();for(const[n,h]of Object.entries(held))assert.equal(initial['frontend/src/'+n],h);
const candidatePaths=Object.keys(candidates).map(sourcePath),candidateHashes=Object.fromEntries(await Promise.all(candidatePaths.map(async p=>[p,sha(await readFile(p))])));for(const[n,h]of Object.entries(candidates)){assert.equal(sha(await readFile(sourcePath(n))),h);const r=await fetch(base+'/src/'+n);assert.equal(r.status,200);const t=await r.text(),m=t.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(m);assert.ok(JSON.parse(Buffer.from(m[1],'base64').toString()).sourcesContent.some(s=>sha(s)===h),'Exact served '+n);}
{
const results=[];
const member={id:'parent-person',canonical_name:'Dr Parent Audit',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
const unit={id:'parent-unit',name:'Royal Parent Unit',campus:'Main',code:'PARENT',minimum_free_people:1,active_status:'active',notes:null};
for(const [engine,launcher] of Object.entries({chromium}))for(const width of[320,1280])for(const scenario of['posting-edit']){
 const browser=await launcher.launch(),page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],requests=[],writes=[];let saved=false,unitReads=0,leaveReads=0,profileReads=0;
 const posting=()=>({id:'parent-posting',person:member,person_id:member.id,unit,unit_id:unit.id,posting_type:'2ND_CALL',starts_on:'2026-11-01',ends_on:'2026-11-30',source:'manual',notes:saved?'Saved posting notes NEW':'Saved posting notes OLD'});
 const leave=()=>({id:'parent-leave',person:member,person_id:member.id,leave_type:'ANNUAL_LEAVE',type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',slot:'FULL_DAY',starts_on:'2026-11-05',ends_on:'2026-11-05',status:saved?'cancelled':'approved',days:1,source:'manual',raw_person_name:null,notes:'Parent leave target'});
 const unitData=()=>({month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',units:[unit],assignments:[posting()],unit_summaries:[{unit_id:unit.id,assigned_members:1,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[{unit_id:unit.id,call_level:'2ND_CALL',assigned_members:1,minimum_free_people:1,max_allowed:1}],validation_issues:[]});
 page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','profile-parent-independent');localStorage.setItem('duty_rota_working_month','2026-11');});
 await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url()),p=u.pathname;requests.push({method:q.method(),path:p});
  if(q.method()!=='GET'){
   writes.push({method:q.method(),path:p,body:q.postDataJSON()});assert.equal(q.method(),'POST');
   if(p==='/api/v1/normalization/records/units/preview'){assert.equal(q.postDataJSON().identity,'parent-posting');return route.fulfill({json:{review_token:'parent-token',before:posting(),after:q.postDataJSON().values,availability:'Fixture reviewed',duties:[]}});}
   if(p==='/api/v1/normalization/records/units/save'){assert.equal(q.postDataJSON().identity,'parent-posting');assert.equal(q.postDataJSON().review_token,'parent-token');assert.equal(q.postDataJSON().values.notes,'Saved posting notes NEW');saved=true;return route.fulfill({json:posting()});}
   assert.equal(p,'/api/v1/leave/requests/parent-leave/cancel');saved=true;return route.fulfill({json:leave()});
  }
  if(p==='/api/v1/admin/members')return route.fulfill({json:[member]});
  if(p==='/api/v1/normalization/units')return route.fulfill({json:[unit]});
  if(p.startsWith('/api/v1/normalization/catalog/')){const kind=p.split('/').at(-1),key={posting_type:'2ND_CALL',leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',leave_status:'approved'}[kind];return route.fulfill({json:[{key,label:key,active:true}]});}
  if(p==='/api/v1/normalization/records/units/parent-posting')return route.fulfill({json:posting()});
  if(p==='/api/v1/admin/member-workspace/parent-person')return route.fulfill({json:{member,impact:{}}});
  if(p.startsWith('/api/v1/admin/member-workspace/parent-person/')){profileReads++;return route.fulfill({json:{rows:p.endsWith('/postings')?[{...posting(),unit:unit.name}]:p.endsWith('/leave')?[leave()]:[]}});}
  if(p==='/api/v1/unit-management/month'){unitReads++;return route.fulfill({json:unitData()});}
  if(p==='/api/v1/leave/requests'){leaveReads++;return route.fulfill({json:[leave()]});}
  if(p==='/api/v1/leave/calendar')return route.fulfill({json:{month:'2026-11',summary:{month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',total_requests:1,blocking_requests:saved?0:1,people_on_leave:saved?0:1,total_leave_days:saved?0:1,busiest_day:null,status_counts:{},type_counts:{},slot_counts:{},unit_counts:{},call_level_counts:{}},days:{}}});
  if(p==='/api/v1/leave/pressure')return route.fulfill({json:{month:'2026-11',days:[],call_level_totals:{},unit_totals:{}}});
  return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+p+u.search,maxRetries:2})});
 });
 try{
  await page.goto('http://127.0.0.1:5197/#view='+(scenario==='posting-edit'?'units':'leave'),{waitUntil:'domcontentloaded'});
  let parent,readsBefore;
  if(scenario==='posting-edit'){
   await page.locator('input[data-unit-board-search]').fill('Royal');await page.locator('[data-unit-board-card="unit:parent-unit"] button[data-open-unit-modal]').click();
   parent=page.locator('#unit-management-modal');await parent.locator('#unit-minimum-free-people').fill('3');await parent.locator('#unit-settings-form').evaluate(e=>{window.__parentForm=e;window.__parentInput=e.querySelector('#unit-minimum-free-people');});
   await parent.locator('[data-open-member="parent-person"]').click();readsBefore=unitReads;
  }else{
   await page.locator('[data-leave-calendar-view="list"]').click();
   parent=width===320?page.locator('.card-list[aria-label="Leave this month"]:visible'):page.locator('section[aria-labelledby="leave-list-title"]:visible');
   await parent.locator('[data-open-member="parent-person"]').click();readsBefore=leaveReads;
  }
  const profile=page.getByRole('dialog',{name:'Member profile',exact:true});
  if(scenario==='posting-edit'){
   await profile.locator('[data-edit-record="parent-posting"]').click();const editor=page.getByRole('dialog',{name:'Edit posting',exact:true});await editor.locator('[name=notes]').fill('Saved posting notes NEW');await editor.getByRole('button',{name:'Review changes',exact:true}).click();await editor.locator('[data-save]:enabled').click();await editor.waitFor({state:'detached'});
   await profile.getByText('Saved posting notes NEW',{exact:true}).waitFor();
  }else{
   await profile.locator('[data-cancel-profile-leave="parent-leave"]').click();await profile.getByText('Cancelled',{exact:true}).waitFor();
  }
  await profile.locator('[data-close]').first().click();await profile.waitFor({state:'detached'});
  assert.equal(await page.locator('#working-month').inputValue(),'2026-11');assert.deepEqual(errors,[]);
  await page.getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();
  let freshText;
  if(scenario==='posting-edit'){
   freshText=await parent.locator('[data-unit-row-form="parent-posting"]').innerText();assert.match(freshText,/Saved posting notes NEW/);assert.doesNotMatch(freshText,/Saved posting notes OLD/);assert.equal(unitReads,readsBefore+1);
   assert.equal(await parent.locator('#unit-minimum-free-people').inputValue(),'3');assert.equal(await parent.locator('#unit-settings-form').evaluate(e=>e===window.__parentForm&&e.querySelector('#unit-minimum-free-people')===window.__parentInput),true);
   assert.equal(await parent.locator('[data-profile-parent-refresh]').count(),1);await parent.locator('[data-close-unit-modal]').click();assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Royal');
  }else{
   freshText=await parent.innerText();assert.match(freshText,/Cancelled/);assert.doesNotMatch(freshText,/Approved/);assert.equal(leaveReads,readsBefore+1);assert.equal(await page.locator('[data-leave-calendar-view="list"]').getAttribute('aria-pressed'),'true');
  }
  assert.equal(writes.filter(w=>!w.path.endsWith('/preview')).length,1);assert.equal(profileReads,2);assert.deepEqual(errors,[]);
  results.push({engine,width,scenario,parentFreshAfterProfileClose:true,freshText,readsBefore,readsAfterParentRefresh:scenario==='posting-edit'?unitReads:leaveReads,profileReads,selectedMonthRetained:true,unrelatedDraftOrViewRetained:true,deferredOwnedParentRead:true,writes,requests,errors});console.log(width+' '+scenario+' parent fresh after profile close');
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
}
assert.deepEqual(await hashes(),initial);for(const p of candidatePaths)assert.equal(sha(await readFile(p)),candidateHashes[p]);
assert.equal(results.length,2);
await writeFile('../docs/premium-ui/qa-original159-registry-v10r4-integrated-profile-caller-normal.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root',decision:'Scratch expected-correct parent refresh workflows, not applied acceptance.',scope:'Two Chromium320/1280 Units profile posting-edit caller regression contexts only; no Leave case executed. Units modalâ†’profile Postings edit and Leave listâ†’profile cancellation refresh profile and deferred current parent after close, retaining unrelated settings fields and selected Leave view. One accepted locally fulfilled mutation each; exactlyone owned parent read, no manual navigation. No backend writes/production/permissions certification.',source_sha256:initial,candidate_sha256:candidateHashes,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Profile parent V4 scratch:12 expected-correct contexts');

}
{
const results=[];
const member={id:'parent-person',canonical_name:'Dr Parent Audit',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
const unit={id:'parent-unit',name:'Royal Parent Unit',campus:'Main',code:'PARENT',minimum_free_people:1,active_status:'active',notes:null};
for(const [engine,launcher] of Object.entries({chromium}))for(const width of[320,1280])for(const scenario of['posting-edit']){
 const browser=await launcher.launch(),page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],requests=[],writes=[];let saved=false,unitReads=0,leaveReads=0,profileReads=0;
 const posting=()=>({id:'parent-posting',person:member,person_id:member.id,unit,unit_id:unit.id,posting_type:'2ND_CALL',starts_on:'2026-11-01',ends_on:'2026-11-30',source:'manual',notes:saved?'Saved posting notes NEW':'Saved posting notes OLD'});
 const leave=()=>({id:'parent-leave',person:member,person_id:member.id,leave_type:'ANNUAL_LEAVE',type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',slot:'FULL_DAY',starts_on:'2026-11-05',ends_on:'2026-11-05',status:saved?'cancelled':'approved',days:1,source:'manual',raw_person_name:null,notes:'Parent leave target'});
 const unitData=()=>({month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',units:[unit],assignments:[posting()],unit_summaries:[{unit_id:unit.id,assigned_members:1,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[{unit_id:unit.id,call_level:'2ND_CALL',assigned_members:1,minimum_free_people:1,max_allowed:1}],validation_issues:[]});
 page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','profile-parent-independent');localStorage.setItem('duty_rota_working_month','2026-11');});
 await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url()),p=u.pathname;requests.push({method:q.method(),path:p});
  if(q.method()!=='GET'){
   writes.push({method:q.method(),path:p,body:q.postDataJSON()});assert.equal(q.method(),'POST');
   if(p==='/api/v1/normalization/records/units/preview'){assert.equal(q.postDataJSON().identity,'parent-posting');return route.fulfill({json:{review_token:'parent-token',before:posting(),after:q.postDataJSON().values,availability:'Fixture reviewed',duties:[]}});}
   if(p==='/api/v1/normalization/records/units/save'){assert.equal(q.postDataJSON().identity,'parent-posting');assert.equal(q.postDataJSON().review_token,'parent-token');assert.equal(q.postDataJSON().values.notes,'Saved posting notes NEW');saved=true;return route.fulfill({json:posting()});}
   assert.equal(p,'/api/v1/leave/requests/parent-leave/cancel');saved=true;return route.fulfill({json:leave()});
  }
  if(p==='/api/v1/admin/members')return route.fulfill({json:[member]});
  if(p==='/api/v1/normalization/units')return route.fulfill({json:[unit]});
  if(p.startsWith('/api/v1/normalization/catalog/')){const kind=p.split('/').at(-1),key={posting_type:'2ND_CALL',leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',leave_status:'approved'}[kind];return route.fulfill({json:[{key,label:key,active:true}]});}
  if(p==='/api/v1/normalization/records/units/parent-posting')return route.fulfill({json:posting()});
  if(p==='/api/v1/admin/member-workspace/parent-person')return route.fulfill({json:{member,impact:{}}});
  if(p.startsWith('/api/v1/admin/member-workspace/parent-person/')){profileReads++;return route.fulfill({json:{rows:p.endsWith('/postings')?[{...posting(),unit:unit.name}]:p.endsWith('/leave')?[leave()]:[]}});}
  if(p==='/api/v1/unit-management/month'){unitReads++;if(saved&&unitReads===2)return route.fulfill({status:503,json:{detail:'Saved unit parent read unavailable'}});return route.fulfill({json:unitData()});}
  if(p==='/api/v1/leave/requests'){leaveReads++;if(saved&&leaveReads===2)return route.fulfill({status:503,json:{detail:'Saved Leave parent read unavailable'}});return route.fulfill({json:[leave()]});}
  if(p==='/api/v1/leave/calendar')return route.fulfill({json:{month:'2026-11',summary:{month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',total_requests:1,blocking_requests:saved?0:1,people_on_leave:saved?0:1,total_leave_days:saved?0:1,busiest_day:null,status_counts:{},type_counts:{},slot_counts:{},unit_counts:{},call_level_counts:{}},days:{}}});
  if(p==='/api/v1/leave/pressure')return route.fulfill({json:{month:'2026-11',days:[],call_level_totals:{},unit_totals:{}}});
  return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+p+u.search,maxRetries:2})});
 });
 try{
  await page.goto('http://127.0.0.1:5197/#view='+(scenario==='posting-edit'?'units':'leave'),{waitUntil:'domcontentloaded'});
  let parent,readsBefore;
  if(scenario==='posting-edit'){
   await page.locator('input[data-unit-board-search]').fill('Royal');await page.locator('[data-unit-board-card="unit:parent-unit"] button[data-open-unit-modal]').click();
   parent=page.locator('#unit-management-modal');await parent.locator('#unit-minimum-free-people').fill('3');await parent.locator('#unit-settings-form').evaluate(e=>{window.__parentForm=e;window.__parentInput=e.querySelector('#unit-minimum-free-people');});
   await parent.locator('[data-open-member="parent-person"]').click();readsBefore=unitReads;
  }else{
   await page.locator('[data-leave-calendar-view="list"]').click();
   parent=width===320?page.locator('.card-list[aria-label="Leave this month"]:visible'):page.locator('section[aria-labelledby="leave-list-title"]:visible');
   await parent.locator('[data-open-member="parent-person"]').click();readsBefore=leaveReads;
  }
  const profile=page.getByRole('dialog',{name:'Member profile',exact:true});
  if(scenario==='posting-edit'){
   await profile.locator('[data-edit-record="parent-posting"]').click();const editor=page.getByRole('dialog',{name:'Edit posting',exact:true});await editor.locator('[name=notes]').fill('Saved posting notes NEW');await editor.getByRole('button',{name:'Review changes',exact:true}).click();await editor.locator('[data-save]:enabled').click();await editor.waitFor({state:'detached'});
   await profile.getByText('Saved posting notes NEW',{exact:true}).waitFor();
  }else{
   await profile.locator('[data-cancel-profile-leave="parent-leave"]').click();await profile.getByText('Cancelled',{exact:true}).waitFor();
  }
  await profile.locator('[data-close]').first().click();await profile.waitFor({state:'detached'});
  assert.equal(await page.locator('#working-month').inputValue(),'2026-11');assert.deepEqual(errors,[]);
  const retry=page.locator('[data-retry-profile-parent]');
  await page.getByText(/Changes are saved, but this view could not refresh/).waitFor();
  assert.equal(await retry.isVisible(),true);assert.equal(writes.filter(w=>!w.path.endsWith('/preview')).length,1);
  if(scenario==='posting-edit'){assert.match(await parent.locator('[data-unit-row-form="parent-posting"]').innerText(),/Saved posting notes OLD/);assert.equal(await parent.locator('#unit-minimum-free-people').inputValue(),'3');assert.equal(await parent.locator('[data-retry-profile-parent]').count(),1);}
  else{assert.match(await parent.innerText(),/Approved/);assert.equal(await page.locator('[data-leave-calendar-view="list"]').getAttribute('aria-pressed'),'true');}
  await retry.focus();await page.keyboard.press('Enter');
  await page.getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();
  let freshText;
  if(scenario==='posting-edit'){
   freshText=await parent.locator('[data-unit-row-form="parent-posting"]').innerText();assert.match(freshText,/Saved posting notes NEW/);assert.doesNotMatch(freshText,/Saved posting notes OLD/);assert.equal(unitReads,readsBefore+2);
   assert.equal(await parent.locator('#unit-minimum-free-people').inputValue(),'3');assert.equal(await parent.locator('#unit-settings-form').evaluate(e=>e===window.__parentForm&&e.querySelector('#unit-minimum-free-people')===window.__parentInput),true);
   assert.equal(await parent.locator('[data-profile-parent-refresh]').count(),1);await parent.locator('[data-close-unit-modal]').click();assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Royal');
  }else{
   freshText=await parent.innerText();assert.match(freshText,/Cancelled/);assert.doesNotMatch(freshText,/Approved/);assert.equal(leaveReads,readsBefore+2);assert.equal(await page.locator('[data-leave-calendar-view="list"]').getAttribute('aria-pressed'),'true');
  }
  assert.equal(writes.filter(w=>!w.path.endsWith('/preview')).length,1);assert.equal(profileReads,2);assert.deepEqual(errors,[]);
  results.push({engine,width,scenario,parentFreshAfterProfileClose:true,freshText,readsBefore,readsAfterParentRefresh:scenario==='posting-edit'?unitReads:leaveReads,profileReads,selectedMonthRetained:true,unrelatedDraftOrViewRetained:true,deferredOwnedParentRead:true,writes,requests,errors});console.log(width+' '+scenario+' parent fresh after profile close');
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
}
assert.deepEqual(await hashes(),initial);for(const p of candidatePaths)assert.equal(sha(await readFile(p)),candidateHashes[p]);
assert.equal(results.length,2);
await writeFile('../docs/premium-ui/qa-original159-registry-v10r4-integrated-profile-caller-read-failure.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root',decision:'Scratch expected-correct parent refresh workflows, not applied acceptance.',scope:'Two Chromium320/1280 Units profile posting-edit caller regression contexts only; no Leave case executed. Units modalâ†’profile Postings edit and Leave listâ†’profile cancellation refresh profile and deferred current parent after close, retaining unrelated settings fields and selected Leave view. One accepted locally fulfilled mutation each; failed owned read and explicit GET-only retry, no manual navigation. No backend writes/production/permissions certification.',source_sha256:initial,candidate_sha256:candidateHashes,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Profile parent V4 read-failure:12 GET-only recovery contexts');

}
