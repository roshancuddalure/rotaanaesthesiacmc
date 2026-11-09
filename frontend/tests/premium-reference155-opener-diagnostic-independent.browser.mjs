import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),source='src/reference-workspace.ts',before=sha(await readFile(source)),results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const input of ['pointer','keyboard']){
  const page=await browser.newPage({viewport:{width:320,height:700}});const writes=[];
  try{
   await page.route('**/__reference_opener155',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open references</button></body></html>'}));
   await page.route('**/api/**',r=>{const q=r.request();if(q.method()!=='GET'){writes.push(q.method());return r.abort();}assert.equal(new URL(q.url()).pathname,'/api/v1/normalization/catalog/campus');return r.fulfill({json:[]});});
   await page.goto('http://127.0.0.1:5197/__reference_opener155');await page.evaluate(async()=>{const m=await import('/src/reference-workspace.ts');document.querySelector('#open').onclick=()=>m.openReferenceCatalog(()=>{},'campus');});
   if(input==='keyboard'){await page.locator('#open').focus();await page.keyboard.press('Enter');}else await page.locator('#open').click();
   const dialog=page.getByRole('dialog',{name:'Reference labels and mappings',exact:true});await dialog.locator('[name=key]').waitFor();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});
   const actual=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id}));
   assert.deepEqual(actual,engine==='webkit'&&input==='pointer'?{tag:'BODY',id:''}:{tag:'BUTTON',id:'open'});assert.deepEqual(writes,[]);
   results.push({engine,input,actual,returnsExactOpener:actual.id==='open',writes});
  }finally{await page.close();}
 }}finally{await browser.close();}
}
assert.equal(sha(await readFile(source)),before);
await writeFile('../docs/premium-ui/qa-reference155-opener-diagnostic-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/picker150155156_acceptance_audit',test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:{['frontend/'+source]:before},scope:'Diagnostic actual catalog controller: pointer or keyboard opener/Cancel. WebKit pointer returnsBODY; keyboard returns exact opener all3engines. This positive diagnostic does not certify pointer behavior correct. Reference module byteidentical to historical pre-picker source78c231; picker helper not involved. All reads locallyfulfilled,no writes.',results,limits:['Existing pointer focus defect remains broader260 accessibility work;155 exact cataloglabel/validation/save conditions do not become pointerfocus acceptance.','No physical/nativeAT claim.']},null,2)+'\n');console.log('Reference opener diagnostic:6states recorded,WebKit pointerBODY reproduced.');
