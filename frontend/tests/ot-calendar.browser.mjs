import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base='http://127.0.0.1:5187',api='http://127.0.0.1:8037';
const evidence=new URL('../../docs/allocation-progress/',import.meta.url);await mkdir(evidence,{recursive:true});
const report={recorded_at:new Date().toISOString(),workflows:[],viewports:[]};
const browser=await chromium.launch({headless:true});
async function reset(){assert.equal((await fetch(api+'/__fixture/reset',{method:'POST'})).status,200);}
async function open(width=1440,dark=false){
  const context=await browser.newContext({viewport:{width,height:960},colorScheme:dark?'dark':'light'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__ot-calendar',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en" ${dark?'data-theme="dark"':''}><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>OT calendar verification</title><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main style="padding:16px;max-width:1280px;margin:auto" id="host"></main></body></html>`}));
  await page.route('**/api/**',async r=>{const u=new URL(r.request().url());const response=await r.fetch({url:api+u.pathname+u.search});await r.fulfill({response});});
  await page.goto(base+'/__ot-calendar');
  await page.evaluate(async()=>{const api=await import('/src/services/api.ts');api.setAuthToken('isolated-ot-fixture');await(await import('/src/ot-calendar.ts')).renderOtCalendar(document.querySelector('#host'));});
  await page.getByRole('heading',{name:'Unit OT calendars',exact:true}).waitFor();
  await page.getByLabel('Unit',{exact:true}).selectOption({label:'Unit 4'});
  return {page,context,errors};
}
async function addThursday(page){
  await page.getByRole('button',{name:'Thursday',exact:true}).click();
  await page.getByText('Add an area or staffing role',{exact:true}).click();
  const form=page.locator('form[data-ot-form="weekly"]');
  await form.getByLabel('OT area',{exact:true}).fill('main elective');await form.getByLabel('Effective from').fill('2026-11-01');
  await form.getByLabel('Role name').fill('senior');await form.getByLabel('Starts at').fill('08:00');await form.getByLabel('Ends at').fill('16:00');
  await form.getByLabel('3rd call',{exact:true}).check();await form.getByLabel('4th call',{exact:true}).check();
  await form.getByLabel('Mandatory minimum').fill('2');await form.getByLabel('Preferred target').fill('3');
  await form.getByRole('button',{name:'Add role to draft'}).click();
  await page.getByLabel('How does the existing unit minimum relate to OT staffing?').selectOption('included');
}
async function review(page){await page.getByRole('button',{name:'Review changes',exact:true}).click();await page.getByRole('dialog').waitFor();}
async function save(page){const dialog=page.getByRole('dialog');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Save reviewed calendar'}).click();await page.locator('[data-ot-message]').filter({hasText:/saved/}).waitFor();}
try{
  await reset();
  const {page,context,errors}=await open();
  assert.equal(await page.evaluate(async()=>(await import('/src/ot-calendar.ts')).otCalendarHasUnsavedChanges()),false);
  await addThursday(page);
  assert.equal((await(await fetch(api+'/__fixture')).json()).calendars,0);
  await review(page);
  assert.equal((await(await fetch(api+'/__fixture')).json()).calendars,0);
  assert.equal(await page.getByRole('dialog').getByText('minimum 2, target 3',{exact:false}).count(),1);
  await page.getByRole('dialog').getByRole('button',{name:'Save reviewed calendar'}).click();
  assert.equal((await(await fetch(api+'/__fixture')).json()).calendars,0,'unchecked review cannot save');
  await save(page);assert.equal(await page.evaluate(async()=>(await import('/src/ot-calendar.ts')).otCalendarHasUnsavedChanges()),false);
  await page.getByLabel('Date to check').fill('2026-11-19');await page.getByRole('button',{name:'Check saved capacity'}).click();
  await page.getByRole('heading',{name:'OT roles and configured reserves can be covered'}).waitFor();
  assert.ok((await page.locator('[data-ot-capacity]').textContent()).includes('Compatible and available'));
  assert.ok((await page.locator('[data-ot-capacity]').textContent()).includes('Other duties and call pools still require full rota validation'));
  report.workflows.push('Thursday Unit 4 pooled-call staffing drafted, server validated and explicitly saved; preview/unchecked save wrote nothing');
  report.workflows.push('Saved capacity preview jointly checks the dated roster, OT roles and configured pool reserves; other rota constraints remain explicitly scoped');
  await page.getByText('Copy this weekday’s schedules',{exact:true}).click();await page.locator('[data-ot-copy-day]').selectOption('FRI');
  await page.getByRole('button',{name:'Preview copies'}).click();await page.getByRole('button',{name:'Add copies to draft'}).click();
  await page.getByRole('button',{name:'Friday',exact:true}).click();assert.equal(await page.getByText('minimum 2, target 3',{exact:false}).count(),1);
  await page.getByText('Add dated exception',{exact:true}).click();const exception=page.locator('form[data-ot-form="exception"]');
  await exception.getByLabel('OT area',{exact:true}).fill('main elective');await exception.getByLabel('Date',{exact:true}).fill('2026-11-19');await exception.getByRole('button',{name:'Add exception to draft'}).click();
  await page.getByText('Add dated exception',{exact:true}).click();
  await exception.getByLabel('OT area',{exact:true}).fill('main elective');await exception.getByLabel('Date',{exact:true}).fill('2026-11-20');
  await exception.getByLabel('Action',{exact:true}).selectOption('replace');
  await exception.getByLabel('Role name').fill('junior');await exception.getByLabel('Starts at').fill('08:00');await exception.getByLabel('Ends at').fill('16:00');
  await exception.getByLabel('1st call',{exact:true}).check();await exception.getByLabel('Mandatory minimum').fill('1');await exception.getByLabel('Preferred target').fill('1');
  await exception.getByRole('button',{name:'Add exception to draft'}).click();
  await page.getByRole('button',{name:'Add replacement role',exact:true}).click();
  await exception.getByLabel('Role name').fill('senior');await exception.getByLabel('Starts at').fill('08:00');await exception.getByLabel('Ends at').fill('16:00');
  await exception.getByLabel('3rd call',{exact:true}).check();await exception.getByLabel('Mandatory minimum').fill('1');await exception.getByLabel('Preferred target').fill('2');
  await exception.getByRole('button',{name:'Add role to dated exception',exact:true}).click();
  await review(page);await save(page);report.workflows.push('Weekday copy stays a draft until save; dated closure added with review');
  report.workflows.push('Dated replacement staffing supports multiple independently editable call-level roles');
  await page.getByRole('button',{name:'Load saved history'}).click();await page.getByRole('button',{name:'Inspect saved version'}).first().waitFor();
  await page.getByRole('button',{name:'Inspect saved version'}).first().click();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  report.workflows.push('Attributable saved history inspected');
  // A concurrent administrator save must not overwrite this local draft.
  await page.getByLabel('How does the existing unit minimum relate to OT staffing?').selectOption('additional');
  const units=await(await fetch(api+'/api/v1/units')).json(),unit=units.find(u=>u.name==='Unit 4');
  const latest=await(await fetch(api+`/api/v1/admin/ot-calendars/${unit.id}`)).json();
  latest.configuration.weekly[0].bands[0].target=4;
  const put=await fetch(api+`/api/v1/admin/ot-calendars/${unit.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({base_revision:latest.revision,configuration:latest.configuration,note:'Concurrent review'})});assert.equal(put.status,200);
  await page.getByRole('button',{name:'Review changes',exact:true}).click();await page.getByRole('heading',{name:'Saved calendar changed'}).waitFor();
  assert.equal(await page.getByLabel('How does the existing unit minimum relate to OT staffing?').inputValue(),'additional');
  await page.getByRole('button',{name:'Read latest saved version'}).click();await page.locator('[data-ot-message]').filter({hasText:'Latest saved calendar loaded'}).waitFor();
  await page.getByRole('button',{name:'Review replacing latest with my draft'}).click();
  const conflictDialog=page.getByRole('dialog');await conflictDialog.waitFor();assert.equal(await conflictDialog.getByText('target 4',{exact:false}).count(),1);
  await conflictDialog.getByRole('button',{name:'Keep editing'}).click();
  report.workflows.push('Concurrent saved edit refused; local draft preserved; replacement requires another side-by-side review');
  // A dropped PUT response may still commit. Check the durable record, never replay.
  await page.evaluate(async()=>(await import('/src/ot-calendar.ts')).disposeOtCalendarPage());
  await page.reload();
  await page.evaluate(async()=>{await(await import('/src/ot-calendar.ts')).renderOtCalendar(document.querySelector('#host'));});
  await page.getByLabel('Unit',{exact:true}).selectOption({label:'Unit 4'});
  await page.getByLabel('How does the existing unit minimum relate to OT staffing?').selectOption('additional');
  let putCount=0;
  await page.route(`**/api/v1/admin/ot-calendars/${unit.id}`,async route=>{
    if(route.request().method()==='PUT'){putCount++;const u=new URL(route.request().url());await route.fetch({url:api+u.pathname});await route.abort('failed');}else await route.fallback();
  });
  await review(page);await save(page);assert.equal(putCount,1);await page.locator('[data-ot-message]').filter({hasText:'saved record confirms'}).waitFor();
  report.workflows.push('Committed save with lost response confirmed by readback; exactly one PUT');
  assert.deepEqual(errors,[]);await context.close();
  {
    const {page,context,errors}=await open();
    await page.getByLabel('How does the existing unit minimum relate to OT staffing?').selectOption('included');
    let releasePreview,previewStarted;
    const started=new Promise(resolve=>previewStarted=resolve),gate=new Promise(resolve=>releasePreview=resolve);
    await page.route('**/preview',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:api+u.pathname});previewStarted();await gate;await route.fulfill({response});});
    await page.getByRole('button',{name:'Review changes',exact:true}).click();await started;
    await page.getByLabel('How does the existing unit minimum relate to OT staffing?').selectOption('additional');
    releasePreview();await page.locator('[data-ot-message]').filter({hasText:'draft changed while validation was running'}).waitFor();
    assert.equal(await page.getByRole('dialog').count(),0);
    await page.unroute('**/preview');
    await page.getByLabel('How does the existing unit minimum relate to OT staffing?').selectOption('included');
    let releasePut,putStarted;const putGate=new Promise(resolve=>releasePut=resolve),putReady=new Promise(resolve=>putStarted=resolve);
    await page.route(`**/api/v1/admin/ot-calendars/${unit.id}`,async route=>{if(route.request().method()==='PUT'){putStarted();await putGate;await route.fallback();}else await route.fallback();});
    await review(page);await page.getByRole('dialog').getByRole('checkbox').check();await page.getByRole('dialog').getByRole('button',{name:'Save reviewed calendar'}).click();await putReady;
    await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').isVisible(),true);
    assert.equal(await page.evaluate(async()=>(await import('/src/ot-calendar.ts')).otCalendarIsSaving()),true);
    releasePut();await page.locator('[data-ot-message]').filter({hasText:'Reviewed OT calendar saved'}).waitFor();
    assert.deepEqual(errors,[]);await page.unrouteAll({behavior:'ignoreErrors'});await context.close();
    report.workflows.push('Editing during delayed validation invalidates the preview; Escape cannot dismiss an in-flight save');
  }
  {
    const {page,context}=await open();await page.getByLabel('How does the existing unit minimum relate to OT staffing?').selectOption('additional');
    let failReads=false,putCount=0;
    await page.route(`**/api/v1/admin/ot-calendars/${unit.id}`,async route=>{
      if(route.request().method()==='PUT'){putCount++;failReads=true;await route.abort('failed');}
      else if(failReads)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Test readback unavailable'})});
      else await route.fallback();
    });
    await review(page);await page.getByRole('dialog').getByRole('checkbox').check();await page.getByRole('dialog').getByRole('button',{name:'Save reviewed calendar'}).click();
    await page.locator('[data-ot-message]').filter({hasText:'Save outcome not confirmed'}).waitFor();
    await page.getByRole('button',{name:'Review changes',exact:true}).click();await page.locator('[data-ot-message]').filter({hasText:'previous save outcome is still uncertain'}).waitFor();
    assert.equal(putCount,1);failReads=false;
    await page.getByRole('button',{name:'Read latest saved version'}).click();await page.locator('[data-ot-message]').filter({hasText:'Latest saved calendar loaded'}).waitFor();
    await review(page);await page.getByRole('dialog').getByRole('button',{name:'Keep editing'}).click();
    await page.unrouteAll({behavior:'ignoreErrors'});await context.close();
    report.workflows.push('Uncertain save plus failed readback blocks another save until explicit durable read succeeds');
  }
  {
    const create=await fetch(api+'/api/v1/admin/call-clusters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Reviewed Paediatric OT',call_level:'3RD_CALL',active:true})});
    assert.equal(create.status,200);const group=await create.json();
    const peopleResponse=await fetch(api+'/api/v1/admin/members');assert.equal(peopleResponse.status,200);const people=await peopleResponse.json();
    const membership=await fetch(api+`/api/v1/admin/call-clusters/${group.id}/members`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({members:people.map(person=>({person_id:person.id,effective_from:'2026-11-01'}))})});
    assert.equal(membership.status,200);
    const {page,context}=await open();await page.getByRole('button',{name:'Thursday',exact:true}).click();
    await page.getByRole('button',{name:'Edit role',exact:true}).click();
    const form=page.locator('form[data-ot-form="weekly"]');await form.getByLabel('Required skill codes (optional)').fill('paediatric');await form.getByRole('button',{name:'Update draft role'}).click();
    await page.getByRole('button',{name:'Load qualification source groups'}).click();
    const binding=page.locator(`input[data-ot-skill="paediatric"][data-ot-group="${group.key}"]`);await binding.check();
    await review(page);assert.equal(await page.getByRole('dialog').getByRole('heading',{name:'Reviewed qualification bindings'}).count(),1);await save(page);
    await page.getByLabel('Date to check').fill('2026-11-26');await page.getByRole('button',{name:'Check saved capacity'}).click();
    await page.getByRole('heading',{name:'OT roles and configured reserves can be covered'}).waitFor();
    assert.ok((await page.locator('[data-ot-capacity]').textContent()).includes('Configured pool reserves'));
    report.workflows.push('Administrator explicitly binds an OT skill to a canonical group and saves reviewed mapping; actual dated membership and joint reserves determine coverage');
    await page.unrouteAll({behavior:'ignoreErrors'});await context.close();
  }
  for(const width of [1440,390,320])for(const dark of [false,true]){
    const {page,context,errors}=await open(width,dark);await page.getByRole('button',{name:'Thursday',exact:true}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const axe=await new AxeBuilder({page}).include('#host').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.length})),[]);
    await page.screenshot({path:fileURLToPath(new URL(`ot-calendar-${width}-${dark?'dark':'light'}.png`,evidence)),fullPage:true});
    assert.deepEqual(errors,[]);report.viewports.push({width,dark,noOverflow:true,accessibilityViolations:0});await context.close();
  }
  {
    const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage();
    await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','isolated-ot-fixture'));
    await page.route('**/api/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:api+u.pathname+u.search});await route.fulfill({response});});
    await page.goto(base+'/#view=ot-calendars');
    await page.getByRole('heading',{name:'Unit OT calendars',exact:true}).waitFor();
    await page.getByLabel('How does the existing unit minimum relate to OT staffing?').selectOption('additional');
    page.once('dialog',dialog=>dialog.dismiss());
    await page.locator('[data-view="overview"]:visible').first().click();
    assert.equal(new URL(page.url()).hash,'#view=ot-calendars');
    assert.equal(await page.getByLabel('How does the existing unit minimum relate to OT staffing?').inputValue(),'additional');
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('[data-view="overview"]:visible').first().click();
    await page.waitForURL('**/#view=overview');
    report.workflows.push('Actual application deep link and Admin Tools navigation preserve dirty OT drafts when leaving is declined');
    await page.unrouteAll({behavior:'ignoreErrors'});
    await context.close();
  }
  await writeFile(new URL('ot-calendar-browser.json',evidence),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
