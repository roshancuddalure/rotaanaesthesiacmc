import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const paths=['src/analysis-charts.ts','src/ui.ts','src/styles.css','src/premium-theme.css','tests/premium-motion-chart-bars.browser.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')]))),before=await hashes(),results=[];
const entries=[{label:'Known month',total:10,weekend:4},{label:'Actual zero',total:0,weekend:0},{label:'Unavailable <img src=x>',total:-1,weekend:2}];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280])for(const motion of ['reduce','no-preference']){
  const page=await browser.newPage({viewport:{width,height:800},reducedMotion:motion}),errors=[];let apiCalls=0;
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',r=>{apiCalls++;return r.abort();});
  await page.route('**/__motion_chart',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="chart-host"></main></body></html>'}));
  await page.goto((process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197')+'/__motion_chart');await page.evaluate(async entries=>{const m=await import('/src/analysis-charts.ts');document.querySelector('#chart-host').innerHTML=m.renderAnalysisBars(entries,'Motion data fixture');},entries);
  const measurements=await page.locator('.bar').evaluateAll(ns=>ns.map(n=>{const c=getComputedStyle(n);return{class:n.className,hidden:n.hidden,inlineHeight:n.style.height,height:c.height,transition:c.transitionDuration,property:c.transitionProperty,animation:c.animationName};}));
  assert.equal(measurements.length,4);assert.deepEqual(measurements.map(m=>m.inlineHeight),['48px','72px','0px','0px']);
  for(const m of measurements){assert.equal(m.transition,motion==='reduce'?'0s':'0.3s');assert.equal(m.animation,'none');assert.equal(m.property,motion==='reduce'?'none':'height');}
  assert.equal(await page.locator('img').count(),0);assert.equal(await page.locator('.chart-unavailable').count(),1);
  const data=page.locator('.chart-data'),summary=data.locator('summary');await summary.focus();await page.keyboard.press('Enter');assert.equal(await data.evaluate(n=>n.open),true);
  assert.deepEqual(await data.locator('tbody tr').evaluateAll(ns=>ns.map(n=>[...n.cells].map(c=>c.textContent))),[['Known month','10','4','6'],['Actual zero','0','0','0'],['Unavailable <img src=x>','-1','2','-3']]);
  const text=await data.locator('table').innerText();await page.keyboard.press('Enter');assert.equal(await data.evaluate(n=>n.open),false);await page.keyboard.press('Enter');assert.equal(await data.locator('table').innerText(),text);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);assert.equal(apiCalls,0);
  results.push({engine,width,motion,measurements,nativeDataDisclosurePreservesAllReturnedValues:true,apiCalls,errors});await page.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),before);await writeFile('../docs/premium-ui/qa-motion-chart-bars.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:before,scope:'Actual exported renderAnalysisBars helper and unchanged production CSS;300ms authored chart height transition resolves normally and becomes0 underreduce, exact known/zero/unplottable records and native data disclosure unchanged. No fabricated in-place bar height mutation, backend calls or actual chart-data update workflow claimed.',results},null,2)+'\n');console.log(`Motion chart bars: ${results.length} contexts passed`);
