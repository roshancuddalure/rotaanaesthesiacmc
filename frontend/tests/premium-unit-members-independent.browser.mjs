import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const results=[];
const unit={id:'large-unit',name:'Royal Northern Department',campus:'Main',code:'RN',minimum_free_people:2,active_status:'active',notes:null};
const postings=(prefix,count,posting_type,target=unit)=>Array.from({length:count},(_,i)=>({id:`${prefix}-${i}`,person:{id:`person-${prefix}-${i}`,canonical_name:`Dr ${prefix} Complete Member ${String(i).padStart(3,'0')}`,call_level:'2ND_CALL',active_status:'active'},unit:target,posting_type,starts_on:'2026-10-01',ends_on:'2026-10-31',source:'manual',notes:null}));
const groups={regular:postings('Regular',72,'2ND_CALL'),other:postings('Other',15,'UNLISTED_LABEL'),special:postings('Special',40,'PAIN'),unassigned:postings('Unassigned',17,'2ND_CALL',null)};
const assignments=Object.values(groups).flat();
const fixture={month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units:[unit],assignments,unit_summaries:[{unit_id:unit.id,assigned_members:87,people_with_leave:3,leave_days:9,leave_by_call_level:{'2ND_CALL':3}}],unit_call_minimums:[],validation_issues:[{severity:'warning',code:'INDEPENDENT_WARNING',message:'Complete warning must remain visible',person_id:null,unit_id:unit.id,posting_id:null}]};

