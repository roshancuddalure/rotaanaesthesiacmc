import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const hashes=async()=>Object.fromEntries(await Promise.all(['member-workspace.ts','styles.css','premium-theme.css'].map(async n=>['frontend/src/'+n,createHash('sha256').update(await readFile('src/'+n)).digest('hex')]))),initial=await hashes(),results=[];
const months={'2026-02':28,'2028-02':29,'2026-11':30,'2026-12':31};
const rows=Object.entries(months).flatMap(([month,count])=>[{id:month+'-start',date:month+'-01',duty:'Main duty',source:'published'},{id:month+'-end',date:month+'-'+count,duty:'Draft duty',source:'draft'}]);
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const admin of [false,true]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',colorScheme:width===320?'dark':'light'}),page=await context.newPage(),errors=[];let dutyReads=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/__profile_workload',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open profile</button></body></html>'}));
  await page.route('**/api/**',async r=>{
   assert.equal(r.request().method(),'GET','Workload navigation never mutates');const p=new URL(r.request().url()).pathname;
   if(p==='/api/v1/admin/member-workspace/workload-person')return r.fulfill({json:{member:{id:'workload-person',canonical_name:'Dr Workload Example',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[],revision:'one'},impact:{future_duties:8,current_or_future_postings:0,eligibility_memberships:0}}});
   if(p.endsWith('/duties')){assert.equal(p,'/api/v1/admin/member-workspace/workload-person/duties');dutyReads++;return r.fulfill({json:{rows,months:Object.keys(months),analysis:{total_24hr:4,total_weekend_24hr:0,monthly_24hr:Object.fromEntries(Object.keys(months).map(m=>[m,1])),day_breakdown:{},call_levels:{},units:{},promotions:[]}}});}
   assert.equal(p,'/api/v1/extra-duty/ledger');return r.fulfill({json:[]});
  });
  await page.goto('http://127.0.0.1:5197/__profile_workload');await page.evaluate(admin=>{document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('workload-person',admin,()=>{},[],'duties'));},admin);
  await page.locator('#open').focus();await page.keyboard.press('Enter');const dialog=page.locator('dialog.member-workspace');await dialog.locator('[data-duty-month]').first().waitFor();
  const metrics=await dialog.locator('.mw-summary').innerText();assert.equal(await dialog.locator('.mw-history').count(),8);
  for(const [month,count]of Object.entries(months)){
   const button=dialog.getByRole('button',{name:`Review duty records for ${month}`,exact:true});await button.focus();await page.keyboard.press('Enter');
   assert.equal(await dialog.locator('[data-duty-from]').inputValue(),month+'-01');assert.equal(await dialog.locator('[data-duty-until]').inputValue(),month+'-'+count);
   assert.equal(await dialog.locator('[data-duty-from]').evaluate(e=>e===document.activeElement),true);
   assert.equal(await dialog.locator('.mw-history').count(),2);
   for(const record of await dialog.locator('.mw-history').all())assert.match(await record.innerText(),new RegExp(({'02':'Feb','11':'Nov','12':'Dec'}[month.slice(5)])+' '+month.slice(0,4)));
   assert.match(await dialog.locator('.mw-history').first().innerText(),/Published/);assert.match(await dialog.locator('.mw-history').last().innerText(),/Draft/);
   assert.equal(await dialog.locator('.mw-summary').innerText(),metrics,'Filtering records does not recalculate official aggregates');
   const reset=dialog.getByRole('button',{name:'Show all duty records',exact:true});await reset.focus();await page.keyboard.press('Enter');
   assert.equal(await dialog.locator('[data-duty-from]').inputValue(),'');assert.equal(await dialog.locator('[data-duty-until]').inputValue(),'');assert.equal(await dialog.locator('.mw-history').count(),8);
   assert.equal(await dialog.locator('[data-duty-from]').evaluate(e=>e===document.activeElement),true);assert.equal(await reset.count(),0);
  }
  if(admin){
   await dialog.locator('[data-edit]').click();await dialog.locator('[data-field=canonical_name]').fill('Unsaved workload draft');await dialog.locator('[data-tab=duties]').click();
   await dialog.locator('[data-duty-month="2028-02"]').click();await dialog.locator('[data-clear-duty-dates]').click();await dialog.locator('[data-tab=details]').click();
   assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),'Unsaved workload draft');await dialog.locator('[data-tab=duties]').click();
  }else assert.equal(await dialog.locator('[data-edit]').count(),0);
  const axe=await new AxeBuilder({page}).include('dialog.member-workspace').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[],JSON.stringify({violations:axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({html:n.html,summary:n.failureSummary}))})),identity:await dialog.locator('h2[data-member-identity]').evaluate(e=>({sh:e.scrollHeight,ch:e.clientHeight,sw:e.scrollWidth,cw:e.clientWidth,rect:e.getBoundingClientRect().toJSON(),tabindex:e.getAttribute('tabindex')}))}));
  assert.equal(dutyReads,1,'Month shortcuts reuse the existing member duty cache');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  results.push({engine,width,admin,months:months,exactMemberDutyReads:dutyReads,monthShortcutAndResetKeyboard:true,exactFocus:true,officialAggregatesUnchanged:true,publishedAndDraftRecordsRetained:true,adminDraftPreserved:admin,viewOnlyGatePreserved:!admin,taggedAxeViolations:0,noWrites:true,errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-profile-workload-links.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Actual profile duties with intercepted exact-memberGET, mixed published/draft rows, four month boundaries, shortcuts/reset, cached data, unchanged official aggregates and admin draft. Three engines dark320/light1280, view-only/admin fixtures; not backend permission or aggregate equivalence certification.',results},null,2)+'\n');console.log(`Profile workload links: ${results.length} workflows passed`);
