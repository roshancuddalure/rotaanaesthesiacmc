import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const data={summary:{personnel:0,active_personnel:0,total_records:0,total_24hr:0,total_weekend_24hr:0,weekend_percent:0,months:0,avg_24hr_per_active_person:0},months:[],month_labels:{},month_stats:{},days:[],duty_category_totals:{},people:[]};
const results=[];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{for(const initialWidth of [320,1280]){
  const context=await browser.newContext({viewport:{width:initialWidth,height:740},reducedMotion:'reduce'}),page=await context.newPage();
  let reads=0;const methods=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','independent-navigation'));
  await page.route('**/api/**',async route=>{
   methods.push(route.request().method());assert.equal(route.request().method(),'GET');
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/analysis/dashboard')){reads++;return route.fulfill({json:data});}
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base+'/#view=analysis');const rail=page.getByRole('tablist',{name:'Analysis sections'});await rail.waitFor();
  const tabs=rail.getByRole('tab'),panel=page.getByRole('tabpanel');assert.equal(await tabs.count(),9);
  assert.equal(await rail.getAttribute('aria-orientation'),'horizontal');
  async function selected(name){assert.equal(await tabs.filter({hasText:name}).getAttribute('aria-selected'),'true');assert.equal(await panel.getAttribute('aria-labelledby'),await tabs.filter({hasText:name}).getAttribute('id'));}
  async function revealed(tab){assert.equal(await tab.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1;}),true,'Focused/selected tab fully revealed inside its own rail');}
  await selected('Board Summary');await tabs.first().focus();const initialText=await panel.innerText(),scrollY=await page.evaluate(()=>scrollY);
  await page.keyboard.press('End');assert.equal(await tabs.last().evaluate(el=>el===document.activeElement),true);await revealed(tabs.last());
  await selected('Board Summary');assert.equal(await panel.innerText(),initialText,'Manual arrows must not switch data panels');assert.equal(await page.evaluate(()=>scrollY),scrollY,'Local rail navigation must not scroll whole page');
  await page.keyboard.press('Enter');await selected('Call Changes');await revealed(tabs.last());
  await page.setViewportSize({width:initialWidth===320?1280:320,height:570});await page.waitForTimeout(200);await revealed(tabs.last());
  await page.keyboard.press('ArrowRight');assert.equal(await tabs.first().evaluate(el=>el===document.activeElement),true);await revealed(tabs.first());await selected('Call Changes');
  await page.keyboard.press('Space');await selected('Board Summary');
  await page.keyboard.press('ArrowLeft');assert.equal(await tabs.last().evaluate(el=>el===document.activeElement),true);await revealed(tabs.last());
  await page.keyboard.press('Home');assert.equal(await tabs.first().evaluate(el=>el===document.activeElement),true);
  assert.equal(await tabs.evaluateAll(els=>els.filter(el=>el.tabIndex===0).length),1);
  await page.keyboard.press('Tab');assert.equal(await panel.evaluate(el=>el===document.activeElement),true,'Tab leaves tablist for its labelled panel');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(reads,1);assert.deepEqual(errors,[]);assert.ok(methods.every(method=>method==='GET'));
  if(engine==='chromium'){const axe=await new AxeBuilder({page}).include('.analysis-tabs').include('#analysis-tab-body').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);}
  results.push({engine,initialWidth,manual_arrow_end_home:true,native_enter_space:true,wraparound:true,one_roving_tabstop:true,labelled_panel:true,tab_enters_panel:true,resize_reveal:true,local_scroll_only:true,analysis_reads:reads,mutations:0,document_overflow:false});await context.close();
 }}finally{await browser.close();}
}
const sourceHashes=Object.fromEntries(await Promise.all(['src/main.ts','src/premium-theme.css'].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile('../docs/premium-ui/qa-analysis-navigation-independent.json',JSON.stringify({checked_at:new Date().toISOString(),sourceHashes,results,scope:'Independent real app analytics tab semantics and keyboard/resize outcomes across Chromium, Firefox and WebKit with GET-only fixture shell and empty analysis data. Does not certify calculations, exports, populated tables, physical devices or screen readers.'},null,2)+'\n');
console.log('Independent analytics navigation:6 keyboard/resize cross-browser workflows passed');
