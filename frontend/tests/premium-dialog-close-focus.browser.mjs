import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:800}});
  await page.route('**/__dialog_close_review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="opener">Open review</button><label>Next edit<input id="next-edit"></label></body></html>'}));
  await page.route('**/api/v1/**',()=>{throw new Error('Focus fixture needs no API request');});
  await page.goto(base+'/__dialog_close_review');
  await page.evaluate(async()=>{
   const {workspaceDialog}=await import('/src/member-workspace.ts');
   document.querySelector('#opener').onclick=()=>{
    const dialog=workspaceDialog('Close focus review');
    dialog.innerHTML='<button type="button" data-close>Close review</button><button type="button" data-next>Close and continue editing</button>';
    dialog.querySelector('[data-close]').onclick=()=>{dialog.close();dialog.remove();};
    dialog.querySelector('[data-next]').onclick=()=>{dialog.close();dialog.remove();document.querySelector('#next-edit').focus();};
   };
  });
  await page.locator('#opener').click();await page.getByRole('button',{name:'Close review',exact:true}).click();
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
  assert.equal(await page.locator('#opener').evaluate(el=>el===document.activeElement),true,'Ordinary close restores opener');
  await page.locator('#opener').click();await page.getByRole('button',{name:'Close and continue editing',exact:true}).click();
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
  assert.equal(await page.locator('#next-edit').evaluate(el=>el===document.activeElement),true,'Queued close preserves newer focus destination');
  await page.keyboard.type('Retained edit');assert.equal(await page.locator('#next-edit').inputValue(),'Retained edit');
  results.push({width,ordinary_opener_restored:true,newer_destination_preserved:true,actual_pointer_and_keyboard:true,backend_calls:0});
  await page.close();
 }
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-dialog-close-focus.json',JSON.stringify({results,scope:'Real native workspaceDialog; next-destination callback before queued close event'},null,2)+'\n');
console.log('Dialog close focus: 3 responsive ordinary and continued-editing workflows passed');
