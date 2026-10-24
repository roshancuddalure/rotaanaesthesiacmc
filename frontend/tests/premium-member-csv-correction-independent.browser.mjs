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
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of[320,1280]){
  console.log('CSV corrections',engine,width);
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],previews=[];let forbiddenWrites=0;
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','csv-correction-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/member-workspace/csv/columns'))return route.fulfill({json:{headers:['Full title','Role label']}});
   if(url.pathname.endsWith('/member-workspace/csv/preview')){
    const raw=req.postDataBuffer().toString(),field=name=>JSON.parse(raw.match(new RegExp('name="'+name+'"\\r\\n\\r\\n([^\\r]*)'))?.[1]||'{}'),data={mapping:field('mapping'),corrections:field('corrections')};previews.push(data);
    if(previews.length===2)return route.fulfill({status:503,json:{detail:'Fixture corrected preview unavailable'}});
    const name=data.corrections['2']?.canonical_name||'Original CSV Person';
    return route.fulfill({json:{id:'correction-preview',mode:'create_only',headers:['Full title','Role label'],rows:[{row_number:2,values:{canonical_name:name,call_level:'2ND_CALL'},action:'create',errors:[],suggestions:[],before:null,after:{canonical_name:name,active_status:'active',call_level:'2ND_CALL'},person_id:null,revision:null}]}});
   }
   if(req.method()!=='GET'){forbiddenWrites++;return route.fulfill({status:599,json:{detail:'Unmocked mutation forbidden'}});}
   if(url.pathname==='/api/v1/admin/members')return route.fulfill({json:[]});return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=members');await page.locator('#import-member-csv').click();const dialog=page.getByRole('dialog',{name:'Import department members',exact:true});await dialog.locator('select[name=mode]').selectOption('create_only');
  await dialog.locator('input[type=file]').setInputFiles({name:'custom-headers.csv',mimeType:'text/csv',buffer:Buffer.from('Full title,Role label\r\nOriginal CSV Person,2ND_CALL\r\n')});
  await dialog.getByText('Map CSV columns',{exact:true}).click();await dialog.locator('[data-map-column="0"]').selectOption('canonical_name');await dialog.locator('[data-map-column="1"]').selectOption('call_level');
  await dialog.getByRole('button',{name:'Preview import',exact:true}).click();await dialog.locator('[data-csv-row="2"]').waitFor();assert.deepEqual(previews[0],{mapping:{'Full title':'canonical_name','Role label':'call_level'},corrections:{}});
  await dialog.locator('[data-csv-row="2"]').getByText('Edit row',{exact:true}).click();const correction=dialog.locator('[data-row="2"][data-key=canonical_name]');await correction.fill('=Corrected, "Royal" Member');
  assert.match(await dialog.locator('[data-apply-blocker]').innerText(),/Refresh the preview/);await dialog.locator('[data-apply]').click();assert.equal(forbiddenWrites,0);
  await dialog.locator('[data-refresh]').click();await dialog.locator('#csv-message').filter({hasText:'Fixture corrected preview unavailable'}).waitFor();assert.equal(await correction.inputValue(),'=Corrected, "Royal" Member');assert.match(await dialog.locator('[data-apply-blocker]').innerText(),/Refresh the preview/);
  await dialog.locator('[data-refresh]').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#csv-message')?.textContent==='1 rows previewed. Nothing has been saved.');
  assert.deepEqual(previews.slice(1),[previews[1],previews[1]]);assert.deepEqual(previews[2],{mapping:{'Full title':'canonical_name','Role label':'call_level'},corrections:{'2':{canonical_name:'=Corrected, "Royal" Member'}}});
  const downloadPromise=page.waitForEvent('download');await dialog.locator('[data-report]').click();const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),'department-member-import-report.csv');assert.equal(await download.failure(),null);
  const content=await readFile(await download.path(),'utf8');assert.equal(content,'\ufeff"row","name","action","errors"\r\n"2","\'=Corrected, ""Royal"" Member","create",""');
  assert.equal(previews.length,3);assert.equal(forbiddenWrites,0);assert.equal(await page.locator('#working-month').inputValue(),'2026-10');assert.deepEqual(errors,[]);
  results.push({engine,width,custom_columns_exact_mapping_payload:true,correction_stale_apply_blocked:true,failed_refresh_keeps_draft_mapping:true,manual_refresh_exact_correction:true,report_exact_csv_escaping_formula_guard:true,intercepted_previews:3,apply_mutations:0,backend_writes:0});await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hash(),start);
await writeFile('../docs/premium-ui/qa-member-csv-correction-independent.json',JSON.stringify({source_sha256:start,results,contracts:['member-workspace-030','member-workspace-039','member-workspace-040','member-workspace-041'],scope:'ActualMembersCSVcustommapping/correction/recovery/artifact;threeengines320/1280. PreviewPOSTfullyintercepted,noapply orDBwrites;CSVartifactboundedrowfixture.'},null,2)+'\n');
console.log('Member CSV corrections:6 workflows passed');
