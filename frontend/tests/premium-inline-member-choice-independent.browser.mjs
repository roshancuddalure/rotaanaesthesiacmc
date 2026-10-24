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
const paths=['src/main.ts','src/member-workspace.ts','src/record-workspace.ts','src/operational-import.ts'],hash=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')]))),start=await hash();
const members=['active','archived'].map((status,i)=>({id:'inline-choice-'+status,canonical_name:'Choice '+status,active_status:status,call_level:'2ND_CALL',revision:'one',aliases:[],designations:[],call_level_changes:[]}));
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of[320,1280]){
  console.log('Inline member choice',engine,width);
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],resolves=[],profileReads=[];let memberReads=0,failNextMembers=false,unexpectedWrites=0;
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','inline-choice-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname==='/api/v1/normalization/members/resolve'){assert.equal(req.method(),'POST');resolves.push(req.postDataJSON());return route.fulfill({json:{candidates:members.map(m=>({id:m.id,name:m.canonical_name,status:m.active_status,call_level:m.call_level,designation:'Registrar'}))}});}
   if(req.method()!=='GET'){unexpectedWrites++;return route.fulfill({status:599,json:{detail:'Unexpected save forbidden'}});}
   if(url.pathname==='/api/v1/admin/members'){memberReads++;if(failNextMembers){failNextMembers=false;return route.fulfill({status:503,json:{detail:'Fixture existing member list refused'}});}return route.fulfill({json:members});}
   if(url.pathname.endsWith('/normalization/units'))return route.fulfill({json:[]});
   if(url.pathname.includes('/normalization/catalog/')){const k={leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',leave_status:'requested'}[url.pathname.split('/').at(-1)];return route.fulfill({json:[{key:k,label:k,active:true}]});}
   if(url.pathname==='/api/v1/admin/member-workspace/inline-choice-archived'){profileReads.push(url.pathname);return route.fulfill({json:{member:members[1],impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});}
   if(url.pathname.includes('/member-workspace/inline-choice-archived/'))return route.fulfill({json:{rows:[]}});
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=leave');await page.locator('[data-add-operational-record=leave]').click();const record=page.locator('dialog.record-workspace');await record.locator('[name=person_id]').waitFor();
  const search=record.locator('[data-member-search]');await search.fill('active');assert.equal(await record.locator('[name=person_id] option[value=inline-choice-active]').evaluate(el=>el.hidden),false);await search.fill('no matching identity');assert.equal(await record.locator('[name=person_id] option[value=inline-choice-active]').evaluate(el=>el.hidden),true);await search.fill('');
  await record.locator('[name=starts_on]').fill('2026-10-25');await record.locator('[name=ends_on]').fill('2026-10-26');await record.locator('[name=notes]').fill('Outer record draft retained');await record.locator('[data-new-member]').focus();await page.keyboard.press('Enter');
  const creator=page.getByRole('dialog',{name:'Create department member',exact:true});await creator.locator('[name=canonical_name]').fill('Choice');await creator.locator('[name=call_level]').focus();await creator.locator('[data-review-existing=inline-choice-archived]').waitFor();assert.deepEqual(resolves.at(-1),{name:'Choice'});
  await creator.locator('[data-review-existing=inline-choice-archived]').focus();await page.keyboard.press('Enter');const profile=page.locator('dialog.member-workspace').filter({has:page.locator('#mw-form')});await profile.getByRole('heading',{name:'Choice archived',exact:true}).waitFor();assert.deepEqual(profileReads,['/api/v1/admin/member-workspace/inline-choice-archived']);assert.equal(await profile.locator('[data-field=active_status]').inputValue(),'active');
  page.once('dialog',d=>d.accept());await profile.locator('[data-close]').first().click();await profile.waitFor({state:'detached'});assert.equal(unexpectedWrites,0);assert.equal(await creator.locator('[name=canonical_name]').inputValue(),'Choice');
  const readsBeforeExisting=memberReads;
  failNextMembers=true;await creator.locator('[data-use-existing=inline-choice-active]').click();await creator.getByRole('alert').filter({hasText:'Fixture existing member list refused'}).waitFor();assert.equal(await creator.locator('[data-use-existing=inline-choice-active]').isEnabled(),true);assert.equal(await creator.locator('[name=canonical_name]').inputValue(),'Choice');
  await creator.locator('[data-use-existing=inline-choice-active]').focus();await page.keyboard.press('Enter');await creator.waitFor({state:'detached'});assert.equal(await record.locator('[name=person_id]').inputValue(),'inline-choice-active');assert.equal(await record.locator('[name=person_id]').evaluate(el=>el===document.activeElement),true);
  assert.equal(await record.locator('[name=starts_on]').inputValue(),'2026-10-25');assert.equal(await record.locator('[name=ends_on]').inputValue(),'2026-10-26');assert.equal(await record.locator('[name=notes]').inputValue(),'Outer record draft retained');assert.equal(memberReads,readsBeforeExisting+2);assert.equal(unexpectedWrites,0);assert.equal(await page.locator('#working-month').inputValue(),'2026-10');assert.deepEqual(errors,[]);
  results.push({engine,width,member_search_hides_unrelated_options:true,new_member_nested_draft_preserved:true,resolve_exact_name_payload:true,archived_review_exact_identity_proposed_active_cancel_no_write:true,use_existing_refusal_retry_exact_active_identity:true,outer_dates_notes_focus_month_retained:true,intercepted_resolves:resolves.length,backend_writes:0});await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hash(),start);
await writeFile('../docs/premium-ui/qa-inline-member-choice-independent.json',JSON.stringify({source_sha256:start,results,contracts:['record-workspace-002','record-workspace-004','operational-import-002','operational-import-003'],scope:'ActualLeaveAddrecordnestedcreator3engines320/1280. ResolvePOSTfullyintercepted,allremainingrequestsGETfixtureonly. Noidentitycreate/restore/saveaccepted;proposedrestorecancel only.'},null,2)+'\n');
console.log('Inline member choice:6 actual-app workflows passed');
