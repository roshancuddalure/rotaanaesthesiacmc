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
const missing=['missing-alpha','missing-beta'].map((id,i)=>({id,canonical_name:'Missing '+['Alpha','Beta'][i],call_level:'2ND_CALL',designation:'Registrar'}));
const imported={id:'imported-roster-member',canonical_name:'Imported Roster Member',active_status:'active',call_level:'3RD_CALL',revision:'one',aliases:[],designations:[],call_level_changes:[]};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of [320,1280]){
  console.log('Roster bulk',engine,width);
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],applies=[],profileGets=[];let previews=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','roster-bulk-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/member-workspace/csv/columns'))return route.fulfill({json:{headers:['canonical_name']}});
   if(url.pathname.endsWith('/member-workspace/csv/preview')){previews++;return route.fulfill({json:{id:'roster-bulk-preview',mode:'roster_sync',headers:['canonical_name'],missing,rows:[{row_number:2,values:{canonical_name:imported.canonical_name},action:'create',errors:[],suggestions:[],before:null,after:{canonical_name:imported.canonical_name,active_status:'active',call_level:'3RD_CALL'},person_id:null,revision:null}]}});}
   if(url.pathname==='/api/v1/admin/member-workspace/csv/roster-bulk-preview/apply'){
    assert.equal(req.method(),'POST');applies.push(req.postDataJSON());
    return route.fulfill(applies.length===1?{status:503,json:{detail:'Fixture roster apply unavailable'}}:{json:{batch_id:'roster-bulk-preview',created:0,updated:0,unchanged:0,archived:1,excluded:1,members:[imported]}});
   }
   assert.equal(req.method(),'GET','Only explicitly intercepted CSV operations permitted');
   if(url.pathname==='/api/v1/admin/members')return route.fulfill({json:[]});
   if(url.pathname==='/api/v1/admin/member-workspace/'+imported.id){profileGets.push(url.pathname);return route.fulfill({json:{member:imported,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});}
   if(url.pathname.includes('/admin/member-workspace/'+imported.id+'/'))return route.fulfill({json:{rows:[]}});
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=members');await page.locator('#import-member-csv').click();const importer=page.getByRole('dialog',{name:'Import department members',exact:true});
  await importer.locator('input[type=file]').setInputFiles({name:'full-roster.csv',mimeType:'text/csv',buffer:Buffer.from('canonical_name\r\nImported Roster Member\r\n')});await importer.getByText('Map CSV columns',{exact:true}).waitFor();await importer.getByRole('button',{name:'Preview import',exact:true}).click();
  await importer.getByRole('heading',{name:/Existing but missing from file \(2\)/}).waitFor();
  const checked=()=>importer.locator('[data-archive]:checked').evaluateAll(nodes=>nodes.map(n=>n.dataset.archive));
  assert.deepEqual(await checked(),[]);await importer.locator('[data-include="2"]').uncheck();
  assert.match(await importer.locator('[data-apply-blocker]').innerText(),/Include at least one row/);
  await importer.locator('[data-archive-all]').focus();await page.keyboard.press('Enter');assert.deepEqual(await checked(),['missing-alpha','missing-beta']);assert.equal(await importer.locator('[data-apply-blocker]').isHidden(),true,'Archive-only selection unblocks apply');
  await importer.locator('[data-archive-none]').click();assert.deepEqual(await checked(),[]);assert.equal(await importer.locator('[data-apply-blocker]').isVisible(),true);
  await importer.locator('[data-archive="missing-beta"]').check();assert.deepEqual(await checked(),['missing-beta']);assert.equal(await importer.locator('[data-apply-blocker]').isHidden(),true);
  page.once('dialog',async d=>{assert.match(d.message(),/Apply 0 member row\(s\) and archive 1 member\(s\)/);await d.dismiss();});await importer.locator('[data-apply]').click();assert.equal(applies.length,0);
  page.once('dialog',d=>d.accept());await importer.locator('[data-apply]').click();await importer.locator('#csv-message').filter({hasText:'Fixture roster apply unavailable'}).waitFor();
  assert.deepEqual(await checked(),['missing-beta']);assert.equal(await importer.locator('[data-include="2"]').isChecked(),false);assert.equal(previews,1);assert.deepEqual(applies,[{excluded:[2],archive_missing:['missing-beta']}]);
  page.once('dialog',d=>d.accept());await importer.locator('[data-apply]').focus();await page.keyboard.press('Enter');await importer.getByRole('heading',{name:'Import complete',exact:true}).waitFor();assert.deepEqual(applies,[{excluded:[2],archive_missing:['missing-beta']},{excluded:[2],archive_missing:['missing-beta']}]);
  const result=importer.locator('[data-result-member="imported-roster-member"]');await result.focus();await page.keyboard.press('Enter');
  const profile=page.locator('dialog.member-workspace').filter({has:page.locator('#mw-form')});await profile.getByRole('heading',{name:imported.canonical_name,exact:true}).waitFor();assert.deepEqual(profileGets,['/api/v1/admin/member-workspace/'+imported.id]);
  await profile.getByRole('button',{name:'Close member profile',exact:true}).click();await profile.waitFor({state:'detached'});assert.equal(await result.evaluate(el=>el===document.activeElement),true);await importer.getByRole('heading',{name:'Import complete',exact:true}).waitFor();
  assert.equal(await page.locator('#working-month').inputValue(),'2026-10');assert.deepEqual(errors,[]);
  results.push({engine,width,bulk_tick_untick_exact_targets:true,individual_archive_and_archive_only_blocker:true,cancel_apply_no_request:true,refusal_preserves_selection_exclusion:true,manual_retry_exact_archive_payload:true,result_exact_member_profile_target_and_focus:true,preview_count:previews,intercepted_apply_count:applies.length,backend_writes:0});await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hash(),start);
await writeFile('../docs/premium-ui/qa-member-roster-bulk-independent.json',JSON.stringify({source_sha256:start,results,contracts:['member-workspace-032','member-workspace-033','member-workspace-043'],scope:'ActualMembersCSVrostersync threeengines320/1280;allCSVcolumns/preview/applyPOSTfullyintercepted,onlyfixtureGETforwarded. Exactarchive-onlypayload+503manualretry UI contract;noactualarchive/memberpersistence.'},null,2)+'\n');
console.log('Member roster bulk:6 actual-app workflows passed');
