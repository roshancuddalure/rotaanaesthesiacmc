import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const paths=['src/rota-compute.ts','src/compute-device.ts','src/compute-protocol.ts','src/styles.css','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')]))),initial=await hashes(),results=[];
const caps={enabled:true,browser_gpu:true,template_compute:true,template_gpu:true,optimizer_gpu:true,context_hash:'fixture'};
const test={supported:true,software:false,adapter:'Fixture hardware (not a real GPU test)',vendor:'fixture',architecture:'fixture',description:'fixture',device:'fixture',signature:'fixture',test_ms:1,parity:true,preference:'high-performance',version:2,kernel_checks:{members:true,template:true,optimizer:true}};
const pref={enabled:true,mode:'server',power:'high-performance',test};
const cases=[
 {id:'deployment-off',caps:{enabled:false},reason:/Reviewed compute is disabled/},
 {id:'browser-off',caps:{browser_gpu:false},reason:/Browser GPU comparison is disabled/},
 {id:'opted-out',pref:{enabled:false},reason:/Enable GPU computation/},
 {id:'untested',pref:{test:undefined},reason:/Run Test Device first/},
 {id:'unsupported',test:{supported:false},reason:/supported device result/},
 {id:'software',test:{software:true},reason:/software adapter/},
 {id:'template-off',caps:{template_gpu:false},workload:'template',reason:/Template GPU comparison is unavailable/},
 {id:'optimizer-off',caps:{optimizer_gpu:false},workload:'optimizer',reason:/Optimiser GPU comparison is unavailable/},
 {id:'kernel-retest',test:{kernel_checks:{members:true,template:false,optimizer:false}},workload:'template',reason:/numeric kernel/},
 {id:'ready',reason:/Ready to compare/,enabled:true},
];
await mkdir('../docs/premium-ui/screenshots/compute',{recursive:true});
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const scheme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:scheme}),page=await context.newPage(),errors=[],requests=[];let currentCaps;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__compute_prerequisites',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compute prerequisites</title><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host" style="padding:16px"></main></body></html>'}));
  await page.route('**/api/**',r=>{const q=r.request(),path=new URL(q.url()).pathname;requests.push({method:q.method(),path});assert.equal(q.method(),'GET');assert.equal(path,'/api/v1/rota-compute/capabilities');return r.fulfill({json:currentCaps});});
  await page.goto('http://127.0.0.1:5197/__compute_prerequisites');
  for(const scenario of cases){
   currentCaps={...caps,...scenario.caps};const preference={...pref,test:{...test,...scenario.test},...scenario.pref};
   await page.evaluate(async preference=>{localStorage.clear();localStorage.setItem('duty_rota_compute_device_v1',JSON.stringify(preference));await(await import('/src/rota-compute.ts')).renderComputeSettings(document.querySelector('#host'));},preference);
   await page.locator('[data-compute-month]').fill('2026-11');await page.locator('[data-compute-month]').press('Tab');if(scenario.workload)await page.locator('[data-compute-workload]').selectOption(scenario.workload);
   assert.match(await page.locator('[data-compute-status]').innerText(),preference.enabled?/preferences loaded/:/computation is off/);const compare=page.locator('[data-compute-compare]'),reason=page.locator('[data-compute-comparison-help]');assert.equal(await compare.isEnabled(),Boolean(scenario.enabled));assert.match(await reason.innerText(),scenario.reason);assert.equal(await compare.getAttribute('aria-describedby'),'compute-comparison-help');assert.equal(await page.locator('[data-compute-month]').inputValue(),'2026-11');assert.match(await page.locator('#host').innerText(),/creates and cancels six proposals/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(scenario.id==='untested'){
    const axe=await new AxeBuilder({page}).include('.compute-settings').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(axe.violations,[]);
    await reason.scrollIntoViewIfNeeded();if(engine==='chromium')await page.screenshot({path:`../docs/premium-ui/screenshots/compute/prerequisite-${width}-${scheme}.png`});
   }
   results.push({engine,width,scheme,scenario:scenario.id,disabled:!scenario.enabled,reason:await reason.innerText(),describedBy:true,monthPreserved:true,unchangedComparisonScope:true,noOperationalWrites:true});
  }
  assert.equal(requests.length,cases.length);assert.deepEqual(errors,[]);await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-compute-prerequisites.json',JSON.stringify({source_sha256:initial,scope:'ComputeSettings10existinggates/3engines/320-1280/light-dark. Fixture capabilities and storedDeviceTest only; no worker/GPU test/job creation. Existing enabled state expected unchanged.12scoped axe surfaces,0violations.',results},null,2)+'\n');console.log('Compute prerequisite states: '+results.length);
