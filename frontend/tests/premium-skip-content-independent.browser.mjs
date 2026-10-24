import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base='http://127.0.0.1:5197',api='http://127.0.0.1:8031',baseline=process.env.SKIP_BASELINE==='1';
const hash=async()=>createHash('sha256').update(await readFile('src/main.ts')).digest('hex'),start=await hash(),results=[];
for(const [engine,launcher] of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of baseline?[320]:[320,1280])for(const view of ['leave','units']){
  const page=await browser.newPage({viewport:{width,height:900}}),requests=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','skip-content-fixture');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{assert.equal(route.request().method(),'GET');const url=new URL(route.request().url());requests.push(url.pathname);return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});});
  await page.goto(base+'/#view=overview');await page.locator('#account-menu-button[aria-label="Account: Browser test admin"]').waitFor();await page.waitForLoadState('networkidle');
  const navigate=page.locator(`${width===320?'.mobile-bottom-nav':'.sidebar'} [data-view=${view}]`);await navigate.click();await page.locator(`[data-add-operational-record=${view}]`).waitFor();await page.waitForLoadState('networkidle');
  const before={url:page.url(),history:await page.evaluate(()=>history.length),content:await page.locator('#view-root').innerText(),month:await page.locator('#working-month').inputValue(),requests:requests.length};
  const skip=page.getByRole('link',{name:'Skip to content',exact:true});await skip.focus();await page.keyboard.press('Enter');await page.waitForTimeout(150);
  const observed={url:page.url(),focus:await page.evaluate(()=>document.activeElement?.id),requests:requests.length};
  if(!baseline){
   assert.equal(page.url(),before.url);assert.equal(await page.evaluate(()=>history.length),before.history);assert.equal(await page.locator('#view-root').innerText(),before.content);assert.equal(await page.locator('#working-month').inputValue(),before.month);assert.equal(requests.length,before.requests);assert.equal(observed.focus,'section-title');
   await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('.content'))&&!document.activeElement?.closest('.sidebar,.mobile-bottom-nav')),true,'Next Tab enters current content controls');
   await page.goBack();await page.waitForURL('**/#view=overview');await page.waitForLoadState('networkidle');assert.match(page.url(),/#view=overview$/);
   assert.deepEqual(errors,[]);
  }
  results.push({engine,width,view,before:{url:before.url,history:before.history,request_count:before.requests},observed,preserved_route_content_month_history_no_read:!baseline,next_tab_content:!baseline,back_returns_prior_route:!baseline,backend_writes:0});await page.close();
 }}finally{await browser.close();}
}
assert.equal(await hash(),start);
await writeFile('../docs/premium-ui/'+(baseline?'qa-skip-content-before.json':'qa-skip-content-independent.json'),JSON.stringify({source_sha256:{'frontend/src/main.ts':start},results,scope:baseline?'Bounded reproduction observation only.':'Actual keyboardEnter/Tab andBack;3engines320/1280Leave+Units,GET-only fixture;no physical/screenreader certification.'},null,2)+'\n');
console.log(`Skip content ${baseline?'baseline observations':'outcomes'}: ${results.length}`);
