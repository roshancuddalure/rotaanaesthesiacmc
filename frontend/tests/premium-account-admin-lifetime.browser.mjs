import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const baseline=process.env.ACCOUNT_ADMIN_BASELINE==='1',results=[];
const hash=async()=>createHash('sha256').update(await readFile('src/main.ts')).digest('hex'),initial=await hash();
const user=await(await fetch('http://127.0.0.1:8031/api/v1/auth/me')).json();
const target={...user,id:'fixture-target',username:'fixture.target',display_name:'Recovery fixture',role:'rota_board_member',role_label:'Rota board member',active_status:'active'};
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of baseline?[320]:[320,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),calls=[],prompts=[],errors=[];
  let mode='held',release,held=false,failList=false,created=false,accept=true;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',async dialog=>{if(dialog.type()==='confirm'){await(accept?dialog.accept():dialog.dismiss());}else{prompts.push(dialog.message());await dialog.dismiss();}});
  await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','admin-account-fixture'));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()==='POST'&&(url.pathname.endsWith('/recovery-code')||url.pathname.endsWith('/auth/accounts'))){
    calls.push({path:url.pathname,body:req.postData()?req.postDataJSON():null});
    if(mode==='held'){held=true;await new Promise(resolve=>release=resolve);}
    if(mode==='refusal')return route.fulfill({status:503,json:{detail:'Account action temporarily unavailable'}});
    if(url.pathname.endsWith('/recovery-code'))return route.fulfill({json:{reset_token:'FIXTURE-NOT-REAL-RECOVERY',expires_in_minutes:20}});
    created=true;return route.fulfill({json:{...target,id:'created',username:'created.fixture',display_name:'Created Fixture'}});
   }
   assert.equal(req.method(),'GET','No unmocked mutation');
   if(url.pathname.endsWith('/auth/accounts'))return route.fulfill(failList?{status:503,json:{detail:'Account list temporarily unavailable'}}:{json:created?[target,{...target,id:'created',username:'created.fixture'}]:[target]});
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+url.pathname+url.search})});
  });
  const visit=async()=>{await page.goto('http://127.0.0.1:5197/#view=accounts');await page.locator('#account-form').waitFor();await page.waitForLoadState('networkidle');};
  const waitHeld=async()=>{for(let i=0;i<100&&!held;i++)await new Promise(r=>setTimeout(r,20));assert.ok(held);};
  const recovery=()=>page.locator('[data-account-recovery="fixture-target"]:visible').first();
  const overview=()=>page.locator(`${width===320?'.mobile-bottom-nav':'.sidebar'} [data-view=overview]`).first();
  await visit();accept=false;await recovery().click();assert.equal(calls.length,0);accept=true;
  await recovery().click();await waitHeld();
  if(!baseline){await recovery().evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));await page.waitForTimeout(80);assert.equal(calls.length,1,'Pending recovery duplicate blocked');}
  await overview().click();await page.waitForURL('**/#view=overview');release();await page.waitForTimeout(220);
  const latePromptCount=prompts.length;
  if(!baseline){
   assert.equal(latePromptCount,0,'Recovery code must not appear after leaving its account context');
   await visit();mode='refusal';await recovery().click();await page.getByText('Account action temporarily unavailable',{exact:true}).waitFor();assert.equal(await recovery().isEnabled(),true);
   mode='success';await recovery().click();for(let i=0;i<100&&!prompts.length;i++)await page.waitForTimeout(20);assert.equal(prompts.length,1);assert.match(prompts[0],/fixture.target.*20 minutes/);
   assert.ok(calls.every(c=>c.path==='/api/v1/auth/accounts/fixture-target/recovery-code'));
   await page.locator('#account-username').fill('created.fixture');await page.locator('#account-display').fill('Created Fixture');await page.locator('#account-password').fill('Fixture temporary password 42!');await page.locator('#account-role').selectOption('hod');
   mode='held';held=false;await page.locator('#create-account').click();await waitHeld();
   await page.locator('#account-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await page.waitForTimeout(80);assert.equal(calls.filter(c=>c.path.endsWith('/auth/accounts')).length,1);
   failList=true;release();await page.getByText(/Account created.*account list could not be refreshed/).waitFor();
   assert.equal(await page.locator('#account-form').count(),0,'Confirmed creation cannot be submitted again from stale form');
   const beforeRetry=calls.length;failList=false;await page.locator('[data-retry-accounts]').click();await page.locator('#account-form').waitFor();assert.equal(calls.length,beforeRetry,'Read retry never recreates account');
   assert.equal(calls.at(-1).body.username,'created.fixture');assert.deepEqual(calls.at(-1).body,{username:'created.fixture',display_name:'Created Fixture',password:'Fixture temporary password 42!',role:'hod'});
   assert.equal(await page.locator('#account-password').inputValue(),'');
   // A confirmed creation finishing after navigation must not repaint the old accounts view or show a stale success toast.
   await page.locator('#account-username').fill('late.fixture');await page.locator('#account-display').fill('Late Fixture');await page.locator('#account-password').fill('Fixture late password 43!');
   mode='held';held=false;await page.locator('#create-account').click();await waitHeld();await overview().click();await page.waitForURL('**/#view=overview');await page.waitForLoadState('networkidle');
   const headingBefore=await page.locator('#section-title').innerText(),successBefore=await page.getByText('Account created',{exact:true}).count();release();await page.waitForTimeout(180);
   assert.match(page.url(),/#view=overview$/);assert.equal(await page.locator('#section-title').innerText(),headingBefore);assert.equal(await page.locator('#account-form').count(),0);assert.equal(await page.getByText('Account created',{exact:true}).count(),successBefore);
   assert.equal(calls.filter(c=>c.path.endsWith('/auth/accounts')).length,2);assert.deepEqual(calls.at(-1).body,{username:'late.fixture',display_name:'Late Fixture',password:'Fixture late password 43!',role:'rota_board_member'});
   await visit();
   mode='held';held=false;await recovery().click();await waitHeld();await page.locator('#account-menu-button').click();await page.locator('#sign-out').click();await page.locator('#login-form').waitFor();release();await page.waitForTimeout(180);assert.equal(prompts.length,1,'Signed-out completion cannot expose recovery code');
   assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  }
  results.push({engine,width,latePromptCount,cancelNoRequest:true,recoveryPendingDuplicateBlocked:!baseline,contextAndSignoutGuard:!baseline,refusalManualRetryExactTarget:!baseline,confirmedCreateReadFailureRecoveryNoReplay:!baseline,lateCreatePreservesDestinationNoStaleToast:!baseline,exactCreatePayload:!baseline,backendWrites:0});await page.close();
 }}finally{await browser.close();}
}
assert.equal(await hash(),initial);
await writeFile('../docs/premium-ui/'+(baseline?'qa-account-admin-before.json':'qa-account-admin-lifetime.json'),JSON.stringify({source_sha256:{'frontend/src/main.ts':initial},scope:'Actual account admin UI; intercepted recovery/create POSTs and independent GET fixtures. No production credentials/backend writes. Native confirm/prompt observed and dismissed; late-context recovery must not display token.',results},null,2)+'\n');
console.log(`Account admin ${baseline?'baseline':'outcomes'}:${results.length}`);
