import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const months=['2026-10','2026-11'],days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const person={person_id:'example',name:'Dr Example',total_24hr:15,total_weekend_24hr:6,total_weekday_24hr:9,fifth_call:7,fifth_call_weekend:2,monthly_24hr:{'2026-10':5,'2026-11':10},fifth_call_monthly:{'2026-10':3,'2026-11':4},day_breakdown:{Monday:1,Tuesday:2,Wednesday:3,Thursday:2,Friday:1,Saturday:4,Sunday:2},months_active:months};
const data={summary:{personnel:1,active_personnel:1,total_records:15,total_24hr:15,total_weekend_24hr:6,weekend_percent:40,months:2,avg_24hr_per_active_person:15},months,month_labels:{'2026-10':'October 2026','2026-11':'November 2026'},month_stats:{'2026-10':{total:5,total_24hr:5,weekend_24hr:2,persons:1,duty_type_counts:{}},'2026-11':{total:10,total_24hr:10,weekend_24hr:4,persons:1,duty_type_counts:{}}},days,duty_category_totals:{MAIN:15},people:[person]};
const results=[];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{
  const cases=engine==='chromium'?[320,390,768,1280].flatMap(width=>['light','dark'].map(scheme=>({width,scheme}))):[{width:320,scheme:'light'},{width:1280,scheme:'dark'}];
  for(const {width,scheme} of cases){
   const context=await browser.newContext({viewport:{width,height:850},colorScheme:scheme,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
   let reads=0;
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','analytics-review'));
   await page.route('**/api/**',async route=>{
    assert.equal(route.request().method(),'GET','Chart interactions never write');
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/analysis/dashboard')){reads++;return route.fulfill({json:data});}
    return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
   });
   await page.goto(base+'/#view=analysis');await page.locator('.analysis-chart').first().waitFor();
   assert.match(await page.locator('.topbar').innerText(),/October 2026.*November 2026/);
   async function chart(title,expected){
    const figure=page.locator('figure').filter({has:page.locator('figcaption').filter({hasText:title})});
    const summary=figure.locator('summary');await summary.focus();await page.keyboard.press('Enter');
    const rows=await figure.locator('tbody tr').evaluateAll(nodes=>nodes.map(row=>[...row.children].map(cell=>cell.textContent.trim())));
    assert.deepEqual(rows,expected);
    const scroll=figure.locator('.chart-data__scroll');await scroll.focus();await page.keyboard.press('ArrowRight');
    assert.equal(await scroll.evaluate(el=>el===document.activeElement),true);
    assert.equal(await scroll.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Compact chart data table fits its panel');
    const a=await summary.boundingBox();assert.ok(a.height>=43.99,`Disclosure touch target ${engine}/${width}/${scheme}/${title}: ${JSON.stringify(a)}`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   }
   await chart('Monthly 24hr Load',[['October 2026','5','2','3'],['November 2026','10','4','6']]);
   await chart('Day of Week Pattern',days.map(day=>[day,String(person.day_breakdown[day]),String(['Saturday','Sunday'].includes(day)?person.day_breakdown[day]:0),String(['Saturday','Sunday'].includes(day)?0:person.day_breakdown[day])]));
   await chart('People Active by Month',[['October 2026','1'],['November 2026','1']]);
   if(engine==='chromium'){
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(item=>item.id),[]);
    if((width===320&&scheme==='dark')||(width===1280&&scheme==='light')){await mkdir('../docs/premium-ui/qa-analysis',{recursive:true});await page.locator('#analysis-tab-body').screenshot({path:`../docs/premium-ui/qa-analysis/${width}-${scheme}.png`});}
   }
   await page.locator('[data-analysis-tab="weekend"]').click();
   await chart('Weekend 24hr Duties per Month',[['October 2026','2'],['November 2026','4']]);
   await page.locator('[data-analysis-tab="fifth-call"]').click();
   await chart('5th Call Duties per Month',[['October 2026','3'],['November 2026','4']]);
   assert.equal(reads,1,'Disclosures and tab navigation reuse loaded data');assert.deepEqual(errors,[]);
   results.push({engine,width,scheme,charts_verified:5,exact_table_values:true,full_day_labels:true,keyboard_disclosures_and_scroll:true,unchanged_loaded_data:true,backend_writes:0,overflow:false});
   await context.close();
  }
 }finally{await browser.close();}
}
// Genuine app-load refusal followed by explicit GET retry; no mutation or automatic loop.
{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});let reads=0,fail=true;
  await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','analytics-retry'));
  await page.route('**/api/**',async route=>{
   assert.equal(route.request().method(),'GET');const url=new URL(route.request().url());
   if(url.pathname.endsWith('/analysis/dashboard')){reads++;return fail?route.fulfill({status:503,json:{detail:'Service unavailable'}}):route.fulfill({json:data});}
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=analysis');await page.getByRole('button',{name:'Retry analysis',exact:true}).waitFor();const failedReads=reads;assert.ok(failedReads>=1);
  fail=false;await page.getByRole('button',{name:'Retry analysis',exact:true}).click();await page.locator('.analysis-chart').first().waitFor();assert.equal(reads,failedReads+1,'Explicit retry issues exactly one new read');
  results.push({engine:'chromium',width:390,read_failure_manual_retry:true,backend_writes:0});
 }finally{await browser.close();}
}
await writeFile('../docs/premium-ui/qa-analysis-charts.json',JSON.stringify({results,scope:'All5 actual analysis chart integrations with intercepted dashboard response; GET-only fixture shell; no calculation/export/API contract changes. Physical and screen-reader checks pending.'},null,2)+'\n');
console.log('Analysis:12 cross-browser/theme chart workflows and1 manual app-load recovery passed');
