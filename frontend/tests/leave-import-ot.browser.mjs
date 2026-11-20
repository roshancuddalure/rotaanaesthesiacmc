import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const api='http://127.0.0.1:8041',base='http://127.0.0.1:5188';
assert.equal((await(await fetch(api+'/__fixture/leave-repair-identity')).json()).identity,'leave-repair-memory-fixture-v1');
const browser=await chromium.launch({headless:true}),report=[];
try{
 for(const width of [1440,390,320]){
  await fetch(api+'/__fixture/leave-repair',{method:'POST'});
  const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage(),errors=[],applies=[];
  let corrupt=false;
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.route('**/__leave-import',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Leave import OT fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body></body></html>'}));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.startsWith('/api/v1/import-review/')&&url.pathname.endsWith('/apply'))applies.push(route.request().postData());
   const response=await route.fetch({url:api+url.pathname+url.search});
   if(url.pathname==='/api/v1/import-review/leave/preview'&&corrupt){
    corrupt=false;const json=await response.json();json.ot_impact={};return route.fulfill({response,json});
   }
   await route.fulfill({response});
  });
  await page.goto(base+'/__leave-import');
  await page.evaluate(async()=>{const m=await import('/src/operational-import.ts');await m.openOperationalImport('leave','2026-05',()=>window.imported=true,true);});
  const dialog=page.locator('dialog.operational-import');
  await dialog.locator('select[name="mode"]').selectOption('update_matching');
  await dialog.locator('input[type=file]').setInputFiles({name:'leave.csv',mimeType:'text/csv',buffer:Buffer.from('member_name,starts_on,status\nSafe Member,2026-05-20,approved\nSafe Member,2026-05-01,approved\n')});
  await dialog.locator('[data-map="0"]').waitFor({state:'attached'});
  await dialog.getByRole('button',{name:'Preview and normalize',exact:true}).click();
  await dialog.locator('[data-review-row]').first().waitFor();
  const evidence=dialog.locator('[data-leave-ot-impact]');
  await evidence.getByText('4 / 4 mandatory role-band slots covered',{exact:true}).waitFor();
  await evidence.getByText('3 / 4 mandatory role-band slots covered',{exact:true}).waitFor();
  assert.match(await evidence.textContent(),/Before import/);assert.match(await evidence.textContent(),/After proposed import/);
  // Exclusions invalidate the exact batch report; apply cannot reuse old rows.
  await dialog.locator('[data-include="CSV:3"]').uncheck();
  assert.match(await dialog.locator('[data-import-preview-authority]').textContent(),/refresh/i);
  assert.equal(await dialog.locator('[data-apply]').isDisabled(),true);assert.equal(applies.length,0);
  if(width===320){
   corrupt=true;await dialog.locator('[data-refresh]').click();
   await dialog.locator('[data-message]').filter({hasText:'OT impact evidence was incomplete'}).waitFor();
   assert.equal(await dialog.locator('[data-apply]').isDisabled(),true);assert.equal(applies.length,0);
  }
  await dialog.locator('[data-refresh]').click();
  await evidence.getByText('3 / 4 mandatory role-band slots covered',{exact:true}).waitFor();
  if(width===390){
   await fetch(api+'/__fixture/leave-repair-change',{method:'POST'});
   await dialog.locator('[data-acknowledge]').check();await dialog.locator('[data-apply]').click();
   await dialog.locator('[data-apply-status]').filter({hasText:/changed|refresh|preview again/i}).waitFor();
   assert.equal(applies.length,1);
   await dialog.locator('[data-refresh]').click();
   await evidence.getByText('3 / 4 mandatory role-band slots covered',{exact:true}).waitFor();
  }
  const axe=await new AxeBuilder({page}).include('[data-leave-ot-impact]').analyze();
  assert.deepEqual(axe.violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>row.id),[]);
  assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  if(width===390){await evidence.scrollIntoViewIfNeeded();await page.screenshot({path:'../docs/allocation-progress/n24-import-ot-390.png'});}
  await dialog.locator('[data-acknowledge]').check();await dialog.locator('[data-apply]').click();
  await page.waitForFunction(()=>window.imported===true);
  const leaves=await(await fetch(api+'/api/v1/leave/requests?month=2026-05')).json();
  const changed=leaves.find(row=>row.person.canonical_name==='Safe Member'&&row.starts_on==='2026-05-20');
  const excluded=leaves.find(row=>row.person.canonical_name==='Safe Member'&&row.starts_on==='2026-05-01');
  assert.equal(changed.status,'approved');assert.equal(excluded.status,'requested');
  assert.equal((await(await fetch(api+'/__fixture')).json()).active_assignments,2);
  assert.deepEqual(errors,[]);
  report.push({width,canonical_before:4,canonical_after:3,exclusion_requires_refresh:true,
               malformed_blocks:width===320,stale_recovered:width===390,excluded_request_unchanged:true,
               no_assignment_mutation:true,axe_serious_critical:0,page_errors:errors});
  await page.unrouteAll({behavior:'wait'});await context.close();
 }
 await writeFile('../docs/allocation-progress/n24-import-ot-browser.json',JSON.stringify(report,null,2)+'\n');
}finally{await browser.close();}
