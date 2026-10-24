import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const sourcePaths=['src/main.ts','src/services/api.ts'];
const hash=async()=>JSON.stringify(Object.fromEntries(await Promise.all(sourcePaths.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')]))));
const before=await hash(),results=[];
const oldPassword='Fixture old password 42!',newPassword='Fixture replacement 43!',code='FIXTURE-ONLY-CODE';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function setup(browser,width,signedIn){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[],calls=[];
 const controls={mode:'success',held:null,release:null};
 page.on('pageerror',e=>errors.push(e.message));
 if(signedIn)await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','auth-forms-fixture'));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(!signedIn&&url.pathname.endsWith('/auth/me')&&!req.headers().authorization?.includes('fixture-token-new'))return route.fulfill({status:401,json:{detail:'Signed out fixture'}});
  if(req.method()==='POST'&&/\/auth\/(change-password|forgot-password|reset-password|sign-in)$/.test(url.pathname)){
   const endpoint=url.pathname.split('/').at(-1),body=req.postDataJSON();
   calls.push({endpoint,body});
   let mode=controls.mode;
   if(mode.startsWith('held')){
    controls.held=endpoint;
    await new Promise(resolve=>controls.release=resolve);
    mode=mode.slice(5);
   }
   if(mode==='validation')return route.fulfill({status:422,json:{detail:'Fixture password requires review'}});
   if(mode==='unavailable')return route.fulfill({status:503,json:{detail:'Fixture recovery temporarily unavailable'}});
   if(mode==='unauthorized')return route.fulfill({status:401,json:{detail:'Fixture expired request'}});
   if(endpoint==='sign-in'){
    const user=await (await fetch(api+'/api/v1/auth/me')).json();
    return route.fulfill({json:{token:body.username==='fixture.new'?'fixture-token-new':'fixture-token-old',user}});
   }
   return route.fulfill({json:endpoint==='forgot-password'?{message:'Fixture recovery instructions ready',reset_token:'UNTRUSTED-DO-NOT-AUTOFILL'}:{status:'ok'}});
  }
  assert.equal(req.method(),'GET','Unmocked mutation must never reach fixture API');
  return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
 });
 await page.goto(base+'/#view=overview');
 await page.locator(signedIn?'#account-menu-button[aria-label="Account: Browser test admin"]':'#login-form').waitFor();
 await page.waitForLoadState('networkidle');
 return {page,errors,calls,controls};
}
async function openPassword(page){
 await page.locator('#account-menu-button').click();
 await page.locator('#change-password').click();
 await page.locator('#current-password').waitFor();
}
async function fillPassword(page,confirm=newPassword){
 await page.locator('#current-password').fill(oldPassword);
 await page.locator('#new-password').fill(newPassword);
 await page.locator('#confirm-password').fill(confirm);
}
async function syntheticSubmit(page,selector){
 await page.locator(selector).evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 await delay(70);
}
async function waitHeld(controls){
 for(let i=0;i<100&&!controls.release;i++)await delay(20);
 assert.equal(typeof controls.release,'function','Intercepted request is held');
}
async function release(controls){controls.release();controls.release=null;controls.held=null;await delay(200);}
async function healthy(page,errors){
 assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'No page overflow');
}

