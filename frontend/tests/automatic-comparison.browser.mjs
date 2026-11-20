import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const browser=await chromium.launch({headless:true}),base='http://127.0.0.1:5188';
try{
 const context=await browser.newContext({viewport:{width:390,height:1000}}),page=await context.newPage(),starts=[],validations=[],cancels=[],errors=[];
 let changedLearning=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/__automatic-comparison',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host"></main></body></html>'}));
 await page.route('**/api/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path.endsWith('/capabilities'))return r.fulfill({json:{enabled:true,browser_gpu:true,optimizer_gpu:true,context_hash:'same'}});
  if(path.endsWith('/validate')){validations.push(r.request().postDataJSON());return r.fulfill({json:{validated:true}});}
  if(path.endsWith('/cancel')){cancels.push(path);return r.fulfill({json:{cancelled:true}});}
  assert.equal(path,'/api/v1/rota-intelligence/jobs');assert.equal(r.request().method(),'POST');
  const body=r.request().postDataJSON();starts.push(body);
  await r.fulfill({json:{id:'comparison-'+starts.length,revision:1,status:'completed',processed:1,total:1,proposed:1,unresolved:0,engine:body.engine,context_hash:'same',benchmark_context_hash:changedLearning&&starts.length%2===0?'learning-changed':'learning-same',decisions:[{slot_id:'s',person_id:'p',action:'assign',score:1}]}});
 });
 await page.goto(base+'/__automatic-comparison');
 await page.evaluate(async()=>{
  const m=await import('/src/compute-device.ts');m.resetPreference();
  const device={supported:true,software:false,adapter:'Synthetic GPU',vendor:'synthetic',architecture:'test',device:'',description:'',test_ms:1,parity:true,signature:'synthetic-signature',preference:'high-performance',version:2,kernel_checks:{members:true,template:true,optimizer:true}};
  window.comparisonDeviceTests=0;
  window.Worker=class{postMessage(message){window.comparisonDeviceTests++;queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result:device}}));}terminate(){}};
  m.savePreference({enabled:true,mode:'auto',power:'high-performance',test:device});
  const view=await import('/src/rota-compute.ts');await view.renderComputeSettings(document.querySelector('#host'));
 });
 await page.locator('[data-compute-month]').fill('2026-05');
 await page.locator('[data-compute-workload]').selectOption('optimizer');
 assert.match(await page.locator('[data-optimizer-comparison-scope]').textContent(),/30-second search budget/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const axe=await new AxeBuilder({page}).include('[data-optimizer-comparison-scope]').analyze();
 assert.deepEqual(axe.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);
 await page.locator('[data-optimizer-comparison-scope]').scrollIntoViewIfNeeded();
 await page.screenshot({path:'../docs/allocation-progress/n40-comparison-390.png'});
 await page.locator('[data-compute-compare]').click();
 await page.locator('[data-compute-status]').filter({hasText:'Comparison complete.'}).waitFor();
 assert.equal(starts.length,6);assert.deepEqual(starts.map(s=>s.engine),['server','local_gpu','local_gpu','server','server','local_gpu']);
 assert.ok(starts.every(s=>s.month==='2026-05'&&s.mode==='balanced'&&s.seconds===30));
 assert.equal(validations.length,6);assert.equal(cancels.length,6);
 assert.equal(await page.evaluate(()=>window.comparisonDeviceTests),4,'Initial readiness plus three timed local verification tests');
 const proof=await page.evaluate(async()=>{
  const m=await import('/src/compute-device.ts');const p=m.preference().proofs.optimizer;
  return {value:p,configurationMatches:p.configuration===m.optimizerConfiguration({mode:'balanced',seconds:30})};
 });
 assert.equal(proof.configurationMatches,true);assert.equal(proof.value.measurement_version,2);assert.equal(proof.value.context_hash,'learning-same');assert.equal(proof.value.stage_timings.length,6);
 assert.ok(proof.value.stage_timings.every(t=>t.total_ms>=t.final_validation_ms+t.device_verification_ms));assert.deepEqual(errors,[]);
 changedLearning=true;
 await page.locator('[data-compute-compare]').click();
 await page.locator('[data-compute-status]').filter({hasText:'Results differed. Automatic mode will use the server.'}).waitFor();
 const changedProof=await page.evaluate(async()=>{
  const m=await import('/src/compute-device.ts');const p=m.preference().proofs.optimizer;
  return {parity:p.parity,engine:m.selectedEngine(true,true,{month:'2026-05',hash:'learning-same',workload:'optimizer',configuration:m.optimizerConfiguration({mode:'balanced',seconds:30}),estimatedRows:512})};
 });
 assert.equal(changedProof.parity,false);assert.equal(changedProof.engine,'server');
 assert.equal(starts.length,12);assert.equal(validations.length,12);assert.equal(cancels.length,12);assert.deepEqual(errors,[]);
 await writeFile('../docs/allocation-progress/n40-comparison-learning-invalidation.json',JSON.stringify({starts,validations:validations.length,cancels:cancels.length,proof,changed_learning:changedProof,errors,visible_scope:true,width:390,overflow:false,serious_critical_axe:0,scope:'Actual comparison UI with synthetic worker/completed API results. Two six-run comparisons prove matching settings and changed-learning rejection, validation-inclusive timing and cleanup. No physical GPU speedup or actual scheduling result.'},null,2)+'\n');
}finally{await browser.close();}
