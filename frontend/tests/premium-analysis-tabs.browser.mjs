import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
const results=[];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{
  for(const width of [320,700,701,1280]){
   const context=await browser.newContext({viewport:{width,height:720},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
   let reads=0;
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>localStorage.setItem('duty_rota_auth_token','navigation-review'));
   await page.route('**/api/**',async route=>{
    assert.equal(route.request().method(),'GET');const url=new URL(route.request().url());
    if(url.pathname.endsWith('/analysis/dashboard'))reads++;
    return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
   });
   await page.goto(base+'/#view=analysis');
   const rail=page.getByRole('tablist',{name:'Analysis sections',exact:true}),tabs=rail.getByRole('tab'),panel=page.getByRole('tabpanel');
   await rail.waitFor();const initialReads=reads;
   assert.equal(await tabs.count(),9);
   const selected=()=>rail.locator('[aria-selected="true"]');
   const inRail=async tab=>{
    await page.waitForFunction(id=>{const el=document.getElementById(id),rail=el?.closest('[role=tablist]');if(!el||!rail)return false;const a=el.getBoundingClientRect(),b=rail.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1;},await tab.getAttribute('id'));
    const geometry=await tab.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('[role=tablist]').getBoundingClientRect();return {left:a.left,right:a.right,start:b.left,end:b.right};});
    assert.ok(geometry.left>=geometry.start-1&&geometry.right<=geometry.end+1,JSON.stringify(geometry));
   };
   await tabs.first().focus();const scroll=await page.evaluate(()=>scrollY);
   await page.keyboard.press('End');
   assert.equal(await tabs.last().evaluate(el=>el===document.activeElement),true);
   assert.equal(await selected().innerText(),'Board Summary','Arrows move focus without activating');
   await inRail(tabs.last());assert.equal(await page.evaluate(()=>scrollY),scroll,'Reveal scrolls strip only');
   await page.keyboard.press('Enter');
   assert.equal(await selected().innerText(),'Call Changes');
   assert.equal(await panel.getAttribute('aria-labelledby'),'analysis-tab-promotions');
   await page.keyboard.press('Home');await inRail(tabs.first());
   assert.equal(await selected().innerText(),'Call Changes');
   await page.keyboard.press('Space');assert.equal(await selected().innerText(),'Board Summary');
   await page.keyboard.press('ArrowLeft');assert.equal(await tabs.last().evaluate(el=>el===document.activeElement),true,'Left wraps');
   await page.keyboard.press('ArrowRight');assert.equal(await tabs.first().evaluate(el=>el===document.activeElement),true,'Right wraps');
   assert.equal(await rail.locator('[tabindex="0"]').count(),1);
   await page.keyboard.press('ArrowDown');assert.equal(await tabs.first().evaluate(el=>el===document.activeElement),true,'Vertical arrow retains ordinary page behavior');
   await page.keyboard.press('Tab');assert.equal(await panel.evaluate(el=>el===document.activeElement),true,'Panel is next keyboard stop');
   await tabs.last().click();await page.setViewportSize({width:width===320?1280:320,height:720});
   await inRail(tabs.last());assert.equal(await selected().innerText(),'Call Changes');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await tabs.last().focus();await page.keyboard.press('Home');await page.keyboard.press('Enter');
   if(engine==='chromium'){
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(item=>item.id),[]);
   }
   assert.equal(reads,initialReads,'Manual tab navigation reuses dashboard');assert.deepEqual(errors,[]);
   results.push({engine,width,manual_activation:true,arrow_wrap_home_end:true,panel_relationship:true,one_roving_stop:true,selected_visible_after_resize:true,local_reveal_preserves_page_scroll:true,unchanged_dashboard_reads:true,backend_writes:0});
   await context.close();
  }
 }finally{await browser.close();}
}
await writeFile('../docs/premium-ui/qa-analysis-tabs.json',JSON.stringify({results,scope:'Actual app keyboard/pointer/resize outcomes; GET-only isolated fixture. No physical-device or screen-reader certification.'},null,2)+'\n');
console.log('Analysis tabs:12 cross-browser keyboard, manual activation and responsive workflows passed');
