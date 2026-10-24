import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031',results=[];
const units=['Alpha','Beta'].map((name,i)=>({id:`unit-${i}`,name:`${name} Unit`,campus:i?'West':'Main',code:name,minimum_free_people:1,active_status:'active',notes:null}));
const fixture=count=>({month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units,assignments:Array.from({length:count},(_,i)=>({id:`posting-${i}`,person:{id:`person-${i}`,canonical_name:`Dr Ordered ${String(i).padStart(3,'0')}`,call_level:'2ND_CALL',active_status:'active'},unit:units[i%2],posting_type:'2ND_CALL',starts_on:'2026-10-01',ends_on:'2026-10-31',source:'manual',notes:null})),unit_summaries:units.map(unit=>({unit_id:unit.id,assigned_members:61,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]});
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{for(const role of ['computer_admin','rota_board_member']){
  let count=123,reads=0;const errors=[],writes=[];
  const context=await browser.newContext({viewport:{width:1280,height:850},reducedMotion:'reduce'}),page=await context.newPage();
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','pagination-independent');localStorage.setItem('duty_rota_working_month','2026-10');});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()!=='GET'){writes.push({path:url.pathname,method:request.method()});return route.abort('blockedbyclient');}
   if(url.pathname.endsWith('/unit-management/month')){reads++;return route.fulfill({json:fixture(count)});}
   const response=await route.fetch({url:api+url.pathname+url.search});
   if(url.pathname.endsWith('/auth/me'))return route.fulfill({json:{...await response.json(),role}});
   return route.fulfill({response});
  });
  await page.goto(base+'/#view=units');
  const body=page.locator('[data-unit-posting-body]'),pager=page.locator('[data-unit-posting-pager]');
  await body.locator('tr[data-unit-board-row]').first().waitFor();
  const names=()=>body.locator('[data-open-member]').allTextContents();
  const ordered=Array.from({length:123},(_,i)=>`Dr Ordered ${String(i).padStart(3,'0')}`);
  const next=page.getByRole('button',{name:'Next postings',exact:true}),previous=page.getByRole('button',{name:'Previous postings',exact:true});
  assert.equal(await previous.isDisabled(),true);assert.match(await pager.innerText(),/of 123/);
  const all=[...await names()];
  if(role==='computer_admin')await body.locator('[data-admin-select="posting"][value="posting-0"]').check();
  else {assert.equal(await body.locator('[data-admin-select]').count(),0);assert.equal(await body.locator('[data-delete-posting]').count(),0);assert.equal(await page.locator('[data-delete-selected="posting"]').count(),0);}
  await next.focus();await page.keyboard.press('Enter');all.push(...await names());
  assert.equal(await next.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Enter');all.push(...await names());
  assert.deepEqual(all,ordered,'All 123 ordered rows reachable exactly once');
  assert.equal(await next.isDisabled(),true);assert.equal(await previous.evaluate(el=>el===document.activeElement),true);
  await page.locator('[data-refresh-unit-board]').click();await page.waitForFunction(()=>document.querySelector('[data-unit-posting-pager]')?.textContent?.includes('Page 3 of 3'));
  assert.deepEqual(await names(),ordered.slice(100),'Explicit read refresh preserves page');
  const campus=page.locator('select[data-unit-board-campus]');await campus.selectOption('campus:Main');
  assert.deepEqual(await names(),ordered.filter((_,i)=>i%2===0).slice(0,50),'Filter resets page and retains group semantics');
  assert.match(await pager.innerText(),/Page 1 of 2/);await next.click();
  assert.deepEqual(await names(),ordered.filter((_,i)=>i%2===0).slice(50));
  await page.getByRole('button',{name:'Clear unit filters',exact:true}).click();
  assert.deepEqual(await names(),ordered.slice(0,50));
  if(role==='computer_admin')assert.equal(await body.locator('[data-admin-select="posting"][value="posting-0"]').isChecked(),true);
  await next.click();await next.click();count=17;
  await page.locator('[data-refresh-unit-board]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-unit-posting-body] [data-unit-board-row]').length===17);
  assert.deepEqual(await names(),ordered.slice(0,17),'Shortened response clamps page');assert.equal(await pager.locator('button').count(),0);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.equal(reads,3);
  results.push({engine,role,all123OrderedRowsReachable:true,keyboardBoundaryFocus:true,pagePreservedOnRefresh:true,filterResetsPage:true,selectionPreserved:role==='computer_admin',adminControlsAbsent:role==='rota_board_member',clampedAfterShrink:true,reads,writes:0});await page.waitForLoadState('networkidle');await context.close();
 }}finally{await browser.close();}
}
const sources={};for(const name of ['main.ts','unit-board-filters.ts'])sources[name]=createHash('sha256').update(await readFile(`src/${name}`)).digest('hex');
await writeFile('../docs/premium-ui/qa-unit-pagination-independent.json',JSON.stringify({createdAt:new Date().toISOString(),scope:'Independent actual-app desktop Chromium/Firefox/WebKit; 123 intercepted rows, computer-admin/rota-board-member UI gates. GET-only, no persisted mutation/security authorization claim. Phone full cards unchanged; physical checks pending.',sources,results},null,2)+'\n');
console.log('Independent posting pagination: 6 cross-browser role workflows passed');


