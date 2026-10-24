import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base=process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5178';
const api=process.env.GENERATION_TEST_API || 'http://127.0.0.1:8023';
const report={date:new Date().toISOString(),hardware:[],workflows:[]};
const configuration={duty_keys:['MAIN_1ST_24HR'],starts_on:'2026-05-01',ends_on:'2026-05-04',replace_existing:true};

for(const mode of ['default','nvidia']) {
 const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),args:mode==='nvidia'?['--force-high-performance-gpu']:[]});
 try{
  const page=await browser.newPage();await page.goto(base);
  const evidence=await page.evaluate(async()=>{
   const {ComputeWorker}=await import('/src/compute-device.ts');const worker=new ComputeWorker();
   try{
    const test=await worker.call('test'),cases=[];
    for(const count of [1,63,64,65,513,2048,4096]) {
     const rows=Array.from({length:count},(_,i)=>[(i*13)%97-48,-((i*17)%101),2147483647-(i%7),-2147483648+(i%5)]),ties=rows.map((_,i)=>count-i);
     const input={kernel:'lexicographic',version:3,rows,ties};
     const result=await worker.call('score',input);
     const order=rows.map((_,i)=>i).sort((a,b)=>{for(let k=0;k<4;k++){const diff=rows[a][k]-rows[b][k];if(diff)return diff;}return ties[a]-ties[b];});
     const ranks=Array(count);order.forEach((i,rank)=>ranks[i]=rank);
     if(JSON.stringify(result.scores)!==JSON.stringify(ranks)||result.winner!==order[0])throw Error('Lexicographic hardware parity failed');
     cases.push({count,parity:true,gpu_ms:result.gpu_ms});
    }
    return {test,cases};
   }finally{worker.close();}
  });
  if(mode==='nvidia')assert.match(evidence.test.vendor,/nvidia/i);
  assert.equal(evidence.test.kernel_checks.template,true);report.hardware.push({mode,...evidence});await page.close();

  for(const width of [1280,390,320]) {
   await fetch(api+'/__fixture/template',{method:'POST'});
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/__generation',r=>r.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host"></main></body></html>'}));
   await page.route('**/api/**',async r=>{const url=new URL(r.request().url()),response=await r.fetch({url:api+url.pathname+url.search});await r.fulfill({response});});
   await page.goto(base+'/__generation');
   await page.evaluate(async configuration=>{
    const m=await import('/src/compute-device.ts');m.resetPreference();m.savePreference({enabled:true,mode:'local_gpu',power:'high-performance'});
    await (await import('/src/rota-compute.ts')).openRotaCompute('2026-05',true,()=>{window.applied=true;},configuration);
   },configuration);
   await page.locator('[data-generate]').click();await page.getByText('Draft ready for review.',{exact:false}).waitFor({timeout:60000});
   assert.equal((await(await fetch(api+'/__fixture/generation')).json()).slots,0);
   assert.equal(await page.locator('[data-apply]').isDisabled(),true);
   const jobs=await(await fetch(api+'/api/v1/rota-compute/jobs?month=2026-05')).json();assert.equal(jobs[0].engine,'local_gpu');assert.equal(jobs[0].kind,'template');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const accessibility=await new AxeBuilder({page}).include('dialog').analyze();
   assert.deepEqual(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,description:v.description})),[]);
   if(mode==='default'&&width===390){await mkdir('tests/artifacts',{recursive:true});await page.screenshot({path:'tests/artifacts/template-gpu-review-mobile.png'});}
   await page.locator('[data-review-confirm]').check();await page.locator('[data-apply]').click();
   await page.getByText('template duties applied.',{exact:false}).waitFor();
   assert.ok((await(await fetch(api+'/__fixture/generation')).json()).slots>0);
   assert.equal((await(await fetch(api+'/__fixture')).json()).assignments,0);
   if(width===390){
    await page.getByText('Reverse this generation',{exact:true}).click();await page.locator('[data-reversal-confirm]').check();await page.locator('[data-revert]').click();
    await page.getByText('Generation reversed after unchanged-draft validation.',{exact:false}).waitFor();
    assert.equal((await(await fetch(api+'/__fixture/generation')).json()).slots,0);
    await page.locator('[data-generate]').click();await page.getByText('Draft ready for review.',{exact:false}).waitFor();
    await page.locator('[data-review-confirm]').check();await page.locator('[data-apply]').click();await page.getByText('template duties applied.',{exact:false}).waitFor();
   }
   await page.locator('[data-close]').click();
   await page.evaluate(async()=>{(await import('/src/rota-compute.ts')).openAutoassign('2026-05',true,()=>{});});
   await page.getByRole('heading',{name:'Autoassign members',exact:true}).waitFor();
   await page.locator('[data-quick]').click();await page.locator('[data-generate]').click();
   await page.getByText('Draft ready for review.',{exact:false}).waitFor({timeout:60000});
   assert.equal((await(await fetch(api+'/__fixture')).json()).assignments,0);
   await page.locator('[data-review-confirm]').check();await page.locator('[data-apply]').click();
   await page.getByText('assignments applied to the draft.',{exact:false}).waitFor();
   const final=await(await fetch(api+'/__fixture')).json();assert.ok(final.assignments>0);assert.deepEqual(errors,[]);
   report.workflows.push({mode,width,template_preview_no_writes:true,template_gpu:true,review_required:true,autoassigned:final.assignments,serious_accessibility_violations:0});await context.close();
  }
  await fetch(api+'/__fixture/reset',{method:'POST'});
  const optimizerContext=await browser.newContext({viewport:{width:390,height:900}}),optimizer=await optimizerContext.newPage();
  const optimizerErrors=[];optimizer.on('pageerror',e=>optimizerErrors.push(e.message));
  await optimizer.route('**/__optimizer',r=>r.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body></body></html>'}));
  await optimizer.route('**/api/**',async r=>{const u=new URL(r.request().url()),response=await r.fetch({url:api+u.pathname+u.search});await r.fulfill({response});});
  await optimizer.goto(base+'/__optimizer');
  await optimizer.evaluate(async()=>{
    const m=await import('/src/compute-device.ts');m.resetPreference();m.savePreference({enabled:true,mode:'local_gpu',power:'high-performance'});
    await(await import('/src/rota-intelligence.ts')).openIntelligentRota('2026-05',true,()=>{});
  });
  await optimizer.locator('[data-seconds]').selectOption('30');
  await optimizer.locator('[data-generate]').click();await optimizer.getByText('Draft ready for review.',{exact:false}).waitFor({timeout:60000});
  const optimized=(await(await fetch(api+'/api/v1/rota-compute/jobs?month=2026-05')).json())[0];
  assert.equal(optimized.engine,'local_gpu');assert.ok(optimized.metrics.gpu_frames_verified>0);assert.equal((await(await fetch(api+'/__fixture')).json()).assignments,0);
  assert.equal(await optimizer.locator('[data-apply]').isDisabled(),true);
  await optimizer.locator('[data-confirm]').check();await optimizer.locator('[data-apply]').click();await optimizer.getByText('assignments saved;', {exact:false}).waitFor();
  await optimizer.getByText('Reverse this generation',{exact:true}).click();
  await optimizer.locator('[data-reversal-confirm]').check();await optimizer.locator('[data-revert]').click();
  await optimizer.getByText('Generation reversed.',{exact:false}).waitFor();
  assert.equal((await(await fetch(api+'/__fixture')).json()).assignments,0);
  assert.deepEqual(optimizerErrors,[]);report.workflows.push({mode,kind:'whole-month',gpu_frames:optimized.metrics.gpu_frames_verified,review_required:true});
  await optimizerContext.close();
 }finally{await browser.close();}
}
await writeFile('../docs/benchmarks/generation_compute_browser.json',JSON.stringify(report,null,2)+'\n');
console.log(`Generation GPU suite passed: ${report.hardware.length} adapters and ${report.workflows.length} complete workflows.`);
