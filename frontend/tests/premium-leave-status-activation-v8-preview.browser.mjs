import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

// Presentation-only fixture: active calendar values follow leave.py's existing
// approved/requested/imported_pending_review contract. Unknown/cancelled/rejected
// values occur only in the complete request list, never invented active days.
const base=process.env.LEAVE_STATUS_BASE||'http://127.0.0.1:5197',api='http://127.0.0.1:8031';
assert.ok(['http://127.0.0.1:5197','http://127.0.0.1:5201','http://127.0.0.1:5204','http://127.0.0.1:5205','http://127.0.0.1:5206'].includes(base),'Only known local application or candidate-preview servers');
const engines=(process.env.LEAVE_STATUS_ENGINES||'chromium,firefox,webkit').split(',');
const paths=['src/main.ts','src/styles.css','src/premium-theme.css','src/services/api.ts','src/ui.ts','src/record-workspace.ts'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))])));
const initial=await hashes(),results=[];
const initialTestSha=sha(await readFile(new URL(import.meta.url)));
const candidateDir=process.env.LEAVE_STATUS_CANDIDATE_DIR;
const candidateHashes=async()=>candidateDir?Object.fromEntries(await Promise.all(['main.ts','premium-theme.css','leave-calendar-focus.ts'].map(async p=>[p,sha(await readFile(candidateDir+'/'+p))]))):null;
const initialCandidate=await candidateHashes();
const layouts=process.env.LEAVE_STATUS_STRESS==='1'?[{width:320,height:568,rootPercent:200},{width:390,height:320,rootPercent:100}]:[{width:320,height:900,rootPercent:100},{width:1280,height:900,rootPercent:100}];
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
async function modalFor(page,opener,entries,input='keyboard'){
 if(input==='keyboard'){await opener.focus();await page.keyboard.press('Enter');}else if(input==='tap')await opener.tap();else await opener.click();
 const dialog=page.locator('#leave-day-modal');await dialog.waitFor();
 assert.equal(await dialog.locator('.leave-day-person').count(),entries.length);
 const rendered=await dialog.locator('.leave-day-person').allTextContents();
 for(const e of entries){assert.ok(rendered.some(t=>t.includes(e.person_name)&&t.includes(label(e.status))&&t.includes(e.leave_slot==='FULL_DAY'?'Full Day':e.leave_slot==='AM'?'Am':'Pm')),JSON.stringify(e));}
 assert.equal(rendered.filter(t=>t.includes(a.canonical_name)).length,entries.filter(e=>e.person_id==='a').length,'Two sessions of the same member remain two records');
 assert.equal(await dialog.locator('img').count(),0);
 assert.match(await dialog.locator('header p').innerText(),new RegExp(`${entries.length} leave record`));
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
 assert.equal(await opener.evaluate(e=>e===document.activeElement),true,'Exact calendar/list opener regains focus');
}
let failure,diagnostic;
try{
 for(const engine of engines){assert.ok(Object.hasOwn({chromium,firefox,webkit},engine));const browser=await({chromium,firefox,webkit}[engine]).launch();
  try{for(const {width,height,rootPercent} of layouts)for(const scheme of ['light','dark']){
   const context=await browser.newContext({viewport:{width,height},colorScheme:scheme,reducedMotion:'no-preference',hasTouch:true}),page=await context.newPage(),errors=[],calls=[];
   try{
    diagnostic={engine,width,height,rootPercent,scheme};
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','leave-status-semantics');localStorage.setItem('duty_rota_working_month','2026-05');});
    await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());calls.push({method:q.method(),path:u.pathname,search:u.search});assert.equal(q.method(),'GET','This fixture never forwards or invents a mutation');
     if(u.pathname==='/api/v1/leave/calendar')return route.fulfill({json:calendar});
     if(u.pathname==='/api/v1/leave/requests')return route.fulfill({json:requests});
     if(u.pathname==='/api/v1/leave/pressure')return route.fulfill({json:pressure});
     return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});
    });
    await page.goto(base+'/#view=leave');const group=page.getByRole('group',{name:'Leave calendar view',exact:true});await group.waitFor();await page.waitForLoadState('networkidle');
    if(rootPercent!==100)await page.evaluate(percent=>{document.documentElement.style.fontSize=percent+'%';},rootPercent);
    const metrics=await page.locator('.board-metrics').innerText();assert.match(metrics,/People with leave records/);
    const guidance=page.locator('.leave-status-guidance');assert.match(await guidance.innerText(),/Pending requests are not confirmed absence/);assert.match(await guidance.innerText(),/Review returned blocking counts and duty safety checks/);
    const grid=page.locator('#leave-month-view'),populated=grid.locator(`[data-leave-day="${first}"]`);
    assert.equal(await grid.locator('[data-leave-day]').count(),31);assert.equal(await populated.locator('.leave-day-card__count').innerText(),'4');
    const expected=['2 Approved','1 Requested','1 Imported, Pending Review'];assert.deepEqual(await populated.locator('.leave-day-card__statuses > span').allTextContents(),expected);
    const aria=await populated.getAttribute('aria-label');for(const s of expected)assert.ok(aria.includes(s),s);assert.match(aria,/4 leave records/);assert.doesNotMatch(aria,/on leave/);
    const scroller=grid.getByRole('region',{name:'Month calendar',exact:true});assert.equal(await scroller.getAttribute('tabindex'),'0');assert.equal(await scroller.getAttribute('aria-describedby'),'leave-month-scroll-help');assert.match(await page.locator('#leave-month-scroll-help').innerText(),/arrow keys/i);
    const scrollBefore=await scroller.evaluate(e=>({left:e.scrollLeft,width:e.clientWidth,scrollWidth:e.scrollWidth}));
    if(scrollBefore.scrollWidth>scrollBefore.width+1){await scroller.focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('.leave-month-scroll').scrollLeft>0);}
    const nativeDays=grid.locator('[data-leave-day]');await nativeDays.last().focus();const keyboardDayGeometry=[];
    // Stronger than the initial v5 diagnostic: the full focused button and its
    // actual outside outline must fit the scroller's client clip, not just center.
    for(let i=30;i>=0;i--){if(i<30)await page.keyboard.press('Shift+Tab');assert.equal(await nativeDays.nth(i).evaluate(e=>e===document.activeElement),true,'Native reverse chronological Shift+Tab sequence');await page.waitForFunction(()=>{const e=document.activeElement,p=e?.closest('.leave-month-scroll');if(!p)return false;const b=e.getBoundingClientRect(),c=p.getBoundingClientRect(),s=getComputedStyle(e),ring=s.outlineStyle==='none'?0:Math.max(0,parseFloat(s.outlineWidth)+parseFloat(s.outlineOffset));const left=c.left+p.clientLeft,right=left+p.clientWidth;return b.left-ring>=left-1&&b.right+ring<=right+1;},{},{timeout:3000});const g=await nativeDays.nth(i).evaluate(e=>{const b=e.getBoundingClientRect(),p=e.closest('.leave-month-scroll'),c=p.getBoundingClientRect(),s=getComputedStyle(e),ring=s.outlineStyle==='none'?0:Math.max(0,parseFloat(s.outlineWidth)+parseFloat(s.outlineOffset));return{day:e.dataset.leaveDay,left:b.left,right:b.right,outlineExtent:ring,clipLeft:c.left+p.clientLeft,clipRight:c.left+p.clientLeft+p.clientWidth,scrollLeft:p.scrollLeft};});assert.ok(g.left-g.outlineExtent>=g.clipLeft-1&&g.right+g.outlineExtent<=g.clipRight+1,JSON.stringify(g));keyboardDayGeometry.push(g);}
    diagnostic.keyboardDayGeometry=keyboardDayGeometry;
    const statusGeometry=await populated.locator('.leave-day-card__statuses > span').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect(),p=e.closest('button').getBoundingClientRect(),s=getComputedStyle(e),wordLines=[];const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){for(const m of node.textContent.matchAll(/[A-Za-z]+/g)){const r=document.createRange();r.setStart(node,m.index);r.setEnd(node,m.index+m[0].length);wordLines.push({word:m[0],lines:r.getClientRects().length});}}return{text:e.textContent,width:b.width,height:b.height,left:b.left-p.left,right:b.right-p.left,bottom:b.bottom-p.top,cardWidth:p.width,cardHeight:p.height,fontSize:s.fontSize,wordLines,visible:s.display!=='none'&&s.visibility!=='hidden',clip:e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1};}));
    diagnostic.statusGeometry=statusGeometry;
    for(const g of statusGeometry){assert.ok(g.visible&&g.width>0&&g.height>0,JSON.stringify(g));assert.ok(g.left>=-1&&g.right<=g.cardWidth+1&&g.bottom<=g.cardHeight+1&&!g.clip,JSON.stringify(g));assert.ok(g.wordLines.every(w=>w.lines===1),'Full status words remain readable without character-by-character lines: '+JSON.stringify(g));}
    await modalFor(page,populated,days[first],'tap');
    const reads=calls.length,list=group.getByRole('button',{name:'Day list',exact:true}),monthButton=group.getByRole('button',{name:'Month',exact:true});await list.focus();await page.keyboard.press('Enter');assert.equal(await list.evaluate(e=>e===document.activeElement),true);assert.equal(await grid.isVisible(),false);
    const agenda=page.locator('#leave-day-list-view'),day=agenda.locator(`[data-leave-day="${first}"]`);assert.equal(await agenda.locator('[data-leave-day]').count(),31);const dayText=await day.innerText();for(const s of expected)assert.ok(dayText.includes(s),s);assert.ok(dayText.includes(hostile));assert.match(dayText,/View 1 more/);assert.equal(await day.locator('img').count(),0);
    await modalFor(page,day,days[first],'tap');
    const cross=agenda.locator(`[data-leave-day="${last}"]`);assert.match(await cross.innerText(),/1 leave record/);await modalFor(page,cross,days[last],'tap');
    const empty=agenda.locator('[data-leave-day="2026-05-02"]');assert.match(await empty.innerText(),/No leave records/);await empty.click();await page.locator('#leave-day-modal').getByText('No leave requests recorded for this day.',{exact:true}).waitFor();await page.keyboard.press('Escape');await page.locator('#leave-day-modal').waitFor({state:'detached'});
    await monthButton.click();assert.equal(await grid.isVisible(),true);assert.equal(await agenda.isVisible(),false);assert.equal(await page.locator('.board-metrics').innerText(),metrics);assert.equal(calls.length,reads,'Local representation switches and inspection perform no refetch');
    const table=page.locator('table[aria-labelledby="leave-list-title"]'),cards=page.locator('section[aria-label="Leave this month"]');assert.equal(await table.locator('tbody tr').count(),requests.length);assert.equal(await cards.locator('.leave-card').count(),requests.length);
    for(let i=0;i<requests.length;i++){const r=requests[i];for(const row of [table.locator('tbody tr').nth(i),cards.locator('.leave-card').nth(i)]){const text=await row.textContent();assert.ok(text.includes(r.person.canonical_name));assert.ok(text.includes(label(r.status)),r.status+' '+text);assert.equal(await row.locator('img').count(),0);assert.doesNotMatch(text,/\[object Object\]|function Object|function toString/);}}
    const crossRow=table.locator('tbody tr').nth(4);assert.match(await crossRow.textContent(),/31 May/);assert.match(await crossRow.textContent(),/2 Jun/);
    const panel=page.locator('.leave-pressure-details');await panel.locator(':scope > summary').click();const reported=panel.locator(`[data-pressure-day="${first}"]`);assert.equal(await reported.locator('[data-pressure-total]').innerText(),'4');assert.equal(await reported.locator('[data-pressure-blocking]').innerText(),'2');assert.match(await panel.innerText(),/approved requests are blocking; pending requests are shown for review/);
    const pressureReads=calls.length;await modalFor(page,reported.getByRole('button',{name:/Review leave on/}),days[first],'tap');assert.equal(calls.length,pressureReads,'Actual pressure launcher inspection needs no new request');
    assert.equal(await page.evaluate(()=>window.leaveStatusInjected),undefined);
    diagnostic.overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,offenders:[...document.body.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&r.width>0&&(r.right>innerWidth+1||r.left < -1)&&!e.closest('[hidden]');}).slice(0,30).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,100),rect:{left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width}}))}));
    assert.ok(diagnostic.overflow.document<=width,JSON.stringify(diagnostic.overflow));assert.deepEqual(errors,[]);
    const axe=await new AxeBuilder({page}).include('.leave-calendar').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(x=>x.id),[]);
    results.push({engine,width,height,rootPercent,scheme,statusGeometry,scrollBefore,keyboardDayGeometry,fixtureActiveEntryIds:Object.fromEntries(Object.entries(days).map(([date,es])=>[date,es.map(e=>e.leave_id)])),duplicateSessionsPreserved:true,knownAndUnknownRequestStatusesTextual:true,warningVsApprovedSessionGuidance:true,returnedBlockingAndTotalUnchanged:true,monthListModalNoRefetch:true,reverseTab31Days:true,nativeTapMonthListPressure:true,normalMotion:true,fullCrossMonthRequestRange:true,escapedText:true,exactFocusReturn:true,axeViolations:0,errors});
   }finally{await context.close();}
  }}finally{await browser.close();}
 }
 assert.deepEqual(await hashes(),initial,'Application source held throughout native-browser run');
 assert.deepEqual(await candidateHashes(),initialCandidate,'Scratch candidate held throughout preview run');
 assert.equal(sha(await readFile(new URL(import.meta.url))),initialTestSha,'Test source held throughout native-browser run');
}catch(e){failure={message:e.message,stack:e.stack,diagnostic};}
const candidate=candidateDir?{directory:candidateDir,source_sha256:initialCandidate,final_source_sha256:await candidateHashes(),limit:'Transform-only candidate preview; application source hashes below identify held live files, not candidate bytes.'}:null;
const report={recorded_at_utc:new Date().toISOString(),base,candidate,test_sha256:sha(await readFile('tests/premium-leave-status-activation-v8-preview.browser.mjs')),source_sha256:initial,final_source_sha256:await hashes(),scope:'Actual shell normal-motion reverse Tab/native touch month,list,cross-month,pressure launchers with GET-only contract-faithful active calendar/pressure fixture and complete request-list defensive unknown statuses; three engines, 320/1280 light/dark. No backend mutation, scheduling decision, native AT or physical-device claim. Monthly review remains separately tested.',fixture:{calendar,requestIds:requests.map(r=>({id:r.id,status:r.status,slot:r.leave_slot,starts_on:r.starts_on,ends_on:r.ends_on})),pressure},results,failure};
await writeFile('../docs/premium-ui/qa-leave-status-activation-v8-preview'+(process.env.LEAVE_STATUS_STRESS==='1'?'-stress':'')+(engines.length===1?'-'+engines[0]:'')+'.json',JSON.stringify(report,null,2)+'\n');
if(failure)throw new Error(failure.message);console.log(`Leave status semantics: ${results.length} contexts passed`);
