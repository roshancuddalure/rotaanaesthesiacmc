import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const unit={id:'fresh-unit',code:'FR',name:'Fresh Unit',campus:'Main',minimum_free_people:1,active_status:'active',notes:null};
const data=(month,label)=>({month,starts_on:month+'-01',ends_on:month+'-28',units:[unit],assignments:[{id:'fresh-posting',person:{id:'fresh-person',canonical_name:label,active_status:'active',call_level:'1ST_CALL'},unit,posting_type:'1ST_CALL',starts_on:month+'-01',ends_on:null,source:'manual',notes:null}],unit_summaries:[],unit_call_minimums:[],validation_issues:[]});
const results=[];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],writes=[],reads=[];
  let mode='initial',release,user,signins=0;
  await page.clock.setFixedTime(new Date('2026-10-21T08:00:00Z'));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','independent-freshness');localStorage.setItem('duty_rota_working_month','2026-10');});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/auth/sign-in')){signins++;return route.fulfill({json:{token:'independent-new-session',user}});}
   if(req.method()!=='GET'){writes.push(req.method()+' '+url.pathname);return route.fulfill({status:501,json:{detail:'Read-only freshness review'}});}
   if(url.pathname.endsWith('/unit-management/month')){
    const capturedMode=mode,month=url.searchParams.get('month');reads.push({month,mode:capturedMode});
    if(capturedMode==='held')await new Promise(resolve=>release=resolve);
    if(capturedMode==='refused'||capturedMode==='wrong-month')return route.fulfill({status:503,json:{detail:'Independent freshness service unavailable'}});
    return route.fulfill({json:data(month,capturedMode==='initial'?'Original member':'Updated member')});
   }
   const response=await route.fetch({url:api+url.pathname+url.search});
   if(url.pathname.endsWith('/auth/me'))user=await response.json();
   return route.fulfill({response});
  });
  await page.goto(base+'/#view=units');
  const search=page.locator('input[data-unit-board-search]'),refresh=page.getByRole('button',{name:'Refresh postings',exact:true}),notice=page.locator('[data-unit-freshness]');
  await search.waitFor();assert.match(await notice.innerText(),/Last confirmed by a successful load/);
  const originalConfirmed=(await notice.innerText()).match(/Last confirmed by a successful load:[\s\S]*/)[0];
  const originalMetrics=await page.locator('.board-metrics').innerText();
  mode='refused';await page.clock.setFixedTime(new Date('2026-10-21T08:05:00Z'));
  await refresh.click();await page.getByText(/Refresh failed.*showing previously loaded October 2026 data/).waitFor();
  assert.match(await notice.innerText(),/may be out of date/);assert.ok((await notice.innerText()).includes(originalConfirmed),'Refusal must not advance confirmation time');
  assert.match(await page.locator('.unit-card-grid').innerText(),/Original member/);assert.equal(await page.locator('.board-metrics').innerText(),originalMetrics);
  mode='held';await refresh.click();await page.waitForFunction(()=>document.querySelector('[data-unit-freshness]')?.textContent.includes('Refreshing'));
  for(let attempt=0;!release&&attempt<500;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(typeof release,'function','Held GET must have arrived before continuing');
  assert.equal(await page.getByRole('button',{name:'Refreshing…',exact:true}).isDisabled(),true);
  await search.fill('Updated');await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');await search.focus();
  release();await page.locator('[data-unit-freshness]:not(.is-stale)').waitFor();await refresh.waitFor();
  assert.equal(await search.inputValue(),'Updated');assert.equal(await page.locator('select[data-unit-board-campus]').inputValue(),'campus:Main');
  assert.equal(await search.evaluate(el=>el===document.activeElement),true,'Completed read preserves user editing focus');
  assert.equal(await page.locator('[data-unit-board-card="unit:fresh-unit"]').isVisible(),true);assert.match(await page.locator('.unit-card-grid').innerText(),/Updated member/);
  assert.notEqual(await notice.innerText(),originalConfirmed,'Successful refresh advances confirmation');assert.equal(await notice.getAttribute('role'),'status');
  mode='wrong-month';await page.locator('#working-month').fill('2026-11');await page.locator('#working-month').press('Tab');
  await page.getByText('Unit Management could not load',{exact:true}).waitFor();
  assert.equal(await page.locator('.unit-card-grid').count(),0,'A different month never reuses previous confirmed board');
  assert.equal(await notice.count(),0);assert.equal(await page.locator('#working-month').inputValue(),'2026-11');
  assert.ok(reads.some(read=>read.month==='2026-11'));assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  if(engine==='chromium'){
   mode='initial';await page.locator('#working-month').fill('2026-10');await page.locator('#working-month').press('Tab');await search.waitFor();await page.getByRole('button',{name:'Clear unit filters',exact:true}).click();
   assert.match(await page.locator('.unit-card-grid').innerText(),/Original member/);
   await page.locator('#account-menu-button').click();await page.locator('#sign-out').click();
   await page.getByLabel('Username',{exact:true}).waitFor();mode='refused';
   await page.getByLabel('Username',{exact:true}).fill('new-session-review');await page.getByLabel('Password',{exact:true}).fill('Example password 42!');
   await page.locator('#login-submit').click();await page.locator('#account-menu-button').waitFor();
   if(width<768)await page.locator('#sidebar-toggle').click();
   await page.locator('.sidebar [data-view="units"]').click();await page.getByText('Unit Management could not load',{exact:true}).waitFor().catch(async error=>{console.log(JSON.stringify({engine,width,reads,signins,url:page.url(),text:await page.locator('#app').innerText()}));throw error;});
   assert.equal(await page.locator('.unit-card-grid').count(),0,'Old account data is never a new-account failed-read fallback');
   assert.equal(await notice.count(),0);assert.equal(signins,1);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  results.push({engine,width,retained_confirmed_data_on_same_month_failure:true,failed_read_keeps_timestamp:true,pending_filter_edit_and_focus_preserved:true,manual_retry_read_only:true,different_month_no_stale_fallback:true,account_switch_no_old_cache:engine==='chromium'?'passed':'not tested',mocked_signins:signins,backend_writes:0});
  await context.close();
 }}finally{await browser.close();}
}
await writeFile('../docs/premium-ui/qa-unit-freshness-independent.json',JSON.stringify({scope:'Independent full-app browser review using intercepted unit month GET responses and a read-only disposable fixture for other endpoints. Tests display/read recovery, not backend persistence.',results},null,2)+'\n');
console.log('Independent unit freshness review: 6 cross-browser workflows passed');
