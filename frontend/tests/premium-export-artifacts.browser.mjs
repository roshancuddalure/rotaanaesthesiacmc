import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const files=['src/services/api.ts','src/main.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const before=await hashes(),results=[];
for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const [name,view,selector,path] of [
  ['Final Excel','rota-publish','#download-rota-export','/api/v1/rota-publish/export'],
  ['Eagle eye Excel','rota-template','#download-eagle-eye-export','/api/v1/rota-template/eagle-eye-export'],
  ['Call-wise template Excel','rota-template','#download-call-wise-template-export','/api/v1/rota-template/call-wise-export'],
 ]){
  const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[],downloads=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d));
  let mode='empty',exportReads=0,releaseStall;
  const expected=Buffer.from('PK\x03\x04-controlled-original-export-bytes\0\x01'),filename='reviewed-export.xlsx';
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','export-artifact-review');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(req.method(),'GET','No mutations permitted');
   if(url.pathname===path){exportReads++;if(mode==='stalled')return new Promise(resolve=>{releaseStall=()=>route.abort().catch(()=>{}).finally(resolve);});assert.equal(url.searchParams.get('month'),'2026-05');const bodies={empty:Buffer.alloc(0),html:Buffer.from('<html>Service unavailable</html>'),json:Buffer.from('{"detail":"Service unavailable"}'),disguised:Buffer.from('not a spreadsheet'),valid:expected};return route.fulfill({status:200,contentType:mode==='html'?'text/html':mode==='json'?'application/json':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers:{'Content-Disposition':`attachment; filename="${filename}"`},body:bodies[mode]});}
   const response=await route.fetch({url:api+url.pathname+url.search});
   if(url.pathname==='/api/v1/rota-publish/month'){
    const data=await response.json();data.latest_publish={status:'published',approved_by:'Fixture board',created_at:'2026-05-31T10:00:00Z',confirmed_warnings:true,approval_note:'Already reviewed fixture'};
    return route.fulfill({json:data});
   }
   return route.fulfill({response});
  });
  await page.goto(base+'/#view='+view);await page.locator(selector).waitFor({state:'attached'});
  async function openExport(){if(view==='rota-template'){const summary=page.getByLabel('Export rota',{exact:true});if(!await summary.evaluate(el=>el.parentElement.open))await summary.click();}}
  await openExport();await page.locator(selector).click();
  await page.getByRole('alert').filter({hasText:'The server returned an empty download.'}).waitFor();
  await page.locator(selector+':not(:disabled)').waitFor({state:'attached'});
  assert.equal(exportReads,1);assert.equal(downloads.length,0,'Empty bytes must not create a file');assert.equal(await page.getByText(name+' export sent to your browser',{exact:true}).count(),0);
  for(const invalid of ['html','json','disguised']){mode=invalid;await openExport();await page.locator(selector).click();await page.getByRole('alert').filter({hasText:'The server did not return an Excel workbook.'}).last().waitFor();await page.locator(selector+':not(:disabled)').waitFor({state:'attached'});assert.equal(downloads.length,0,'Invalid content must not download or report success');assert.equal(await page.getByText(name+' export sent to your browser',{exact:true}).count(),0);}
  await page.clock.install();mode='stalled';await openExport();const stalledRequest=page.waitForRequest(request=>new URL(request.url()).pathname===path);await page.locator(selector).click();await stalledRequest;await page.clock.runFor(120001);await page.getByRole('alert').filter({hasText:'The download took too long.'}).waitFor();await page.locator(selector+':not(:disabled)').waitFor({state:'attached'});assert.equal(downloads.length,0);assert.equal(exportReads,5,'Timed-out read is not replayed');releaseStall?.();await page.clock.resume();
  mode='valid';await openExport();const downloading=page.waitForEvent('download');await page.locator(selector).click();const download=await downloading;
  assert.equal(download.suggestedFilename(),filename);assert.deepEqual(await readFile(await download.path()),expected);
  await page.getByText(name+' export sent to your browser',{exact:true}).waitFor();
  assert.equal(downloads.length,1);assert.equal(exportReads,6);assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  results.push({engine,width,view,selector,emptyNoDownloadOrSuccess:true,htmlJsonDisguisedNoDownloadOrSuccess:true,timeoutRestoresControlWithoutReplay:true,explicitRetryOnly:true,exactNonemptyBytesAndFilename:true,truthfulBrowserHandoff:true,exportReads,mutations:0,pageErrors:0});
  await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),before,'Export sources remain frozen during run');
await writeFile('../docs/premium-ui/qa-export-artifacts.json',JSON.stringify({sourceHashes:before,results,scope:'Actual application controls and browser download events. Export bytes are an intercepted transport fixture; no workbook validity, operating-system save completion, physical-device or live database claim.'},null,2)+'\n');
console.log(`Export artifacts: ${results.length} browser/control cases passed`);
