import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const api='http://127.0.0.1:8040',base='http://127.0.0.1:5188';
assert.equal((await(await fetch(api+'/__fixture/member-leave-identity')).json()).identity,'member-leave-memory-fixture-v1');
const browser=await chromium.launch({headless:true}),report=[];
try{
 for(const width of [1440,390,320]){
  const seed=await(await fetch(api+'/__fixture/member-statistics',{method:'POST'})).json();
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],methods=[];
  let mode='normal',release,started,waiting;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__member-stats',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Member statistics fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open member</button></body></html>'}));
  await page.route('**/api/**',async route=>{
   methods.push(route.request().method());const url=new URL(route.request().url());
   if(url.pathname.endsWith('/leave-statistics')&&mode==='fail'){mode='normal';return route.fulfill({status:503,json:{detail:'Disposable statistics unavailable'}});}
   const response=await route.fetch({url:api+url.pathname+url.search});
   if(url.pathname.endsWith('/leave-statistics')&&mode==='bad'){return route.fulfill({response,json:{version:1,person_id:seed.person_id,year:2026,month:5}});}
   if(url.pathname.endsWith('/leave-statistics')&&mode==='wrong-clock'){
    const body=await response.json();body.as_of_local='2026-05-01T00:00:00';return route.fulfill({response,json:body});
   }
   if(url.pathname.endsWith('/leave-statistics')&&mode==='late'&&url.searchParams.get('month')==='5'){started();await waiting;}
   await route.fulfill({response});
  });
  await page.goto(base+'/__member-stats');await page.locator('#open').focus();
  await page.evaluate(async id=>{const {openMemberWorkspace}=await import('/src/member-workspace.ts');void openMemberWorkspace(id,true,()=>{},[id],'leave');},seed.person_id);
  await page.locator('[data-member-leave-statistics]').click();
  const dialog=page.getByRole('dialog',{name:'Member leave statistics',exact:true});
  await dialog.locator('[name="year"]').fill('2026');await dialog.locator('[name="month"]').selectOption('5');
  await dialog.locator('[name="as_of"]').fill('2026-05-14T12:00');
  const read=()=>dialog.getByRole('button',{name:'Read leave statistics',exact:true}).click();
  await read();await dialog.locator('[data-stat-approved-elapsed]').getByText(/84 clock hours/).waitFor();
  await dialog.locator('[data-stat-approved-future]').getByText(/60 clock hours/).waitFor();
  await dialog.locator('[data-stat-pending-future]').getByText(/Exact total unknown/).waitFor();
  assert.match(await dialog.textContent(),/Working-day totals and entitlement balances are unavailable/);
  assert.doesNotMatch(await dialog.textContent(),/PRIVATE/);
  await dialog.locator('[name="month"]').selectOption('');assert.equal(await dialog.locator('[data-stat-period]').count(),0);
  await read();await dialog.locator('[data-stat-approved-whole]').getByText(/144 clock hours/).waitFor();
  assert.equal(await dialog.locator('meter').count(),12);
  const axe=await new AxeBuilder({page}).include('dialog:last-of-type').analyze();
  assert.deepEqual(axe.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  mode='fail';await read();await dialog.getByRole('alert').waitFor();assert.equal(await dialog.locator('[data-stat-period]').count(),0);
  await read();await dialog.locator('[data-stat-period]').waitFor();
  mode='bad';await read();await dialog.getByRole('alert').getByText(/incomplete/).waitFor();assert.equal(await dialog.locator('[data-stat-period]').count(),0);
  mode='late';await dialog.locator('[name="month"]').selectOption('5');
  const gate=new Promise(resolve=>started=resolve);waiting=new Promise(resolve=>release=resolve);
  await read();await gate;await dialog.locator('[name="month"]').selectOption('6');await read();
  await dialog.locator('[data-stat-approved-whole]').getByText(/0 clock hours/).waitFor();
  release();await page.waitForTimeout(200);assert.match(await dialog.locator('[data-stat-period]').textContent(),/2026-06-01/);
  assert.match(await dialog.locator('[data-stat-approved-whole]').textContent(),/0 clock hours/);
  mode='normal';await dialog.locator('[name="month"]').selectOption('5');
  await dialog.locator('[name="as_of"]').fill('2026-05-11T00:00');
  assert.equal(await dialog.locator('[data-stat-period]').count(),0);
  await read();await dialog.locator('[data-stat-approved-elapsed]').getByText(/24 clock hours/).waitFor();
  await dialog.locator('[data-stat-approved-future]').getByText(/120 clock hours/).waitFor();
  mode='wrong-clock';await read();await dialog.getByRole('alert').getByText(/incomplete/).waitFor();
  assert.equal(await dialog.locator('[data-stat-period]').count(),0);
  await dialog.locator('[data-stat-close]').click();assert.equal(await page.locator('[data-member-leave-statistics]').evaluate(el=>el===document.activeElement),true);
  assert.ok(methods.every(method=>method==='GET'));assert.deepEqual(errors,[]);
  report.push({width,canonical_elapsed84_future60:true,unknown_pending_explicit:true,annual_month_bars:12,controls_invalidate_old_totals:true,failed_read_retry:true,malformed_response_no_totals:true,late_month_ignored:true,changed_asof24_future120:true,mismatched_clock_rejected:true,private_notes_omitted:true,only_reads:true,focus_restored:true,axe_serious_critical:0,errors});
  await context.close();
 }
 await writeFile('../docs/allocation-progress/n22-statistics-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
