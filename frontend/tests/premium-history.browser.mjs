import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,firefox,webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const api=process.env.PREMIUM_TEST_API || 'http://127.0.0.1:8031';
const results=[];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
const browser=await type.launch({headless:true});
try {
  const context=await browser.newContext({viewport:{width:1280,height:720}});
  await context.addInitScript(()=>{
    localStorage.setItem('duty_rota_auth_token','history-fixture');
    localStorage.setItem('duty_rota_working_month','2026-05');
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    assert.equal(route.request().method(),'GET','History fixture permits no mutations');
    await route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=leave');
  await page.locator('[data-add-operational-record="leave"]').waitFor();
  assert.equal(await page.evaluate(()=>history.scrollRestoration),'manual');
  assert.equal(await page.locator('#working-month').inputValue(),'2026-05');
  results.push({case:'initial deep link opens allowed section and retains working month',passed:true});
  await page.locator('[data-view="units"]').first().click();
  await page.waitForURL('**/#view=units');
  await page.getByText('All postings',{exact:true}).waitFor();
  await page.goBack();await page.locator('[data-add-operational-record="leave"]').waitFor();
  assert.match(page.url(),/#view=leave$/);
  await page.goForward();await page.getByText('All postings',{exact:true}).waitFor();
  assert.match(page.url(),/#view=units$/);
  results.push({case:'real Back and Forward retain correct route and content',passed:true});
  await page.reload();await page.getByText('All postings',{exact:true}).waitFor();
  assert.match(page.url(),/#view=units$/);
  results.push({case:'reload restores route without a new backend route',passed:true});
  await page.locator('[data-view="overview"]').first().click();
  await page.getByRole('heading',{name:'Duty workload at a glance',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('#view-root .skeleton, #view-root [aria-busy=true]'));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  console.log('History scroll geometry',engine,await page.evaluate(()=>({height:document.documentElement.scrollHeight,viewport:innerHeight,y:scrollY})));
  await page.evaluate(()=>scrollTo({top:200,left:0,behavior:'instant'}));
  await page.waitForFunction(()=>scrollY>0);
  const position=await page.evaluate(()=>scrollY);assert.ok(position>0);
  await page.locator('[data-view="leave"]').first().click();
  await page.locator('[data-add-operational-record="leave"]').waitFor();
  await page.goBack();await page.getByRole('heading',{name:'Duty workload at a glance',exact:true}).waitFor();
  await page.waitForFunction(y=>Math.abs(scrollY-y)<3,position);
  results.push({case:'return navigation restores settled screen scroll position',passed:true});
  assert.deepEqual(errors,[]);
  await context.close();
}finally{await browser.close();}
for(const row of results.filter(row=>!row.engine))row.engine=engine;
}
await writeFile('../docs/premium-ui/qa-history.json',JSON.stringify({results,scope:'Actual browser history; existing disposable read-only API; no server route or payload changes'},null,2)+'\n');
console.log('Frontend history:12 deep-link, Back/Forward, reload and scroll outcomes across3engines passed.');
