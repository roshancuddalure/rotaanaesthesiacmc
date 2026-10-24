// Pending member-create ownership across native repeats, rerenders, route and sign-out.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const probe=process.env.MEMBER_PENDING_PROBE==='1',base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api='http://127.0.0.1:8032',out='../docs/premium-ui/qa-member-create-pending';
const files=['src/main.ts','src/services/api.ts','src/premium-theme.css'];const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>['frontend/'+f,createHash('sha256').update(await readFile(f)).digest('hex')])));
const held=await hashes(),results=[];await mkdir(out,{recursive:true});
const get=async p=>{const r=await fetch(api+p);assert.equal(r.status,200);return r.json();};
for(const [engine,type]of Object.entries(probe?{chromium}:{chromium,firefox,webkit})){
 const browser=await type.launch();try{for(const width of probe?[320]:[320,1280])for(const variant of probe?['navigate']:['navigate','signout']){
  const reset=await fetch(api+'/__equivalence/reset',{method:'POST'});assert.equal((await reset.json()).storage,'disposable-sqlite-memory');
  const original=await get('/api/v1/admin/members'),context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],writes=[];
  let releaseFailure,releaseSuccess,notifyCommitted;const failHeld=new Promise(r=>releaseFailure=r),successHeld=new Promise(r=>releaseSuccess=r),committed=new Promise(r=>notifyCommitted=r);let phase='fail';
  page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','member-pending-guard');localStorage.setItem('duty_rota_working_month','2026-05');});
  await context.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url());if(req.method()==='GET')return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});assert.equal(req.method(),'POST');assert.equal(u.pathname,'/api/v1/admin/members');const call={body:req.postDataJSON()};writes.push(call);if(phase==='fail'){await failHeld;call.status=503;return route.fulfill({status:503,json:{detail:'Synthetic pending refusal'}});}const response=await route.fetch({url:api+u.pathname+u.search});assert.equal(response.status(),200);call.status=200;notifyCommitted();await successHeld;return route.fulfill({response});});
  const panel=page.locator('#member-add-panel'),input=page.locator('#new-member-name'),submit=page.locator('#create-member');
  const activate=async control=>{await control.focus();await page.keyboard.press('Enter');};
  const navigate=async view=>{if(width<=768&&!['overview','leave','units','rota-template'].includes(view)){await activate(page.locator('#mobile-more'));await activate(page.locator(`[data-mobile-more-view="${view}"]`));}else await activate(page.locator(`${width<=768?'.mobile-bottom-nav':'.sidebar'} [data-view="${view}"]`));await page.waitForFunction(()=>!document.querySelector('#view-root [aria-busy=true],#view-root .skeleton'));};
  try{
   await page.goto(base+'/#view=members');await panel.waitFor();if(!await panel.evaluate(el=>el.open))await activate(panel.locator(':scope > summary'));await input.fill('Pending Creation Example');
   const first=page.waitForRequest(r=>r.method()==='POST');await activate(submit);await first;
   if(probe){const repeat=page.waitForRequest(r=>r.method()==='POST');await activate(submit);await repeat;assert.equal(writes.length,2);results.push({engine,width,variant,duplicate_posts_before_response:2,server_mutations:0,observed:true});continue;}
   assert.equal(await submit.isDisabled(),true,'Native repeat prevention');await page.keyboard.press('Enter');assert.equal(writes.length,1);
   const submittedForm=await page.locator('#create-member-form').elementHandle();await activate(page.locator('[data-member-status=all]'));assert.equal(await submittedForm.evaluate(el=>el.isConnected),false,'Scenario replaces the submitted form DOM');assert.equal(await submit.isDisabled(),true,'Rerender keeps pending guard');await input.focus();await page.keyboard.press('Enter');assert.equal(writes.length,1,'Implicit Enter cannot submit rebuilt form');
   assert.match(await page.locator('#member-create-status').innerText(),/Pending Creation Example/);assert.equal(await page.locator('#create-member-form').getAttribute('aria-busy'),'true');
   if(width<=768){await activate(panel.locator(':scope > summary'));await panel.locator(':scope > summary').getByText('Creating',{exact:true}).waitFor();await activate(panel.locator(':scope > summary'));assert.equal(await submit.isDisabled(),true);}
   releaseFailure();await page.getByRole('alert').filter({hasText:'Synthetic pending refusal'}).waitFor();await page.locator('#create-member:not(:disabled)').waitFor();assert.equal(await submit.innerText(),'Add member');assert.equal(await input.inputValue(),'Pending Creation Example');assert.deepEqual(await get('/api/v1/admin/members'),original);
   phase='success';await activate(submit);let deadline;try{await Promise.race([committed,new Promise((_,reject)=>deadline=setTimeout(()=>reject(Error('Save did not reach disposable server')),20000))]);}finally{clearTimeout(deadline);}
   assert.equal(await submit.isDisabled(),true);await input.focus();await page.keyboard.press('Enter');assert.equal(writes.length,2,'Only explicit retry sends second mutation');
   const saved=await get('/api/v1/admin/members');assert.equal(saved.length,5);assert.equal(saved.filter(r=>r.canonical_name==='Pending Creation Example').length,1);assert.deepEqual(saved.filter(r=>r.canonical_name!=='Pending Creation Example'),original);
   if(variant==='navigate'){
    await navigate('overview');await page.waitForFunction(()=>document.querySelector('#section-title')?.textContent?.trim()==='CMC Anaesthesia rota board');releaseSuccess();await page.getByText('Member "Pending Creation Example" created',{exact:true}).waitFor();
    assert.equal(await page.locator('#section-title').innerText(),'CMC Anaesthesia rota board','Late create cannot replace current route');assert.match(page.url(),/#view=overview$/);await navigate('members');await panel.waitFor();if(!await panel.evaluate(el=>el.open))await activate(panel.locator(':scope > summary'));await page.locator('#create-member:not(:disabled)').waitFor();assert.equal(await input.inputValue(),'');
   }else{
    await activate(page.locator('#account-menu-button'));await activate(page.locator('#sign-out'));await page.getByLabel('Username',{exact:true}).waitFor();releaseSuccess();await page.waitForLoadState('networkidle');assert.equal(await page.locator('#member-add-panel').count(),0);assert.equal(await page.getByText('Member "Pending Creation Example" created',{exact:true}).count(),0);assert.equal(await page.locator('body').getByText(/save outcome is not confirmed/).count(),0,'Old completion does not leak error into signed-out UI');
   }
   assert.deepEqual(writes.map(r=>r.status),[503,200]);assert.deepEqual(writes.map(r=>r.body),[{canonical_name:'Pending Creation Example',active_status:'active'},{canonical_name:'Pending Creation Example',active_status:'active'}]);assert.deepEqual(errors,[]);
   results.push({engine,width,variant,repeats_blocked_before_and_after_rerender:true,refusal_restores_original_action:true,explicit_retry_real_save_readback:true,late_completion_preserves_route_or_signed_out_ui:true,request_statuses:[503,200],passed:true});
  }catch(error){console.error({engine,width,variant,writes,errors,text:(await page.locator('body').innerText()).slice(-2300)});await page.screenshot({path:`${out}/failure-${engine}-${width}-${variant}.png`}).catch(()=>{});throw error;}
  finally{releaseFailure();releaseSuccess();await page.waitForLoadState('networkidle').catch(()=>{});await context.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),held);await writeFile(`${out}/${probe?'before':'report'}.json`,JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:probe?'Before-change duplicate native activation with held intercepted refusal;no server writes.':'Pending member-create guard with actual keyboard repeats,rerender,refusal/explicitretry,real RAM save/readback,and held committed completion after route/sign-out. Not every role/duplicate/concurrency case.',source_sha256:held,whole_requirement_completion_proven:false,results},null,2)+'\n');
console.log(`Member pending create:${results.length} contexts complete`);
