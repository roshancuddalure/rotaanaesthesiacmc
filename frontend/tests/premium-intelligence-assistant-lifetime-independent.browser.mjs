import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const sourceHash=createHash('sha256').update(await readFile('src/rota-intelligence.ts')).digest('hex'),results=[];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})) {
 const browser=await type.launch({headless:true});
 try {for(const width of [320,1280])for(const termination of ['direct-removal','confirmed-close']) {
  const page=await browser.newPage({viewport:{width,height:844}}),calls=[],loopback=[],errors=[];
  let release;const held=new Promise(resolve=>release=resolve);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/__assistant-lifetime',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button>Open</button></body></html>'}));
  await page.route('http://127.0.0.1:11437/**',route=>{loopback.push({url:route.request().url(),headers:route.request().headers()});return route.fulfill({json:{explanation:'Unexpected stale result',mode:'balanced',proposed_rules:[]}});});
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());calls.push(url.pathname);assert.equal(req.method(),'GET');
   if(url.pathname.endsWith('/setup'))return route.fulfill({json:{slots:[],people:[],history_lookback:6,history_months:[],rules:{},holiday_dates:[]}});
   if(url.pathname.endsWith('/jobs'))return route.fulfill({json:[]});
   assert.equal(url.pathname,'/api/v1/rota-intelligence/assistant-context');
   assert.equal(url.searchParams.get('instruction'),'Prefer fair spacing');await held;return route.fulfill({json:{month:'2026-05',eligible_people:[]}});
  });
  await page.goto(base+'/__assistant-lifetime');
  await page.evaluate(async()=>{const {openIntelligentRota}=await import('/src/rota-intelligence.ts');await openIntelligentRota('2026-05',true,()=>{throw Error('No assignment callback expected');});});
  await page.locator('[data-tab="assistant"]').click();
  await page.getByLabel('Local pairing token',{exact:true}).fill('independent-test-pairing');
  await page.getByLabel('Allow requests to my paired local assistant',{exact:true}).check();
  await page.getByLabel('Your instruction',{exact:true}).fill('Prefer fair spacing');
  await page.getByRole('button',{name:'Ask local assistant',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.mw-footer')?.textContent.includes('Working.'));
  assert.equal(calls.filter(p=>p.endsWith('/assistant-context')).length,1);
  if(termination==='direct-removal')await page.evaluate(()=>document.querySelector('dialog').remove());
  else await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog'));
  const completed=page.waitForResponse(response=>response.url().includes('/assistant-context'));
  release();await completed;await page.waitForTimeout(150);
  assert.deepEqual(loopback,[],'Closed workspace must not forward the token or context to local companion');
  assert.equal(calls.length,3,'No follow-up private request after termination');
  assert.equal(await page.locator('dialog').count(),0);
  assert.equal(await page.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);
  assert.deepEqual(errors,[]);
  results.push({engine,width,termination,held_context_reads:1,companion_requests:0,private_followup_requests:0,synthetic_unload_clean:true,page_errors:0,backend_writes:0});
  await page.close();
 }}finally{await browser.close();}
}
assert.equal(createHash('sha256').update(await readFile('src/rota-intelligence.ts')).digest('hex'),sourceHash);
await writeFile('../docs/premium-ui/qa-intelligence-assistant-lifetime-independent.json',JSON.stringify({source_sha256:{'frontend/src/rota-intelligence.ts':sourceHash},results,scope:'Actual component module and actual paired-assistant controls in a source-style harness. All API and potential loopback requests intercepted; direct removal is intentionally synthetic. Beforeunload proves listener predicate only; no physical device, real assistant, backend or GPU computation claim.'},null,2)+'\n');
console.log(`Independent assistant lifetime: ${results.length} cases passed`);
