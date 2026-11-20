import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const api='http://127.0.0.1:8043',base='http://127.0.0.1:5188';
assert.equal((await(await fetch(api+'/__fixture/objective-identity')).json()).identity,'objective-basis-memory-fixture-v1');
const browser=await chromium.launch({headless:true}),report=[];
try{
 for(const width of [1440,390,320]){
  await fetch(api+'/__fixture/reset',{method:'POST'});
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  let legacy=false;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__objectives',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Objective basis fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body></body></html>'}));
  await page.route('**/api/**',async r=>{
   const url=new URL(r.request().url());const response=await r.fetch({url:api+url.pathname+url.search});
   if(legacy&&url.pathname.startsWith('/api/v1/rota-compute/jobs/')){
    const json=await response.json();
    if(json.intelligence?.alternatives)for(const row of json.intelligence.alternatives)delete row.objective_basis;
    return r.fulfill({response,json});
   }
   await r.fulfill({response});
  });
  await page.goto(base+'/__objectives');
  await page.evaluate(async()=>{const m=await import('/src/rota-intelligence.ts');await m.openIntelligentRota('2026-05',true,()=>window.applied=true);});
  let dialog=page.getByRole('dialog',{name:'Intelligent rota generator',exact:true});
  await dialog.locator('[data-generate]').waitFor();
  // Use the existing explicit generator action, never automatic application.
  await dialog.locator('[data-generate]').click();
  await dialog.locator('[data-objective-basis]').waitFor({timeout:90000});
  const basis=dialog.locator('[data-objective-basis]');
  assert.match(await basis.textContent(),/shared target within each call level/);
  assert.match(await basis.textContent(),/does not minimize personal pro-rata deviation/);
  assert.equal(await dialog.locator('[data-apply]').isDisabled(),true);
  assert.equal((await(await fetch(api+'/__fixture')).json()).active_assignments,0);
  const axe=await new AxeBuilder({page}).include('[data-objective-basis]').analyze();
  assert.deepEqual(axe.violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>row.id),[]);
  assert.equal(await dialog.locator('.mw-content').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(width===390){await basis.scrollIntoViewIfNeeded();await page.screenshot({path:'../docs/allocation-progress/n05-objective-basis-390.png'});}
  const jobs=await(await fetch(api+'/api/v1/rota-compute/jobs?month=2026-05')).json();
  assert.equal(jobs.length,1);const job=jobs[0];
  // A historical saved proposal lacking metadata must not be reinterpreted using
  // whatever rules are current in the browser today.
  await page.evaluate(()=>document.querySelector('dialog.intelligent-workspace').close());
  legacy=true;
  await page.evaluate(async jobId=>{const m=await import('/src/rota-intelligence.ts');await m.openIntelligentRota('2026-05',true,()=>{},undefined,jobId);},job.id);
  dialog=page.getByRole('dialog',{name:'Intelligent rota generator',exact:true});
  await dialog.locator('[data-objective-basis]').waitFor();
  assert.match(await dialog.locator('[data-objective-basis]').textContent(),/not recorded/);
  assert.equal((await(await fetch(api+'/__fixture')).json()).active_assignments,0);
  assert.deepEqual(errors,[]);
  report.push({width,canonical_uniform_basis:true,partial_availability_disclosed:true,
               legacy_unknown:true,no_automatic_apply:true,axe_serious_critical:0,page_errors:errors});
  await page.unrouteAll({behavior:'wait'});await context.close();
 }
 await writeFile('../docs/allocation-progress/n05-objective-basis-browser.json',JSON.stringify(report,null,2)+'\n');
}finally{await browser.close();}
