// Real canonical profile saves/readback and concurrency refusal on disposable RAM only.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const zoomMode=process.env.PROFILE_BROWSER_ZOOM==='1';
const base='http://127.0.0.1:5198',api='http://127.0.0.1:8032',out=resolve('../docs/premium-ui/'+(zoomMode?'qa-profile-persistence-zoom':'qa-profile-persistence'));
const cases=zoomMode?['light','dark'].flatMap(scheme=>[2,4].map(factor=>({width:1280,height:900,scheme,factor}))):(process.env.PROFILE_PERSISTENCE_QUICK==='1'?[1280]:[320,1280]).map(width=>({width,height:width===320?568:800,factor:1}));
const sha=data=>createHash('sha256').update(data).digest('hex');
async function hashes(folder){const values={};for(const entry of await readdir(folder,{withFileTypes:true})){const path=join(folder,entry.name);if(entry.isDirectory())Object.assign(values,await hashes(path));else values[path.replaceAll('\\','/').split('/frontend/').at(-1)]=sha(await readFile(path));}return values;}
const source={...await hashes(resolve('src')),...await hashes(resolve('public')),...await hashes(resolve('dist'))};
const extensionHashes=zoomMode?await hashes(resolve('tests/fixtures/browser-zoom-extension')):null;
const get=async path=>{const response=await fetch(api+path);assert.equal(response.status,200,path);return response.json();};
const saveBody=member=>({revision:member.revision,canonical_name:member.canonical_name,active_status:member.active_status,
 call_level:member.call_level,preserve_previous_name:true,aliases:member.aliases.map(row=>row.alias),
 designations:member.designations,call_level_changes:member.call_level_changes||[]});
