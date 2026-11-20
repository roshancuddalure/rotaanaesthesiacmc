import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const api='http://127.0.0.1:8041',base='http://127.0.0.1:5188';
assert.equal((await(await fetch(api+'/__fixture/leave-repair-identity')).json()).identity,'leave-repair-memory-fixture-v1');
const browser=await chromium.launch({headless:true}),report=[];
try{
 for(const width of [1440,390,320]){
  const seed=await(await fetch(api+'/__fixture/leave-ot-only',{method:'POST'})).json();
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  let bad=false,proposals=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__ot-repair',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>OT-only repair fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open repairs</button></body></html>'}));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/repair-proposal'))proposals++;
   const response=await route.fetch({url:api+url.pathname+url.search});
   if(url.pathname.endsWith('/repair-preview')&&bad){
    bad=false;const body=await response.json();body.ot_repair_scope={};return route.fulfill({response,json:body});
   }
   return route.fulfill({response});
  });
  await page.goto(base+'/__ot-repair');
  await page.evaluate(async()=>{const m=await import('/src/leave-repair.ts');m.openLeaveRepairs('2026-05',()=>window.repaired=true);});
  const dialog=page.getByRole('dialog',{name:'Review leave repairs',exact:true});
  await dialog.locator(`[data-leave="${seed.repair_leave}"]`).check();
  if(width===320){
   bad=true;await dialog.locator('[data-read]').click();
   await dialog.getByRole('alert').filter({hasText:'OT repair scope was incomplete'}).waitFor();
   assert.equal(await dialog.locator('[data-create]').isDisabled(),true);
  }
  await dialog.locator('[data-read]').click();
  await dialog.getByText('OT repair scope: evaluated.',{exact:true}).waitFor();
  assert.match(await dialog.textContent(),/Safe Member/);
  assert.match(await dialog.textContent(),/deficient OT\/staffing component/);
  const repair=dialog.locator(`[data-repair="${seed.repair_slot}"]`);
  await repair.focus();await page.keyboard.press('Space');
  assert.equal(await repair.isChecked(),true);
  await dialog.locator(`[data-lock="${seed.repair_slot}"]`).check();
  assert.equal(await dialog.locator(`[data-repair="${seed.repair_slot}"]`).isChecked(),false);
  assert.equal(await dialog.locator(`[data-repair="${seed.repair_slot}"]`).isDisabled(),true);
  await dialog.locator(`[data-lock="${seed.repair_slot}"]`).uncheck();
  await dialog.locator(`[data-repair="${seed.repair_slot}"]`).check();
  await dialog.locator('[data-read]').click();
  await dialog.getByText(/1 selected for repair;/).waitFor();
  assert.equal(await dialog.locator('.mw-content').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const axe=await new AxeBuilder({page}).include('dialog').analyze();
  assert.deepEqual(axe.violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>row.id),[]);
  if(width===390)await page.screenshot({path:'../docs/allocation-progress/n24-ot-only-repair-390.png'});
  assert.equal((await(await fetch(api+'/__fixture')).json()).active_assignments,1);
  await dialog.locator('[data-confirm]').check();await dialog.locator('[data-create]').click();
  await dialog.locator('[data-open]').waitFor();assert.equal(proposals,1);
  assert.equal((await(await fetch(api+'/__fixture')).json()).active_assignments,1);
  if(width===1440){
   await dialog.locator('[data-open]').click();
   const generator=page.getByRole('dialog',{name:'Intelligent rota generator',exact:true});
   await generator.locator('[data-resume]').waitFor();
   // Exact saved job remains an explicit action; no generation/apply on open.
   assert.equal((await(await fetch(api+'/__fixture')).json()).active_assignments,1);
   await generator.locator('[data-resume]').click();
   await generator.locator('[data-confirm]').waitFor({timeout:90000});
   assert.equal(await generator.locator('[data-apply]').isDisabled(),true);
   await generator.locator('[data-confirm]').check();await generator.locator('[data-apply]').click();
   await page.waitForFunction(()=>window.repaired===true);
   const saved=await(await fetch(api+'/__fixture')).json();
   assert.equal(saved.active_assignments,1);assert.equal(saved.cancelled_assignments,1);assert.equal(saved.assignments,2);
  }
  assert.deepEqual(errors,[]);
  report.push({width,other_person_candidate:true,explicit_lock:true,malformed_rejected:width===320,
               creates_once_no_apply:true,overflow:false,axe_serious_critical:0,page_errors:errors});
  await page.unrouteAll({behavior:'wait'});await context.close();
 }
 await writeFile('../docs/allocation-progress/n24-ot-only-browser.json',JSON.stringify(report,null,2)+'\n');
}finally{await browser.close();}
