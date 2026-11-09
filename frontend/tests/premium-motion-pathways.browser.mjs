import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Native controls exercise the five guarded imperative scroll sites. The observer
// delegates unchanged to the browser; it never supplies a substitute scroll.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const api='http://127.0.0.1:8031';
const paths=['src/main.ts','src/limits.ts','src/rota-rules.ts','src/ui.ts','src/styles.css','src/premium-theme.css','src/member-workspace.ts','src/import-review-presentation.ts','src/services/api.ts','tests/premium-motion-pathways.browser.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const initial=await hashes(),results=[],geometryFindings=[];
const activate=async(page,control)=>{await control.focus();await page.keyboard.press('Enter');};
const sections={duty_count_limits:{max_24hr_per_month:8,max_weekend_24hr_per_month:null,max_same_group_per_month:null,max_same_campus_per_month:null},rest_rules:{minimum_gap_after_24hr_hours:24,post_24hr_blocks_next_day_elective:true},unit_staffing_rules:{minimum_available_count:1,warning_unavailable_percent:30,hard_block_unavailable_percent:40,small_unit_uses_absolute_minimum:true},fairness_rules:{max_gap_within_call_level:1,target_mode:'auto'},extra_duty_rules:{justice_lookback_months:12}};
const rule={key:'MOTION_DUTY',label:'Motion fixture',group:'pac',campus:'Main campus',duration_hours:8,start_time:'08:00',end_time:'16:00',is_24hr:false,counts_in_main_24hr:false,is_mandatory:false,is_adjustable:true,blocks_elective_same_day:false,blocks_elective_next_day:false,active:true,allowed_call_levels:['3RD_CALL'],allowed_cluster_keys:[],excluded_cluster_keys:[],allowed_designations:[],allowed_units:[],excluded_units:[]};
const rules={revision:'motion-one',groups:[],units:[],rule_version:{id:'motion-version',name:'Motion fixture',description:null,effective_from:'2026-01-01',effective_to:null,is_active:true,created_at:'2026-01-01T00:00:00Z'},duty_rules:[rule],...sections};
const limits={version_id:'motion-limit-one',saved_at:'2026-10-28T06:00:00Z',saved_by:'Fixture',limits:sections,defaults:sections,fields:[],targets:[],can_edit:true,month:'2026-11',limits_version_id:'motion-limit-one'};
const unit={id:'motion-unit',name:'Motion fixture unit',code:'M',campus:'Main',minimum_free_people:1,active_status:'active',notes:null};
const assignment={id:'motion-posting',unit,person:{id:'motion-person',canonical_name:'Dr Motion Fixture',active_status:'active',call_level:'2ND_CALL'},posting_type:'2ND_CALL',starts_on:'2026-11-01',ends_on:null,source:'manual',notes:null};
const unitMonth={month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',units:[unit],assignments:[assignment],unit_summaries:[{unit_id:unit.id,assigned_members:1,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[],validation_issues:[{unit_id:unit.id,posting_id:assignment.id,person_id:assignment.person.id,severity:'warning',code:'motion-fixture',message:'Review the exact posting'}]};
async function setup(page){
 await page.addInitScript(()=>{
  localStorage.setItem('duty_rota_auth_token','motion-path-fixture');localStorage.setItem('duty_rota_working_month','2026-11');
  window.motionScrolls=[];const original=Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView=function(options){window.motionScrolls.push({tag:this.tagName,id:this.id,setting:this.dataset.setting,card:this.id.startsWith('lim-card-')?this.id:null,duty:this.dataset.dutyRow,fieldDuty:this.dataset.duty,posting:this.dataset.unitRowForm,guard:this.hasAttribute('data-guard-toggle'),options});return original.call(this,options);};
 });
}
async function snapshot(page,label,motion){
 const data=await page.evaluate(()=>{
  const found=[];for(const e of document.querySelectorAll('body *')){if(!e.getClientRects().length)continue;for(const pseudo of [null,'::before','::after']){const c=getComputedStyle(e,pseudo);if(pseudo&&['none','normal'].includes(c.content))continue;const animation=c.animationName,transition=c.transitionDuration; if(animation!=='none'||transition.split(',').some(x=>parseFloat(x)>0))found.push({tag:e.tagName,class:e.className,pseudo,animation,duration:c.animationDuration,iterations:c.animationIterationCount,transition});}}
  return{motion:matchMedia('(prefers-reduced-motion: reduce)').matches,scrollBehavior:getComputedStyle(document.documentElement).scrollBehavior,tokens:['--transition-fast','--transition-base','--transition-slow'].map(n=>[n,getComputedStyle(document.documentElement).getPropertyValue(n).trim()]),animatedOrTransitioning:found};
 });
 assert.equal(data.motion,motion==='reduce');if(motion==='reduce'){assert.equal(data.scrollBehavior,'auto');assert.deepEqual(data.animatedOrTransitioning,[],label+': all currently rendered elements and generated pseudo-elements suppress motion');}
 return{label,...data};
}
async function expectScroll(page,predicate,motion,focused){
 await page.waitForFunction(predicate);const scroll=await page.evaluate(()=>window.motionScrolls.at(-1));assert.equal(scroll.options.behavior,motion==='reduce'?'auto':'smooth');
 if(focused){await page.waitForFunction(selector=>document.activeElement?.matches(selector),focused);try{await page.waitForFunction(selector=>{const n=document.querySelector(selector),r=n.getBoundingClientRect();return r.top>=-1&&r.bottom<=innerHeight+1;},focused,{timeout:5000});}catch(error){const finding=await page.evaluate(selector=>({selector,rect:document.querySelector(selector)?.getBoundingClientRect().toJSON(),active:document.activeElement?.outerHTML,scrolls:window.motionScrolls,viewport:{width:innerWidth,height:innerHeight},body:document.body.innerText}),focused);await writeFile('../tmp/motion039-focused-geometry-failure.json',JSON.stringify(finding,null,2));await page.screenshot({path:'../tmp/motion039-focused-geometry-failure.png'});if(process.env.MOTION_DIAGNOSTIC!=='1')throw error;geometryFindings.push(finding);scroll.geometryFailure=true;}scroll.focusedTarget=focused;scroll.focusedRect=await page.locator(focused).boundingBox();}
 return scroll;
}
for(const [engine,launcher] of Object.entries(process.env.MOTION_PROBE==='1'?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of process.env.MOTION_PROBE==='1'?[320]:[320,1280])for(const motion of ['reduce','no-preference']){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:motion}),page=await context.newPage(),errors=[],reads=[],checks=[],snapshots=[],scrolls=[];let mutations=0,heldLimits;
  page.on('pageerror',e=>errors.push(e.message));await setup(page);
  await page.route('**/__motion_paths',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="motion-root"></main></body></html>'}));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()==='POST'&&url.pathname.endsWith('/rota-rules/phase-one/check')){const body=req.postDataJSON();checks.push(body);return route.fulfill({json:{problems:[{duty_key:null,field:'duty_count_limits.max_24hr_per_month',severity:'warning',message:'Review the existing guardrail'},{duty_key:rule.key,field:'label',severity:'warning',message:'Review the exact duty label'}],duties:{MOTION_DUTY:{effective_call_levels:['3RD_CALL'],eligible_now:5,eligible_by_level:{'3RD_CALL':5}}}}});}
   if(req.method()!=='GET'){mutations++;return route.abort();}
   reads.push(url.pathname+url.search);
   if(url.pathname.endsWith('/admin/limits')){heldLimits=route;return;}
   if(url.pathname.endsWith('/rota-rules/phase-one'))return route.fulfill({json:rules});
   if(url.pathname.endsWith('/unit-management/month'))return route.fulfill({json:unitMonth});
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  // Main application: actual unit warning -> exact row reveal.
  await page.goto(base+'/#view=units');await page.locator('input[data-unit-board-search]').waitFor();await page.waitForLoadState('networkidle');
  await activate(page,page.locator('button[data-open-unit-modal="motion-unit"]').first());const unitDialog=page.locator('#unit-management-modal');
  await activate(page,unitDialog.locator('.unit-modal-validation > summary'));await activate(page,unitDialog.locator('[data-scroll-unit-assignment="motion-posting"]'));
  scrolls.push(await expectScroll(page,()=>window.motionScrolls.at(-1)?.posting==='motion-posting',motion));
  assert.equal(await unitDialog.locator('[data-unit-row-form="motion-posting"]').evaluate(n=>n.classList.contains('unit-assignment-highlight')),true);
  await page.waitForFunction(()=>{const n=document.querySelector('[data-unit-row-form="motion-posting"]'),r=n.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;});
  snapshots.push(await snapshot(page,'actual unit highlight/dialog',motion));assert.equal(await page.locator('#working-month').inputValue(),'2026-11');
  // Isolated actual exported controllers, preserving native event handlers.
  await page.goto(base+'/__motion_paths');
  await page.evaluate(async()=>{const m=await import('/src/limits.ts');window.motionLimits=m;window.motionLimitsReady=m.renderLimitsPage(document.querySelector('#motion-root'),{month:'2026-11',onNavigate:()=>{}});});
  const skeleton=page.locator('.ds-page-skeleton');await skeleton.waitFor();assert.equal(await skeleton.getAttribute('aria-busy'),'true');assert.match(await skeleton.innerText(),/Loading limits/i);
  snapshots.push(await snapshot(page,'actual held Limits skeleton',motion));
  if(motion==='no-preference')assert.ok(snapshots.at(-1).animatedOrTransitioning.some(x=>x.animation!=='none'),'Normal held skeleton still animates');
  assert.ok(heldLimits);await heldLimits.fulfill({json:limits});await page.evaluate(()=>window.motionLimitsReady);assert.equal(await skeleton.count(),0);
  const numeric=page.locator('[data-limit-num="duty_count_limits.max_24hr_per_month"]');await numeric.fill('-1');
  await activate(page,page.locator('[data-goto-error]'));scrolls.push(await expectScroll(page,()=>window.motionScrolls.at(-1)?.setting==='duty_count_limits.max_24hr_per_month',motion,'[data-limit-num="duty_count_limits.max_24hr_per_month"]'));
  assert.equal(await numeric.inputValue(),'-1');await activate(page,page.locator('[data-toc]').last());
  scrolls.push(await expectScroll(page,()=>window.motionScrolls.at(-1)?.card==='lim-card-extra',motion,'#lim-card-extra-title'));assert.equal(await numeric.inputValue(),'-1','Section navigation retains invalid draft');
  snapshots.push(await snapshot(page,'actual Limits setting/control/toc states',motion));
  await page.evaluate(async()=>{window.motionLimits.disposeLimitsPage();const m=await import('/src/rota-rules.ts');window.motionRules=m;await m.renderRotaRulesPage(document.querySelector('#motion-root'),{onNavigate:()=>{}});});
  const duty=page.locator('[data-duty-row="MOTION_DUTY"]');await activate(page,duty.locator('[data-toggle-duty]'));await duty.locator('[data-text-field=label]').fill('Motion draft retained');
  await activate(page,page.locator('[data-filter=inactive]'));assert.equal(await duty.count(),0);
  await activate(page,page.locator('[data-review]'));let review=page.getByRole('dialog',{name:'Review rota rule changes',exact:true});await review.locator('[data-goto=""]').waitFor();
  snapshots.push(await snapshot(page,'actual Rules review dialog/problem feedback',motion));
  await activate(page,review.locator('[data-goto=""]'));scrolls.push(await expectScroll(page,()=>window.motionScrolls.at(-1)?.guard===true,motion,'[data-guard-toggle]'));
  assert.equal(await page.locator('[data-filter=inactive]').getAttribute('aria-pressed'),'true');
  await activate(page,page.locator('[data-review]'));review=page.getByRole('dialog',{name:'Review rota rule changes',exact:true});await review.locator('[data-goto="MOTION_DUTY"]').waitFor();
  await activate(page,review.locator('[data-goto="MOTION_DUTY"]'));scrolls.push(await expectScroll(page,()=>window.motionScrolls.at(-1)?.duty==='MOTION_DUTY'||window.motionScrolls.at(-1)?.fieldDuty==='MOTION_DUTY',motion,'[data-duty="MOTION_DUTY"][data-text-field=label]'));
  assert.equal(await page.locator('[data-filter=all]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#rr-search').inputValue(),'');assert.equal(await duty.locator('[data-text-field=label]').inputValue(),'Motion draft retained');
  assert.equal(await duty.locator('.rr-duty__toggle').getAttribute('aria-expanded'),'true');snapshots.push(await snapshot(page,'actual Rules revealed duty controls',motion));
  assert.equal(scrolls.length,5);assert.equal(mutations,0);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>localStorage.getItem('duty_rota_working_month')),'2026-11');
  assert.ok(checks.length>=3);for(const body of checks){assert.equal(body.duty_count_limits.max_24hr_per_month,8);assert.ok(['Motion fixture','Motion draft retained'].includes(body.duty_rules[0].label));assert.deepEqual(body.rest_rules,sections.rest_rules);}
  assert.deepEqual(snapshots[0].tokens,[['--transition-fast','120ms ease'],['--transition-base','200ms ease'],['--transition-slow','300ms ease']]);
  results.push({engine,width,motion,scrolls,snapshots,reads,validationRequests:checks.length,checkBodies:checks,unexpectedMutationRequests:mutations,backendWrites:0,guardFallbackIsReadOnlyToggle:true,draftAndMonthRetained:true,errors});
  console.log(`Motion pathways ${engine} ${width} ${motion}: five native scroll sites${process.env.MOTION_DIAGNOSTIC==='1'?' (before-fix diagnostic, geometry findings retained)':''}`);await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Held application/test sources');
await writeFile('../docs/premium-ui/qa-motion-pathways'+(process.env.MOTION_DIAGNOSTIC==='1'?'-before-fix-diagnostic':process.env.MOTION_PROBE==='1'?'-probe':'')+'.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,status:process.env.MOTION_DIAGNOSTIC==='1'?'Diagnostic: geometry failures are findings, not passes':'Passed scoped native motion pathways',geometryFindings,scope:'Five actual guarded imperative scroll sites through native controls in the signed-in unit route and exported Limits/Rules controllers. Observer delegates unchanged. Actual held Limits skeleton, unit highlight and review dialog/controls computed CSS plus visible generated pseudo-elements. No persistence, scheduling semantics, full CSS selector-state coverage, native AT or physical-device certification.',limitations:['Rules guard branch focuses its existing readonly summary toggle; no nonexistent editable guard field is invented.','CSS snapshots cover rendered states only; notification, compute/import pending, profile skeleton and absent selector contexts remain separate gaps.','Normal smooth-scroll target visibility is not physical-device coverage; scroll options and native focus behavior are recorded.','Only local eligibility validation POSTs allowed; no save/restore/generation mutation reaches the RAM fixture.'],results},null,2)+'\n');
console.log(`Motion pathways: ${results.length} contexts ${process.env.MOTION_DIAGNOSTIC==='1'?`diagnosed; ${geometryFindings.length} geometry findings`:'passed'}`);
