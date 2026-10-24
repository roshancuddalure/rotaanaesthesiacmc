import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const paths=['src/main.ts','src/styles.css','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const initial=await hashes(),results=[];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const month of ['2026-02','2028-02','2026-10','2026-11']){
  const count=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();
  const dates=Array.from({length:count},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:width===320?'dark':'light',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];let reads=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(month=>{localStorage.setItem('duty_rota_auth_token','leave-boundaries');localStorage.setItem('duty_rota_working_month',month);},month);
  await page.route('**/api/**',async route=>{
   const q=route.request(),url=new URL(q.url());assert.equal(q.method(),'GET','Calendar inspection never writes');
   const response=await route.fetch({url:api+url.pathname+url.search});
   if(url.pathname.endsWith('/leave/calendar')){
    reads++;const data=await response.json();data.days={};
    Object.assign(data.summary,{month,starts_on:dates[0],ends_on:dates.at(-1),total_requests:0,people_on_leave:0,total_leave_days:0,busiest_day:null});
    return route.fulfill({json:data});
   }
   return route.fulfill({response});
  });
  await page.goto(base+'/#view=leave');
  const group=page.getByRole('group',{name:'Leave calendar view',exact:true});await group.waitFor();
  const monthButton=group.getByRole('button',{name:'Month',exact:true}),listButton=group.getByRole('button',{name:'Day list',exact:true});
  const calendar=page.locator('#leave-month-view'),days=calendar.locator('[data-leave-day]');
  assert.deepEqual(await days.evaluateAll(es=>es.map(e=>e.dataset.leaveDay)),dates);
  assert.equal(await calendar.locator('[role=grid],[role=gridcell]').count(),0,'Native button calendar has no incomplete grid keyboard contract');
  const padding=calendar.locator('.is-padding');
  assert.equal(await padding.count(),(new Date(dates[0]+'T00:00:00Z').getUTCDay()+6)%7);
  assert.ok(await padding.evaluateAll(es=>es.every(e=>e.getAttribute('aria-hidden')==='true'&&e.tabIndex===-1)));
  for(let i=0;i<count;i++){
   const label=await days.nth(i).getAttribute('aria-label');
   const date=new Date(dates[i]+'T00:00:00Z');
   const expected=`${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getUTCDay()]} ${i+1} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][date.getUTCMonth()]} ${date.getUTCFullYear()}: nobody on leave`;
   assert.equal(label,expected);
  }
  await days.first().focus();
  for(let i=1;i<count;i++){await page.keyboard.press('Tab');assert.equal(await days.nth(i).evaluate(e=>e===document.activeElement),true,'Chronological native tab order');}
  await page.keyboard.press('Enter');
  const dialog=page.locator('#leave-day-modal');await dialog.waitFor();
  assert.equal(await dialog.locator('h3').innerText(),(await days.last().getAttribute('aria-label')).split(':')[0]);
  await dialog.getByText('No leave requests recorded for this day.',{exact:true}).waitFor();
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  assert.equal(await days.last().evaluate(e=>e===document.activeElement),true,'Escape restores exact day opener');
  const before=reads;
  await listButton.focus();await page.keyboard.press('Enter');
  assert.equal(await listButton.getAttribute('aria-pressed'),'true');assert.equal(await monthButton.getAttribute('aria-pressed'),'false');
  assert.equal(await listButton.evaluate(e=>e===document.activeElement),true);
  assert.equal(await calendar.isVisible(),false);
  const list=page.locator('#leave-day-list-view');
  assert.deepEqual(await list.locator('[data-leave-day]').evaluateAll(es=>es.map(e=>e.dataset.leaveDay)),dates);
  await list.locator('[data-leave-day]').first().focus();await page.keyboard.press('Enter');await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  assert.equal(await list.locator('[data-leave-day]').first().evaluate(e=>e===document.activeElement),true);
  await monthButton.focus();await page.keyboard.press('Enter');assert.equal(await calendar.isVisible(),true);assert.equal(await list.isVisible(),false);
  assert.equal(await monthButton.getAttribute('aria-controls'),'leave-month-view');assert.equal(await listButton.getAttribute('aria-controls'),'leave-day-list-view');
  assert.equal(reads,before,'Switching/review does not refetch or mutate');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  results.push({engine,width,month,days:count,fullDateLabels:true,nativeChronologicalTabOrder:true,paddingUnfocusable:true,monthAndListEscapeRestoreExactDay:true,switchStateAndFocus:true,noRefetchOrWrites:true,noOverflow:true,errors});
  await page.waitForLoadState('networkidle');await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-leave-calendar-boundaries.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Actual app empty-month boundary fixtures, 28/29/30/31 days. GET-only disposable shell. Dark320/light1280; no physical or native screen-reader claim.',results},null,2)+'\n');
console.log(`Leave calendar boundaries: ${results.length} workflows passed`);
