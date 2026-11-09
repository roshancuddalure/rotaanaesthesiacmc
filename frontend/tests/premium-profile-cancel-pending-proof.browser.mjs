import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';

// Read-only product investigation: failed desired-behavior flags are evidence,
// not repaired here. All PUTs are locally fulfilled; nothing reaches a backend.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const paths=['src/member-workspace.ts','src/ui.ts','src/form-validation.ts','src/workspace-load-state.ts','src/services/api.ts','src/styles.css','src/premium-theme.css','tests/premium-profile-cancel-pending-proof.browser.mjs'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async name=>[name,digest(await readFile(name))])));
const initial=await hashes(),results=[];
const engines=process.env.CANCEL_PROOF_ENGINES?.split(',')||['chromium','firefox','webkit'];
const widths=process.env.CANCEL_PROOF_WIDTHS?.split(',').map(Number)||[320,1280];
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function bounded(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),12000);})]);}finally{clearTimeout(timer);}}
const activate=async(page,node)=>{await node.focus();await page.keyboard.press('Enter');};
const original={id:'cancel-pending-member',canonical_name:'Dr Original Member',active_status:'active',call_level:'2ND_CALL',revision:'original-one',aliases:[{id:'alias-one',alias:'Original spelling',source:'manual'}],designations:[],call_level_changes:[]};
const attemptedName='Dr Pending Submitted Change';
const expectedBody={...original,canonical_name:attemptedName,aliases:['Original spelling'],preserve_previous_name:true};
await mkdir('../tmp/profile-cancel-pending-proof',{recursive:true});
for(const engine of engines){const browser=await({chromium,firefox,webkit})[engine].launch();
 try{for(const width of widths)for(const outcome of ['503','success']){
  const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(12000);
  const started=deferred(),release=deferred(),requests=[],puts=[],prompts=[],errors=[];
  let responseReleased=false;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',async dialog=>{prompts.push({type:dialog.type(),message:dialog.message()});await dialog.accept();});
  await page.route('**/__cancel_pending_proof',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open member</button></body></html>'}));
  await page.route('**/api/**',async route=>{
   const q=route.request(),path=new URL(q.url()).pathname;requests.push({method:q.method(),path});
   assert.equal(path,'/api/v1/admin/member-workspace/'+original.id);
   if(q.method()==='GET')return route.fulfill({json:{member:original,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
   assert.equal(q.method(),'PUT');puts.push(q.postDataJSON());assert.deepEqual(puts.at(-1),expectedBody);
   started.resolve();await bounded(release.promise,'Held PUT release');responseReleased=true;
   return outcome==='503'?route.fulfill({status:503,json:{detail:'Pending save diagnostic refusal'}}):route.fulfill({json:{...original,canonical_name:attemptedName,revision:'saved-two'}});
  });
  await page.goto(base+'/__cancel_pending_proof');
  await page.evaluate(()=>{window.__changed=[];document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('cancel-pending-member',true,member=>window.__changed.push(member),[],'details'));});
  await activate(page,page.locator('#open'));const dialog=page.locator('dialog.member-workspace');
  await activate(page,dialog.locator('[data-edit]'));
  await dialog.locator('[data-field=canonical_name]').fill(attemptedName);
  await activate(page,dialog.getByRole('button',{name:'Save changes',exact:true}));await bounded(started.promise,'PUT arrival');
  const snapshot=async()=>({
   responseReleased,
   fieldValue:await dialog.locator('[data-field=canonical_name]').inputValue(),
   fieldEditable:await dialog.locator('[data-field=canonical_name]').isEditable(),
   saveStatus:await dialog.locator('#mw-save-status').innerText(),
   savingButtonCount:await dialog.getByRole('button',{name:'Saving…',exact:true}).count(),
   saveButtonCount:await dialog.getByRole('button',{name:'Save changes',exact:true}).count(),
   cancelCount:await dialog.locator('[data-cancel-edit]').count(),
   editProfileCount:await dialog.locator('[data-edit]').count(),
   error:await dialog.locator('#mw-error').innerText(),
   changedCallbacks:await page.evaluate(()=>window.__changed.length)
  });
  const beforeCancel=await snapshot();
  assert.equal(beforeCancel.responseReleased,false);assert.equal(beforeCancel.fieldValue,attemptedName);
  assert.equal(beforeCancel.savingButtonCount,1);assert.equal(await dialog.getByRole('button',{name:'Saving…',exact:true}).isDisabled(),true);
  assert.equal(await dialog.locator('[data-cancel-edit]').isEnabled(),true,'Observed current-source Cancel remains enabled during a pending PUT');
  await activate(page,dialog.locator('[data-cancel-edit]'));
  assert.deepEqual(prompts,[{type:'confirm',message:'Discard unsaved changes?'}]);
  const afterCancelPending=await snapshot();
  assert.equal(afterCancelPending.responseReleased,false);
  assert.equal(afterCancelPending.fieldValue,original.canonical_name);
  assert.equal(afterCancelPending.fieldEditable,false);
  assert.equal(afterCancelPending.editProfileCount,1);assert.equal(afterCancelPending.savingButtonCount,0);
  assert.equal(afterCancelPending.cancelCount,0);assert.equal(afterCancelPending.saveStatus,'');
  assert.equal(afterCancelPending.changedCallbacks,0);assert.equal(puts.length,1);
  // Close's existing busy guard still rejects leaving this same pending profile.
  await activate(page,dialog.locator('[data-close]').first());assert.equal(await dialog.evaluate(n=>n.open),true);assert.equal(prompts.length,1);
  const screenshot=`../tmp/profile-cancel-pending-proof/${engine}-${width}-${outcome}-after-cancel.png`;
  await page.screenshot({path:screenshot,fullPage:true});
  const response=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname.endsWith('/'+original.id));release.resolve();await response;
  if(outcome==='503')await dialog.locator('#mw-error').filter({hasText:'Pending save diagnostic refusal'}).waitFor();
  else await dialog.getByRole('heading',{name:attemptedName,exact:true}).waitFor();
  const afterResponse=await snapshot();
  if(outcome==='503'){
   assert.equal(afterResponse.fieldValue,original.canonical_name);assert.equal(afterResponse.fieldEditable,false);assert.equal(afterResponse.editProfileCount,1);assert.equal(afterResponse.changedCallbacks,0);
   await activate(page,dialog.locator('[data-edit]'));
   assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),original.canonical_name,'Submitted draft is absent when re-entering edit after refusal');
  }else{
   assert.equal(afterResponse.fieldValue,attemptedName);assert.equal(afterResponse.changedCallbacks,1);
   const changed=await page.evaluate(()=>window.__changed);assert.equal(changed[0].id,original.id);assert.equal(changed[0].revision,'saved-two');
  }
  assert.equal(puts.length,1);assert.deepEqual(errors,[]);
  results.push({engine,width,outcome,beforeCancel,afterCancelPending,afterResponse,requests,puts,prompts,screenshot:screenshot.replace('../',''),observed_issue:true,desired_behavior_checks:{pendingSaveRemainsVisiblyPending:afterCancelPending.savingButtonCount>0,submittedDraftAvailableForFailureRecovery:outcome==='503'?afterResponse.fieldValue===attemptedName:null},conclusion:outcome==='503'?'Accepted Cancel discards submitted draft and removes saving UI while PUT remains pending; refusal leaves view mode and re-entering edit loses attempted value.':'Accepted Cancel removes saving UI and displays original read-only value while PUT remains pending; later success still commits the originally submitted value and invokes changed once. This is not a claim that Cancel should abort the request.'});
  console.log(`Pending canonical Cancel proof ${engine} ${width} ${outcome}`);await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Sealed app and investigation test sources unchanged');
await writeFile('../tmp/profile-cancel-pending-proof/report.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Read-only reproduction against actual native canonical profile form. Current behavior assertions pass, desired-behavior flags intentionally record failure. All GET/PUT responses locally fulfilled; no actual persistence or request-cancellation-policy claim. App not edited.',observed_issue:results.every(r=>r.observed_issue),results},null,2)+'\n');
console.log(`Pending canonical Cancel: reproduced ${results.length} observed workflows; desired pending/draft-recovery flags fail as recorded`);
