import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Import the exact candidate module; deterministic RAF/clock/geometry fault
// injection is confined to an isolated fixture, never the app or backend.
const base=process.env.LEAVE_HELPER_BASE||'http://127.0.0.1:5197';
assert.ok(['http://127.0.0.1:5197'].includes(base));
const revision='v8-integrated',candidateDir=process.env.LEAVE_HELPER_CANDIDATE_DIR||'src';
const engines=(process.env.LEAVE_HELPER_ENGINES||'chromium,firefox,webkit').split(',');
const sha=b=>createHash('sha256').update(b).digest('hex');
const candidateHashes=async()=>Object.fromEntries(await Promise.all(['main.ts','premium-theme.css','leave-calendar-focus.ts'].map(async f=>[f,sha(await readFile(candidateDir+'/'+f))])));
const appFiles=['src/main.ts','src/premium-theme.css','src/member-profile.ts','src/record-workspace.ts','src/services/api.ts'];
const appHashes=async()=>Object.fromEntries(await Promise.all(appFiles.map(async f=>['frontend/'+f,sha(await readFile(f))])));
const initial=await appHashes(),candidateInitial=await candidateHashes(),testSha=sha(await readFile(new URL(import.meta.url))),results=[];
const layouts=process.env.LEAVE_HELPER_LAYOUT==='short'?[{width:390,height:320,root:100}]:process.env.LEAVE_HELPER_LAYOUT==='enlarged'?[{width:320,height:568,root:200}]:[{width:320,height:568,root:200},{width:390,height:320,root:100}];
const scenarios=['stable-native-geometry','scrollBy-missing','scrollBy-throws','raf-missing','raf-throws','cancelRAF-missing','cancelRAF-throws','abort-before-bind','lifetime-abort','remove-root','hidden-root','inert-root','new-focus','native-pointer','native-wheel','native-keydown','moving-deadline-fitting','later-stable-restores-hint'];
const selected=process.env.LEAVE_HELPER_SCENARIOS?.split(',')||scenarios;
const days=Array.from({length:31},(_,i)=>`<button type="button" class="leave-day-card" data-leave-day="2026-05-${String(i+1).padStart(2,'0')}" aria-label="May ${i+1}: 1 leave record: 1 Requested"><span class="leave-day-card__date">${i+1}</span><strong class="leave-day-card__count">1</strong><span class="leave-day-card__statuses"><span>1 Requested</span></span></button>`).join('');
const html=`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="outside" type="button">Day list</button><section class="panel leave-calendar" id="root" style="max-width:100%;min-width:0"><p id="leave-month-scroll-help" role="note">Scroll across the month. Choose Day list for a full-width view.</p><div class="leave-month-scroll" tabindex="0" role="region" aria-label="Month calendar" aria-describedby="leave-month-scroll-help"><div class="leave-week-header" aria-hidden="true">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(s=>`<span>${s}</span>`).join('')}</div><div class="leave-calendar-grid">${days}</div></div></section></body></html>`;
for(const engine of engines){assert.ok(Object.hasOwn({chromium,firefox,webkit},engine));const browser=await({chromium,firefox,webkit}[engine]).launch();
 try{for(const layout of layouts)for(const scenario of selected){assert.ok(scenarios.includes(scenario));
  const context=await browser.newContext({viewport:{width:layout.width,height:layout.height},reducedMotion:'reduce',colorScheme:layout.root===200?'dark':'light'}),page=await context.newPage(),pageErrors=[],requests=[];
  page.on('pageerror',e=>pageErrors.push(e.message));let failure,trace;
  try{
   await page.route('**/__leave-focus-helper',r=>r.fulfill({contentType:'text/html',body:html}));
   await page.route('**/api/**',r=>{requests.push({method:r.request().method(),url:r.request().url()});return r.abort('blockedbyclient');});
   await page.goto(base+'/__leave-focus-helper');await page.evaluate(root=>document.documentElement.style.fontSize=root+'%',layout.root);
   await page.evaluate(async scenario=>{
    const {bindLeaveCalendarFocus}=await import('/src/leave-calendar-focus.ts');
    const root=document.querySelector('#root'),region=root.querySelector('.leave-month-scroll'),target=region.querySelector(scenario.startsWith('scrollBy-')?'[data-leave-day="2026-05-31"]':'[data-leave-day]'),outside=document.querySelector('#outside'),hint=root.querySelector('#leave-month-scroll-help');
    const life=new AbortController(),queue=new Map(),stats={requested:0,cancelled:0,callbacks:0,geometryReads:0,scrollCalls:0,callbackErrors:[],intents:[]};let clock=0,nextId=1,moving=scenario==='moving-deadline-fitting';
    const originalRAF=window.requestAnimationFrame,originalCancel=window.cancelAnimationFrame,originalNow=performance.now,originalScroll=region.scrollBy.bind(region),nativeRect=target.getBoundingClientRect.bind(target);
    const scheduled=callback=>{stats.requested++;const id=nextId++;queue.set(id,callback);return id;};
    window.requestAnimationFrame=scheduled;window.cancelAnimationFrame=id=>{stats.cancelled++;queue.delete(id);};
    Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
    target.getBoundingClientRect=()=>{stats.geometryReads++;const b=nativeRect();return moving?new DOMRect(b.x,b.y+stats.geometryReads,b.width,b.height):b;};
    region.scrollBy=options=>{stats.scrollCalls++;return originalScroll(options);};
    for(const type of ['pointerdown','wheel','keydown'])document.addEventListener(type,e=>stats.intents.push({type,defaultPrevented:e.defaultPrevented}),{capture:true});
    if(scenario==='scrollBy-missing')region.scrollBy=undefined;
    if(scenario==='scrollBy-throws')region.scrollBy=()=>{stats.scrollCalls++;throw Error('Injected scrollBy failure');};
    if(scenario==='raf-missing'||scenario==='later-stable-restores-hint')window.requestAnimationFrame=undefined;
    if(scenario==='raf-throws')window.requestAnimationFrame=()=>{stats.requested++;throw Error('Injected RAF failure');};
    if(scenario==='cancelRAF-missing')window.cancelAnimationFrame=undefined;
    if(scenario==='cancelRAF-throws')window.cancelAnimationFrame=()=>{stats.cancelled++;throw Error('Injected cancelRAF failure');};
    if(scenario==='abort-before-bind')life.abort();
    bindLeaveCalendarFocus(root,life.signal);
    const snapshot=()=>{const b=nativeRect(),c=region.getBoundingClientRect(),s=getComputedStyle(target),ring=s.outlineStyle==='none'?0:parseFloat(s.outlineWidth)+Math.max(0,parseFloat(s.outlineOffset)||0);return {active:document.activeElement===target,role:hint.getAttribute('role'),hint:hint.textContent,pending:queue.size,stats:JSON.parse(JSON.stringify(stats)),scrollLeft:region.scrollLeft,fits:b.left-ring>=c.left+region.clientLeft-0.5&&b.right+ring<=c.left+region.clientLeft+region.clientWidth+0.5,connected:root.isConnected};};
    const drain=(time=clock+16)=>{clock=time;const batch=[...queue];queue.clear();for(const [id,callback]of batch){stats.callbacks++;try{callback(clock);}catch(e){stats.callbackErrors.push(e.message);}}return snapshot();};
    window.helperHarness={root,region,target,outside,hint,life,stats,queue,snapshot,drain,restoreRAF:()=>{window.requestAnimationFrame=scheduled;},focus:()=>target.focus({preventScroll:true}),setMoving:v=>moving=v,restoreNative:()=>{window.requestAnimationFrame=originalRAF;window.cancelAnimationFrame=originalCancel;Object.defineProperty(performance,'now',{configurable:true,value:originalNow});}};
   },scenario);
   await page.evaluate(()=>window.helperHarness.focus());
   const start=await page.evaluate(()=>window.helperHarness.snapshot());
   const cancellation=['cancelRAF-missing','cancelRAF-throws','lifetime-abort','remove-root','hidden-root','inert-root','new-focus','native-pointer','native-wheel','native-keydown'].includes(scenario);
   if(scenario==='abort-before-bind'){assert.equal(start.stats.geometryReads,0);assert.equal(start.pending,0);}
   else if(cancellation){
    assert.ok(start.pending>0,'Cancellation must interrupt genuinely pending helper work');
    if(['cancelRAF-missing','cancelRAF-throws','lifetime-abort'].includes(scenario))await page.evaluate(()=>window.helperHarness.life.abort());
    else if(scenario==='remove-root')await page.evaluate(()=>window.helperHarness.root.remove());
    else if(scenario==='hidden-root')await page.evaluate(()=>window.helperHarness.root.hidden=true);
    else if(scenario==='inert-root')await page.evaluate(()=>window.helperHarness.root.inert=true);
    else if(scenario==='new-focus')await page.locator('#outside').focus();
    else if(scenario==='native-pointer')await page.locator('#outside').click();
    else if(scenario==='native-wheel'){await page.locator('.leave-month-scroll').scrollIntoViewIfNeeded();const b=await page.locator('.leave-month-scroll').boundingBox();await page.mouse.move(b.x+Math.min(30,b.width/2),Math.max(2,Math.min(layout.height-2,b.y+20)));await page.mouse.wheel(120,0);await page.waitForTimeout(30);}
    else if(scenario==='native-keydown')await page.keyboard.press('ArrowRight');
    const afterIntent=await page.evaluate(()=>window.helperHarness.snapshot());
    for(let i=0;i<3;i++)await page.evaluate(()=>window.helperHarness.drain());
    const end=await page.evaluate(()=>window.helperHarness.snapshot());
    assert.equal(end.stats.geometryReads,afterIntent.stats.geometryReads,'No geometry work after lost ownership/lifecycle/manual intent');assert.equal(end.pending,0,'No helper RAF rescheduling after cancellation');assert.deepEqual(end.stats.callbackErrors,[]);
    if(scenario.startsWith('native-'))assert.ok(end.stats.intents.some(e=>e.type===({'native-pointer':'pointerdown','native-wheel':'wheel','native-keydown':'keydown'})[scenario]),'Actual native input reached document');
    trace={start,afterIntent,end};
   }else if(scenario==='raf-missing'||scenario==='raf-throws'){
    assert.equal(start.role,'status','Unavailable settling must disclose Day list fallback even when instantaneous geometry fits');assert.match(start.hint,/Choose Day list/);assert.equal(start.pending,0);trace={start};
   }else if(scenario==='moving-deadline-fitting'){
    assert.equal(start.fits,true,'Deadline edge intentionally begins momentarily fitting');
    for(const time of [250,500,750])await page.evaluate(t=>window.helperHarness.drain(t),time);
    const deadline=await page.evaluate(()=>window.helperHarness.drain(1001));assert.equal(deadline.fits,true);assert.equal(deadline.role,'status','Moving-but-fitting deadline cannot claim stable success');assert.match(deadline.hint,/Choose Day list/);assert.equal(deadline.pending,0);trace={start,deadline};
   }else if(scenario==='later-stable-restores-hint'){
    assert.equal(start.role,'status');assert.match(start.hint,/currently unavailable/);
    await page.locator('#outside').focus();assert.equal(await page.locator('#leave-month-scroll-help').getAttribute('role'),'status','Cancellation alone must not clear prior failure');
    await page.evaluate(()=>{window.helperHarness.restoreRAF();window.helperHarness.focus();});
    for(let i=0;i<3;i++){await page.evaluate(()=>window.helperHarness.drain());assert.equal(await page.locator('#leave-month-scroll-help').getAttribute('role'),'status','Fewer than four stable intervals cannot clear failure');}
    const end=await page.evaluate(()=>window.helperHarness.drain());assert.equal(end.role,'note');assert.equal(end.hint,'Scroll across the month. Choose Day list for a full-width view.');assert.equal(end.pending,0);assert.equal(end.fits,true);trace={start,end};
   }else{
    for(let i=0;i<5;i++)await page.evaluate(()=>window.helperHarness.drain());
    const end=await page.evaluate(()=>window.helperHarness.snapshot());assert.equal(end.fits,true,'Actual native card and focus ring fit region');assert.equal(end.pending,0);assert.equal(end.role,'note');assert.deepEqual(end.stats.callbackErrors,[]);trace={start,end};
   }
   await page.waitForTimeout(20);assert.deepEqual(pageErrors,[],'No escaped errors from optional frame cancellation/fallback');assert.deepEqual(requests,[],'Isolated helper never calls API');
  }catch(e){failure={message:e.message,stack:e.stack};try{trace={...(trace||{}),failureSnapshot:await page.evaluate(()=>window.helperHarness?.snapshot())};}catch{}}
  results.push({engine,...layout,scenario,passed:!failure,failure,trace,pageErrors,requests});console.log(`Helper ${revision}: ${engine} ${layout.width}x${layout.height} root${layout.root} ${scenario} ${failure?'FAIL':'PASS'}`);
  await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await appHashes(),initial,'Application sources held');assert.deepEqual(await candidateHashes(),candidateInitial,'Candidate sources held');assert.equal(sha(await readFile(new URL(import.meta.url))),testSha);
const failed=results.filter(r=>!r.passed),report=process.env.LEAVE_HELPER_REPORT||`../docs/premium-ui/qa-leave-calendar-focus-helper-${revision}.json`;
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),base,candidateDirectory:candidateDir,candidate_sha256:candidateInitial,source_sha256:initial,test_sha256:testSha,scope:'Isolated exact imported candidate helper with actual native31-date scroller/styles. Native input cancellation plus deterministic fault injection of RAF/cancelRAF/scrollBy/performance clock and moving rect. Controlled RAF is not a full app/native scroll animation proof; actual-shell tester separately covers real month workflows. All API traffic blocked; no writes. Emulation only.',passed:failed.length===0,contexts:results.length,failed:failed.length,results},null,2)+'\n');
console.log(`Helper ${revision}: ${results.length-failed.length}/${results.length} contexts passed`);if(failed.length)process.exitCode=1;
