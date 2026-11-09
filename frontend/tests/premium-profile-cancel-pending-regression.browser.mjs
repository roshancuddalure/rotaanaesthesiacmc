import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const paths=['src/member-workspace.ts','src/ui.ts','src/form-validation.ts','src/workspace-load-state.ts','src/services/api.ts','src/styles.css','src/premium-theme.css','tests/premium-profile-cancel-pending-regression.browser.mjs'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));
const initial=await hashes(),results=[];
const engines=process.env.CANCEL_REGRESSION_ENGINES?.split(',')||['chromium','firefox','webkit'];
const widths=process.env.CANCEL_REGRESSION_WIDTHS?.split(',').map(Number)||[320,1280];
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function bounded(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),12000);})]);}finally{clearTimeout(timer);}}
const activate=async(page,node)=>{await node.focus();await page.keyboard.press('Enter');};
const original={id:'cancel-regression',canonical_name:'Dr Original Member',active_status:'active',call_level:'2ND_CALL',revision:'original-one',aliases:[{id:'alias-one',alias:'Original spelling',source:'manual'}],designations:[],call_level_changes:[]};
const attempted='Dr Submitted Draft';
const current={...original,canonical_name:'Dr Concurrent Saved Member',revision:'current-two'};
const body={...original,canonical_name:attempted,aliases:['Original spelling'],preserve_previous_name:true};

