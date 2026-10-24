import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base='http://127.0.0.1:5197',api='http://127.0.0.1:8031';
const before=createHash('sha256').update(await readFile('src/main.ts')).digest('hex'),results=[];
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],months=['2026-10'];
const people=Array.from({length:31},(_,i)=>({person_id:'context-person-'+i,name:'Context Person '+String(i).padStart(2,'0'),total_24hr:i+1,total_weekend_24hr:1,total_weekday_24hr:i,main_24hr:i,cb_24hr:0,rc_24hr:0,schell:0,floating:0,fifth_call:0,fifth_call_weekend:0,caesar_b:0,cart:0,caesar_a:0,pac:0,shift:0,main_shift:0,rc_shift:0,pb_shift:0,rc12hr:0,cb_co12hr:0,chad:0,ruhsa:0,neuro_dept:0,day_breakdown:{Monday:i+1},monthly_24hr:{'2026-10':i+1},fifth_call_monthly:{},fifth_call_days:{},pain_months:[],sicu_months:[],drp_months:[],neuro_icu_months:[],call_levels:{},units:{},promotions:[],months_active:months}));
const dashboard={summary:{personnel:31,active_personnel:31,total_records:496,total_24hr:496,total_weekend_24hr:31,weekend_percent:6,months:1,avg_24hr_per_active_person:16},months,month_labels:{'2026-10':'October 2026'},month_stats:{'2026-10':{total:496,total_24hr:496,weekend_24hr:31,persons:31,duty_type_counts:{}}},days,duty_category_totals:{MAIN:496},people};
const units=['Alpha','Beta','Gamma'].map((name,i)=>({id:'context-unit-'+i,name:name+' Context Unit',campus:'Main',code:name.toUpperCase(),minimum_free_people:1,active_status:'active',notes:null}));
const unitData={month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units,assignments:[],unit_summaries:units.map(u=>({unit_id:u.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]};
units.forEach((u,i)=>u.minimum_free_people=i+1);
unitData.assignments=units.map((unit,i)=>({id:'context-posting-'+i,person:{id:'context-posted-'+i,canonical_name:'Posted '+unit.name,call_level:'2ND_CALL',active_status:'active'},unit,posting_type:'2ND_CALL',starts_on:'2026-10-01',ends_on:'2026-10-31',source:'manual',notes:'Unit-specific row '+i}));
unitData.unit_summaries.forEach((s,i)=>{s.assigned_members=i+1;s.people_with_leave=i;s.leave_days=i*2;});
const paths=['src/main.ts','src/member-workspace.ts','src/record-workspace.ts'],hash=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')]))),start=await hash();
const members=people.map(p=>({id:p.person_id,canonical_name:p.name,active_status:'active',call_level:'2ND_CALL',revision:'one',aliases:[],designations:[],call_level_changes:[]}));
const leave={id:'linked-leave',person_id:'context-person-30',starts_on:'2026-10-12',ends_on:'2026-10-14',leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',status:'approved',notes:'Linked leave target note'};
for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of [320,1280]){
  console.log('Member linked actions',engine,width);
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],requests=[];let cancellationPosts=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','member-linked-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());requests.push({method:req.method(),path:url.pathname,body:req.postData()});
   if(req.method()==='POST'&&url.pathname==='/api/v1/leave/requests/linked-leave/cancel'){cancellationPosts++;return route.fulfill({status:503,json:{detail:'Fixture leave cancellation refused'}});}
   assert.equal(req.method(),'GET','All other mutations forbidden');
   if(url.pathname.endsWith('/analysis/dashboard'))return route.fulfill({json:dashboard});
   if(url.pathname==='/api/v1/admin/members')return route.fulfill({json:members});
   if(url.pathname.endsWith('/normalization/units'))return route.fulfill({json:units});
   if(url.pathname.includes('/normalization/catalog/')){const kind=url.pathname.split('/').at(-1),key={posting_type:'2ND_CALL',leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',leave_status:'approved'}[kind];return route.fulfill({json:[{key,label:key,active:true}]});}
   if(url.pathname==='/api/v1/normalization/records/leave/linked-leave')return route.fulfill({json:leave});
   const match=url.pathname.match(/\/admin\/member-workspace\/(context-person-\d+)(?:\/(.*))?$/);
   if(match){const member=members.find(m=>m.id===match[1]);assert.ok(member,'Exact navigated member exists');if(match[2])return route.fulfill({json:{rows:match[2]==='leave'?[leave]:[]}});return route.fulfill({json:{member,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});}
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=analysis');await page.locator('[data-analysis-tab=personnel]').click();await page.locator('[data-analysis-person="Context Person 30"]').filter({visible:true}).first().click();
  const dialog=page.locator('dialog.member-workspace').filter({has:page.locator('#mw-form')});await dialog.getByRole('tab',{name:'Postings',exact:true}).click();
  await dialog.getByRole('button',{name:'Add Posting',exact:true}).focus();await page.keyboard.press('Enter');
  const editor=page.locator('dialog.record-workspace');await editor.locator('[name=person_id]').waitFor();
  assert.equal(await editor.locator('[name=person_id]').inputValue(),'context-person-30');assert.equal(await editor.getByRole('heading',{name:'Add posting',exact:true}).count(),1);
  await editor.getByRole('button',{name:'Close editor',exact:true}).click();await editor.waitFor({state:'detached'});
  assert.equal(await dialog.getByRole('button',{name:'Add Posting',exact:true}).evaluate(el=>el===document.activeElement),true);
  await dialog.getByRole('tab',{name:'Leave',exact:true}).click();await dialog.locator('[data-edit-record=linked-leave]').focus();await page.keyboard.press('Enter');await editor.locator('[name=starts_on]').waitFor();
  for(const [field,val] of Object.entries(leave).filter(([field])=>['person_id','starts_on','ends_on','leave_type','leave_slot','status','notes'].includes(field)))assert.equal(await editor.locator(`[name=${field}]`).inputValue(),val);
  assert.ok(requests.some(r=>r.path==='/api/v1/normalization/records/leave/linked-leave'));
  await editor.getByRole('button',{name:'Close editor',exact:true}).click();await editor.waitFor({state:'detached'});
  assert.equal(await dialog.locator('[data-edit-record=linked-leave]').evaluate(el=>el===document.activeElement),true);
  page.once('dialog',async d=>{assert.equal(d.type(),'confirm');assert.match(d.message(),/Existing duties remain assigned/);await d.dismiss();});
  await dialog.locator('[data-cancel-profile-leave=linked-leave]').click();assert.equal(cancellationPosts,0);
  page.once('dialog',d=>d.accept());await dialog.locator('[data-cancel-profile-leave=linked-leave]').click();
  await dialog.getByRole('alert').filter({hasText:'Fixture leave cancellation refused'}).waitFor();assert.equal(cancellationPosts,1);
  const leaveReadsBeforeRetry=requests.filter(r=>r.path==='/api/v1/admin/member-workspace/context-person-30/leave').length;
  await dialog.getByRole('button',{name:'Retry',exact:true}).focus();await page.keyboard.press('Enter');await dialog.locator('[data-cancel-profile-leave=linked-leave]').waitFor();assert.equal(cancellationPosts,1,'Read retry cannot repeat refused cancellation');
  assert.equal(requests.filter(r=>r.path==='/api/v1/admin/member-workspace/context-person-30/leave').length,leaveReadsBeforeRetry+1,'Explicit cancellation recovery performs exactly one fresh leave GET');
  assert.match(await dialog.innerText(),/Linked leave target note/);
  // Actual analytics person list is in source order0..30; Previous from30 reaches29 and Next reverses.
  await dialog.locator('[data-edit]').click();await dialog.getByRole('tab',{name:'Details',exact:true}).click();await dialog.locator('[data-field=canonical_name]').fill('Dirty linked member draft');
  const beforeReads=requests.filter(r=>r.path==='/api/v1/admin/member-workspace/context-person-29').length;
  page.once('dialog',d=>d.dismiss());await dialog.locator('[data-prev]').click();assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),'Dirty linked member draft');assert.equal(requests.filter(r=>r.path==='/api/v1/admin/member-workspace/context-person-29').length,beforeReads);
  page.once('dialog',d=>d.accept());await dialog.locator('[data-prev]').focus();await page.keyboard.press('Enter');
  await dialog.getByRole('heading',{name:'Context Person 29',exact:true}).waitFor();assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),'Context Person 29');
  await dialog.locator('[data-next]').click();await dialog.getByRole('heading',{name:'Context Person 30',exact:true}).waitFor();assert.equal(await dialog.locator('[data-next]').isDisabled(),true);
  assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),'Context Person 30');assert.equal(await page.locator('#working-month').inputValue(),'2026-10');
  assert.equal(cancellationPosts,1);assert.deepEqual(errors,[]);
  results.push({engine,width,add_posting_exact_member_no_mutation:true,edit_leave_exact_record_and_fields:true,nested_close_restores_action_focus:true,cancel_leave_dismiss_no_request:true,refused_cancellation_manual_read_retry_only:true,dirty_previous_reject_retains_no_read:true,accepted_previous_next_exact_member_boundary:true,month_retained:true,intercepted_refused_mutations:1,backend_writes:0});await page.close();
 }}finally{await browser.close();}
}
const end=await hash(),sourceChanges=Object.keys(start).filter(path=>start[path]!==end[path]);
await writeFile('../docs/premium-ui/qa-member-linked-actions-independent.json',JSON.stringify({source_sha256:start,source_sha256_end:end,source_changes_during_run:sourceChanges,source_frozen:sourceChanges.length===0,results,contracts:['member-workspace-007','member-workspace-021','member-workspace-022'],scope:'Actual analytics→member→nested record editor;3engines320/1280. All mutation requests intercepted (one503cancel/case),allotherrequestsGETfixtureonly. Nested editor keyboard-entryfocus verified; WebKitpointerclickdoesnotnecessarilyfocusopener. No accepted cancellation/save/persistence certification.'},null,2)+'\n');
assert.deepEqual(sourceChanges,[],'Source changed during run; outcomes preserved with start/end hashes but snapshot needs rerun');
console.log('Member linked actions:6 actual-app bounded workflows passed');
