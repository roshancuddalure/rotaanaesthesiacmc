import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:850}}),page=await context.newPage(),errors=[];
  let secondAccount=false,user,signins=0,monthReads=0;
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','first-unit-account');localStorage.setItem('duty_rota_working_month','2026-10');});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.endsWith('/auth/sign-in')){
    assert.deepEqual(request.postDataJSON(),{username:'second-operator',password:'Example password 42!'});secondAccount=true;signins++;
    return route.fulfill({json:{token:'second-unit-account',user:{...user,id:'second-user',username:'second-operator',display_name:'Second Operator'}}});
   }
   assert.equal(request.method(),'GET','Only intercepted explicit sign-in POST is permitted');
   if(url.pathname.endsWith('/unit-management/month')){
    monthReads++;if(secondAccount)return route.fulfill({status:503,json:{detail:'New account unit data unavailable'}});
    return route.fulfill({json:{month:'2026-10',starts_on:'2026-10-01',ends_on:'2026-10-31',units:[{id:'private-unit',code:'PRIVATE',name:'First-account private unit marker',campus:'First campus',minimum_free_people:1,active_status:'active',notes:null}],assignments:[],unit_summaries:[],unit_call_minimums:[],validation_issues:[]}});
   }
   const response=await route.fetch({url:api+url.pathname+url.search});if(url.pathname.endsWith('/auth/me'))user=await response.json();
   return route.fulfill({response});
  });
  await page.goto(base+'/#view=units');await page.getByRole('heading',{name:'First-account private unit marker',exact:true}).waitFor();
  await page.locator('input[data-unit-board-search]').fill('private');
  await page.locator('#account-menu-button').click();await page.locator('#sign-out').click();
  await page.getByLabel('Username',{exact:true}).fill('second-operator');await page.getByLabel('Password',{exact:true}).fill('Example password 42!');await page.locator('#login-submit').click();
  await page.getByText('Unit Management could not load',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-unit-board-card], [data-unit-freshness]').count(),0,'Previous account cannot supply stale fallback');
  assert.doesNotMatch(await page.locator('body').innerText(),/First-account private unit marker|First campus/);
  assert.equal(signins,1);assert.equal(monthReads,2);assert.deepEqual(errors,[]);
  results.push({width,real_signout_and_explicit_signin:true,second_account_failed_read_never_uses_previous_cache:true,old_filters_not_shown:true,intercepted_signins:1,backend_writes:0});await context.close();
 }
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-unit-cache-session.json',JSON.stringify({results,scope:'Actual logout/login component flow with intercepted new-account authentication and failing unit GET; no real account changes or backend writes.'},null,2)+'\n');
console.log('Unit cache isolation:3 responsive logout/new-account failure workflows passed');
