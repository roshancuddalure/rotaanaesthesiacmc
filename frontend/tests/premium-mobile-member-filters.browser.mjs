import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const probe=process.env.MEMBER_FILTER_PROBE==='1',base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api='http://127.0.0.1:8032',out='../docs/premium-ui/qa-mobile-member-filters';
const files=['src/main.ts','src/styles.css','src/premium-theme.css'];const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>['frontend/'+f,createHash('sha256').update(await readFile(f)).digest('hex')])));
const held=await hashes(),results=[];await mkdir(out,{recursive:true});
const reset=await fetch(api+'/__equivalence/reset',{method:'POST'});assert.equal((await reset.json()).storage,'disposable-sqlite-memory');
for(const [engine,type]of Object.entries(probe?{chromium}:{chromium,firefox,webkit})){
 const browser=await type.launch();try{for(const width of probe?[320]:[320,390,768,769,1280]){
  const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],mutations=[];
  page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','member-filter-layout');localStorage.setItem('duty_rota_working_month','2026-05');});
  await context.route('**/api/**',async route=>{const r=route.request(),u=new URL(r.url());if(r.method()!=='GET'){mutations.push(r.method()+' '+u.pathname);return route.abort();}return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});});
  const panel=page.locator('#member-filter-panel'),summary=panel.locator('summary');
  const toggle=async()=>{await summary.focus();await page.keyboard.press('Enter');};
  const firstRecordTop=async()=>page.locator(width<=768?'#member-card-list':'#member-list').evaluate(el=>el.getBoundingClientRect().top+scrollY);
  try{
   await page.goto(base+'/#view=members');await panel.waitFor();await page.waitForLoadState('networkidle');
   const mobile=width<=768,initialOpen=await panel.evaluate(el=>el.open),initialTop=await firstRecordTop();
   if(probe){await page.screenshot({path:`${out}/before-${width}.png`,fullPage:true});results.push({engine,width,initialOpen,initialTop});continue;}
   assert.equal(initialOpen,!mobile,'Only first-use mobile presentation starts compact');
   if(!initialOpen)await toggle();
   const expandedTop=await firstRecordTop();
   if(mobile)assert.ok(expandedTop-initialTop>=60,'Collapsed optional fields measurably reduce roster height');
   await page.getByLabel('Filter by call level',{exact:true}).selectOption({label:'1st Call'});
   assert.equal(await page.locator('#visible-member-count').innerText(),'4');assert.match(await summary.innerText(),/1 applied/);
   await toggle();assert.equal(await panel.evaluate(el=>el.open),false);
   await page.locator('#member-search').fill('Safe Member');await page.keyboard.press('Tab');assert.equal(await page.locator('#visible-member-count').innerText(),'1');
   assert.equal(await panel.evaluate(el=>el.open),false,'Search rerender preserves explicit closed choice and call filter');assert.match(await summary.innerText(),/1 applied/);
   await page.setViewportSize({width:mobile?1280:320,height:844});assert.equal(await panel.evaluate(el=>el.open),false,'Resize never overrides explicit choice');
   const opener=page.locator('.member-profile-link[data-open-member]:visible').filter({hasText:'Safe Member'}).first();await opener.focus();await page.keyboard.press('Enter');
   const dialog=page.locator('dialog.member-workspace');await dialog.locator('[data-close]').first().focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'detached'});
   assert.equal(await panel.evaluate(el=>el.open),false);assert.equal(await page.locator('#member-search').inputValue(),'Safe Member');
   await toggle();assert.equal(await panel.evaluate(el=>el.open),true);assert.equal(await page.getByLabel('Filter by call level',{exact:true}).inputValue(),'1st Call');
   // A native toggle must also survive leaving and returning without an intervening filter rerender.
   await page.evaluate(()=>{location.hash='view=overview';});await page.waitForFunction(()=>document.querySelector('#section-title')?.textContent?.trim()==='CMC Anaesthesia rota board');await page.waitForLoadState('networkidle');
   await page.evaluate(()=>{location.hash='view=members';});await panel.waitFor();assert.equal(await panel.evaluate(el=>el.open),true,'Route roundtrip retains explicit open choice');
   assert.equal(await page.locator('#member-search').inputValue(),'Safe Member');
   await page.locator('#clear-member-filters').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#visible-member-count').innerText(),'4');assert.match(await summary.innerText(),/0 applied/);assert.equal(await panel.evaluate(el=>el.open),true);
   await page.setViewportSize({width,height:844});await toggle();await summary.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/${engine}-${width}-compact.png`,fullPage:true});
   assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);results.push({engine,width,initialOpen,initialTop,expandedTop,spaceSaved:expandedTop-initialTop,call_filter_preserved:true,search_filter_outcome:true,explicit_disclosure_survives_resize_profile_and_route:true,clear_filters_outcome:true,passed:true});
  }finally{await context.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),held);
await writeFile(`${out}/${probe?'before':'report'}.json`,JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'First-use mobile optional filter disclosure plus explicit native choice, meaningful call/search outcomes, resize/profile/route roundtrip and clear filters. Real read-only RAM fixture;not allroles/states/physical/nativeAT.',source_sha256:held,results},null,2)+'\n');
console.log(`Member filter layout:${results.length} contexts passed`);
