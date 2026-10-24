import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const baseline=process.env.PROFILE_BASELINE==='1';
const hash=async()=>createHash('sha256').update(await readFile('src/main.ts')).digest('hex');
const initial=await hash(),results=[];
const user=await(await fetch('http://127.0.0.1:8031/api/v1/auth/me')).json();
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of baseline?[320]:[320,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],calls=[];
  let release,held=false,mode='held',latest=user;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','account-profile-fixture'));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/auth/me')&&req.method()==='PUT'){
    const payload=req.postDataJSON();calls.push(payload);
    if(mode==='held'){held=true;await new Promise(resolve=>release=resolve);}
    if(mode==='refusal')return route.fulfill({status:503,json:{detail:'Profile service temporarily unavailable'}});
    latest={...user,...payload};return route.fulfill({json:latest});
   }
   assert.equal(req.method(),'GET','No unmocked mutation');
   if(url.pathname.endsWith('/auth/me'))return route.fulfill({json:user});
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+url.pathname+url.search})});
  });
  await page.goto('http://127.0.0.1:5197/#view=overview');
  await page.locator('#account-menu-button').waitFor();await page.waitForLoadState('networkidle');
  const open=async()=>{await page.locator('#account-menu-button').click();await page.locator('#profile').click();await page.locator('#profile-display-name').waitFor();};
  const close=async()=>{await page.locator('#profile-modal [data-close-profile]').first().focus();await page.keyboard.press('Enter');await page.locator('#profile-modal').waitFor({state:'detached'});};
  const waitHeld=async()=>{for(let i=0;i<100&&!held;i++)await new Promise(r=>setTimeout(r,20));assert.ok(held);};
  await open();await page.locator('#profile-display-name').fill('Old pending profile');await page.locator('#profile-email').fill('old@example.test');
  await page.locator('#profile-submit').click();await waitHeld();
  await close();await open();await page.locator('#profile-display-name').fill('Newer retained draft');
  await page.locator('#profile-display-name').focus();release();await page.waitForTimeout(250);
  const observed={openDialogs:await page.locator('#profile-modal').count(),focus:await page.evaluate(()=>document.activeElement?.id),successToasts:await page.getByText('Profile updated',{exact:true}).count()};
  if(!baseline){
   assert.equal(observed.openDialogs,1);assert.equal(observed.focus,'profile-display-name');assert.equal(observed.successToasts,0);
   assert.equal(await page.locator('#profile-display-name').inputValue(),'Newer retained draft');
   await close();await open();assert.equal(await page.locator('#profile-display-name').inputValue(),user.display_name,'Old response does not replace current user');
   await page.locator('#profile-display-name').fill(' ');await page.locator('#profile-submit').click();assert.equal(calls.length,1);
   await page.getByText('Display name is required.',{exact:true}).waitFor();
   await page.locator('#profile-display-name').fill(' Reviewed profile ');await page.locator('#profile-email').fill('reviewed@example.test');
   mode='refusal';await page.locator('#profile-submit').click();await page.getByText('Profile service temporarily unavailable',{exact:true}).waitFor();
   assert.equal(await page.locator('#profile-display-name').inputValue(),' Reviewed profile ');assert.equal(await page.locator('#profile-submit').isEnabled(),true);
   mode='held';held=false;await page.locator('#profile-submit').click();await waitHeld();
   assert.equal(await page.locator('#profile-form').getAttribute('aria-busy'),'true');
   await page.locator('#profile-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
   await page.waitForTimeout(100);assert.equal(calls.length,3,'Pending duplicate does not send another PUT');
   release();await page.locator('#profile-modal').waitFor({state:'detached'});
   assert.deepEqual(calls.slice(1),[{display_name:'Reviewed profile',email:'reviewed@example.test'},{display_name:'Reviewed profile',email:'reviewed@example.test'}]);
   await open();assert.equal(await page.locator('#profile-display-name').inputValue(),'Reviewed profile');assert.equal(await page.locator('#profile-email').inputValue(),'reviewed@example.test');
   assert.equal(await page.locator('#profile-username').inputValue(),user.username);await close();
   mode='held';held=false;await open();await page.locator('#profile-display-name').fill('Obsolete signed out');await page.locator('#profile-submit').click();await waitHeld();await close();
   await page.locator('#account-menu-button').click();await page.locator('#sign-out').click();await page.locator('#login-form').waitFor();
   const oldSuccessCount=await page.getByText('Profile updated',{exact:true}).count();
   release();await page.waitForTimeout(200);assert.equal(await page.locator('#login-form').count(),1);assert.ok(await page.getByText('Profile updated',{exact:true}).count()<=oldSuccessCount,'Signed-out completion cannot add success feedback');
   assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  }
  results.push({engine,width,observed,retainsNewDialogAndFocus:!baseline,oldResponseCannotReplaceUser:!baseline,validationAndRefusalDraft:!baseline,exactManualRetryPayload:!baseline,pendingDuplicateBlocked:!baseline,successfulReopenValues:!baseline,signedOutLateResponseIgnored:!baseline,backendWrites:0});
  await page.close();
 }}finally{await browser.close();}
}
assert.equal(await hash(),initial,'Source changed during run');
await writeFile('../docs/premium-ui/'+(baseline?'qa-account-profile-before.json':'qa-account-profile-lifetime.json'),JSON.stringify({source_sha256:{'frontend/src/main.ts':initial},scope:'Actual account menu/profile forms; GET-only disposable API with intercepted PUT. Closed/reopened and signed-out late response lifecycle, pending duplicate, validation/refusal/manual retry and current response values. Does not prove backend persistence; no backend writes.',results},null,2)+'\n');
console.log(`Account profile ${baseline?'baseline':'outcomes'}: ${results.length}`);
