import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

// Real native member-profile dialog and pointer/keyboard actions. All writes intercepted.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const browser=await chromium.launch({headless:true}),results=[];
try {
 for(const width of [320,390,1280]) {
  const page=await browser.newPage({viewport:{width,height:850}});
  page.setDefaultTimeout(10000);
  const errors=[];let writes=0;
  const id='11111111-1111-1111-1111-111111111111';
  const profile={member:{id,canonical_name:'Dr Recovery Example',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[]},today:'2026-10-21',current_call_level:'2ND_CALL',can_manage:true,call_history:[],comments:[],postings:[],leaves:[],imports:[],statistics:{official_duties:0,hours24:0,weekend_duties:0}};
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','dialog-review-session'));
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname===`/api/v1/members/${id}/profile`)return route.fulfill({json:profile});
   if(url.pathname===`/api/v1/members/${id}/comments`) {
    writes++;assert.equal(request.postDataJSON().body,'Preserve this unsaved clinical note');
    return route.fulfill({status:401,json:{detail:'Your session has expired'}});
   }
   assert.equal(request.method(),'GET','No unmocked write may reach the fixture');
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=accounts');await page.locator('#account-form').waitFor();
  // Mount the existing real component; all subsequent user actions use actual pointer or keyboard.
  await page.evaluate(async id=>{const {openMemberProfile}=await import('/src/member-profile.ts');await openMemberProfile(id,'computer_admin',async()=>{});},id);
  const dialog=page.locator('#member-profile-dialog');
  const form=dialog.locator('[data-profile-form="comment"]');
  await form.locator('textarea').fill('Preserve this unsaved clinical note');
  await form.getByRole('button',{name:'Add Comment',exact:true}).click();
  const panel=page.locator('#session-expiry-recovery');await panel.waitFor();
  await form.locator('fieldset:not([disabled])').waitFor();
  assert.equal(await dialog.evaluate(el=>el.open),true);
  assert.equal(await form.locator('textarea').inputValue(),'Preserve this unsaved clinical note');
  assert.equal(await panel.evaluate(el=>Boolean(el.closest('dialog[open]'))),true,'Native modal must contain the reachable recovery control');
  page.once('dialog',confirmation=>confirmation.dismiss());
  await panel.getByRole('button',{name:'Sign in again',exact:true}).click();
  assert.equal(await dialog.evaluate(el=>el.open),true);
  assert.equal(await form.locator('textarea').inputValue(),'Preserve this unsaved clinical note');
  assert.equal(writes,1);
  // Prove keyboard activation after a real pointer focus, without scripted click or force.
  const action=panel.getByRole('button',{name:'Sign in again',exact:true});
  assert.equal(await action.evaluate(el=>el===document.activeElement),true);
  page.once('dialog',confirmation=>confirmation.dismiss());await page.keyboard.press('Enter');
  assert.equal(await dialog.evaluate(el=>el.open),true);assert.equal(writes,1);
  page.once('dialog',confirmation=>confirmation.accept());
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  await page.waitForFunction(()=>document.getElementById('session-expiry-recovery')?.parentElement===document.querySelector('.content'));
  assert.deepEqual(errors,[]);
  results.push({width,native_modal_notice_reachable:true,pointer_and_keyboard_decline_preserve_draft:true,notice_survives_profile_rerender:true,notice_returns_to_content_after_close:true,intercepted_writes:writes,backend_writes:0});
  await page.close();
 }
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-session-dialog.json',JSON.stringify({results,scope:'Actual member-profile native dialog; intercepted401 comment submission; explicit confirmation declined; no backend mutations or physical-device claim'},null,2)+'\n');
console.log('Session dialog recovery: 3 responsive native-modal draft and pointer/keyboard workflows passed');
