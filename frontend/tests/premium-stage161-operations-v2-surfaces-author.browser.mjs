import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),api='http://127.0.0.1:8031',base='http://127.0.0.1:5277';
const files=['src/main.ts','src/premium-theme.css','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
const publish=await(await fetch(api+'/api/v1/rota-publish/month?month=2026-11')).json(),template=await(await fetch(api+'/api/v1/rota-template/month?month=2026-11')).json();
const ids=['setup','template','assignment','review','publish'],labels=['Setup','Build template','Assign members','Review','Publish'],results=[];
await mkdir('../docs/premium-ui/screenshots/stage161-operations-v2',{recursive:true});
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const scenario of['template-overview','missing-assignment-counts']){
  const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'}),errors=[],writes=[];let reads=0;
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','stages161');localStorage.setItem('duty_rota_working_month','2026-11');});
  const summary={...publish.summary};if(scenario==='missing-assignment-counts')delete summary.assigned_slots;
  const current={...publish,summary};
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push(q.method()+' '+u.pathname);return route.abort();}if(u.pathname==='/api/v1/rota-publish/month'){reads++;return route.fulfill({json:current});}if(u.pathname==='/api/v1/rota-template/month')return route.fulfill({json:template});return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search,maxRetries:2})});});
  try{
   await page.goto(base+'/#view='+(scenario==='template-overview'?'rota-template':'rota-publish'),{waitUntil:'domcontentloaded'});
   await page.locator('#workflow-tracker [data-workflow-freshness]').filter({hasText:'Checklist checked for this month.'}).waitFor({state:'attached'});
   const nav=page.locator('#workflow-tracker [data-workflow-operation]');
   assert.deepEqual(await nav.evaluateAll(ns=>ns.map(n=>n.dataset.workflowOperation)),ids);
   assert.deepEqual(await nav.locator('.nav-step__label').allTextContents(),labels);
   if(scenario==='template-overview'){
    const stages=page.locator('.generation-stages > li');await stages.first().waitFor();
    assert.deepEqual(await stages.evaluateAll(ns=>ns.map(n=>n.dataset.workflowOperation)),ids);
    assert.deepEqual(await stages.locator(':scope > strong').allTextContents(),labels.map((label,i)=>(i+1)+' · '+label));
    assert.match(await page.locator('#section-title').innerText(),/Steps 2–3/);
    await page.locator('.assignment-tools > summary').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.assignment-tools').evaluate(e=>e.open),true);
    assert.equal(await stages.count(),5);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(engine==='chromium')await page.screenshot({path:'../docs/premium-ui/screenshots/stage161-operations-v2/'+width+'-template.png',fullPage:true});
    const beforeReads=reads;await page.evaluate(()=>location.hash='#view=overview');await page.locator('.overview-steps').waitFor();
    assert.deepEqual(await page.locator('.overview-step').evaluateAll(ns=>ns.map(n=>n.dataset.workflowOperation)),ids);
    assert.deepEqual(await page.locator('.overview-step__label').allTextContents(),labels);
    await page.waitForTimeout(100);assert.equal(reads,beforeReads,'Overview must use cache only');
    assert.match(await page.locator('.overview-month [data-workflow-freshness]').innerText(),/Checklist checked for this month/);
   }else{
    assert.equal(await page.locator('#workflow-tracker [data-workflow-operation="assignment"]').getAttribute('data-state'),'unknown');
    assert.equal(await page.locator('#workflow-tracker [data-workflow-operation="assignment"] .visually-hidden').textContent(),', Open to check');
   }
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
   results.push({engine,width,scenario,checklistReads:reads,fiveDistinctOperationIds:true,missingCountsUnknown:scenario==='missing-assignment-counts',overviewCacheOnly:scenario==='template-overview',errors,writes});console.log(engine+' '+width+' '+scenario+' five stages passed');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-stage161-operations-v2-surfaces-author.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/generation161_stage_clarity_current_audit',scope:'Scratch V2 author12contexts: Template+Overview showfive distinctoperationIDs andsame labels; optionalassignmenttools remainreachable; Overviewcacheonly; malformed missing assignedcount leavesassignmentunknown. Threeengines320/1280. Noactionwrites,nofull161claim.',source_sha256:initial,candidate_main_sha256:sha(await readFile('../tmp/stage161-operations-v2/main.ts')),candidate_css_sha256:sha(await readFile('../tmp/stage161-operations-v2/premium-theme.css')),test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Stage161 V2 surfaces:12contexts');
