import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceFiles=['src/member-workspace.ts','src/operational-import.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async p=>['frontend/'+p,sha(await readFile(p))])));
const initial=await hashes(),results=[],artifacts={};
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280]){
  const page=await browser.newPage({viewport:{width,height:900},acceptDownloads:true}),errors=[];let writes=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__template_review',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body></body></html>'}));
  await page.route('**/api/**',r=>{if(r.request().method()!=='GET')writes++;assert.equal(r.request().method(),'GET');return r.fulfill({json:[]});});
  await page.goto('http://127.0.0.1:5197/__template_review');
  const downloads=[];
  for(const kind of ['members','leave','units']){
   await page.evaluate(async kind=>{if(kind==='members')(await import('/src/member-workspace.ts')).openMemberCsvImport(()=>{});else await(await import('/src/operational-import.ts')).openOperationalImport(kind,'2026-10',()=>{},true);},kind);
   const dialog=page.locator('dialog').last(),links=dialog.locator('a[download]');assert.equal(await links.count(),2);
   const filename=kind==='members'?'department-members':kind==='leave'?'leave-records':'unitwise-assignments';
   for(const [index,suffix]of [[0,''],[1,'-example']]){
    const expectedName=filename+suffix+'.csv',expected=await readFile('public/templates/'+expectedName);assert.ok(expected.length>0);
    await links.nth(index).focus();const event=page.waitForEvent('download');await page.keyboard.press('Enter');const download=await event;assert.equal(download.suggestedFilename(),expectedName);const data=await readFile(await download.path());assert.deepEqual(data,expected);
    artifacts[expectedName]={sha256:sha(expected),bytes:expected.length};downloads.push(expectedName);
   }
   assert.equal(await dialog.locator('input[type=file]').inputValue(),'');if(kind!=='members')assert.equal(await dialog.locator('[name=month]').inputValue(),'2026-10');
   await dialog.locator('[data-close]').first().focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'detached'});
  }
  assert.deepEqual(errors,[]);assert.equal(writes,0);results.push({engine,width,downloads,exactArtifactBytes:true,keyboardDownload:true,monthFileContextPreserved:true,mutations:writes});await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-csv-template-artifacts.json',JSON.stringify({source_sha256:initial,contracts:['member-workspace-028','operational-import-006'],scope:'Actual member/leave/unit importer template links.36nativekeyboard downloads across3engines320/1280, exact current publicCSV bytes/filename, no file or month changes. No template edits/backendwrites; not validation of real user spreadsheets.',artifacts,results},null,2)+'\n');
console.log('CSV templates:36 exact downloads in6browser contexts passed');
