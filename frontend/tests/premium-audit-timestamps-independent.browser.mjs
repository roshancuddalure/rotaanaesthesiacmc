import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const times=['2026-10-22T00:15:00Z','2026-10-22T05:45:00+05:30','invalid-timestamp',null,'2026-10-22T00:15:00','2026-02-30T12:00:00Z','2028-02-29T12:00:00Z','2100-02-29T12:00:00Z','2000-02-29T12:00:00Z'];
const members=times.map((completed_at,index)=>({id:'member-'+index,filename:'members-'+index+'.csv',sheet:'Members',actor:'Reviewer '+index,status:'queued',completed_at,counts:{created:1}}));
const workflows=times.map((at,index)=>({id:'workflow-'+index,filename:'workflow-'+index+'.csv',month:'2026-10',actor:'Reviewer '+index,status:'queued',at,counts:{created:1}}));
const unit={id:'unit',name:'Main unit',code:'MAIN',campus:'Main',notes:null,aliases:[],active_status:'active',minimum_free_people:1,revision:'one',usage:{postings:0,duties:0,future_postings:0,future_duties:0,selected_members:0}};
const sourceNames=['audit-time.ts','workflow-import-history.ts','member-import-history.ts','reference-workspace.ts','member-bulk.ts','ui.ts'];
async function sources(){return Object.fromEntries(await Promise.all(sourceNames.map(async name=>['src/'+name,createHash('sha256').update(await readFile(new URL('../src/'+name,import.meta.url))).digest('hex')])));}
const initial=await sources();
// This oracle uses Intl directly, never the production helper. Preserve each view's prior zone policy.
async function checkStamp(page,locator,instant,zone){
 const text=await locator.innerText();
 const parts=await page.evaluate(({instant,zone})=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).filter(part=>part.type!=='literal').map(part=>[part.type,part.value])),{instant,zone});
 for(const token of [parts.year,parts.month,parts.day,`${parts.hour}:${parts.minute}`])assert.ok(text.includes(token),`Expected ${token} in ${text} for ${zone}`);
 assert.match(text,zone==='Asia/Kolkata'?/Asia\/(?:Kolkata|Calcutta)|IST|India/:zone==='UTC'?/UTC|GMT/:/America\/Los_Angeles|PDT|PST|GMT-0?7/,'Visible timezone context');
 return text;
}
for(const [engine,type]of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{for(const width of [320,1280])for(const timezoneId of ['UTC','America/Los_Angeles']){
  const context=await browser.newContext({viewport:{width,height:850},timezoneId}),page=await context.newPage(),errors=[],calls=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__audit-timestamps',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host"></main></body></html>'}));
  await page.route('**/api/**',route=>{
   const request=route.request(),path=new URL(request.url()).pathname;calls.push({method:request.method(),path});assert.equal(request.method(),'GET','Presentation workflow must not write');
   if(path==='/api/v1/admin/members/import/history')return route.fulfill({json:members});
   if(path==='/api/v1/imports/leave/history')return route.fulfill({json:{items:workflows,offset:0,has_more:false}});
   if(path==='/api/v1/normalization/units')return route.fulfill({json:[unit]});
   if(path==='/api/v1/normalization/activity')return route.fulfill({json:times.map((created_at,index)=>({action:'unit_updated',operator:'Reviewer '+index,created_at,details:{after:{name:'Main unit'}}}))});
   if(path==='/api/v1/admin/members/archive-all/preview')return route.fulfill({json:{members:0,linked_duties:0,leave:0,postings:0,future_duties:0,confirm_phrase:'ARCHIVE ALL',preview_token:'unused'}});
   if(path==='/api/v1/admin/members/archive-all/batches')return route.fulfill({json:times.map((at,index)=>({batch_id:'batch-'+index,at,operator_name:'Reviewer '+index,archived:1,restored:1}))});
   throw new Error('Unexpected GET '+path);
  });
  await page.goto(base+'/__audit-timestamps');
  const malformed=await page.evaluate(async()=>{
   const {formatAuditTimestamp}=await import('/src/audit-time.ts');
   return [42,{},[],false].map(value=>formatAuditTimestamp(value));
  });
  assert.deepEqual(malformed,Array(4).fill('Time unavailable'),'Malformed nonstring payloads have a safe display fallback');
  const host=page.locator('#host');
  await page.evaluate(async()=>{await(await import('/src/member-import-history.ts')).mountMemberImportHistory(document.querySelector('#host'));});
  const memberRows=host.locator('tbody tr');
  const india=[];for(let index=0;index<2;index++)india.push(await checkStamp(page,memberRows.nth(index).locator('td').nth(1),times[index],'Asia/Kolkata'));
  assert.equal(india[0],india[1],'Equivalent offset instants preserve fixed India policy');
  assert.match(await memberRows.nth(2).locator('td').nth(1).innerText(),/unavailable|not recorded|invalid/i);
  assert.equal(await memberRows.nth(3).locator('td').nth(1).innerText(),'queued','Missing member completion retains existing batch status');
  assert.match(await memberRows.nth(4).locator('td').nth(1).innerText(),/2026-10-22T00:15:00.*time zone not recorded/);
  for(const index of [5,7])assert.equal(await memberRows.nth(index).locator('td').nth(1).innerText(),'Time unavailable');
  for(const index of [6,8])await checkStamp(page,memberRows.nth(index).locator('td').nth(1),times[index],'Asia/Kolkata');
  await page.evaluate(async()=>{await(await import('/src/workflow-import-history.ts')).mountWorkflowImportHistory(document.querySelector('#host'),'leave','2026-10');});
  const workflowRows=host.locator('tbody tr'),local=[];
  for(let index=0;index<2;index++)local.push(await checkStamp(page,workflowRows.nth(index).locator('td').nth(1).locator('small'),times[index],timezoneId));
  assert.equal(local[0],local[1],'Equivalent offset instants preserve browser-local policy');
  assert.match(await workflowRows.nth(2).locator('td').nth(1).innerText(),/unavailable|not recorded|invalid/i);
  assert.match(await workflowRows.nth(3).locator('td').nth(1).innerText(),/queued/);
  assert.match(await workflowRows.nth(4).locator('td').nth(1).innerText(),/2026-10-22T00:15:00.*time zone not recorded/);
  for(const index of [5,7])assert.equal(await workflowRows.nth(index).locator('td').nth(1).locator('small').innerText(),'Time unavailable');
  for(const index of [6,8])await checkStamp(page,workflowRows.nth(index).locator('td').nth(1).locator('small'),times[index],timezoneId);
  await page.evaluate(async()=>{await(await import('/src/reference-workspace.ts')).openUnitRegistry(()=>{},'unit');});
  await page.getByRole('button',{name:'View unit activity',exact:true}).click();
  const activity=page.getByRole('dialog',{name:'Reference activity',exact:true});await activity.locator('.mw-history').first().waitFor();
  for(let index=0;index<2;index++)await checkStamp(page,activity.locator('.mw-history').nth(index),times[index],timezoneId);
  for(const index of [2,3])assert.match(await activity.locator('.mw-history').nth(index).innerText(),/unavailable|not recorded|invalid/i);
  assert.match(await activity.locator('.mw-history').nth(4).innerText(),/2026-10-22T00:15:00.*time zone not recorded/);
  for(const index of [5,7])assert.match(await activity.locator('.mw-history').nth(index).innerText(),/Time unavailable/);
  for(const index of [6,8])await checkStamp(page,activity.locator('.mw-history').nth(index),times[index],timezoneId);
  await activity.getByRole('button',{name:'Close activity',exact:true}).click();
  await page.getByRole('button',{name:'Close unit management',exact:true}).click();
  await page.evaluate(async()=>{await(await import('/src/member-bulk.ts')).openArchiveAll(()=>{});});
  const archive=page.getByRole('dialog',{name:'Clear all members',exact:true});await archive.locator('.archive-all__history li').first().waitFor();
  for(let index=0;index<2;index++)await checkStamp(page,archive.locator('.archive-all__history li').nth(index),times[index],timezoneId);
  for(const index of [2,3])assert.match(await archive.locator('.archive-all__history li').nth(index).innerText(),/unavailable|not recorded|invalid/i);
  assert.match(await archive.locator('.archive-all__history li').nth(4).innerText(),/2026-10-22T00:15:00.*time zone not recorded/);
  for(const index of [5,7])assert.match(await archive.locator('.archive-all__history li').nth(index).innerText(),/Time unavailable/);
  for(const index of [6,8])await checkStamp(page,archive.locator('.archive-all__history li').nth(index),times[index],timezoneId);
  assert.equal(await archive.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
  assert.deepEqual(errors,[]);assert.equal(calls.every(call=>call.method==='GET'),true);
  results.push({engine,width,timezoneId,member_history_preserves_india_zone:true,workflow_reference_archive_preserve_browser_zone:true,equivalent_offset_instants:true,near_midnight_date_boundary:true,explicit_visible_zone:true,invalid_and_missing_fallback:true,malformed_nonstring_helper_fallback:true,impossible_february_date_rejected:true,nonleap_century_rejected:true,ordinary_and_century_leap_dates_preserved:true,optional_batch_status_preserved:true,mutations:0,javascript_errors:errors,intercepted_gets:calls.length});
  await context.close();
 }}finally{await browser.close();}
}
const final=await sources();assert.deepEqual(final,initial,'Source changed during run; repeat on frozen snapshot');
await writeFile('../docs/premium-ui/qa-audit-timestamps-independent.json',JSON.stringify({scope:'Actual shipped component functions in an isolated CSS harness; four audit/history views, three engines, two widths and two browser zones. All GETs intercepted, no live API or mutation. Intl oracle independent of production helper. No date-only scheduling/persisted semantics, physical device or native screen-reader claim.',sourceHashes:final,resolved_helper_probe:{original_input:'2026-02-30T12:00:00Z',original_observation:'JavaScript normalized impossible date to02March2026',current_observation:'Time unavailable across all four actual components and12 matrices',additional_bounds:'2100February29 rejected;2028February29 and2000February29 preserved',limit:'Bounded Gregorian malformed-input fallback checks; not a claim to validate every possible API timestamp.'},results},null,2)+'\n');
console.log(`${results.length} audit timestamp component matrices passed`);
