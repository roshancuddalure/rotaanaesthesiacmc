// Frontend contracts: all mutations mocked; full-app journeys forward fixture GETs only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base=process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const browser=await chromium.launch({headless:true});
const evidence=[];
const month='2026-05';
const decision={slot_id:'s1',date:'2026-05-02',duty:'Main duty',unit:'UNIT I',action:'assign',person_id:'p1',person_name:'Dr Example',reason:'Eligible and rested',score:1};
const job=(kind='members')=>({id:'job1',month,status:'completed',engine:'server',requested_engine:'server',revision:7,processed:1,total:1,proposed:1,unresolved:0,decisions:[decision],kind,context_hash:'hash1',metrics:{planning_ms:2,steps:1},burden:null,...(kind==='template'?{template:{options:{duty_keys:['MAIN_1ST_24HR']},summary:{created_slots:1}}}:{})});
async function setup(width,handler){
 const context=await browser.newContext({viewport:{width,height:850},acceptDownloads:true}),page=await context.newPage(),calls=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/__generation-actions',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Generation action contracts</title><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main><h1>Action contract fixture</h1><button id="opener">Open</button><div id="host"></div></main></body></html>'}));
 await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url()),call={path:url.pathname,search:url.search,method:request.method(),body:request.postDataJSON()};calls.push(call);const response=await handler(call);assert.ok(response,`Unmocked API ${call.method} ${call.path}`);await route.fulfill({status:response.status||200,contentType:'application/json',body:JSON.stringify(response.body)});});
 await page.goto(base+'/__generation-actions');
 await page.evaluate(()=>localStorage.clear());
 return {context,page,calls,errors};
}
const caps={enabled:true,browser_gpu:false,template_compute:true,template_gpu:false,optimizer_gpu:false,context_hash:'hash1'};
async function openCompute(page,kind){await page.evaluate(async kind=>{await(await import('/src/rota-compute.ts')).openRotaCompute('2026-05',true,()=>window.applied=(window.applied||0)+1,kind==='template'?{duty_keys:['MAIN_1ST_24HR']}:undefined);},kind);}
try{
 for(const width of [320,390,1280])for(const kind of ['members','template']){
  let current=job(kind),reversalChecked=false;
  const {context,page,calls,errors}=await setup(width,call=>{
   if(call.path.endsWith('/capabilities'))return {body:caps};
   if(call.path.endsWith('/jobs')&&call.method==='GET')return {body:[current]};
   if(call.path.endsWith('/apply')){assert.deepEqual(call.body,{revision:7});current={...current,status:'applied',revision:8,result:{assigned:1,created_slots:1}};return {body:current};}
   if(call.path.endsWith('/reversal-check')){assert.deepEqual(call.body,{revision:8});reversalChecked=true;return {body:{allowed:true}};}
   if(call.path.endsWith('/revert')){assert.equal(reversalChecked,true);assert.deepEqual(call.body,{revision:8});current={...current,status:'reverted',revision:9};return {body:current};}
  });
  await openCompute(page,kind);await page.locator('[data-review-confirm]').waitFor();
  assert.equal(await page.locator('[data-apply]').isDisabled(),true);
  assert.equal(calls.some(c=>c.path.endsWith('/apply')),false);
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-download]').click();const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),`rota-compute-${month}.json`);const artifact=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(artifact.month,month);assert.equal(artifact.decisions[0].person_id,'p1');assert.equal(artifact.status,'completed');
  await page.locator('[data-review-confirm]').check();await page.locator('[data-apply]').click();
  await page.locator('[data-revert]').waitFor({state:'attached'});assert.equal(await page.evaluate(()=>window.applied),1);assert.equal(calls.filter(c=>c.path.endsWith('/apply')).length,1);
  assert.equal(await page.locator('[data-revert]').isDisabled(),true);
  await page.locator('summary').filter({hasText:'Reverse this generation'}).click();await page.locator('[data-reversal-confirm]').check();await page.locator('[data-revert]').click();
  await page.getByText(/Generation reversed after/).waitFor();assert.equal(await page.evaluate(()=>window.applied),2);
  assert.equal(calls.filter(c=>c.path.endsWith('/revert')).length,1);
  await page.locator('[data-close]').click();assert.equal(await page.locator('dialog[open]').count(),0);assert.deepEqual(errors,[]);
  evidence.push({id:`compute-${kind}-review-apply-reverse-download-${width}`,width,selectors:['[data-review-confirm]','[data-apply]','[data-download]','[data-reversal-confirm]','[data-revert]','[data-close]'],passed:true,mocked_api:true,request_bodies_verified:true,download_contents_verified:true});await context.close();
 }
 // Cancelling a proposal is distinct from closing the review; neither applies assignments.
 {
  let current=job();const {context,page,calls,errors}=await setup(390,call=>{
   if(call.path.endsWith('/capabilities'))return {body:caps};if(call.path.endsWith('/jobs'))return {body:[current]};
   if(call.path.endsWith('/cancel')){current={...current,status:'cancelled'};return {body:current};}
  });await openCompute(page,'members');await page.locator('[data-cancel]').click();await page.getByText('Proposal cancelled. Existing assignments were preserved.').waitFor();assert.equal(calls.filter(c=>c.path.endsWith('/cancel')).length,1);assert.equal(calls.some(c=>c.path.endsWith('/apply')),false);await page.locator('[data-close]').click();assert.deepEqual(errors,[]);evidence.push({id:'compute-cancel-no-apply',passed:true,mocked_api:true});await context.close();
 }
 for(const width of [320,390,1280]){
  let previews=0,attempts=0;
  const review={month,pending_count:1,review_token:'token1',requests:[{id:'l1',person_name:'Dr Example',starts_on:'2026-04-29',ends_on:'2026-05-02',status:'requested'}],affected_duties:[{id:'a1',person_id:'p1',person_name:'Dr Example',date:'2026-05-01',duty:'Main duty'}]};
  const {context,page,calls,errors}=await setup(width,call=>{
   if(call.path.endsWith('/approval-preview')){assert.deepEqual(call.body,{month});previews++;return {body:{...review,review_token:previews===1?'token1':'token2'}};}
   if(call.path.endsWith('/approve-month')){attempts++;assert.deepEqual(call.body,{month,review_token:attempts===1?'token1':'token2',acknowledge_duties:true});return attempts===1?{status:409,body:{detail:'Review changed'}}:{body:{approved_count:1}};}
  });
  await page.evaluate(async()=>{(await import('/src/leave-approval.ts')).openMonthlyLeaveApproval('2026-05',count=>window.approved=count);});
  await page.locator('[data-confirm]').waitFor();assert.equal(await page.locator('[data-approve]').isDisabled(),true);await page.locator('[data-confirm]').check();assert.equal(await page.locator('[data-approve]').isDisabled(),true);await page.locator('[data-duty-ack]').check();await page.locator('[data-approve]').click();
  await page.getByRole('alert').filter({hasText:'Refresh the review'}).waitFor();assert.equal(await page.locator('[data-approve]').isDisabled(),true);assert.equal(attempts,1);assert.equal(await page.evaluate(()=>window.approved),undefined);
  await page.locator('[data-refresh]').click();await page.locator('[data-confirm]').waitFor();assert.equal(await page.locator('[data-confirm]').isChecked(),false);await page.locator('[data-confirm]').check();await page.locator('[data-duty-ack]').check();await page.locator('[data-approve]').click();await page.locator('dialog').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.approved),1);assert.equal(attempts,2);assert.equal(calls.filter(c=>c.path.endsWith('/approval-preview')).length,2);assert.deepEqual(errors,[]);
  evidence.push({id:`leave-approval-stale-refresh-apply-${width}`,width,selectors:['[data-confirm]','[data-duty-ack]','[data-approve]','[data-refresh]'],passed:true,mocked_api:true,exact_month_token_ack_verified:true});await context.close();
 }
 // Whole-month configuration, evidence, teaching and learning controls use their precise contracts.
 {
  const alternative={status:'feasible',uncovered:0,changed:0,elapsed_ms:10,warnings:[],objectives:[],history_window:{start:'2026-01',end:'2026-04',observed_months:[]}};
  let current={...job('intelligent'),intelligence:{selected:0,alternatives:[alternative]}},examples=[],versions=[];
  const {context,page,calls,errors}=await setup(390,call=>{
   const tail=call.path.split('/rota-intelligence/')[1];
   if(call.path.endsWith('/setup'))return {body:{slots:[{id:'s1',date:'2026-05-02',label:'Main duty',assigned:[{id:'p1',name:'Dr Example'}]}],people:[{id:'p1',name:'Dr Example'}],holiday_dates:[],history_lookback:4,history_months:[],rules:{}}};
   if(call.path.endsWith('/capabilities'))return {body:caps};
   if(call.path.endsWith('/jobs')&&call.method==='GET')return {body:[current]};
   if(tail==='calendar'){assert.deepEqual(call.body,{dates:['2026-05-01']});return {body:{dates:call.body.dates}};}
   if(tail==='jobs/job1/alternative'){assert.deepEqual(call.body,{revision:7,index:0});current={...current,revision:8,intelligence:{selected:0,alternatives:[alternative,{...alternative,status:'optimal'}]}};return {body:current};}
   if(tail==='jobs/job1/select'){assert.deepEqual(call.body,{revision:8,index:1});current={...current,revision:9,intelligence:{...current.intelligence,selected:1}};return {body:current};}
   if(tail==='jobs/job1/examples'){assert.deepEqual(call.body,{slot_id:'s1',kind:'accept',preferred_person_id:null,reason:'burden',note:'Reviewed example'});examples=[{id:'e1',month,kind:'accept',reason:'burden',status:'unverified',note:'Reviewed example',decision}];return {body:examples[0]};}
   if(tail==='teaching')return {body:examples};
   if(tail==='history-months')return {body:['2026-04']};
   if(tail==='teaching/history'){assert.deepEqual(call.body,{month:'2026-04'});return {body:{prepared:1}};}
   if(tail==='teaching/e1/approve'){assert.deepEqual(call.body,{historical_context_verified:false});examples[0].status='approved';return {body:examples[0]};}
   if(tail==='teaching/e1/reject'){assert.deepEqual(call.body,{});examples[0].status='rejected';return {body:examples[0]};}
   if(tail==='learning'&&call.method==='POST'){assert.deepEqual(call.body,{});versions=[{id:'v1',status:'candidate',weights:{},evaluation:null},{id:'v0',status:'retired',weights:{},evaluation:{passed:true},activated_at:'2026-01-01'}];return {body:versions[0]};}
   if(tail==='learning')return {body:versions};
   if(tail==='learning/v1/evaluate'){assert.deepEqual(call.body,{months:['2026-04']});versions[0].evaluation={passed:true};return {body:versions[0]};}
   if(tail==='learning/v1/activate'){versions[0].status='active';return {body:versions[0]};}
   if(tail==='learning/v0/rollback'){versions[0].status='retired';versions[1].status='active';return {body:versions[1]};}
   if(call.path.endsWith('/apply')){assert.deepEqual(call.body,{revision:9});current={...current,status:'applied',revision:10,result:{assigned:1,replaced:0}};return {body:current};}
   if(call.path.endsWith('/reversal-check')){assert.deepEqual(call.body,{revision:10});return {body:{allowed:true}};}
   if(call.path.endsWith('/revert')){assert.deepEqual(call.body,{revision:10});current={...current,status:'reverted'};return {body:current};}
  });
  await page.evaluate(async()=>await(await import('/src/rota-intelligence.ts')).openIntelligentRota('2026-05',true,()=>window.applied=(window.applied||0)+1));
  await page.locator('[data-mode]').selectOption('repair');await page.locator('details').filter({has:page.locator('[data-lock]')}).locator('summary').click();await page.locator('[data-repair]').check();assert.equal(await page.locator('[data-lock]').isChecked(),false);await page.locator('details').filter({has:page.locator('[data-lock]')}).locator('summary').click();await page.locator('[data-lock]').check();assert.equal(await page.locator('[data-repair]').isChecked(),false);
  await page.getByText('Member preferences',{exact:true}).click();await page.locator('[data-add-preference]').click();await page.getByText('Member preferences',{exact:true}).click();await page.getByText('1 preferences recorded for this proposal.').waitFor();
  await page.getByText('Maintain holiday dates',{exact:true}).click();await page.locator('[data-holidays]').fill('2026-05-01');await page.locator('[data-save-calendar]').click();await page.getByText('Reviewed holiday calendar saved. Existing proposals must be regenerated.').waitFor();
  await page.locator('[data-tab="review"]').click();await page.locator('[data-more]').click();await page.getByText('Alternative search finished. Compare coverage and changes before selecting.').waitFor();await page.locator('[data-alternative]').selectOption('1');await page.waitForFunction(()=>!document.querySelector('.mw-footer').textContent.includes('Working.'));
  const downloading=page.waitForEvent('download');await page.locator('[data-download]').click();const artifact=await downloading;assert.equal(artifact.suggestedFilename(),'intelligent-rota-2026-05.json');assert.equal(JSON.parse(await readFile(await artifact.path(),'utf8')).intelligence.selected,1);
  await page.locator('[data-teach-slot]').click();assert.equal(await page.locator('[name="slot_id"]').inputValue(),'s1');await page.locator('[name="note"]').fill('Reviewed example');await page.getByRole('button',{name:'Save teaching example',exact:true}).click();await page.getByText('Teaching example saved for review.').waitFor();
  await page.locator('[data-load-teaching]').click();await page.locator('[data-approve-example]').click();await page.locator('[data-reject-example]').waitFor();assert.equal(examples[0].status,'approved');await page.locator('[data-reject-example]').click();await page.waitForFunction(()=>!document.querySelector('.mw-footer').textContent.includes('Working.'));assert.equal(examples[0].status,'rejected');
  await page.locator('[data-history-months]').click();await page.locator('[data-history-month]').waitFor();await page.locator('[data-prepare-history]').click();await page.getByText('1 historical references prepared, all unverified.').waitFor();
  await page.locator('[data-tab="learning"]').click();await page.locator('[data-load-learning]').click();await page.locator('[data-propose-learning]').click();await page.locator('[data-evaluate="v1"]').waitFor();await page.locator('[data-heldout]').fill('2026-04');await page.locator('[data-evaluate="v1"]').click();await page.locator('[data-activate="v1"]').click();await page.waitForFunction(()=>!document.querySelector('.mw-footer').textContent.includes('Working.'));assert.equal(versions[0].status,'active');await page.locator('[data-rollback="v0"]').click();await page.waitForFunction(()=>!document.querySelector('.mw-footer').textContent.includes('Working.'));assert.equal(versions[1].status,'active');
  await page.locator('[data-tab="review"]').click();assert.equal(await page.locator('[data-apply]').isDisabled(),true);await page.locator('[data-confirm]').check();await page.locator('[data-apply]').click();await page.getByText('1 assignments saved; 0 replaced. Not published.').waitFor();assert.equal(await page.evaluate(()=>window.applied),1);await page.getByText('Reverse this generation',{exact:true}).click();await page.locator('[data-reversal-confirm]').check();await page.locator('[data-revert]').click();await page.getByText('Generation reversed. Previous assignments restored.').waitFor();assert.equal(await page.evaluate(()=>window.applied),2);await page.locator('[data-close]').click();assert.deepEqual(errors,[]);
  evidence.push({id:'intelligence-configuration-review-teaching-learning-reversal',passed:true,mocked_api:true,exact_request_bodies_verified:true,download_contents_verified:true,requests:calls.length});await context.close();
 }
 // Assistant opt-in/token gates and local failure do not block ordinary planning.
 {
  const {context,page,calls,errors}=await setup(390,call=>{
   if(call.path.endsWith('/setup'))return {body:{slots:[],people:[],holiday_dates:[],history_lookback:4,history_months:[],rules:{}}};
   if(call.path.endsWith('/jobs'))return {body:[]};
   if(call.path.endsWith('/assistant-context')){assert.equal(new URLSearchParams(call.search).get('instruction'),'Balance this month');return {body:{month}};}
  });
  let localRequests=0;
  await page.route('http://127.0.0.1:11437/suggest',async route=>{localRequests++;assert.equal(route.request().headers()['x-rota-pairing'],'temporary-test-pairing');assert.deepEqual(route.request().postDataJSON(),{instruction:'Balance this month',context:JSON.stringify({month})});await route.fulfill({status:localRequests===1?503:200,contentType:'application/json',body:JSON.stringify(localRequests===1?{detail:'Local model temporarily unavailable'}:{mode:'preferences',explanation:'Review suggested preferences',proposed_rules:[],rule_changes:[]})});});
  await page.evaluate(async()=>await(await import('/src/rota-intelligence.ts')).openIntelligentRota('2026-05',true,()=>{}));await page.locator('[data-tab="assistant"]').click();assert.equal(await page.locator('[data-ask]').isDisabled(),true);await page.locator('[data-local-enabled]').check();assert.equal(await page.locator('[data-ask]').isDisabled(),true);await page.locator('[data-local-token]').fill('temporary-test-pairing');await page.locator('[data-instruction]').fill('Balance this month');assert.equal(await page.locator('[data-ask]').isEnabled(),true);await page.locator('[data-ask]').click();await page.getByText('Local model temporarily unavailable',{exact:true}).waitFor();assert.equal(localRequests,1);
  await page.locator('[data-ask]').click();await page.getByText('Local suggestion received. Review before using.').waitFor();await page.locator('[data-use-suggestion]').click();assert.equal(await page.locator('[data-mode]').inputValue(),'preferences');await page.getByText('Suggested mode selected. Safety policies remain unchanged.').waitFor();assert.equal(await page.locator('[data-generate]').isEnabled(),true);assert.equal(calls.some(c=>c.path.endsWith('/apply')),false);assert.equal(calls.some(c=>c.method==='POST'),false);await page.locator('[data-close]').click();assert.deepEqual(errors,[]);evidence.push({id:'intelligence-local-assistant-optin-pairing-failure-retry-use-suggestion',passed:true,mocked_api:true,all_loopback_calls_intercepted:true,no_policy_or_assignment_write:true});await context.close();
 }
 // Server fallback resumes the existing proposal and its exact revision without starting a replacement.
 {
  let current={...job(),engine:'local_gpu',status:'running',revision:3};
  const {context,page,calls,errors}=await setup(390,call=>{
   if(call.path.endsWith('/capabilities'))return {body:caps};if(call.path.endsWith('/jobs'))return {body:[current]};
   if(call.path.endsWith('/step')){assert.deepEqual(call.body,{revision:3,fallback:true});current={...current,engine:'server',status:'completed',revision:4};return {body:current};}
   if(call.path.endsWith('/validate')){assert.deepEqual(call.body,{revision:4});return {body:{valid:true}};}
  });await openCompute(page,'members');await page.locator('[data-server-fallback]').click();await page.getByText(/Draft ready for review. No assignments have been applied./).waitFor();assert.equal(calls.filter(c=>c.path.endsWith('/step')).length,1);assert.equal(calls.some(c=>c.path.endsWith('/apply')),false);await page.locator('[data-close]').click();assert.deepEqual(errors,[]);evidence.push({id:'compute-explicit-server-fallback-existing-revision',passed:true,mocked_api:true});await context.close();
 }
 // Compute settings recover from a refused capability read and persist local choices without mutations.
 {
  let reads=0;const {context,page,calls,errors}=await setup(390,call=>call.path.endsWith('/capabilities')?++reads===1?{status:503,body:{detail:'Readiness temporarily unavailable'}}:{body:{...caps,browser_gpu:true}}:undefined);
  await page.evaluate(async()=>await(await import('/src/rota-compute.ts')).renderComputeSettings(document.querySelector('#host')));
  await page.locator('[data-compute-retry]').click();await page.locator('[data-compute-enable]').waitFor();
  await page.locator('[data-compute-enable]').check();await page.locator('[data-compute-mode]').selectOption('auto');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('duty_rota_compute_device_v1')).mode),'auto');
  await page.locator('[data-compute-power]').selectOption('low-power');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('duty_rota_compute_device_v1')).power),'low-power');
  await page.locator('[data-compute-month]').fill('2026-06');await page.locator('[data-compute-workload]').selectOption('template');assert.equal(await page.locator('[data-compute-month]').inputValue(),'2026-06');assert.equal(await page.locator('[data-compute-compare]').isDisabled(),true);
  const downloading=page.waitForEvent('download');await page.locator('[data-compute-diagnostics]').click();const file=await downloading;const body=JSON.parse(await readFile(await file.path(),'utf8'));assert.ok(body);assert.ok(file.suggestedFilename().endsWith('.json'));assert.doesNotMatch(JSON.stringify(body),/duty_rota_auth_token|rota_local_assistant_pairing/);
  await page.locator('[data-compute-reset]').click();assert.equal(await page.locator('[data-compute-enable]').isChecked(),false);assert.equal(await page.locator('[data-compute-mode]').inputValue(),'server');assert.equal(calls.some(c=>c.method!=='GET'),false);assert.deepEqual(errors,[]);evidence.push({id:'compute-settings-read-retry-local-persistence-reset-diagnostics',passed:true,mocked_api:true,no_operational_mutations:true});await context.close();
 }
 // A paused job resumes through its existing revision, validates, then can be cancelled without apply.
 {
  let current={...job(),status:'running',revision:3};const {context,page,calls,errors}=await setup(390,call=>{
   if(call.path.endsWith('/capabilities'))return {body:caps};if(call.path.endsWith('/jobs'))return {body:[current]};
   if(call.path.endsWith('/step')){assert.deepEqual(call.body,{revision:3});current={...current,status:'completed',revision:4};return {body:current};}
   if(call.path.endsWith('/validate')){assert.deepEqual(call.body,{revision:4});return {body:{valid:true}};}
   if(call.path.endsWith('/cancel')){current={...current,status:'cancelled'};return {body:current};}
  });await openCompute(page,'members');await page.locator('[data-resume]').click();await page.getByText(/Draft ready for review. No assignments have been applied./).waitFor();assert.equal(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/jobs')).length,0);await page.locator('[data-cancel]').click();await page.getByText('Proposal cancelled. Existing assignments were preserved.').waitFor();assert.equal(calls.some(c=>c.path.endsWith('/apply')),false);await page.locator('[data-close]').click();assert.deepEqual(errors,[]);evidence.push({id:'compute-paused-resume-current-revision-validate-cancel',passed:true,mocked_api:true});await context.close();
 }
 // Extra-duty fallback order retries reads/saves and discards only unsaved local edits.
 {
  let reads=0,saves=0;let rows=[{unit_id:'u1',unit_name:'UNIT I',fallbacks:[{unit_id:'u2',unit_name:'UNIT II'}]},{unit_id:'u2',unit_name:'UNIT II',fallbacks:[]},{unit_id:'u3',unit_name:'UNIT III',fallbacks:[]}];
  const {context,page,calls,errors}=await setup(390,call=>{
   if(call.path.endsWith('/unit-fallbacks')&&call.method==='GET')return ++reads===1?{status:503,body:{detail:'Fallback list unavailable'}}:{body:rows};
   if(call.path.endsWith('/unit-fallbacks/u1')&&call.method==='PUT'){saves++;assert.deepEqual(call.body,{fallback_unit_ids:['u2','u3']});if(saves===1)return {status:503,body:{detail:'Save temporarily unavailable'}};rows[0]={...rows[0],fallbacks:[{unit_id:'u2',unit_name:'UNIT II'},{unit_id:'u3',unit_name:'UNIT III'}]};return {body:rows[0]};}
  });await page.evaluate(async()=>await(await import('/src/extra-duty.ts')).renderUnitFallbacks(document.querySelector('#host')));await page.locator('[data-fb-reload]').click();const unit=page.locator('[data-fallback-unit="u1"]');await unit.locator('summary').click();await unit.locator('[data-fb-select]').selectOption('u3');await unit.locator('[data-fb-add]').click();assert.equal(await unit.locator('[data-fallback-item]').count(),2);await unit.locator('[data-fb-reset]').click();assert.equal(await unit.locator('[data-fallback-item]').count(),1);assert.equal(calls.some(c=>c.method==='PUT'),false);
  if(!(await unit.evaluate(el=>el.open)))await unit.locator('summary').click();await unit.locator('[data-fb-select]').selectOption('u3');await unit.locator('[data-fb-add]').click();await unit.locator('[data-fb-save]').click();await unit.getByText(/Save temporarily unavailable/).waitFor();assert.equal(await unit.locator('[data-fallback-item]').count(),2);assert.equal(await unit.locator('[data-fb-save]').isEnabled(),true);await unit.locator('[data-fb-save]').click();await unit.getByText('Saved. The next extra-duty run uses this order.',{exact:true}).waitFor();assert.equal(saves,2);
  await page.evaluate(async()=>await(await import('/src/extra-duty.ts')).renderUnitFallbacks(document.querySelector('#host')));assert.equal(await unit.locator('[data-fallback-item]').count(),2);assert.deepEqual(errors,[]);evidence.push({id:'extra-fallback-read-retry-draft-discard-save-failure-retry-readback',passed:true,mocked_api:true,no_put_on_discard:true,exact_save_body:true,fresh_mock_readback:true});await context.close();
 }
 // Closing a reviewed leave batch does not submit approval.
 {
  const {context,page,calls}=await setup(390,call=>call.path.endsWith('/approval-preview')?{body:{month,pending_count:0,review_token:'t',requests:[],affected_duties:[]}}:undefined);
  await page.evaluate(async()=>{(await import('/src/leave-approval.ts')).openMonthlyLeaveApproval('2026-05',()=>{});});await page.getByText('No pending leave requests to approve for this month.').waitFor();assert.equal(await page.locator('[data-approve]').isDisabled(),true);await page.locator('[data-close]').click();await page.locator('dialog').waitFor({state:'detached'});assert.equal(calls.some(c=>c.path.endsWith('/approve-month')),false);evidence.push({id:'leave-empty-close-no-approval',passed:true,mocked_api:true});await context.close();
 }
 // Real application publishing controls: all mutations/downloads mocked, fixture reads strictly GET-only.
 for(const width of [390,1280]){
  const api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
  const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[],writes=[];let cancelled=false;
  page.on('pageerror',e=>errors.push(e.message));
  const reviewData=await(await fetch(api+'/api/v1/rota-review/month?month='+month,{headers:{Authorization:'Bearer premium-contract'}})).json();
  const reviewedSlot=reviewData.review_items[0].slot.id;
  reviewData.review_items[0].issues=[{severity:'warning',code:'template_review',message:'Template choice requires board review',accepted:false,decision:null}];
  let candidateReads=0,reviewWrites=0;
  const published={month,rota_period:{id:'period1',name:'May 2026',starts_on:'2026-05-01',ends_on:'2026-05-31',status:'draft'},rule_version:{id:'r1',name:'Existing policy'},summary:{total_slots:1,assigned_slots:1,open_slots:0},can_publish:true,requires_warning_confirmation:true,checks:[],blockers:[],warnings:[{status:'warning',title:'Reviewed warning',detail:'Requires board acknowledgement'}],latest_publish:null};
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','premium-contract');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.route('**/api/**',async route=>{
   const r=route.request(),u=new URL(r.url());
   if(u.pathname.endsWith('/rota-publish/month'))return route.fulfill({json:published});
   if(u.pathname.endsWith('/rota-review/month'))return route.fulfill({json:reviewData});
   if(u.pathname.endsWith('/rota-candidates/slots/'+reviewedSlot)){candidateReads++;assert.equal(u.searchParams.get('limit'),'20');return route.fulfill({json:{slot_id:reviewedSlot,candidates:[]}});}
   if(u.pathname.endsWith('/rota-review/slots/'+reviewedSlot+'/decisions')){reviewWrites++;assert.equal(r.method(),'POST');assert.deepEqual(r.postDataJSON(),{issue_code:'template_review',note:'Board reviewed warning'});reviewData.review_items[0].accepted=true;reviewData.review_items[0].issues[0].accepted=true;reviewData.review_items[0].issues[0].decision={note:'Board reviewed warning',decided_by:'Test board'};return route.fulfill({json:reviewData.review_items[0].issues[0].decision});}
   if(u.pathname.endsWith('/rota-publish/publish')){assert.equal(r.method(),'POST');writes.push({path:u.pathname,month:u.searchParams.get('month'),body:r.postDataJSON()});assert.equal(u.searchParams.get('month'),month);assert.deepEqual(r.postDataJSON(),{confirm_warnings:true,approval_note:'Board reviewed this month'});published.latest_publish={status:'published',approved_by:'Test board',created_at:'2026-05-01T00:00:00Z',confirmed_warnings:true,approval_note:'Board reviewed this month'};published.rota_period.status='published';return route.fulfill({json:published});}
   if(u.pathname.endsWith('/rota-publish/export')){assert.equal(u.searchParams.get('month'),month);return route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers:{'Content-Disposition':'attachment; filename="reviewed-month.xlsx"'},body:'PK\x03\x04-MOCK-export-contract-2026-05'});}
   assert.equal(r.method(),'GET',`No unmocked mutation may reach fixture: ${r.method()} ${u.pathname}`);
   const response=await route.fetch({url:api+u.pathname+u.search});
   if(u.pathname.endsWith('/auth/me')){const user=await response.json();return route.fulfill({json:{...user,role:'superadmin',permissions:[...user.permissions,'publish_rota']}});}
   return route.fulfill({response});
  });
  await page.goto(base);await page.locator('#section-title').waitFor();
  if(width<700){await page.locator('#mobile-more').click();await page.locator('[data-mobile-more-view="rota-review"]').click();}else await page.locator('[data-view="rota-review"]').first().click();
  await page.locator('[data-rota-review-filter="all"]').waitFor();
  assert.deepEqual((await page.locator('[data-open-rota-review-slot]').evaluateAll(es=>es.map(e=>e.dataset.openRotaReviewSlot))).sort(),reviewData.review_items.map(i=>i.slot.id).sort());
  await page.locator('[data-rota-review-filter="hard"]').click();await page.waitForFunction(()=>document.querySelector('[data-rota-review-filter="hard"]')?.getAttribute('aria-pressed')==='true'&&document.querySelectorAll('[data-open-rota-review-slot]').length===1);assert.equal(await page.locator('[data-open-rota-review-slot]').count(),1);
  await page.locator('[data-rota-review-filter="override"]').click();await page.waitForFunction(()=>document.querySelector('[data-rota-review-filter="override"]')?.getAttribute('aria-pressed')==='true');assert.equal(await page.locator('[data-open-rota-review-slot]').count(),0);await page.locator('[data-rota-review-filter="all"]').click();
  await page.locator('[data-open-rota-review-slot="'+reviewedSlot+'"]').click();await page.locator('#rota-review-slot-modal').waitFor();
  // Opening the selected slot loads suggestions immediately; assert that real outcome.
  await page.getByText('No matching unit members found for this slot.',{exact:true}).waitFor();assert.equal(candidateReads,1);
  page.once('dialog',async dialog=>await dialog.dismiss());await page.locator('[data-accept-review-issue="'+reviewedSlot+'"]').click();await page.getByText('Decision note is required',{exact:true}).waitFor();assert.equal(reviewWrites,0);
  page.once('dialog',async dialog=>await dialog.accept('Board reviewed warning'));await page.locator('[data-accept-review-issue="'+reviewedSlot+'"]').click();await page.getByText('Review decision saved',{exact:true}).waitFor();await page.getByText('Accepted by Test board: Board reviewed warning',{exact:true}).waitFor();assert.equal(reviewWrites,1);
  await page.locator('#rota-review-slot-modal [data-close-review-slot-modal]').first().click();await page.locator('#rota-review-slot-modal').waitFor({state:'detached'});
  evidence.push({id:`main-review-filters-selected-slot-candidates-accept-cancel-${width}`,width,passed:true,mutations_mocked:true,read_only_fixture_reads:true,filter_results_verified:true,selected_slot_verified:true,note_cancel_no_write:true,exact_decision_body:true});
  if(width<700){await page.locator('#mobile-more').click();await page.locator('[data-mobile-more-view="rota-publish"]').click();}else await page.locator('[data-view="rota-publish"]').first().click();
  await page.locator('#rota-publish-form').waitFor();assert.equal(await page.locator('#download-rota-export').isDisabled(),true);
  await page.locator('#rota-publish-form button[type="submit"]').click();await page.getByText('Approval note is required',{exact:true}).waitFor();assert.equal(writes.length,0);
  await page.locator('#publish-approval-note').fill('Board reviewed this month');await page.locator('#publish-confirm-warnings').check();
  page.once('dialog',async dialog=>{assert.equal(dialog.message(),'Publish May 2026 as final?');cancelled=true;await dialog.dismiss();});await page.locator('#rota-publish-form button[type="submit"]').click();assert.equal(cancelled,true);assert.equal(writes.length,0);
  page.once('dialog',async dialog=>await dialog.accept());await page.locator('#rota-publish-form button[type="submit"]').click();await page.getByText('Final rota published',{exact:true}).waitFor();await page.locator('#download-rota-export:not([disabled])').waitFor();assert.equal(writes.length,1);await page.reload();await page.locator('#section-title').waitFor();
  // Reload restores the approved hash route; wait for that read-back instead of racing boot with another navigation.
  assert.match(page.url(),/#view=rota-publish$/);
  await page.locator('#download-rota-export:not([disabled])').waitFor();await page.getByText('Board reviewed this month',{exact:true}).waitFor();
  const downloading=page.waitForEvent('download');await page.locator('#download-rota-export').click();const file=await downloading;assert.equal(file.suggestedFilename(),'reviewed-month.xlsx');assert.equal(await readFile(await file.path(),'utf8'),'PK\x03\x04-MOCK-export-contract-2026-05');assert.deepEqual(errors,[]);evidence.push({id:`main-publish-required-note-cancel-confirm-refresh-download-${width}`,width,passed:true,mutations_mocked:true,read_only_fixture_reads:true,exact_month_body:true,download_mock_bytes_preserved:true});await context.close();
 }
}finally{await browser.close();}
console.log(JSON.stringify({generated_at:new Date().toISOString(),frontend:base,no_live_mutations:true,full_app_fixture_reads:'GET only',workflows:evidence}));
console.log(`Premium generation action contracts passed: ${evidence.length} isolated workflows.`);
