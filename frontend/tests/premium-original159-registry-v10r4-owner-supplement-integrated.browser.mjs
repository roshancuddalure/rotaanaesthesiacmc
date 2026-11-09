import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),base='http://127.0.0.1:5197',folder='../tmp/registry-parent-refresh-v10r4';
const report='../docs/premium-ui/qa-original159-registry-v10r4-integrated-owner-supplement.json';await assert.rejects(access(report),{code:'ENOENT'});
const manifest=JSON.parse(await readFile(folder+'/manifest.json','utf8'));
const held={};for(const[n,b]of Object.entries(manifest.files)){
 held[n]=sha(await readFile('src/'+n));assert.equal(held[n],b.candidate_sha256);
 assert.equal(sha(await readFile(folder+'/'+n)),b.candidate_sha256);
 const text=await(await fetch(base+'/src/'+n)).text(),m=text.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(m);
 assert.ok(JSON.parse(Buffer.from(m[1],'base64').toString()).sourcesContent.some(s=>sha(s)===b.candidate_sha256));
}
const original={id:'registry-parent',name:'Royal Registry Parent',campus:'Main',code:'PARENT',minimum_free_people:1,active_status:'active',aliases:[],notes:'',call_minimums:[],revision:'one',usage:{postings:0,duties:0,future_postings:0,future_duties:0,selected_members:0}};
const modes=['route-owner','month-owner','account-owner','native-close','accepted-dirty-refusal','busy-close'];
const results=[];
for(const[engine,launcher]of Object.entries({chromium})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const mode of modes){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(10000);
  const requests=[],writes=[],errors=[],prompts=[];let registryReads=0,boardReads=0,fallbackReads=0,ownFailed=false,parentFailed=false,dismiss=false;
  let releaseWrite; const writeGate=new Promise(resolve=>{releaseWrite=resolve;});
  let units=mode==='first-unit'?[]:[original,{...original,id:'registry-b',name:'Royal Fallback B',code:'B'},{...original,id:'registry-c',name:'Royal Fallback C',code:'C'}];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{prompts.push(d.message());await(dismiss?d.dismiss():d.accept());});
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','registry-local');localStorage.setItem('duty_rota_working_month','2026-11');});
  const board=month=>({month,starts_on:'2026-11-01',ends_on:'2026-11-30',units,assignments:[],unit_summaries:units.map(u=>({unit_id:u.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]});
  const fallbackRows=()=>units.map(u=>({unit_id:u.id,unit_name:u.name,fallbacks:(u.id==='registry-parent'||u.id==='registry-d')?['registry-b','registry-c'].filter(id=>units.some(u=>u.id===id)).map(id=>({unit_id:id,unit_name:units.find(u=>u.id===id).name})):[]}));
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url()),p=u.pathname;requests.push({method:q.method(),path:p,search:u.search});
   if(q.method()!=='GET'){
    assert.ok((q.method()==='PUT'&&p.startsWith('/api/v1/normalization/units/'))||(q.method()==='POST'&&p==='/api/v1/normalization/units'));
    const payload=q.postDataJSON(),id=q.method()==='POST'?'registry-d':p.split('/').pop();writes.push({method:q.method(),path:p,payload});
    if(mode==='busy-close')await writeGate;
    const saved={...(units.find(x=>x.id===id)||original),...payload,id,revision:'two'};
    units=units.some(x=>x.id===id)?units.map(x=>x.id===id?saved:x):[...units,saved];return route.fulfill({json:saved});
   }
   if(p==='/api/v1/admin/members')return route.fulfill({json:[]});
   if(p==='/api/v1/normalization/units/suggest-code')return route.fulfill({json:{code:'D'}});
   if(p==='/api/v1/normalization/units'){
    registryReads++;if(writes.length&&!ownFailed&&mode.startsWith('own-read-')){ownFailed=true;return route.fulfill({status:503,json:{detail:'Registry read unavailable'}});}return route.fulfill({json:units});
   }
   if(p==='/api/v1/unit-management/month'){
    boardReads++;if(writes.length&&!parentFailed&&mode==='board-read-retry'){parentFailed=true;return route.fulfill({status:503,json:{detail:'Board read unavailable'}});}return route.fulfill({json:board(u.searchParams.get('month'))});
   }
   if(p==='/api/v1/extra-duty/unit-fallbacks'){
    fallbackReads++;if(writes.length&&!parentFailed&&mode==='fallback-read-retry'){parentFailed=true;return route.fulfill({status:503,json:{detail:'Fallback read unavailable'}});}
    if(writes.length&&!parentFailed&&mode==='malformed-retry'){parentFailed=true;const rows=fallbackRows();return route.fulfill({json:[...rows,rows[0]]});}return route.fulfill({json:fallbackRows()});
   }
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+p+u.search,maxRetries:2})});
  });
  try{
   await page.goto(base+'/#view=units',{waitUntil:'domcontentloaded'});
   const row=page.locator('[data-fallback-unit="registry-parent"]');await row.locator('summary').click();await row.locator('[data-fb-up="registry-c"]').click();
   await page.locator('input[data-unit-board-search]').fill('Royal');await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
   const before={registryReads,boardReads,fallbackReads};
   await page.locator('[aria-label="Unit actions"] details.row-menu > summary').click();await page.locator('[data-manage-department-units]').click();
   const dialog=page.getByRole('dialog',{name:'Manage department units',exact:true});await dialog.locator('[data-select-unit="registry-b"]').click();await dialog.locator('[name=name]').fill('Royal Renamed registry-b');
   await dialog.evaluate(e=>{window.__registryCloseEvents=0;e.addEventListener('close',()=>window.__registryCloseEvents++);});
   await dialog.getByRole('button',{name:'Save unit',exact:true}).click();
   if(mode==='busy-close'){
    await page.waitForFunction(()=>document.querySelector('#registry-unit-form')?.getAttribute('aria-busy')==='true');
    assert.equal(await dialog.getByRole('button',{name:'Close unit management',exact:true}).isDisabled(),true);
    await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);assert.equal(await page.evaluate(()=>window.__registryCloseEvents),0);
    assert.equal(boardReads,before.boardReads);assert.equal(fallbackReads,before.fallbackReads);releaseWrite();
   }
   await dialog.locator('[data-select-unit="registry-b"]').filter({hasText:'Royal Renamed registry-b'}).waitFor();
   assert.equal(writes.length,1);assert.equal(boardReads,before.boardReads);assert.equal(fallbackReads,before.fallbackReads);
   if(mode==='accepted-dirty-refusal'){
    await dialog.locator('[name=name]').fill('Royal New Unsubmitted Draft');dismiss=true;
    await dialog.getByRole('button',{name:'Close unit management',exact:true}).click();
    assert.equal(await dialog.isVisible(),true);assert.equal(await dialog.locator('[name=name]').inputValue(),'Royal New Unsubmitted Draft');assert.equal(prompts.length,1);
    assert.equal(boardReads,before.boardReads);assert.equal(fallbackReads,before.fallbackReads);assert.equal(writes.length,1);dismiss=false;
   }
   if(mode==='route-owner'){
    await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();
   }else if(mode==='month-owner'){
    await page.evaluate(()=>{const input=document.querySelector('#working-month');input.value='2026-12';input.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.waitForFunction(()=>document.querySelector('#working-month')?.value==='2026-12');await page.waitForLoadState('networkidle');
   }else if(mode==='account-owner'){
    await page.evaluate(()=>{localStorage.removeItem('duty_rota_auth_token');window.dispatchEvent(new StorageEvent('storage',{key:'duty_rota_auth_token',oldValue:'registry-local',newValue:null,storageArea:localStorage}));});
    await dialog.waitFor({state:'detached'});
   }
   const afterSteering={registryReads,boardReads,fallbackReads};
   if(await dialog.count()){
    if(mode==='native-close')await dialog.evaluate(e=>{e.close();e.close();});
    else await dialog.getByRole('button',{name:'Close unit management',exact:true}).click();
    await dialog.waitFor({state:'detached'});
   }
   const expired=mode.endsWith('-owner');
   if(expired){
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.deepEqual({registryReads,boardReads,fallbackReads},afterSteering,'Expired owner final close must issue no old parent GET');assert.equal(await page.locator('[data-profile-parent-refresh]').count(),0);
    if(mode==='route-owner'){assert.equal(await page.evaluate(()=>location.hash),'#view=user-guide');assert.equal(await page.locator('#guide-checklist').count(),1);}
    else if(mode==='month-owner')assert.equal(await page.locator('#working-month').inputValue(),'2026-12');else assert.equal(await page.locator('#section-title').count(),0);
   }else{
    await page.waitForFunction(()=>document.querySelector('[data-profile-parent-refresh]')?.textContent.includes('Saved changes are reflected'));
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.equal(boardReads-before.boardReads,1);assert.equal(fallbackReads-before.fallbackReads,1);assert.equal(await page.evaluate(()=>window.__registryCloseEvents),1);
    assert.deepEqual(await row.locator('[data-fallback-item]').evaluateAll(es=>es.map(e=>e.dataset.fallbackItem)),['registry-c','registry-b']);assert.equal(await row.locator('[data-fb-save]').isDisabled(),false);
    if(mode==='accepted-dirty-refusal'){assert.equal(prompts.length,2);assert.equal(writes[0].payload.name,'Royal Renamed registry-b');}
   }
   assert.equal(writes.length,1);assert.deepEqual(errors,[]);
   results.push({engine,width,mode,passed:true,before,afterSteering,after:{registryReads,boardReads,fallbackReads},writes,requests,prompts,errors});console.log(engine,width,mode,'PASS');
  }catch(error){results.push({engine,width,mode,passed:false,assertion:error.message,writes,requests,prompts,errors,registryReads,boardReads,fallbackReads});console.log(engine,width,mode,'FAIL',error.message);}
  finally{releaseWrite();await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
for(const[n,b]of Object.entries(manifest.files)){assert.equal(sha(await readFile('src/'+n)),held[n]);assert.equal(sha(await readFile(folder+'/'+n)),b.candidate_sha256);}
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/registry_lifecycle_r3_review',executor:'/root',application_changed_by_test:false,execution_target:"applied source",scope:'12 Chromium contexts: 320/1280 x accepted PUT then route/month/account owner steering, native-only duplicate close, accepted-then-new-dirty refusal, gated busy PUT Escape refusal. All writes locally fulfilled; other GETs disposable RAM8031. No whole159 acceptance.',candidate_manifest:manifest,held_source_sha256:held,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');
assert.equal(results.length,12);assert.ok(results.every(r=>r.passed),'All failures preserved in unique report');
