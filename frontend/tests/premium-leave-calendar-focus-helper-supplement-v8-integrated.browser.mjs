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
const scenarios=['scrollBy-missing-working-setter','scrollBy-throws-working-setter','scrollLeft-throws','scrollLeft-noop','lifetime-rebind'];
const selected=process.env.LEAVE_HELPER_SCENARIOS?.split(',')||scenarios;
const days=Array.from({length:31},(_,i)=>`<button type="button" class="leave-day-card" data-leave-day="2026-05-${String(i+1).padStart(2,'0')}" aria-label="May ${i+1}: 1 leave record: 1 Requested"><span class="leave-day-card__date">${i+1}</span><strong class="leave-day-card__count">1</strong><span class="leave-day-card__statuses"><span>1 Requested</span></span></button>`).join('');
const html=`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="outside" type="button">Day list</button><section class="panel leave-calendar" id="root" style="max-width:100%;min-width:0"><p id="leave-month-scroll-help">Scroll across the month. Choose Day list for a full-width view.</p><div class="leave-month-scroll" tabindex="0" role="region" aria-label="Month calendar" aria-describedby="leave-month-scroll-help"><div class="leave-week-header" aria-hidden="true">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(s=>`<span>${s}</span>`).join('')}</div><div class="leave-calendar-grid">${days}</div></div></section></body></html>`;
for(const engine of engines){assert.ok(Object.hasOwn({chromium,firefox,webkit},engine));const browser=await({chromium,firefox,webkit}[engine]).launch();
 try{for(const layout of layouts)for(const scenario of selected){assert.ok(scenarios.includes(scenario));
  const context=await browser.newContext({viewport:{width:layout.width,height:layout.height},reducedMotion:'no-preference',colorScheme:layout.root===200?'dark':'light'}),page=await context.newPage(),pageErrors=[],requests=[];
  page.on('pageerror',e=>pageErrors.push(e.message));let failure,trace;
  try{
   await page.route('**/__leave-focus-helper',r=>r.fulfill({contentType:'text/html',body:html}));
   await page.route('**/api/**',r=>{requests.push({method:r.request().method(),url:r.request().url()});return r.abort('blockedbyclient');});
   await page.goto(base+'/__leave-focus-helper');await page.evaluate(root=>document.documentElement.style.fontSize=root+'%',layout.root);
   await page.evaluate(async scenario=>{
    const {bindLeaveCalendarFocus}=await import('/src/leave-calendar-focus.ts');
    const root=document.querySelector('#root'),region=root.querySelector('.leave-month-scroll'),target=region.querySelector(scenario.startsWith('scroll')?'[data-leave-day="2026-05-28"]':'[data-leave-day]'),outside=document.querySelector('#outside'),hint=root.querySelector('#leave-month-scroll-help');
    const life=new AbortController(),queue=new Map(),stats={requested:0,cancelled:0,callbacks:0,geometryReads:0,scrollCalls:0,callbackErrors:[],intents:[],setterAttempts:0,generationWork:[]};let clock=0,nextId=1,generation=0,moving=scenario==='moving-deadline-fitting';
    const originalRAF=window.requestAnimationFrame,originalCancel=window.cancelAnimationFrame,originalNow=performance.now,originalScroll=region.scrollBy.bind(region),nativeRect=target.getBoundingClientRect.bind(target);
    const scheduled=callback=>{stats.requested++;const id=nextId++;const owner=generation;queue.set(id,time=>{const reads=stats.geometryReads;try{callback(time);}finally{stats.generationWork.push({generation:owner,geometryDelta:stats.geometryReads-reads});}});return id;};
    window.requestAnimationFrame=scheduled;window.cancelAnimationFrame=id=>{stats.cancelled++;queue.delete(id);};
    Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
    target.getBoundingClientRect=()=>{stats.geometryReads++;const b=nativeRect();return moving?new DOMRect(b.x,b.y+stats.geometryReads,b.width,b.height):b;};
    region.scrollBy=options=>{stats.scrollCalls++;return originalScroll(options);};
    for(const type of ['pointerdown','wheel','keydown'])document.addEventListener(type,e=>stats.intents.push({type,defaultPrevented:e.defaultPrevented}),{capture:true});
    if(scenario.startsWith('scrollBy-missing'))region.scrollBy=undefined;
    if(scenario.startsWith('scrollBy-throws'))region.scrollBy=()=>{stats.scrollCalls++;throw Error('Injected scrollBy failure');};
    if(scenario==='raf-missing'||scenario==='later-stable-restores-hint')window.requestAnimationFrame=undefined;
    if(scenario==='raf-throws')window.requestAnimationFrame=()=>{stats.requested++;throw Error('Injected RAF failure');};
    if(scenario==='cancelRAF-missing')window.cancelAnimationFrame=undefined;
    if(scenario==='cancelRAF-throws')window.cancelAnimationFrame=()=>{stats.cancelled++;throw Error('Injected cancelRAF failure');};
    if(scenario==='abort-before-bind')life.abort();
    const registrations=[];
    const rootAdd=root.addEventListener.bind(root),documentAdd=document.addEventListener.bind(document);
    root.addEventListener=(type,listener,options)=>{if(type==='focusin'&&options?.signal)registrations.push({where:'root',type,signal:options.signal});return rootAdd(type,listener,options);};
    document.addEventListener=(type,listener,options)=>{if(['pointerdown','wheel','keydown'].includes(type)&&options?.signal)registrations.push({where:'document',type,signal:options.signal});return documentAdd(type,listener,options);};
    if(scenario.startsWith('scroll')){
     if(scenario.startsWith('scrollLeft-'))region.scrollBy=undefined;
     let owner=region,descriptor;
     while(owner&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(owner,'scrollLeft');owner=Object.getPrototypeOf(owner);}
     if(!descriptor?.get||!descriptor?.set)throw Error('Native scrollLeft descriptor missing in test harness');
     Object.defineProperty(region,'scrollLeft',{configurable:true,get:()=>descriptor.get.call(region),set:value=>{stats.setterAttempts++;if(scenario==='scrollLeft-throws')throw Error('Injected scrollLeft setter failure');if(scenario!=='scrollLeft-noop')descriptor.set.call(region,value);}});
    }
    bindLeaveCalendarFocus(root,life.signal);
    const snapshot=()=>{const b=nativeRect(),c=region.getBoundingClientRect(),s=getComputedStyle(target),ring=s.outlineStyle==='none'?0:parseFloat(s.outlineWidth)+Math.max(0,parseFloat(s.outlineOffset)||0);return {bindings:registrations.map(v=>({where:v.where,type:v.type,aborted:v.signal.aborted})),active:document.activeElement===target,role:hint.getAttribute('role'),hint:hint.textContent,pending:queue.size,stats:JSON.parse(JSON.stringify(stats)),scrollLeft:region.scrollLeft,fits:b.left-ring>=c.left+region.clientLeft-0.5&&b.right+ring<=c.left+region.clientLeft+region.clientWidth+0.5,connected:root.isConnected};};
    const drain=(time=clock+16)=>{clock=time;const batch=[...queue];queue.clear();for(const [id,callback]of batch){stats.callbacks++;try{callback(clock);}catch(e){stats.callbackErrors.push(e.message);}}return snapshot();};
    window.helperHarness={root,region,target,outside,hint,life,stats,queue,snapshot,drain,restoreRAF:()=>{window.requestAnimationFrame=scheduled;},focus:()=>target.focus({preventScroll:true}),setMoving:v=>moving=v,restoreNative:()=>{window.requestAnimationFrame=originalRAF;window.cancelAnimationFrame=originalCancel;Object.defineProperty(performance,'now',{configurable:true,value:originalNow});}};
    window.helperHarness.recoverScroll=()=>{delete region.scrollLeft;region.scrollBy=options=>{stats.scrollCalls++;return originalScroll(options);};};
    window.helperHarness.rebind=()=>{
     window.cancelAnimationFrame=undefined;
     life.abort();
     const newLife=new AbortController();generation=1;
     bindLeaveCalendarFocus(root,newLife.signal);
     window.helperHarness.newLife=newLife;
     outside.focus();target.focus({preventScroll:true});
     return window.helperHarness.snapshot();
    };
   },scenario);
   await page.evaluate(()=>window.helperHarness.focus());
   const start=await page.evaluate(()=>window.helperHarness.snapshot());
   if(scenario.startsWith('scrollBy-')){
    assert.ok(start.stats.setterAttempts>0,'Clipped column-seven target really exercises native fallback setter in both layouts');
    for(let i=0;i<5;i++)await page.evaluate(()=>window.helperHarness.drain());
    const end=await page.evaluate(()=>window.helperHarness.snapshot());assert.equal(end.fits,true);assert.equal(end.role,null);assert.equal(end.pending,0);assert.deepEqual(end.stats.callbackErrors,[]);trace={start,end};
   }else if(scenario.startsWith('scrollLeft-')){
    assert.ok(start.stats.setterAttempts>0,'Fallback setter fault genuinely exercised');
    if(scenario==='scrollLeft-noop'){
     assert.equal(start.fits,false,'No-op setter must leave last native date clipped');
     for(const time of [250,500,750,1001])await page.evaluate(t=>window.helperHarness.drain(t),time);
    }
    const failed=await page.evaluate(()=>window.helperHarness.snapshot());
    assert.equal(failed.role,'status');assert.match(failed.hint,/Choose Day list/);assert.equal(failed.pending,0);assert.deepEqual(failed.stats.callbackErrors,[]);
    await page.locator('#outside').focus();assert.equal(await page.locator('#leave-month-scroll-help').getAttribute('role'),'status','Cancellation alone retains failure hint');
    await page.evaluate(()=>{window.helperHarness.recoverScroll();window.helperHarness.focus();});
    for(let i=0;i<3;i++){await page.evaluate(()=>window.helperHarness.drain());assert.equal(await page.locator('#leave-month-scroll-help').getAttribute('role'),'status','Do not restore original role before four later stable intervals');}
    const recovered=await page.evaluate(()=>window.helperHarness.drain());
    assert.equal(recovered.role,null,'Original application hint had no role; restore by removing status attribute');assert.equal(recovered.hint,'Scroll across the month. Choose Day list for a full-width view.');assert.equal(recovered.pending,0);assert.equal(recovered.fits,true);assert.deepEqual(recovered.stats.callbackErrors,[]);
    trace={start,failed,recovered};
   }else{
    assert.ok(start.pending>0,'Old lifetime owns real queued helper work');
    const rebound=await page.evaluate(()=>window.helperHarness.rebind());
    assert.equal(rebound.bindings.filter(v=>v.where==='root'&&!v.aborted).length,1,'Only new lifetime root focus listener remains live');
    for(const type of ['pointerdown','wheel','keydown'])assert.equal(rebound.bindings.filter(v=>v.where==='document'&&v.type===type&&!v.aborted).length,1,'Only new focus operation owns each manual-intent listener');
    assert.ok(rebound.pending>=2,'Uncancellable old callback is intentionally retained beside new callback');
    const firstDrain=await page.evaluate(()=>window.helperHarness.drain());
    const oldWork=firstDrain.stats.generationWork.filter(v=>v.generation===0),newWork=firstDrain.stats.generationWork.filter(v=>v.generation===1);
    assert.ok(oldWork.length>0&&oldWork.every(v=>v.geometryDelta===0),'Aborted old callbacks cannot perform geometry work after rebinding');assert.ok(newWork.some(v=>v.geometryDelta>0),'New owned callback really runs');
    await page.keyboard.press('ArrowRight');const cancelled=await page.evaluate(()=>window.helperHarness.snapshot());
    assert.ok(cancelled.stats.intents.some(v=>v.type==='keydown'),'Actual native key cancels new pending operation');
    assert.equal(cancelled.bindings.filter(v=>v.where==='document'&&!v.aborted).length,0,'New manual listeners abort after native intent');
    await page.evaluate(()=>window.helperHarness.newLife.abort());
    const dead=await page.evaluate(()=>window.helperHarness.snapshot());assert.equal(dead.bindings.filter(v=>!v.aborted).length,0,'Both lifetimes and all temporary listener signals aborted');
    await page.evaluate(()=>{window.helperHarness.outside.focus();window.helperHarness.focus();window.helperHarness.drain();window.helperHarness.drain();});
    const end=await page.evaluate(()=>window.helperHarness.snapshot());assert.equal(end.stats.geometryReads,cancelled.stats.geometryReads,'No work after new intent or either disposed lifetime');assert.equal(end.pending,0);assert.deepEqual(end.stats.callbackErrors,[]);trace={start,rebound,firstDrain,cancelled,end};
   }
   await page.waitForTimeout(20);assert.deepEqual(pageErrors,[],'No escaped errors from optional frame cancellation/fallback');assert.deepEqual(requests,[],'Isolated helper never calls API');
  }catch(e){failure={message:e.message,stack:e.stack};try{trace={...(trace||{}),failureSnapshot:await page.evaluate(()=>window.helperHarness?.snapshot())};}catch{}}
  results.push({engine,...layout,scenario,passed:!failure,failure,trace,pageErrors,requests});console.log(`Helper ${revision}: ${engine} ${layout.width}x${layout.height} root${layout.root} ${scenario} ${failure?'FAIL':'PASS'}`);
  await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await appHashes(),initial,'Application sources held');assert.deepEqual(await candidateHashes(),candidateInitial,'Candidate sources held');assert.equal(sha(await readFile(new URL(import.meta.url))),testSha);
const failed=results.filter(r=>!r.passed),report=process.env.LEAVE_HELPER_REPORT||`../docs/premium-ui/qa-leave-calendar-focus-helper-supplement-${revision}.json`;
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),base,candidateDirectory:candidateDir,candidate_sha256:candidateInitial,source_sha256:initial,test_sha256:testSha,scope:'Separate supplement: exact helper/native31dates/styles, normal motion, root200/short. Missing scrollBy plus throwing/no-op scrollLeft setter causes honest Day list fallback, then later actual stable recovery restores original role=null. Lifecycle caller aborts old lifetime before rebinding; uncancellable old RAF and old listener signals are proved inert, new native key cancels new work. Controlled RAF/clock instrumentation is not actual-shell scroll animation or arbitrary duplicate-install support. API blocked; emulation only.',passed:failed.length===0,contexts:results.length,failed:failed.length,results},null,2)+'\n');
console.log(`Helper ${revision}: ${results.length-failed.length}/${results.length} contexts passed`);if(failed.length)process.exitCode=1;
