import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,firefox,webkit} from 'playwright';
const results=[],unit={id:'card-unit',name:'Royal Card Unit',campus:'Main',code:'CARD',minimum_free_people:1,active_status:'active',notes:null};
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{const page=await browser.newPage({viewport:{width:320,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','card-opener-probe');localStorage.setItem('duty_rota_working_month','2026-05');});
 await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());assert.equal(q.method(),'GET');if(u.pathname.endsWith('/unit-management/month'))return route.fulfill({json:{month:'2026-05',starts_on:'2026-05-01',ends_on:'2026-05-31',units:[unit],assignments:[],unit_summaries:[{unit_id:unit.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[],validation_issues:[]}});return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search})});});
 await page.goto('http://127.0.0.1:5217/#view=units');const card=page.locator('[data-unit-board-card="unit:card-unit"]');await card.locator('h3').click();const modal=page.locator('#unit-management-modal');await modal.waitFor();await page.waitForFunction(()=>document.activeElement?.matches('#unit-management-modal [data-close-unit-modal]'));await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});
 const outcome=await page.evaluate(()=>{const e=document.activeElement,card=document.querySelector('[data-unit-board-card="unit:card-unit"]');return{activeTag:e?.tagName,activeLabel:e?.getAttribute('aria-label'),insideCard:card.contains(e),cardTabindex:card.getAttribute('tabindex')};});assert.equal(outcome.insideCard,true,'Card-title opener returns to the corresponding focusable Manage control');assert.equal(outcome.activeLabel,'Manage Royal Card Unit');assert.deepEqual(errors,[]);results.push({engine,outcome,errors});
 }finally{await page.close();}}finally{await browser.close();}
}
await writeFile('../docs/premium-ui/qa-unit-modal-card-opener-v6.json',JSON.stringify({scope:'Actual card-title click opener in scratch V6. Exact corresponding Manage control asserted in all three engines. GET fixture/local RAM only; no app changes.',results},null,2)+'\n');console.log(JSON.stringify(results));
