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
const survivor={id:'context-person-30',canonical_name:'Context Person 30',active_status:'active',call_level:'2ND_CALL',revision:'target-one',aliases:[{id:'alias-one',alias:'Surviving spelling',source:'manual'}],designations:[],call_level_changes:[]};
const other={id:'duplicate-source',canonical_name:'Context Person Thirty',active_status:'historical',call_level:'3RD_CALL',revision:'source-one',aliases:[{id:'alias-two',alias:'Other spelling',source:'import'}],designations:[{id:'position-two',designation:'Registrar',effective_from:'2026-01-01',effective_to:'2026-06-30',source:'manual',notes:'Source designation note'}],call_level_changes:[{id:'call-two',call_level:'4TH_CALL',effective_from:'2026-11-01'}]};
for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of [320,1280]){
  console.log('Member duplicate entry',engine,width);
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];let failProfile=true,failDuplicates=true,profileReads=0,duplicateReads=0,writes=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','duplicate-entry-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()!=='GET'){writes++;return route.fulfill({status:500,json:{detail:'Mutation forbidden in cancel test'}});}
   if(url.pathname.endsWith('/analysis/dashboard'))return route.fulfill({json:dashboard});
   if(url.pathname.endsWith('/admin/member-workspace/context-person-30')){profileReads++;return route.fulfill(failProfile?{status:503,json:{detail:'Fixture profile unavailable <img src=x>'}}:{json:{member:survivor,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});}
   if(url.pathname.endsWith('/context-person-30/duplicates')){duplicateReads++;return route.fulfill(failDuplicates?{status:503,json:{detail:'Fixture duplicate check unavailable'}}:{json:{rows:[{id:other.id,name:other.canonical_name,status:other.active_status,call_level:other.call_level,revision:other.revision,duties:8,postings:2,leave:3,memberships:1,designations:['Registrar'],member:other}]}});}
   if(url.pathname.includes('/admin/member-workspace/context-person-30/'))return route.fulfill({json:{rows:[]}});
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=analysis');await page.locator('[data-analysis-tab=personnel]').click();
  const opener=page.locator('[data-analysis-person="Context Person 30"]').filter({visible:true}).first();await opener.focus();await page.keyboard.press('Enter');
  const dialog=page.locator('dialog.member-workspace');await dialog.getByRole('alert').filter({hasText:'Fixture profile unavailable <img src=x>'}).waitFor();
  assert.equal(await dialog.locator('img').count(),0);const dismiss=dialog.locator('[data-dismiss]');assert.equal(await dismiss.isEnabled(),true);
  await dismiss.focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'detached'});assert.equal(await opener.evaluate(el=>el===document.activeElement),true);
  failProfile=false;await opener.click();await dialog.getByRole('tab',{name:'Names & duplicates',exact:true}).click();
  await dialog.getByRole('alert').filter({hasText:'Fixture duplicate check unavailable'}).waitFor();
  assert.equal(duplicateReads,1);const retry=dialog.locator('[data-retry-duplicates]');assert.equal(await retry.isEnabled(),true);
  failDuplicates=false;await retry.focus();await page.keyboard.press('Enter');
  await dialog.getByText(other.canonical_name,{exact:true}).waitFor();assert.equal(duplicateReads,2);
  const comparison=dialog.getByText('Compare profile details',{exact:true});await comparison.focus();await page.keyboard.press('Enter');
  const details=comparison.locator('..');assert.equal(await details.getAttribute('open'),'');
  const text=await details.innerText();
  assert.match(text,/Surviving member: Context Person 30/);assert.match(text,/Surviving aliases: Surviving spelling/);assert.match(text,/Other member aliases: Other spelling/);
  assert.match(text,/Registrar.*2026-01-01 to 2026-06-30.*Source designation note/);assert.match(text,/4th Call from 2026-11-01/i);
  const merge=dialog.locator('[data-merge-source="duplicate-source"]');assert.equal(await merge.isEnabled(),true);
  let cancelled=false;page.once('dialog',async d=>{assert.equal(d.type(),'confirm');assert.match(d.message(),/Context Person Thirty into Context Person 30/);assert.match(d.message(),/cannot be undone automatically/);cancelled=true;await d.dismiss();});
  await merge.click();assert.equal(cancelled,true);assert.equal(writes,0);assert.equal(await merge.isEnabled(),true);
  await dialog.locator('[data-edit]').click();await dialog.getByRole('tab',{name:'Details',exact:true}).click();await dialog.locator('[data-field=canonical_name]').fill('Unsaved survivor draft');await dialog.getByRole('tab',{name:'Names & duplicates',exact:true}).click();
  let blocked=false;page.once('dialog',async d=>{assert.equal(d.type(),'alert');assert.match(d.message(),/Save or cancel your edits before merging/);blocked=true;await d.accept();});
  await dialog.locator('[data-merge-source="duplicate-source"]').click();assert.equal(blocked,true);assert.equal(writes,0);
  await dialog.getByRole('tab',{name:'Details',exact:true}).click();assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),'Unsaved survivor draft');
  assert.equal(await page.locator('#working-month').inputValue(),'2026-10');assert.equal(profileReads,2);assert.deepEqual(errors,[]);
  page.once('dialog',d=>d.accept());await dialog.locator('[data-close]').first().click();await dialog.waitFor({state:'detached'});
  results.push({engine,width,initial_failure_dismiss_focus_escaped:true,manual_duplicate_retry_exact_target_reads:true,comparison_exact_survivor_source_aliases_designation_calls:true,merge_cancel_no_write:true,dirty_merge_block_keeps_draft:true,member_month_retained:true,backend_writes:0});await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hash(),start);
await writeFile('../docs/premium-ui/qa-member-duplicates-entry-independent.json',JSON.stringify({source_sha256:start,results,contracts:['member-workspace-024','member-workspace-025','member-workspace-026'],scope:'Actual analytics→canonical memberentry;3engines320/1280. Initial failureDismiss,duplicateGETretry,comparisondisclosure,andmergecancel/dirtypreconditiononly. No accepted merge/persistence/lifetime certification;allrequestsGET/noAPIwrites.'},null,2)+'\n');
console.log('Member duplicates entry:6 bounded actual-app workflows passed');
