import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const sourceFiles=['src/ui-feedback.ts','src/premium-theme.css','src/styles.css'];
const hash=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])));
const initial=await hash(),captures=[];
const browser=await chromium.launch({headless:true});
await mkdir('../docs/premium-ui/qa-notifications',{recursive:true});
try{for(const [width,colorScheme] of [[320,'dark'],[1280,'light']]){
 const context=await browser.newContext({viewport:{width,height:850},colorScheme,reducedMotion:'reduce'}),page=await context.newPage();
 await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','notification-visual');localStorage.setItem('duty_rota_working_month','2026-10');});
 await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url());assert.equal(request.method(),'GET');if(url.pathname.endsWith('/unit-management/month'))return route.fulfill({status:503,json:{detail:'Independent recoverable read failure'}});return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});});
 await page.goto(base+'/#view=units');await page.locator('#view-root [data-view-shortcut="units"]').waitFor();
 while(await page.locator('.toast-dismiss').count())await page.locator('.toast-dismiss').first().click();
 await page.evaluate(async()=>{const {announceToast}=await import('/src/ui-feedback.ts');for(let i=1;i<=6;i++)announceToast(`Notification ${i}: Unable to confirm this operation. Review saved data and use recovery. Server detail <img src=x onerror=alert(1)> ${'Long persistent operational error explanation. '.repeat(5)}`,'error');});
 const region=page.getByRole('region',{name:'Notifications',exact:true});await region.locator('.toast-dismiss').first().focus();await page.keyboard.press('Home');await page.waitForTimeout(300);
 const path=`docs/premium-ui/qa-notifications/notifications-${width}-${colorScheme}.png`;
 await page.screenshot({path:'../'+path,fullPage:false});
 captures.push({engine:'chromium',width,height:850,colorScheme,path,geometry:await region.evaluate(el=>{const r=el.getBoundingClientRect(),view=document.querySelector('#view-root').getBoundingClientRect();return {trayTop:r.top,trayBottom:r.bottom,trayHeight:r.height,recoveryGap:view.top-r.bottom,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight};}),inspected:false});
 await context.close();
}}finally{await browser.close();}
assert.deepEqual(await hash(),initial);
const reportPath='../docs/premium-ui/qa-notification-layout-independent.json',report=JSON.parse(await readFile(reportPath,'utf8'));
report.visualReview={scope:'Separate Chromium actual app screenshot captures with six persistent errors and failed-read recovery visible. 320 dark and 1280 light. Screenshot inspection recorded separately after rendering; no physical, screen-reader or modal coverage.',sourceHashes:initial,captures};
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log('Two notification visual captures ready for inspection');
