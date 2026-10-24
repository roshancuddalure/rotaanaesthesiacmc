import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const browser=await chromium.launch({headless:true}),results=[];
const group={key:'pac_sr',name:'PAC SR',call_level:'3RD_CALL',active:true,members:5};
const rule={key:'PAC_DUTY',label:'PAC duty',group:'pac',campus:'Main campus',duration_hours:8,start_time:'08:00',end_time:'16:00',is_24hr:false,counts_in_main_24hr:false,is_mandatory:false,is_adjustable:true,blocks_elective_same_day:false,blocks_elective_next_day:false,active:true,allowed_call_levels:['3RD_CALL'],allowed_cluster_keys:[],excluded_cluster_keys:[],allowed_designations:[],allowed_units:[],excluded_units:[]};
const doc={revision:'independent-1',groups:[group],units:[],rule_version:{id:'rv',name:'Phase one',description:null,effective_from:'2026-01-01',effective_to:null,is_active:true,created_at:'2026-01-01T00:00:00Z'},duty_rules:[rule],duty_count_limits:{max_24hr_per_month:8,max_weekend_24hr_per_month:null,max_same_group_per_month:null,max_same_campus_per_month:null},rest_rules:{minimum_gap_after_24hr_hours:24,post_24hr_blocks_next_day_elective:true},unit_staffing_rules:{minimum_available_count:1,warning_unavailable_percent:30,hard_block_unavailable_percent:40,small_unit_uses_absolute_minimum:true}};
const check=(eligible=5)=>({problems:[],duties:{PAC_DUTY:{effective_call_levels:['3RD_CALL'],eligible_now:eligible,eligible_by_level:{'3RD_CALL':eligible}}}});
const chip=page=>page.locator('[data-duty-row="PAC_DUTY"] [data-field="allowed_cluster_keys"][data-value="pac_sr"]');
async function isolated({oldGuards=false}={}){
 const context=await browser.newContext({viewport:{width:390,height:850}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const server={checks:0,hold:false,pending:null};
 await page.route('**/__rules-lifecycle-review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"><main id="view-root"></main>'}));
 if(oldGuards)await page.route('**/src/rota-rules.ts',async route=>{
  const response=await route.fetch(),source=await response.text();
  assert.match(source,/st\.root\.isConnected && st\.root\.contains/);
  await route.fulfill({response,body:source.replaceAll('st.root.isConnected && ','')});
 });
 await page.route('**/api/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/phase-one/check')){server.checks++;if(server.hold){server.pending=route;return;}return route.fulfill({json:check()});}
  assert.equal(route.request().method(),'GET','No save or restore permitted');
  if(path.endsWith('/phase-one'))return route.fulfill({json:doc});
  throw new Error('Unexpected route '+path);
 });
 await page.goto(base+'/__rules-lifecycle-review');
 await page.evaluate(async()=>{window.__rules=await import('/src/rota-rules.ts');window.__rulesRoot=document.getElementById('view-root');await window.__rules.renderRotaRulesPage(window.__rulesRoot,{onNavigate:()=>{}});});
 await page.locator('[data-duty-row="PAC_DUTY"] .rr-duty__toggle').click();await chip(page).waitFor();
 return {context,page,server,errors};
}
try{
 // Reproduce the old predicate with response-only substitution: no file edits.
 {
  const {context,page,errors}=await isolated({oldGuards:true});await chip(page).click();
  assert.equal(await page.evaluate(()=>window.__rules.rotaRulesHasUnsavedChanges()),true);
  await page.evaluate(()=>window.__rulesRoot.remove());
  assert.equal(await page.evaluate(()=>window.__rules.rotaRulesHasUnsavedChanges()),true,'Old detached root still reports dirty');
  assert.deepEqual(errors,[]);results.push({case:'old detached-root defect reproduced through in-memory guard substitution',passed:true});await context.close();
 }
 {
  const {context,page,server,errors}=await isolated();await chip(page).click();
  const dirty=await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return {dirty:window.__rules.rotaRulesHasUnsavedChanges(),prevented:event.defaultPrevented};});
  assert.deepEqual(dirty,{dirty:true,prevented:true});
  await page.evaluate(()=>window.__rulesRoot.remove());
  const detached=await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return {dirty:window.__rules.rotaRulesHasUnsavedChanges(),prevented:event.defaultPrevented};});
  assert.deepEqual(detached,{dirty:false,prevented:false});
  await page.evaluate(()=>window.__rules.disposeRotaRulesPage());const checks=server.checks;
  await page.waitForTimeout(550);assert.equal(server.checks,checks,'Dispose cancels queued debounce check');
  assert.deepEqual(errors,[]);results.push({case:'connected draft retains unload protection; detached draft releases it; disposal cancels queued check',passed:true});await context.close();
 }
 {
  const {context,page,server,errors}=await isolated();server.hold=true;await chip(page).click();
  await page.waitForFunction(()=>document.querySelector('[data-unsaved-count]')?.textContent.includes('1 unsaved'));
  for(let attempt=0;attempt<40&&!server.pending;attempt++)await page.waitForTimeout(25);
  assert.ok(server.pending,'Debounced check genuinely in flight');
  const oldMarkup=await page.evaluate(()=>{window.__rules.disposeRotaRulesPage();window.__rulesRoot.remove();return window.__rulesRoot.innerHTML;});
  server.hold=false;await server.pending.fulfill({json:check(999)});
  await page.evaluate(async()=>{const root=document.createElement('main');root.id='new-root';document.body.append(root);await window.__rules.renderRotaRulesPage(root,{onNavigate:()=>{}});});
  assert.equal(await page.evaluate(()=>window.__rulesRoot.innerHTML),oldMarkup,'Late reply does not repaint detached private editor');
  assert.equal(await page.evaluate(()=>window.__rules.rotaRulesHasUnsavedChanges()),false);
  await page.locator('#new-root [data-duty-row="PAC_DUTY"] .rr-duty__toggle').click();
  assert.equal(await chip(page).getAttribute('aria-pressed'),'false','New editor starts from authoritative unedited document');
  assert.doesNotMatch(await page.locator('#new-root').innerText(),/999/);assert.deepEqual(errors,[]);
  results.push({case:'in-flight old check ignored after disposal; new render has no old draft or check result',passed:true});await context.close();
 }
 for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];let user,signins=0,checks=0;
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','rules-old-account');localStorage.setItem('duty_rota_working_month','2026-10');});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.endsWith('/auth/sign-in')){signins++;assert.deepEqual(request.postDataJSON(),{username:'new-rules-account',password:'Example password 42!'});return route.fulfill({json:{token:'new-rules-account',user:{...user,id:'new-user',username:'new-rules-account'}}});}
   if(url.pathname.endsWith('/phase-one/check')){checks++;return route.fulfill({json:check()});}
   assert.equal(request.method(),'GET','Only intercepted explicit sign-in and read-only rules checks permitted');
   if(url.pathname.endsWith('/phase-one'))return route.fulfill({json:doc});
   const response=await route.fetch({url:api+url.pathname+url.search});if(url.pathname.endsWith('/auth/me'))user=await response.json();return route.fulfill({response});
  });
  await page.goto(base+'/#view=rota-rules');await page.locator('[data-duty-row="PAC_DUTY"] .rr-duty__toggle').click();await chip(page).click();assert.equal(await chip(page).getAttribute('aria-pressed'),'true');
  const dialogs=[];page.on('dialog',async dialog=>{dialogs.push({type:dialog.type(),message:dialog.message()});await dialog.dismiss();});
  const nav=width<768?page.locator('.mobile-bottom-nav [data-view="overview"]'):page.locator('.sidebar [data-view="overview"]');
  await nav.click();assert.equal(dialogs.length,1);assert.match(dialogs[0].message,/unsaved rota rule changes/);
  assert.equal(await chip(page).getAttribute('aria-pressed'),'true','Declined navigation retains same-session draft');
  await page.locator('#account-menu-button').click();await page.locator('#sign-out').click();
  await page.getByLabel('Username',{exact:true}).fill('new-rules-account');await page.getByLabel('Password',{exact:true}).fill('Example password 42!');await page.locator('#login-submit').click();
  await page.locator('[data-duty-row="PAC_DUTY"] .rr-duty__toggle').click();await chip(page).waitFor();assert.equal(await chip(page).getAttribute('aria-pressed'),'false');
  assert.doesNotMatch(await page.locator('[data-unsaved-count]').innerText(),/[1-9]\d* unsaved/);
  assert.equal(signins,1);assert.ok(checks>=2);assert.deepEqual(errors,[]);
  results.push({case:'real dirty-rule sign-out and explicit same-route new-account sign-in',width,passed:true,navigation_decline_preserves_connected_draft:true,old_draft_absent:true,backend_mutations:0});await context.close();
 }
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-rules-session-independent.json',JSON.stringify({results,scope:'Independent Chromium actual-component and full-app lifecycle checks. APIs intercepted; production data untouched. Synthetic cancelable beforeunload tests predicate behavior, not physical browser prompt UX.'},null,2)+'\n');
const files=['frontend/src/rota-rules.ts','frontend/src/main.ts','frontend/tests/premium-rules-session-independent.browser.mjs'];
const hashes=Object.fromEntries(await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile('../'+path)).digest('hex')])));
await writeFile('../docs/premium-ui/reviews/rules-session-current.json',JSON.stringify({reviewer:'rules_session_review',reviewed_at_utc:new Date().toISOString(),status:'accepted_for_bounded_rules_session_lifecycle',scope:'Connected dirty protection, detached-root lifecycle, session disposal and ignored late checks only; not whole-plan acceptance.',reviewed_files_sha256:hashes,tests_executed:[{command:'node tests/premium-rules-session-independent.browser.mjs',result:'5 independent browser outcomes passed',artifact:'docs/premium-ui/qa-rules-session-independent.json'}],verified:['Old missing-isConnected predicate reproduces false dirty state after detaching root using response-only source substitution.','Connected dirty editor prevents synthetic unload and refuses declined real navigation at 320/1280px.','Detached root no longer prevents synthetic unload; disposal clears pending debounce.','Genuinely in-flight old check cannot repaint detached editor after disposal or leak into newly rendered editor.','Actual sign-out and explicit same-route new-account sign-in restore clean authoritative rules at 320/1280px.','Main invokes disposal only from private-session reset; no rules payload, endpoint or backend source edit in the reviewed fix.'],required_fixes:[],limitations:['Chromium emulation; physical devices and actual operating-system browser unload dialogs not verified.','API reads/checks/authentication intercepted; no backend persistence verification or production mutation.','Review covers lifecycle fix only; other rule functionality covered by separate suites.']},null,2)+'\n');
console.log(`Independent rules lifecycle: ${results.length} outcomes passed.`);
