import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const api='http://127.0.0.1:8040',base='http://127.0.0.1:5188';
assert.equal((await(await fetch(api+'/__fixture/member-leave-identity')).json()).identity,'member-leave-memory-fixture-v1');
const browser=await chromium.launch({headless:true}),report=[];
try{
 for(const width of [1440,390,320]){
  const seed=await(await fetch(api+'/__fixture/member-leave',{method:'POST'})).json();
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  let cancelPosts=0,loseCancellation=true,failProfileRead=false;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__member-actions',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Canonical member leave actions</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open member</button></body></html>'}));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/leave')&&url.pathname.includes('/member-workspace/')&&failProfileRead){failProfileRead=false;return route.fulfill({status:503,json:{detail:'Disposable saved profile read unavailable'}});}
   const response=await route.fetch({url:api+url.pathname+url.search});
   if(url.pathname.endsWith('/cancel')&&route.request().method()==='POST'){
    cancelPosts++;if(loseCancellation){loseCancellation=false;return route.fulfill({status:503,json:{detail:'Disposable lost response after commit'}});}
   }
   await route.fulfill({response});
  });
  await page.goto(base+'/__member-actions');await page.locator('#open').focus();
  await page.evaluate(async id=>{const {openMemberWorkspace}=await import('/src/member-workspace.ts');void openMemberWorkspace(id,true,()=>{},[id],'leave');},seed.person_id);
  await page.locator('[data-edit-record]').click();
  const editor=page.locator('dialog.record-workspace');
  await editor.locator('[name="status"]').selectOption('approved');
  await editor.locator('[name="change_reason"]').fill('Approved after reviewing request');
  await editor.getByRole('button',{name:'Review changes',exact:true}).click();
  await editor.getByRole('button',{name:'Save reviewed changes',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('dialog.record-workspace [data-save]').disabled);
  await fetch(api+'/__fixture/member-leave-change',{method:'POST'});
  await editor.locator('[data-save]').click();
  await editor.locator('[data-error]').getByText(/review|changed/i).waitFor();
  assert.equal(await editor.locator('[data-save]').isDisabled(),true);
  const before=await(await fetch(api+'/api/v1/leave/requests?month=2026-05')).json();assert.equal(before[0].status,'requested');
  await editor.getByRole('button',{name:'Review changes',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog.record-workspace [data-save]').disabled);
  failProfileRead=true;await editor.locator('[data-save]').click();await editor.waitFor({state:'detached'});
  await page.locator('dialog [data-retry]').click();
  await page.locator('.mw-record-status').getByText(/Approved/).waitFor();
  const global=await(await fetch(api+'/api/v1/leave/requests?month=2026-05')).json();assert.equal(global[0].status,'approved');
  let history=await(await fetch(api+`/api/v1/leave/requests/${seed.leave_id}/history`)).json();
  assert.equal(history.events.at(-1).reason,'Approved after reviewing request');
  const activity=await(await fetch(api+`/api/v1/admin/member-workspace/${seed.person_id}/activity`)).json();
  assert.doesNotMatch(JSON.stringify(activity),/PRIVATE/);
  await page.locator('[data-cancel-profile-leave]').click();
  const cancellation=page.getByRole('dialog',{name:'Cancel leave',exact:true});
  await cancellation.locator('[name="reason"]').fill('Dates no longer required');
  await cancellation.locator('[name="acknowledge"]').check();
  const axe=await new AxeBuilder({page}).include('dialog:last-of-type').analyze();
  assert.deepEqual(axe.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);
  await cancellation.locator('[data-cancel-confirm]').click();
  await cancellation.locator('[data-cancel-error]').getByText(/Cancellation was not confirmed/).waitFor();
  assert.equal(await cancellation.locator('[data-cancel-confirm]').isDisabled(),true);
  assert.equal(cancelPosts,1);
  await cancellation.locator('[data-cancel-read]').click();await cancellation.waitFor({state:'detached'});
  await page.locator('.mw-record-status').getByText(/Cancelled/).waitFor();
  assert.equal(cancelPosts,1);
  history=await(await fetch(api+`/api/v1/leave/requests/${seed.leave_id}/history`)).json();
  assert.equal(history.events.at(-1).reason,'Dates no longer required');
  assert.equal(history.current.status,'cancelled');
  await page.getByRole('button',{name:'Add Leave',exact:true}).click();
  const create=page.locator('dialog.record-workspace');
  await create.locator('[name="starts_on"]').fill('2026-05-21');
  await create.locator('[name="ends_on"]').fill('2026-05-21');
  await create.locator('[name="change_reason"]').fill('New requested absence');
  await create.getByRole('button',{name:'Review changes',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog.record-workspace [data-save]').disabled);
  await create.locator('[data-save]').click();await create.waitFor({state:'detached'});
  await page.waitForFunction(()=>document.querySelectorAll('[data-edit-record]').length===2);
  const createdRows=await(await fetch(api+'/api/v1/leave/requests?month=2026-05')).json();
  assert.equal(createdRows.length,2);
  const newRecord=createdRows.find(row=>row.id!==seed.leave_id);
  assert.equal(newRecord.status,'requested');assert.equal(newRecord.starts_on,'2026-05-21');
  const createdHistory=await(await fetch(api+`/api/v1/leave/requests/${newRecord.id}/history`)).json();
  assert.equal(createdHistory.events.at(-1).reason,'New requested absence');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  report.push({width,canonical_create_reason:true,canonical_approval_reason:true,stale_review_refused:true,profile_read_retry:true,global_profile_reconcile:true,activity_private_notes_omitted:true,cancel_lost_response_readonly_recovery:true,cancel_posts:cancelPosts,axe_serious_critical:0,errors});
  await context.close();
 }
 await writeFile('../docs/allocation-progress/n21-member-actions-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
