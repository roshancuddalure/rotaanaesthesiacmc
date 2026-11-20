import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base='http://127.0.0.1:5188',api='http://127.0.0.1:8038',browser=await chromium.launch({headless:true}),report={at:new Date().toISOString(),cases:[]};
try{
 for(const mode of ['stale','lost-response']){
  const seed=await(await fetch(api+'/__fixture/template?scenario=safe',{method:'POST'})).json(),unit=seed.slots[0].unit_id;
  const exported=await(await fetch(`${api}/api/v1/admin/ot-calendars/${unit}/transfer/export?month=2026-11`)).json();
  exported.document.rows.find(r=>r.day==='2026-11-19').bands[0].minimum=2;
  const context=await browser.newContext({viewport:{width:390,height:960}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__transfer-recovery',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>OT import recovery</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host" style="padding:16px"></main></body></html>'}));
  await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),response=await route.fetch({url:api+u.pathname+u.search});await route.fulfill({response});});
  await page.goto(base+'/__transfer-recovery');await page.evaluate(async()=>{(await import('/src/services/api.ts')).setAuthToken('disposable');await(await import('/src/ot-calendar.ts')).renderOtCalendar(document.querySelector('#host'));});
  await page.getByLabel('Unit',{exact:true}).selectOption({label:'Unit 4'});
  const panel=page.locator('[data-ot-transfer-panel]');await panel.locator('input[type=file]').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await panel.getByRole('button',{name:'Preview file changes'}).click();await panel.getByText('Preview ready. No calendar changes have been saved.',{exact:true}).waitFor();
  if(mode==='stale'){
   const current=await(await fetch(`${api}/api/v1/admin/ot-calendars/${unit}`)).json();
   current.configuration.weekly[0].bands[0].minimum=1;
   assert.equal((await fetch(`${api}/api/v1/admin/ot-calendars/${unit}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({base_revision:current.revision,configuration:current.configuration})})).status,200);
  }
  let applies=0;
  await page.route('**/transfer/apply',async route=>{
   applies++;const u=new URL(route.request().url()),response=await route.fetch({url:api+u.pathname+u.search});
   if(mode==='lost-response'){assert.equal(response.status(),200);await route.fulfill({status:503,json:{detail:'Response lost after successful commit'}});}
   else await route.fulfill({response});
  });
  await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Apply reviewed import'}).click();
  await panel.getByText(/Import outcome requires review:/).waitFor();
  assert.equal(applies,1);assert.equal(await panel.locator('[data-transfer-apply]').count(),0);
  const saved=await(await fetch(`${api}/api/v1/admin/ot-calendars/${unit}/day?day=2026-11-19`)).json();
  assert.equal(saved.requirements[0].minimum,mode==='lost-response'?2:3);
  const before=(await(await fetch(`${api}/api/v1/admin/ot-calendars/${unit}/versions`)).json()).versions.length;
  await panel.getByRole('button',{name:'Read latest saved calendar'}).click();
  await page.locator('[data-ot-transfer-panel] input[type=file]').waitFor();
  assert.equal(await page.locator('[data-transfer-apply]').count(),0);assert.equal(applies,1);
  assert.equal((await(await fetch(`${api}/api/v1/admin/ot-calendars/${unit}/versions`)).json()).versions.length,before);
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  report.cases.push({mode,applies,minimum:saved.requirements[0].minimum,history_versions:before,read_recovery:true,no_automatic_retry:true,errors});await context.close();
 }
}catch(error){report.error=String(error);throw error;}
finally{await browser.close();await writeFile('../docs/allocation-progress/n15-recovery-browser.json',JSON.stringify(report,null,2)+'\n');}
console.log(`OT import recovery browser checks passed: ${report.cases.length} cases.`);
