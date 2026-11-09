import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),paths=['src/main.ts','src/member-workspace.ts','src/record-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes(),results=[];
assert.equal(initial['frontend/src/main.ts'],'d13bd73108d89d6efb70a66426e6f8e9f6e50400475575b7a40cb06eef12c1bc');
const member={id:'parent-person',canonical_name:'Dr Parent Audit',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
const unit={id:'parent-unit',name:'Royal Parent Unit',campus:'Main',code:'PARENT',minimum_free_people:1,active_status:'active',notes:null};
for(const width of[320,1280])for(const scenario of['posting-edit','leave-cancel']){
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],requests=[],writes=[];let saved=false,unitReads=0,leaveReads=0,profileReads=0;
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
   parent=page.locator('#unit-management-modal');await parent.locator('#unit-minimum-free-people').fill('3');await parent.locator('[data-unit-row-form="parent-posting"]').evaluate(e=>window.__parentRow=e);
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
  let staleText;
  if(scenario==='posting-edit'){
   staleText=await parent.locator('[data-unit-row-form="parent-posting"]').innerText();assert.match(staleText,/Saved posting notes OLD/);assert.doesNotMatch(staleText,/Saved posting notes NEW/);assert.equal(unitReads,readsBefore);
   assert.equal(await parent.locator('#unit-minimum-free-people').inputValue(),'3');assert.equal(await parent.locator('[data-unit-row-form="parent-posting"]').evaluate(e=>e===window.__parentRow),true);
   await parent.locator('[data-close-unit-modal]').click();assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Royal');
   await page.locator('[data-refresh-unit-board]').click();await page.locator('[data-unit-board-card="unit:parent-unit"] button[data-open-unit-modal]').click();await page.locator('#unit-management-modal').getByText('Saved posting notes NEW',{exact:true}).waitFor();assert.equal(unitReads,readsBefore+1);
  }else{
   staleText=await parent.innerText();assert.match(staleText,/Approved/);assert.doesNotMatch(staleText,/Cancelled/);assert.equal(leaveReads,readsBefore);assert.equal(await page.locator('[data-leave-calendar-view="list"]').getAttribute('aria-pressed'),'true');
   await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();await page.evaluate(()=>location.hash='#view=leave');
   await page.waitForFunction(()=>[...document.querySelectorAll('.leave-card,tr')].some(e=>e.textContent?.includes('Dr Parent Audit')&&e.textContent?.includes('Cancelled')));assert.equal(leaveReads,readsBefore+1);
  }
  assert.equal(writes.filter(w=>!w.path.endsWith('/preview')).length,1);assert.equal(profileReads,2);assert.deepEqual(errors,[]);
  results.push({engine:'chromium',width,scenario,parentStaleAfterProfileClose:true,staleText,readsBefore,readsAfterExplicitRefresh:scenario==='posting-edit'?unitReads:leaveReads,profileReads,selectedMonthRetained:true,unrelatedDraftOrViewRetained:true,explicitReadRecovers:true,writes,requests,errors});console.log(width+' '+scenario+' stale parent reproduced; explicit GET recovers');
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-profile-parent-refresh-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/profile_parent_refresh_audit',decision:'Diagnostic reproduction; not passing product behavior or whole159 acceptance.',scope:'Four actual app Chromium320/1280 workflows. Units modal→profile Postings edit and Leave list→profile cancellation refresh profile rows but leave underlying current route DOM stale. One accepted locally fulfilled mutation each; explicit parent refresh/navigation recovers via GET only. No backend writes/production/permissions certification.',source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Profile parent refresh diagnostics:4 reproductions');
