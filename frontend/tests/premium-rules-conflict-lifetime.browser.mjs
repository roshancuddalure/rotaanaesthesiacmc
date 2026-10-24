import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Actual exported editor, native interaction, entirely local API interception.
// PUTs are checked exactly and fulfilled here; no mutation reaches any server.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const probe=process.env.RULE_CONFLICT_PROBE==='1',results=[];
const paths=['src/rota-rules.ts','src/styles.css','src/premium-theme.css','src/member-workspace.ts','src/services/api.ts','src/ui.ts','src/audit-time.ts','src/decorative-icons.ts'];
const digest=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,await digest(p)])));
const initial=await hashes(),testHash=await digest('tests/premium-rules-conflict-lifetime.browser.mjs');
if(!probe){const previous='../docs/premium-ui/qa-rules-conflict-lifetime.json',archive='../docs/premium-ui/qa-rules-conflict-lifetime-before-extended.json';try{await access(previous);try{await access(archive);}catch{await copyFile(previous,archive);}}catch{}}
const rule={key:'PAC_DUTY',label:'Conflict fixture',group:'pac',campus:'Main campus',duration_hours:8,start_time:'08:00',end_time:'16:00',is_24hr:false,counts_in_main_24hr:false,is_mandatory:false,is_adjustable:true,blocks_elective_same_day:false,blocks_elective_next_day:false,active:true,allowed_call_levels:['3RD_CALL'],allowed_cluster_keys:[],excluded_cluster_keys:[],allowed_designations:[],allowed_units:[],excluded_units:[]};
const doc={revision:'rev-1',groups:[],units:[],rule_version:{id:'fixture-version',name:'Fixture',description:null,effective_from:'2026-01-01',effective_to:null,is_active:true,created_at:'2026-01-01T00:00:00Z'},duty_rules:[rule],duty_count_limits:{max_24hr_per_month:8,max_weekend_24hr_per_month:null,max_same_group_per_month:null,max_same_campus_per_month:null},rest_rules:{minimum_gap_after_24hr_hours:24,post_24hr_blocks_next_day_elective:true},unit_staffing_rules:{minimum_available_count:1,warning_unavailable_percent:30,hard_block_unavailable_percent:40,small_unit_uses_absolute_minimum:true}};
const latest=structuredClone(doc);latest.revision='rev-2';latest.duty_rules[0].label='Latest server label';latest.rest_rules.minimum_gap_after_24hr_hours=48;
const payload=(label,revision='rev-1')=>{const {revision:_,groups,units,rule_version,...body}=structuredClone(revision==='rev-1'?doc:latest);body.duty_rules[0].label=label;return body;};
const check={problems:[],duties:{PAC_DUTY:{effective_call_levels:['3RD_CALL'],eligible_now:5,eligible_by_level:{'3RD_CALL':5}}}};
for(const [engine,launcher]of Object.entries(probe?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of probe?[320]:[320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),subcases=[];
  try{for(const scenario of probe?['reload-late-success']:['reload-late-success','reload-late-error','review-late-success','review-late-error','reload-current','review-current','reload-open-error-retry','review-open-error-retry','review-close-during-recheck']){
   const page=await context.newPage(),errors=[],puts=[],checks=[];let getCount=0,held=null,heldValidation=null,holdValidation=false,expectedLabel=rule.label,expectedRevision='rev-1';
   page.on('pageerror',e=>errors.push(e.message));
   await page.clock.install({time:new Date('2026-10-24T06:00:00Z')});await page.clock.pauseAt(new Date('2026-10-24T06:00:01Z'));
   await page.route('**/__rules-conflict-lifetime',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="rules-root"></main></body></html>'}));
   await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
    if(path==='/api/v1/admin/rota-rules/phase-one/check'){
     assert.equal(method,'POST');assert.deepEqual(req.postDataJSON(),payload(expectedLabel,expectedRevision),'Validation body must equal the current draft including existing limits');checks.push(req.postDataJSON());if(holdValidation){holdValidation=false;heldValidation=route;return;}return route.fulfill({json:check});
    }
    assert.equal(path,'/api/v1/admin/rota-rules/phase-one');
    if(method==='GET'){getCount++;if(getCount===1)return route.fulfill({json:doc});assert.ok(getCount===2||(scenario.endsWith('open-error-retry')&&getCount===3),'Only explicit conflict recovery or its explicit retry may read again');held=route;return;}
    assert.equal(method,'PUT');const body=req.postDataJSON();assert.deepEqual(body,{duty_rules:payload(expectedLabel,expectedRevision).duty_rules,base_revision:expectedRevision},'Existing save contract excludes limits and carries exact revision');puts.push(body);
    if(puts.length===1||scenario.includes('-late-'))return route.fulfill({status:409,json:{detail:{code:'stale_rules',message:'The rules changed since you loaded them.',current_revision:'rev-2'}}});
    assert.equal(puts.length,2);assert.equal(expectedRevision,'rev-2');return route.fulfill({json:{...structuredClone(latest),revision:'rev-3',duty_rules:body.duty_rules}});
   });
   await page.goto(base+'/__rules-conflict-lifetime');
   await page.evaluate(async()=>{const mod=await import('/src/rota-rules.ts');await mod.renderRotaRulesPage(document.getElementById('rules-root'),{onNavigate:()=>{}});});
   const row=()=>page.locator('[data-duty-row="PAC_DUTY"]'),field=()=>row().locator('[data-text-field=label]');
   const edit=async label=>{expectedLabel=label;await field().fill(label);};
   await row().locator('.rr-duty__toggle').click();await edit('My conflict draft');
   await page.locator('[data-review]').click();let dialog=page.getByRole('dialog',{name:'Review rota rule changes',exact:true});
   await dialog.locator('[data-save]:not([disabled])').waitFor();await dialog.locator('[data-save]').click();await dialog.locator('[data-stale-reload]').waitFor();assert.equal(puts.length,1);
   const action=scenario.startsWith('reload')?'reload':'review';await dialog.locator('[data-stale-'+action+']').click();
   for(let i=0;i<100&&!held;i++)await new Promise(r=>setTimeout(r,10));assert.ok(held,'Explicit recovery GET genuinely held');
   const late=scenario.includes('-late-'),failure=scenario.endsWith('-error'),openRetry=scenario.endsWith('open-error-retry'),closeRecheck=scenario==='review-close-during-recheck';
   const deliver=async(route,options)=>{const response=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/api/v1/admin/rota-rules/phase-one');await route.fulfill(options);await(await response).finished();await page.waitForLoadState('networkidle');await page.evaluate(async()=>{for(let i=0;i<24;i++)await Promise.resolve();});};
   if(openRetry){
    await deliver(held,{status:503,json:{detail:'Recovery GET failed'}});assert.equal(await dialog.locator('.admin-preview__message').innerText(),'Recovery GET failed');assert.equal(await dialog.locator('[data-save]:not([disabled])').count(),0);assert.equal(await field().inputValue(),'My conflict draft');assert.equal(puts.length,1);assert.equal(getCount,2);
    held=null;await dialog.locator('[data-stale-'+action+']').click();for(let i=0;i<100&&!held;i++)await new Promise(r=>setTimeout(r,10));assert.ok(held,'Explicit retry GET genuinely held');assert.equal(getCount,3);
   }
   if(late){
    await page.evaluate(()=>window.__closedConflict=document.querySelector('dialog.rr-dialog'));
    if(action==='reload')await page.keyboard.press('Escape');else await dialog.getByRole('button',{name:'Keep editing',exact:true}).click();
    await dialog.waitFor({state:'detached'});await edit('Newer edit after dismissal');
    await page.evaluate(()=>window.__closedConflictHtml=window.__closedConflict.innerHTML);
   }else if(action==='reload'){expectedLabel=latest.duty_rules[0].label;expectedRevision='rev-2';}else expectedRevision='rev-2';
   const beforeStatus=await page.locator('[data-part=status]').innerText();
   if(closeRecheck)holdValidation=true;
   if(closeRecheck){
    // GET completion deliberately starts a held POST; networkidle cannot be used
    // until that POST has been delivered, so await GET completion explicitly.
    const response=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/api/v1/admin/rota-rules/phase-one');await held.fulfill({json:latest});await(await response).finished();for(let i=0;i<100&&!heldValidation;i++)await new Promise(r=>setTimeout(r,10));assert.ok(heldValidation,'Rebased review validation genuinely held');
    await page.evaluate(()=>window.__closedConflict=document.querySelector('dialog.rr-dialog'));await dialog.getByRole('button',{name:'Keep editing',exact:true}).click();await dialog.waitFor({state:'detached'});await edit('Newer edit after rebased review dismissal');await page.evaluate(()=>window.__closedConflictHtml=window.__closedConflict.innerHTML);const statusAtClose=await page.locator('[data-part=status]').innerText();
    const responseCheck=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/phase-one/check'));await heldValidation.fulfill({json:check});await(await responseCheck).finished();await page.waitForLoadState('networkidle');await page.evaluate(async()=>{for(let i=0;i<24;i++)await Promise.resolve();});
    assert.equal(await field().inputValue(),'Newer edit after rebased review dismissal');assert.equal(await field().evaluate(n=>n===document.activeElement),true);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.evaluate(()=>window.__closedConflict.innerHTML===window.__closedConflictHtml),true,'Parent recovery continuation cannot repaint the closed review');assert.equal(await page.locator('[data-part=status]').innerText(),statusAtClose);
    await page.locator('[data-review]').click();dialog=page.getByRole('dialog',{name:'Review rota rule changes',exact:true});await dialog.locator('[data-save]:not([disabled])').waitFor();assert.deepEqual(checks.at(-1),payload(expectedLabel,'rev-2'));await dialog.locator('[data-save]').click();await dialog.waitFor({state:'detached'});assert.equal(puts.length,2);assert.equal(puts[1].base_revision,'rev-2');assert.equal(await field().inputValue(),expectedLabel);subcases.push({scenario,post_check_parent_continuation_cannot_repaint_closed_review:true,new_draft_focus_and_status_retained:true,exact_put_revisions:['rev-1','rev-2'],forwarded_mutations:0});assert.deepEqual(errors,[]);await page.close();continue;
   }
   await deliver(held,failure?{status:503,json:{detail:'Recovery GET failed'}}:{json:latest});
   if(probe){
    await page.waitForFunction(()=>document.querySelector('[data-duty-row="PAC_DUTY"] [data-text-field=label]')?.value==='Latest server label');
    subcases.push({scenario,defect_reproduced:true,new_draft_clobbered:true,actual_label:await field().inputValue(),exact_put_base_revision:puts[0].base_revision,forwarded_mutations:0});
   }else if(late){
    assert.equal(await field().inputValue(),'Newer edit after dismissal');assert.equal(await field().evaluate(n=>n===document.activeElement),true,'Late response must not steal newer draft focus');
    assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.evaluate(()=>window.__closedConflict.innerHTML===window.__closedConflictHtml),true,'Closed review DOM cannot be rendered by late success/failure');
    assert.equal(await page.locator('[data-part=status]').innerText(),beforeStatus,'No late discarded/rebased/success/error notice');assert.equal(puts.length,1);
    // A new review still saves from the original baseline: stale recovery did not
    // silently replace the revision or the server-owned guard sections.
    await page.locator('[data-review]').click();dialog=page.getByRole('dialog',{name:'Review rota rule changes',exact:true});await dialog.locator('[data-save]:not([disabled])').waitFor();
    assert.deepEqual(checks.at(-1),payload('Newer edit after dismissal','rev-1'));
    await dialog.locator('[data-save]').click();await dialog.locator('[data-stale-reload]').waitFor();assert.equal(puts.length,2);assert.equal(puts[1].base_revision,'rev-1','Dismissed recovery must not silently rebase the later save');await dialog.getByRole('button',{name:'Keep editing',exact:true}).click();
    subcases.push({scenario,draft_focus_status_and_closed_dom_retained:true,original_revision_and_guard_context_retained:true,exact_put_revisions:['rev-1','rev-1'],forwarded_mutations:0});
   }else{
    if(action==='reload'){
     await dialog.waitFor({state:'detached'});assert.equal(await field().inputValue(),'Latest server label');assert.match(await page.locator('[data-part=status]').innerText(),/Loaded the latest rules/);
     await edit('Edit after explicit reload');await page.locator('[data-review]').click();dialog=page.getByRole('dialog',{name:'Review rota rule changes',exact:true});
    }
    await dialog.locator('[data-save]:not([disabled])').waitFor();assert.deepEqual(checks.at(-1),payload(expectedLabel,'rev-2'),'Current recovery incorporates latest server-owned limits');
    await dialog.locator('[data-save]').click();await dialog.waitFor({state:'detached'});assert.equal(puts.length,2);assert.equal(puts[1].base_revision,'rev-2');assert.equal(await field().inputValue(),expectedLabel);
    subcases.push({scenario,explicit_recovery_and_save_succeeded:true,server_limits_preserved:true,...(openRetry?{current_error_visible_until_explicit_recovery_retry:true,exact_recovery_gets:3}:{}),exact_put_revisions:['rev-1','rev-2'],forwarded_mutations:0});
   }
   assert.deepEqual(errors,[]);await page.close();
  }}finally{await context.close();}
  results.push({engine,width,subcases});
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Declared source changed during test');assert.equal(await digest('tests/premium-rules-conflict-lifetime.browser.mjs'),testHash,'Test changed during execution');
await writeFile('../docs/premium-ui/qa-rules-conflict-lifetime'+(probe?'-before':'')+'.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,test_sha256:testHash,probe,scope:'Six browser contexts, nine isolated scenarios each unless probe; actual exported editor, all API locally fulfilled, exact save/check bodies. Covers recovery GET lifetime after native Escape or Keep editing, current error/retry, current reload/rebase and dismissal during rebased validation. No persisted server data, physical-device, native-AT or full-application certification.',results},null,2)+'\n');
console.log('Rules conflict lifetime: '+results.length+' contexts complete');