for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of [320,1280]){
  console.log(engine,width,'password-dialog');
  {
   const {page,errors,calls,controls}=await setup(browser,width,true);
   await openPassword(page);
   await page.locator('#change-password-submit').click();
   assert.equal(calls.length,0,'Missing password fields do not send a request');
   await fillPassword(page,'Fixture mismatch 44!');
   await page.locator('#change-password-submit').click();
   assert.equal(calls.length,0,'Mismatched confirmation does not send request');
   await page.locator('#confirm-password').fill(newPassword);
   controls.mode='validation';await page.locator('#change-password-submit').click();
   await page.locator('#change-password-message').filter({hasText:'Fixture password requires review'}).waitFor();
   assert.equal(await page.locator('#current-password').inputValue(),oldPassword);
   assert.equal(await page.locator('#new-password').inputValue(),newPassword);
   assert.equal(await page.locator('#confirm-password').inputValue(),newPassword);
   assert.deepEqual(calls[0],{endpoint:'change-password',body:{current_password:oldPassword,new_password:newPassword}});
   controls.mode='held-success';await page.locator('#change-password-submit').click();await waitHeld(controls);
   assert.equal(await page.locator('#change-password-submit').isDisabled(),true);
   await syntheticSubmit(page,'#change-password-form');assert.equal(calls.length,2,'Synthetic duplicate ignored while pending');
   await page.locator('#change-password-modal [data-close-change-password]').first().click();
   await openPassword(page);await page.locator('#current-password').fill('Fresh draft retained');
   await release(controls);
   assert.equal(await page.locator('#change-password-modal').count(),1,'Late save cannot close reopened dialog');
   assert.equal(await page.locator('#current-password').inputValue(),'Fresh draft retained');
   assert.equal(await page.locator('#new-password').inputValue(),'','Reopened form never receives old secret');
   await fillPassword(page);controls.mode='success';await page.locator('#change-password-submit').click();
   await page.locator('#change-password-modal').waitFor({state:'detached'});
   assert.equal(calls.length,3);assert.deepEqual(calls[2],calls[0]);
   await openPassword(page);await fillPassword(page);controls.mode='held-success';
   await page.locator('#change-password-submit').click();await waitHeld(controls);
   await page.locator('#change-password-modal [data-close-change-password]').first().click();
   await page.locator('#account-menu-button').click();await page.locator('#sign-out').click();
   await page.locator('#login-form').waitFor();await page.locator('#login-username').fill('signed.out.draft');
   await release(controls);
   assert.equal(await page.locator('#login-username').inputValue(),'signed.out.draft','Late password save preserves signed-out form');
   assert.equal(await page.locator('#change-password-modal').count(),0);
   assert.equal(await page.evaluate(()=>localStorage.getItem('duty_rota_auth_token')),null,'Late password save cannot restore signed-out session');
   await healthy(page,errors);await page.close();
   results.push({engine,width,workflow:'password-dialog',missing_and_mismatch_no_request:true,validation_draft_preserved:true,manual_retry_exact_payload:true,held_synthetic_duplicate_ignored:true,closed_reopened_late_save_ignored:true,signed_out_late_save_ignored:true,backend_writes:0});
  }
  {
   console.log(engine,width,'forgot-reset');
   const {page,errors,calls,controls}=await setup(browser,width,false);
   const forgot=()=>page.locator('[data-auth-tab=forgot]');
   const signin=()=>page.locator('[data-auth-tab=signin]');
   await forgot().click();await page.locator('#forgot-submit').click();assert.equal(calls.length,0);
   await page.locator('#forgot-username').fill('fixture.operator');controls.mode='unavailable';await page.locator('#forgot-submit').click();
   await page.locator('#forgot-message').filter({hasText:'Fixture recovery temporarily unavailable'}).waitFor();
   assert.equal(await page.locator('#forgot-username').inputValue(),'fixture.operator');
   controls.mode='success';await page.locator('#forgot-submit').click();
   await page.locator('#forgot-message').filter({hasText:'Fixture recovery instructions ready'}).waitFor();
   assert.equal(await page.locator('#reset-token').inputValue(),'','Unexpected response field cannot autofill recovery code');
   assert.deepEqual(calls[1],{endpoint:'forgot-password',body:{username:'fixture.operator'}});
   const previous=calls.length;
   await page.locator('#reset-submit').click();assert.equal(calls.length,previous,'Native required fields block request');
   await page.locator('#reset-token').fill(code);await page.locator('#reset-password').fill('short');
   await page.locator('#reset-submit').click();assert.equal(calls.length,previous,'Native minimum length blocks request');
   await page.locator('#reset-password').fill(newPassword);controls.mode='unavailable';await page.locator('#reset-submit').click();
   await page.locator('#reset-message').filter({hasText:'Fixture recovery temporarily unavailable'}).waitFor();
   assert.equal(await page.locator('#reset-token').inputValue(),code);
   assert.equal(await page.locator('#reset-password').inputValue(),newPassword);
   assert.deepEqual(calls.at(-1),{endpoint:'reset-password',body:{token:code,new_password:newPassword}});
   controls.mode='held-success';await page.locator('#reset-submit').click();await waitHeld(controls);
   const heldCount=calls.length;await syntheticSubmit(page,'#reset-form');assert.equal(calls.length,heldCount);
   await signin().click();await forgot().click();await page.locator('#reset-token').fill('NEW-FIXTURE-DRAFT');
   await release(controls);await delay(1600);
   assert.equal(await page.locator('#reset-token').inputValue(),'NEW-FIXTURE-DRAFT','Late reset and delayed callback preserve new form');
   await page.locator('#reset-token').fill(code);await page.locator('#reset-password').fill(newPassword);
   controls.mode='success';await page.locator('#reset-submit').click();
   await page.locator('#reset-message').filter({hasText:'Password reset. You can sign in now.'}).waitFor();
   await signin().click();await page.locator('#login-username').fill('login.draft');
   await delay(1650);assert.equal(await page.locator('#login-username').inputValue(),'login.draft','Old success timer cannot reset newer login draft');
   await forgot().click();await page.locator('#forgot-username').fill('fixture.operator');controls.mode='held-success';
   await page.locator('#forgot-submit').click();await waitHeld(controls);
   const forgotCount=calls.length;await syntheticSubmit(page,'#forgot-form');assert.equal(calls.length,forgotCount);
   await signin().click();await forgot().click();await page.locator('#forgot-username').fill('new.operator.draft');
   await release(controls);assert.equal(await page.locator('#forgot-username').inputValue(),'new.operator.draft');
   assert.equal(await page.locator('#forgot-message').textContent(),'','Late recovery instructions do not repaint replaced form');
   await healthy(page,errors);await page.close();
   results.push({engine,width,workflow:'forgot-reset',missing_and_native_minlength_no_request:true,no_response_token_autofill:true,exact_payloads:true,retry_draft_preserved:true,synthetic_duplicates_ignored:true,held_replaced_form_ignored:true,success_timer_preserves_new_login_draft:true,backend_writes:0});
  }
  {
   console.log(engine,width,'signin-races');
   const {page,errors,calls,controls}=await setup(browser,width,false);
   await page.locator('#login-username').fill('fixture.old');await page.locator('#login-password').fill(oldPassword);
   controls.mode='held-success';await page.locator('#login-submit').click();await waitHeld(controls);
   const oldRelease=controls.release;controls.release=null;controls.held=null;
   await syntheticSubmit(page,'#login-form');assert.equal(calls.length,1);
   await page.locator('[data-auth-tab=forgot]').click();await page.locator('#forgot-username').fill('new.recovery.draft');
   oldRelease();await delay(250);
   assert.equal(await page.locator('#forgot-username').inputValue(),'new.recovery.draft');
   assert.equal(await page.evaluate(()=>localStorage.getItem('duty_rota_auth_token')),null,'Detached sign-in must not store old response token');
   await page.locator('[data-auth-tab=signin]').click();await page.locator('#login-username').fill('fixture.old');await page.locator('#login-password').fill(oldPassword);
   await page.locator('#login-submit').click();await waitHeld(controls);
   const obsoleteRelease=controls.release;controls.release=null;controls.held=null;
   await page.locator('[data-auth-tab=forgot]').click();await page.locator('[data-auth-tab=signin]').click();
   await page.locator('#login-username').fill('fixture.new');await page.locator('#login-password').fill(newPassword);
   controls.mode='success';await page.locator('#login-submit').click();await page.locator('#account-menu-button').waitFor();
   obsoleteRelease();await delay(250);
   assert.equal(await page.evaluate(()=>localStorage.getItem('duty_rota_auth_token')),'fixture-token-new','Older response cannot replace latest session');
   assert.equal(await page.locator('#account-menu-button').count(),1);
   assert.deepEqual(calls.map(({endpoint})=>endpoint),['sign-in','sign-in','sign-in']);
   assert.deepEqual(calls.at(-1).body,{username:'fixture.new',password:newPassword});
   await healthy(page,errors);await page.close();
   results.push({engine,width,workflow:'signin-races',exact_payload:true,synthetic_duplicate_ignored:true,detached_response_no_token_or_navigation:true,newest_session_survives_older_response:true,backend_writes:0});
  }
 }}finally{await browser.close();}
}
assert.equal(await hash(),before,'Application source changed while independent suite ran');
await writeFile('../docs/premium-ui/qa-auth-forms-independent.json',JSON.stringify({source_sha256:JSON.parse(before),results,scope:'Actual app controls in three browser engines at two emulated widths. All auth POSTs intercepted; only GETs reach disposable fixture. Synthetic duplicate submissions are explicitly distinguished from pointer actions. No physical-device, real password, credential-security, or native password-manager claim.'},null,2)+'\n');
console.log(`Auth forms independent: ${results.length} browser workflows passed`);

