import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base='http://127.0.0.1:5188',browser=await chromium.launch({headless:true});
const results=[];
try{
 for(const [name,seconds,mode,legacy,adapterChanged,expected] of [
  ['legacy-unscoped',30,'balanced',true,false,'server'],
  ['different-budget',60,'balanced',false,false,'server'],
  ['matching-options',30,'balanced',false,false,'local_gpu'],
  ['different-mode',30,'preferences',false,false,'server'],
  ['changed-adapter',30,'balanced',false,true,'server'],
 ]){
  const page=await browser.newPage({viewport:{width:name==='matching-options'?390:1440,height:1000}}),errors=[],starts=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__automatic-optimizer',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body></body></html>'}));
  await page.route('**/api/**',async r=>{
   const path=new URL(r.request().url()).pathname;
   if(path.endsWith('/setup'))return r.fulfill({json:{slots:[],people:[],rules:{},holiday_dates:[],history_months:[],history_lookback:3}});
   if(path.endsWith('/capabilities'))return r.fulfill({json:{browser_gpu:true,optimizer_gpu:true,context_hash:'same',optimizer_context_hash:'same',workload_estimates:{optimizer_rows:512}}});
   if(path.endsWith('/jobs')&&r.request().method()==='GET')return r.fulfill({json:[]});
   if(path.endsWith('/validate'))return r.fulfill({json:{validated:true}});
   if(path.endsWith('/jobs')&&r.request().method()==='POST'){
    const request=r.request().postDataJSON();starts.push(request);
    return r.fulfill({json:{id:'synthetic',revision:1,status:'completed',decisions:[],proposed:0,unresolved:0,engine:request.engine,context_hash:'same',benchmark_context_hash:'same',intelligence:{selected:0,alternatives:[]}}});
   }
   throw Error('Unexpected API request: '+r.request().method()+' '+path);
  });
  await page.goto(base+'/__automatic-optimizer');
  await page.evaluate(async({legacy,adapterChanged})=>{
   const compute=await import('/src/compute-device.ts');
   compute.resetPreference();
   const device={supported:true,software:false,adapter:'Synthetic GPU',vendor:'synthetic',architecture:'test',device:'',description:'',test_ms:1,parity:true,signature:'synthetic-signature',preference:'high-performance',version:2,kernel_checks:{members:true,template:true,optimizer:true}};
   window.syntheticWorkers=0;
   window.Worker=class{
    constructor(){window.syntheticWorkers++;}
    postMessage(message){queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result:adapterChanged?{...device,adapter:'Changed GPU',signature:'changed-signature'}:device}}));}
    terminate(){}
   };
   const proof={server_ms:1000,local_ms:700,parity:true,at:Date.now(),version:2,measurement_version:2,adapter:device.adapter,signature:device.signature,browser:navigator.userAgent,month:'2026-05',context_hash:'same',workload:'optimizer',kernel_version:3,configuration:legacy?'':compute.optimizerConfiguration({mode:'balanced',seconds:30})};
   compute.savePreference({enabled:true,mode:'auto',power:'high-performance',test:device,proofs:{optimizer:proof}});
   const m=await import('/src/rota-intelligence.ts');await m.openIntelligentRota('2026-05',true,()=>{throw Error('No apply allowed');});
  },{legacy,adapterChanged});
  await page.locator('[data-mode]').selectOption(mode);
  await page.locator('[data-seconds]').selectOption(String(seconds));
  await page.locator('[data-generate]').click();
  await page.getByText('Draft ready for review. No assignments have been saved.',{exact:true}).waitFor();
  assert.equal(starts.length,1);assert.equal(starts[0].engine,expected,name);
  assert.equal(starts[0].mode,mode);assert.equal(starts[0].seconds,seconds);
  assert.deepEqual(starts[0].locked_slots,[]);assert.deepEqual(starts[0].repair_slots,[]);assert.deepEqual(starts[0].preferences,[]);
  const workers=await page.evaluate(()=>window.syntheticWorkers);
  assert.equal(workers,expected==='local_gpu'||adapterChanged?1:0,name);
  assert.deepEqual(errors,[]);
  results.push({name,expected_engine:expected,actual_engine:starts[0].engine,worker_tests:workers,synthetic_worker:true,no_apply:true,page_errors:0});
  await page.close();
 }
 // Separate native probe: no WebGPU enablement flags, no fabricated hardware.
 const native=await browser.newPage();await native.goto(base);
 const nativeProbe=await native.evaluate(async()=>{
  const m=await import('/src/compute-device.ts');let worker;
  try{worker=new m.ComputeWorker();const device=await worker.call('test');return {supported:true,device};}
  catch(error){return {supported:false,code:error.code||'unknown',message:error.message};}
  finally{worker?.close();}
 });
 await native.close();
 await writeFile('../docs/allocation-progress/n40-automatic-browser-verified.json',JSON.stringify({selector_contracts:results,native_probe:nativeProbe,limits:'Synthetic worker/API selector contracts; native probe separate. No full-workflow speedup, actual optimizer GPU job or new safety proof inferred.'},null,2)+'\n');
}finally{await browser.close();}
