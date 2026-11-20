import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base='http://127.0.0.1:5188',api='http://127.0.0.1:8038';
const browser=await chromium.launch({headless:true}),report={at:new Date().toISOString(),cases:[]};
try{
 for(const width of [1440,390]){
  const seeded=await(await fetch(api+'/__fixture/template?scenario=safe',{method:'POST'})).json();
  const unit=seeded.slots[0].unit_id;
  const exported=await(await fetch(`${api}/api/v1/admin/ot-calendars/${unit}/transfer/export?month=2026-11`)).json();
  const changed=structuredClone(exported);changed.document.rows.find(r=>r.day==='2026-11-19').bands[0].minimum=2;
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__transfer',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>OT transfer verification</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host" style="padding:16px;max-width:1250px;margin:auto"></main></body></html>'}));
  await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),response=await route.fetch({url:api+u.pathname+u.search});await route.fulfill({response});});
  await page.goto(base+'/__transfer');await page.evaluate(async()=>{(await import('/src/services/api.ts')).setAuthToken('disposable');await(await import('/src/ot-calendar.ts')).renderOtCalendar(document.querySelector('#host'));});
  await page.getByLabel('Unit',{exact:true}).selectOption({label:'Unit 4'});
  const panel=page.locator('[data-ot-transfer-panel]');
  await panel.getByLabel('Export month').fill('2026-11');
  const download=page.waitForEvent('download');await panel.getByRole('button',{name:'Download saved month JSON'}).click();assert.match((await download).suggestedFilename(),/\.json$/);
  const before=await(await fetch(`${api}/api/v1/admin/ot-calendars/${unit}/versions`)).json();
  await panel.locator('input[type=file]').setInputFiles({name:'reviewed-November.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(changed))});
  await panel.getByRole('button',{name:'Preview file changes'}).click();await panel.getByText('Preview ready. No calendar changes have been saved.',{exact:true}).waitFor();
  assert.match(await panel.innerText(),/1 changed area\/date rows/);
  assert.equal(await panel.getByRole('button',{name:'Apply reviewed import'}).isDisabled(),true);
  assert.equal((await(await fetch(`${api}/api/v1/admin/ot-calendars/${unit}/versions`)).json()).versions.length,before.versions.length);
  const axe=await new AxeBuilder({page}).include('[data-ot-transfer-panel]').analyze();assert.deepEqual(axe.violations.filter(v=>['critical','serious'].includes(v.impact)).map(v=>v.id),[]);
  await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Apply reviewed import'}).click();
  await page.locator('.ot-area strong').filter({hasText:'2026-11-19'}).waitFor();
  const saved=await(await fetch(`${api}/api/v1/admin/ot-calendars/${unit}/day?day=2026-11-19`)).json();assert.equal(saved.requirements[0].minimum,2);
  await panel.locator('input[type=file]').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{bad')});await panel.getByRole('button',{name:'Preview file changes'}).click();await panel.getByText(/File preview unavailable/).waitFor();assert.equal(await panel.locator('[data-transfer-apply]').count(),0);
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  report.cases.push({width,download:true,preview_read_only:true,explicit_confirm:true,applied_minimum:2,malformed_refused:true,errors});await context.close();
 }
}catch(error){report.error=String(error);throw error;}
finally{await browser.close();await writeFile('../docs/allocation-progress/n15-transfer-browser.json',JSON.stringify(report,null,2)+'\n');}
console.log(`Reviewed OT transfer browser checks passed: ${report.cases.length} viewports.`);
