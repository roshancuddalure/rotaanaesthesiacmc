// Root-coordinated current implementation verification. All API traffic local.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),base='http://127.0.0.1:5197';
const smoke=process.env.ITEM174_SMOKE==='1';
const report=smoke?'../docs/premium-ui/qa-original174-reflow-recovery-current-r1-smoke-20261110.json':'../docs/premium-ui/qa-original174-reflow-recovery-current-r1-20261110.json';
const expectedContexts=smoke?1:9;
await assert.rejects(access(report),{code:'ENOENT'});
const inventoryPath='../docs/premium-ui/reviews/original174-condition-inventory-20261110.json';
const inventory=JSON.parse(await readFile(inventoryPath,'utf8')),held=inventory.current_source_sha256;
for(const[path,h]of Object.entries(held)){
 assert.equal(sha(await readFile('../'+path)),h,'Exact current held source '+path);
 const name=path.slice('frontend/src/'.length),response=await fetch(base+'/src/'+name);assert.equal(response.status,200);
 const body=await response.text();
 if(name.endsWith('.ts')){
  const m=body.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(m,'Inline original-source map '+path);
  assert.ok(JSON.parse(Buffer.from(m[1],'base64').toString()).sourcesContent.some(s=>sha(s)===h),'Exact served TS '+path);
 }else{
  const raw=await fetch(base+'/src/'+name+'?direct');assert.equal(raw.status,200);
  assert.equal(sha(await raw.text()),h,'Exact served direct CSS '+path);
 }
}
const month='2026-11';
const setup={slots:[{id:'lock-a',date:'2026-11-03',label:'Locked assigned duty',assigned:[{id:'person-a',name:'Asha'}]},{id:'repair-b',date:'2026-11-04',label:'Repair assigned duty',assigned:[{id:'person-b',name:'Ravi'}]},{id:'spare-c',date:'2026-11-05',label:'Unfilled duty',assigned:[]}],people:[{id:'person-a',name:'Asha'},{id:'person-b',name:'Ravi'}],history_lookback:6,history_months:['2026-10'],rules:{},holiday_dates:[]};
const completed={id:'item174-job',revision:1,status:'completed',decisions:[],proposed:0,unresolved:0,engine:'server',context_hash:'item174-context',burden:{members:2,before:{},after:{}},intelligence:{selected:0,alternatives:[{status:'feasible',uncovered:0,changed:0,elapsed_ms:1,warnings:[],objectives:[],history_window:{start:'2026-05',end:'2026-10',observed_months:['2026-10']}}]}};
const expectedBody={month,mode:'repair',seconds:60,engine:'server',repair_slots:['repair-b'],locked_slots:['lock-a'],preferences:[{slot_id:'repair-b',person_id:'person-b',penalty:100}]};
const expectedControls={mode:'repair',seconds:'60',locks:['lock-a'],repairs:['repair-b'],preferenceSlot:'spare-c',preferencePerson:'person-a',preferenceCost:'-100',committedCount:1};
const results=[];
for(const[engine,launcher]of Object.entries(smoke?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();let baselineBody;
 try{for(const scenario of(smoke?['baseline']:['baseline','capabilities503','frontend-timeout-error'])){
  console.log('[item174-r1] start '+engine+' '+scenario+' '+new Date().toISOString());
  const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(15000);
  const requests=[],errors=[],snapshots=[];let capabilityReads=0,jobsPosts=0,validatePosts=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{
   localStorage.setItem('duty_rota_auth_token','item174-local');
   localStorage.setItem('duty_rota_compute_device_v1',JSON.stringify({enabled:false,mode:'server',power:'high-performance'}));
   const original=AbortSignal.timeout.bind(AbortSignal);
   window.__item174TimeoutArmed=false;window.__item174TimeoutThrows=0;
   AbortSignal.timeout=function(ms){if(window.__item174TimeoutArmed&&ms===15000){window.__item174TimeoutArmed=false;window.__item174TimeoutThrows++;throw new Error('Injected recoverable frontend timeout construction error');}return original(ms);};
  });
  await page.route('**/__item174-current',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="fixture-opener">Open planning fixture</button></body></html>'}));
  await page.route('**/api/**',async route=>{
   const q=route.request(),url=new URL(q.url()),p=url.pathname,body=q.postData()?q.postDataJSON():undefined;
   requests.push({method:q.method(),path:p,query:url.search,body});
   if(q.method()==='GET'&&p==='/api/v1/rota-intelligence/setup')return route.fulfill({json:setup});
   if(q.method()==='GET'&&p==='/api/v1/rota-compute/jobs')return route.fulfill({json:[]});
   if(q.method()==='GET'&&p==='/api/v1/rota-compute/capabilities'){
    capabilityReads++;assert.equal(url.searchParams.get('month'),month);
    if(scenario==='capabilities503'&&capabilityReads===1)return route.fulfill({status:503,json:{detail:'Planning capability read temporarily unavailable'}});
    return route.fulfill({json:{browser_gpu:false,optimizer_gpu:false,context_hash:'item174-context',optimizer_context_hash:'item174-context',workload_estimates:{optimizer_rows:0}}});
   }
   if(q.method()==='POST'&&p==='/api/v1/rota-intelligence/jobs'){
    jobsPosts++;assert.equal(jobsPosts,1,'Exactly one accepted proposal creation');assert.deepEqual(body,expectedBody);
    return route.fulfill({json:completed});
   }
   if(q.method()==='POST'&&p==='/api/v1/rota-compute/jobs/item174-job/validate'){
    validatePosts++;assert.deepEqual(body,{revision:1});return route.fulfill({json:{valid:true}});
   }
   // Every unmatched request is refused, including Apply and local GPU routes.
   return route.fulfill({status:500,json:{detail:'Item174 fixture rejects all unlisted traffic'}});
  });
  const snapshot=async label=>{
   const data=await page.evaluate(()=>{
    const dialog=document.querySelector('dialog.intelligent-workspace');
    const count=dialog.textContent.match(/(\d+) preferences recorded for this proposal/);
    const controls={mode:dialog.querySelector('[data-mode]')?.value,seconds:dialog.querySelector('[data-seconds]')?.value,locks:[...dialog.querySelectorAll('[data-lock]:checked')].map(e=>e.dataset.lock),repairs:[...dialog.querySelectorAll('[data-repair]:checked')].map(e=>e.dataset.repair),preferenceSlot:dialog.querySelector('[data-pref-slot]')?.value,preferencePerson:dialog.querySelector('[data-pref-person]')?.value,preferenceCost:dialog.querySelector('[data-pref-cost]')?.value,committedCount:count?Number(count[1]):null};
    return{width:innerWidth,controls,lockControlIdentity:dialog.querySelector('[data-lock="lock-a"]')===window.__item174LockNode,repairControlIdentity:dialog.querySelector('[data-repair="repair-b"]')===window.__item174RepairNode,pageOverflow:document.documentElement.scrollWidth>innerWidth+1,dialogOverflow:dialog.scrollWidth>dialog.clientWidth+1,notice:dialog.querySelector('[role=status]')?.textContent};
   });
   snapshots.push({label,...data});assert.deepEqual(data.controls,expectedControls,label);assert.equal(data.pageOverflow,false,label+' page overflow');return data;
  };
  try{
   await page.goto(base+'/__item174-current',{waitUntil:'domcontentloaded'});
   await page.locator('#fixture-opener').focus();
   await page.evaluate(async()=>{const m=await import('/src/rota-intelligence.ts');await m.openIntelligentRota('2026-11',true,()=>{window.__unexpectedItem174Apply=true;});});
   const dialog=page.locator('dialog.intelligent-workspace');
   await dialog.locator('[data-mode]').selectOption('repair');await dialog.locator('[data-seconds]').selectOption('60');
   const locksDetails=()=>dialog.locator('details').filter({has:page.locator('[data-lock="lock-a"]')});
   const locksSummary=()=>locksDetails().locator('summary').filter({hasText:/^Locks and repair scope$/});
   assert.equal(await locksSummary().count(),1,'Unique actual locks/repair summary');
   await locksSummary().click();await dialog.locator('[data-lock="lock-a"]').check();
   await page.waitForFunction(()=>document.querySelector('dialog.intelligent-workspace [data-lock="lock-a"]')?.checked===true);
   await locksSummary().click();await dialog.locator('[data-repair="repair-b"]').check();
   await page.waitForFunction(()=>document.querySelector('dialog.intelligent-workspace [data-repair="repair-b"]')?.checked===true);
   await dialog.getByText('Member preferences',{exact:true}).click();
   await dialog.locator('[data-pref-slot]').selectOption('repair-b');await dialog.locator('[data-pref-person]').selectOption('person-b');await dialog.locator('[data-pref-cost]').selectOption('100');
   await dialog.locator('[data-add-preference]').evaluate(e=>window.__item174OldAddButton=e);
   await dialog.locator('[data-add-preference]').click();
   await page.waitForFunction(()=>{const d=document.querySelector('dialog.intelligent-workspace');return d.querySelector('[data-add-preference]')!==window.__item174OldAddButton && /1 preferences recorded for this proposal/.test(d.textContent);});
   await dialog.locator('summary').filter({hasText:/^Member preferences$/}).click();
   await dialog.locator('[data-pref-slot]').selectOption('spare-c');await dialog.locator('[data-pref-person]').selectOption('person-a');await dialog.locator('[data-pref-cost]').selectOption('-100');
   await dialog.evaluate(e=>{window.__item174LockNode=e.querySelector('[data-lock="lock-a"]');window.__item174RepairNode=e.querySelector('[data-repair="repair-b"]');});
   await snapshot('configured-before-reflow');
   for(const width of[320,768,1280]){
    await page.setViewportSize({width,height:900});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const data=await snapshot('reflow-'+width);assert.equal(data.lockControlIdentity,true);assert.equal(data.repairControlIdentity,true);
   }
   if(scenario==='frontend-timeout-error')await page.evaluate(()=>window.__item174TimeoutArmed=true);
   await dialog.locator('[data-generate]').click();
   if(scenario!=='baseline'){
    const errorText=scenario==='capabilities503'?'Planning capability read temporarily unavailable':'Injected recoverable frontend timeout construction error';
    await dialog.getByText(errorText,{exact:true}).waitFor();assert.equal(await dialog.locator('[data-generate]').isEnabled(),true);
    assert.equal(jobsPosts,0,'Failed preparation has not created a proposal');assert.equal(validatePosts,0);
    await snapshot('after-recoverable-error');
    if(scenario==='frontend-timeout-error'){assert.equal(await page.evaluate(()=>window.__item174TimeoutThrows),1);assert.equal(capabilityReads,0,'Frontend exception occurred before request transport');}
    else assert.equal(capabilityReads,1);
    await dialog.locator('[data-generate]').focus();await page.keyboard.press('Enter');
   }
   await dialog.getByText('Draft ready for review. No assignments have been saved.',{exact:true}).waitFor();
   assert.equal(jobsPosts,1);assert.equal(validatePosts,1);assert.equal(capabilityReads,scenario==='capabilities503'?2:1);
   const body=requests.find(r=>r.method==='POST'&&r.path==='/api/v1/rota-intelligence/jobs').body;
   if(scenario==='baseline')baselineBody=body;else assert.deepEqual(body,baselineBody,'Error/retry payload equals paired no-failure control');
   await dialog.locator('[data-tab="plan"]').click();await snapshot('after-proposal-return-to-plan');
   assert.equal(await page.evaluate(()=>Boolean(window.__unexpectedItem174Apply)),false);assert.equal(requests.some(r=>r.path.endsWith('/apply')),false);assert.equal(requests.some(r=>r.path.includes('/step')),false);assert.deepEqual(errors,[]);
   results.push({engine,scenario,role:'admin',passed:true,viewportSequence:[1280,320,768,1280],snapshots,eventualBody:body,pairedBaselineEquivalent:true,capabilityReads,jobsPosts,validatePosts,frontendTimeoutThrows:await page.evaluate(()=>window.__item174TimeoutThrows),requests,errors});
  }catch(error){results.push({engine,scenario,role:'admin',passed:false,assertion:error.message,snapshots,capabilityReads,jobsPosts,validatePosts,requests,errors});}
  finally{console.log('[item174-r1] finish '+engine+' '+scenario+' passed='+String(results.at(-1)?.passed)+' '+new Date().toISOString());await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
for(const[path,h]of Object.entries(held))assert.equal(sha(await readFile('../'+path)),h,'Source frozen throughout test '+path);
const failures=results.filter(r=>!r.passed);
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/generation174_harness_repair',operator:'/root when actually executed',scope:'Full run: nine current exported intelligent-generator UI contexts (smoke: one Chromium baseline only):3 engines × paired baseline,capabilitiesGET503 and one-shot frontend AbortSignal.timeout construction exception. Every context sets independent nondefault lock+repair,committed nondefault preference plus different unsent row, reflows1280→320→768→1280 and records final exact locally fulfilled jobs POST. No Apply/GPU/backend mutation. Synthetic hosted module uses actual current TS/CSS/shared workspaceDialog; does not prove whole-app launcher/full backend/native AT/physical-device behavior.',source_sha256:held,condition_inventory:{path:inventoryPath.slice(3),sha256:sha(await readFile(inventoryPath))},test_sha256:sha(await readFile(new URL(import.meta.url))),smoke,expected_contexts:expectedContexts,failed_contexts:failures.length,expectedBody,expectedControls,limits:['Finite recoverable preparation failures only; no conflict handoff,new workspace,reload/crash or arbitrary rendering exception claim.','Node identity required across pure resize; action renders intentionally reconstruct controls while values remain identical.','Committed preference list is verified through exact eventual payload and count; unsent row is correctly excluded from request.','Read-only validation POST and proposal creation are intercepted fixture outcomes, not calculation/production certification.'],results},null,2)+'\n');
assert.equal(results.length,expectedContexts);assert.equal(failures.length,0,'All current item174 reflow/recovery contexts must pass');
