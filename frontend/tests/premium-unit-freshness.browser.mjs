import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031',results=[];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{
  for(const width of [320,1280]){
   const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
   let reads=0,release,latest=false;
   const unit={id:'unit',name:'Alpha Unit',campus:'Main',code:'ALPHA',minimum_free_people:1,active_status:'active',notes:null};
   const person={id:'person',canonical_name:'Dr Alpha',active_status:'active',call_level:'2ND_CALL'};
   const row={id:'posting',person,unit,posting_type:'2ND_CALL',starts_on:'2026-10-01',ends_on:'2026-10-31',notes:null,source:'manual'};
   const dataset=()=>({month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units:[{...unit,name:latest?'Alpha Unit refreshed':unit.name}],assignments:latest?[row,{...row,id:'second',person:{...person,id:'second',canonical_name:'Dr Second'}}]:[row],unit_summaries:[{unit_id:'unit',assigned_members:latest?2:1,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[],validation_issues:[]});
   await page.clock.setFixedTime(new Date('2026-10-21T12:00:00Z'));
   await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','freshness-review');localStorage.setItem('duty_rota_working_month','2026-10');});
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/api/**',async route=>{
    assert.equal(route.request().method(),'GET','Read recovery never writes');const url=new URL(route.request().url());
    if(url.pathname.endsWith('/unit-management/month')){
     reads++;
     if(reads===2){await new Promise(resolve=>release=resolve);return route.fulfill({status:503,json:{detail:'Unit refresh unavailable <img src=x>'}});}
     return route.fulfill({json:dataset()});
    }
    return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
   });
   await page.goto(base+'/#view=units');
   const search=page.locator('input[data-unit-board-search]'),refresh=page.locator('[data-refresh-unit-board]'),freshness=page.locator('[data-unit-freshness]');await refresh.waitFor();
   const confirmed=await freshness.locator('span').innerText(),metrics=await page.locator('.board-metrics').innerText();
   assert.match(confirmed,/Last confirmed by a successful load:/);assert.equal(reads,1);
   await page.clock.setFixedTime(new Date('2026-10-21T12:01:00Z'));
   await refresh.click();
   const deadline=Date.now()+5000;while(!release&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(typeof release,'function');
   assert.equal(await refresh.isDisabled(),true);assert.match(await freshness.innerText(),/Refreshing unit postings/);
   assert.equal(await page.locator('.board-metrics').innerText(),metrics);
   await search.fill('Alpha');await search.evaluate(el=>el.setSelectionRange(2,2));
   release();await page.waitForFunction(()=>document.querySelector('[data-unit-freshness]')?.classList.contains('is-stale'));
   assert.equal(await page.locator('.board-metrics').innerText(),metrics);
   assert.equal(await freshness.locator('span').innerText(),confirmed,'Failed refresh does not advance confirmation time');
   assert.equal(await search.inputValue(),'Alpha');assert.equal(await search.evaluate(el=>el===document.activeElement&&el.selectionStart===2&&el.selectionEnd===2),true,'Pending filter edits/focus/caret survive failed refresh');
   assert.equal(await freshness.locator('img').count(),0);
   assert.match(await freshness.innerText(),/These values may be out of date/);assert.equal(reads,2);
   latest=true;await refresh.click();await page.locator('[data-unit-board-card="unit:unit"] h3').filter({hasText:'Alpha Unit refreshed'}).waitFor();
   assert.equal(await freshness.getAttribute('role'),'status');assert.equal(await freshness.evaluate(el=>el.classList.contains('is-stale')),false);
   assert.notEqual(await freshness.locator('span').innerText(),confirmed);
   assert.equal(await search.inputValue(),'Alpha');assert.equal(await refresh.evaluate(el=>el===document.activeElement),true,'Completed explicit refresh restores its action when no newer focus exists');
   assert.equal(await page.locator('[data-unit-board-row]').count(),2);assert.equal(reads,3);
   if(engine==='chromium'){
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(item=>item.id),[]);
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
   results.push({engine,width,same_month_data_retained:true,escaped_stale_notice:true,confirmation_time_only_advances_on_success:true,pending_filter_focus_and_caret_preserved:true,manual_retry_updates_records:true,read_attempts:3,backend_writes:0});await context.close();
  }
 }finally{await browser.close();}
}
await writeFile('../docs/premium-ui/qa-unit-freshness.json',JSON.stringify({results,scope:'Actual unit board with intercepted initial/same-month failing/successful GETs; fixed clock verifies last-confirmed timestamp. Physical/screen-reader checks pending.'},null,2)+'\n');
console.log('Unit freshness:6 cross-browser retained-data, focus, timestamp and manual retry workflows passed');
