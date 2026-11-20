import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base='http://127.0.0.1:5188', api='http://127.0.0.1:8039';
assert.equal((await (await fetch(api+'/__fixture/reporting-identity')).json()).identity,'leave-reporting-memory-fixture-v1');
const browser=await chromium.launch({headless:true}), report=[];
try{
 for(const width of [1440,390,320]){
  await fetch(api+'/__fixture/reporting',{method:'POST'});
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  let mode='normal', lateResolve, lateStarted, lateReady, unitConflict=false;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/v1/leave/calendar' && mode==='fail'){
    mode='normal';await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Disposable unavailable'})});return;
   }
   const response=await route.fetch({url:api+url.pathname+url.search});
   if(url.pathname==='/api/v1/leave/calendar' && mode==='late' && url.searchParams.get('month')==='2026-05'){
    lateStarted();await lateReady;
   }
   if(url.pathname==='/api/v1/leave/calendar' && mode==='missing'){
    const body=await response.json();delete body.summary.interval_coverage;await route.fulfill({response,json:body});return;
   }
   if(url.pathname==='/api/v1/unit-management/month' && unitConflict){
    const body=await response.json();for(const summary of body.unit_summaries)summary.unresolved_leave_person_dates=2;
    await route.fulfill({response,json:body});return;
   }
   await route.fulfill({response});
  });
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','disposable');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.goto(base);
  await page.getByRole('heading',{name:'Duty workload at a glance',exact:true}).waitFor();
  const leave=()=>page.locator('[data-view="leave"]').first().evaluate(button=>button.click());
  await leave();
  await page.locator('[data-leave-coverage]').waitFor();
  assert.match(await page.locator('.board-metrics').textContent(),/Active request-days/);
  await page.locator('[data-leave-coverage-group="approved"]').getByText(/12 covered clock hours/).waitFor();
  await page.locator('[data-leave-coverage-group="pending"]').getByText(/Exact coverage unknown: 1/).waitFor();
  await page.locator('.leave-pressure-details > summary').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-pressure-day="2026-05-10"] [data-pressure-total]').textContent(),'1');
  assert.equal(await page.locator('[data-pressure-day="2026-05-10"] [data-pressure-blocking]').textContent(),'1');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const axe=await new AxeBuilder({page}).include('[data-leave-coverage]').analyze();
  assert.deepEqual(axe.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);
  // A missing additive coverage field remains readable, with no invented zero.
  mode='missing';await leave();await page.locator('[data-leave-coverage-unavailable]').waitFor();
  assert.equal(await page.locator('[data-leave-coverage]').count(),0);
  // Existing full-page failure/retry contract, with real successful backend readback.
  mode='fail';await leave();await page.getByText('Leave could not load',{exact:true}).waitFor();
  await page.locator('[data-view-shortcut="leave"]').click();await page.locator('[data-leave-coverage]').waitFor();
  // An old month response cannot overwrite the current month after it arrives late.
  const started=new Promise(resolve=>lateStarted=resolve);lateReady=new Promise(resolve=>lateResolve=resolve);
  mode='late';await leave();await started;
  await page.locator('#working-month').fill('2026-06');await page.locator('#working-month').dispatchEvent('change');
  await page.locator('[data-leave-coverage-group="approved"]').getByText(/0 covered clock hours/).waitFor();
  lateResolve();await page.waitForTimeout(300);
  assert.match(await page.locator('[data-leave-coverage-group="approved"]').textContent(),/0 covered clock hours/);
  assert.equal(await page.locator('#working-month').inputValue(),'2026-06');
  mode='normal';unitConflict=true;
  await page.locator('[data-view="units"]').first().evaluate(button=>button.click());
  await page.locator('[data-unit-leave-overview]').getByText(/unit\/person-date references/).waitFor();
  assert.match(await page.locator('.board-metrics').textContent(),/Unit leave person-dates/);
  await page.locator('button[data-open-unit-modal]').first().click();
  await page.locator('[data-unit-leave-basis]').getByText(/2 person-dates have conflicting/).waitFor();
  await page.waitForTimeout(350); // Let the existing modal/board transitions settle.
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
   body:{scroll:document.body.scrollWidth,style:document.body.getAttribute('style')},
   nodes:[...document.querySelectorAll('body *')].filter(el=>el.scrollWidth>el.clientWidth+10 && el.clientWidth>0).slice(0,12).map(el=>({tag:el.tagName,cls:el.className,scroll:el.scrollWidth,client:el.clientWidth}))}));
  assert.equal(overflow.scroll<=overflow.width,true,JSON.stringify(overflow));
  assert.deepEqual(errors,[]);
  report.push({width,canonical_approved_hours:12,unknown_pending:true,distinct_pressure_people:1,keyboard_disclosure:true,missing_coverage_fallback:true,request_failure_retry:true,late_month_response_ignored:true,unit_summary_conflicts_visible:true,unit_conflict_response_fixture:true,axe_serious_critical:0,errors});
  await context.close();
 }
 await writeFile('../docs/allocation-progress/n20-reporting-page-browser.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}finally{await browser.close();}
