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
const paths=['src/main.ts','src/member-workspace.ts'],hash=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')]))),start=await hash();
const initial={id:'context-person-30',canonical_name:'Context Person 30',active_status:'active',call_level:'2ND_CALL',revision:'original-one',aliases:[{id:'alias-one',alias:'Existing spelling',source:'manual'}],designations:[{id:'designation-one',designation:'Registrar',effective_from:'2026-01-01',effective_to:null,source:'manual',notes:'Original position note'}],call_level_changes:[]};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of[320,1280]){
  console.log('Canonical save',engine,width);
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],puts=[];let saved=structuredClone(initial),gets=0;
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','canonical-save-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname==='/api/v1/admin/member-workspace/context-person-30'){
    if(req.method()==='PUT'){puts.push(req.postDataJSON());if(puts.length===1)return route.fulfill({status:503,json:{detail:'Fixture canonical save refused'}});const body=puts.at(-1);saved={...body,aliases:body.aliases.map((alias,i)=>({id:'saved-alias-'+i,alias,source:'manual'})),revision:'saved-two'};delete saved.preserve_previous_name;return route.fulfill({json:saved});}
    assert.equal(req.method(),'GET');gets++;return route.fulfill({json:{member:saved,impact:{future_duties:2,current_or_future_postings:3,eligibility_memberships:1}}});
   }
   assert.equal(req.method(),'GET','Unmocked writes forbidden');
   if(url.pathname.endsWith('/analysis/dashboard'))return route.fulfill({json:dashboard});
   if(url.pathname.includes('/admin/member-workspace/context-person-30/'))return route.fulfill({json:{rows:[]}});
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=analysis');await page.locator('[data-analysis-tab=personnel]').click();const opener=page.locator('[data-analysis-person="Context Person 30"]').filter({visible:true}).first();await opener.click();
  const dialog=page.locator('dialog.member-workspace');await dialog.locator('[data-edit]').click();await dialog.getByRole('tab',{name:'Details',exact:true}).click();
  assert.equal(await dialog.locator('[data-field=canonical_name]').isEditable(),true);assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),initial.canonical_name);
  await dialog.locator('[data-field=canonical_name]').fill('Cancelled draft name');page.once('dialog',d=>d.dismiss());await dialog.locator('[data-cancel-edit]').click();assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),'Cancelled draft name');assert.equal(puts.length,0);
  page.once('dialog',d=>d.accept());await dialog.locator('[data-cancel-edit]').focus();await page.keyboard.press('Enter');assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),initial.canonical_name);assert.equal(await dialog.locator('[data-field=canonical_name]').isEditable(),false);assert.equal(puts.length,0);
  await dialog.locator('[data-edit]').click();await dialog.locator('[data-field=canonical_name]').fill('Updated Canonical Member');await dialog.locator('[data-field=active_status]').selectOption('historical');await dialog.locator('[data-field=call_level]').selectOption('3RD_CALL');
  await dialog.getByRole('tab',{name:'Roles & eligibility',exact:true}).click();await dialog.locator('[data-d="0"][data-key=designation]').fill('Senior Registrar');await dialog.locator('[data-d="0"][data-key=notes]').fill('Reviewed position note');
  await dialog.getByRole('tab',{name:'Details',exact:true}).click();assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),'Updated Canonical Member');
  page.once('dialog',async d=>{assert.match(d.message(),/Change membership to historical/);assert.match(d.message(),/2 future duties, 3 postings and 1 memberships/);await d.dismiss();});await dialog.getByRole('button',{name:'Save changes',exact:true}).click();assert.equal(puts.length,0);
  page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Save changes',exact:true}).focus();await page.keyboard.press('Enter');await dialog.getByRole('alert').filter({hasText:'Fixture canonical save refused'}).waitFor();
  assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),'Updated Canonical Member');assert.equal(await dialog.locator('[data-field=active_status]').inputValue(),'historical');assert.equal(await dialog.getByRole('button',{name:'Save changes',exact:true}).isEnabled(),true);
  const expected={...initial,canonical_name:'Updated Canonical Member',active_status:'historical',call_level:'3RD_CALL',aliases:['Existing spelling'],designations:[{...initial.designations[0],designation:'Senior Registrar',notes:'Reviewed position note'}],preserve_previous_name:true};assert.deepEqual(puts[0],expected);
  page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await dialog.locator('[data-edit]').waitFor();assert.deepEqual(puts,[expected,expected]);
  await dialog.locator('[data-close]').first().click();await dialog.waitFor({state:'detached'});await opener.click();await dialog.getByRole('heading',{name:'Updated Canonical Member',exact:true}).waitFor();await dialog.getByRole('tab',{name:'Details',exact:true}).click();assert.equal(gets,2);
  assert.equal(await dialog.locator('[data-field=active_status]').inputValue(),'historical');assert.equal(await dialog.locator('[data-field=call_level]').inputValue(),'3RD_CALL');await dialog.getByRole('tab',{name:'Roles & eligibility',exact:true}).click();await dialog.getByText('Senior Registrar',{exact:true}).waitFor();await dialog.getByText('Reviewed position note',{exact:true}).waitFor();
  await dialog.locator('[data-edit]').click();await dialog.getByRole('tab',{name:'Details',exact:true}).click();await dialog.locator('[data-field=canonical_name]').fill('Twice Updated Canonical Member');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await dialog.locator('[data-edit]').waitFor();assert.equal(puts.length,3);assert.equal(puts[2].id,initial.id);assert.equal(puts[2].revision,'saved-two');assert.equal(puts[2].canonical_name,'Twice Updated Canonical Member');
  await dialog.locator('[data-close]').first().click();await dialog.waitFor({state:'detached'});await opener.focus();await page.keyboard.press('Enter');await dialog.getByRole('heading',{name:'Twice Updated Canonical Member',exact:true}).waitFor();assert.equal(gets,3);
  assert.equal(await dialog.locator('[data-next]').isDisabled(),true,'Preserved immutable analytical navigation list retains last-member boundary');assert.equal(await dialog.locator('[data-prev]').isEnabled(),true);
  assert.equal(await page.locator('#working-month').inputValue(),'2026-10');assert.deepEqual(errors,[]);results.push({engine,width,edit_existing_values_enabled:true,dirty_cancel_reject_retains_accept_resets:true,membership_confirm_cancel_no_write:true,cross_tab_fields_preserved:true,refusal_preserves_draft_manual_retry_exact_payload:true,reopen_independent_get_saved_identity_status_call_position:true,repeated_mutation_reopen_keeps_exact_identity_navigation:true,intercepted_puts:3,backend_writes:0});await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hash(),start);
await writeFile('../docs/premium-ui/qa-member-save-independent.json',JSON.stringify({source_sha256:start,results,contracts:['member-workspace-002','member-workspace-003','member-workspace-010','member-workspace-015'],scope:'Canonicalmemberactualanalyticsentry3engines320/1280;fullPUTpayload intercepted503/retry andindependentfixtureGETreopen. No realmemberpersistence/permission/schedulingchange certification.'},null,2)+'\n');
console.log('Canonical member save:6 workflows passed');
