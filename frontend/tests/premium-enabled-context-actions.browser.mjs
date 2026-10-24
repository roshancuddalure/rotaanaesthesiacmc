import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const base='http://127.0.0.1:5197',api='http://127.0.0.1:8031';
const before=createHash('sha256').update(await readFile('src/main.ts')).digest('hex'),results=[];
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],months=['2026-10'];
const people=Array.from({length:31},(_,i)=>({person_id:'context-person-'+i,name:'Context Person '+String(i).padStart(2,'0'),total_24hr:i+1,total_weekend_24hr:1,total_weekday_24hr:i,main_24hr:i,cb_24hr:0,rc_24hr:0,schell:0,floating:0,fifth_call:0,fifth_call_weekend:0,caesar_b:0,cart:0,caesar_a:0,pac:0,shift:0,main_shift:0,rc_shift:0,pb_shift:0,rc12hr:0,cb_co12hr:0,chad:0,ruhsa:0,neuro_dept:0,day_breakdown:{Monday:i+1},monthly_24hr:{'2026-10':i+1},fifth_call_monthly:{},fifth_call_days:{},pain_months:[],sicu_months:[],drp_months:[],neuro_icu_months:[],call_levels:{},units:{},promotions:[],months_active:months}));
const dashboard={summary:{personnel:31,active_personnel:31,total_records:496,total_24hr:496,total_weekend_24hr:31,weekend_percent:6,months:1,avg_24hr_per_active_person:16},months,month_labels:{'2026-10':'October 2026'},month_stats:{'2026-10':{total:496,total_24hr:496,weekend_24hr:31,persons:31,duty_type_counts:{}}},days,duty_category_totals:{MAIN:496},people};
const units=['Alpha','Beta','Gamma'].map((name,i)=>({id:'context-unit-'+i,name:name+' Context Unit',campus:'Main',code:name.toUpperCase(),minimum_free_people:1,active_status:'active',notes:null}));
const unitData={month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units,assignments:[],unit_summaries:units.map(u=>({unit_id:u.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]};
const browser=await chromium.launch({headless:true});
try{for(const width of [320,1280]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','context-actions-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
 await page.route('**/api/**',async route=>{
  assert.equal(route.request().method(),'GET','Presence inspection cannot mutate fixture');const url=new URL(route.request().url());
  if(url.pathname.endsWith('/analysis/dashboard'))return route.fulfill({json:dashboard});
  if(url.pathname.endsWith('/unit-management/month'))return route.fulfill({json:unitData});
  return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
 });
 async function observe(selector){const target=page.locator(selector).filter({visible:true}).first();assert.equal(await target.isEnabled(),true);return {selector,text:(await target.innerText()).trim(),visible:true,enabled:true,activated:false};}
 await page.goto(base+'/#view=analysis');await page.locator('[data-analysis-tab=personnel]').click();
 const controls=[];
 controls.push(await observe('[data-set-page="personnel:1"]'),await observe('[data-analysis-person]'));
 if(width===1280)controls.push(await observe('[data-person-sort="total_24hr"]'));
 await page.goto(base+'/#view=units');await page.locator('button[data-open-unit-modal="context-unit-1"]').first().click();
 controls.push(await observe('[data-unit-modal-nav="context-unit-0"]'),await observe('[data-unit-modal-nav="context-unit-2"]'));
 assert.deepEqual(errors,[]);results.push({width,role:'computer_admin',controls,backend_writes:0});await page.close();
}}finally{await browser.close();}
assert.equal(createHash('sha256').update(await readFile('src/main.ts')).digest('hex'),before);
await writeFile('../docs/premium-ui/qa-enabled-context-actions.json',JSON.stringify({source_sha256:{'frontend/src/main.ts':before},results,scope:'Enabled/visible observation only; candidate actions intentionally not activated. Personnel sort is a desktop table control, absent from mobile card view. Actual app shell; deterministic GET-only dashboard/unit fixtures. No outcome pass.'},null,2)+'\n');
console.log('Five context action candidates confirmed enabled; desktop sort only at1280');
