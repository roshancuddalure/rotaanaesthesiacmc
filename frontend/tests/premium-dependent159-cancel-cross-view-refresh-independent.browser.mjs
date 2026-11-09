import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),initial=sha(await readFile('src/main.ts')),results=[];
assert.equal(initial,'e88c69570e7faf9b4277b541e073c8bd2ca3805c23f4feead544f16770f6e07a');
const unit={id:'cache-unit',name:'Cache Audit Unit',campus:'Main',code:'CACHE',minimum_free_people:1,active_status:'active'};
const person={id:'cache-person',canonical_name:'Dr Cache Audit',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]};
const assignment={id:'cache-posting',person,unit,posting_type:'2ND_CALL',starts_on:'2026-11-01',ends_on:'2026-11-30',source:'manual',notes:null};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],requests=[];let cancelled=false,unitReads=0,mutations=0;
  const leave=()=>({id:'cache-leave',person,leave_type:'casual_leave',leave_slot:'full_day',starts_on:'2026-11-05',ends_on:'2026-11-05',status:cancelled?'cancelled':'approved',days:1,source:'manual',raw_person_name:null,notes:null});
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','cache-independent');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());requests.push({method:q.method(),path:u.pathname});
   if(q.method()!=='GET'){assert.equal(q.method(),'POST');assert.equal(u.pathname,'/api/v1/leave/requests/cache-leave/cancel');assert.equal(q.postData(),'{}');mutations++;cancelled=true;return route.fulfill({json:leave()});}
   if(u.pathname==='/api/v1/admin/members')return route.fulfill({json:[person]});
   if(u.pathname==='/api/v1/unit-management/month'){unitReads++;return route.fulfill({json:{month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',units:[unit],assignments:[assignment],unit_summaries:[{unit_id:unit.id,assigned_members:1,people_with_leave:cancelled?0:1,leave_days:cancelled?0:1,leave_by_call_level:{}}],unit_call_minimums:[],validation_issues:[]}});}
   if(u.pathname==='/api/v1/leave/requests')return route.fulfill({json:[leave()]});
   if(u.pathname==='/api/v1/leave/calendar')return route.fulfill({json:{month:'2026-11',summary:{month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',total_requests:1,blocking_requests:cancelled?0:1,people_on_leave:cancelled?0:1,total_leave_days:cancelled?0:1,busiest_day:null,status_counts:{},type_counts:{},slot_counts:{},unit_counts:{},call_level_counts:{}},days:{}}});
   if(u.pathname==='/api/v1/leave/pressure')return route.fulfill({json:{month:'2026-11',days:[],call_level_totals:{},unit_totals:{}}});
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search,maxRetries:2})});
  });
  try{
   await page.goto('http://127.0.0.1:5197/#view=units');const card=()=>page.locator('[data-unit-board-card="unit:cache-unit"]');await card().waitFor();
   const initialText=await card().innerText();assert.match(initialText,/0 without active leave records/);assert.equal(unitReads,1);
   await page.evaluate(()=>location.hash='#view=leave');const region=width===320?page.locator('.card-list[aria-label="Leave this month"]:visible'):page.locator('section[aria-labelledby="leave-list-title"]:visible');
   const row=region.locator(width===320?'article.leave-card':'tbody tr').filter({has:page.locator('[data-cancel-leave="cache-leave"]')});await row.waitFor();await row.locator('details.row-menu > summary').click();const cancel=row.locator('[data-cancel-leave="cache-leave"]');await cancel.focus();await page.keyboard.press('Enter');
   await page.getByText('Leave cancelled',{exact:true}).waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('.leave-card,tr')].some(e=>e.textContent?.includes('Dr Cache Audit')&&e.textContent?.includes('Cancelled')));assert.equal(mutations,1);
   await page.evaluate(()=>location.hash='#view=units');await card().waitFor();const returnedText=await card().innerText();
   const stale=returnedText.includes('0 without active leave records');const readsOnReturn=unitReads;
   // Normal navigation forces a fresh Units GET; preserve this dependency behavior.
   assert.equal(stale,false);assert.equal(readsOnReturn,2);
   await page.locator('[data-refresh-unit-board]').click();await page.waitForFunction(()=>document.querySelector('[data-unit-board-card="unit:cache-unit"]')?.textContent?.includes('1 without active leave records'));
   assert.equal(unitReads,3);assert.equal(mutations,1);assert.deepEqual(errors,[]);
   results.push({engine,width,initialText,returnedText,afterExplicitRefresh:await card().innerText(),staleDependentCountsOnReturn:stale,unitReadsOnReturn:readsOnReturn,unitReadsAfterExplicitRefresh:unitReads,mutations,requests,errors});console.log(engine+' '+width+' cancellation return Units forces fresh GET; explicit retry remains GET-only');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile('src/main.ts')),initial);
await writeFile('../docs/premium-ui/qa-dependent159-cancel-cross-view-refresh-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/unit_settings_v2_independent_review',scope:'Six actual current-app browser cross-view checks,3engines320/1280. Load Units active-leave summary, navigate Leave and confirm one locally fulfilled cancellation, return Units: forced unit GET renders changed active-leave totals. Explicit board refresh remains GET-only without another mutation. No backend persistence/authorization assertion; all writes locally intercepted, remainingGET fixture8031.',source_sha256:{'frontend/src/main.ts':initial},test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');
console.log('Independent159 cross-view cancellation freshness:6contexts passed');
