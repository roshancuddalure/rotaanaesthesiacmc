import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const baseline=process.env.ROLE_NAV_BASELINE==='1',results=[];
const paths=['src/main.ts','src/navigation-history.ts','src/styles.css','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')]))),initial=await hashes();
const workflow=['overview','analysis','members','leave','units','rota-setup','rota-template','rota-review','rota-publish','user-guide'];
const admin=['rota-rules','call-clusters','mappings','imports','accounts','diagnostics','compute-settings','recycle-bin'];
const primary=['overview','leave','units','rota-template'];
async function settled(page){await page.waitForFunction(()=>{const n=document.querySelector('#view-root');return n&&n.textContent.trim().length>20&&!n.querySelector('.skeleton,[aria-busy=true]');});}
async function navigate(page,view,width){if(width<=768&&!primary.includes(view)){await page.locator('#mobile-more').click();await page.locator('[data-mobile-more-view="'+view+'"]').click();}else await page.locator((width<=768?'.mobile-bottom-nav ':'.sidebar ')+`[data-view="${view}"]`).click();await settled(page);assert.equal(await page.locator(`[data-view="${view}"].active`).count()>0,true);}
for(const [engine,launcher]of Object.entries(baseline?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const role of baseline?['hod']:['rota_board_member','hod','computer_admin','superadmin'])for(const width of baseline?[320]:[320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),requests=[],errors=[];
  await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','role-fixture');localStorage.setItem('duty_rota_working_month','2026-05');});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async r=>{const q=r.request(),url=new URL(q.url());requests.push({method:q.method(),path:url.pathname});assert.equal(q.method(),'GET','This audit never forwards a mutation');if(url.pathname.endsWith('/auth/me'))return r.fulfill({json:{id:'role-'+role,username:role,display_name:'Role fixture',email:null,role,role_label:role,active_status:'active'}});return r.fulfill({response:await r.fetch({url:'http://127.0.0.1:8031'+url.pathname+url.search})});});
  await page.goto('http://127.0.0.1:5197/#view=outdated-section');await settled(page);
  const expected=[...workflow,...(role==='computer_admin'?admin:role==='superadmin'?[...admin.slice(0,1),'limits',...admin.slice(1)]:[])];
  assert.deepEqual(await page.locator('.sidebar [data-view]').evaluateAll(ns=>ns.map(n=>n.dataset.view)),expected);
  if(baseline){results.push({engine,width,role,visibleNavigation:expected,unavailableExplanation:await page.locator('#route-availability-notice:not([hidden])').count(),hash:new URL(page.url()).hash});await context.close();continue;}
  const notice=page.locator('#route-availability-notice');await notice.getByText('This link is unavailable',{exact:true}).waitFor();assert.match(await notice.innerText(),/Overview is shown below/);
  const axe=await new AxeBuilder({page}).include('#route-availability-notice').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(axe.violations,[]);
  if(engine==='chromium')await page.screenshot({path:`../docs/premium-ui/screenshots/recovery/route-${role}-${width}.png`});
  await notice.getByRole('button',{name:'Continue to Overview'}).focus();await page.keyboard.press('Enter');await settled(page);assert.equal(await notice.isHidden(),true);assert.equal(new URL(page.url()).hash,'#view=overview');assert.equal(await page.locator('#section-title').evaluate(n=>n===document.activeElement),true);
  if(width<=768){await page.locator('#mobile-more').click();assert.deepEqual(await page.locator('[data-mobile-more-view]').evaluateAll(ns=>ns.map(n=>n.dataset.mobileMoreView)),expected.filter(v=>!primary.includes(v)));await page.keyboard.press('Escape');}
  const limited=role==='computer_admin'?'limits':role==='superadmin'?'invalid-section':'accounts',before=requests.length;
  await page.evaluate(v=>{location.hash='view='+v;},limited);await notice.waitFor({state:'visible'});assert.match(await notice.innerText(),role==='superadmin'?/link is unavailable/:/not available for your account/);assert.equal(await page.locator('.sidebar [data-view=overview]').getAttribute('aria-current'),'page');assert.equal(requests.slice(before).some(q=>q.path.includes('/accounts')||q.path.includes('/limits')),false);
  await navigate(page,'members',width);assert.equal(await notice.isHidden(),true);const isAdmin=['computer_admin','superadmin'].includes(role);assert.equal(await page.locator('#create-member').count(),isAdmin?1:0);assert.equal(await page.locator('#import-member-csv').count(),isAdmin?1:0);
  await navigate(page,'leave',width);assert.equal(await page.locator('[data-approve-month-leave]').count(),isAdmin?1:0);assert.equal(await page.locator('[data-add-operational-record=leave]').count(),1);assert.equal(await page.locator('[data-open-normalized-import=leave]').count(),1);assert.equal(await page.locator('#working-month').inputValue(),'2026-05');
  await navigate(page,'units',width);assert.equal(await page.locator('[data-add-department-unit]').count()>0,isAdmin);assert.equal(await page.locator('[data-add-operational-record=units]').count(),1);assert.equal(await page.locator('#working-month').inputValue(),'2026-05');
  await navigate(page,'user-guide',width);assert.equal(await page.locator('#working-month-field').isHidden(),true);assert.deepEqual(errors,[]);assert.equal(requests.some(q=>q.method!=='GET'),false);
  results.push({engine,width,role,visibleNavigation:expected,unknownLinkExplained:true,limitedLinkExplained:true,protectedLinkReadRequests:0,continueOutcome:true,mobileMoreMatches:width<=768,operationalControlsMatchExistingGates:true,monthPreserved:true,noticeClearsOnNavigation:true,taggedAxeViolations:0,errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-role-navigation'+(baseline?'-before':'')+'.json',JSON.stringify({source_sha256:initial,scope:'Actual app navigation for4 mocked role values at320/1280 in3engines. GET-only disposable fixture8031; existing visibility policy asserted, not backend authorization or every role action. HOD is a runtime role value already handled by existing UI; no role contract changed.',results},null,2)+'\n');console.log('Role navigation workflows: '+results.length);
