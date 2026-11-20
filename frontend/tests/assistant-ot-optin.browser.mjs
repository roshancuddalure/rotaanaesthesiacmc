import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base='http://127.0.0.1:5188',units=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'];
const browser=await chromium.launch({headless:true}),report=[];
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  await context.grantPermissions(['local-network-access'],{origin:base});
  let revision='c',writes=0,models=0,reads=0,wrong=false,denied=false,changeDuringModel=false,budget=false,delay=0;
  const sent=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const content=(unit,day)=>({unit_id:unit,day,calendar_status:'configured',demand_known:true,reserve_mode:'included',closed_area_count:0,missing_area_count:0,bands:[{band_index:0,starts_at:day+'T08:00:00',ends_at:day+'T16:00:00',call_levels:['3RD_CALL','4TH_CALL'],minimum:2,target:3,required_skill_count:0}]});
  const reference=(ot=false,unit=units[0],day='2026-05-01')=>({source_contract:ot?2:1,month:'2026-05',snapshot_generated_at:'2026-11-20T00:00:00Z',constraints:{},examples:[],sources:[{source:'current_rule_constraints',content_version:'a'.repeat(64)},{source:'approved_teaching_features',content_version:'b'.repeat(64)},...(ot?[{source:'selected_unit_ot_demand',content_version:revision.repeat(64)}]:[])],...(ot?{ot_demand:{content:content(wrong?(unit===units[0]?units[1]:units[0]):unit,day),calendar_revision:revision.repeat(64)}}:{})});
  await page.route('**/__ot-optin',r=>r.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body></body></html>'}));
  await page.route('**/api/**',async r=>{
   const url=new URL(r.request().url()),path=url.pathname;
   if(r.request().method()!=='GET')writes++;
   let json=[];
   if(path.endsWith('/setup'))json={slots:[],people:[],rules:{},history_lookback:3,history_months:[],holiday_dates:[]};
   else if(path.endsWith('/units'))json=units.map((id,i)=>({id,code:'UNIT_'+(i+1),name:'Unit '+(i+1)}));
   else if(path.endsWith('/assistant-reference'))json={reference_contract:'ot-demand-v1',content:content(path.includes(units[1])?units[1]:units[0],url.searchParams.get('day')),source:{kind:'resolved_unit_ot_calendar',calendar_revision:revision.repeat(64),content_version:revision.repeat(64)},retrieved_at:'2026-11-20T00:00:00Z'};
   else if(path.includes('/assistant-context')){
    reads++;
    if(denied)return r.fulfill({status:403,json:{detail:'OT reference permission changed'}});
    json=reference(path.endsWith('/ot'),url.searchParams.get('unit_id'),url.searchParams.get('day'));
   }
   await r.fulfill({json});
  });
  await page.route('http://127.0.0.1:11437/suggest',async r=>{
   models++;sent.push(JSON.parse(r.request().postDataJSON().context));
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
   if(changeDuringModel)revision='d';
   await r.fulfill({status:budget?502:200,headers:{'Access-Control-Allow-Origin':base},json:budget?{detail:'Selected OT reference and request exceed the local prompt budget.'}:{mode:'preferences',explanation:'Review compatible preferences within current rules.',proposed_rules:[],rule_changes:[],needs_review:true}});
  });
  await page.goto(base+'/__ot-optin');
  const open=async(admin=true)=>{
   await page.evaluate(async admin=>{sessionStorage.setItem('rota_local_assistant_enabled','true');sessionStorage.setItem('rota_local_assistant_pairing','synthetic-only');const m=await import('/src/rota-intelligence.ts');await m.openIntelligentRota('2026-05',admin,()=>{window.applied=true;});},admin);
   await page.locator('[data-tab=assistant]').click();await page.locator('[data-instruction]').fill('Balance duties while protecting reviewed OT requirements.');
  };
  const ask=async()=>{await page.locator('[data-ask]').click();await page.locator('[data-use-suggestion]').waitFor();};
  const load=async()=>{await page.locator('[data-ot-units]').click();await page.locator('[data-ot-read]').click();await page.locator('[data-ot-result]').waitFor();};
  await open();await ask();assert.equal(sent.at(-1).source_contract,1);
  await load();assert.equal(await page.locator('[data-include-ot]').isChecked(),false);
  await page.locator('[data-include-ot]').check();await ask();
  assert.equal(sent.at(-1).source_contract,2);assert.equal(sent.at(-1).ot_demand.content.unit_id,units[0]);
  await page.locator('[data-assistant-selected-ot-source]').waitFor();assert.match(await page.locator('[data-assistant-selected-ot-source]').textContent(),/UNIT_1.*2026-05-01/s);
  const axe=await new AxeBuilder({page}).include('[data-assistant-selected-ot-source]').include('[data-assistant-ot]').analyze();assert.deepEqual(axe.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);
  assert.equal(await page.locator('.mw-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
  if(width===390){await page.locator('[data-assistant-selected-ot-source]').scrollIntoViewIfNeeded();await page.screenshot({path:'../docs/allocation-progress/n44-ot-optin-390.png'});}
  revision='d';await page.locator('[data-use-suggestion]').click();await page.waitForFunction(()=>document.querySelector('[data-use-suggestion]')?.disabled);assert.equal(await page.locator('[data-mode]').count(),0);
  revision='c';changeDuringModel=true;await ask();await page.waitForFunction(()=>document.querySelector('[data-use-suggestion]')?.disabled);changeDuringModel=false;
  await page.locator('[data-ot-unit]').selectOption(units[1]);assert.equal(await page.locator('[data-include-ot]').isChecked(),false);assert.equal(await page.locator('[data-use-suggestion]').count(),0);
  await page.locator('[data-ot-read]').click();await page.locator('[data-ot-result]').waitFor();await page.locator('[data-include-ot]').check();
  // Wrong source scope must stop before inference, even when its contract is recognized.
  wrong=true;const prior=models;await page.locator('[data-ask]').click();await page.getByText('The assistant reference versions or selected scope changed. Reload the current rules and try again.',{exact:true}).waitFor();assert.equal(models,prior);wrong=false;
  budget=true;await page.locator('[data-ask]').click();await page.getByText('Selected OT reference and request exceed the local prompt budget.',{exact:true}).waitFor();assert.equal(await page.locator('[data-use-suggestion]').count(),0);budget=false;
  denied=true;await page.locator('[data-ask]').click();await page.getByText('OT reference permission changed',{exact:true}).waitFor();assert.equal(await page.locator('[data-use-suggestion]').count(),0);denied=false;
  await ask();await page.locator('[data-use-suggestion]').click();await page.locator('[data-mode]').waitFor();assert.equal(await page.locator('[data-mode]').inputValue(),'preferences');
  await page.locator('[data-tab=assistant]').click();await page.locator('[data-ot-day]').fill('2026-05-02');await page.locator('[data-ot-day]').blur();assert.equal(await page.locator('[data-include-ot]').isChecked(),false);assert.equal(await page.locator('[data-use-suggestion]').count(),0);
  await page.locator('[data-ot-read]').click();await page.locator('[data-ot-result]').waitFor();await page.locator('[data-include-ot]').check();
  delay=300;const permissionPending=page.waitForRequest('http://127.0.0.1:11437/suggest');await page.locator('[data-ask]').click();await permissionPending;const beforeRevocation=reads;await page.locator('[data-local-enabled]').uncheck();await page.waitForTimeout(500);assert.equal(reads,beforeRevocation);assert.equal(await page.locator('[data-use-suggestion]').count(),0);await page.locator('[data-local-enabled]').check();
  const modelStarted=page.waitForRequest('http://127.0.0.1:11437/suggest');await page.locator('[data-ask]').click();await modelStarted;const beforeClose=reads;await page.locator('[data-close]').click();await page.waitForTimeout(500);assert.equal(reads,beforeClose);assert.equal(await page.locator('dialog[open]').count(),0);
  await open(false);assert.equal(await page.locator('[data-include-ot]').count(),0);
  assert.equal(writes,0);assert.notEqual(await page.evaluate(()=>window.applied),true);assert.deepEqual(errors,[]);
  report.push({width,opt_in_only:true,selected_scope_sent:true,third_source_visible:true,changed_calendar_before_use_blocked:true,change_during_inference_blocked:true,selection_clears_consent:true,wrong_scope_no_model:true,budget_permission_errors_safe:true,close_no_followup:true,nonadmin_controls_absent:true,writes,errors,serious_critical_axe:0});
  await page.unrouteAll({behavior:'wait'});await context.close();
 }
 await writeFile('../docs/allocation-progress/n44-ot-optin-browser.json',JSON.stringify(report,null,2)+'\n');
}finally{await browser.close();}
