import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const paths=['src/member-workspace.ts','src/premium-theme.css','src/styles.css','tests/premium-profile-tab-pointer-proof.browser.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')]))),initial=await hashes();
const member={id:'pointer-target',canonical_name:'Context Person 30',active_status:'active',call_level:'2ND_CALL',aliases:[{id:'alias',alias:'Existing spelling',source:'manual'}],designations:[{id:'position',designation:'Registrar',effective_from:'2026-01-01',effective_to:null,source:'manual',notes:'Original position note'}],call_level_changes:[],revision:'original-one'};
for(const[engine,launcher]of Object.entries(process.env.PROFILE_POINTER_ENGINES?Object.fromEntries(process.env.PROFILE_POINTER_ENGINES.split(',').map(n=>[n,{chromium,firefox,webkit}[n]])):{chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const input of['click','tap']){
  const page=await browser.newPage({viewport:{width,height:900},hasTouch:input==='tap'}),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__profile_pointer',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open profile</button></body></html>'}));
  await page.route('**/api/**',r=>{const q=r.request(),p=new URL(q.url()).pathname;assert.equal(q.method(),'GET');return r.fulfill({json:p.endsWith('/pointer-target')?{member,impact:{future_duties:2,current_or_future_postings:3,eligibility_memberships:1}}:{rows:[]}});});
  await page.goto(base+'/__profile_pointer');await page.evaluate(()=>{
   window.__pointerEvents=[];
   const nodeIds=new WeakMap();let nodeSeq=0;const nodeId=n=>{if(!nodeIds.has(n))nodeIds.set(n,++nodeSeq);return nodeIds.get(n);};const name=n=>n instanceof Element?{nodeId:nodeId(n),connected:n.isConnected,...{tag:n.tagName,tab:n.closest('[data-tab]')?.getAttribute('data-tab'),field:n.getAttribute('data-field'),designation:n.getAttribute('data-d'),text:n.textContent?.slice(0,65)}}:null;
   for(const type of ['pointerdown','pointerup','click','touchstart','touchend','focusin','focusout'])document.addEventListener(type,e=>{const rail=document.querySelector('.mw-rail');window.__pointerEvents.push({type,target:name(e.target),x:e.clientX??null,y:e.clientY??null,selected:document.querySelector('[data-tab][aria-selected=true]')?.getAttribute('data-tab'),railScrollLeft:rail?.scrollLeft,active:name(document.activeElement)});if(type==='pointerdown'||type==='pointerup'){const target=e.target;queueMicrotask(()=>window.__pointerEvents.push({type:type+'-microtask',target:name(target),active:name(document.activeElement)}));}},true);
   for(const type of ['scroll','resize'])visualViewport?.addEventListener(type,()=>window.__pointerEvents.push({type:'visualViewport-'+type,active:name(document.activeElement),railScrollLeft:document.querySelector('.mw-rail')?.scrollLeft}));
   document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('pointer-target',true,()=>{},[],'details'));
  });
  const activate=node=>input==='tap'?node.tap():node.click();
  await activate(page.locator('#open'));const dialog=page.locator('dialog.member-workspace');await activate(dialog.locator('[data-edit]'));
  await dialog.locator('[data-field=canonical_name]').fill('Updated Canonical Member');
  await activate(dialog.locator('[data-tab=roles]'));await dialog.locator('[data-d="0"][data-key=designation]').fill('Senior Registrar');await dialog.locator('[data-d="0"][data-key=notes]').fill('Reviewed position note');
  const before=await dialog.evaluate(d=>{const rail=d.querySelector('.mw-rail');return{selected:d.querySelector('[data-tab][aria-selected=true]')?.getAttribute('data-tab'),railScrollLeft:rail.scrollLeft,railRect:rail.getBoundingClientRect().toJSON(),detailsRect:d.querySelector('[data-tab=details]').getBoundingClientRect().toJSON(),rolesRect:d.querySelector('[data-tab=roles]').getBoundingClientRect().toJSON(),active:document.activeElement?.outerHTML};});
  await activate(dialog.locator('[data-tab=details]'));
  const immediate=await dialog.evaluate(d=>({selected:d.querySelector('[data-tab][aria-selected=true]')?.getAttribute('data-tab'),canonicalFields:d.querySelectorAll('[data-field=canonical_name]').length,railScrollLeft:d.querySelector('.mw-rail').scrollLeft,detailsRect:d.querySelector('[data-tab=details]').getBoundingClientRect().toJSON()}));
  await page.waitForTimeout(150);
  const settled=await dialog.evaluate(d=>({selected:d.querySelector('[data-tab][aria-selected=true]')?.getAttribute('data-tab'),canonicalFields:d.querySelectorAll('[data-field=canonical_name]').length,railScrollLeft:d.querySelector('.mw-rail').scrollLeft,detailsRect:d.querySelector('[data-tab=details]').getBoundingClientRect().toJSON()}));
  const events=await page.evaluate(()=>window.__pointerEvents),passed=settled.selected==='details'&&settled.canonicalFields===1;
  results.push({engine,width,input,before,immediate,settled,events,passed,errors});console.log(`Profile tab pointer ${engine} ${width} ${input}: ${passed?'PASS':'OBSERVED FAILURE'}`);await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../tmp/profile131-pointer-proof.json',JSON.stringify({source_sha256:initial,scope:'Native Playwright click/tap only; no force or synthetic dispatch or keyboard substitute. Passive capture records actual pointer/touch/click event targets and rail coordinates. Observed failures are evidence, not converted into harness conclusions.',results},null,2)+'\n');
console.log(`Pointer proof: ${results.filter(r=>r.passed).length}/${results.length} roundtrips reached Details`);
