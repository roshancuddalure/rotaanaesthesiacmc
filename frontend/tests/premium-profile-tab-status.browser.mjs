import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const hashes=async()=>Object.fromEntries(await Promise.all(['member-workspace.ts','styles.css','premium-theme.css'].map(async n=>['frontend/src/'+n,createHash('sha256').update(await readFile('src/'+n)).digest('hex')]))),initial=await hashes(),results=[];
const labels=['Overview','Details','Roles & eligibility','Postings','Leave','Duty history','Names & duplicates','Activity'];
await mkdir('../docs/premium-ui/screenshots/profile-tabs',{recursive:true});
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const admin of [false,true]){
  const context=await browser.newContext({viewport:{width,height:800},colorScheme:width===320?'dark':'light',reducedMotion:'reduce'}),page=await context.newPage(),errors=[],reads=[];let activityReads=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/__profile_tab_status',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open profile</button></body></html>'}));
  await page.route('**/api/**',r=>{const q=r.request(),p=new URL(q.url()).pathname;assert.equal(q.method(),'GET');reads.push(p);
   if(p==='/api/v1/admin/member-workspace/tab-member')return r.fulfill({json:{member:{id:'tab-member',canonical_name:'Dr Tab Review',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[]},impact:{}}});
   if(p==='/api/v1/extra-duty/ledger')return r.fulfill({json:[]});
   assert.ok(p.startsWith('/api/v1/admin/member-workspace/tab-member/'));const key=p.split('/').at(-1);
   if(key==='postings')return r.fulfill({json:{rows:[{id:'posting-one',unit:'Unit One',starts_on:'2026-11-01',ends_on:null}]}});
   if(key==='leave')return r.fulfill({json:{rows:[]}});
   if(key==='duties')return r.fulfill({json:{rows:[{id:'duty-one',date:'2026-11-01',duty:'Main',source:'published'},{id:'duty-two',date:'2026-11-02',duty:'Main',source:'draft'}]}});
   assert.equal(key,'activity');activityReads++;return activityReads===1?r.fulfill({status:503,json:{detail:'Section history unavailable'}}):r.fulfill({json:{rows:Array.from({length:3},(_,i)=>({action:'member_updated',operator:'Reviewer '+i,created_at:'2026-11-01T10:00:00Z',details:{before:{name:'Before'},after:{name:'After'}}}))}});
  });
  await page.goto('http://127.0.0.1:5197/__profile_tab_status');await page.evaluate(admin=>{document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('tab-member',admin,()=>{}));},admin);await page.locator('#open').focus();await page.keyboard.press('Enter');
  const dialog=page.locator('dialog.member-workspace'),rail=dialog.getByRole('tablist',{name:'Member sections'});await rail.waitFor();
  assert.deepEqual(await rail.getByRole('tab').evaluateAll(es=>es.map(e=>e.textContent)),labels);assert.equal(await rail.locator('.mw-tab-count').count(),0,'Unloaded sections never invent zero counts');
  if(admin){await dialog.locator('[data-edit]').click();await dialog.locator('[data-field=canonical_name]').fill('Unsaved tab status draft');}
  const open=async label=>{const tab=rail.getByRole('tab',{name:label,exact:true});await tab.focus();await page.keyboard.press('Enter');return tab;};
  for(const [label,count]of [['Postings',1],['Leave',0],['Duty history',2]]){
   const tab=await open(label);await tab.locator('.mw-tab-count').filter({hasText:count+' loaded'}).waitFor();assert.match(await tab.getAttribute('aria-description'),new RegExp(`^${count} records? loaded`));assert.equal(await tab.locator('.mw-tab-count').getAttribute('aria-hidden'),'true');assert.equal(await rail.getByRole('tab',{name:label,exact:true}).count(),1,'Loaded badge does not rename the existing tab');
  }
  await dialog.locator('[data-duty-from]').fill('2026-11-02');await dialog.locator('[data-duty-from]').press('Tab');assert.equal(await dialog.locator('.mw-history').count(),1);assert.equal(await rail.locator('[data-tab=duties] .mw-tab-count').innerText(),'2 loaded','Loaded count stays distinct from filtered rows');
  const activity=await open('Activity');await dialog.getByText('Section history unavailable',{exact:true}).waitFor();assert.equal(await activity.locator('.mw-tab-count').innerText(),'Retry needed');assert.match(await activity.getAttribute('aria-description'),/could not load/);assert.equal(activityReads,1);
  const errorAxe=await new AxeBuilder({page}).include('nav.mw-rail').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(errorAxe.violations.map(v=>v.id),[]);
  if(engine==='chromium'&&width===320&&!admin)await page.screenshot({path:'../docs/premium-ui/screenshots/profile-tabs/retry-320.png'});
  const retry=dialog.locator('[data-retry]');await retry.focus();await page.keyboard.press('Enter');await activity.locator('.mw-tab-count').filter({hasText:'3 loaded'}).waitFor();assert.equal(activityReads,2);assert.equal(await activity.getAttribute('aria-description'),'3 records loaded in this section. Loaded records may be a subset of the full history.');assert.equal(await activity.evaluate(e=>e===document.activeElement),true);
  await activity.focus();await page.keyboard.press('Home');assert.equal(await rail.locator('[aria-selected=true]').getAttribute('data-tab'),'overview');await page.keyboard.press('End');assert.equal(await rail.locator('[aria-selected=true]').getAttribute('data-tab'),'activity');assert.equal(activityReads,2,'Cached tab navigation never adds a read');
  assert.equal(await rail.locator('[data-tab=roles] .mw-tab-count,[data-tab=names] .mw-tab-count').count(),0,'Composite sections do not get ambiguous counts');
  const selected=await activity.boundingBox(),bounds=await rail.boundingBox();const horizontal=await rail.evaluate(e=>getComputedStyle(e).flexDirection==='row');assert.ok(horizontal?selected.x>=bounds.x-1&&selected.x+selected.width<=bounds.x+bounds.width+1:selected.y>=bounds.y-1&&selected.y+selected.height<=bounds.y+bounds.height+1,'Selected tab remains revealed with badges');
  const axe=await new AxeBuilder({page}).include('nav.mw-rail').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
  await open('Details');if(admin)assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),'Unsaved tab status draft');else assert.equal(await dialog.locator('[data-edit]').count(),0);
  assert.deepEqual(reads.filter(p=>p.includes('/tab-member/')).sort(),['activity','activity','duties','leave','postings'].map(k=>'/api/v1/admin/member-workspace/tab-member/'+k).sort());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  await dialog.locator('[data-close]').click();await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#open').evaluate(e=>e===document.activeElement),true);results.push({engine,width,admin,stableLabelsAndOrder:true,onlyReturnedListCounts:true,zeroDistinctFromUnknown:true,filteredRowsDistinctFromLoadedCount:true,errorAndRetryState:true,nativeHomeEndAndReveal:true,exactExistingReadCounts:true,draftOrViewGatePreserved:true,scopedAxeViolations:0,noWrites:true,errors});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-profile-tab-status.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Canonical tab labels/order with returned-list counts, unloaded/zero/error/retry and filtered-duty distinction. Three engines dark320/light1280, admin/view-only fixtures, exactGET paths/cached reads, no writes; not backend total-history or permissions certification.',results},null,2)+'\n');console.log(`Profile tab status: ${results.length} workflows`);
