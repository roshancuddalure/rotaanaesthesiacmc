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
const paths=['src/main.ts','src/member-workspace.ts','src/record-workspace.ts','src/reference-workspace.ts'],hash=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')]))),start=await hash();
const member={id:'unit-record-member',canonical_name:'Unit Record Member',active_status:'active',call_level:'2ND_CALL',revision:'one',aliases:[],designations:[]};
const created={id:'record-new-unit',name:'New Record Unit',campus:'Ranipet',code:'NEW_RECORD',minimum_free_people:1,aliases:[],notes:'',active_status:'active',call_minimums:[],revision:'created-one',usage:{postings:0,duties:0,future_postings:0,future_duties:0,selected_members:0}};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of[320,1280]){
  console.log('Record new unit',engine,width);
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],posts=[];let unexpectedWrites=0;
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','record-newunit-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname==='/api/v1/normalization/units'&&req.method()==='POST'){posts.push(req.postDataJSON());return route.fulfill(posts.length===1?{status:503,json:{detail:'Fixture new unit unavailable'}}:{json:created});}
   if(req.method()!=='GET'){unexpectedWrites++;return route.fulfill({status:599,json:{detail:'Unexpected posting mutation forbidden'}});}
   if(url.pathname==='/api/v1/admin/members')return route.fulfill({json:[member]});
   if(url.pathname.endsWith('/normalization/units/suggest-code'))return route.fulfill({json:{code:'NEW_RECORD'}});
   if(url.pathname.endsWith('/normalization/units'))return route.fulfill({json:[]});
   if(url.pathname.endsWith('/catalog/posting_type'))return route.fulfill({json:[{key:'2ND_CALL',label:'Second call',active:true},{key:'3RD_CALL',label:'Third call',active:true}]});
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=units');await page.locator('[data-add-operational-record=units]').click();const record=page.locator('dialog.record-workspace');await record.locator('[name=person_id]').selectOption(member.id);await record.locator('[name=posting_type]').selectOption('3RD_CALL');await record.locator('[name=starts_on]').fill('2026-10-25');await record.locator('[name=ends_on]').fill('2026-10-31');await record.locator('[name=notes]').fill('Outer posting retained');
  await record.locator('[data-new-unit]').focus();await page.keyboard.press('Enter');const registry=page.locator('dialog.reference-workspace');await registry.locator('[name=name]').fill('Discarded unit draft');
  page.once('dialog',d=>d.dismiss());await registry.locator('[data-new]').click();assert.equal(await registry.locator('[name=name]').inputValue(),'Discarded unit draft');assert.equal(posts.length,0);
  page.once('dialog',d=>d.accept());await registry.locator('[data-new]').focus();await page.keyboard.press('Enter');assert.equal(await registry.locator('[name=name]').inputValue(),'');assert.equal(await registry.locator('[name=name]').evaluate(el=>el===document.activeElement),true);
  await registry.locator('[name=name]').fill(created.name);await registry.locator('[name=campus]').fill(created.campus);await registry.locator('[name=code]').fill(created.code);
  await registry.getByRole('button',{name:'Create unit',exact:true}).click();await registry.getByRole('alert').filter({hasText:'Fixture new unit unavailable'}).waitFor();assert.equal(await registry.locator('[name=name]').inputValue(),created.name);assert.equal(await registry.locator('[name=campus]').inputValue(),created.campus);assert.equal(await registry.locator('[name=code]').inputValue(),created.code);assert.equal(await registry.getByRole('button',{name:'Create unit',exact:true}).isEnabled(),true);
  const expected={name:created.name,campus:created.campus,code:created.code,minimum_free_people:1,aliases:[],notes:'',active_status:'active',call_minimums:[]};assert.deepEqual(posts,[expected]);
  await registry.getByRole('button',{name:'Create unit',exact:true}).focus();await page.keyboard.press('Enter');await registry.waitFor({state:'detached'});assert.deepEqual(posts,[expected,expected]);
  assert.equal(await record.locator('[name=unit_id]').inputValue(),created.id);assert.equal(await record.locator('[name=unit_id]').evaluate(el=>el===document.activeElement),true);assert.equal(await record.locator('[name=posting_type]').inputValue(),'3RD_CALL');assert.equal(await record.locator('[name=person_id]').inputValue(),member.id);assert.equal(await record.locator('[name=starts_on]').inputValue(),'2026-10-25');assert.equal(await record.locator('[name=ends_on]').inputValue(),'2026-10-31');assert.equal(await record.locator('[name=notes]').inputValue(),'Outer posting retained');assert.equal(await page.locator('#working-month').inputValue(),'2026-10');assert.equal(unexpectedWrites,0);assert.deepEqual(errors,[]);
  page.once('dialog',d=>d.accept());await record.getByRole('button',{name:'Close editor',exact:true}).click();await record.waitFor({state:'detached'});
  results.push({engine,width,new_unit_nested_exact_context:true,add_unit_reset_discard_reject_accept:true,unit_fields_refusal_retained_manual_retry_exact_payload:true,created_unit_selected_and_focus:true,outer_member_dates_posting_type_notes_month_preserved:true,intercepted_unit_posts:2,posting_mutations:0,backend_writes:0});await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hash(),start);
await writeFile('../docs/premium-ui/qa-record-new-unit-independent.json',JSON.stringify({source_sha256:start,results,contracts:['record-workspace-005','record-workspace-007','reference-workspace-021','reference-workspace-023'],scope:'ActualUnitsAddposting→Newunit3engines320/1280. UnitcreatePOSTfullyintercepted503/manualretry;allremainingGETfixtureonly,no postingapply/backendpersistence.'},null,2)+'\n');
console.log('Record new unit:6 actual-app workflows passed');
