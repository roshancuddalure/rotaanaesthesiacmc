import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:850}}),page=await context.newPage(),errors=[],writes=[];
  let user,signins=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','expiry-original'));
  const accounts=[];
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.endsWith('/auth/sign-in')){
    signins++;assert.deepEqual(request.postDataJSON(),{username:'test-operator',password:'Example password 42!'});
    return route.fulfill({json:{token:'expiry-renewed',user}});
   }
   if(url.pathname.endsWith('/auth/accounts')){
    if(request.method()==='GET')return route.fulfill({json:accounts});
    writes.push({body:request.postDataJSON(),auth:request.headers().authorization});
    if(writes.length===1)return route.fulfill({status:401,json:{detail:'Session has expired'}});
    assert.equal(request.headers().authorization,'Bearer expiry-renewed');
    const {password,...data}=request.postDataJSON();void password;
    const result={...data,id:'new-account',active_status:'active',role_label:'Rota board member'};accounts.push(result);return route.fulfill({json:result});
   }
   assert.equal(request.method(),'GET','No unmocked write may reach fixture');
   const response=await route.fetch({url:api+url.pathname+url.search});
   if(url.pathname.endsWith('/auth/me'))user=await response.json();
   return route.fulfill({response});
  });
  await page.goto(base+'/#view=accounts');await page.locator('#account-form').waitFor();
  const fill=async()=>{
   await page.getByLabel('Username',{exact:true}).fill('draft.member');
   await page.getByLabel('Display name',{exact:true}).fill('Draft Member');
   await page.getByLabel('Password',{exact:true}).fill('Example password 42!');
  };
  await fill();await page.getByRole('button',{name:'Create',exact:true}).click();
  const panel=page.locator('#session-expiry-recovery');await panel.waitFor();
  assert.equal(await page.getByLabel('Display name',{exact:true}).inputValue(),'Draft Member');
  assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'Example password 42!');
  // Collapse the guidance to reach the form on narrow screens without hiding the recovery route.
  await panel.locator('summary').click();
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.getByText('Sign in again before submitting another change. Your draft has not been submitted again.',{exact:true}).waitFor();
  assert.equal(writes.length,1);assert.equal(await panel.count(),1);
  assert.equal(await panel.locator('details').evaluate(el=>el.open),true,'New refusal remains visible in inline recovery');
  page.once('dialog',dialog=>dialog.dismiss());await panel.getByRole('button',{name:'Sign in again',exact:true}).click();
  assert.equal(await page.locator('#account-form').count(),1);assert.equal(signins,0);
  assert.equal(await page.getByLabel('Display name',{exact:true}).inputValue(),'Draft Member');
  page.once('dialog',dialog=>dialog.accept());await panel.getByRole('button',{name:'Sign in again',exact:true}).click();
  await page.getByLabel('Username',{exact:true}).waitFor();assert.equal(await page.locator('#account-form').count(),0);
  assert.equal(await panel.count(),0);assert.equal(writes.length,1);
  await page.getByLabel('Username',{exact:true}).fill('test-operator');
  await page.getByLabel('Password',{exact:true}).fill('Example password 42!');
  await page.locator('#login-submit').click();
  await page.locator('#account-form').waitFor();assert.equal(signins,1);assert.equal(writes.length,1,'Sign-in never replays refused mutation');
  assert.equal(await page.getByLabel('Username',{exact:true}).inputValue(),'');
  await fill();await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.getByText('Account created',{exact:true}).waitFor();assert.equal(writes.length,2);
  assert.deepEqual(writes[0].body,writes[1].body,'Only explicit resubmission repeats entered payload');
  assert.deepEqual(errors,[]);
  results.push({width,draft_retained_on401:true,repeat_network_write_blocked:true,one_recovery_notice:true,declined_signin_keeps_draft:true,explicit_signin_no_replay:true,explicit_resubmit_renewed_token:true,backend_writes:0});
  await context.close();
 }
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-session-expiry.json',JSON.stringify({results,scope:'Mocked401 account flow and explicit reauthentication; no real account changes or credentials'},null,2)+'\n');
console.log('Session expiry: 3 responsive draft-preservation and explicit reauthentication workflows passed');
