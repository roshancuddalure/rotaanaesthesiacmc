import assert from 'node:assert/strict';
import {writeFile, mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const base='http://127.0.0.1:5187', api='http://127.0.0.1:8019';
const serverOnly=process.env.BALANCE_REVIEW_SERVER_ONLY==='1';
const browser=await chromium.launch({headless:true,executablePath:process.env.MEMBER_TEST_BROWSER || chromium.executablePath(),args:['--force-high-performance-gpu']});
const report={client_date:'2026-11-19',server_only:serverOnly,hardware:null,workflows:[]};
try {
 for(const width of [1440,390,320]) {
  await fetch(api+'/__fixture/reset',{method:'POST'});
  const page=await browser.newPage({viewport:{width,height:900}}), errors=[];
  page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(60000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__balance-review',r=>r.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button>Open</button></body></html>'}));
  await page.route('**/api/**',async r=>{
   const url=new URL(r.request().url());
   const response=await r.fetch({url:api+url.pathname+url.search,timeout:150000});await r.fulfill({response});
  });
  await page.goto(base+'/__balance-review');
  if(width===1440 && !serverOnly) {
   report.hardware=await page.evaluate(async()=>{
    const m=await import('/src/compute-device.ts');
    const worker=new m.ComputeWorker('high-performance');
    try {
     const test=await worker.call('test');
     const batches=[];
     for(const n of [1,63,64,65,513,10000]) {
      const rows=Array.from({length:n},(_,i)=>Array.from({length:9},(_,j)=>(i*29+j*7)%1001));
      const result=await worker.call('score',{rows,ties:rows.map((_,i)=>n-i)});
      if(result.scores.some((v,i)=>v!==rows[i].reduce((a,b)=>a+b,0)))throw Error('GPU parity failed');
      batches.push({rows:n,gpu_ms:result.gpu_ms});
     }
     m.rememberTest(test);m.savePreference({...m.preference(),enabled:true,mode:'local_gpu'});
     return {test,batches};
    }finally{worker.close();}
   });
   assert.equal(report.hardware.test.software,false);
   assert.equal(report.hardware.test.parity,true);
  }
  await page.evaluate(async()=>{const m=await import('/src/rota-intelligence.ts');await m.openIntelligentRota('2026-05',true,()=>{});});
  await page.locator('[data-generate]').click();
  await page.getByText('Draft ready for review. No assignments have been saved.',{exact:true}).waitFor({timeout:150000});
  const jobs=await(await fetch(api+'/api/v1/rota-compute/jobs?month=2026-05')).json(), job=jobs[0];
  if(width===1440 && !serverOnly){assert.equal(job.engine,'local_gpu');assert.ok(job.metrics.gpu_frames_verified>0);}
  assert.equal((await(await fetch(api+'/__fixture')).json()).assignments,0);
  assert.equal(await page.locator('[data-apply]').isDisabled(),true);
  const downloaded=page.waitForEvent('download');await page.locator('[data-review-excel]').click();
  const download=await downloaded;assert.match(download.suggestedFilename(),/^rota-review-2026-05-r\d+\.xlsx$/);
  await mkdir('../docs/allocation-progress/review-workbooks',{recursive:true});
  await download.saveAs(`../docs/allocation-progress/review-workbooks/proposal-${width}.xlsx`);
  await page.getByText('Formatted Excel preview sent to your browser. Draft remains unapplied.',{exact:true}).waitFor();
  assert.equal((await(await fetch(api+'/__fixture')).json()).assignments,0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`../docs/allocation-progress/review-workbooks/review-${width}.png`});
  // A failed read must display recovery information without saving or downloading another file.
  await page.route('**/review.xlsx?*',r=>r.fulfill({status:409,contentType:'application/json',body:JSON.stringify({detail:'Inputs changed. Generate a fresh proposal.'})}));
  await page.locator('[data-review-excel]').click();
  await page.getByText('Inputs changed. Generate a fresh proposal.',{exact:true}).waitFor();
  assert.equal((await(await fetch(api+'/__fixture')).json()).assignments,0);
  report.workflows.push({width,engine:job.engine,gpu_frames_verified:job.metrics.gpu_frames_verified||0,excel:true,unapplied:true,stale_recovery:true,overflow:false,errors});
  if(width===1440) {
   await page.locator('[data-confirm]').check();await page.locator('[data-apply]').click();
   await page.getByText('2 assignments saved; 0 replaced. Not published.',{exact:true}).waitFor();
   const savedDownload=page.waitForEvent('download');await page.locator('[data-review-excel]').click();
   const saved=await savedDownload;assert.equal(saved.suggestedFilename(),'review-rota-2026-05.xlsx');
   await saved.saveAs('../docs/allocation-progress/review-workbooks/saved-draft.xlsx');
   await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','disposable');localStorage.setItem('duty_rota_working_month','2026-05');});
   await page.goto(base);
   await page.locator('[data-view="rota-review"]').first().evaluate(el=>el.click());
   await page.locator('#download-review-rota-export').waitFor();
   const reviewDownload=page.waitForEvent('download');await page.locator('#download-review-rota-export').click();
   const review=await reviewDownload;
   assert.match(review.suggestedFilename(),/^review-rota-\d{4}-\d{2}\.xlsx$/);
   report.workflows.push({main_review_download:true,filename:review.suggestedFilename()});
  }
  await page.close();
 }
}finally{
 await browser.close();
 await writeFile('../docs/allocation-progress/balance-review-browser.json',JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
