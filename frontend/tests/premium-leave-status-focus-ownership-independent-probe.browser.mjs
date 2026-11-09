import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

// Presentation-only fixture: active calendar values follow leave.py's existing
// approved/requested/imported_pending_review contract. Unknown/cancelled/rejected
// values occur only in the complete request list, never invented active days.
const base=process.env.LEAVE_STATUS_BASE||'http://127.0.0.1:5197',api='http://127.0.0.1:8031';
assert.ok(['http://127.0.0.1:5197','http://127.0.0.1:5201'].includes(base),'Only known local application or candidate-preview servers');
const engines=(process.env.LEAVE_STATUS_ENGINES||'chromium,firefox,webkit').split(',');
const paths=['src/main.ts','src/styles.css','src/premium-theme.css','src/services/api.ts','src/ui.ts','src/record-workspace.ts'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))])));
const initial=await hashes(),results=[];
const month='2026-05',first='2026-05-01',last='2026-05-31';
const hostile='Example <img src=x onerror="window.leaveStatusInjected=true"> '+ 'VeryLongMemberName'.repeat(5);
const person=(id,name)=>({id,canonical_name:name,call_level:'1ST_CALL',active:true});
const a=person('a','Duplicate Session Member'),b=person('b',hostile),c=person('c','Approved Whole Day'),d=person('d','Cross Month Member');
const req=(id,p,status,slot='FULL_DAY',start=first,end=start)=>({id,person:p,person_id:p.id,status,leave_slot:slot,leave_type:'ANNUAL_LEAVE',starts_on:start,ends_on:end,days:Math.round((Date.parse(end)-Date.parse(start))/86400000)+1,notes:null});
const requests=[req('a-am',a,'approved','AM'),req('a-pm',a,'requested','PM'),req('b-import',b,'imported_pending_review'),req('c-full',c,'approved'),req('d-cross',d,'imported_pending_review','FULL_DAY',last,'2026-06-02'),...['cancelled','rejected','constructor','__proto__','toString','<img src=x onerror="window.leaveStatusInjected=true">'].map((s,i)=>req('inactive-'+i,person('inactive-person-'+i,'History Member '+i),s))];
const entry=r=>({leave_id:r.id,person_id:r.person.id,person_name:r.person.canonical_name,leave_type:r.leave_type,leave_slot:r.leave_slot,status:r.status,unit:'Main Unit',posting_type:'1ST_CALL',call_level:'1ST_CALL'});
const active=requests.slice(0,5),days={[first]:active.slice(0,4).map(entry),[last]:[entry(active[4])]};
const calendar={month,summary:{month,starts_on:first,ends_on:last,total_requests:5,blocking_requests:2,people_on_leave:4,total_leave_days:5,busiest_day:{date:first,count:4},status_counts:{approved:2,requested:1,imported_pending_review:2},type_counts:{ANNUAL_LEAVE:5},slot_counts:{AM:1,PM:1,FULL_DAY:3},unit_counts:{'Main Unit':5},call_level_counts:{'1ST_CALL':5}},days};
const pressure={month,starts_on:first,ends_on:last,unit_totals:{'Main Unit':5},call_level_totals:{'1ST_CALL':5},blockers:[],days:Object.entries(days).map(([date,entries])=>({date,total_people:entries.length,blocking_people:entries.filter(e=>e.status==='approved').length,unit_counts:{'Main Unit':entries.length},call_level_counts:{'1ST_CALL':entries.length},entries}))};
const labels={approved:'Approved',requested:'Requested',imported_pending_review:'Imported, Pending Review',cancelled:'Cancelled',rejected:'Rejected',constructor:'Constructor',__proto__:'Proto',toString:'Tostring'};
// Own entries avoid the exact prototype-lookup regression under review.
const label=s=>Object.hasOwn(labels,s)?labels[s]:s.replace(/_/g,' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());



const output=[];
for(const [engine,type]of Object.entries({chromium,firefox,webkit})){
const browser=await type.launch();try{for(const scenario of ['new-focus','manual-pointer','manual-wheel','new-keydown','disconnect']){
const width=320,height=900,rootPercent=200,variant='forced-unsupported-raf';
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage();
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','independent-horizontal-focus');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());assert.equal(q.method(),'GET');if(u.pathname==='/api/v1/leave/calendar')return route.fulfill({json:calendar});if(u.pathname==='/api/v1/leave/requests')return route.fulfill({json:requests});if(u.pathname==='/api/v1/leave/pressure')return route.fulfill({json:pressure});return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});});
  await page.goto('http://127.0.0.1:5201/#view=leave');await page.getByRole('group',{name:'Leave calendar view',exact:true}).waitFor();await page.waitForLoadState('networkidle');
  if(rootPercent!==100)await page.evaluate(x=>document.documentElement.style.fontSize=x+'%',rootPercent);

  const support=await page.evaluate(variant=>{const region=document.querySelector('.leave-month-scroll');window.focusOwnership=[];const supported='onscrollend'in region&&variant==='native-scrollend';region.addEventListener('focusin',event=>{const target=event.target;if(!(target instanceof HTMLButtonElement)||!target.matches('[data-leave-day]')||target!==document.activeElement||!region.contains(target))return;const controller=new AbortController(),options={once:true,signal:controller.signal},start=performance.now();const log=(kind,extra={})=>window.focusOwnership.push({kind,day:target.dataset.leaveDay,active:target===document.activeElement,time:performance.now(),...extra});const cancel=event=>{log('cancel',{reason:event?.type||'completed'});controller.abort();};for(const name of ['pointerdown','wheel','keydown'])region.addEventListener(name,cancel,options);target.addEventListener('focusout',cancel,options);function owns(){return !controller.signal.aborted&&target===document.activeElement&&region.isConnected&&target.isConnected&&region.contains(target)&&!region.closest('[hidden],[inert]');}function reveal(reason){if(!owns())return;const b=target.getBoundingClientRect(),c=region.getBoundingClientRect();if(b.width===0||c.width===0)return;const left=c.left+region.clientLeft,right=left+region.clientWidth,ring=5,raw=b.left-ring<left?b.left-ring-left:b.right+ring>right?b.right+ring-right:0,delta=raw<0?Math.floor(raw):Math.ceil(raw);if(delta){log('reveal',{reason,delta});region.scrollBy({left:delta,behavior:'instant'});}}log('focusin');if(supported)region.addEventListener('scrollend',()=>{if(owns()){reveal('scrollend');log('settled',{reason:'scrollend',elapsed:performance.now()-start});}cancel();},options);else {let previous=NaN,stable=0;function frame(){if(!owns())return;reveal('raf');const current=region.scrollLeft;stable=Math.abs(current-previous)<0.1?stable+1:0;previous=current;if(stable>=4||performance.now()-start>=1000){log('settled',{reason:'raf',elapsed:performance.now()-start,stable});cancel();}else requestAnimationFrame(frame);}requestAnimationFrame(frame);}reveal('focusin');});return {native:'onscrollend'in region,used:supported};},variant);

const scroller=page.locator('.leave-month-scroll'),day=scroller.locator('[data-leave-day]').first();await scroller.focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('.leave-month-scroll').scrollLeft>0);await day.focus();
const actionTime=await page.evaluate(()=>performance.now());
if(scenario==='new-focus')await page.getByRole('button',{name:'Day list',exact:true}).focus();
if(scenario==='manual-pointer'){const b=await scroller.boundingBox();await page.mouse.move(b.x+2,b.y+2);await page.mouse.down();await scroller.evaluate(e=>e.scrollLeft+=100);await page.mouse.up();}
if(scenario==='manual-wheel'){const b=await scroller.boundingBox();await page.mouse.move(b.x+20,b.y+20);await page.mouse.wheel(150,0);}
if(scenario==='new-keydown')await page.keyboard.press('ArrowRight');
if(scenario==='disconnect')await scroller.evaluate(e=>e.remove());
await page.waitForTimeout(600);
const ownership=await page.evaluate(()=>window.focusOwnership),events=ownership.filter(x=>x.day==='2026-05-01'),cancel=events.find(x=>x.kind==='cancel'&&x.reason!=='completed');
if(scenario!=='disconnect'){assert.ok(cancel,'Actual cancellation event '+engine+'/'+scenario);assert.equal(events.filter(x=>x.kind==='reveal'&&x.time>cancel.time).length,0,'No corrective scroll after newer manual/focus intent');}
else assert.equal(events.filter(x=>x.kind==='reveal'&&x.time>actionTime+1).length,0,'No corrective scroll after disconnected region');
if(scenario==='new-focus')assert.equal(await page.getByRole('button',{name:'Day list',exact:true}).evaluate(e=>e===document.activeElement),true,'No focus stealing');
output.push({engine,scenario,support,actionTime,ownership,newerIntentPreserved:true});await context.close();console.log(JSON.stringify({engine,scenario,passed:true}));
}}finally{await browser.close();}}
assert.deepEqual(await hashes(),initial);await writeFile('../tmp/leave-status-independent-focus-ownership.json',JSON.stringify({scope:'Response-only forced-unsupported boundedRAF focus correction cancellation: actual new focus/nativepointer/nativewheel/nativekeydown; disconnect via testDOMremoval. Manual pointer test uses native pointer intent then explicit testscroll, not a real drag-scroll claim. No app/candidate/API writes.',source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),output},null,2)+'\n');
