import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const api='http://127.0.0.1:8041',base='http://127.0.0.1:5188';
assert.equal((await(await fetch(api+'/__fixture/leave-repair-identity')).json()).identity,'leave-repair-memory-fixture-v1');
const browser=await chromium.launch({headless:true}),report=[];
try{
 for(const width of [1440,390,320]){
  let seed=await(await fetch(api+'/__fixture/leave-repair',{method:'POST'})).json();
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],calls=[];
  let mode='normal';
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__leave-impact',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Leave impact fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open leave review</button></body></html>'}));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());calls.push({path:url.pathname,method:route.request().method()});
   const response=await route.fetch({url:api+url.pathname+url.search});
   if(url.pathname.endsWith('/approval-preview')&&mode==='bad'){
    mode='normal';const body=await response.json();body.ot_impact={};return route.fulfill({response,json:body});
   }
   if(url.pathname.endsWith('/repair-proposal')&&mode==='lost'){
    mode='normal';assert.equal(response.status(),200);return route.fulfill({status:503,json:{detail:'Saved response lost in disposable browser test'}});
   }
   await route.fulfill({response});
  });
  await page.goto(base+'/__leave-impact');await page.locator('#open').focus();
  if(width===320)mode='bad';
  await page.evaluate(async()=>{const m=await import('/src/leave-approval.ts');m.openMonthlyLeaveApproval('2026-05',count=>window.approved=count);});
  const approval=page.getByRole('dialog',{name:'Approve monthly leave',exact:true});
  if(width===320){
   await approval.getByRole('alert').filter({hasText:'OT impact evidence was incomplete'}).waitFor();assert.equal(await approval.locator('[data-approve]').isDisabled(),true);
   await fetch(api+'/__fixture/leave-repair-unknown',{method:'POST'});await approval.locator('[data-refresh]').click();
   await approval.getByText('Some OT impact is unknown. This review does not certify adequate coverage.',{exact:true}).waitFor();
   assert.equal(await approval.locator('meter').count(),0);assert.doesNotMatch(await approval.textContent(),/0 \/ 0/);
   await approval.locator('[data-close]').click();
   seed=await(await fetch(api+'/__fixture/leave-repair',{method:'POST'})).json();
   await page.evaluate(async()=>{const m=await import('/src/leave-approval.ts');m.openMonthlyLeaveApproval('2026-05',count=>window.approved=count);});
  }
  await approval.getByText('2 pending requests to approve.',{exact:true}).waitFor();
  await approval.getByText('4 / 4 mandatory role-band slots covered',{exact:true}).waitFor();
  await approval.getByText('3 / 4 mandatory role-band slots covered',{exact:true}).waitFor();
  assert.match(await approval.textContent(),/Protected period: an authorized administrator/);
  assert.match(await approval.textContent(),/Actual time overlap, including overnight/);
  assert.doesNotMatch(await approval.textContent(),/PRIVATE/);
  await approval.locator('[data-confirm]').check();assert.equal(await approval.locator('[data-approve]').isDisabled(),true);
  await approval.locator('[data-duty-ack]').check();
  const axe=await new AxeBuilder({page}).include('dialog').analyze();
  assert.deepEqual(axe.violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>row.id),[]);
  assert.equal(await approval.locator('.mw-content').evaluate(element=>element.scrollWidth<=element.clientWidth),true);
  if(width===390)await page.screenshot({path:'../docs/allocation-progress/n24-leave-approval-390.png'});
  await approval.locator('[data-approve]').click();await approval.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.approved),2);
  assert.equal((await(await fetch(api+'/__fixture')).json()).active_assignments,2);

  await page.evaluate(async()=>{const m=await import('/src/leave-repair.ts');m.openLeaveRepairs('2026-05',()=>window.repaired=true);});
  const repair=page.getByRole('dialog',{name:'Review leave repairs',exact:true});
  await repair.locator(`[data-leave="${seed.repair_leave}"]`).waitFor();
  const rows=await(await fetch(api+'/api/v1/leave/requests?month=2026-05')).json();
  const overnight=rows.find(row=>row.starts_on==='2026-05-01');
  await repair.locator(`[data-leave="${seed.repair_leave}"]`).focus();await page.keyboard.press('Space');
  assert.equal(await repair.locator(`[data-leave="${seed.repair_leave}"]`).isChecked(),true);
  await repair.locator(`[data-leave="${overnight.id}"]`).check();
  await repair.locator('[data-read]').click();await repair.getByRole('heading',{name:'Affected duties and protection'}).waitFor();
  assert.match(await repair.textContent(),/Protected period/);
  assert.equal(await repair.locator(`[data-repair="${seed.protected_slot}"]`).count(),0);
  const selected=()=>repair.locator(`[data-repair="${seed.repair_slot}"]`);
  await selected().check();assert.equal(await repair.locator('[data-create]').isDisabled(),true);
  await repair.locator(`[data-lock="${seed.repair_slot}"]`).check();assert.equal(await selected().isChecked(),false);assert.equal(await selected().isDisabled(),true);
  await repair.locator(`[data-lock="${seed.repair_slot}"]`).uncheck();await selected().check();
  await repair.locator('[data-read]').click();await repair.getByText('1 selected for repair; 2 other template slots preserved.',{exact:true}).waitFor();
  await repair.locator('[data-confirm]').check();
  if(width===320){
   await fetch(api+'/__fixture/leave-repair-change',{method:'POST'});
   await repair.locator('[data-create]').click();await repair.getByRole('alert').filter({hasText:'refresh'}).waitFor();
   assert.equal((await(await fetch(api+'/__fixture')).json()).jobs.length,0);
   await repair.locator('[data-read]').click();await repair.locator('[data-confirm]').check();
  }
  const before=calls.filter(row=>row.path.endsWith('/repair-proposal')).length;
  if(width===390)mode='lost';
  await repair.locator('[data-create]').click();
  if(width===390){await repair.locator('[data-recover]').waitFor();assert.equal(await repair.locator('[data-create]').isDisabled(),true);await repair.locator('[data-recover]').click();}
  await repair.locator('[data-open]').waitFor();
  assert.equal(calls.filter(row=>row.path.endsWith('/repair-proposal')).length,before+1);
  const state=await(await fetch(api+'/__fixture')).json();assert.equal(state.jobs.length,1);assert.equal(state.active_assignments,2);
  const repairAxe=await new AxeBuilder({page}).include('dialog').analyze();
  assert.deepEqual(repairAxe.violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>row.id),[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await repair.locator('.mw-content').evaluate(element=>element.scrollWidth<=element.clientWidth),true);
  if(width===390)await page.screenshot({path:'../docs/allocation-progress/n24-leave-repair-390.png'});
  assert.equal(await repair.locator('[data-open]').evaluate(element=>element===document.activeElement),true);
  await page.keyboard.press('Enter');
  const generator=page.getByRole('dialog',{name:'Intelligent rota generator',exact:true});
  await generator.locator('[data-resume]').waitFor();await generator.locator('[data-resume]').click();
  await generator.locator('[data-confirm]').waitFor({timeout:90000});
  assert.equal(await generator.locator('[data-apply]').isDisabled(),true);
  const ready=await(await fetch(api+'/__fixture')).json();assert.equal(ready.active_assignments,2);
  await generator.locator('[data-confirm]').check();await generator.locator('[data-apply]').click();
  await page.waitForFunction(()=>window.repaired===true);
  const applied=await(await fetch(api+'/__fixture')).json();assert.equal(applied.active_assignments,2);assert.equal(applied.cancelled_assignments,1);assert.equal(applied.assignments,3);
  assert.ok(calls.some(row=>row.path===`/api/v1/rota-compute/jobs/${state.jobs[0].id}`));
  assert.deepEqual(errors,[]);
  report.push({width,canonical_ot_before:4,canonical_ot_after:3,protected_overnight:true,scoped_repair:true,empty_slots_preserved:true,stale_review:width===320,lost_response_recovered_without_repost:width===390,axe_serious_critical:0});
  await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:1000}}),page=await context.newPage(),errors=[],writes=[];
 let hold=false,release,started,manualBad=false;
 const held=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','disposable');localStorage.setItem('duty_rota_working_month','2026-05');});
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());if(route.request().method()==='POST')writes.push(url.pathname);
  const response=await route.fetch({url:api+url.pathname+url.search});
  if(manualBad&&url.pathname.endsWith('/normalization/records/leave/preview')){manualBad=false;const body=await response.json();body.ot_impact={};return route.fulfill({response,json:body});}
  if(hold&&url.pathname.endsWith('/repair-preview')){started();await held;}
  await route.fulfill({response});
 });
 await page.goto(base);await page.getByRole('heading',{name:'Duty workload at a glance',exact:true}).waitFor();
 await page.locator('[data-view="leave"]').first().evaluate(button=>button.click());
 await page.locator('[data-leave-repairs]').waitFor();
 assert.equal(await page.locator('[data-approve-month-leave]').isDisabled(),true);
 await page.locator('[data-leave-repairs]').click();
 const dialog=page.getByRole('dialog',{name:'Review leave repairs',exact:true});
 await dialog.locator('[data-leave]').first().check();hold=true;
 const responseDone=page.waitForResponse(response=>response.url().endsWith('/api/v1/leave/repair-preview'));
 await dialog.locator('[data-read]').click();await ready;
 await dialog.evaluate(element=>element.remove());release();await responseDone;await page.waitForLoadState('networkidle');
 assert.equal(await page.locator('dialog').count(),0);assert.equal(writes.filter(path=>path.endsWith('/repair-proposal')).length,0);
 assert.deepEqual(errors,[]);report.push({main_screen_entry:true,approved_only_entry_available:true,closed_workspace_late_response_discarded:true,no_followup_proposal:true});
 hold=false;await fetch(api+'/__fixture/leave-repair',{method:'POST'});
 const manualRows=await(await fetch(api+'/api/v1/leave/requests?month=2026-05')).json();
 const pending=manualRows.find(row=>row.starts_on==='2026-05-01');
 await page.evaluate(async row=>{const m=await import('/src/record-workspace.ts');await m.openRecordEditor('leave',row.person.id,row.id,true,()=>window.manualSaved=true);},pending);
 const editor=page.getByRole('dialog',{name:'Edit leave',exact:true});
 await editor.locator('[name="status"]').selectOption('approved');manualBad=true;
 await editor.getByRole('button',{name:'Review changes',exact:true}).click();
 await editor.getByText('OT impact evidence was incomplete. Refresh the review before continuing.',{exact:true}).waitFor();
 assert.equal(await editor.locator('[data-save]').isDisabled(),true);
 await editor.getByRole('button',{name:'Review changes',exact:true}).click();
 await editor.locator('[data-leave-ot-impact]').waitFor();
 assert.match(await editor.textContent(),/Before change/);assert.match(await editor.textContent(),/After proposed change/);
 assert.match(await editor.textContent(),/Protected period: an authorized administrator/);
 assert.equal(await editor.locator('[data-save]').isEnabled(),true);
 const manualAxe=await new AxeBuilder({page}).include('dialog').analyze();
 assert.deepEqual(manualAxe.violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>row.id),[]);
 await editor.locator('[data-save]').click();await page.waitForFunction(()=>window.manualSaved===true);
 assert.equal((await(await fetch(api+'/__fixture')).json()).active_assignments,2);
 assert.deepEqual(errors,[]);report.push({manual_editor_ot_and_protected_impacts:true,malformed_evidence_blocks_save:true,canonical_save_preserves_duties:true});
 await context.close();
}finally{await browser.close();}
await writeFile('../docs/allocation-progress/n24-leave-ui-browser.json',JSON.stringify(report,null,2)+'\n');
console.log('N24 canonical leave impact and repair: three responsive workflows passed.');
