import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const base='http://127.0.0.1:5188',api='http://127.0.0.1:8038';
const report={at:new Date().toISOString(),cases:[]};
const browser=await chromium.launch({headless:true});
try {
 for (const scenario of ['shortage','unknown','safe','forced_review']) {
  for (const width of [1440,390]) {
   const response=await fetch(`${api}/__fixture/template?scenario=${scenario}`,{method:'POST'});
   assert.equal(response.status,200);const seeded=await response.json();
   assert.equal(seeded.identity,'ot-template-browser-fixture-v1');
   assert.equal(seeded.assignments,0);assert.equal(seeded.slots.length,1);
   const slot=seeded.slots[0];
   const unresolved=['shortage','unknown'].includes(scenario);
   assert.equal(slot.template_status==='unresolved',unresolved);
   assert.equal(slot.is_forced_allocation,scenario==='forced_review');
   if(scenario==='safe')assert.equal(slot.template_status,'ready');
   if(scenario==='forced_review')assert.equal(slot.template_status,'needs_review');
   const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    localStorage.setItem('duty_rota_auth_token','disposable-ot-template');
    localStorage.setItem('duty_rota_working_month','2026-11');
   });
   await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    const response=await route.fetch({url:api+url.pathname+url.search});
    await route.fulfill({response});
   });
   await page.goto(base);
   await page.locator('[data-view="rota-template"]').first().evaluate(b=>b.click());
   await page.locator('[data-rota-overview-mode="calendar"]').click();
   const day=page.locator('[data-rota-day="2026-11-19"]').first();
   await day.waitFor();
   assert.match(await day.innerText(),/0\/1/);
   if(scenario!=='safe')assert.match(await day.getAttribute('class'),/review|hard/);
   if(unresolved)assert.match(await day.innerText(),/Unallocated unit/);
   await day.click();
   const modal=page.locator('#rota-day-modal');await modal.waitFor();
   await modal.locator('[data-rota-day-view-mode="full"]').click();
   await page.getByText(slot.template_reason,{exact:true}).first().waitFor();
   if(unresolved){
    assert.match(await modal.innerText(),/Unresolved/i);
    assert.match(await modal.innerText(),/Unallocated unit/);
    assert.doesNotMatch(await modal.locator('.rota-slot-card > header .status').innerText(),/ready|safe/i);
   }
   assert.deepEqual(errors,[]);
   const state=await(await fetch(api+'/__fixture/template-state')).json();
   assert.equal(state.assignments,0);
   await page.screenshot({path:`../docs/allocation-progress/ot-template-${scenario}-${width}.png`,fullPage:true});
   report.cases.push({scenario,width,status:slot.template_status,reason:slot.template_reason,
    errors,assignments:state.assignments,viewport_overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
   await context.close();
  }
 }
}catch(error){report.error=String(error);throw error;}
finally{await browser.close();await writeFile('../docs/allocation-progress/ot-template-browser.json',JSON.stringify(report,null,2)+'\n');}
console.log(`OT template browser checks passed: ${report.cases.length} scenarios/viewports.`);