for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],writes=[];
  let reads=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-10-21T08:00:00Z')});
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','independent-unit-members');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()!=='GET'){writes.push({method:request.method(),path:url.pathname});return route.abort('blockedbyclient');}
   if(url.pathname.endsWith('/unit-management/month')){reads++;return route.fulfill({json:fixture});}
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=units');
  const regular=page.locator('[data-unit-board-card="unit:large-unit"]'),special=page.locator('[data-unit-board-card="special:PAIN"]'),unassigned=page.locator('[data-unit-board-card="unassigned"]');
  await regular.waitFor();
  const assertNoUnexpectedModal=async()=>assert.equal(await page.locator('#unit-management-modal').count(),0,'Expansion controls must not bubble into the ancestor unit card modal action');
  const names=container=>container.locator('.unit-member-chip [data-open-member]').allTextContents();
  const list=(key)=>page.locator(`[data-unit-member-list="2026-10:${key}"]`);
  const regularList=list('unit:large-unit:2ND_CALL'),otherList=list('unit:large-unit:other'),specialList=list('special:PAIN'),unassignedList=list('unassigned');
  const action=(host,mode)=>host.locator(`[data-unit-member-action="${mode}"]`);
  assert.equal(await regular.locator('.unit-member-chip').count(),24,'Two regular groups start at twelve members each');
  assert.equal(await special.locator('.unit-member-chip').count(),12);
  assert.equal(await unassigned.locator('.unit-member-chip').count(),12);
  assert.match(await regular.innerText(),/84.*available.*87.*assigned.*3.*on leave/s);
  assert.match(await regular.innerText(),/1 setup issue/);
  assert.match(await regular.innerText(),/1 Oct 2026/);
  assert.match(await regular.innerText(),/Current posting/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.match(await regularList.locator('.unit-member-list__count').innerText(),/12 of 72/);
  await action(regularList,'more').focus();await page.keyboard.press('Enter');
  assert.equal((await names(regularList)).length,36,'Keyboard adds 24 previously hidden members');
  assert.equal(await action(regularList,'more').evaluate(el=>el===document.activeElement),true);
  const focusGeometry=button=>button.evaluate(el=>{const r=el.getBoundingClientRect(),target=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {top:r.top,bottom:r.bottom,height:innerHeight,inViewport:r.top>=0&&r.bottom<=innerHeight,unobscured:!!target&&el.contains(target)};});
  const keyboardExpansionFocus=await focusGeometry(action(regularList,'more'));
  assert.equal(keyboardExpansionFocus.inViewport&&keyboardExpansionFocus.unobscured,true,`Keyboard focus must remain visible after expansion: ${JSON.stringify(keyboardExpansionFocus)}`);
  await assertNoUnexpectedModal();
  await action(regularList,'less').focus();await page.keyboard.press('Space');
  assert.equal((await names(regularList)).length,12,'Keyboard Show fewer restores twelve');
  assert.equal(await action(regularList,'more').evaluate(el=>el===document.activeElement),true,'Removed Show fewer transfers focus to remaining expansion control');
  const keyboardCollapseFocus=await focusGeometry(action(regularList,'more'));
  assert.equal(keyboardCollapseFocus.inViewport&&keyboardCollapseFocus.unobscured,true,`Keyboard focus must remain visible after collapse: ${JSON.stringify(keyboardCollapseFocus)}`);
  await assertNoUnexpectedModal();
  await action(regularList,'all').click();
  assert.deepEqual(await names(regularList),groups.regular.map(item=>item.person.canonical_name));
  await assertNoUnexpectedModal();
  for(const [host,items] of [[otherList,groups.other],[specialList,groups.special],[unassignedList,groups.unassigned]]){
   await action(host,'all').click();assert.deepEqual(await names(host),items.map(item=>item.person.canonical_name));
   await assertNoUnexpectedModal();
  }
  assert.equal(await page.locator('[data-unit-board-card] .unit-member-chip').count(),144,'All regular, unknown-label, special and unassigned members remain reachable');
  assert.match(await regular.innerText(),/1 setup issue/);
  const search=page.getByRole('searchbox',{name:'Find a unit or member',exact:true});
  await search.fill('Regular Complete Member 071');
  assert.deepEqual(await names(regularList),[groups.regular[71].person.canonical_name],'Search materializes the last formerly hidden member');
  assert.match(await regularList.locator('.unit-member-list__count').innerText(),/1 of 1 matching postings.*72 total/);
  assert.match(await page.locator('[data-unit-board-count]').innerText(),/87 of 144 postings shown/,'Member search retains complete matched-unit posting semantics');
  await page.getByRole('button',{name:'Clear unit filters',exact:true}).click();
  assert.equal((await names(regularList)).length,72,'Filter reset restores deliberately expanded limit');
  await action(regularList,'less').click();await action(regularList,'more').click();
  assert.equal((await names(regularList)).length,36);
  await page.locator('select[data-unit-board-campus]').selectOption('special');
  assert.equal(await regular.isVisible(),false);assert.equal(await special.isVisible(),true);
  await page.getByRole('button',{name:'Clear unit filters',exact:true}).click();
  assert.equal((await names(regularList)).length,36,'Campus filter and reset preserve expanded per-group limit');
  await page.locator('[data-refresh-unit-board]').click();
  await page.waitForFunction(()=>document.querySelector('[data-unit-member-list="2026-10:unit:large-unit:2ND_CALL"] .unit-member-list__count')?.textContent?.includes('36 of 72'));
  assert.equal((await names(regularList)).length,36,'Explicit successful read refresh preserves expanded per-group limit');
  await search.fill('Regular Complete Member 071');
  assert.deepEqual(await names(regularList),[groups.regular[71].person.canonical_name]);
  await page.getByRole('button',{name:'Clear unit filters',exact:true}).click();
  assert.equal((await names(regularList)).length,36);
  await search.fill('Royal Northern Department');
  assert.equal((await names(regularList)).length,36,'Group-title search keeps normal limited membership instead of hiding member rows');
  await page.getByRole('button',{name:'Clear unit filters',exact:true}).click();
  await assertNoUnexpectedModal();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(reads,2);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  results.push({engine,width,initialListsBounded:true,all144MembersReachable:true,keyboardExpansionAndCollapse:true,removedControlFocusRecovery:true,noAncestorModalOnExpansion:true,hiddenMemberSearch:true,groupSemanticsPreserved:true,limitsPreservedAcrossFilterAndRefresh:true,completeDatesAndStatus:true,summaryAndWarningUnchanged:true,reads,writes:0});
  await context.close();
 }}finally{await browser.close();}
}
const sources={};for(const name of ['main.ts','unit-board-filters.ts','unit-member-lists.ts'])sources[name]=createHash('sha256').update(await readFile(`src/${name}`)).digest('hex');
await writeFile('../docs/premium-ui/qa-unit-members-independent.json',JSON.stringify({createdAt:new Date().toISOString(),scope:'Independent actual-app Chromium/Firefox/WebKit phone and desktop emulation. Intercepted read-only unit data; no persisted backend or physical-device claim.',sources,results},null,2)+'\n');
console.log('Independent unit member lists: 6 cross-browser workflows passed');
