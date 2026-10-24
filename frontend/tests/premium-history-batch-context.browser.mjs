import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const baseline=process.env.HISTORY_CONTEXT_BASELINE==='1',results=[];
const hash=async()=>createHash('sha256').update(await readFile('src/workflow-import-history.ts')).digest('hex'),initial=await hash();
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of baseline?[320]:[320,1280]){
  const page=await browser.newPage({viewport:{width,height:850}}),calls=[],errors=[];let failB=true;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__history_batch_context',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="history" style="padding:12px"></main></body></html>'}));
  await page.route('**/api/**',async route=>{
   assert.equal(route.request().method(),'GET');const url=new URL(route.request().url());calls.push(url.pathname+url.search);
   if(url.pathname.endsWith('/history'))return route.fulfill({json:{items:['A','B'].map(id=>({id,filename:`${id}.csv`,month:'2026-10',status:'applied',at:'2026-10-01T00:00:00Z',actor:'Fixture operator',counts:{created:55}})),offset:0,has_more:false}});
   const id=url.pathname.split('/').at(-1),offset=Number(url.searchParams.get('offset'));
   if(id==='B'&&failB)return route.fulfill({status:503,json:{detail:'Batch B rows temporarily unavailable'}});
   return route.fulfill({json:{filename:`${id}.csv`,offset,has_more:offset===0,rows:[{sheet:'CSV',row:offset+2,raw:{name:`${id} source ${offset}`},normalized:{canonical_name:`${id} member ${offset}`},outcome:{action:'created'},record_id:`${id}-${offset}`}]}});
  });
  await page.goto('http://127.0.0.1:5197/__history_batch_context');await page.evaluate(async()=>{await(await import('/src/workflow-import-history.ts')).mountWorkflowImportHistory(document.querySelector('#history'),'leave','2026-10');});
  const open=id=>page.locator(`[data-history=open][data-batch="${id}"]`);
  await open('A').focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'A.csv',exact:true}).waitFor();
  await open('B').focus();await page.keyboard.press('Enter');await page.getByRole('status').filter({hasText:'Batch B rows temporarily unavailable'}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'A.csv',exact:true}).count(),1);await page.locator('[data-history=rows-next]').focus();await page.keyboard.press('Enter');
  if(baseline)await page.getByRole('status').filter({hasText:'Batch B rows temporarily unavailable'}).waitFor();
  else await page.getByText(/A source 50/).waitFor();
  const observed={nextRequest:calls.at(-1),heading:await page.locator('#history h4').innerText(),rows:await page.locator('[aria-label="Recorded import source rows"]').innerText()};
  if(!baseline){
   assert.equal(observed.nextRequest,'/api/v1/imports/leave/history/A?offset=50');assert.equal(observed.heading,'A.csv');assert.match(observed.rows,/A source 50/);assert.doesNotMatch(observed.rows,/B source/);
   await page.keyboard.press('Enter');await page.locator('[data-history=rows-next]:not(:disabled)').waitFor();assert.equal(calls.at(-1),'/api/v1/imports/leave/history/A?offset=0');
   failB=false;await open('B').focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'B.csv',exact:true}).waitFor();await page.locator('[data-history=rows-next]').focus();await page.keyboard.press('Enter');await page.getByText(/B source 50/).waitFor();assert.equal(calls.at(-1),'/api/v1/imports/leave/history/B?offset=50');
   assert.deepEqual(errors,[]);
  }
  results.push({engine,width,observed,failedBatchPreservesPaginationIdentity:!baseline,keyboardBoundaryPreviousCorrect:!baseline,explicitRetrySelectsNewBatch:!baseline,selectedMonth:'2026-10',writes:0});await page.close();
 }}finally{await browser.close();}
}
assert.equal(await hash(),initial);
await writeFile('../docs/premium-ui/'+(baseline?'qa-history-batch-context-before.json':'qa-history-batch-context.json'),JSON.stringify({source_sha256:{'frontend/src/workflow-import-history.ts':initial},scope:'Actual exported import history with two fixture batches. GET only; failed batch switch must preserve current row/page target, explicit successful retry changes it. Three engines320/1280; no backendwrites or persisteddata change.',results},null,2)+'\n');
console.log(`History batch context ${baseline?'baseline':'outcomes'}:${results.length}`);
