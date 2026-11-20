import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base='http://127.0.0.1:5188',browser=await chromium.launch({headless:true}),report=[];
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  let reads=0,writes=0,loopback=0,status='configured',wrongScope=false,delay=0,denied=false,revision='a';
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/__ot-assistant',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body></body></html>'}));
  await page.route('http://127.0.0.1:11437/**',r=>{loopback++;return r.abort();});
  await page.route('**/api/**',async r=>{
   if(r.request().method()!=='GET')writes++;
   const u=new URL(r.request().url()),p=u.pathname;
   if(p.endsWith('/setup'))return r.fulfill({json:{slots:[],people:[],rules:{},history_lookback:3,history_months:[],holiday_dates:[]}});
   if(p.endsWith('/jobs'))return r.fulfill({json:[]});
   if(p==='/api/v1/units')return r.fulfill({json:[{id:'unit-A',code:'UNIT_A',name:'Unit A'},{id:'unit-B',code:'UNIT_B',name:'Unit B'}]});
   assert.ok(p.endsWith('/assistant-reference'),p);reads++;
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
   if(denied)return r.fulfill({status:403,json:{detail:'Administrator OT access required'}});
   return r.fulfill({json:{reference_contract:'ot-demand-v1',content:{unit_id:wrongScope?'other':p.includes('unit-A')?'unit-A':'unit-B',day:u.searchParams.get('day'),calendar_status:status,demand_known:status==='configured',reserve_mode:'included',closed_area_count:status==='configured'?0:1,missing_area_count:status==='partially_configured'?1:0,bands:status==='configured'?[{band_index:0,starts_at:u.searchParams.get('day')+'T08:00:00',ends_at:u.searchParams.get('day')+'T16:00:00',call_levels:['3RD_CALL','CO_4TH_CALL'],minimum:2,target:3,required_skill_count:1}]:[]},source:{kind:'resolved_unit_ot_calendar',calendar_revision:revision.repeat(64),content_version:'b'.repeat(64)},retrieved_at:'2026-11-20T01:00:00Z'}});
  });
  await page.goto(base+'/__ot-assistant');
  const open=async admin=>{await page.evaluate(async admin=>{const m=await import('/src/rota-intelligence.ts');await m.openIntelligentRota('2026-11',admin,()=>{window.applied=true;});},admin);await page.locator('[data-tab=assistant]').click();};
  await open(true);await page.locator('[data-ot-units]').click();
  await page.locator('[data-ot-read]').waitFor();await page.locator('[data-ot-read]').click();
  await page.locator('[data-ot-result]').waitFor();
  assert.match(await page.locator('[data-ot-result]').textContent(),/Demand definitions are complete/);
  assert.match(await page.locator('[data-ot-result]').textContent(),/CO_4TH_CALL/);
  assert.equal(await page.locator('[data-ot-band]').count(),1);
  assert.equal(await page.locator('[data-ot-minimum]').textContent(),'2');assert.equal(await page.locator('[data-ot-target]').textContent(),'3');
  assert.equal(await page.locator('.mw-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const axe=await new AxeBuilder({page}).include('[data-assistant-ot]').analyze();assert.deepEqual(axe.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);
  if(width===390){await page.locator('[data-ot-result]').scrollIntoViewIfNeeded();await page.screenshot({path:'../docs/allocation-progress/n44-ot-inspector-390.png'});}
  await page.locator('[data-ot-unit]').selectOption('unit-B');assert.equal(await page.locator('[data-ot-result]').count(),0);
  status='not_evaluated';await page.locator('[data-ot-read]').click();await page.getByText('No complete demand answer is available.',{exact:true}).waitFor();
  status='partially_configured';await page.locator('[data-ot-read]').click();await page.getByText('Date: 2026-11-01. Calendar status: partially configured. Demand is unknown or incomplete; do not treat missing bands as zero.',{exact:true}).waitFor();
  status='configured';revision='c';await page.locator('[data-ot-read]').click();await page.locator('[data-ot-band]').waitFor();
  await page.locator('[data-ot-result] summary').click();assert.match(await page.locator('[data-ot-result]').textContent(),new RegExp('c'.repeat(64)));
  wrongScope=true;await page.locator('[data-ot-read]').click();await page.getByText('The OT reference did not match the selected unit/date or supported format. Refresh the saved calendar.',{exact:true}).waitFor();assert.equal(await page.locator('[data-ot-result]').count(),0);
  wrongScope=false;denied=true;await page.locator('[data-ot-read]').click();await page.getByText('Administrator OT access required',{exact:true}).waitFor();denied=false;
  delay=200;await page.locator('[data-ot-read]').click();await page.waitForFunction(()=>document.querySelector('.mw-footer')?.textContent.includes('Working.'));await page.locator('[data-close]').click();await page.waitForTimeout(400);assert.equal(await page.locator('dialog[open]').count(),0);
  await open(false);assert.equal(await page.locator('[data-assistant-ot]').count(),0);
  assert.equal(writes,0);assert.equal(loopback,0);assert.notEqual(await page.evaluate(()=>window.applied),true);assert.deepEqual(errors,[]);
  report.push({width,canonical_fields_displayed:true,unknown_partial_not_zero:true,changed_selection_clears_reference:true,refreshed_revision_visible:true,wrong_scope_rejected:true,permission_error:true,late_close_ignored:true,nonadmin_controls_absent:true,no_writes:true,no_model_requests:true,no_overflow:true,serious_critical_axe:0,reads});
  await page.unrouteAll({behavior:'wait'});await context.close();
 }
 await writeFile('../docs/allocation-progress/n44-ot-inspector-browser-final.json',JSON.stringify(report,null,2)+'\n');
}finally{await browser.close();}
