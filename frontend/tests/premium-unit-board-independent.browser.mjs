import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium, firefox, webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197', api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const results=[];
const unit={id:'unit-special-campus',code:'SC',name:'North Unit',campus:'special',minimum_free_people:1,active_status:'active',notes:null};
const assignments=[
 {id:'normal',person:{id:'p-current',canonical_name:'Current Person',active_status:'active',call_level:'1ST_CALL'},unit,posting_type:'1ST_CALL',starts_on:'2026-10-01',ends_on:null,source:'manual',notes:null},
 {id:'special-with-unit',person:{id:'p-special',canonical_name:'Special Person',active_status:'active',call_level:'1ST_CALL'},unit,posting_type:'PAIN',starts_on:'2026-10-25',ends_on:'2026-10-31',source:'manual',notes:null},
 {id:'unresolved',person:{id:'p-unresolved',canonical_name:'Unresolved Person',active_status:'active',call_level:'1ST_CALL'},unit:null,posting_type:'1ST_CALL',starts_on:'2026-10-01',ends_on:'2026-10-15',source:'manual',notes:null},
];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],writes=[];
  let noUnits=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-10-21T08:00:00Z')});
  await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','independent-unit-board'));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()!=='GET'){writes.push({path:url.pathname,method:req.method()});return route.fulfill({status:501,json:{detail:'Independent review permits no mutations'}});}
   if(url.pathname.endsWith('/unit-management/month'))return route.fulfill({json:{month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units:noUnits?[]:[unit],assignments,unit_summaries:[{unit_id:unit.id,assigned_members:1,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[],validation_issues:[]}});
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=units');await page.locator('input[data-unit-board-search]').waitFor();
  const rows=()=>page.locator('[data-unit-board-row]').evaluateAll(nodes=>nodes.filter(n=>!n.hidden).map(n=>n.textContent.trim().replace(/\s+/g,' ')));
  const count=page.locator('[data-unit-board-count]'),campus=page.locator('select[data-unit-board-campus]');
  assert.equal((await rows()).length,3,'Clear filters preserve unresolved posting with no card');
  await campus.selectOption({value:'special'});
  assert.equal((await rows()).length,1);assert.match((await rows())[0],/Special Person/,'Retained unit id does not override special posting group');
  await campus.selectOption({value:'campus:special'});
  assert.equal((await rows()).length,1);assert.match((await rows())[0],/Current Person/,'Real campus called special is distinct from special postings');
  await page.locator('input[data-unit-board-search]').fill('cannot match');
  assert.equal((await rows()).length,0);assert.equal(await page.locator('[data-unit-board-empty]').isVisible(),true);
  await page.getByRole('button',{name:'Clear unit filters',exact:true}).click();
  assert.equal((await rows()).length,3);assert.match(await count.innerText(),/3 of 3 postings shown/);
  assert.equal(await page.locator('input[data-unit-board-search]').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.locator('[data-unit-board-empty]').isVisible(),false);
  const normalCard=page.locator('[data-unit-board-card="unit:unit-special-campus"]');
  assert.match(await normalCard.innerText(),/Current posting/);
  assert.match(await page.locator('[data-unit-board-card="special:PAIN"]').innerText(),/Upcoming posting/);
  assert.match(await normalCard.innerText(),/1 Oct 2026/,'Regular card includes full date');
  await page.locator('select[data-unit-board-campus]').selectOption({value:'unspecified'});
  assert.match(await page.locator('[data-unit-board-card="unassigned"]').innerText(),/Past posting/,'Unresolved posting remains visible with full dated status');
  assert.equal((await rows()).length,1);
  await page.getByRole('button',{name:'Clear unit filters',exact:true}).click();
  noUnits=true;await page.reload();await page.locator('input[data-unit-board-search]').waitFor();
  assert.equal((await rows()).length,3,'No active unit catalog cannot conceal assignments');
  assert.equal(await page.locator('[data-unit-board-card="special:PAIN"]').isVisible(),true);
  assert.match(await page.locator('[data-unit-board-card="unassigned"]').innerText(),/Current Person/);
  assert.match(await page.locator('[data-unit-board-card="unassigned"]').innerText(),/Unresolved Person/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  results.push({engine,width,special_retained_unit_id:true,reserved_campus_distinct:true,unresolved_rows_preserved_when_clear:true,empty_catalog_postings_visible:true,empty_and_reset:true,focus_preserved:true,dated_cards:true,backend_writes:0});
  await context.close();
 }}finally{await browser.close();}
}
await writeFile('../docs/premium-ui/qa-unit-board-independent.json',JSON.stringify({scope:'Independent full-app browser review with intercepted unit month GET data; read-only fixture for other endpoints. No persistence verification.',results},null,2)+'\n');
console.log('Independent unit board review: 6 cross-browser cases passed');
