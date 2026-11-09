import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280]){
  const page=await browser.newPage({viewport:{width,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.route('**/__unit_modal_lifecycle',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"><nav id="nav"><button>Navigation</button></nav><main><section id="view-root"><button id="manage" data-open-unit-modal="a">Manage unit</button><button data-refresh-unit-board>Refresh postings</button><aside id="already-inert" inert>Previously inert</aside></section></main></div><button id="newer">Newer destination</button></body></html>'}));
   await page.goto('http://127.0.0.1:5217/__unit_modal_lifecycle');
   await page.evaluate(async()=>{
    const {bindUnitModalAccessibility}=await import('/src/unit-modal-accessibility.ts');
    window.controller=new AbortController();window.closeCount=0;window.focusEvents=[];
    document.addEventListener('focusin',e=>window.focusEvents.push(e.target.id||e.target.textContent));
    window.closeUnit=()=>{window.closeCount++;document.querySelector('#unit-management-modal')?.remove();};
    bindUnitModalAccessibility(document.querySelector('#view-root'),window.closeUnit,window.controller.signal);
    window.modalHtml=()=>'<div id="unit-management-modal" class="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="Unit"><button id="close" data-close-unit-modal>Close unit</button><button id="native-opener">Nested editor</button><input id="field" value="Keep value"><button id="last">Last action</button></section></div>';
    window.openUnit=()=>document.querySelector('#view-root').insertAdjacentHTML('beforeend',window.modalHtml());
    document.querySelector('#manage').onclick=window.openUnit;
    document.addEventListener('click',e=>{if(e.target.closest('[data-close-unit-modal]'))window.closeUnit();});
   });
   const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await page.locator('#manage').click();await settle();assert.equal(await page.locator('#close').evaluate(e=>e===document.activeElement),true);
   assert.equal(await page.locator('#nav').evaluate(e=>e.inert),true);assert.equal(await page.locator('#app').evaluate(e=>e.inert),false);assert.equal(await page.locator('#field').inputValue(),'Keep value');
   await page.locator('#last').focus();await page.keyboard.press('Tab');assert.equal(await page.locator('#close').evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#last').evaluate(e=>e===document.activeElement),true);
   await page.locator('#newer').focus();await page.evaluate(()=>window.closeUnit());await settle();assert.equal(await page.locator('#newer').evaluate(e=>e===document.activeElement),true,'Newer deliberate focus wins');assert.equal(await page.locator('#nav').evaluate(e=>e.inert),false);assert.equal(await page.locator('#already-inert').evaluate(e=>e.inert),true);
   await page.locator('#manage').click();await settle();await page.evaluate(()=>{document.querySelector('#view-root').innerHTML='<button id="replacement-manage" data-open-unit-modal="a">Manage replacement</button><button data-refresh-unit-board>Refresh postings</button>'+window.modalHtml();});await settle();await page.keyboard.press('Escape');await settle();assert.equal(await page.locator('#replacement-manage').evaluate(e=>e===document.activeElement),true,'Rerender resolves a fresh corresponding opener');
   await page.evaluate(()=>{document.querySelector('#replacement-manage').focus();window.openUnit();});await settle();
   await page.evaluate(()=>{document.querySelector('#native-opener').focus();const d=document.createElement('dialog');d.id='native';d.innerHTML='<button id="native-close">Close native</button>';document.body.append(d);d.showModal();document.querySelector('#native-close').focus();});
   const beforeNativeClose=await page.evaluate(()=>window.closeCount);await page.keyboard.press('Escape');await settle();assert.equal(await page.locator('#unit-management-modal').count(),1);assert.equal(await page.evaluate(()=>window.closeCount),beforeNativeClose,'Native Escape does not invoke unit closer');await page.evaluate(()=>document.querySelector('#native')?.remove());await settle();
   // Probe the difficult lifetime boundary: the native dialog owns focus while
   // an existing app rerender replaces its unit control and original opener.
   await page.evaluate(()=>{document.querySelector('#native-opener').focus();const d=document.createElement('dialog');d.id='native-replacement';d.innerHTML='<button id="native-replacement-close">Close native</button>';document.body.append(d);d.showModal();document.querySelector('#view-root').innerHTML='<button id="fresh-manage" data-open-unit-modal="a">Fresh manage</button><button data-refresh-unit-board>Refresh postings</button>'+window.modalHtml();});await settle();
   await page.evaluate(()=>{const d=document.querySelector('#native-replacement');d.close();d.remove();});await settle();
   const nativeReplacementRecovery=await page.evaluate(()=>{const e=document.activeElement;return{insideUnit:!!e?.closest('#unit-management-modal'),tag:e?.tagName,id:e?.id};});
   assert.equal(nativeReplacementRecovery.insideUnit,true,'After native close and unit DOM replacement, recover unowned BODY focus to active unit');
   await page.evaluate(()=>{document.querySelector('#native-opener').focus();const d=document.createElement('dialog');d.id='native-newer';d.innerHTML='<button>Native control</button>';document.body.append(d);d.showModal();});await settle();
   await page.evaluate(()=>{const d=document.querySelector('#native-newer');d.addEventListener('close',()=>document.querySelector('#newer').focus(),{once:true});d.close();d.remove();});await settle();assert.equal(await page.locator('#newer').evaluate(e=>e===document.activeElement),true,'Native owner newer close destination wins over fallback');
   await page.evaluate(()=>document.querySelector('#newer').focus());await page.evaluate(()=>window.closeUnit());await settle();assert.equal(await page.locator('#newer').evaluate(e=>e===document.activeElement),true);
   await page.evaluate(()=>{document.querySelector('#fresh-manage').focus();window.openUnit();});await settle();await page.evaluate(()=>window.controller.abort());await settle();assert.equal(await page.locator('#nav').evaluate(e=>e.inert),false);const count=await page.evaluate(()=>window.closeCount);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.closeCount),count,'Aborted helper has no live key listener');await page.evaluate(()=>document.querySelector('#unit-management-modal').remove());await settle();assert.deepEqual(errors,[]);
   results.push({engine,width,controlled_fixture:true,initialClose:true,tabForwardReverse:true,backgroundInertAndPriorStateRestored:true,newerFocusWins:true,rerenderCorrespondingOpener:true,nativeOwnsEscape:true,nativeReplacementRecovery,abortRestoresBackgroundAndStopsHandlers:true,errors});console.log(engine+' '+width+' lifecycle diagnostics recorded');
  }finally{await page.close();}
 }}finally{await browser.close();}
}
const sha=b=>createHash('sha256').update(b).digest('hex');
await writeFile('../docs/premium-ui/qa-unit-modal-accessibility-v6-lifecycle-probe.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),test_sha256:sha(await readFile(new URL(import.meta.url))),helper_sha256:sha(await readFile('../tmp/unit-modal-accessibility-v6/unit-modal-accessibility.ts')),scope:'Controlled helper lifecycle diagnostics, not an app-controller or pass claim for every probe. Native-dialog replacement recovery is recorded without relaxing expected focus ownership. No API, app-source changes, persistence or whole-item certification.',results},null,2)+'\n');
console.log('Lifecycle probe: '+results.length+' contexts; '+results.filter(r=>!r.nativeReplacementRecovery.insideUnit).length+' native-replacement recovery gaps');
