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
const sourcePaths=['src/main.ts','src/member-workspace.ts','src/navigation-history.ts'];
const hashAll=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')]))),sourceBefore=await hashAll();
for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of [320,1280]){
  console.log('Context actions',engine,width);
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],requests=[];let dashboardReads=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','context-outcome-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());requests.push({method:req.method(),path:url.pathname});
   assert.equal(req.method(),'GET','All tested actions must remain read-only');
   if(url.pathname.endsWith('/analysis/dashboard')){dashboardReads++;return route.fulfill({json:dashboard});}
   if(url.pathname.endsWith('/unit-management/month'))return route.fulfill({json:unitData});
   if(url.pathname.includes('/admin/member-workspace/')){
    const match=url.pathname.match(/\/admin\/member-workspace\/(context-person-\d+)(?:\/(.*))?$/);assert.ok(match,url.pathname);
    const person=people.find(p=>p.person_id===match[1]);assert.ok(person,'Exact analytical person ID must be requested');
    if(match[2])return route.fulfill({json:{rows:[]}});
    return route.fulfill({json:{member:{id:person.person_id,canonical_name:person.name,active_status:'active',call_level:'2ND_CALL',revision:'one',aliases:[],designations:[],call_level_changes:[]},impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
   }
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=analysis');await page.locator('[data-analysis-tab=personnel]').click();await page.waitForLoadState('networkidle');
  const names=()=>page.locator(width===320?'#analysis-person-cards > .data-card [data-analysis-person]':'#analysis-person-tbody [data-analysis-person]').allTextContents();
  const expected=people.slice().reverse().map(p=>p.name),strip=rows=>rows.map(x=>x.trim().replace(/^\d+\.\s*/,''));
  assert.deepEqual(strip(await names()),expected.slice(0,25));
  const initialReads=dashboardReads;
  await page.locator('[data-set-page="personnel:1"]').filter({visible:true}).click();
  assert.deepEqual(strip(await names()),expected.slice(25));
  assert.match(await page.locator('.paginator:visible .page-info').innerText(),/26.*31 of 31/);
  const previous=page.locator('[data-set-page="personnel:0"]').filter({visible:true});await previous.focus();await page.keyboard.press('Enter');
  assert.deepEqual(strip(await names()),expected.slice(0,25));
  let sortVerified=false;
  if(width===1280){
   const sort=()=>page.locator('[data-person-sort=total_24hr]');
   await sort().focus();await page.keyboard.press('Enter');
   assert.deepEqual(strip(await names()),people.slice(0,25).map(p=>p.name));assert.equal(await sort().getAttribute('aria-sort'),'ascending');
   await sort().click();assert.deepEqual(strip(await names()),expected.slice(0,25));assert.equal(await sort().getAttribute('aria-sort'),'descending');sortVerified=true;
  }
  await page.locator('[data-set-page="personnel:1"]').filter({visible:true}).click();
  const search=page.locator('#analysis-person-search');await search.fill('Context Person 30');
  assert.deepEqual(strip(await names()),['Context Person 30']);assert.equal(await search.evaluate(el=>el===document.activeElement),true);
  await search.fill('');assert.deepEqual(strip(await names()),expected.slice(0,25));
  const personOpen=page.locator('[data-analysis-person="Context Person 30"]').filter({visible:true}).first();await personOpen.focus();await page.keyboard.press('Enter');
  const member=page.locator('dialog.member-workspace');await member.waitFor();
  await member.getByRole('heading',{name:'Context Person 30',exact:true}).waitFor();
  assert.equal(await member.locator('[role=tab][aria-selected=true]').getAttribute('data-tab'),'duties');
  assert.ok(requests.some(r=>r.path==='/api/v1/admin/member-workspace/context-person-30'));
  assert.ok(requests.some(r=>r.path==='/api/v1/admin/member-workspace/context-person-30/duties'));
  await member.locator('button[data-close]').first().click();await member.waitFor({state:'detached'});
  assert.equal(await personOpen.evaluate(el=>el===document.activeElement),true,'Member close returns analytical opener focus');
  assert.deepEqual(strip(await names()),expected.slice(0,25));assert.equal(dashboardReads,initialReads,'Local analytical actions reuse same dataset');
  assert.equal(await page.locator('#working-month').inputValue(),'2026-10');
  // Both unit directions must render target-specific data, independent of the filtered board.
  await page.goto(base+'/#view=units');await page.locator('input[data-unit-board-search]').fill('Beta');
  const unitOpen=page.locator('button[data-open-unit-modal="context-unit-1"]').first();await unitOpen.click();
  const modal=page.locator('#unit-management-modal');
  async function correctUnit(i){
   await modal.getByRole('heading',{name:units[i].name,exact:true}).waitFor();
   assert.equal(await modal.locator('#unit-settings-form').getAttribute('data-unit-id'),units[i].id);
   assert.equal(await modal.locator('#unit-minimum-free-people').inputValue(),String(i+1));
   assert.match(await modal.innerText(),new RegExp('Posted '+units[i].name));
   for(const [other,u] of units.entries())if(other!==i)assert.equal(await modal.getByText('Posted '+u.name,{exact:true}).count(),0);
   assert.match(await modal.innerText(),/2026-10 unit assignment workspace/);
  }
  await correctUnit(1);await modal.getByRole('button',{name:'Previous unit',exact:true}).focus();await page.keyboard.press('Enter');
  await correctUnit(0);assert.equal(await modal.getByRole('button',{name:'Previous unit',exact:true}).isDisabled(),true);
  await modal.getByRole('button',{name:'Next unit',exact:true}).click();await correctUnit(1);
  await modal.getByRole('button',{name:'Next unit',exact:true}).focus();await page.keyboard.press('Space');await correctUnit(2);
  assert.equal(await modal.getByRole('button',{name:'Next unit',exact:true}).isDisabled(),true);
  await modal.getByRole('button',{name:'Previous unit',exact:true}).click();await correctUnit(1);
  await modal.getByRole('button',{name:'Close',exact:true}).click();await modal.waitFor({state:'detached'});
  assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Beta');
  assert.equal(await page.locator('#working-month').inputValue(),'2026-10');
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  results.push({engine,width,analytics_exact_next_previous_names:true,paging_search_clamp_focus:true,sort_exact_order_and_direction:sortVerified?'passed':'not_applicable_mobile_cards',exact_member_target_and_duties_tab:true,member_close_restores_opener:true,unit_previous_next_exact_settings_rows_month:true,unit_boundary_disabled:true,board_filter_and_month_retained:true,backend_writes:0});await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashAll(),sourceBefore);
await writeFile('../docs/premium-ui/qa-context-action-outcomes-independent.json',JSON.stringify({source_sha256:sourceBefore,results,scope:'Five current controls actualapp three engines320/1280; analytics sorting desktop only. All requests GET, deterministic analytical/member/unit responses; no persisted writes. No general inventory certification.'},null,2)+'\n');
console.log('Context action outcomes independent:6 workflows passed');
