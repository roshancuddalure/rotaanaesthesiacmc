import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),base='http://127.0.0.1:5301',folder='../tmp/registry-parent-refresh-v10r4';
const report='../docs/premium-ui/qa-original159-registry-v10r4-lifecycle-r2.json';await assert.rejects(access(report),{code:'ENOENT'});
const manifest=JSON.parse(await readFile(folder+'/manifest.json','utf8'));
const held={};for(const[n,b]of Object.entries(manifest.files)){
 held[n]=sha(await readFile('src/'+n));assert.equal(held[n],b.before_sha256);
 assert.equal(sha(await readFile(folder+'/'+n)),b.candidate_sha256);
 const text=await(await fetch(base+'/src/'+n)).text(),m=text.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(m);
 assert.ok(JSON.parse(Buffer.from(m[1],'base64').toString()).sourcesContent.some(s=>sha(s)===b.candidate_sha256));
}
const original={id:'registry-parent',name:'Royal Registry Parent',campus:'Main',code:'PARENT',minimum_free_people:1,active_status:'active',aliases:[],notes:'',call_minimums:[],revision:'one',usage:{postings:0,duties:0,future_postings:0,future_duties:0,selected_members:0}};
const modes=['normal','owner-name','two-saves','create','direct-create','first-unit','own-read-retry','own-read-close','board-read-retry','fallback-read-retry','malformed-retry','dirty-refusal','no-save'];
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const mode of modes){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(10000);
  const requests=[],writes=[],errors=[],prompts=[];let registryReads=0,boardReads=0,fallbackReads=0,ownFailed=false,parentFailed=false,dismiss=false;
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
   const host=page.locator('#unit-fallbacks-host'),row=page.locator('[data-fallback-unit="registry-parent"]');
   if(mode==='first-unit')await host.locator('.extra-duty-empty').waitFor();
   else{await row.locator('summary').click();await row.locator('[data-fb-up="registry-c"]').click();}
   await host.evaluate(e=>{window.__registryHost=e;window.__registryRow=e.querySelector('[data-fallback-unit="registry-parent"]');window.__registrySelect=window.__registryRow?.querySelector('[data-fb-select]');});
   await page.locator('input[data-unit-board-search]').fill('Royal');if(mode!=='first-unit')await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
   const before={registryReads,boardReads,fallbackReads};
   await page.locator('[aria-label="Unit actions"] details.row-menu > summary').click();await page.locator(mode==='direct-create'?'[role=menuitem][data-add-department-unit]':'[data-manage-department-units]').click();
   const dialog=page.getByRole('dialog',{name:'Manage department units',exact:true});await dialog.locator('[data-new]').waitFor();
   if(mode==='no-save'||mode==='dirty-refusal'){
    if(mode==='dirty-refusal'){
     await dialog.locator('[data-select-unit="registry-b"]').click();await dialog.locator('[name=name]').fill('Royal Unsaved Name');dismiss=true;
     await dialog.getByRole('button',{name:'Close unit management',exact:true}).click();assert.equal(await dialog.locator('[name=name]').inputValue(),'Royal Unsaved Name');assert.equal(await dialog.isVisible(),true);assert.equal(prompts.length,1);dismiss=false;
    }
   }else if(mode==='create'||mode==='direct-create'||mode==='first-unit'){
    await dialog.locator('[data-new]').click();await dialog.locator('[name=code]').fill('D');await dialog.locator('[name=name]').fill('Royal Created D');await dialog.locator('[name=campus]').fill('Main');await dialog.getByRole('button',{name:'Create unit',exact:true}).click();if(mode!=='direct-create')await dialog.locator('[data-select-unit="registry-d"]').waitFor();
   }else{
    const ids=mode==='two-saves'?['registry-b','registry-c']:[mode==='owner-name'?'registry-parent':'registry-b'];
    for(const id of ids){await dialog.locator(`[data-select-unit="${id}"]`).click();await dialog.locator('[name=name]').fill('Royal Renamed '+id);await dialog.getByRole('button',{name:'Save unit',exact:true}).click();
     if(mode.startsWith('own-read-')){await dialog.locator('[data-load-retry]').waitFor();if(mode==='own-read-retry'){await dialog.locator('[data-load-retry]').click();await dialog.locator(`[data-select-unit="${id}"]`).filter({hasText:'Royal Renamed '+id}).waitFor();}}
     else await dialog.locator(`[data-select-unit="${id}"]`).filter({hasText:'Royal Renamed '+id}).waitFor();
    }
   }
   if(mode!=='direct-create'){assert.equal(boardReads,before.boardReads,'Parent board GET deferred until final close');assert.equal(fallbackReads,before.fallbackReads,'Fallback GET deferred until final close');}
   if(mode==='direct-create')await dialog.waitFor({state:'detached'});else if(mode==='own-read-close')await dialog.locator('[data-load-close]').click();else await dialog.getByRole('button',{name:'Close unit management',exact:true}).click();await dialog.waitFor({state:'detached'});
   const noSave=mode==='no-save'||mode==='dirty-refusal';
   if(!noSave){
    const status=page.locator('[data-profile-parent-refresh]');
    if(['board-read-retry','fallback-read-retry','malformed-retry'].includes(mode)){
     await status.locator('[data-retry-profile-parent]').waitFor({state:'visible'});assert.match(await status.innerText(),/could not refresh/);
     if(mode!=='board-read-retry')await page.locator('[data-unit-board-card="unit:registry-b"]').filter({hasText:'Royal Renamed registry-b'}).waitFor();
     assert.equal(writes.length,1);await status.locator('[data-retry-profile-parent]').click();
    }
    await page.waitForFunction(()=>document.querySelector('[data-profile-parent-refresh]')?.textContent.includes('Saved changes are reflected'));
   }
   const observed=await page.evaluate(()=>{const h=document.querySelector('#unit-fallbacks-host'),r=h?.querySelector('[data-fallback-unit="registry-parent"]');return{hostRetained:h===window.__registryHost,rowRetained:r===window.__registryRow,selectRetained:r?.querySelector('[data-fb-select]')===window.__registrySelect,order:[...(r?.querySelectorAll('[data-fallback-item]')||[])].map(e=>e.dataset.fallbackItem),saveEnabled:!r?.querySelector('[data-fb-save]')?.disabled,ownerLabel:r?.querySelector('ol')?.getAttribute('aria-label')};});
   assert.equal(observed.hostRetained,true);
   if(mode!=='first-unit'){assert.equal(observed.rowRetained,true);assert.equal(observed.selectRetained,true);assert.deepEqual(observed.order,['registry-c','registry-b']);assert.equal(observed.saveEnabled,true);}
   if(!noSave && !['create','direct-create','first-unit','owner-name'].includes(mode)) {
    const item=row.locator('[data-fallback-item="registry-b"]');assert.match(await item.innerText(),/Royal Renamed registry-b/);
    assert.equal(await item.locator('[data-fb-remove]').getAttribute('aria-label'),'Remove Royal Renamed registry-b');
   }
   if(mode==='create'||mode==='direct-create'){
    const select=row.locator('[data-fb-select]');assert.equal(await select.inputValue(),'registry-d');assert.equal(await select.isEnabled(),true);
    assert.equal(await select.locator('option[value="registry-d"]').textContent(),'Royal Created D');assert.equal(await row.locator('[data-fb-add]').isEnabled(),true);
   }
   if(mode==='owner-name'){assert.match(observed.ownerLabel,/Royal Renamed registry-parent/);await row.locator('[data-fb-down="registry-c"]').click();assert.match(await row.locator('ol').getAttribute('aria-label'),/Royal Renamed registry-parent/);}
   if(mode==='create'||mode==='direct-create'||mode==='first-unit'){
    const fresh=page.locator('[data-fallback-unit="registry-d"]');assert.equal(await fresh.count(),1);assert.equal(await host.locator('.extra-duty-empty').count(),0);await fresh.locator('summary').click();assert.equal(await fresh.locator('[data-fb-save]').isDisabled(),true);
    if(mode==='create'||mode==='direct-create')assert.deepEqual(await fresh.locator('[data-fallback-item]').evaluateAll(es=>es.map(e=>e.dataset.fallbackItem)),['registry-b','registry-c']);
   }
   assert.equal(boardReads-before.boardReads,noSave?0:parentFailed?2:1);assert.equal(fallbackReads-before.fallbackReads,noSave?0:parentFailed?2:1);
   assert.equal(writes.length,noSave?0:mode==='two-saves'?2:1);assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Royal');assert.equal(await page.locator('select[data-unit-board-campus]').inputValue(),mode==='first-unit'?'':'campus:Main');assert.deepEqual(errors,[]);
   results.push({engine,width,mode,passed:true,observed,before,after:{registryReads,boardReads,fallbackReads},writes,requests,prompts,errors});console.log(engine,width,mode,'PASS');
  }catch(error){results.push({engine,width,mode,passed:false,assertion:error.message,writes,requests,prompts,errors,registryReads,boardReads,fallbackReads});console.log(engine,width,mode,'FAIL',error.message);}
  finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
for(const[n,b]of Object.entries(manifest.files)){assert.equal(sha(await readFile('src/'+n)),held[n]);assert.equal(sha(await readFile(folder+'/'+n)),b.candidate_sha256);}
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root',application_changed:false,scope:'78 isolated exact-source V10r4 contexts;13 registry lifecycle/create/accessibility/GET recovery scenarios x3engines x320/1280. Local normalized mutations only; remaining GETs disposable RAM; no applied acceptance or production operations.',candidate_manifest:manifest,held_source_sha256:held,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');
assert.equal(results.length,78);assert.ok(results.every(r=>r.passed),'All failing contexts preserved in unique report');
