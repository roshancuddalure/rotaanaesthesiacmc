import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base='http://127.0.0.1:5178', server='http://127.0.0.1:8019';
const browser=await chromium.launch({headless:true,executablePath:process.env.MEMBER_TEST_BROWSER || 'C:/Users/rosha/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'});
const reset=()=>fetch(server+'/__fixture/reset',{method:'POST'});
const fixture=async()=>(await fetch(server+'/__fixture')).json();
const report={workflows:[],local_model:null};
async function open(width) {
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.context().grantPermissions(['local-network-access'],{origin:base});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let sentInstruction='';
 page.on('request',r=>{if(r.url().includes('11435/suggest'))sentInstruction=JSON.parse(r.postData()).instruction;});
 await page.route('**/__intelligence-test',r=>r.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><button>Open</button></body></html>'}));
 await page.route('**/api/**',async r=>{const url=new URL(r.request().url());if(url.port==='11435'){await r.continue();return;}const response=await r.fetch({url:server+url.pathname+url.search});await r.fulfill({response});});
 await page.goto(base+'/__intelligence-test');
 await page.evaluate(async()=>{const m=await import('/src/rota-intelligence.ts');await m.openIntelligentRota('2026-05',true,()=>{window.applied=true;});});
 return {page,errors,instruction:()=>sentInstruction};
}
try {
 for(const width of [1280,390,320]) {
  await reset();const {page,errors}=await open(width);
  await page.getByRole('button',{name:'Generate intelligent draft',exact:true}).click();
  await page.getByText('Draft ready for review. No assignments have been saved.',{exact:true}).waitFor();
  assert.equal((await fixture()).assignments,0);
  assert.equal(await page.locator('[data-apply]').isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('dialog .table-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  if(width===390)await page.screenshot({path:'tests/artifacts/intelligent-review-mobile.png'});
  if(width===1280) {
   await page.locator('[data-more]').click();
   await page.getByText('Alternative search finished. Compare coverage and changes before selecting.').waitFor();
   assert.equal(await page.locator('[data-alternative] option').count(),2);
   await page.locator('[data-alternative]').selectOption('1');
   await page.waitForFunction(()=>!document.querySelector('.mw-footer')?.textContent.includes('Working.'));
   await page.locator('[data-teach-slot]').first().click();
   await page.locator('[name=note]').fill('Prefer this because burden is balanced.');
   await page.getByRole('button',{name:'Save teaching example',exact:true}).click();
   await page.getByText('Teaching example saved for review.').waitFor();
   await page.locator('[data-approve-example]').click();
   await page.getByText('2026-05 · accept · burden · approved',{exact:true}).waitFor();
   await page.locator('[data-tab=learning]').click();
   await page.getByRole('button',{name:'Prepare candidate version'}).click();
   await page.getByText('candidate ·',{exact:false}).waitFor();
   assert.equal(await page.locator('[data-activate]').count(),0);
   await page.locator('[data-tab=review]').click();
  }
  await page.locator('[data-confirm]').check();
  await page.locator('[data-apply]').click();
  await page.getByText('2 assignments saved; 0 replaced. Not published.').waitFor();
  assert.equal((await fixture()).assignments,2);
  assert.equal(await page.evaluate(()=>window.applied),true);
  assert.deepEqual(errors,[]);report.workflows.push(`review_apply_${width}`);await page.close();
  if(width===1280) {
   const setup=await(await fetch(server+'/api/v1/rota-intelligence/setup?month=2026-05')).json();
   const slot=setup.slots.find(s=>s.assigned.length===1);
   await fetch(server+'/__fixture/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({person_id:slot.assigned[0].id,date:slot.date})});
   const repair=await open(390);
   await repair.page.locator('[data-mode]').selectOption('repair');
   await repair.page.getByText('Locks and repair scope',{exact:true}).click();
   await repair.page.locator(`[data-repair="${slot.id}"]`).check();
   await repair.page.getByRole('button',{name:'Generate intelligent draft',exact:true}).click();
   await repair.page.getByText('Draft ready for review. No assignments have been saved.').waitFor();
   assert.equal((await fixture()).cancelled_assignments,0);
   await repair.page.locator('[data-confirm]').check();
   await repair.page.locator('[data-apply]').click();
   await repair.page.getByText('1 assignments saved; 1 replaced. Not published.').waitFor();
   const repaired=await fixture();assert.equal(repaired.active_assignments,2);assert.equal(repaired.cancelled_assignments,1);
   report.workflows.push('mobile_repair_after_approved_leave');await repair.page.close();
  }
 }
 await reset();
 const paused=await open(390);
 await paused.page.getByRole('button',{name:'Generate intelligent draft',exact:true}).click();
 await paused.page.getByText('Draft ready for review. No assignments have been saved.').waitFor();
 await paused.page.locator('[data-close]').click();await paused.page.close();
 const resumed=await open(390);
 await resumed.page.locator('[data-tab=review]').click();
 assert.equal(await resumed.page.locator('[data-apply]').count(),1);
 await resumed.page.locator('[data-cancel]').click();
 await resumed.page.getByText('Proposal cancelled; assignments unchanged.').waitFor();
 assert.equal((await fixture()).assignments,0);
 report.workflows.push('resume_completed_and_cancel');await resumed.page.close();
 if(process.env.ASSISTANT_TEST_TOKEN) {
  await reset();const {page,errors,instruction}=await open(390);
  await page.locator('[data-tab=assistant]').click();
  await page.locator('[data-local-enabled]').check();
  await page.locator('[data-local-token]').fill(process.env.ASSISTANT_TEST_TOKEN);
  await page.locator('[data-instruction]').fill('Balance weekend duties fairly. Preserve existing assignments.');
  await page.getByRole('button',{name:'Ask local assistant'}).click();
  await page.getByText('Local suggestion received. Review before using.').waitFor({timeout:100000});
  assert.equal(instruction(),'Balance weekend duties fairly. Preserve existing assignments.');
  assert.equal((await fixture()).assignments,0);
  const text=await page.locator('article').innerText();
  assert.match(text,/Suggested mode: balanced/);
  await page.locator('[data-use-suggestion]').click();
  assert.equal(await page.locator('[data-mode]').inputValue(),'balanced');
  assert.deepEqual(errors,[]);
  report.local_model={passed:true,local_only:true,response:text};report.workflows.push('real_browser_local_model_pairing_and_suggestion');
  await page.close();
 }
 await writeFile('../docs/benchmarks/rota_intelligence_browser.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
