import assert from 'node:assert/strict';
import{readFile,writeFile,access}from'node:fs/promises';
import{createHash}from'node:crypto';
import{chromium,firefox,webkit}from'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const paths=['main','reference-workspace','extra-duty','services/api'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async n=>['frontend/src/'+n+'.ts',sha(await readFile('src/'+n+'.ts'))])));
const initial=await hashes(),report='../docs/premium-ui/qa-original159-registry-v10r1-fallback-recovery.json';
assert.equal(initial['frontend/src/main.ts'],'96ab7c4c6b14d41736ad4153313b1270677e324fcab6b11c3a5b0d8ac3e47a0b');
await assert.rejects(access(report),{code:'ENOENT'});
const candidateManifest=JSON.parse(await readFile('../tmp/registry-parent-refresh-v10r1/manifest.json','utf8'));
for(const[name,binding]of Object.entries(candidateManifest.files)){
 assert.equal(sha(await readFile('../tmp/registry-parent-refresh-v10r1/'+name)),binding.candidate_sha256);
 const text=await(await fetch('http://127.0.0.1:5298/src/'+name)).text();
 const match=text.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(match);
 assert.ok(JSON.parse(Buffer.from(match[1],'base64').toString()).sourcesContent.some(source=>sha(source)===binding.candidate_sha256));
}
const original={id:'registry-parent',name:'Royal Registry Parent',campus:'Main',code:'PARENT',minimum_free_people:1,active_status:'active',aliases:[],notes:'',call_minimums:[],revision:'one',usage:{postings:0,duties:0,future_postings:0,future_duties:0,selected_members:0}};
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),requests=[],writes=[],errors=[];let saved=false,unitReads=0,fallbackReads=0;
  const units=()=>[original,{...original,id:'registry-b',name:saved?'Royal Renamed Fallback B':'Royal Fallback B',code:'B'},{...original,id:'registry-c',name:'Royal Fallback C',code:'C'}];
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','registry-fallback-local');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url()),p=u.pathname;requests.push({method:q.method(),path:p,search:u.search});
   if(q.method()!=='GET'){
    assert.equal(q.method(),'PUT');assert.equal(p,'/api/v1/normalization/units/registry-b');const payload=q.postDataJSON();assert.equal(payload.name,'Royal Renamed Fallback B');writes.push({method:q.method(),path:p,payload});saved=true;return route.fulfill({json:{...units()[1],...payload,revision:'two'}});
   }
   if(p==='/api/v1/admin/members')return route.fulfill({json:[]});
   if(p==='/api/v1/normalization/units')return route.fulfill({json:units()});
   if(p==='/api/v1/extra-duty/unit-fallbacks'){
    fallbackReads++;const list=units();return route.fulfill({json:list.map((unit,i)=>({unit_id:unit.id,unit_name:unit.name,fallbacks:i===0?list.slice(1).map(u=>({unit_id:u.id,unit_name:u.name})):[]}))});
   }
   if(p==='/api/v1/unit-management/month'){
    unitReads++;return route.fulfill({json:{month:u.searchParams.get('month'),starts_on:'2026-11-01',ends_on:'2026-11-30',units:units(),assignments:[],unit_summaries:units().map(unit=>({unit_id:unit.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]}});
   }
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+p+u.search,maxRetries:2})});
  });
  try{
   await page.goto('http://127.0.0.1:5298/#view=units',{waitUntil:'domcontentloaded'});
   const fallback=page.locator('[data-fallback-unit="registry-parent"]');await fallback.locator('summary').click();await fallback.locator('[data-fb-up="registry-c"]').click();
   assert.deepEqual(await fallback.locator('[data-fallback-item]').evaluateAll(es=>es.map(e=>e.dataset.fallbackItem)),['registry-c','registry-b']);
   assert.equal(await fallback.locator('[data-fb-save]').isEnabled(),true);
   await page.locator('#unit-fallbacks-host').evaluate(e=>{window.__registryFallbackHost=e;window.__registryFallbackRow=e.querySelector('[data-fallback-unit="registry-parent"]');});
   await page.locator('input[data-unit-board-search]').fill('Royal');await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
   const before={unitReads,fallbackReads};
   await page.locator('[aria-label="Unit actions"] details.row-menu > summary').click();await page.locator('[data-manage-department-units]').click();
   const dialog=page.getByRole('dialog',{name:'Manage department units',exact:true});await dialog.locator('[data-select-unit="registry-b"]').click();
   await dialog.locator('[name=name]').fill('Royal Renamed Fallback B');await dialog.getByRole('button',{name:'Save unit',exact:true}).click();
   await dialog.locator('[data-select-unit="registry-b"]').filter({hasText:'Royal Renamed Fallback B'}).waitFor();
   await dialog.getByRole('button',{name:'Close unit management',exact:true}).click();await dialog.waitFor({state:'detached'});
   await page.locator('[data-unit-board-card="unit:registry-b"]').filter({hasText:'Royal Renamed Fallback B'}).waitFor();
   const observed=await page.evaluate(()=>{const host=document.querySelector('#unit-fallbacks-host'),row=host?.querySelector('[data-fallback-unit="registry-parent"]');return{hostRetained:host===window.__registryFallbackHost,rowRetained:row===window.__registryFallbackRow,order:[...(row?.querySelectorAll('[data-fallback-item]')||[])].map(e=>e.dataset.fallbackItem),saveEnabled:!row?.querySelector('[data-fb-save]')?.disabled,label:row?.querySelector('[data-fallback-item="registry-b"]')?.textContent};});
   assert.equal(observed.hostRetained,true,'Unit registry save must retain unrelated fallback draft host');assert.equal(observed.rowRetained,true);assert.deepEqual(observed.order,['registry-c','registry-b']);assert.equal(observed.saveEnabled,true);assert.match(observed.label,/Royal Renamed Fallback B/);
   assert.equal(writes.length,1);assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Royal');assert.equal(await page.locator('select[data-unit-board-campus]').inputValue(),'campus:Main');assert.deepEqual(errors,[]);
   results.push({engine,width,passed:true,observed,before,after:{unitReads,fallbackReads},writes,requests,errors});
  }catch(error){const observed=await page.evaluate(()=>{const host=document.querySelector('#unit-fallbacks-host'),row=host?.querySelector('[data-fallback-unit="registry-parent"]');return{hostRetained:host===window.__registryFallbackHost,rowRetained:row===window.__registryFallbackRow,order:[...(row?.querySelectorAll('[data-fallback-item]')||[])].map(e=>e.dataset.fallbackItem),saveEnabled:!row?.querySelector('[data-fb-save]')?.disabled};}).catch(()=>null);results.push({engine,width,passed:false,assertion:error.message,observed,writes,requests,errors,unitReads,fallbackReads});console.log(engine,width,'registry fallback diagnostic failed',error.message);}
  finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);for(const[name,binding]of Object.entries(candidateManifest.files))assert.equal(sha(await readFile("../tmp/registry-parent-refresh-v10r1/"+name)),binding.candidate_sha256);await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root',scope:'Six actual current application registry rename cases across3engines320/1280. Real inline fallback reorder C,B is an unrelated unsaved draft. Only PUT registry-b is locally fulfilled; all remaining GETs disposableRAM. Expect draft host/order retained and saved target label refreshed, onePUT/no fallbacksave. Failure is diagnostic, notpassing acceptance orproduction persistence.',source_sha256:initial,candidate_manifest:candidateManifest,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');
assert.equal(results.length,6);assert.ok(results.every(r=>r.passed),'Registry rename must preserve unrelated fallback drafts; all diagnostics retained');
