import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),paths=['src/main.ts','src/member-workspace.ts','src/record-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes(),results=[];
assert.equal(initial['frontend/src/main.ts'],'5311e9933a6614747458418a218ac2b22855c2f7baa574e446557a4aa6d9d13d');
const candidatePaths=['../tmp/profile-parent-refresh-v5/main.ts','../tmp/profile-parent-refresh-v5/member-workspace.ts'];
const candidateHashes=Object.fromEntries(await Promise.all(candidatePaths.map(async p=>[p,sha(await readFile(p))])));
assert.equal(candidateHashes[candidatePaths[0]],'2b8f68c069e599af50a4ac1b2146a7018d6268f290b90a9949130a057dc91b43');
const served=await (await fetch('http://127.0.0.1:5293/src/main.ts')).text();
const encoded=served.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(encoded,'Vite inline source map required');
const mapped=JSON.parse(Buffer.from(encoded[1],'base64').toString());assert.equal(sha(Buffer.from(mapped.sourcesContent[0])),candidateHashes[candidatePaths[0]],'Exact scratch main served');

assert.equal(candidateHashes[candidatePaths[1]],'105cc1d91ea4815d565ad4859fc01412cf576a3203c07834f4010e3fef7ef1a5');
const memberResponse=await (await fetch('http://127.0.0.1:5293/src/member-workspace.ts')).text();
const memberMap=memberResponse.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
assert.ok(memberMap,'Member original-source map required');
assert.ok(JSON.parse(Buffer.from(memberMap[1],'base64').toString()).sourcesContent.some(source=>sha(source)===candidateHashes[candidatePaths[1]]),'Exact lifecycle source served');
const member={id:'parent-person',canonical_name:'Dr Parent Audit',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
const unit={id:'parent-unit',name:'Royal Parent Unit',campus:'Main',code:'PARENT',minimum_free_people:1,active_status:'active',notes:null};
const scenarios=['selection-prune-with-sibling','selection-prune-last','duplicate-special-posting-focus'];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit}))for(const width of[320,1280])for(const scenario of scenarios){
 const browser=await launcher.launch(),page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
 const errors=[],writes=[],requests=[];let saved=false,unitReads=0,leaveReads=0,held=false,release;
 const gate=new Promise(resolve=>release=resolve);let signalHeld;const heldStarted=new Promise(resolve=>signalHeld=resolve);
 const special=scenario==='duplicate-special-posting-focus';
 const posting=id=>({id,person:member,person_id:member.id,unit:null,unit_id:null,posting_type:'SICU',starts_on:id==='posting-first'?'2026-11-01':'2026-11-16',ends_on:id==='posting-first'?'2026-11-15':'2026-11-30',source:'manual',notes:id==='posting-first'&&saved?'Saved posting notes NEW':id+' notes'});
 const leave=id=>({id,person:member,person_id:member.id,leave_type:'ANNUAL_LEAVE',type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',slot:'FULL_DAY',starts_on:id==='leave-target'&&saved?'2026-12-05':id==='leave-target'?'2026-11-05':'2026-11-06',ends_on:id==='leave-target'&&saved?'2026-12-05':id==='leave-target'?'2026-11-05':'2026-11-06',status:'approved',days:1,source:'manual',notes:id});
 const currentLeaves=()=>saved?[leave('leave-sibling')]:[leave('leave-target'),leave('leave-sibling')];
 const unitData=()=>({month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',units:[unit],assignments:[posting('posting-first'),posting('posting-second')],unit_summaries:[{unit_id:unit.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[],validation_issues:[]});
 page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','profile-parent-independent');localStorage.setItem('duty_rota_working_month','2026-11');});
 await page.route('**/api/**',async route=>{
  const q=route.request(),u=new URL(q.url()),p=u.pathname;requests.push({method:q.method(),path:p});
  if(q.method()!=='GET'){
   const payload=q.postDataJSON();writes.push({method:q.method(),path:p,body:payload});assert.equal(q.method(),'POST');
   const kind=special?'units':'leave',id=special?'posting-first':'leave-target';
   assert.equal(payload.identity,id);assert.equal(payload.values.person_id,member.id);
   if(p===`/api/v1/normalization/records/${kind}/preview`)return route.fulfill({json:{review_token:'target-review-token',before:special?posting(id):leave(id),after:payload.values,availability:'Fixture reviewed',duties:[]}});
   assert.equal(p,`/api/v1/normalization/records/${kind}/save`);assert.equal(payload.review_token,'target-review-token');
   if(special)assert.equal(payload.values.notes,'Saved posting notes NEW');
   else{assert.equal(payload.values.starts_on,'2026-12-05');assert.equal(payload.values.ends_on,'2026-12-05');}
   assert.equal(saved,false,'Exactly one accepted mutation');saved=true;return route.fulfill({json:special?posting(id):leave(id)});
  }
  if(p==='/api/v1/admin/members')return route.fulfill({json:[member]});
  if(p==='/api/v1/normalization/units')return route.fulfill({json:[unit]});
  if(p.startsWith('/api/v1/normalization/catalog/')){const kind=p.split('/').at(-1),key={posting_type:special?'SICU':'2ND_CALL',leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',leave_status:'approved'}[kind];return route.fulfill({json:[{key,label:key,active:true}]});}
  if(p==='/api/v1/normalization/records/units/posting-first')return route.fulfill({json:posting('posting-first')});
  if(p==='/api/v1/normalization/records/leave/leave-target')return route.fulfill({json:leave('leave-target')});
  if(p==='/api/v1/admin/member-workspace/parent-person')return route.fulfill({json:{member,impact:{}}});
  if(p.startsWith('/api/v1/admin/member-workspace/parent-person/'))return route.fulfill({json:{rows:p.endsWith('/postings')?[posting('posting-first'),posting('posting-second')]:p.endsWith('/leave')?[leave('leave-target'),leave('leave-sibling')]:[]}});
  if(p==='/api/v1/unit-management/month'){
   unitReads++;if(saved&&special){held=true;signalHeld();await gate;}return route.fulfill({json:unitData()});
  }
  if(p==='/api/v1/leave/requests'){leaveReads++;return route.fulfill({json:currentLeaves()});}
  if(p==='/api/v1/leave/calendar')return route.fulfill({json:{month:'2026-11',summary:{month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',total_requests:currentLeaves().length,people_on_leave:1,total_leave_days:currentLeaves().length,busiest_day:null,status_counts:{},type_counts:{},slot_counts:{},unit_counts:{},call_level_counts:{}},days:{}}});
  if(p==='/api/v1/leave/pressure')return route.fulfill({json:{month:'2026-11',days:[],call_level_totals:{},unit_totals:{}}});
  return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+p+u.search,maxRetries:2})});
 });
 try{
  await page.goto('http://127.0.0.1:5293/#view='+(special?'units':'leave'),{waitUntil:'domcontentloaded'});
  let parent,readBefore,desktopButton;
  if(special){
   await page.locator('button[data-open-special-unit-modal="SICU"]').first().click();parent=page.locator('#unit-management-modal');
   assert.equal(await parent.locator('[data-unit-row-form]').count(),2);
   await parent.locator('[data-unit-row-form="posting-first"] [data-open-member]').click();readBefore=unitReads;
  }else{
   parent=width===320?page.locator('.card-list[aria-label="Leave this month"]:visible'):page.locator('section[aria-labelledby="leave-list-title"]:visible');
   await parent.locator('[data-admin-select="leave"][value="leave-target"]').check();
   if(scenario==='selection-prune-with-sibling')await parent.locator('[data-admin-select="leave"][value="leave-sibling"]').check();
   desktopButton=page.locator('section[aria-labelledby="leave-list-title"] [data-delete-selected="leave"]');
   await desktopButton.evaluate(e=>window.__retainedDesktopDelete=e);
   await parent.locator('[data-open-member="parent-person"]').first().click();readBefore=leaveReads;
  }
  const profile=page.getByRole('dialog',{name:'Member profile',exact:true});
  await profile.locator(`[data-edit-record="${special?'posting-first':'leave-target'}"]`).click();
  const editor=page.getByRole('dialog',{name:special?'Edit posting':'Edit leave',exact:true});
  if(special)await editor.locator('[name=notes]').fill('Saved posting notes NEW');
  else{await editor.locator('[name=starts_on]').fill('2026-12-05');await editor.locator('[name=ends_on]').fill('2026-12-05');}
  await editor.getByRole('button',{name:'Review changes',exact:true}).click();await editor.locator('[data-save]:enabled').click();await editor.waitFor({state:'detached'});
  // The record remains in complete profile history; only its parent's monthly intersection changes.
  if(special)await profile.getByText('Saved posting notes NEW',{exact:true}).waitFor();
  else await profile.locator('[data-edit-record="leave-target"]').waitFor();
  await profile.locator('[data-close]').first().click();await profile.waitFor({state:'detached'});
  let evidence;
  if(special){
   await heldStarted;assert.equal(held,true);assert.equal(unitReads,readBefore+1);
   // A real focus action in the visible parent while its GET is held. The first
   // and second links intentionally share person/tab attributes; record IDs differ.
   const second=parent.locator('[data-unit-row-form="posting-second"] [data-open-member]');await second.focus();
   assert.equal(await second.evaluate(e=>e===document.activeElement),true);
   release();await page.getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();
   assert.equal(await parent.locator('[data-unit-row-form="posting-second"] [data-open-member]').evaluate(e=>e===document.activeElement),true,'Restore within same immutable record, not the first duplicate member link');
   assert.equal(await parent.locator('[data-unit-row-form="posting-first"] [data-open-member]').evaluate(e=>e===document.activeElement),false);
   assert.match(await parent.locator('[data-unit-row-form="posting-first"]').innerText(),/Saved posting notes NEW/);
   evidence={heldRead:true,focusedRecordBefore:'posting-second',focusedRecordAfter:await page.evaluate(()=>document.activeElement.closest('[data-unit-row-form]')?.dataset.unitRowForm),duplicatePerson:member.id,distinctRecordIds:['posting-first','posting-second'],parentReads:unitReads-readBefore};
  }else{
   await page.getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();
   const remaining=scenario==='selection-prune-with-sibling'?1:0;
   assert.equal(await desktopButton.evaluate(e=>e===window.__retainedDesktopDelete),true,'Keep original desktop control node');
   assert.equal(await desktopButton.textContent(),`Delete selected (${remaining})`);assert.equal(await desktopButton.isDisabled(),remaining===0);
   assert.equal(await parent.locator('[data-admin-select="leave"][value="leave-target"]').count(),0);
   assert.equal(await parent.locator('[data-admin-select="leave"][value="leave-sibling"]').isChecked(),remaining===1);
   const mobileButton=page.locator('.card-list[aria-label="Leave this month"] [data-delete-selected="leave"]');
   assert.equal(await mobileButton.textContent(),`Delete selected (${remaining})`);assert.equal(await mobileButton.isDisabled(),remaining===0);
   assert.equal(leaveReads,readBefore+1);assert.equal(await page.locator('#working-month').inputValue(),'2026-11');
   evidence={selectedRecordMovedTo:'2026-12',parentMonth:'2026-11',desktopControlRetained:true,desktopCount:remaining,mobileCount:remaining,unrelatedSelectionRetained:remaining===1,parentReads:leaveReads-readBefore};
  }
  assert.equal(writes.filter(w=>w.path.endsWith('/save')).length,1);assert.equal(writes.length,2,'One review and one save, no replay or delete');assert.deepEqual(errors,[]);
  results.push({engine,width,scenario,evidence,writes,requests,errors});console.log(`${engine} ${width} ${scenario} passed`);
 }finally{release();await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
}
assert.equal(results.length,18);assert.deepEqual(await hashes(),initial);for(const p of candidatePaths)assert.equal(sha(await readFile(p)),candidateHashes[p]);
await writeFile('../docs/premium-ui/qa-profile-parent-refresh-v5-selection-focus.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/profile_parent_final_audit',decision:'Scratch targeted selection and duplicate-record focus regressions only.',scope:'18 actual browser contexts if terminal success: three engines,320/1280, selected record edited out of month with retained sibling or final selection removed, and held special-posting parent read with a focused second same-member record. All mutations locally fulfilled. No real database writes or whole-item acceptance.',source_sha256:initial,candidate_sha256:candidateHashes,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');
console.log('Profile V4 selection/focus18 contexts passed');
