import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const unit=(id,name,campus)=>({id,name,campus,code:id,minimum_free_people:1,active_status:'active',notes:null});
const units=[unit('alpha','Alpha Unit','Main'),unit('beta','Beta Unit','Ranipet'),unit('gamma','Gamma Unit',null)];
const posting=(id,name,unit,posting_type,starts_on,ends_on)=>({id,person:{id:'person-'+id,canonical_name:name,call_level:'2ND_CALL',active_status:'active'},unit,posting_type,starts_on,ends_on,source:'manual',notes:null});
const assignments=[posting('a','Dr Alexandria '+ 'Longname'.repeat(12),units[0],'2ND_CALL','2026-10-01','2026-10-31'),posting('b','Dr Future',units[0],'1ST_CALL','2026-10-30','2026-10-31'),posting('c','Dr Earlier',units[1],'2ND_CALL','2026-10-01','2026-10-10'),posting('d','Dr <img src=x> Special',units[0],'PAIN','2026-10-01','2026-10-31')];
assignments.push(posting('e','Dr Unlinked',null,'2ND_CALL','2026-10-01','2026-10-31'));
const data={month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units,assignments,unit_summaries:units.map(unit=>({unit_id:unit.id,assigned_members:unit.id==='alpha'?2:unit.id==='beta'?1:0,people_with_leave:unit.id==='alpha'?1:0,leave_days:unit.id==='alpha'?3:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[{severity:'warning',code:'TEST',message:'Review Beta staffing',unit_id:'beta',person_id:null,posting_id:null}]};
const results=[];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{
  for(const width of [320,390,1280]){
   const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
   let reads=0;
   await page.clock.setFixedTime(new Date('2026-10-21T12:00:00Z'));
   await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','unit-ui-review');localStorage.setItem('duty_rota_working_month','2026-10');});
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/api/**',async route=>{
    assert.equal(route.request().method(),'GET','Display/filter workflow never writes');const url=new URL(route.request().url());
    if(url.pathname.endsWith('/unit-management/month')){reads++;return route.fulfill({json:data});}
    if(url.pathname.endsWith('/normalization/units'))return route.fulfill({json:[]});
    return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
   });
   await page.goto(base+'/#view=units');
   const search=page.getByRole('searchbox',{name:'Find a unit or member',exact:true}),campus=page.locator('select[data-unit-board-campus]'),cards=page.locator('[data-unit-board-card]'),rows=page.locator('[data-unit-board-row]');
   await search.waitFor();const metrics=await page.locator('.board-metrics').innerText();
   const count=page.locator('[data-unit-board-count]');assert.match(await count.innerText(),/7 of 7 unit groups.*5 of 5 postings/);
   const shown=()=>cards.evaluateAll(nodes=>nodes.filter(node=>!node.hidden).map(node=>node.dataset.unitBoardCard));
   const shownRows=()=>rows.evaluateAll(nodes=>nodes.filter(node=>!node.hidden).map(node=>node.dataset.unitBoardRow));
   assert.match(await page.locator('[data-unit-board-card="unit:alpha"]').innerText(),/Current posting/);
   assert.match(await page.locator('[data-unit-board-card="unit:alpha"]').innerText(),/Upcoming posting/);
   assert.match(await page.locator('[data-unit-board-card="unit:beta"]').innerText(),/Past posting/);
   assert.equal(await cards.locator('img').count(),0);
   await search.fill('Dr Future');assert.deepEqual(await shown(),['unit:alpha']);assert.deepEqual(await shownRows(),['unit:alpha','unit:alpha']);
   assert.equal(await search.evaluate(el=>el===document.activeElement),true);
   assert.equal(await page.locator('.board-metrics').innerText(),metrics);
   assert.equal(await page.locator('#unit-setup-issues').isVisible(),true,'Warnings remain available outside filters');
   await search.fill('');await campus.selectOption('campus:Ranipet');assert.deepEqual(await shown(),['unit:beta']);
   assert.deepEqual(await shownRows(),['unit:beta']);
   await campus.selectOption('special');assert.deepEqual(await shownRows(),['special:PAIN'],'Special assignment with retained unit matches special card');
   await campus.selectOption('unspecified');assert.deepEqual(await shown(),['unit:gamma','unassigned']);assert.deepEqual(await shownRows(),['unassigned']);
   await search.fill('Nothing matches');await page.getByRole('heading',{name:'No matching unit groups',exact:true}).waitFor();
   await page.getByRole('button',{name:'Clear unit filters',exact:true}).click();
   assert.equal(await search.inputValue(),'');assert.equal(await campus.inputValue(),'');assert.equal(await search.evaluate(el=>el===document.activeElement),true);
   assert.equal((await shown()).length,7);assert.equal((await shownRows()).length,5);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(engine==='chromium'){
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(item=>item.id),[]);
   }
   const readCount=reads;
   await page.locator('.page-toolbar__actions > [data-add-department-unit]').click();
   await page.getByRole('dialog',{name:'Manage department units',exact:true}).waitFor();
   await page.getByRole('button',{name:'Close unit management',exact:true}).click();
   assert.equal(reads,readCount,'Filtering never refetches month data');assert.deepEqual(errors,[]);
   results.push({engine,width,member_search_matches_unit_group:true,campus_special_and_unknown_campus:true,card_row_consistency:true,clear_and_empty:true,full_dates_and_period_labels:true,metrics_and_issues_preserved:true,existing_add_unit_action:true,no_month_refetch:true,backend_writes:0});
   await context.close();
  }
 }finally{await browser.close();}
}
await writeFile('../docs/premium-ui/qa-unit-board.json',JSON.stringify({results,scope:'Actual app unit board with intercepted populated month; display-only filters/labels and existing Add unit entry, no scheduling/API semantics change. Physical and screen-reader checks pending.'},null,2)+'\n');
console.log('Unit board:9 cross-browser populated filter, date and editor-entry workflows passed');
