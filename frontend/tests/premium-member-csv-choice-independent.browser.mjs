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
const candidate={id:'csv-choice-candidate',canonical_name:'Dr CSV Candidate',active_status:'active',call_level:'2ND_CALL',revision:'one',aliases:[],designations:[],call_level_changes:[]};
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of [320,1280]){
  console.log('CSV choices',engine,width);
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],corrections=[],profileReads=[];let unexpectedWrites=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','csv-choice-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/member-workspace/csv/columns'))return route.fulfill({json:{headers:['canonical_name']}});
   if(url.pathname.endsWith('/member-workspace/csv/preview')){
    assert.equal(req.method(),'POST');const raw=req.postDataBuffer().toString(),c=JSON.parse(raw.match(/name="corrections"\r\n\r\n([^\r]*)/)?.[1]||'{}');corrections.push(c);
    const distinct=c['2']?._confirm_distinct==='yes';
    return route.fulfill({json:{id:'csv-choice-preview',mode:'create_only',headers:['canonical_name'],rows:[{row_number:2,values:{canonical_name:'Dr CSV Canddate',...(distinct?{_confirm_distinct:'yes'}:{})},action:distinct?'create':'needs_review',errors:[],suggestions:[{id:candidate.id,name:candidate.canonical_name,status:'active',call_level:'2ND_CALL',designation:null,units:[]}],before:null,after:{canonical_name:'Dr CSV Canddate',active_status:'active',call_level:null},person_id:null,revision:null}]}});
   }
   if(req.method()!=='GET'){unexpectedWrites++;return route.fulfill({status:599,json:{detail:'Unexpected operation forbidden'}});}
   if(url.pathname==='/api/v1/admin/members')return route.fulfill({json:[candidate]});
   if(url.pathname==='/api/v1/admin/member-workspace/'+candidate.id){profileReads.push(url.pathname);return route.fulfill({json:{member:candidate,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});}
   if(url.pathname.includes('/admin/member-workspace/'+candidate.id+'/'))return route.fulfill({json:{rows:[]}});
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=members');await page.locator('#import-member-csv').click();
  const importer=page.getByRole('dialog',{name:'Import department members',exact:true});await importer.locator('select[name=mode]').selectOption('create_only');
  await importer.locator('input[type=file]').setInputFiles({name:'member-choice.csv',mimeType:'text/csv',buffer:Buffer.from('canonical_name\r\nDr CSV Canddate\r\n')});
  await importer.getByText('Map CSV columns',{exact:true}).waitFor();await importer.getByRole('button',{name:'Preview import',exact:true}).click();
  const row=importer.locator('[data-csv-row="2"]');await row.locator('[data-csv-distinct]').waitFor();assert.equal(await row.locator('[data-csv-distinct]').isEnabled(),true);
  await row.locator('[data-csv-distinct]').focus();await page.keyboard.press('Enter');
  await row.locator('[data-csv-undo]').waitFor();assert.deepEqual(corrections.at(-1),{'2':{_confirm_distinct:'yes',member_id:''}});
  assert.match(await row.innerText(),/different person|distinct/i);
  await row.locator('[data-csv-undo]').click();await page.waitForFunction(()=>document.querySelector('#csv-message')?.textContent.includes('1 rows previewed'));
  assert.deepEqual(corrections.at(-1),{'2':{_confirm_distinct:'',member_id:''}});
  assert.match(await row.locator('.member-match').innerText(),/Possible duplicate/);
  const review=row.locator('[data-csv-review-member="csv-choice-candidate"]');assert.equal(await review.isEnabled(),true);await review.focus();await page.keyboard.press('Enter');
  const profile=page.locator('dialog.member-workspace').filter({has:page.locator('#mw-form')});await profile.getByRole('heading',{name:candidate.canonical_name,exact:true}).waitFor();
  assert.equal(await profile.locator('[role=tab][aria-selected=true]').getAttribute('data-tab'),'details');assert.equal(await profile.locator('[data-member-id]').inputValue(),candidate.id);assert.deepEqual(profileReads,['/api/v1/admin/member-workspace/'+candidate.id]);
  await profile.getByRole('button',{name:'Close member profile',exact:true}).click();await profile.waitFor({state:'detached'});assert.equal(await review.evaluate(el=>el===document.activeElement),true);
  assert.equal(await importer.locator('select[name=mode]').inputValue(),'create_only');assert.equal(await importer.locator('input[type=file]').evaluate(el=>el.files[0].name),'member-choice.csv');assert.equal(corrections.length,3);assert.equal(unexpectedWrites,0);assert.deepEqual(errors,[]);
  page.once('dialog',d=>d.accept());await importer.getByRole('button',{name:'Close import',exact:true}).click();await importer.waitFor({state:'detached'});
  results.push({engine,width,distinct_exact_correction_refresh:true,undo_exact_reset_duplicate_state:true,review_exact_candidate_details_identity:true,close_restores_row_action_focus:true,file_mode_preview_retained:true,preview_posts_intercepted:3,apply_or_other_mutations:0,backend_writes:0});await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hash(),start);
await writeFile('../docs/premium-ui/qa-member-csv-choice-independent.json',JSON.stringify({source_sha256:start,results,contracts:['member-workspace-036','member-workspace-037','member-workspace-038'],scope:'ActualMembers→CSVimport;3engines320/1280. Column/preview POSTfullyintercepted,allremainingrequestsGETfixtureonly. Noapply/archive/persistence certification.'},null,2)+'\n');
console.log('Member CSV choice:6 actual-app workflows passed');
