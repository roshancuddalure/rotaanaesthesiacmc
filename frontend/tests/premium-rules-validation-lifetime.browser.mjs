import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Every API request is fulfilled locally. Only existing validation POSTs are permitted;
// no save/restore request can reach a server. Run from frontend.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const probe=process.env.RULE_VALIDATION_PROBE==='1',results=[];
const paths=['src/rota-rules.ts','src/styles.css','src/premium-theme.css','src/member-workspace.ts','src/services/api.ts','src/ui.ts','src/audit-time.ts','src/decorative-icons.ts'];
const digest=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,await digest(p)])));
const initial=await hashes();
const testHash=await digest('tests/premium-rules-validation-lifetime.browser.mjs');
const rule={key:'PAC_DUTY',label:'Validation fixture',group:'pac',campus:'Main campus',duration_hours:8,start_time:'08:00',end_time:'16:00',is_24hr:false,counts_in_main_24hr:false,is_mandatory:false,is_adjustable:true,blocks_elective_same_day:false,blocks_elective_next_day:false,active:true,allowed_call_levels:['3RD_CALL'],allowed_cluster_keys:[],excluded_cluster_keys:[],allowed_designations:[],allowed_units:[],excluded_units:[]};
const doc={revision:'validation-fixture-1',groups:[],units:[],rule_version:{id:'fixture-version',name:'Fixture',description:null,effective_from:'2026-01-01',effective_to:null,is_active:true,created_at:'2026-01-01T00:00:00Z'},duty_rules:[rule],duty_count_limits:{max_24hr_per_month:8,max_weekend_24hr_per_month:null,max_same_group_per_month:null,max_same_campus_per_month:null},rest_rules:{minimum_gap_after_24hr_hours:24,post_24hr_blocks_next_day_elective:true},unit_staffing_rules:{minimum_available_count:1,warning_unavailable_percent:30,hard_block_unavailable_percent:40,small_unit_uses_absolute_minimum:true}};
const payload=label=>{const {revision,groups,units,rule_version,...body}=structuredClone(doc);body.duty_rules[0].label=label;return body;};
const check=n=>({problems:[],duties:{PAC_DUTY:{effective_call_levels:['3RD_CALL'],eligible_now:n,eligible_by_level:{'3RD_CALL':n}}}});
for(const [engine,launcher]of Object.entries(probe?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of probe?[320]:[320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],calls=[],held=[];
  let expectedLabel=rule.label,hold=false;
  page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install({time:new Date('2026-10-24T06:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-24T06:00:01Z'));
  await page.route('**/__rules-validation-lifetime',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="rules-root"></main></body></html>'}));
  await page.route('**/api/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   if(path==='/api/v1/admin/rota-rules/phase-one/check'){
    assert.equal(req.method(),'POST');const body=req.postDataJSON();assert.deepEqual(body,payload(expectedLabel),'Existing validation body must equal this draft, including existing limit sections');calls.push(body);
    if(hold){held.push(route);return;}return route.fulfill({json:check(5)});
   }
   assert.equal(req.method(),'GET','Save/restore forbidden; no mutations forwarded');
   // Inline groups:[] is truthy and units:[] is an Array in renderRotaRulesPage;
   // those deliberately suppress the legacy getCallClusters/getUnits fallbacks.
   assert.equal(path,'/api/v1/admin/rota-rules/phase-one');return route.fulfill({json:doc});
  });
  await page.goto(base+'/__rules-validation-lifetime');
  await page.evaluate(async()=>{window.__rulesModule=await import('/src/rota-rules.ts');await window.__rulesModule.renderRotaRulesPage(document.getElementById('rules-root'),{onNavigate:()=>{}});});
  const row=page.locator('[data-duty-row="PAC_DUTY"]'),field=()=>row.locator('[data-text-field=label]'),preview=()=>row.locator('[data-preview]');
  await row.locator('.rr-duty__toggle').click();assert.match(await preview().innerText(),/5 people are eligible today/);
  const edit=async label=>{expectedLabel=label;await field().fill(label);};
  const pending=async n=>{for(let i=0;i<50&&held.length<n;i++)await new Promise(r=>setTimeout(r,10));assert.equal(held.length,n,'Expected held validation genuinely in flight');};
  const release=async(index,{n=17,error=false}={})=>{
   const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/phase-one/check'));
   await held[index].fulfill(error?{status:503,json:{detail:'Old draft validation failed'}}:{json:check(n)});
   await(await response).finished();
   await page.waitForLoadState('networkidle');
   // Drain browser-side fetch/json continuations without advancing the remaining debounce.
   await page.evaluate(async()=>{for(let i=0;i<24;i++)await Promise.resolve();});
  };
  const status=()=>page.locator('[data-check-context]').first();
  hold=true;await edit('Draft A');await page.clock.runFor(400);await pending(1);
  await edit('Draft B');await page.clock.runFor(100);await release(0);
  if(probe){
   await page.waitForFunction(()=>document.querySelector('[data-preview]')?.textContent.includes('17 people are eligible today'));
   results.push({engine,width,defect_reproduced:true,held_A_returned_after_B_before_debounce:true,preview:await preview().innerText(),context_count:await status().count(),validation_bodies_exact:true,forwarded_mutations:0});
   await context.close();continue;
  }
  assert.equal(await status().getAttribute('data-check-context'),'stale');assert.doesNotMatch(await preview().innerText(),/17 people are eligible today/);assert.equal(await field().inputValue(),'Draft B');assert.equal(await field().evaluate(n=>n===document.activeElement),true);
  await page.clock.runFor(300);await pending(2);await release(1,{n:29});
  await page.waitForFunction(()=>document.querySelector('[data-check-context="current"]'));
  assert.match(await preview().innerText(),/29 people are eligible today/);
  // A -> B -> A is still a new draft lifetime, even when its values return to A.
  await edit('Change-back A');await page.clock.runFor(400);await pending(3);
  await edit('Change-back B');await edit('Change-back A');await release(2,{n:47});
  assert.equal(await status().getAttribute('data-check-context'),'stale');assert.doesNotMatch(await preview().innerText(),/47 people are eligible today/);
  await page.clock.runFor(400);await pending(4);await release(3,{n:31});
  await page.waitForFunction(()=>document.querySelector('[data-check-context="current"]'));
  // An obsolete transport failure must not replace a newer draft's pending context.
  await edit('Old failure');await page.clock.runFor(400);await pending(5);await edit('Newer draft');await release(4,{error:true});
  assert.equal(await status().getAttribute('data-check-context'),'stale');assert.equal(await page.locator('[data-check-context="error"]').count(),0);
  await page.clock.runFor(400);await pending(6);await release(5,{n:37});
  await page.waitForFunction(()=>document.querySelector('[data-check-context="current"]'));
  // Closing a review while its check is pending releases ownership; its late result
  // cannot mark a subsequent edit as current or repaint/focus the closed review.
  await page.locator('[data-review]').click();await pending(7);
  const dialog=page.getByRole('dialog',{name:'Review rota rule changes',exact:true});await dialog.waitFor();
  await page.evaluate(()=>window.__closedReview=document.querySelector('dialog.rr-dialog'));
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  await edit('After closed review');await release(6,{n:73});
  assert.equal(await status().getAttribute('data-check-context'),'stale');assert.doesNotMatch(await preview().innerText(),/73 people are eligible today/);
  assert.equal(await field().evaluate(n=>n===document.activeElement),true);
  assert.equal(await page.evaluate(()=>window.__closedReview.textContent.includes('No problems found.')),false,'Late completion must not render current clear state into closed review');
  await page.clock.runFor(400);await pending(8);await release(7,{n:41});
  await page.waitForFunction(()=>document.querySelector('[data-check-context="current"]'));assert.match(await preview().innerText(),/41 people are eligible today/);
  assert.equal(await field().inputValue(),'After closed review');assert.deepEqual(errors,[]);assert.equal(calls.length,9);
  results.push({engine,width,old_success_cannot_mark_new_draft_current:true,change_back_requires_own_check:true,old_failure_ignored:true,closed_review_cannot_repaint_or_steal_focus:true,latest_draft_and_focus_retained:true,exact_validation_bodies: calls.length,forwarded_mutations:0});
  await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Declared source changed during test');
assert.equal(await digest('tests/premium-rules-validation-lifetime.browser.mjs'),testHash,'Test changed during execution');
await writeFile('../docs/premium-ui/qa-rules-validation-lifetime'+(probe?'-before':'')+'.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,test_sha256:await digest('tests/premium-rules-validation-lifetime.browser.mjs'),scope:'Actual exported Rota Rules editor; local-only complete API fixture. Paused clock separates edits, response delivery and400ms debounce. No server save, permissions, persistence, generation, physical-device or native-AT certification.',probe,results},null,2)+'\n');
console.log('Rules validation lifetime: '+results.length+' contexts complete');
