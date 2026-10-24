import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const view of ['overview','units','user-guide']){
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','print-review');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.route('**/api/**',async route=>{const url=new URL(route.request().url());assert.equal(route.request().method(),'GET');return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});});
  await page.goto(base+'/#view='+view);
  await page.waitForFunction(view=>document.querySelector(`[data-view="${view}"]`)?.classList.contains('active')&&document.querySelector('#view-root')?.textContent.trim().length>100,view);
  await page.waitForLoadState('networkidle');
  const text=await page.locator('#view-root').textContent();
  const visibleContent=await page.locator('#view-root :is(h3,tbody tr)').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length).map(node=>node.textContent));
  await page.emulateMedia({media:'print'});
  for(const selector of ['.sidebar','.mobile-bottom-nav','.topbar-actions'])assert.equal(await page.locator(selector).isVisible(),false);
  assert.equal(await page.locator('#view-root').textContent(),text,'Print styling retains operational DOM content');
  const printableContent=await page.locator('#view-root :is(h3,tbody tr)').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length).map(node=>node.textContent));
  assert.deepEqual(printableContent,visibleContent,'All previously visible headings and record rows remain printable');
  const pdf=await page.pdf({format:'A4',printBackground:true});
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>10000);
  results.push({view,chrome_hidden:true,content_text_retained:true,pdf_bytes:pdf.length,backend_writes:0});
  await page.close();
 }
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-print.json',JSON.stringify({results,scope:'Browser print presentation; existing export files/payloads untouched. PDF pagination still requires visual review for large datasets.'},null,2)+'\n');
console.log('Print: 3 content-preservation and PDF generation checks passed');
