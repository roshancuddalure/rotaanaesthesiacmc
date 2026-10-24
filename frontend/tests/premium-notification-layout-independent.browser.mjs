import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031',results=[];
const sourceFiles=['src/ui-feedback.ts','src/premium-theme.css','src/styles.css'];
const sourceHashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
const initialHashes=await sourceHashes();
const messages=Array.from({length:6},(_,i)=>`Notification ${i+1}: Unable to confirm this operation. Review saved data and use recovery. Server detail <img src=x onerror=alert(1)> ${'Long persistent operational error explanation. '.repeat(5)}`);
const geometry=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,unobscured:!!hit&&el.contains(hit),inViewport:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth};});
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],writes=[];let unitReads=0;
  page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-22T08:00:00Z')});
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','notification-independent');localStorage.setItem('duty_rota_working_month','2026-10');});
  await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url());if(request.method()!=='GET'){writes.push(request.method()+' '+url.pathname);return route.abort('blockedbyclient');}if(url.pathname.endsWith('/unit-management/month')){unitReads++;if(unitReads===1)return route.fulfill({status:503,json:{detail:'Independent recoverable read failure'}});}return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});});
  await page.goto(base+'/#view=units');const retry=page.locator('#view-root [data-view-shortcut="units"]');await retry.waitFor();
  while(await page.locator('.toast-dismiss').count())await page.locator('.toast-dismiss').first().click();
  await page.evaluate(async messages=>{const {announceToast}=await import('/src/ui-feedback.ts');for(const message of messages)announceToast(message,'error');announceToast(messages[0],'error');},messages);
  const region=page.getByRole('region',{name:'Notifications',exact:true});assert.equal(await region.locator('.toast-summary').innerText(),'6 notifications \u00b7 Scroll to review');assert.equal(await region.locator('.toast-summary').isVisible(),true);assert.equal(await region.locator('.toast.error').count(),6);assert.equal(await region.locator('img').count(),0);
  assert.equal(await region.evaluate(el=>el.parentElement?.classList.contains('content')&&el.nextElementSibling?.id==='view-root'),true);
  await page.clock.fastForward(16000);assert.equal(await region.locator('.toast.error').count(),6);
  const box=await region.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {height:r.height,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,position:s.position,overflowY:s.overflowY};});
  assert.equal(box.position,'static');assert.ok(box.height<=850*.28+1);assert.ok(box.scrollHeight>box.clientHeight);await region.focus();await page.keyboard.press('PageDown');await page.clock.runFor(300);await page.waitForFunction(()=>document.querySelector('#toast-container').scrollTop>0);assert.ok(await region.evaluate(el=>el.scrollTop>0),'Region supports native keyboard scrolling');
  for(let i=0;i<6;i++){const button=region.locator('.toast-dismiss').nth(i);await button.scrollIntoViewIfNeeded();const g=await geometry(button);assert.ok(g.inViewport&&g.unobscured,`${engine}/${width} notification ${i+1} unreachable: ${JSON.stringify(g)}`);}
  if(width<=768){const toggle=page.locator('#sidebar-toggle');await toggle.scrollIntoViewIfNeeded();assert.ok((await geometry(toggle)).unobscured);await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');}
  const account=page.locator('#account-menu-button');await account.scrollIntoViewIfNeeded();assert.ok((await geometry(account)).unobscured);await account.click();await page.locator('#profile').waitFor();await account.click();
  await retry.scrollIntoViewIfNeeded();const rg=await geometry(retry);assert.ok(rg.inViewport&&rg.unobscured,JSON.stringify(rg));await retry.click();await page.locator('[data-refresh-unit-board]').waitFor();assert.equal(unitReads,2);
  await region.locator('.toast-dismiss').first().focus();await page.keyboard.press('Enter');assert.equal(await region.locator('.toast.error').count(),5);assert.equal(await region.locator('.toast-summary').innerText(),'5 notifications \u00b7 Scroll to review');assert.equal(await region.locator('.toast-dismiss').first().evaluate(el=>el===document.activeElement),true);
  for(let i=0;i<5;i++)await page.keyboard.press('Enter');assert.equal(await region.locator('.toast').count(),0);assert.equal(await region.locator('.toast-summary').count(),0);assert.equal(await page.locator('#section-title').evaluate(el=>el===document.activeElement),true);
  await page.evaluate(async()=>{const {announceToast}=await import('/src/ui-feedback.ts');announceToast('Hover-paused status','info');});
  const status=region.locator('.toast.info');await status.hover();await page.clock.fastForward(9000);assert.equal(await status.count(),1);await status.getByRole('button').focus();await page.mouse.move(1,1);await page.clock.fastForward(9000);assert.equal(await status.count(),1);await page.locator('#section-title').focus();await page.clock.fastForward(7100);assert.equal(await status.count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  results.push({engine,width,actualApp:true,sixPersistentEscapedDistinctErrors:true,deduplicated:true,visibleSummaryCountSixFiveZero:true,stickySummaryDoesNotObscureDismissals:true,regionGeometry:box,allDismissalsReachable:true,keyboardRegionScroll:true,sidebarAndAccountPointerActions:true,retryReadOutcome:true,dismissFocusRecovery:true,hoverAndFocusPause:true,writes:0,errors:0});await context.close();
 }}finally{await browser.close();}
}
const hashes=await sourceHashes();assert.deepEqual(hashes,initialHashes,'Reviewed app sources remain unchanged throughout the run');
await writeFile('../docs/premium-ui/qa-notification-layout-independent.json',JSON.stringify({scope:'Actual app with intercepted failed units GET followed by disposable fixture read. Browser emulation only; no native modal, physical device or screen-reader claims. Timer advancement uses Playwright clock; pointer and keyboard actions use real controls.',sourceHashes:hashes,results},null,2)+'\n');console.log(`Independent notification layout: ${results.length} cases passed`);


