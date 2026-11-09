import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5224',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const unit=(id,name,campus)=>({id,name,campus,code:id,minimum_free_people:1,active_status:'active',notes:null});
const units=[unit('alpha','Royal Northern Anaesthesia and Perioperative Department Unit','Main'),unit('beta','Beta Unit','Ranipet'),unit('gamma','Gamma Unit',null)];
const posting=(id,name,unit,posting_type,starts_on,ends_on)=>({id,person:{id:'person-'+id,canonical_name:name,call_level:'2ND_CALL',active_status:'active'},unit,posting_type,starts_on,ends_on,source:'manual',notes:null});
const assignments=[posting('a','Dr Alexandria '+ 'Longname'.repeat(12),units[0],'2ND_CALL','2026-10-01','2026-10-31'),posting('b','Dr Future',units[0],'1ST_CALL','2026-10-30','2026-10-31'),posting('c','Dr Earlier',units[1],'2ND_CALL','2026-10-01','2026-10-10'),posting('d','Dr <img src=x> Special',units[0],'PAIN','2026-10-01','2026-10-31')];
assignments.push(posting('e','Dr Unlinked',null,'2ND_CALL','2026-10-01','2026-10-31'));
const data={month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units,assignments,unit_summaries:units.map(unit=>({unit_id:unit.id,assigned_members:unit.id==='alpha'?2:unit.id==='beta'?1:0,people_with_leave:unit.id==='alpha'?1:0,leave_days:unit.id==='alpha'?3:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[{severity:'warning',code:'TEST',message:'Review Beta staffing',unit_id:'beta',person_id:null,posting_id:null}]};
const sourcePaths=['src/main.ts','src/unit-board-filters.ts','src/unit-member-lists.ts','src/premium-theme.css'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceHashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>['frontend/'+p,sha(await readFile(p))])));
const initial=await sourceHashes();
const results=[];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{
  for(const profile of [{name:'enlarged-light',width:320,height:568,scale:2,theme:'light'},{name:'enlarged-dark',width:320,height:568,scale:2,theme:'dark'},{name:'short-light',width:390,height:320,scale:1,theme:'light'},{name:'short-dark',width:390,height:320,scale:1,theme:'dark'}]){
   const {width,height,scale,theme}=profile;
   const context=await browser.newContext({viewport:{width,height},colorScheme:theme,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
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
   await page.addInitScript(({scale,theme})=>{localStorage.setItem('duty_rota_theme',theme);if(scale===2){const apply=()=>{if(document.documentElement)document.documentElement.style.fontSize='200%';};new MutationObserver(apply).observe(document,{childList:true});apply();}},{scale,theme});
   await page.goto(base+'/#view=units');
   const search=page.getByRole('searchbox',{name:'Find a unit or member',exact:true}),campus=page.locator('select[data-unit-board-campus]'),cards=page.locator('[data-unit-board-card]'),rows=page.locator('[data-unit-board-row]');
   await search.waitFor();const metrics=await page.locator('.board-metrics').innerText();
   const count=page.locator('[data-unit-board-count]');assert.match(await count.innerText(),/7 of 7 unit groups.*5 of 5 postings/);
   const shown=()=>cards.evaluateAll(nodes=>nodes.filter(node=>!node.hidden).map(node=>node.dataset.unitBoardCard));
   const shownRows=()=>rows.evaluateAll(nodes=>nodes.filter(node=>!node.hidden).map(node=>node.dataset.unitBoardRow));
   assert.match(await page.locator('[data-unit-board-card="unit:alpha"]').innerText(),/Current posting/);
   assert.match(await page.locator('[data-unit-board-card="unit:alpha"]').innerText(),/Upcoming posting/);
   assert.match(await page.locator('[data-unit-board-card="unit:beta"]').innerText(),/Past posting/);
   const memberPeriod=async(id,period,start,end)=>{
    const chip=page.locator(`.unit-card .unit-member-chip`).filter({has:page.locator(`[data-open-member="person-${id}"]`)});
    assert.equal(await chip.count(),1,`One dated card posting for ${id}`);
    assert.equal(await chip.locator('.unit-posting-period').innerText(),period+' posting');
    const text=await chip.innerText();assert.match(text,start);if(end)assert.match(text,end);
    return text;
   };
   const datedMembers={current:await memberPeriod('a','Current',/1 Oct 2026/,/31 Oct 2026/),future:await memberPeriod('b','Upcoming',/30 Oct 2026/,/31 Oct 2026/),past:await memberPeriod('c','Past',/1 Oct 2026/,/10 Oct 2026/)};
   assert.match(await page.locator('[aria-label="Unit actions"]').innerText(),/October 2026/);
   assert.match(await page.locator('[data-unit-board-card="unit:alpha"] .unit-availability').innerText(),/2 assigned.*1 with active leave records this month/s);
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
   const card=page.locator('[data-unit-board-card="unit:alpha"]');
   assert.match(await card.locator('header').innerText(),/Royal Northern Anaesthesia.*Main/s);
   const hierarchy=await card.evaluate(e=>{const header=e.querySelector('header'),coverage=e.querySelector('.unit-availability'),group=e.querySelector('.unit-call-group');const rect=n=>{const b=n.getBoundingClientRect();return{top:b.top,bottom:b.bottom,left:b.left,right:b.right};};return{header:rect(header),coverage:rect(coverage),group:rect(group),card:rect(e),title:rect(e.querySelector('h3'))};});
   assert.ok(hierarchy.header.bottom<=hierarchy.coverage.top+1&&hierarchy.coverage.bottom<=hierarchy.group.top+1,'Identity, monthly record totals and staffing groups have a visible scan order');
   assert.ok(hierarchy.title.left>=hierarchy.card.left&&hierarchy.title.right<=hierarchy.card.right+1,'Long unit title stays inside its card');
   const manageGeometry=await card.locator('header > button').evaluate(e=>{const b=e.getBoundingClientRect(),c=e.closest('.unit-card').getBoundingClientRect();return{width:b.width,height:b.height,whiteSpace:getComputedStyle(e).whiteSpace,inside:b.left>=c.left&&b.right<=c.right+1};});
   assert.equal(manageGeometry.whiteSpace,'nowrap');assert.ok(manageGeometry.inside&&manageGeometry.height>=44);
   const chipGeometry=await card.locator('.unit-member-chip').evaluateAll(es=>es.map(e=>{const c=e.getBoundingClientRect();return{width:e.clientWidth,scroll:e.scrollWidth,fields:[...e.children].map(n=>{const b=n.getBoundingClientRect();return{text:n.textContent,width:b.width,inside:b.left>=c.left-1&&b.right<=c.right+1,whiteSpace:getComputedStyle(n).whiteSpace};})};}));
   for(const chip of chipGeometry){assert.ok(chip.scroll<=chip.width+2);for(const field of chip.fields){assert.ok(field.inside);if(width>768&&field.text.includes('Oct 2026'))assert.ok(field.width>=110,'Full date range is not squeezed beside a long name');}}

   await search.fill('Dr Future');const beforeReflow={cards:await shown(),rows:await shownRows(),count:await count.innerText(),metrics:await page.locator('.board-metrics').innerText()};
   const alternateWidth=width<600?1280:320;
   await page.setViewportSize({width:alternateWidth,height:850});
   assert.equal(await search.inputValue(),'Dr Future');assert.deepEqual(await shown(),beforeReflow.cards);assert.deepEqual(await shownRows(),beforeReflow.rows);assert.equal(await count.innerText(),beforeReflow.count);assert.equal(await page.locator('.board-metrics').innerText(),beforeReflow.metrics);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.setViewportSize({width,height:850});assert.equal(await search.inputValue(),'Dr Future');
   const beforeReturnReads=reads;
   await page.locator(width<600?'.mobile-bottom-nav [data-view="overview"]':'.sidebar [data-view="overview"]').click();await search.waitFor({state:'detached'});await page.goBack();await search.waitFor();
   assert.equal(await search.inputValue(),'Dr Future','Return navigation preserves the chosen unit/member filter');assert.equal(await campus.inputValue(),'');assert.deepEqual(await shown(),beforeReflow.cards);assert.deepEqual(await shownRows(),beforeReflow.rows);assert.equal(await count.innerText(),beforeReflow.count);
   await page.getByRole('button',{name:'Clear unit filters',exact:true}).click();
   if(engine==='chromium')await page.screenshot({path:`../docs/premium-ui/screenshots/unit-card-geometry-v1-${profile.name}.png`,fullPage:true});
   if(engine==='chromium'){
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(item=>item.id),[]);
   }
   const readCount=reads;
   await page.locator('.page-toolbar__actions > [data-add-department-unit]').click();
   await page.getByRole('dialog',{name:'Manage department units',exact:true}).waitFor();
   await page.getByRole('button',{name:'Close unit management',exact:true}).click();
   assert.equal(reads,readCount,'Filtering never refetches month data');assert.deepEqual(errors,[]);
   results.push({engine,profile,width,member_search_matches_unit_group:true,campus_special_and_unknown_campus:true,card_row_consistency:true,clear_and_empty:true,full_dates_and_period_labels:true,metrics_and_issues_preserved:true,existing_add_unit_action:true,no_month_refetch:true,backend_writes:0,datedMembers,hierarchy,manageGeometry,chipGeometry,alternateWidth,reflowPreservesFilterCountsAndMetrics:true,returnNavigationPreservesFilter:true,returnMonthReads:reads-beforeReturnReads});
   await context.close();
  }
 }finally{await browser.close();}
}
assert.deepEqual(await sourceHashes(),initial);
await writeFile('../docs/premium-ui/qa-unit-card-geometry-v1-stress.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,results,scope:'Scratch scoped CSS actual app board with exact person-associated dates/periods,3engines320/390/1280, multiplecampus/longunit+member/pastcurrentfuture fixtures, actual reflow and native route back; display-only filters/labels and existing Add unit entry, no scheduling/API semantics change. Physical and screen-reader checks pending.'},null,2)+'\n');
console.log('Scratch unit geometry:12 stress workflows passed');
