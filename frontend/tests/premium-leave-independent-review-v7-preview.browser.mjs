import _v7Assert from 'node:assert/strict';
import {readFile as _v7Read} from 'node:fs/promises';
import {createHash as _v7CreateHash} from 'node:crypto';
const _v7Base=process.env.LEAVE_REGRESSION_BASE||'http://127.0.0.1:5205';
_v7Assert.ok(['http://127.0.0.1:5197','http://127.0.0.1:5205'].includes(_v7Base));
const _v7Dir=process.env.LEAVE_STATUS_CANDIDATE_DIR||'../tmp/leave-status-v7';
const _v7Sha=b=>_v7CreateHash('sha256').update(b).digest('hex');
const _v7LivePaths=['src/main.ts','src/premium-theme.css','src/styles.css','src/services/api.ts','src/shell-accessibility.ts','src/leave-approval.ts','src/ui.ts'];
const _v7Snapshot=async()=>({live:Object.fromEntries(await Promise.all(_v7LivePaths.map(async p=>['frontend/'+p,_v7Sha(await _v7Read(p))]))),candidate:Object.fromEntries(await Promise.all(['main.ts','premium-theme.css','leave-calendar-focus.ts'].map(async p=>[p,_v7Sha(await _v7Read(_v7Dir+'/'+p))])))});
const _v7Start=await _v7Snapshot(),_v7TestSha=_v7Sha(await _v7Read(new URL(import.meta.url)));
const _v7Evidence={base:_v7Base,candidate_directory:_v7Dir,source_sha256:_v7Start.live,candidate_sha256:_v7Start.candidate,test_sha256:_v7TestSha,fixture_classification:"DEFENSIVE inherited leap-day fixture includes cancelled/rejected entries impossibleforrealactivecalendar; retainedsolelyforrenderingrobustness. Faithfulfixtureseparate."};
async function _v7Verify(){const end=await _v7Snapshot();_v7Assert.deepEqual(end,_v7Start,'Application and scratch candidate held');_v7Assert.equal(_v7Sha(await _v7Read(new URL(import.meta.url))),_v7TestSha,'Test source held');_v7Evidence.final_source_sha256=end.live;_v7Evidence.final_candidate_sha256=end.candidate;}
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const browser = await chromium.launch({headless:true});
const results=[];
const month='2028-02';
const statuses=['approved','requested','imported_pending_review','rejected','cancelled'];
const entries=statuses.map((status,i)=>({leave_id:`leave-${i}`,person_id:`person-${i}`,person_name:i===0?'<img src=x onerror="window.reviewInjected=true"> Long Member Name':'Member '+i,leave_type:'annual_leave',leave_slot:'full_day',status,unit:null,posting_type:null,call_level:'1ST_CALL'}));
try {
 for(const scheme of ['light','dark']) {
  const context=await browser.newContext({viewport:{width:320,height:568},colorScheme:scheme,reducedMotion:'reduce'}),page=await context.newPage();
  const requests=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','independent-review');localStorage.setItem('duty_rota_working_month','2028-02');});
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());requests.push({method:request.method(),path:url.pathname});assert.equal(request.method(),'GET');
   if(url.pathname.endsWith('/leave/calendar'))return route.fulfill({json:{month,summary:{month,starts_on:'2028-02-01',ends_on:'2028-02-29',total_requests:5,blocking_requests:3,people_on_leave:5,total_leave_days:5,busiest_day:{date:'2028-02-29',count:5},status_counts:{},type_counts:{},slot_counts:{},unit_counts:{},call_level_counts:{}},days:{'2028-02-29':entries}}});
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+url.pathname+url.search})});
  });
  await page.goto(_v7Base+'/#view=leave');
  const listButton=page.getByRole('button',{name:'Day list',exact:true});await listButton.waitFor();
  const before=requests.length;
  await listButton.focus();await page.keyboard.press('Enter');
  assert.equal(await listButton.getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#leave-month-view').isVisible(),false);
  assert.equal(await page.locator('.leave-agenda-day').count(),29);
  const empty=page.locator('.leave-agenda-day[data-leave-day="2028-02-01"]');assert.match(await empty.innerText(),/No leave records/);
  const leap=page.locator('.leave-agenda-day[data-leave-day="2028-02-29"]');
  const text=await leap.innerText();assert.match(text,/Tue 29 Feb 2028/);assert.match(text,/5 leave records/);assert.match(text,/Approved/);assert.match(text,/Imported, Pending Review/);assert.match(text,/View 2 more/);
  assert.equal(await leap.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.reviewInjected),undefined);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const axe=await new AxeBuilder({page}).include('.leave-calendar').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
  await leap.focus();await page.keyboard.press('Enter');
  const modal=page.locator('#leave-day-modal');await modal.waitFor();
  assert.match(await modal.innerText(),/5 leave records: 1 Approved.*1 Requested.*1 Imported, Pending Review.*1 Rejected.*1 Cancelled/);
  assert.equal(await modal.locator('.leave-day-person').count(),5);
  for(const status of ['Approved','Requested','Imported, Pending Review','Rejected','Cancelled'])assert.match(await modal.innerText(),new RegExp(status));
  await modal.getByRole('button',{name:'Close',exact:true}).click();await modal.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Month',exact:true}).click();
  assert.equal(await page.locator('#leave-day-list-view').isVisible(),false);
  assert.equal(await page.locator('.leave-calendar-grid [data-leave-day="2028-02-29"] .leave-day-card__count').innerText(),'5');
  assert.equal(requests.length,before,'Switch and modal need no extra requests');assert.deepEqual(errors,[]);
  results.push({scheme,width:320,height:568,leap_day_count:29,statuses_preserved:5,literal_hostile_text:true,keyboard_day_modal:true,toggle_network_calls:0,mutations:0,axe_findings:0});
  await context.close();
 }
} finally {await browser.close();}
await _v7Verify();await writeFile('../docs/premium-ui/qa-leave-independent-review-v7-preview.json',JSON.stringify({v7_preview:_v7Evidence,results,limits:'Chromium emulation and intercepted GET fixture only; physical devices and screen reader not checked. List shows existing first-three preview; full existing day modal preserves all five statuses.'},null,2)+'\n');
console.log('Independent leave review: 2 narrow-screen theme workflows passed');
