import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const base=process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const api=process.env.PREMIUM_TEST_API || 'http://127.0.0.1:8031';
const browser=await chromium.launch({headless:true});
const evidence=[];
try {
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','session-fixture'));
  await context.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(route.request().method()!=='GET')throw new Error('Session fixture allows no backend mutations');
    await route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  const first=await context.newPage(),second=await context.newPage();
  const errors=[];first.on('pageerror',error=>errors.push(error.message));
  await first.goto(base);
  await first.getByRole('heading',{name:'Duty workload at a glance',exact:true}).waitFor();
  await first.locator('#account-menu-button').click();await first.locator('#profile').click();
  await first.locator('#profile-modal').waitFor();
  await second.goto(base);
  await second.getByRole('heading',{name:'Duty workload at a glance',exact:true}).waitFor();
  await second.locator('#account-menu-button').click();await second.locator('#sign-out').click();
  await first.getByLabel('Username',{exact:true}).waitFor();
  assert.equal(await first.locator('#profile-modal, dialog, #view-root').count(),0);
  assert.equal(await first.locator('#app').evaluate(element=>element.inert),false);
  await first.getByLabel('Username',{exact:true}).fill('new-session');
  assert.equal(await first.getByLabel('Username',{exact:true}).inputValue(),'new-session');
  assert.deepEqual(errors,[]);
  evidence.push({case:'real cross-tab sign-out removes private content and leaves login usable',passed:true});
  await context.close();
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-session.json',JSON.stringify({evidence,scope:'Two real browser tabs, disposable read-only API; no backend mutation'},null,2)+'\n');
console.log('Premium session synchronization: cross-tab browser outcome passed.');
