import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base='http://127.0.0.1:5188';
const browser=await chromium.launch({headless:true}),report=[];
const reference=(changed=false)=>({source_contract:1,month:'2026-05',snapshot_generated_at:'2026-11-20T01:00:00Z',sources:[{source:'current_rule_constraints',content_version:(changed?'c':'a').repeat(64)},{source:'approved_teaching_features',content_version:'b'.repeat(64)}],constraints:{},examples:[]});
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  await context.grantPermissions(['local-network-access'],{origin:base});
  let changed=false,modelCalls=0,contextCalls=0,missing=false,modelMalformed=false,modelDelay=0,writeCalls=0,changeDuringInference=false,contextDelay=0;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.route('**/__assistant-reference',r=>r.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body></body></html>'}));
  await page.route('**/api/**',async r=>{
   if(r.request().method()!=='GET')writeCalls++;
   const path=new URL(r.request().url()).pathname;
   let json;
   if(path.endsWith('/setup'))json={slots:[],people:[],rules:{},history_lookback:3,history_months:[],holiday_dates:[]};
   else if(path.endsWith('/assistant-context')){contextCalls++;if(contextDelay)await new Promise(resolve=>setTimeout(resolve,contextDelay));json=missing?{}:reference(changed);}
   else json=[];
   await r.fulfill({json});
  });
  await page.route('http://127.0.0.1:11437/suggest',async r=>{
   modelCalls++;const sent=r.request().postDataJSON();assert.equal(sent.context.includes('source_contract'),true);
   if(modelDelay)await new Promise(resolve=>setTimeout(resolve,modelDelay));
   if(changeDuringInference)changed=false;
   await r.fulfill({headers:{'Access-Control-Allow-Origin':base},json:{mode:modelMalformed?'invented':'preferences',explanation:'Review the proposed planning mode.',proposed_rules:[],rule_changes:[],needs_review:true}});
  });
  await page.goto(base+'/__assistant-reference');
  const open=async()=>{
   await page.evaluate(async()=>{sessionStorage.setItem('rota_local_assistant_enabled','true');sessionStorage.setItem('rota_local_assistant_pairing','synthetic-only');const m=await import('/src/rota-intelligence.ts');await m.openIntelligentRota('2026-05',true,()=>{window.applied=true;});});
   await page.locator('[data-tab=assistant]').click();
   await page.locator('[data-instruction]').fill('Honor recorded preferences safely.');
  };
  await open();
  await page.locator('[data-ask]').click();
  await page.locator('[data-assistant-sources]').waitFor();
  assert.match(await page.locator('[data-assistant-sources]').textContent(),/does not include personal availability/);
  assert.match(await page.locator('[data-assistant-sources]').textContent(),new RegExp('a'.repeat(64)));
  assert.equal(contextCalls,2);
  const axe=await new AxeBuilder({page}).include('[data-assistant-sources]').analyze();
  assert.deepEqual(axe.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);
  assert.equal(await page.locator('.mw-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(width===390){await page.locator('[data-assistant-sources]').scrollIntoViewIfNeeded();await page.screenshot({path:'../docs/allocation-progress/n44-reference-390.png'});}
  // Content changes after inference prevent selecting the stale mode.
  changed=true;
  await page.locator('[data-use-suggestion]').click();
  await page.getByText('The reference rules, teaching evidence or selected OT demand changed. Ask for a new suggestion.',{exact:true}).first().waitFor();
  assert.equal(await page.locator('[data-use-suggestion]').isDisabled(),true);
  // A new request uses the new versions and can select only its planning mode.
  await page.locator('[data-ask]').click();
  await page.locator('[data-use-suggestion]:enabled').waitFor();
  await page.locator('[data-use-suggestion]').click();
  await page.locator('[data-mode]').waitFor();
  assert.equal(await page.locator('[data-mode]').inputValue(),'preferences');
  assert.equal(writeCalls,0);assert.notEqual(await page.evaluate(()=>window.applied),true);
  await page.locator('[data-tab=assistant]').click();
  contextDelay=250;
  await page.locator('[data-use-suggestion]').click();
  await page.locator('[data-instruction]').fill('Now ask something different.');
  await page.getByText('The instruction or selected reference changed. Ask for a new suggestion.',{exact:true}).waitFor();
  contextDelay=0;
  await page.locator('[data-use-suggestion]').click();
  await page.getByText('The instruction or selected reference changed. Ask for a new suggestion.',{exact:true}).waitFor();
  changeDuringInference=true;
  await page.locator('[data-ask]').click();
  await page.getByText('The reference rules, teaching evidence or selected OT demand changed while the assistant was working. Ask for a new suggestion.',{exact:true}).first().waitFor();
  assert.equal(await page.locator('[data-use-suggestion]').isDisabled(),true);
  changeDuringInference=false;
  const priorCalls=modelCalls;missing=true;
  await page.locator('[data-ask]').click();
  await page.getByText('The assistant reference versions or selected scope changed. Reload the current rules and try again.',{exact:true}).waitFor();
  assert.equal(modelCalls,priorCalls);
  missing=false;modelMalformed=true;
  await page.locator('[data-ask]').click();
  await page.getByText('The local assistant returned an unsupported suggestion. Regular planning remains available.',{exact:true}).waitFor();
  modelMalformed=false;modelDelay=200;
  await page.locator('[data-ask]').click();
  await page.waitForFunction(()=>document.querySelector('.mw-footer')?.textContent.includes('Working'));
  await page.locator('[data-close]').click();
  const afterClose=contextCalls;
  await page.waitForTimeout(500);
  assert.equal(contextCalls,afterClose);assert.equal(await page.locator('dialog[open]').count(),0);
  assert.equal(writeCalls,0);assert.deepEqual(errors,[]);
  report.push({width,visible_sources:true,stale_mode_blocked:true,changed_during_inference_blocked:true,fresh_mode_only:true,edited_instruction_blocked:true,edited_during_freshness_check_blocked:true,missing_versions_no_model_call:true,malformed_mode_rejected:true,closed_no_followup:true,no_writes:true,serious_critical_axe:0});
  await page.unrouteAll({behavior:'wait'});await context.close();
 }
 await writeFile('../docs/allocation-progress/n44-reference-browser-final.json',JSON.stringify(report,null,2)+'\n');
}finally{await browser.close();}
