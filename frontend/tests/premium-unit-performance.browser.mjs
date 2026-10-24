import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const units=Array.from({length:10},(_,i)=>({id:`unit-${i}`,name:`Department Unit ${String(i).padStart(2,'0')}`,campus:i%2?'West':'Main',code:`U${i}`,minimum_free_people:1,active_status:'active',notes:null}));
const fixture=count=>({month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units,assignments:Array.from({length:count},(_,i)=>({id:`posting-${i}`,person:{id:`member-${i}`,canonical_name:`Dr Representative Member ${String(i).padStart(5,'0')}`,call_level:'2ND_CALL',active_status:'active'},unit:units[i%10],posting_type:'2ND_CALL',starts_on:'2026-10-01',ends_on:'2026-10-31',source:'manual',notes:null})),unit_summaries:units.map(unit=>({unit_id:unit.id,assigned_members:count/10,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]});
const samples=[];
const browser=await chromium.launch({headless:true});
try{
 for(const count of [50,500,2000])for(const width of [320,1280])for(let sample=1;sample<=3;sample++){
  const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],writes=[];let monthReads=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   localStorage.setItem('duty_rota_auth_token','unit-performance-review');
   localStorage.setItem('duty_rota_working_month','2026-10');
   window.__unitPerformance={longTasks:[],interactions:[]};
   const state=window.__unitPerformance;
   state.longTasksSupported=PerformanceObserver.supportedEntryTypes.includes('longtask');
   if(state.longTasksSupported)new PerformanceObserver(list=>state.longTasks.push(...list.getEntries().map(({startTime,duration})=>({startTime,duration})))).observe({type:'longtask',buffered:true});
   const original=window.fetch;
   window.fetch=async(...args)=>{
    const response=await original(...args);
    if(response.url.includes('/unit-management/month'))state.readResolved=performance.now();
    return response;
   };
   for(const type of ['input','change'])document.addEventListener(type,event=>{
    if(!event.target.matches('input[data-unit-board-search],select[data-unit-board-campus]'))return;
    const started=performance.now(),kind=event.target.tagName==='SELECT'?'campus':'search';
    requestAnimationFrame(()=>requestAnimationFrame(()=>state.interactions.push({kind,duration:performance.now()-started})));
   },true);
  });
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()!=='GET'){writes.push({method:request.method(),path:url.pathname});return route.abort('blockedbyclient');}
   if(url.pathname.endsWith('/unit-management/month')){monthReads++;return route.fulfill({json:fixture(count)});}
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=units');
  const search=page.getByRole('searchbox',{name:'Find a unit or member',exact:true});
  await search.waitFor();
  await page.waitForFunction(expected=>document.querySelectorAll('[data-unit-board-row]').length===Math.min(expected,50),count);
  const initial=await page.evaluate(async()=>{
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const state=window.__unitPerformance;
   return {readToBoardMs:performance.now()-state.readResolved,domElements:document.querySelectorAll('*').length,memberChips:document.querySelectorAll('.unit-member-chip').length,postingRows:document.querySelectorAll('[data-unit-board-row]').length,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.equal(initial.overflow,false);assert.equal(initial.postingRows,Math.min(count,50));assert.equal(initial.memberChips,Math.min(count,120));
  await search.fill(`Member ${String(count-1).padStart(5,'0')}`);
  await page.waitForFunction(()=>window.__unitPerformance.interactions.some(item=>item.kind==='search'));
  const visibleCards=()=>page.locator('[data-unit-board-card]').evaluateAll(nodes=>nodes.filter(node=>!node.hidden).map(node=>node.dataset.unitBoardCard));
  assert.deepEqual(await visibleCards(),[`unit:unit-${(count-1)%10}`]);
  await search.fill('');
  await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
  await page.waitForFunction(()=>window.__unitPerformance.interactions.some(item=>item.kind==='campus'));
  assert.equal((await visibleCards()).length,5);
  await page.getByRole('button',{name:'Clear unit filters',exact:true}).click();
  assert.equal((await visibleCards()).length,13);
  const measurements=await page.evaluate(()=>({...window.__unitPerformance,overflow:document.documentElement.scrollWidth>innerWidth}));
  if(count===2000 && width===320 && sample===1){
   const all=page.getByRole('button',{name:'Show all 200 postings',exact:true});
   while(await all.count())await all.first().click();
   assert.equal(await page.locator('.unit-member-chip').count(),2000,'All2000card postings are reachable on demand');
   assert.equal(await page.locator('#unit-management-modal').count(),0,'Expansion never triggers surrounding unit modal');
  }
  assert.equal(measurements.overflow,false);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.equal(monthReads,1);
  samples.push({count,width,sample,...initial,searchMs:measurements.interactions.find(item=>item.kind==='search').duration,campusFilterMs:measurements.interactions.find(item=>item.kind==='campus').duration,longTasksSupported:measurements.longTasksSupported,longTasks:measurements.longTasks,errors,writes,monthReads});
  console.log(`${count} postings at ${width}px sample ${sample}: read-to-board ${initial.readToBoardMs.toFixed(1)}ms, search ${samples.at(-1).searchMs.toFixed(1)}ms, DOM ${initial.domElements}`);
  await context.close();
 }
}finally{await browser.close();}
const summaries=[];
for(const count of [50,500,2000])for(const width of [320,1280]){
 const group=samples.filter(item=>item.count===count&&item.width===width);
 const metric=key=>{const values=group.map(item=>item[key]).sort((a,b)=>a-b);return {min:values[0],median:values[1],max:values[2]};};
 summaries.push({count,width,samples:3,readToBoardMs:metric('readToBoardMs'),searchMs:metric('searchMs'),campusFilterMs:metric('campusFilterMs'),domElements:group[0].domElements,longTaskCount:group.map(item=>item.longTasks.length),longTaskMaxMs:group.map(item=>Math.max(0,...item.longTasks.map(task=>task.duration)))});
}
const sources={};for(const name of ['main.ts','premium-theme.css','unit-board-filters.ts','unit-member-lists.ts'])sources[name]=createHash('sha256').update(await readFile(`src/${name}`)).digest('hex');
await writeFile('../docs/premium-ui/qa-unit-performance.json',JSON.stringify({createdAt:new Date().toISOString(),scope:'Measured actual Chromium app with GET-only intercepted October month, 10 units, 50/500/2000 unique people and postings, 320/1280 CSS pixels, 3 fresh contexts each. Read-to-board is fetch response resolution until complete expected DOM and two animation frames; includes test observation overhead. Interaction capture until two animation frames includes handler and frame waiting; not INP or physical-device latency. Long tasks cover page lifetime including shell and fixture fetches. No CPU/network throttling, no backend persistence, no production bundle or cross-browser performance claim. No global performance threshold asserted.',sources,summaries,samples},null,2)+'\n');
console.log('Unit performance: 18 measured populated workflows completed, no writes, overflow or page errors');
