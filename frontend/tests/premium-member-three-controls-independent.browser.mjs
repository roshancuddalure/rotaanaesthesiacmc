import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base='http://127.0.0.1:5197',api='http://127.0.0.1:8031';
const before=createHash('sha256').update(await readFile('src/main.ts')).digest('hex'),results=[];
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],months=['2026-10'];
const people=Array.from({length:31},(_,i)=>({person_id:'context-person-'+i,name:'Context Person '+String(i).padStart(2,'0'),total_24hr:i+1,total_weekend_24hr:1,total_weekday_24hr:i,main_24hr:i,cb_24hr:0,rc_24hr:0,schell:0,floating:0,fifth_call:0,fifth_call_weekend:0,caesar_b:0,cart:0,caesar_a:0,pac:0,shift:0,main_shift:0,rc_shift:0,pb_shift:0,rc12hr:0,cb_co12hr:0,chad:0,ruhsa:0,neuro_dept:0,day_breakdown:{Monday:i+1},monthly_24hr:{'2026-10':i+1},fifth_call_monthly:{},fifth_call_days:{},pain_months:[],sicu_months:[],drp_months:[],neuro_icu_months:[],call_levels:{},units:{},promotions:[],months_active:months}));
const dashboard={summary:{personnel:31,active_personnel:31,total_records:496,total_24hr:496,total_weekend_24hr:31,weekend_percent:6,months:1,avg_24hr_per_active_person:16},months,month_labels:{'2026-10':'October 2026'},month_stats:{'2026-10':{total:496,total_24hr:496,weekend_24hr:31,persons:31,duty_type_counts:{}}},days,duty_category_totals:{MAIN:496},people};
const units=['Alpha','Beta','Gamma'].map((name,i)=>({id:'context-unit-'+i,name:name+' Context Unit',campus:'Main',code:name.toUpperCase(),minimum_free_people:1,active_status:'active',notes:null}));
const unitData={month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units,assignments:[],unit_summaries:units.map(u=>({unit_id:u.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]};
units.forEach((u,i)=>u.minimum_free_people=i+1);
unitData.assignments=units.map((unit,i)=>({id:'context-posting-'+i,person:{id:'context-posted-'+i,canonical_name:'Posted '+unit.name,call_level:'2ND_CALL',active_status:'active'},unit,posting_type:'2ND_CALL',starts_on:'2026-10-01',ends_on:'2026-10-31',source:'manual',notes:'Unit-specific row '+i}));
unitData.unit_summaries.forEach((s,i)=>{s.assigned_members=i+1;s.people_with_leave=i;s.leave_days=i*2;});
const sourcePaths=['src/main.ts','src/member-workspace.ts','src/reference-workspace.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')]))),start=await hashes();
const findings=[];
for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of [320,1280]){
  console.log('Three member controls',engine,width);
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],requests=[],copied=[];let readonly=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','member-three-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.exposeFunction('captureCopiedId',text=>copied.push(text));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(req.method(),'GET','Member control tests never mutate fixture');requests.push(url.pathname);
   if(url.pathname.endsWith('/auth/me')&&readonly){const response=await (await fetch(api+url.pathname)).json();return route.fulfill({json:{...response,role:'rota_board_member',role_label:'Rota board member',permissions:[]}});}
   if(url.pathname.endsWith('/analysis/dashboard'))return route.fulfill({json:dashboard});
   if(url.pathname.includes('/admin/member-workspace/context-person-30')){
    if(url.pathname.endsWith('/duties'))return route.fulfill({json:{rows:['2026-09-30','2026-10-01','2026-10-15','2026-10-31','2026-11-01'].map((date,i)=>({id:'duty-'+i,date,label:'Dated duty '+date,status:'published'})),months:['2026-10'],analysis:{total_24hr:3}}});
    if(url.pathname.endsWith('/roles'))return route.fulfill({json:{rows:[]}});
    return route.fulfill({json:{member:{id:'context-person-30',canonical_name:'Context Person 30',active_status:'active',call_level:'2ND_CALL',revision:'one',aliases:[],designations:[],call_level_changes:[]},impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
   }
   if(url.pathname.includes('/normalization/catalog/')){assert.ok(url.pathname.endsWith('/designation'),'Canonical management must open designation catalog');return route.fulfill({json:[{key:'REGISTRAR',label:'Registrar',aliases:[],active:true,version:1,behavior:{},usage:{records:0}}]});}
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  async function open(){await page.goto(base+'/#view=analysis');await page.locator('[data-analysis-tab=personnel]').click();await page.locator('[data-analysis-person="Context Person 30"]').filter({visible:true}).first().click();await page.locator('dialog.member-workspace [role=tab][aria-selected=true][data-tab=duties]').waitFor();}
  await open();const dialog=page.locator('dialog.member-workspace');
  const shown=()=>dialog.locator('.mw-history').allTextContents();
  const date=async(selector,value)=>{await dialog.locator(selector).fill(value);await page.keyboard.press('Tab');};
  assert.equal((await shown()).length,5);
  await date('[data-duty-from]','2026-10-01');await date('[data-duty-until]','2026-10-31');
  assert.deepEqual((await shown()).map(t=>t.match(/Dated duty (\d{4}-\d{2}-\d{2})/)[1]),['2026-10-01','2026-10-15','2026-10-31']);
  await date('[data-duty-from]','2026-11-01');await dialog.getByText('No duty history records in this range.',{exact:true}).waitFor();
  await date('[data-duty-from]','');await date('[data-duty-until]','');assert.equal((await shown()).length,5);
  assert.equal(requests.filter(p=>p.endsWith('/context-person-30/duties')).length,1,'Date filtering uses loaded member history');
  await dialog.getByRole('tab',{name:'Details',exact:true}).click();
  for(const mode of ['available','denied','unsupported']){
   await page.evaluate(mode=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:mode==='unsupported'?undefined:{writeText:async text=>{if(mode==='denied')throw new DOMException('Fixture denied','NotAllowedError');await window.captureCopiedId(text);}}}),mode);
   const copy=dialog.locator('[data-copy-member-id]');await copy.focus();await page.keyboard.press('Enter');
   if(mode==='available'){await copy.filter({hasText:'Member ID copied'}).waitFor();assert.deepEqual(copied,['context-person-30']);}
   else{
    const selected=await dialog.locator('[data-member-id]').evaluate(el=>({focused:el===document.activeElement,selection:el.value.slice(el.selectionStart,el.selectionEnd)}));
    assert.equal(selected.selection,'context-person-30');assert.equal(selected.focused,true);
    const status=dialog.locator('[data-copy-member-status]');
    await status.filter({hasText:'Automatic copy was not confirmed.'}).waitFor();
    assert.match(await status.innerText(),/Member ID selected; copy it using your keyboard or selection menu/);
    assert.equal(await status.getAttribute('aria-live'),'polite');assert.equal(await status.getAttribute('aria-atomic'),'true');
    assert.equal(await copy.innerText(),'Copy member ID');assert.equal(await copy.isEnabled(),true);
    findings.push({engine,width,mode,copy_manual_selection_and_focus:true,explicit_failure_feedback:true,stale_success_removed:true});
   }
  }
  await dialog.getByRole('tab',{name:'Roles & eligibility',exact:true}).click();
  const manage=dialog.locator('[data-manage-profile-references]');await manage.focus();await page.keyboard.press('Enter');
  const catalog=page.locator('dialog.reference-workspace');await catalog.locator('[data-kind]').waitFor();assert.equal(await catalog.locator('[data-kind]').inputValue(),'designation');
  await catalog.getByRole('button',{name:'Close reference management',exact:true}).click();await catalog.waitFor({state:'detached'});
  assert.equal(await manage.evaluate(el=>el===document.activeElement),true);
  assert.equal(await dialog.locator('[role=tab][aria-selected=true]').getAttribute('data-tab'),'roles');
  assert.equal(await page.locator('#working-month').inputValue(),'2026-10');
  await dialog.getByRole('tab',{name:'Details',exact:true}).click();
  async function holdCopy(){
   await page.evaluate(()=>{
    window.heldCopyCalls=0;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>{window.heldCopyCalls++;return new Promise((resolve,reject)=>{window.resolveCopy=resolve;window.rejectCopy=()=>reject(new DOMException('Fixture delayed refusal','NotAllowedError'));});}}});
   });
   await dialog.locator('[data-copy-member-id]').click();
   assert.equal(await dialog.locator('[data-copy-member-id]').isDisabled(),true);
   assert.equal(await dialog.locator('[data-copy-member-id]').getAttribute('aria-busy'),'true');
  }
  // Real first pointer activation; a subsequent keyboard attempt and explicitly synthetic click cannot duplicate it.
  await holdCopy();await page.keyboard.press('Enter');
  await dialog.locator('[data-copy-member-id]').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  assert.equal(await page.evaluate(()=>window.heldCopyCalls),1,'Pending synthetic duplicate ignored');
  const name=dialog.locator('[data-field=canonical_name]');await name.focus();await page.evaluate(()=>window.rejectCopy());
  await dialog.locator('[data-copy-member-status]').filter({hasText:'Select the member ID above and copy it manually.'}).waitFor();
  assert.equal(await name.evaluate(el=>el===document.activeElement),true,'Late refusal cannot steal user-moved focus');
  // Replaced details controls must not receive a stale clipboard outcome.
  await holdCopy();await dialog.getByRole('tab',{name:'Roles & eligibility',exact:true}).click();await page.evaluate(()=>window.resolveCopy());
  await dialog.getByRole('tab',{name:'Details',exact:true}).click();
  assert.equal(await dialog.locator('[data-copy-member-status]').innerText(),'');assert.equal(await dialog.locator('[data-copy-member-id]').innerText(),'Copy member ID');
  await holdCopy();await dialog.locator('[data-close]').first().click();await dialog.waitFor({state:'detached'});
  await page.locator('[data-analysis-person="Context Person 30"]').filter({visible:true}).first().click();await dialog.getByRole('tab',{name:'Details',exact:true}).click();await page.evaluate(()=>window.rejectCopy());
  assert.equal(await dialog.locator('[data-copy-member-status]').innerText(),'');assert.equal(await dialog.locator('[data-copy-member-id]').innerText(),'Copy member ID');
  // The fixed clipboard deadline recovers a hung capability without guessing whether the OS copied anything.
  await page.clock.install();await holdCopy();await page.clock.fastForward(8100);
  await dialog.locator('[data-copy-member-status]').filter({hasText:'Automatic copy was not confirmed.'}).waitFor();
  assert.equal(await dialog.locator('[data-copy-member-id]').isEnabled(),true);assert.equal(await dialog.locator('[data-copy-member-id]').getAttribute('aria-busy'),null);
  await page.evaluate(()=>window.resolveCopy());assert.equal(await dialog.locator('[data-copy-member-id]').innerText(),'Copy member ID','Late completion after timeout cannot falsely show copied');
  await page.clock.resume();
  await dialog.locator('[data-close]').first().click();await dialog.waitFor({state:'detached'});
  readonly=true;await page.reload();await page.waitForLoadState('networkidle');await open();await dialog.getByRole('tab',{name:'Roles & eligibility',exact:true}).click();assert.equal(await dialog.locator('[data-manage-profile-references]').count(),0);
  assert.deepEqual(errors,[]);results.push({engine,width,copy_exact_value:true,denied_absent_manual_selection_focus:true,explicit_failure_feedback_and_no_stale_success:true,pending_real_keyboard_and_synthetic_duplicate_guard:true,newer_focus_preserved:true,tab_replacement_late_ignored:true,closed_reopened_late_ignored:true,clipboard_deadline_recovery:true,date_inclusive_boundaries_reset_local_query:true,designation_correct_kind_and_close_focus:true,admin_role_visibility:true,member_month_retained:true,backend_writes:0});await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),start);
await writeFile('../docs/premium-ui/qa-member-three-controls-independent.json',JSON.stringify({source_sha256:start,results,findings,scope:'Three current canonical member controls actual app analytics entry,3engines320/1280; clipboard mocked,allGET intercepted/fixture only. Explicit failure feedback asserted. Held capability/pointer/keyboard plus explicitly synthetic duplicate and Playwright-clock8sdeadline outcomes bounded; no OS clipboard/native screen-reader/device certification.',baseline_findings:'docs/premium-ui/qa-member-three-controls-before-copy-feedback.json'},null,2)+'\n');
console.log('Three member controls:6 strengthened workflows passed');
