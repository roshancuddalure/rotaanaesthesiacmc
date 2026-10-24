import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],creates=[],recovery=[];
  let failLoad=true,failCreate=true,failRecovery=true,holdCreate=false,releaseCreate;
  const accounts=[{id:'board',username:'board',display_name:'Board Member',role:'rota_board_member',role_label:'Rota board member',active_status:'active'},
   {id:'root',username:'root',display_name:'Superadmin',role:'superadmin',role_label:'Superadmin',active_status:'active'},
   {id:'inactive',username:'inactive',display_name:'Inactive Member',role:'hod',role_label:'Head of Department',active_status:'inactive'}];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','account-review'));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/auth/accounts')){
    if(req.method()==='GET')return route.fulfill(failLoad?{status:503,json:{detail:'Account list unavailable <img src=x>'}}:{json:accounts});
    assert.equal(req.method(),'POST');creates.push(req.postDataJSON());
    if(failCreate)return route.fulfill({status:409,json:{detail:'Username requires review'}});
    if(holdCreate)await new Promise(resolve=>releaseCreate=resolve);
    const {password,...values}=creates.at(-1);void password;
    const created={...values,id:'created-'+creates.length,role_label:'Head of Department',active_status:'active'};accounts.push(created);return route.fulfill({json:created});
   }
   if(url.pathname.endsWith('/auth/accounts/board/recovery-code')){
    assert.equal(req.method(),'POST');recovery.push(url.pathname);
    return route.fulfill(failRecovery?{status:503,json:{detail:'Recovery temporarily unavailable'}}:{json:{reset_token:'TEST-ONLY-NOT-A-REAL-CODE',expires_in_minutes:15}});
   }
   assert.equal(req.method(),'GET','No unmocked account mutation reaches fixture');
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=accounts');
  await page.getByRole('heading',{name:'Accounts unavailable',exact:true}).waitFor();
  assert.equal(await page.locator('#view-root img').count(),0);
  failLoad=false;await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.locator('#account-form').waitFor();
  assert.equal(await page.locator('#account-role option[value=superadmin]').count(),0,'Computer admin cannot select superadmin role');
  assert.equal(await page.locator('[data-account-recovery=root]').count(),0);
  assert.equal(await page.locator('[data-account-recovery=inactive]').count(),0);
  await page.getByLabel('Username',{exact:true}).fill('new.hod');
  await page.getByLabel('Display name',{exact:true}).fill('New HOD <img src=x>');
  await page.getByLabel('Password',{exact:true}).fill('Example password 42!');
  await page.getByLabel('Role',{exact:true}).selectOption('hod');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.getByText('Username requires review',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Username',{exact:true}).inputValue(),'new.hod');
  assert.equal(await page.getByLabel('Display name',{exact:true}).inputValue(),'New HOD <img src=x>');
  assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'Example password 42!');
  assert.equal(await page.getByRole('button',{name:'Create',exact:true}).isEnabled(),true);
  failCreate=false;await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.getByText('Account created',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('#account-username')?.value==='');
  const expected={username:'new.hod',display_name:'New HOD <img src=x>',password:'Example password 42!',role:'hod'};
  assert.deepEqual(creates,[expected,expected]);assert.equal(await page.locator('#view-root img').count(),0);
  await page.reload();await page.getByText('New HOD <img src=x>',{exact:true}).filter({visible:true}).waitFor();
  const issue=page.locator('[data-account-recovery=board]:visible');
  page.once('dialog',dialog=>dialog.dismiss());await issue.click();assert.equal(recovery.length,0);
  page.once('dialog',dialog=>dialog.accept());await issue.click();
  await page.getByText('Recovery temporarily unavailable',{exact:true}).waitFor();
  assert.equal(await issue.isEnabled(),true);
  failRecovery=false;
  let prompted=false;
  const onDialog=async dialog=>{
   if(dialog.type()==='confirm')return dialog.accept();
   assert.equal(dialog.type(),'prompt');assert.match(dialog.message(),/board.*15 minutes/);
   assert.equal(dialog.defaultValue(),'TEST-ONLY-NOT-A-REAL-CODE');prompted=true;return dialog.dismiss();
  };
  page.on('dialog',onDialog);await issue.click();
  await page.waitForFunction(()=>Boolean(document.querySelector('[data-account-recovery=board]:not([disabled])')));
  assert.equal(prompted,true);assert.equal(recovery.length,2);page.off('dialog',onDialog);
  // A delayed create cannot repaint account data over a destination chosen while saving.
  await page.getByLabel('Username',{exact:true}).fill('delayed.hod');
  await page.getByLabel('Display name',{exact:true}).fill('Delayed HOD');
  await page.getByLabel('Password',{exact:true}).fill('Example password 42!');
  holdCreate=true;await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.getByLabel('Username',{exact:true}).focus();await page.keyboard.press('Enter');
  assert.equal(creates.length,3,'Repeated activation cannot submit twice while create pending');
  await page.locator(width<=768?'.mobile-bottom-nav [data-view=leave]':'.sidebar [data-view=leave]').click();
  await page.locator('[data-add-operational-record=leave]').waitFor();
  assert.ok(releaseCreate);releaseCreate();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#account-form').count(),0);
  assert.match(page.url(),/#view=leave$/);
  assert.deepEqual(errors,[]);
  results.push({width,load_retry:true,create_error_draft_retained:true,exact_create_payload:true,fresh_mock_readback:true,recovery_cancel_no_write:true,recovery_failure_retry:true,role_visibility:true,duplicate_submit_guard:true,late_create_preserves_destination:true,backend_writes:0});
  await page.close();
 }
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-accounts.json',JSON.stringify({results,scope:'Mocked account creation/recovery only; server authorization remains authoritative; no real codes/accounts'},null,2)+'\n');
console.log('Accounts: 3 responsive creation, recovery and navigation workflows passed');