const results=[];await mkdir(out,{recursive:true});
for(const [engine,launcher]of Object.entries(zoomMode||process.env.PROFILE_PERSISTENCE_QUICK==='1'?{chromium}:{chromium,firefox,webkit})){
 const browser=zoomMode?null:await launcher.launch();
 try{for(const {width,height,scheme,factor} of cases){
  const reset=await fetch(api+'/__equivalence/reset',{method:'POST'});assert.equal((await reset.json()).storage,'disposable-sqlite-memory');
  const members=await get('/api/v1/admin/members'),original=members.find(row=>row.canonical_name==='Blocked Member');assert.ok(original);
  const path='/api/v1/admin/member-workspace/'+original.id;
  const initial=(await get(path)).member,postings=await get(path+'/postings'),leave=await get(path+'/leave'),activity=await get(path+'/activity');
  let temporaryProfile;
  const extension=resolve('tests/fixtures/browser-zoom-extension');
  if(zoomMode)temporaryProfile=await mkdtemp(join(tmpdir(),'rota-profile-zoom-'));
  const options={viewport:{width,height},reducedMotion:'reduce',...(scheme?{colorScheme:scheme}:{})};
  const context=zoomMode?await chromium.launchPersistentContext(temporaryProfile,{...options,channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]}):await browser.newContext(options);
  for(const existing of context.pages())await existing.close();
  const page=await context.newPage(),errors=[],puts=[];let zoomEvidence;
  page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','profile-real-persistence');localStorage.setItem('duty_rota_working_month','2026-05');});
  let releaseInitial,notifyInitial;
  const held=new Promise(resolve=>releaseInitial=resolve),initialSaved=new Promise(resolve=>notifyInitial=resolve);
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()!=='GET'){
    assert.equal(request.method(),'PUT');assert.equal(url.pathname,path);
    const call={path:url.pathname,body:request.postDataJSON()};puts.push(call);
    const response=await route.fetch({url:api+url.pathname+url.search});call.status=response.status();
    if(puts.length===1){assert.equal(call.status,200);notifyInitial();await held;}
    return route.fulfill({response});
   }
   return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  const dialog=page.locator('dialog.member-workspace');
  const open=async()=>{const button=page.locator(`[data-open-member="${original.id}"]:visible`).first();await button.waitFor();await button.focus();await page.keyboard.press('Enter');await dialog.locator('[data-edit]').waitFor();};
  const tab=async name=>{await dialog.getByRole('tab',{name,exact:true}).focus();await page.keyboard.press('Enter');};
  const externalRename=async name=>{const member=(await get(path)).member;const response=await fetch(api+path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...saveBody(member),canonical_name:name})});assert.equal(response.status,200);return response.json();};
  try{
   await page.goto(base+'/#view=members');
   if(zoomMode){
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const actualZoom=await worker.evaluate(async factor=>{const tabs=await chrome.tabs.query({url:'http://127.0.0.1:5198/*'});if(tabs.length!==1)throw Error('Expected exactly one test tab');await chrome.tabs.setZoom(tabs[0].id,factor);return chrome.tabs.getZoom(tabs[0].id);},factor);
    await page.waitForFunction(expected=>Math.abs(innerWidth-expected)<=1,width/factor);
    zoomEvidence=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,cssZoom:getComputedStyle(document.documentElement).zoom,visualScale:visualViewport.scale}));
    zoomEvidence.actualZoom=actualZoom;assert.ok(Math.abs(actualZoom-factor)<.001);assert.ok(Math.abs(zoomEvidence.dpr-factor)<.001);assert.equal(zoomEvidence.cssZoom,'1');assert.equal(zoomEvidence.visualScale,1);assert.equal(zoomEvidence.height,height/factor);
   }
   await open();
   await dialog.locator('[data-edit]').click();await tab('Details');
   await dialog.getByLabel('Member name',{exact:true}).fill('Verified Profile Member');
   await dialog.locator('[data-field=call_level]').selectOption('3RD_CALL');
   await tab('Names & duplicates');await dialog.locator('[data-aliases]').fill('Verified profile alias\nTransient profile alias');
   await tab('Details');await tab('Names & duplicates');
   await dialog.locator('.mw-alias-row').filter({hasText:'Transient profile alias'}).locator('[data-remove-alias]').click();
   assert.equal(await dialog.locator('[data-aliases]').inputValue(),'Verified profile alias');
   await tab('Roles & eligibility');
   await dialog.locator('[data-add-designation-row]').click();await dialog.locator('[data-remove-designation="0"]').click();
   assert.equal(await dialog.locator('[data-designation-row]').count(),0);
   await dialog.locator('[data-add-designation-row]').click();
   await dialog.locator('[data-d="0"][data-key=designation]').fill('Synthetic Senior Registrar');
   await dialog.locator('[data-d="0"][data-key=effective_from]').fill('2027-11-01');
   await dialog.locator('[data-d="0"][data-key=notes]').fill('Reviewed future designation');
   await dialog.locator('[data-add-call-change]').click();await dialog.locator('[data-remove-call-change="0"]').click();
   assert.equal(await dialog.locator('[data-call-change]').count(),0);
   await dialog.locator('[data-add-call-change]').click();
   await dialog.locator('[data-call-change="0"][data-key=call_level]').selectOption('4TH_CALL');
   await dialog.locator('[data-call-change="0"][data-key=effective_from]').fill('2027-11-01');
   await dialog.locator('[data-call-change="0"][data-key=notes]').fill('Reviewed future default');await page.keyboard.press('Tab');
   assert.equal(puts.length,0,'Draft controls do not save');
   const save=dialog.getByRole('button',{name:'Save changes',exact:true});await save.focus();await page.keyboard.press('Enter');
   let saveDeadline;try{await Promise.race([initialSaved,new Promise((_,reject)=>saveDeadline=setTimeout(()=>reject(Error('Initial save did not reach the disposable server')),20000))]);}finally{clearTimeout(saveDeadline);}
   assert.equal(await dialog.locator('button[type=submit]').isDisabled(),true);
   await page.keyboard.press('Enter');assert.equal(puts.length,1,'Repeated activation while pending sends one mutation');
   const committed=(await get(path)).member;assert.equal(committed.canonical_name,'Verified Profile Member');
   releaseInitial();await dialog.locator('[data-edit]').waitFor();
   await tab('Overview');
   assert.equal(await dialog.locator('.mw-summary article').nth(0).locator('strong').innerText(),'Missing designation','Future designation is not presented as current');
   assert.equal(await dialog.locator('.mw-summary article').nth(1).locator('strong').innerText(),'3rd Call','Future dated call does not replace current base default');
   assert.equal(puts.length,1);assert.equal(puts[0].body.revision,initial.revision);
   assert.equal(committed.call_level,'3RD_CALL');
   assert.deepEqual(committed.aliases.map(row=>row.alias).sort(),['Blocked Member','Verified profile alias'].sort());
   assert.equal(committed.designations.length,1);assert.equal(committed.designations[0].designation,'Synthetic Senior Registrar');
   assert.equal(committed.designations[0].effective_from,'2027-11-01');assert.equal(committed.designations[0].notes,'Reviewed future designation');
   assert.equal(committed.call_level_changes.length,1);assert.equal(committed.call_level_changes[0].call_level,'4TH_CALL');
   assert.equal(committed.call_level_changes[0].effective_from,'2027-11-01');
   assert.equal(committed.call_level_changes[0].notes,'Reviewed future default');
   assert.notEqual(committed.revision,initial.revision);
   await dialog.locator('[data-close]').click();await dialog.waitFor({state:'detached'});await page.reload();await open();
   await tab('Details');assert.equal(await dialog.getByLabel('Member name',{exact:true}).inputValue(),committed.canonical_name);
   assert.equal(await dialog.locator('[data-field=call_level]').inputValue(),'3RD_CALL');
   await tab('Roles & eligibility');await dialog.getByText('Synthetic Senior Registrar',{exact:true}).waitFor();
   await tab('Names & duplicates');await dialog.getByText('Verified profile alias',{exact:true}).waitFor();
   await dialog.locator('[data-edit]').click();await tab('Details');await dialog.getByLabel('Member name',{exact:true}).fill('Unsaved conflict draft A');
   const externalA=await externalRename('Concurrent Saved Member A');
   await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await dialog.getByRole('heading',{name:'Compare changes',exact:true}).waitFor();
   assert.equal(puts.at(-1).status,409);assert.equal(await dialog.getByLabel('Member name',{exact:true}).inputValue(),'Unsaved conflict draft A');
   const beforeChoice=puts.length;await dialog.getByRole('button',{name:'Use latest version',exact:true}).click();
   assert.equal(puts.length,beforeChoice);assert.equal(await dialog.getByLabel('Member name',{exact:true}).inputValue(),externalA.canonical_name);
   await dialog.getByLabel('Member name',{exact:true}).fill('Explicitly Reviewed Draft B');
   const externalB=await externalRename('Concurrent Saved Member B');
   await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await dialog.getByRole('heading',{name:'Compare changes',exact:true}).waitFor();
   assert.equal(puts.at(-1).status,409);
   await dialog.getByRole('button',{name:'Keep my draft for review',exact:true}).click();
   assert.equal(puts.length,beforeChoice+1,'Conflict comparison choice does not automatically save');
   assert.equal(await dialog.getByLabel('Member name',{exact:true}).inputValue(),'Explicitly Reviewed Draft B');
   assert.equal((await get(path)).member.canonical_name,externalB.canonical_name);
   await dialog.getByRole('button',{name:'Save changes',exact:true}).focus();await page.keyboard.press('Enter');await dialog.locator('[data-edit]').waitFor();
   assert.equal(puts.length,4);assert.deepEqual(puts.map(call=>call.status),[200,409,409,200]);
   assert.equal(puts.at(-1).body.revision,externalB.revision);
   await dialog.locator('[data-close]').click();await dialog.waitFor({state:'detached'});await page.reload();await open();await tab('Details');
   assert.equal(await dialog.getByLabel('Member name',{exact:true}).inputValue(),'Explicitly Reviewed Draft B');
   const final=(await get(path)).member;
   assert.ok(final.aliases.some(row=>row.alias==='Concurrent Saved Member B'),'Confirmed overwrite preserves latest name as alias');
   assert.deepEqual(await get(path+'/postings'),postings,'Identity edit preserves exact linked posting records');
   assert.deepEqual(await get(path+'/leave'),leave,'Identity edit preserves exact leave records');
   const finalActivity=await get(path+'/activity');assert.equal(finalActivity.rows.length,activity.rows.length+4,'Only successful saves produce profile activity');
   await dialog.locator('[data-close]').click();await page.waitForLoadState('networkidle');assert.deepEqual(errors,[]);
   results.push({engine,width,scheme,factor,zoomEvidence,person_id:original.id,ui_mutations:puts,external_successful_saves:2,initial:initial,first_saved:committed,final,linked_postings_preserved:true,linked_leave_preserved:true,activity_growth:4,independent_get_and_reload_readback:true,passed:true});
  }catch(error){releaseInitial();console.error(JSON.stringify({engine,width,errors,puts,text:(await page.locator('body').innerText()).slice(-4000)}));await page.screenshot({path:join(out,`failure-${engine}-${width}.png`)}).catch(()=>{});throw error;}
  finally{await context.close();if(temporaryProfile){assert.ok(temporaryProfile.startsWith(tmpdir())&&temporaryProfile.includes('rota-profile-zoom-'));await rm(temporaryProfile,{recursive:true,force:true,maxRetries:3});}}
 }}finally{await browser?.close();}
}
assert.deepEqual({...await hashes(resolve('src')),...await hashes(resolve('public')),...await hashes(resolve('dist'))},source,'App source and build held');
if(zoomMode)assert.deepEqual(await hashes(resolve('tests/fixtures/browser-zoom-extension')),extensionHashes,'Disposable zoom extension held');
await writeFile(join(out,'report.json'),JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Full-app production canonical profile against real API/disposable RAM: identity/alias/base call/future designation/future call edits, row removal, pending-repeat guard, independent GET and reopen, actual concurrent revision409 and both comparison choices. Linked posting/leave preserved. Server responses forwarded unchanged; first committed success held to check repeat activation. Not all profile controls/roles/fixtures or production concurrency.',whole_requirement_completion_proven:false,actual_browser_zoom:zoomMode,extension_sha256:extensionHashes,zoom_limit:zoomMode?'Chromium actual tab zoom200/400percent,light/dark. Scripted focus and real key activation; not sequential unaided keyboard traversal or native AT.':'Normal viewport matrix',source_sha256:Object.fromEntries(Object.entries(source).map(([key,value])=>['frontend/'+key,value])),results},null,2)+'\n');
