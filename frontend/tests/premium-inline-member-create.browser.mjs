import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const baseline=process.env.INLINE_CREATE_BASELINE==='1',results=[];
const hash=async()=>createHash('sha256').update(await readFile('src/operational-import.ts')).digest('hex'),initial=await hash();
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of baseline?[320]:[320,1280]){
  const page=await browser.newPage({viewport:{width,height:850}}),calls=[],errors=[];let release,arrive,refuse=true,hold=true,resolveRelease;
  let pending=new Promise(r=>arrive=r);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__inline_create_review',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Add member</button></body></html>'}));
  await page.route('**/api/**',async r=>{const q=r.request(),path=new URL(q.url()).pathname;
   if(path.endsWith('/resolve')){
    if(!baseline){await new Promise(resolve=>resolveRelease=resolve);return r.fulfill({status:503,json:{detail:'Obsolete name lookup error'}});}
    return r.fulfill({json:{candidates:[]}});
   }
   assert.equal(path,'/api/v1/admin/members');assert.equal(q.method(),'POST');calls.push(q.postDataJSON());if(hold){arrive();await new Promise(resolve=>release=resolve);}
   return r.fulfill(refuse?{status:503,json:{detail:'Member fixture temporarily unavailable'}}:{json:{id:'new-fixture',canonical_name:'Dr New Fixture',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[]}});
  });
  await page.goto('http://127.0.0.1:5197/__inline_create_review');await page.evaluate(()=>{document.querySelector('#open').onclick=async()=>{await(await import('/src/operational-import.ts')).createMemberInline('',m=>{window.memberCreated=m;window.createdCount=(window.createdCount||0)+1;});};});await page.locator('#open').focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog'),form=dialog.locator('form'),save=dialog.getByRole('button',{name:'Create member',exact:true});
  await dialog.locator('[name=canonical_name]').fill('Dr New Fixture');await dialog.locator('[name=call_level]').selectOption('2ND_CALL');await save.focus();await page.keyboard.press('Enter');await pending;
  const observed=await dialog.evaluate(d=>({formBusy:d.querySelector('form').getAttribute('aria-busy'),enabled:[...d.querySelectorAll('input,select,button')].filter(n=>!n.disabled).length,saveText:d.querySelector('[type=submit]').textContent}));
  if(!baseline){
   assert.equal(observed.formBusy,'true');assert.equal(observed.enabled,0);assert.match(observed.saveText,/Creating/);
   for(let i=0;i<100&&!resolveRelease;i++)await page.waitForTimeout(10);assert.equal(typeof resolveRelease,'function');resolveRelease();await page.waitForTimeout(60);assert.equal(await dialog.locator('[data-error]').textContent(),'','Obsolete lookup failure cannot replace creation feedback');
   await form.evaluate(f=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(calls.length,1);
   release();await dialog.locator('[data-error]').filter({hasText:'Member fixture temporarily unavailable'}).waitFor();assert.equal(await dialog.locator('[name=canonical_name]').inputValue(),'Dr New Fixture');assert.equal(await dialog.locator('[name=call_level]').inputValue(),'2ND_CALL');assert.equal(await save.isEnabled(),true);assert.equal(await save.evaluate(n=>n===document.activeElement),true);assert.equal(await form.getAttribute('aria-busy'),null);
   refuse=false;hold=true;pending=new Promise(r=>arrive=r);await save.focus();await page.keyboard.press('Enter');await pending;release();await dialog.waitFor({state:'detached'});await page.waitForFunction(()=>window.createdCount===1);assert.deepEqual(calls,[{canonical_name:'Dr New Fixture',call_level:'2ND_CALL'},{canonical_name:'Dr New Fixture',call_level:'2ND_CALL'}]);assert.equal(await page.evaluate(()=>window.memberCreated.id),'new-fixture');assert.deepEqual(errors,[]);
  }else{release();await dialog.locator('[data-error]').filter({hasText:'Member fixture temporarily unavailable'}).waitFor();}
  results.push({engine,width,observed,pendingNativeControlsLocked:!baseline,pendingDuplicateBlocked:!baseline,refusalPreservesDraftAndFocus:!baseline,manualRetryExactPayload:!baseline,callbackOnceExactMember:!baseline,backendWrites:0});await page.close();
 }}finally{await browser.close();}
}
assert.equal(await hash(),initial);
await writeFile('../docs/premium-ui/'+(baseline?'qa-inline-member-create-before.json':'qa-inline-member-create.json'),JSON.stringify({source_sha256:{'frontend/src/operational-import.ts':initial},contracts:['operational-import-004','operational-import-005'],scope:'Actual inline member editor with interceptedresolve/createPOSTs;3engines320/1280, nativekeyboardheldrequest/refusal/manualretry/exactpayload/callback. No backendpersistence or realidentity creation.',results},null,2)+'\n');console.log(`Inline member create ${baseline?'baseline':'outcomes'}:${results.length}`);
