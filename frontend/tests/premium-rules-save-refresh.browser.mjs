import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Actual exported editor. All existing GET/check/PUT requests are fulfilled locally.
// Tests a confirmed save with an omitted rules document and its read-only refresh.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const paths=['src/rota-rules.ts','src/styles.css','src/premium-theme.css','src/member-workspace.ts','src/services/api.ts','src/ui.ts','src/audit-time.ts','src/decorative-icons.ts'];
const digest=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,await digest(p)])));
const initial=await hashes(),testHash=await digest('tests/premium-rules-save-refresh.browser.mjs');
const rule={key:'PAC_DUTY',label:'Save refresh fixture',group:'pac',campus:'Main campus',duration_hours:8,start_time:'08:00',end_time:'16:00',is_24hr:false,counts_in_main_24hr:false,is_mandatory:false,is_adjustable:true,blocks_elective_same_day:false,blocks_elective_next_day:false,active:true,allowed_call_levels:['3RD_CALL'],allowed_cluster_keys:[],excluded_cluster_keys:[],allowed_designations:[],allowed_units:[],excluded_units:[]};
const doc={revision:'rev-1',groups:[],units:[],rule_version:{id:'fixture-version',name:'Fixture',description:null,effective_from:'2026-01-01',effective_to:null,is_active:true,created_at:'2026-01-01T00:00:00Z'},duty_rules:[rule],duty_count_limits:{max_24hr_per_month:8,max_weekend_24hr_per_month:null,max_same_group_per_month:null,max_same_campus_per_month:null},rest_rules:{minimum_gap_after_24hr_hours:24,post_24hr_blocks_next_day_elective:true},unit_staffing_rules:{minimum_available_count:1,warning_unavailable_percent:30,hard_block_unavailable_percent:40,small_unit_uses_absolute_minimum:true}};
const latest=structuredClone(doc);latest.revision='rev-2';latest.duty_rules[0].label='Submitted save draft';latest.rest_rules.minimum_gap_after_24hr_hours=48;
const payload=(label,revision='rev-1')=>{const {revision:_,groups,units,rule_version,...body}=structuredClone(revision==='rev-1'?doc:latest);body.duty_rules[0].label=label;return body;};
const check={problems:[],duties:{PAC_DUTY:{effective_call_levels:['3RD_CALL'],eligible_now:5,eligible_by_level:{'3RD_CALL':5}}}};
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),subcases=[];
  try{for(const scenario of ['closed-late-success','closed-late-error','closed-change-back','current-error-retry','reopened-error-retry','malformed-refresh-retry','detached-success','detached-error']){
   const page=await context.newPage(),errors=[],puts=[],checks=[],reads=[];let expectedLabel=rule.label,expectedRevision='rev-1',expectedCheckDocument='rev-1';
   page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-24T06:00:00Z')});await page.clock.pauseAt(new Date('2026-10-24T06:00:01Z'));
   await page.route('**/__rules-save-refresh',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="rules-root"></main></body></html>'}));
   await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
    if(path==='/api/v1/admin/rota-rules/phase-one/check'){
     assert.equal(method,'POST');const body=req.postDataJSON();assert.deepEqual(body,payload(expectedLabel,expectedCheckDocument),'Check retains the exact draft and its guard values');checks.push(body);return route.fulfill({json:check});
    }
    assert.equal(path,'/api/v1/admin/rota-rules/phase-one');
    if(method==='GET'){
     reads.push(route);if(reads.length===1)return route.fulfill({json:doc});assert.ok(reads.length<=3,'Initial load, one fallback read, and at most one explicit GET retry');return;
    }
    assert.equal(method,'PUT');const body=req.postDataJSON();assert.deepEqual(body,{duty_rules:payload(expectedLabel,expectedCheckDocument).duty_rules,base_revision:expectedRevision},'Existing PUT excludes guards and sends exact current revision');puts.push(body);assert.ok(puts.length<=2,'Confirmed-save refresh cannot replay a PUT');
    if(puts.length===1)return route.fulfill({json:{revision:'rev-2'}});assert.equal(expectedRevision,'rev-2');return route.fulfill({json:{...structuredClone(latest),revision:'rev-3',duty_rules:body.duty_rules}});
   });
   await page.goto(base+'/__rules-save-refresh');await page.evaluate(async()=>{const mod=await import('/src/rota-rules.ts');await mod.renderRotaRulesPage(document.getElementById('rules-root'),{onNavigate:()=>{}});});
   const row=()=>page.locator('[data-duty-row="PAC_DUTY"]'),field=()=>row().locator('[data-text-field=label]');
   const edit=async label=>{expectedLabel=label;await field().fill(label);};
   const dialog=()=>page.getByRole('dialog',{name:'Review rota rule changes',exact:true});
   const waitRead=async n=>{for(let i=0;i<100&&reads.length<n;i++)await new Promise(r=>setTimeout(r,10));assert.equal(reads.length,n,'Expected exact explicitly started GET count');};
   const drain=async()=>{await page.waitForLoadState('networkidle');await page.evaluate(async()=>{for(let i=0;i<24;i++)await Promise.resolve();});};
   const deliver=async(index,failure=false,malformed=false)=>{const response=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/api/v1/admin/rota-rules/phase-one');await reads[index].fulfill(malformed?{json:{revision:'rev-2',duty_rules:'not-an-array'}}:failure?{status:503,json:{detail:'Saved snapshot temporarily unavailable'}}:{json:latest});await(await response).finished();await drain();};
   await row().locator('.rr-duty__toggle').click();await edit('Submitted save draft');await page.locator('[data-review]').click();await dialog().locator('[data-save]:not([disabled])').waitFor();await dialog().locator('[data-save]').click();await waitRead(2);
   await dialog().getByRole('heading',{name:'Rules saved',exact:true}).waitFor();assert.equal(await dialog().locator('[data-save]').count(),0,'Confirmed save cannot offer another PUT');assert.equal(await dialog().locator('[data-save-refresh-retry]').isDisabled(),true,'Pending GET cannot be duplicated');assert.equal(puts.length,1);assert.equal(puts[0].base_revision,'rev-1');
   const late=scenario.startsWith('closed-'),detached=scenario.startsWith('detached-'),failure=scenario.endsWith('-error');
   if(late||detached){
    await page.evaluate(()=>window.__closedSave=document.querySelector('dialog.rr-dialog'));
    if(detached){
     // Simulate the host replacing its page while a module-owned read is pending.
     // Close through native Escape, then use the replacement page's real input.
     await page.evaluate(()=>{document.getElementById('rules-root').innerHTML='<section><h1>Replacement screen</h1><label>Replacement draft<input data-replacement></label></section>';});await page.keyboard.press('Escape');await dialog().waitFor({state:'detached'});await page.locator('[data-replacement]').fill('Independent new screen draft');
    }else{
     if(failure)await dialog().getByRole('button',{name:'Keep editing',exact:true}).click();else await page.keyboard.press('Escape');await dialog().waitFor({state:'detached'});await edit(scenario==='closed-change-back'?rule.label:'New draft after confirmed save dismissal');assert.equal(await page.locator('[data-save-refresh]').isEnabled(),true);assert.equal(await page.locator('[data-review]').count(),0,'Unrefreshed confirmed save blocks normal review/save even after an explicit change back to the original label');
    }
    await page.evaluate(()=>window.__closedSaveHtml=window.__closedSave.innerHTML);const statusBefore=detached?await page.locator('#rules-root').innerHTML():await page.locator('[data-part=status]').innerText();
    await deliver(1,failure);assert.equal(puts.length,1);assert.equal(reads.length,2);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.evaluate(()=>window.__closedSave.innerHTML===window.__closedSaveHtml),true,'Late refresh cannot render into closed review');
    if(detached){
     assert.equal(await page.locator('#rules-root').innerHTML(),statusBefore);assert.equal(await page.locator('[data-replacement]').inputValue(),'Independent new screen draft');assert.equal(await page.locator('[data-replacement]').evaluate(n=>n===document.activeElement),true);assert.equal(await page.locator('.rr-page').count(),0);subcases.push({scenario,detached_page_and_new_focus_untouched:true,closed_review_unchanged:true,exact_put_revisions:['rev-1'],exact_get_count:2,forwarded_mutations:0});assert.deepEqual(errors,[]);await page.close();continue;
    }
    assert.equal(await field().inputValue(),expectedLabel);assert.equal(await field().evaluate(n=>n===document.activeElement),true);assert.equal(await page.locator('[data-part=status]').innerText(),statusBefore);
    await page.locator('[data-save-refresh]').click();await dialog().locator('[data-save-refresh-retry]:not([disabled])').waitFor();assert.equal(reads.length,2,'Reopening confirmed state must not replay read or write');assert.equal(puts.length,1);assert.equal(await dialog().locator('[data-save]').count(),0);await dialog().locator('[data-save-refresh-retry]').click();await waitRead(3);expectedRevision='rev-2';expectedCheckDocument='rev-2';await deliver(2);await dialog().waitFor({state:'detached'});assert.equal(await field().inputValue(),expectedLabel,'Explicit refresh overlays later label edits onto fresh authoritative guards');assert.equal(puts.length,1);assert.equal(await page.locator('[data-review]').isEnabled(),true,'Preserved newer edits remain reviewable against the confirmed saved baseline');
   }else{
    await deliver(1,scenario!=='malformed-refresh-retry',scenario==='malformed-refresh-retry');await dialog().getByText(/Your rules were saved, but the latest saved details could not be loaded\./).waitFor();assert.equal(await dialog().locator('[data-save]').count(),0);assert.equal(await dialog().locator('[data-save-refresh-retry]').isEnabled(),true);assert.equal(await field().inputValue(),'Submitted save draft','Transport or malformed read failure must retain original edits');assert.equal(puts.length,1);assert.equal(reads.length,2);
    if(scenario==='reopened-error-retry'){
     await dialog().getByRole('button',{name:'Keep editing',exact:true}).click();await dialog().waitFor({state:'detached'});await page.locator('[data-save-refresh]').click();await dialog().locator('[data-save-refresh-retry]:not([disabled])').waitFor();assert.equal(puts.length,1);assert.equal(reads.length,2);assert.equal(await dialog().locator('[data-save]').count(),0);
    }
    await dialog().locator('[data-save-refresh-retry]').click();await waitRead(3);expectedRevision='rev-2';expectedCheckDocument='rev-2';await deliver(2);await dialog().waitFor({state:'detached'});assert.equal(await field().inputValue(),'Submitted save draft');assert.equal(puts.length,1);await edit('New draft after explicit saved refresh');
   }
   await page.locator('[data-review]').click();await dialog().locator('[data-save]:not([disabled])').waitFor();assert.deepEqual(checks.at(-1),payload(expectedLabel,expectedCheckDocument));await dialog().locator('[data-save]').click();await dialog().waitFor({state:'detached'});assert.equal(puts.length,2);assert.deepEqual(puts.map(p=>p.base_revision),['rev-1','rev-2']);assert.equal(await field().inputValue(),expectedLabel);assert.equal(reads.length,3,'A complete second save needs no fallback read');assert.deepEqual(errors,[]);
   subcases.push({scenario,confirmed_save_never_replayed:true,get_only_refresh_retry:true,new_revision_used_after_explicit_refresh:true,...(late?{late_success_or_failure_preserves_new_draft_focus_status_and_closed_dom:true,later_label_edits_preserved_and_fresh_server_guards_incorporated:true,...(scenario==='closed-change-back'?{explicit_change_back_remains_dirty_against_submitted_saved_baseline:true}:{})}:{current_confirmed_failure_visible:true,...(scenario==='reopened-error-retry'?{reopened_confirmed_state_cannot_duplicate_put:true}:{}),...(scenario==='malformed-refresh-retry'?{malformed_get_200_rejected_without_discard_or_put_replay:true}:{})}),exact_put_revisions:['rev-1','rev-2'],exact_get_count:3,forwarded_mutations:0});await page.close();
  }}finally{await context.close();}results.push({engine,width,subcases});
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Declared source changed during test');assert.equal(await digest('tests/premium-rules-save-refresh.browser.mjs'),testHash,'Test changed during execution');
await writeFile('../docs/premium-ui/qa-rules-save-refresh.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,test_sha256:testHash,scope:'Actual exported Rota Rules editor, 3 engines x 320/1280, 8 isolated scenarios per context. All API locally fulfilled; exact PUT/check bodies. Confirmed partial PUT fallback GET, dismissed/detached late 200/503, current transport/malformed200 failure, GET-only retry across reopening, post-submit label and explicit change-back preservation onto authoritative guard48, and revision2 subsequent save. Paused clock suppresses unrelated debounce. No real persistence/auth, production bundle, native AT or physical-device certification.',results},null,2)+'\n');console.log('Rules save refresh: '+results.length+' contexts complete');
