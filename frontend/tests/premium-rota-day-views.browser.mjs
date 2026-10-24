import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const baseline=process.env.ROTA_DAY_BASELINE==='1',results=[];
const hashes=async()=>Object.fromEntries(await Promise.all(['main.ts','styles.css','premium-theme.css','shell-accessibility.ts'].map(async n=>['frontend/src/'+n,createHash('sha256').update(await readFile('src/'+n)).digest('hex')]))),initial=await hashes();
const memberName='Dr Alexandria '+ 'LongUnbrokenName'.repeat(8),unitName='Department '+ 'LongUnbrokenUnit'.repeat(6);
const slots=['2026-11-01','2026-11-02'].map((date,i)=>({id:'day-slot-'+i,unit_id:'unit-one',unit_name:unitName,unit_code:'ONE',unit_assignment_label:null,unit_cluster_suffix:null,duty_date:date,duty_type:'MAIN_1ST_24HR',call_level:'1ST_CALL',slot_label:'Main duty',starts_at:date+'T08:00:00',ends_at:date+'T20:00:00',is_24hr:false,max_assignees:1,source:'template',template_status:'ready',is_forced_allocation:false,template_reason:'Fixture ready',assignments:[{id:'assignment-'+i,person_id:'person-one',person_name:memberName,status:'assigned',source:'manual',validation_status:'valid'}],notes:null}));
const candidates=slots.map(slot=>({slot_id:slot.id,duty_date:slot.duty_date,duty_type:slot.duty_type,unit_id:slot.unit_id,unit_name:slot.unit_name,unit_code:'ONE',safety_status:'safe',candidates:Array.from({length:10},(_,i)=>({person_id:'candidate-'+i,person_name:'Dr Candidate '+i,call_level:'1ST_CALL',posting_type:'1ST_CALL',candidate_status:'eligible',rank_score:10-i,score_parts:{},requires_override:false,validation_status:'valid',validation_issues:[],counts:{total_assignments:0,total_24hr:0,weekend_24hr:0,same_group:0,same_campus:0},rest_gap_hours:null,reasons:['Fixture eligible']}))}));
await mkdir('../docs/premium-ui/screenshots/rota-day',{recursive:true});
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of baseline?[320]:[320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',colorScheme:width===320?'dark':'light'}),page=await context.newPage(),errors=[],assignments=[];
  page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','rota-day-fixture');localStorage.setItem('duty_rota_working_month','2026-11');localStorage.setItem('duty_rota_template_overview_mode','calendar');localStorage.setItem('duty_rota_day_modal_view_mode','full');});
  await page.route('**/api/**',async r=>{const q=r.request(),u=new URL(q.url());if(q.method()!=='GET'){assert.equal(q.method(),'POST');assert.equal(u.pathname,'/api/v1/rota-assignments/slots/day-slot-0/assign');assignments.push(q.postDataJSON());return r.fulfill({status:503,json:{detail:'Fixture assignment was not saved'}});}const response=await r.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search});
   if(u.pathname==='/api/v1/rota-template/month'){const data=await response.json();data.slots=slots;Object.assign(data.summary,{total_slots:2,ready_slots:2,needs_review_slots:0,forced_review_slots:0});return r.fulfill({json:data});}
   if(u.pathname==='/api/v1/rota-candidates/month'){const data=await response.json();data.slots=candidates;return r.fulfill({json:data});}
   return r.fulfill({response});
  });
  await page.goto('http://127.0.0.1:5197/#view=rota-template');const opener=page.locator('.rota-calendar-grid [data-rota-day="2026-11-01"]');try{await opener.waitFor();}catch(error){console.log(JSON.stringify({errors,view:await page.locator('#view-root').innerText()}));throw error;}await page.waitForLoadState('networkidle');
  await opener.focus();await page.keyboard.press('Enter');const dialog=page.locator('#rota-day-modal');await dialog.waitFor();
  const bodyOverlay=await dialog.evaluate(e=>e.parentElement===document.body);
  const compact=dialog.getByRole('button',{name:'Compact list',exact:true});await compact.focus();await page.keyboard.press('Enter');
  const selected=await compact.getAttribute('aria-pressed'),modeFocus=await compact.evaluate(e=>e===document.activeElement);
  const row=dialog.locator('.rota-day-compact-row');await row.waitFor();
  const callVisible=await row.locator('small').isVisible(),nameUnclipped=await row.locator('em').evaluate(e=>e.scrollWidth<=e.clientWidth+1);
  if(!baseline){
   assert.equal(bodyOverlay,true,'Day dialog participates in existing shell overlay focus/Escape lifecycle');assert.equal(selected,'true');assert.equal(modeFocus,true);
   assert.equal(callVisible,true);assert.equal(nameUnclipped,true);assert.equal(await row.locator('em').textContent(),memberName);
   assert.equal(await row.locator('span').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);assert.equal(await row.locator('span').textContent(),unitName);
   const sameRoot=await dialog.evaluate(e=>{window.dayRoot=e;return true;});assert.equal(sameRoot,true);
   for(const [mode,target]of [['eagle','.rota-eagle-panel'],['full','.rota-duty-group'],['compact','.rota-day-compact-panel']]){
    const switcher=dialog.locator(`[data-rota-day-view-mode=${mode}]`);await switcher.focus();await page.keyboard.press('Enter');
    assert.equal(await switcher.getAttribute('aria-pressed'),'true');assert.equal(await switcher.evaluate(e=>e===document.activeElement),true);assert.equal(await dialog.locator('[aria-pressed=true]').count(),1);
    if(mode!=='full')await dialog.locator(target).waitFor();else await dialog.locator('.rota-slot-card').first().waitFor();
    if(mode==='full'){
     const assign=dialog.locator('[data-assign-slot="day-slot-0"]');await assign.focus();await page.keyboard.press('Enter');assert.equal(assignments.length,0);await page.getByText('Select a member to assign',{exact:true}).waitFor();
     await dialog.locator('[data-assign-person="day-slot-0"]').selectOption('candidate-2');await dialog.locator('[data-assign-override="day-slot-0"]').fill('Retained explicit reason');await assign.focus();await page.keyboard.press('Enter');await page.getByText('Fixture assignment was not saved',{exact:true}).waitFor();
     assert.equal(assignments.length,1);assert.deepEqual(assignments[0],{person_id:'candidate-2',replace_existing:true,override_reason:'Retained explicit reason'});assert.equal(await dialog.locator('[data-assign-person="day-slot-0"]').inputValue(),'candidate-2');assert.equal(await dialog.locator('[data-assign-override="day-slot-0"]').inputValue(),'Retained explicit reason');assert.equal(await assign.isEnabled(),true);
    }
    assert.equal(await dialog.evaluate(e=>e===window.dayRoot),true,'Mode switches preserve overlay root');
   }
   const axe=await new AxeBuilder({page}).include('#rota-day-modal').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[],JSON.stringify(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({html:n.html,summary:n.failureSummary}))}))));
   if(engine==='chromium'){await row.scrollIntoViewIfNeeded();await page.screenshot({path:'../docs/premium-ui/screenshots/rota-day/compact-'+width+'.png'});}
   const next=dialog.getByRole('button',{name:'Next rota day',exact:true});await next.focus();await page.keyboard.press('Enter');await dialog.locator('[data-rota-day-view-date="2026-11-02"]').first().waitFor();assert.match(await dialog.innerText(),/2026-11-02/);assert.equal(await dialog.getByRole('button',{name:'Next rota day',exact:true}).isDisabled(),true);
   await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await opener.evaluate(e=>e===document.activeElement),true,'Day navigation and mode changes retain original calendar opener');
   assert.equal(await page.locator('#working-month').inputValue(),'2026-11');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  }
  results.push({engine,width,bodyOverlay,selected,modeFocus,callVisible,nameUnclipped,nativeModeSwitchAndDayNavigation:!baseline,originalOpenerEscapeFocus:!baseline,scopedAxeViolations:baseline?null:0,interceptedAssignmentRefusals:assignments.length,noBackendWrites:true,errors});await page.waitForLoadState('networkidle');await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-rota-day-views'+(baseline?'-before':'')+'.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Actual calendar day popup with two populated fixture days, ten cached candidates per slot and long assigned/unit names. Three engines dark320/light1280. GET-only disposable shell; no assignment, candidate eligibility or scheduling certification.',results},null,2)+'\n');console.log(`Rota day views: ${results.length} workflows`);
