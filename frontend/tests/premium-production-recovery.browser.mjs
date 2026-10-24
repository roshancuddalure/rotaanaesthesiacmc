import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const base=process.env.PREMIUM_PRODUCTION_URL || 'http://127.0.0.1:8032';
const api=process.env.PREMIUM_TEST_API || 'http://127.0.0.1:8031';
const browser=await chromium.launch({headless:true});
const results=[];
try {
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','production-recovery'));
  const requests=[];
  await context.route('**/api/**',async route=>{
    const request=route.request();requests.push({method:request.method(),path:new URL(request.url()).pathname});
    assert.equal(request.method(),'GET','Production recovery must never mutate backend records');
    const url=new URL(request.url());await route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  const page=await context.newPage();
  const response=await page.goto(base);
  assert.match(response.headers()['content-security-policy'],/worker-src 'self'/);
  await page.getByRole('heading',{name:'Duty workload at a glance',exact:true}).waitFor();
  await page.locator('[data-view="members"]').first().click();
  await page.getByLabel('Search members',{exact:true}).fill('unsaved sample search');
  let missingChunk=0;
  await page.route('**/assets/recycle-bin-*.js',route=>{
    missingChunk++;return route.fulfill({status:404,contentType:'application/javascript',body:''});
  });
  await page.locator('[data-view="recycle-bin"]').first().click();
  const panel=page.locator('#frontend-update-recovery');await panel.waitFor();
  await page.getByRole('button',{name:'Try again',exact:true}).waitFor();
  assert.equal(missingChunk,1,'The real lazy chunk must fail once without automatic retry');
  let confirmMessage='';
  page.once('dialog',dialog=>{confirmMessage=dialog.message();return dialog.dismiss();});
  const url=page.url();await panel.getByRole('button',{name:'Reload app',exact:true}).click();
  assert.match(confirmMessage,/unsaved changes/);
  assert.equal(page.url(),url);assert.equal(await panel.count(),1);
  await panel.getByRole('button',{name:'Keep working',exact:true}).click();
  assert.equal(await panel.count(),0);
  assert.equal(missingChunk,1);
  assert.ok(requests.every(item=>item.method==='GET'));
  results.push({case:'real removed production lazy chunk',missing_chunk_requests:missingChunk,automatic_reload:false,declined_reload_preserves_session:true,retry_visible:true,mutations:0});
  await context.close();
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-production-chunk-recovery.json',JSON.stringify({results,scope:'Actual built lazy import failure, not an injected preload event; only disposable read-only API'},null,2)+'\n');
console.log('Real production lazy-chunk failure: safe recovery and no automatic retry passed.');
