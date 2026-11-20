import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base='http://127.0.0.1:5188',api='http://127.0.0.1:8038';
const browser=await chromium.launch({headless:true}),report={at:new Date().toISOString(),cases:[]};
try{
 for(const width of [1440,390])for(const scenario of ['unknown','shortage','protected','empty']){
  assert.equal((await fetch(`${api}/__fixture/month?scenario=${scenario}`,{method:'POST'})).status,200);
  const context=await browser.newContext({viewport:{width,height:960}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__month-edges',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Monthly capacity edges</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host" style="padding:16px;max-width:1250px;margin:auto"></main></body></html>'}));
  await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),response=await route.fetch({url:api+u.pathname+u.search});await route.fulfill({response});});
  await page.goto(base+'/__month-edges');
  await page.evaluate(async()=>{(await import('/src/services/api.ts')).setAuthToken('disposable');await(await import('/src/ot-calendar.ts')).renderOtCalendar(document.querySelector('#host'));});
  await page.getByLabel('Unit',{exact:true}).selectOption({label:'Unit 4'});
  const form=page.locator('[data-month-form]');await form.getByLabel('Capacity month').fill('2026-11');
  await form.getByRole('button',{name:'Load monthly capacity'}).click();
  await page.getByText('Monthly capacity loaded.',{exact:true}).waitFor({timeout:60000});
  const day=page.locator('[data-month-day="2026-11-19"]');
  assert.equal(await day.getAttribute('data-capacity-status'),scenario==='unknown'?'not_evaluated':scenario==='shortage'?'infeasible':'feasible');
  await day.click();const detail=page.locator('[data-month-detail]');
  await detail.getByRole('button',{name:'Check duty-eligible people'}).click();
  const expected={unknown:/Duty-eligible people: Not evaluated/,shortage:/Duty-eligible people: 0/,protected:/Only draft duties can receive normal assignments/,empty:/No saved unit-assigned duties/}[scenario];
  await detail.getByText(expected).waitFor({timeout:60000});
  if(scenario==='unknown')assert.match(await detail.innerText(),/OT input or capacity proof is unresolved/);
  if(scenario==='shortage')assert.match(await detail.innerText(),/OT mandatory roles in this interval: 5/);
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  report.cases.push({width,scenario,errors,expected_state:true});await context.close();
 }
 // A previous unit's delayed result must not repaint the replacement panel.
 assert.equal((await fetch(api+'/__fixture/month?scenario=unknown',{method:'POST'})).status,200);
 const context=await browser.newContext(),page=await context.newPage();
 await page.route('**/__unit-switch',r=>r.fulfill({contentType:'text/html',body:'<main id="host"></main>'}));
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),response=await route.fetch({url:api+u.pathname+u.search});await route.fulfill({response});});
 await page.goto(base+'/__unit-switch');await page.evaluate(async()=>{(await import('/src/services/api.ts')).setAuthToken('disposable');await(await import('/src/ot-calendar.ts')).renderOtCalendar(document.querySelector('#host'));});
 await page.getByLabel('Unit',{exact:true}).selectOption({label:'Unit 4'});
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/month-capacity?**',async route=>{await gate;const u=new URL(route.request().url()),response=await route.fetch({url:api+u.pathname+u.search});await route.fulfill({response});});
 await page.locator('[data-month-form] input[name="month"]').fill('2026-11');await page.getByRole('button',{name:'Load monthly capacity'}).click();
 await page.getByText('Loading monthly capacity…',{exact:true}).waitFor();
 await page.getByLabel('Unit',{exact:true}).selectOption({label:'Unit 1'});await page.locator('[data-month-form]').waitFor();release();
 await page.waitForTimeout(1500);assert.equal(await page.locator('[data-month-day]').count(),0);await context.close();
 report.unit_switch_late_response_ignored=true;
}catch(error){report.error=String(error);throw error;}
finally{await browser.close();await writeFile('../docs/allocation-progress/n13-month-edges-browser.json',JSON.stringify(report,null,2)+'\n');}
console.log(`Monthly edge browser checks passed: ${report.cases.length} cases and unit switch.`);
