import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium, firefox, webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const results=[];
const initialMainHash=createHash('sha256').update(await readFile('src/main.ts')).digest('hex');
for(const [engine,type] of Object.entries({chromium,firefox,webkit})) {
 const browser=await type.launch({headless:true});
 try { for(const width of [320,1280]) {
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
  page.setDefaultTimeout(15000);
  const errors=[],writes=[];let failRead=false,mode='success',release,heldResolve;
  let held=new Promise(resolve=>heldResolve=resolve);
  const groups=[{id:'group-a',key:'GROUP_A',name:'Group Alpha',call_level:'3RD_CALL',description:'Original',active:true,member_count:0,members:[]},{id:'group-b',key:'GROUP_B',name:'Group Beta',call_level:'3RD_CALL',description:null,active:true,member_count:0,members:[]}];
  const people=[{id:'person-a',canonical_name:'Dr Alpha',active_status:'active',call_level:'3RD_CALL'},{id:'person-b',canonical_name:'Dr Beta',active_status:'active',call_level:'2ND_CALL'}];
  await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','eligibility-save-test'));
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;
   if(path.includes('/admin/call-clusters')) {
    if(request.method()!=='GET') {
     writes.push({method:request.method(),path,payload:request.postDataJSON()});
     if(mode==='hold') { await new Promise(resolve=>{release=resolve;heldResolve();}); }
     if(mode==='reject')return route.fulfill({status:422,json:{detail:'Review this group draft'}});
     const id=path.split('/')[5]||'group-new';let group=groups.find(group=>group.id===id);
     if(!group){group={id,key:'GROUP_NEW',member_count:0,members:[]};groups.push(group);}
     if(path.endsWith('/members'))group.members=request.postDataJSON().members;else Object.assign(group,request.postDataJSON());
     return route.fulfill({json:group});
    }
    if(failRead)return route.fulfill({status:503,json:{detail:'Readback temporarily unavailable'}});
    return route.fulfill({json:path.endsWith('/call-clusters')?groups:groups.find(group=>group.id===path.split('/')[5])});
   }
   if(path==='/api/v1/admin/members')return route.fulfill({json:people});
   assert.equal(request.method(),'GET',`No mutation may reach the fixture API: ${path}`);
   return route.fulfill({response:await route.fetch({url:api+path+url.search})});
  });
  const open=async()=>{await page.goto(base+'/#view=call-clusters');await page.locator('#call-cluster-name').waitFor();};
  const hold=()=>{mode='hold';held=new Promise(resolve=>heldResolve=resolve);};
  await open();
  await page.locator('#new-call-cluster').click();await page.waitForFunction(()=>document.querySelector('#call-cluster-id')?.value==='');
  await page.locator('#call-cluster-name').fill(' Created Group ');await page.locator('#call-cluster-description').fill(' New description ');await page.locator('#call-cluster-level').selectOption('3RD_CALL');
  await page.locator('#save-call-cluster').click();await page.waitForFunction(()=>document.querySelector('#call-cluster-id')?.value==='group-new');
  assert.deepEqual(writes[0],{method:'POST',path:'/api/v1/admin/call-clusters',payload:{name:'Created Group',call_level:'3RD_CALL',description:'New description',active:true}});
  mode='reject';await page.locator('#call-cluster-name').fill('Preserved Edit');await page.locator('#save-call-cluster').click();await page.locator('#save-call-cluster:not([disabled])').waitFor();
  assert.equal(await page.locator('#call-cluster-name').inputValue(),'Preserved Edit');assert.equal(await page.locator('#call-cluster-level').isEnabled(),true);
  hold();await page.locator('#save-call-cluster').click();await held;
  const before=writes.length;await page.locator('#call-cluster-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await page.locator('#call-cluster-members-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(writes.length,before);assert.equal(await page.locator('#call-cluster-name').isDisabled(),true);
  assert.deepEqual(writes.at(-1).payload,{name:'Preserved Edit',key:'GROUP_NEW',call_level:'3RD_CALL',description:'New description',active:true});
  failRead=true;mode='success';release();await page.getByRole('heading',{name:'Saved; latest group details unavailable',exact:true}).waitFor();
  failRead=false;while(await page.getByRole('button',{name:'Dismiss notification',exact:true}).count())await page.getByRole('button',{name:'Dismiss notification',exact:true}).first().click();
  await page.locator('[data-call-clusters-retry]').click();await page.locator('#call-cluster-name').waitFor();assert.equal(writes.length,before);assert.equal(await page.locator('#call-cluster-name').inputValue(),'Preserved Edit');
  await page.locator('[data-cluster-member="person-a"]').check();await page.locator('#cluster-effective-from').fill('2026-11-01');
  mode='reject';await page.locator('#save-call-cluster-members').click();await page.locator('#save-call-cluster-members:not([disabled])').waitFor();
  assert.equal(await page.locator('[data-cluster-member="person-a"]').isChecked(),true);assert.equal(await page.locator('#cluster-effective-from').inputValue(),'2026-11-01');assert.equal(await page.locator('[data-cluster-member="person-b"]').isDisabled(),true);
  hold();await page.locator('#save-call-cluster-members').click();await held;
  const memberWrites=writes.length;await page.locator('#call-cluster-members-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(writes.length,memberWrites);
  await page.locator('#call-cluster-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(writes.length,memberWrites);
  assert.deepEqual(writes.at(-1),{method:'PUT',path:'/api/v1/admin/call-clusters/group-new/members',payload:{members:[{person_id:'person-a',effective_from:'2026-11-01',effective_to:null,notes:null}]}});
  failRead=true;mode='success';release();await page.getByRole('heading',{name:'Saved; latest group details unavailable',exact:true}).waitFor();
  assert.match(await page.locator('[data-call-clusters-retry]').getAttribute('data-saved-message'),/Group members saved/);
  failRead=false;while(await page.getByRole('button',{name:'Dismiss notification',exact:true}).count())await page.getByRole('button',{name:'Dismiss notification',exact:true}).first().click();
  await page.locator('[data-call-clusters-retry]').click();await page.locator('#call-cluster-name').waitFor();
  assert.equal(writes.length,memberWrites);assert.equal(await page.locator('[data-cluster-member="person-a"]').isChecked(),true);assert.equal(await page.locator('[data-cluster-member="person-b"]').isDisabled(),true);
  hold();await page.locator('#save-call-cluster-members').click();await held;
  while(await page.getByRole('button',{name:'Dismiss notification',exact:true}).count())await page.getByRole('button',{name:'Dismiss notification',exact:true}).first().click();
  if(width<700)await page.locator('#sidebar-toggle').click();
  await page.getByRole('navigation',{name:'Main navigation',exact:true}).locator('[data-view="overview"]').click();await page.waitForFunction(()=>location.hash.includes('overview'));mode='success';release();await page.getByRole('heading',{name:'CMC Anaesthesia rota board',exact:true}).waitFor();
  await page.waitForLoadState('networkidle');assert.equal(await page.locator('#call-cluster-form').count(),0);
  await open();await page.locator('#call-cluster-name').fill('Late Alpha');hold();await page.locator('#save-call-cluster').click();await held;
  await page.locator('[data-open-call-cluster="group-b"]').click();await page.waitForFunction(()=>document.querySelector('#call-cluster-id')?.value==='group-b');mode='success';release();
  await page.waitForLoadState('networkidle');assert.equal(await page.locator('#call-cluster-id').inputValue(),'group-b');assert.equal(await page.locator('#call-cluster-name').inputValue(),'Group Beta');
  // A refused late mutation must not replace a newer route or leak its failure toast there.
  while(await page.getByRole('button',{name:'Dismiss notification',exact:true}).count())await page.getByRole('button',{name:'Dismiss notification',exact:true}).first().click();
  hold();await page.locator('#call-cluster-name').fill('Late refused route edit');await page.locator('#save-call-cluster').click();await held;
  if(width<700)await page.locator('#sidebar-toggle').click();
  await page.getByRole('navigation',{name:'Main navigation',exact:true}).locator('[data-view="overview"]').click();await page.waitForFunction(()=>location.hash.includes('overview'));mode='reject';release();
  await page.getByRole('heading',{name:'CMC Anaesthesia rota board',exact:true}).waitFor();await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('#call-cluster-form').count(),0);assert.equal(await page.getByText('Review this group draft',{exact:true}).count(),0);
  await open();hold();await page.locator('#call-cluster-name').fill('Late refused group edit');await page.locator('#save-call-cluster').click();await held;
  await page.locator('[data-open-call-cluster="group-a"]').click();await page.waitForFunction(()=>document.querySelector('#call-cluster-id')?.value==='group-a');mode='reject';release();
  await page.waitForLoadState('networkidle');assert.equal(await page.locator('#call-cluster-id').inputValue(),'group-a');assert.equal(await page.locator('#call-cluster-name').inputValue(),'Group Alpha');assert.equal(await page.getByText('Review this group draft',{exact:true}).count(),0);
  hold();await page.locator('#call-cluster-name').fill('Late account edit');await page.locator('#save-call-cluster').click();await held;
  while(await page.getByRole('button',{name:'Dismiss notification',exact:true}).count())await page.getByRole('button',{name:'Dismiss notification',exact:true}).first().click();
  await page.locator('#account-menu-button').click();await page.locator('#sign-out').click();await page.locator('#login-submit').waitFor();mode='success';release();
  // Flush the held network continuation before checking that the signed-out shell remains intact.
  await page.waitForLoadState('networkidle');assert.equal(await page.locator('#login-submit').isVisible(),true);assert.equal(await page.locator('#call-cluster-form').count(),0);
  assert.deepEqual(errors,[]);
  results.push({engine,width,create_exact_payload:true,update_exact_payload:true,membership_exact_payload_and_dates:true,held_duplicate_and_bidirectional_cross_form_submit_blocked:true,validation_preserves_both_drafts:true,group_and_membership_confirmed_save_failed_read_get_only_retry:true,late_success_route_group_and_signed_out_results_ignored:true,late_refusal_route_and_group_results_ignored_without_stale_toast:true,mutation_calls:writes.length,fixture_mutations:0,page_errors:0});
  await context.close();
 }}finally{await browser.close();}
}
const paths=['src/main.ts','tests/premium-eligibility-save.browser.mjs'];
const source_sha256=Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
assert.equal(source_sha256['src/main.ts'],initialMainHash,'App source changed during the browser evidence run');
await writeFile('../docs/premium-ui/qa-eligibility-save.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Actual app with intercepted writes and disposable fixture GETs. Synthetic duplicate submits exercise defensive guards; original submissions and navigation use real controls. Signed-out late response tested; no persistence, server authorization or physical-device certification.',source_sha256,results},null,2)+'\n');
console.log('Eligibility save: 6 browser/width workflows passed; no backend writes');
