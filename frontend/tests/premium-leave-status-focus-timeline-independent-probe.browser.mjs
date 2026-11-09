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



const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:320,height:900},reducedMotion:'reduce'}),page=await context.newPage();
try{
await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','independent-focus-timeline');localStorage.setItem('duty_rota_working_month','2026-05');});
await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());assert.equal(q.method(),'GET');if(u.pathname==='/api/v1/leave/calendar')return route.fulfill({json:calendar});if(u.pathname==='/api/v1/leave/requests')return route.fulfill({json:requests});if(u.pathname==='/api/v1/leave/pressure')return route.fulfill({json:pressure});return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});});
await page.goto('http://127.0.0.1:5201/#view=leave');await page.getByRole('group',{name:'Leave calendar view',exact:true}).waitFor();await page.waitForLoadState('networkidle');await page.evaluate(()=>document.documentElement.style.fontSize='200%');
await page.evaluate(()=>{window.focusTimeline=[];const region=document.querySelector('.leave-month-scroll');const record=(kind,target)=>{const b=target.getBoundingClientRect(),c=region.getBoundingClientRect();window.focusTimeline.push({kind,time:performance.now(),active:target===document.activeElement,day:target.dataset.leaveDay,left:b.left,right:b.right,scrollLeft:region.scrollLeft,clientLeft:c.left+region.clientLeft,clientRight:c.left+region.clientLeft+region.clientWidth,scrollWidth:region.scrollWidth});};region.addEventListener('focusin',event=>{const target=event.target;record('focusin entry',target);function reveal(){if(!(target instanceof HTMLButtonElement)||!target.matches('[data-leave-day]')||target!==document.activeElement||!region.isConnected||!target.isConnected||!region.contains(target)){record('guard rejected',target);return;}const b=target.getBoundingClientRect(),c=region.getBoundingClientRect(),left=c.left+region.clientLeft,right=left+region.clientWidth,ring=4;const delta=b.left-ring<left?b.left-ring-left:b.right+ring>right?b.right+ring-right:0;record('before reveal delta='+delta,target);region.scrollTo({left:region.scrollLeft+delta,behavior:'instant'});record('after reveal',target);}reveal();requestAnimationFrame(()=>{record('RAF before reveal',target);reveal();requestAnimationFrame(()=>record('RAF2',target));});});region.addEventListener('scroll',()=>record('scroll',document.activeElement));});
const scroller=page.locator('.leave-month-scroll');await scroller.focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('.leave-month-scroll').scrollLeft>0);await scroller.locator('[data-leave-day]').first().focus();await page.waitForTimeout(500);const result=await page.evaluate(()=>window.focusTimeline);await writeFile('../tmp/leave-status-independent-focus-timeline.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await context.close();await browser.close();}
