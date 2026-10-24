import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const hash=()=>readFile('src/member-workspace.ts').then(data=>createHash('sha256').update(data).digest('hex')),before=await hash();
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__resize-cleanup',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Resize cleanup</title><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="outside">Outside action</button></body></html>'}));
  await page.route('**/api/**',r=>{writes.push(r.request().method());return r.abort();});
  await page.goto(base+'/__resize-cleanup');
  await page.evaluate(async()=>{
   window.__workspace=await import('/src/member-workspace.ts');
   const Native=window.ResizeObserver;window.__resizeRecords=[];
   window.ResizeObserver=class{
    constructor(callback){this.record={disconnected:false,callback,target:null};window.__resizeRecords.push(this.record);this.native=new Native(callback);}
    observe(target,options){this.record.target=target;this.native.observe(target,options);}
    unobserve(target){this.native.unobserve(target);}
    disconnect(){this.record.disconnected=true;this.native.disconnect();}
   };
   const targets=[window,window.visualViewport].filter(Boolean);window.__resizeListeners=[];
   for(const target of targets){
    const add=target.addEventListener.bind(target),remove=target.removeEventListener.bind(target);
    target.addEventListener=(type,listener,options)=>{if(type==='resize'||type==='scroll')window.__resizeListeners.push({target,type,listener,removed:false});return add(type,listener,options);};
    target.removeEventListener=(type,listener,options)=>{for(const r of window.__resizeListeners)if(r.target===target&&r.type===type&&r.listener===listener)r.removed=true;return remove(type,listener,options);};
   }
  });
  for(const removal of ['native-close','direct-remove']){
   await page.getByRole('button',{name:'Outside action',exact:true}).focus();
   await page.evaluate(()=>{const dialog=window.__workspace.workspaceDialog('Resize lifecycle proof');dialog.innerHTML='<header class="mw-header"><h2>Resize lifecycle proof</h2></header><div class="mw-layout"><nav class="mw-rail" role="tablist"><button role="tab" aria-selected="true">Current section</button></nav><form><div class="mw-content"><input aria-label="Retained field" value="draft"></div></form></div>';window.__dialog=dialog;});
   await page.getByRole('textbox',{name:'Retained field',exact:true}).focus();
   await page.evaluate(removal=>removal==='native-close'?window.__dialog.close():window.__dialog.remove(),removal);
   await page.waitForFunction(()=>window.__resizeRecords.every(record=>record.disconnected)&&window.__resizeListeners.every(record=>record.removed));
   const outside=page.getByRole('button',{name:'Outside action',exact:true});await outside.focus();
   // Invoke a queued callback explicitly after teardown; it must not repaint,
   // move focus or reinstall subscriptions on a removed dialog.
   await page.evaluate(()=>{for(const record of window.__resizeRecords)record.callback([],record);window.dispatchEvent(new Event('resize'));});
   assert.equal(await outside.evaluate(el=>el===document.activeElement),true);assert.equal(await page.locator('dialog').count(),0);
   results.push({engine,removal,observers_disconnected:true,viewport_listeners_removed:true,synthetic_queued_callback_inert:true,newer_focus_preserved:true,api_requests:0});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await page.close();
 }finally{await browser.close();}
}
assert.equal(await hash(),before);
await writeFile('../docs/premium-ui/qa-workspace-resize-cleanup.json',JSON.stringify({source_sha256:{'src/member-workspace.ts':before},scope:'Actual workspaceDialog helper with production CSS; native close and direct removal across three engines. Native observer/listener instrumentation plus explicitly synthetic queued callbacks verify teardown; no physical/assistive/all-dialog claim.',results},null,2)+'\n');
console.log('Workspace resize cleanup6engine/removal outcomes passed');
