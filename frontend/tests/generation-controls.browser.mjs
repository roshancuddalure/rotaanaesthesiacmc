import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base=process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5178', api=process.env.GENERATION_TEST_API || 'http://127.0.0.1:8023';
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()});
const report={date:new Date().toISOString(),comparisons:[],workflows:[]};
async function pageAt(width=390) {
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/__controls',r=>r.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host"></main></body></html>'}));
 await page.route('**/api/**',async r=>{const u=new URL(r.request().url()),response=await r.fetch({url:api+u.pathname+u.search});await r.fulfill({response});});
 await page.goto(base+'/__controls');return {context,page,errors};
}
try {
 for(const workload of ['template','optimizer']) {
  await fetch(api+(workload==='template'?'/__fixture/template':'/__fixture/reset'),{method:'POST'});
  const {context,page,errors}=await pageAt();
  await page.evaluate(async()=>{(await import('/src/compute-device.ts')).resetPreference();await(await import('/src/rota-compute.ts')).renderComputeSettings(document.querySelector('#host'));});
  await page.locator('[data-compute-enable]').check();await page.locator('[data-compute-month]').fill('2026-05');
  await page.locator('[data-compute-workload]').selectOption(workload);
  await page.locator('[data-compute-test]').click();await page.getByText('Device test passed.',{exact:false}).waitFor();
  assert.equal(await page.locator('[data-compute-compare]').isEnabled(),true);
  await page.locator('[data-compute-compare]').click();await page.getByText('Comparison complete.',{exact:false}).waitFor({timeout:180000});
  const proof=await page.evaluate(async workload=>(await import('/src/compute-device.ts')).preference().proofs[workload],workload);
  assert.equal(proof.workload,workload);assert.equal(proof.kernel_version,3);assert.equal(proof.parity,true);assert.equal(proof.stage_timings.length,6);
  const fixture=await(await fetch(api+'/__fixture')).json();assert.equal(fixture.assignments,0);assert.equal(fixture.jobs.filter(j=>j.status==='cancelled').length,6);
  if(workload==='template')assert.equal((await(await fetch(api+'/__fixture/generation')).json()).slots,0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const accessibility=await new AxeBuilder({page}).include('.compute-settings').analyze();
  assert.deepEqual(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);
  assert.deepEqual(errors,[]);report.comparisons.push({workload,proof,assignments:0,cancelled_proposals:6});await context.close();
 }
 // Controls become available while optional reports are still pending.
 for(const width of [320,390,768,1280]){
  await fetch(api+'/__fixture/template',{method:'POST'});
  const {context,page,errors}=await pageAt(width);
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','disposable');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.goto(base);await page.getByRole('heading',{name:'Duty workload at a glance',exact:true}).waitFor();
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/v1/rota-template/allocation-statistics*',async route=>{await gate;await route.fulfill({status:503,json:{detail:'Injected optional report failure'}});});
  await page.locator('[data-view="rota-template"]').first().evaluate(b=>b.click());
  await page.locator('[data-early-build]').waitFor({timeout:5000});
  assert.equal(await page.locator('[data-early-build]').isEnabled(),true);
  assert.equal(await page.locator('#run-safe-auto-fill').isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  release();await page.locator('#generate-rota-template').waitFor();
  assert.equal(await page.locator('#generate-rota-template').isEnabled(),true);
  const build=page.locator('#generate-rota-template');await build.focus();assert.equal(await build.evaluate(el=>el===document.activeElement),true);
  await build.press('Enter');await page.getByRole('heading',{name:'Preview template allocation',exact:true}).waitFor();
  await page.locator('[data-close]').click();assert.deepEqual(errors,[]);
  report.workflows.push({width,actions_before_optional_reports:true,report_failure_nonblocking:true,keyboard_build:true});await context.close();
 }
 // Faults inside ordered scoring fall back without creating template duties.
 await fetch(api+'/__fixture/template',{method:'POST'});
 const {context,page,errors}=await pageAt();
 await page.route('**/src/compute-worker.ts*',async route=>{
  const response=await route.fetch();await route.fulfill({response,body:(await response.text())+`\nconst handler=self.onmessage;self.onmessage=e=>e.data.type==='score'?self.postMessage({id:e.data.id,error:{code:'device-lost',message:'Injected allocation GPU loss'}}):handler(e);`});
 });
 await page.evaluate(async()=>{
  const m=await import('/src/compute-device.ts');m.resetPreference();m.savePreference({enabled:true,mode:'local_gpu',power:'high-performance'});
  await(await import('/src/rota-compute.ts')).openRotaCompute('2026-05',true,()=>{}, {duty_keys:['MAIN_1ST_24HR'],starts_on:'2026-05-01',ends_on:'2026-05-04'});
 });
 await page.locator('[data-generate]').click();await page.getByText('Draft ready for review.',{exact:false}).waitFor({timeout:60000});
 const job=(await(await fetch(api+'/api/v1/rota-compute/jobs?month=2026-05')).json())[0];assert.equal(job.engine,'server');
 assert.equal((await(await fetch(api+'/__fixture/generation')).json()).slots,0);assert.equal(await page.locator('[data-apply]').isDisabled(),true);assert.deepEqual(errors,[]);
 report.workflows.push({kind:'template_gpu_loss',server_fallback:true,slots_written:0});await context.close();
}finally{await browser.close();}
await writeFile('../docs/benchmarks/generation_controls_browser.json',JSON.stringify(report,null,2)+'\n');
console.log(`Generation controls passed: ${report.comparisons.length} workload comparisons, ${report.workflows.length} readiness/recovery workflows.`);
