// Actual duplicate responses plus bounded injected permission refusal; disposable RAM only.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const probe=process.env.MEMBER_CONFLICT_PROBE==='1',extra=process.env.MEMBER_CONFLICT_EXTRA==='1',base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api='http://127.0.0.1:8032',out='../docs/premium-ui/qa-member-create-conflicts';
const testSha=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const files=['src/main.ts','src/services/api.ts','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>['frontend/'+f,createHash('sha256').update(await readFile(f)).digest('hex')])));
const held=await hashes(),results=[];await mkdir(out,{recursive:true});
const get=async()=>{const r=await fetch(api+'/api/v1/admin/members');assert.equal(r.status,200);return r.json();};
for(const [engine,type]of Object.entries(probe?{chromium}:{chromium,firefox,webkit})){
 const browser=await type.launch();try{for(const width of probe?[320]:[320,1280])for(const variant of probe?['near-navigate','draft-focus']:extra?['near-return','draft-focus-moved']:['exact','near-cancel','near-accept','permission','near-navigate','draft-focus']){
  const reset=await fetch(api+'/__equivalence/reset',{method:'POST'});assert.equal((await reset.json()).storage,'disposable-sqlite-memory');
  const original=await get(),context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'}),page=await context.newPage(),writes=[],dialogs=[],errors=[];
  let release,arrived,releaseRefresh,refreshArrived,holdRefresh=false;const releaseHeld=new Promise(r=>release=r),responseArrived=new Promise(r=>arrived=r),refreshHeld=new Promise(r=>releaseRefresh=r),refreshStarted=new Promise(r=>refreshArrived=r);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',async dialog=>{dialogs.push(dialog.message());if(variant==='near-accept')await dialog.accept();else await dialog.dismiss();});
  await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','member-conflict-test');localStorage.setItem('duty_rota_working_month','2026-05');});
  await context.route('**/api/**',async route=>{
   const req=route.request(),u=new URL(req.url());if(req.method()==='GET'){
    const response=await route.fetch({url:api+u.pathname+u.search});
    if(holdRefresh&&u.pathname==='/api/v1/admin/members'){refreshArrived();await refreshHeld;}
    return route.fulfill({response});
   }
   assert.equal(req.method(),'POST');assert.equal(u.pathname,'/api/v1/admin/members');const row={body:req.postDataJSON()};writes.push(row);
   if(variant==='permission'&&writes.length===1){row.status=403;return route.fulfill({status:403,json:{detail:'Synthetic permission refusal'}});}
   const response=await route.fetch({url:api+u.pathname+u.search});row.status=response.status();
   if(['near-navigate','near-return','draft-focus','draft-focus-moved'].includes(variant)){arrived();await releaseHeld;}
   return route.fulfill({response});
  });
  const panel=page.locator('#member-add-panel'),input=page.locator('#new-member-name'),submit=page.locator('#create-member');
  const activate=async locator=>{await locator.focus();await page.keyboard.press('Enter');};
  const settle=async()=>{await page.waitForLoadState('networkidle');await page.locator('#create-member:not(:disabled)').waitFor();};
  try{
   await page.goto(base+'/#view=members');await panel.waitFor();if(!await panel.evaluate(el=>el.open))await activate(panel.locator(':scope > summary'));
   const name=variant==='exact'?'Safe Member':variant.startsWith('near-')?'Safe Memberr':'Conflict Recovery Example';
   await input.fill(name);await activate(submit);
   if(['near-navigate','near-return','draft-focus','draft-focus-moved'].includes(variant)){
    let timeout;try{await Promise.race([responseArrived,new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('Server response did not arrive')),20000))]);}finally{clearTimeout(timeout);}
    if(variant==='near-navigate'||variant==='near-return'){
     await activate(page.locator(`${width<=768?'.mobile-bottom-nav':'.sidebar'} [data-view="overview"]`));
     await page.waitForFunction(()=>document.querySelector('#section-title')?.textContent?.trim()==='CMC Anaesthesia rota board');
     if(variant==='near-return'){
      if(width<=768){await activate(page.locator('#mobile-more'));await activate(page.locator('[data-mobile-more-view="members"]'));}
      else await activate(page.locator('.sidebar [data-view="members"]'));
      await panel.waitFor();if(!await panel.evaluate(el=>el.open))await activate(panel.locator(':scope > summary'));assert.equal(await submit.isDisabled(),true);
     }
     release();await page.waitForLoadState('networkidle');
     assert.deepEqual(await get(),original);assert.deepEqual(writes.map(r=>r.status),[409]);
     if(probe){assert.equal(dialogs.length,1);results.push({engine,width,variant,stale_confirmation_dialogs:dialogs.length,observed:true});continue;}
     assert.equal(dialogs.length,0,'Late conflict must not prompt after leaving the initiating view');assert.match(page.url(),variant==='near-return'?/#view=members$/:/#view=overview$/);
     if(variant==='near-return'){await settle();assert.equal(await input.inputValue(),name);assert.equal(await page.locator('#create-member-form').getAttribute('aria-busy'),'false');}
    }else{
     await input.fill('Next unsaved draft');await input.focus();await input.evaluate(el=>el.setSelectionRange(4,8));
     holdRefresh=variant==='draft-focus-moved';release();
     if(holdRefresh){await refreshStarted;await page.locator('#account-menu-button').focus();releaseRefresh();}
     await settle();
     assert.equal(await input.inputValue(),'Next unsaved draft');const focus=await page.evaluate(()=>({id:document.activeElement?.id,tag:document.activeElement?.tagName,start:document.activeElement?.selectionStart,end:document.activeElement?.selectionEnd}));
     if(probe){assert.notEqual(focus.id,'new-member-name');results.push({engine,width,variant,focus_after_save:focus,draft_retained:true,observed:true});continue;}
     if(variant==='draft-focus-moved')assert.equal(focus.id,'account-menu-button','Refresh must not steal deliberately moved focus');
     else{assert.equal(focus.id,'new-member-name','Retained focused draft recovers focus after refresh');assert.equal(focus.start,4);assert.equal(focus.end,8);}
    }
   }else if(variant==='near-accept'){
    await settle();assert.equal(dialogs.length,1);assert.match(dialogs[0],/Safe Member/);assert.deepEqual(writes.map(r=>r.status),[409,200]);
    assert.deepEqual(writes.map(r=>r.body),[{canonical_name:name,active_status:'active'},{canonical_name:name,active_status:'active',confirm_distinct:true}]);assert.equal(await input.inputValue(),'');
   }else{
    await settle();assert.equal(await input.inputValue(),name);assert.deepEqual(await get(),original);assert.equal(await page.locator('#create-member-form').getAttribute('aria-busy'),'false');assert.equal(await submit.innerText(),'Add member');
    if(variant==='near-cancel'){assert.equal(dialogs.length,1);assert.equal(await page.getByRole('alert').filter({hasText:/cancelled|created/}).count(),0);}
    else{assert.equal(dialogs.length,0);await page.getByRole('alert').filter({hasText:variant==='exact'?'already exists':'Synthetic permission refusal'}).waitFor();}
    const retryName=variant==='permission'?name:'Explicit Recovery Example';await input.fill(retryName);await activate(submit);await settle();
    assert.deepEqual(writes.map(r=>r.status),[variant==='permission'?403:409,200]);assert.deepEqual(writes.map(r=>r.body),[{canonical_name:name,active_status:'active'},{canonical_name:retryName,active_status:'active'}]);
   }
   if(variant!=='near-navigate'&&variant!=='near-return'){
    const saved=await get(),savedName=variant==='near-accept'?'Safe Memberr':variant==='exact'||variant==='near-cancel'?'Explicit Recovery Example':'Conflict Recovery Example';
    assert.equal(saved.length,original.length+1);assert.equal(saved.filter(r=>r.canonical_name===savedName).length,1);assert.deepEqual(saved.filter(r=>r.canonical_name!==savedName),original);
   }
   assert.deepEqual(errors,[]);results.push({engine,width,variant,statuses:writes.map(r=>r.status),dialogs:dialogs.length,...(variant==='near-navigate'||variant==='near-return'?{original_members_unchanged:true}:{exact_saved_member_readback:true}),passed:true});
  }catch(error){console.error({engine,width,variant,writes,dialogs,errors,text:(await page.locator('body').innerText()).slice(-1800)});throw error;}
  finally{release();releaseRefresh();await page.waitForLoadState('networkidle').catch(()=>{});await context.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),held);await writeFile(`${out}/${probe?'before':extra?'report-extra':'report'}.json`,JSON.stringify({recorded_at_utc:new Date().toISOString(),target_url:base,test_sha256:testSha,scope:probe?'Observed stale near-duplicate dialog and retained-draft focus loss before frontend fixes.':extra?'Late near-duplicate after leaving/returning Members; deliberate focus movement during held successful refresh. Three engines,two widths; disposable RAM admin.':'Actual exact/near duplicate responses, explicit different-person confirmation/cancellation, injected403 recovery, late conflict route boundary and retained-draft focus. Three engines, two widths; disposable RAM admin, not real permission/all-role certification.',source_sha256:held,whole_requirement_completion_proven:false,results},null,2)+'\n');
console.log(`Member create conflicts:${results.length} contexts complete`);