for(const engine of engines){const browser=await({chromium,firefox,webkit})[engine].launch();
 try{for(const width of widths)for(const outcome of ['503','409','success']){
  const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(12000);
  const started=deferred(),release=deferred(),puts=[],requests=[],prompts=[],errors=[];
  let accept=false,responseReleased=false;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',async d=>{prompts.push({type:d.type(),message:d.message()});await(accept?d.accept():d.dismiss());});
  await page.route('**/__cancel_pending_regression',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open member</button></body></html>'}));
  await page.route('**/api/**',async route=>{
   const q=route.request(),path=new URL(q.url()).pathname;requests.push({method:q.method(),path});assert.equal(path,'/api/v1/admin/member-workspace/'+original.id);
   if(q.method()==='GET')return route.fulfill({json:{member:original,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
   assert.equal(q.method(),'PUT');puts.push(q.postDataJSON());assert.deepEqual(puts.at(-1),body);started.resolve();await bounded(release.promise,'PUT fixture release');responseReleased=true;
   if(outcome==='503')return route.fulfill({status:503,json:{detail:'Pending save diagnostic refusal'}});
   if(outcome==='409')return route.fulfill({status:409,json:{detail:{message:'Member changed concurrently',current}}});
   return route.fulfill({json:{...original,canonical_name:attempted,revision:'saved-two'}});
  });
  await page.goto(base+'/__cancel_pending_regression');
  await page.evaluate(()=>{window.__changes=[];document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('cancel-regression',true,value=>window.__changes.push(value),[],'details'));});
  await activate(page,page.locator('#open'));const dialog=page.locator('dialog.member-workspace');
  await dialog.locator('[data-edit]').waitFor().catch(async error=>{throw Error(`${error.message}; pageerrors=${JSON.stringify(errors)}; UI=${await page.locator('body').innerText()}; requests=${JSON.stringify(requests)}`);});
  await activate(page,dialog.locator('[data-edit]'));await dialog.locator('[data-field=canonical_name]').fill(attempted);
  await activate(page,dialog.getByRole('button',{name:'Save changes',exact:true}));await bounded(started.promise,'PUT fixture arrival');
  const cancel=dialog.locator('[data-cancel-edit]'),field=dialog.locator('[data-field=canonical_name]');
  const pendingField=await field.elementHandle(),pendingCancel=await cancel.elementHandle(),pendingForm=await dialog.locator('#mw-form').elementHandle();
  assert.equal(responseReleased,false);assert.equal(await cancel.isDisabled(),true);assert.equal(await dialog.getByRole('button',{name:'Saving\u2026',exact:true}).isDisabled(),true);
  // Keyboard activation is attempted on the actual disabled Cancel; no synthetic click.
  await cancel.focus();await page.keyboard.press('Enter');
  assert.equal(prompts.length,0);assert.equal(puts.length,1);assert.equal(await field.inputValue(),attempted);
  assert.equal(await dialog.locator('[data-edit]').count(),0);assert.equal(await dialog.getByRole('button',{name:'Saving\u2026',exact:true}).count(),1);
  await activate(page,dialog.locator('[data-close]').first());assert.equal(await dialog.evaluate(n=>n.open),true);assert.equal(prompts.length,0);
  assert.equal(await field.evaluate((n,old)=>n===old,pendingField),true);assert.equal(await cancel.evaluate((n,old)=>n===old,pendingCancel),true);
  const response=page.waitForResponse(r=>r.request().method()==='PUT');release.resolve();await response;
  if(outcome==='success'){
   await dialog.getByRole('heading',{name:attempted,exact:true}).waitFor();await dialog.locator('[data-edit]').waitFor();
   assert.equal(await dialog.locator('[data-cancel-edit]').count(),0);assert.equal(await field.inputValue(),attempted);
   assert.deepEqual(await page.evaluate(()=>window.__changes.map(m=>({id:m.id,revision:m.revision,name:m.canonical_name}))),[{id:original.id,revision:'saved-two',name:attempted}]);
  }else{
   if(outcome==='503')await dialog.locator('#mw-error').filter({hasText:'Pending save diagnostic refusal'}).waitFor();
   else await dialog.getByRole('heading',{name:'Compare changes',exact:true}).waitFor();
   await page.waitForFunction(()=>document.querySelector('[data-cancel-edit]')?.disabled===false);
   assert.equal(await cancel.isEnabled(),true);assert.equal(await dialog.getByRole('button',{name:'Save changes',exact:true}).isEnabled(),true);
   assert.equal(await field.inputValue(),attempted);assert.equal(await field.isEditable(),true);assert.equal(await page.evaluate(()=>window.__changes.length),0);
   assert.equal(await field.evaluate((n,old)=>n===old,pendingField),true,'Refusal unlocks without replacing draft field');
   assert.equal(await cancel.evaluate((n,old)=>n===old,pendingCancel),true,'Targeted finally unlock retains Cancel node');
   assert.equal(await dialog.locator('#mw-form').evaluate((n,old)=>n===old,pendingForm),true,'Refusal retains editor form');
   if(outcome==='409'){
    const comparison=dialog.locator('#mw-error');assert.match(await comparison.innerText(),/Dr Concurrent Saved Member/);assert.match(await comparison.innerText(),/Dr Submitted Draft/);
    await activate(page,dialog.getByRole('button',{name:'Keep my draft for review',exact:true}));
    assert.equal(await field.inputValue(),attempted);assert.match(await dialog.locator('#mw-error').innerText(),/Latest version loaded for comparison/);
   }
   const before=prompts.length;accept=false;await activate(page,cancel);assert.equal(prompts.length,before+1);assert.deepEqual(prompts.at(-1),{type:'confirm',message:'Discard unsaved changes?'});
   assert.equal(await field.inputValue(),attempted);assert.equal(await field.isEditable(),true);assert.equal(puts.length,1);
   accept=true;await activate(page,cancel);assert.equal(prompts.length,before+2);await dialog.locator('[data-edit]').waitFor();
   assert.equal(await field.inputValue(),outcome==='409'?current.canonical_name:original.canonical_name);assert.equal(await field.isEditable(),false);assert.equal(puts.length,1);
  }
  assert.equal(puts.length,1);assert.deepEqual(errors,[]);
  results.push({engine,width,outcome,pendingCancelDisabledAndAttemptedKeyboardNoDiscard:true,pendingDraftAndSavingIndicatorRetained:true,closeBusyGuardRetained:true,exactOnePut:puts[0],failureRetainsFieldCancelFormNodesAndUnlocks:outcome!=='success',conflictCompareKeepDraftThenIdleDiscard:outcome==='409',idleDiscardDeclineAcceptPreserved:outcome!=='success',successChangedCallbackOnce:outcome==='success',prompts,requests});
  console.log(`Pending Cancel regression ${engine} ${width} ${outcome}`);await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Final app and test source hold retained');
await writeFile('../docs/premium-ui/qa-profile-cancel-pending-regression.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,status:'Scoped final regression evidence; not whole requirement131 acceptance',scope:'Actual native canonical profile edit/heldPUT, attempted keyboard interaction with disabled Cancel (no claim that disabled control receives focus), existing Close busy guard, separate503/409/success responses, retained nodes/draft and targeted finally unlock, conflict comparison/Keep my draft, idle discard decline/accept and exact original PUT. All API responses locally fulfilled; no actual backend persistence or request-abort policy claim. Immutable before-fix reproduction remains separate.',results},null,2)+'\n');
console.log(`Pending Cancel regression: ${results.length} workflows passed`);
