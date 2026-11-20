import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base='http://127.0.0.1:5188',api='http://127.0.0.1:8038';
const report={at:new Date().toISOString(),cases:[]};
const browser=await chromium.launch({headless:true});
try{
 for(const width of [1440,390]){
  const response=await fetch(api+'/__fixture/template?scenario=safe',{method:'POST'});assert.equal(response.status,200);
  const context=await browser.newContext({viewport:{width,height:960}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__month',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>OT monthly verification</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host" style="padding:16px;max-width:1250px;margin:auto"></main></body></html>'}));
  await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),response=await route.fetch({url:api+u.pathname+u.search});await route.fulfill({response});});
  await page.goto(base+'/__month');
  await page.evaluate(async()=>{(await import('/src/services/api.ts')).setAuthToken('disposable');await(await import('/src/ot-calendar.ts')).renderOtCalendar(document.querySelector('#host'));});
  await page.getByLabel('Unit',{exact:true}).selectOption({label:'Unit 4'});
  const form=page.locator('[data-month-form]');await form.getByLabel('Capacity month').fill('2026-11');
  await form.getByRole('button',{name:'Load monthly capacity'}).click();
  await page.getByText('Monthly capacity loaded.',{exact:true}).waitFor({timeout:60000});
  assert.equal(await page.locator('[data-month-day]').count(),30);
  const day=page.locator('[data-month-day="2026-11-19"]');await day.focus();await day.press('Enter');
  const detail=page.locator('[data-month-detail]');
  await detail.getByRole('heading',{name:/2026-11-19/}).waitFor();
  assert.match(await detail.innerText(),/Counts below refer only to this interval/);
  await detail.getByText('Posted people (4)',{exact:true}).click();
  await detail.getByText('OT fixture clinician 0',{exact:true}).first().waitFor();
  await detail.getByRole('button',{name:'Check duty-eligible people'}).click();
  await detail.getByText(/Duty-eligible people: 4/).waitFor({timeout:60000});
  await page.screenshot({path:`../docs/allocation-progress/n13-month-populated-${width}.png`,fullPage:true});
  const audit=await new AxeBuilder({page}).include('[data-ot-month-panel]').analyze();
  assert.deepEqual(audit.violations.filter(v=>['critical','serious'].includes(v.impact)).map(v=>v.id),[]);
  // A delayed response for the old scenario may not repaint the changed form.
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/month-capacity?**',async route=>{await gate;const u=new URL(route.request().url()),response=await route.fetch({url:api+u.pathname+u.search});await route.fulfill({response});});
  await form.getByRole('button',{name:'Load monthly capacity'}).click();
  await page.getByText('Loading monthly capacity…',{exact:true}).waitFor();
  await form.getByLabel('Capacity month').fill('2026-12');await form.getByLabel('Capacity month').dispatchEvent('change');
  release();await page.waitForTimeout(1500);
  assert.equal(await page.locator('[data-month-day]').count(),0);
  assert.match(await page.locator('[data-month-message]').innerText(),/Scenario changed/);
  await page.unroute('**/month-capacity?**');
  await page.route('**/month-capacity?**',r=>r.fulfill({status:503,json:{detail:'Temporary fixture outage'}}));
  await form.getByRole('button',{name:'Load monthly capacity'}).click();
  await page.getByText(/Monthly capacity unavailable:/).waitFor();
  assert.equal(await page.locator('[data-month-day]').count(),0);
  await page.unroute('**/month-capacity?**');
  await form.getByLabel('Capacity month').fill('2026-11');
  await form.getByLabel('Stress-test pending leave as unavailable').check();
  await form.getByRole('button',{name:'Load monthly capacity'}).click();
  await page.getByText('Monthly capacity loaded.',{exact:true}).waitFor({timeout:60000});
  await page.getByText('Pending-leave stress scenario.',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-month-day]').count(),30);
  assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  report.cases.push({width,days:30,named_drilldown:true,duty_eligible_count:4,keyboard:true,stale_response_ignored:true,error_recovery:true,errors});
  await page.screenshot({path:`../docs/allocation-progress/n13-month-${width}.png`,fullPage:true});await context.close();
 }
}catch(error){report.error=String(error);throw error;}
finally{await browser.close();await writeFile('../docs/allocation-progress/n13-month-browser.json',JSON.stringify(report,null,2)+'\n');}
console.log(`OT monthly browser checks passed: ${report.cases.length} viewports.`);
