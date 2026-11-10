import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

// Author stages only. Root coordinates actual execution against disposable RAM8031.
const sha=v=>createHash('sha256').update(v).digest('hex');
const report='../docs/premium-ui/qa-original159-delete-v11r1-integrated-owner-focus-r1.json';
await assert.rejects(access(report),{code:'ENOENT'});
const base='http://127.0.0.1:5197';
const files=['main','extra-duty','admin-delete','services/api'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async n=>['frontend/src/'+n+'.ts',sha(await readFile('src/'+n+'.ts'))])));
const held=await hashes();
assert.equal(held['frontend/src/main.ts'],'45743fb64260289e50526480572bf25e33d8dc1a69f83397286660a03951cfba');
const candidate=await readFile('../tmp/delete-parent-refresh-v11r1/main.ts');
assert.equal(sha(candidate),'45743fb64260289e50526480572bf25e33d8dc1a69f83397286660a03951cfba');
const served=await(await fetch(base+'/src/main.ts')).text();
const map=served.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
assert.ok(map,'Actual served inline source map required');
assert.ok(JSON.parse(Buffer.from(map[1],'base64').toString()).sourcesContent.some(s=>sha(s)===sha(candidate)));
const member={id:'delete-parent-person',canonical_name:'Dr Royal Delete Parent',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
const units=['parent','b','c'].map(id=>({id:'delete-'+id,name:'Royal Delete '+id,campus:'Main',code:id.toUpperCase(),minimum_free_people:1,active_status:'active',notes:null}));
const posting={id:'delete-parent-posting',person:member,person_id:member.id,unit:units[0],unit_id:units[0].id,posting_type:'2ND_CALL',starts_on:'2026-11-01',ends_on:'2026-11-30',source:'manual',notes:'Delete only this posting'};
const modes=['post-route-owner','post-month-owner','post-account-owner','read-newer-search-focus','read-removed-board-focus','cancel-preview'];
const results=[];
const browser=await chromium.launch();
try{
 for(const width of [320,1280])for(const mode of modes){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  page.setDefaultTimeout(15000);
  const requests=[],writes=[],errors=[],events=[];
  const focusCase=mode.startsWith('read-'),selection=focusCase?{kind:'posting',month:'2026-11'}:{kind:'posting',ids:[posting.id]};
  let deleted=false,unitReads=0,fallbackReads=0,postArrived=false,readArrived=false;
  let releasePost,releaseRead;
  const postGate=new Promise(r=>{releasePost=r;}),readGate=new Promise(r=>{releaseRead=r;});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','delete-owner-local');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;
   requests.push({method:request.method(),path,search:url.search});
   if(request.method()!=='GET'){
    const body=request.postDataJSON();writes.push({method:request.method(),path,body});
    assert.equal(request.method(),'POST');
    if(path==='/api/v1/admin/delete/preview'){
     assert.deepEqual(body,selection);
     return route.fulfill({json:{kind:'posting',count:1,items:[{id:posting.id,label:'Dr Royal Delete Parent posting'}],blocked:[],effects:{},preview_token:'delete-owner-preview',confirm_phrase:focusCase?'DELETE POSTINGS NOVEMBER 2026':null}});
    }
    assert.equal(path,'/api/v1/admin/delete');
    assert.deepEqual(body,{...selection,preview_token:'delete-owner-preview',...(focusCase?{confirm_phrase:'DELETE POSTINGS NOVEMBER 2026'}:{})});
    postArrived=true;events.push('delete-post-arrived');
    if(mode.startsWith('post-'))await postGate;
    deleted=true;events.push('delete-post-accepted-response');
    return route.fulfill({json:{batch_id:'delete-owner-local-batch',deleted:1}});
   }
   if(path==='/api/v1/admin/members')return route.fulfill({json:[member]});
   if(path==='/api/v1/extra-duty/unit-fallbacks'){
    fallbackReads++;
    return route.fulfill({json:units.map((u,i)=>({unit_id:u.id,unit_name:u.name,fallbacks:i?[]:units.slice(1).map(t=>({unit_id:t.id,unit_name:t.name}))}))});
   }
   if(path==='/api/v1/unit-management/month'){
    unitReads++;
    if(deleted&&mode.startsWith('read-')){readArrived=true;events.push('parent-get-gated');await readGate;}
    return route.fulfill({json:{month:url.searchParams.get('month'),starts_on:'2026-11-01',ends_on:'2026-11-30',units,assignments:deleted?[]:[posting],unit_summaries:units.map((u,i)=>({unit_id:u.id,assigned_members:i||deleted?0:1,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]}});
   }
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+path+url.search,maxRetries:2})});
  });
  const until=async(fn,label)=>{const deadline=Date.now()+15000;while(!fn()){assert.ok(Date.now()<deadline,label);await new Promise(r=>setTimeout(r,20));}};
  const observe=()=>page.evaluate(()=>{
   const host=document.querySelector('#unit-fallbacks-host'),row=host?.querySelector('[data-fallback-unit="delete-parent"]'),target=window.__deleteOwnerFocus;
   return {hostRetained:host===window.__deleteOwnerHost,rowRetained:row===window.__deleteOwnerRow,order:[...(row?.querySelectorAll('[data-fallback-item]')||[])].map(e=>e.dataset.fallbackItem),saveEnabled:Boolean(row?.querySelector('[data-fb-save]')&&!row.querySelector('[data-fb-save]').disabled),search:document.querySelector('input[data-unit-board-search]')?.value,campus:document.querySelector('select[data-unit-board-campus]')?.value,targetConnected:target?.isConnected??null,activeIsTarget:target?document.activeElement===target:false,activeIsMessage:document.activeElement===document.querySelector('[data-profile-parent-refresh] [role=status]'),activeIsBody:document.activeElement===document.body,selection:target instanceof HTMLInputElement?[target.selectionStart,target.selectionEnd]:null};
  });
  try{
   await page.goto(base+'/#view=units',{waitUntil:'domcontentloaded'});
   const fallback=page.locator('[data-fallback-unit="delete-parent"]');
   await fallback.locator('summary').click();await fallback.locator('[data-fb-up="delete-c"]').click();
   assert.deepEqual(await fallback.locator('[data-fallback-item]').evaluateAll(es=>es.map(e=>e.dataset.fallbackItem)),['delete-c','delete-b']);
   await page.locator('#unit-fallbacks-host').evaluate(e=>{window.__deleteOwnerHost=e;window.__deleteOwnerRow=e.querySelector('[data-fallback-unit="delete-parent"]');});
   await page.locator('input[data-unit-board-search]').fill('Royal');await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
   if(focusCase){
    await page.locator('[aria-label="Unit actions"] details.row-menu > summary').click();await page.locator('[data-delete-month="posting"]').click();
   }else{
    await page.locator('[data-unit-board-card="unit:delete-parent"] button[data-open-unit-modal]').click();
    await page.locator('#unit-management-modal [data-delete-unit-assignment="delete-parent-posting"]').click();
   }
   const dialog=page.locator('dialog.admin-delete');
   if(focusCase)await dialog.locator('[data-phrase]').fill('DELETE POSTINGS NOVEMBER 2026');
   await dialog.locator('[data-delete]:enabled').waitFor();
   const before={unitReads,fallbackReads};
   if(mode==='cancel-preview'){
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});
    await page.waitForLoadState('networkidle');
    assert.deepEqual({unitReads,fallbackReads},before);assert.equal(writes.length,1);assert.equal(deleted,false);assert.deepEqual(errors,[]);
    assert.equal(await page.locator('[data-profile-parent-refresh]').count(),0);
    const observed=await observe();assert.equal(observed.hostRetained,true);assert.deepEqual(observed.order,['delete-c','delete-b']);assert.equal(observed.saveEnabled,true);
    results.push({width,mode,passed:true,before,after:{unitReads,fallbackReads},observed,writes,requests,errors,events});continue;
   }
   await dialog.locator('[data-delete]:enabled').click();
   if(mode.startsWith('post-')){
    await until(()=>postArrived,'actual delete POST must arrive before owner steering');
    assert.equal(unitReads,before.unitReads);
    if(mode==='post-route-owner'){await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();}
    else if(mode==='post-month-owner'){
     await page.evaluate(()=>{const input=document.querySelector('#working-month');input.value='2026-12';input.dispatchEvent(new Event('change',{bubbles:true}));});
     await page.waitForFunction(()=>document.querySelector('#working-month')?.value==='2026-12');
     await until(()=>requests.some(r=>r.path==='/api/v1/unit-management/month'&&r.search==='?month=2026-12'),'replacement month GET arrives');
    }else{
     await page.evaluate(()=>{localStorage.removeItem('duty_rota_auth_token');window.dispatchEvent(new StorageEvent('storage',{key:'duty_rota_auth_token',oldValue:'delete-owner-local',newValue:null,storageArea:localStorage}));});
     await page.waitForFunction(()=>!document.querySelector('#section-title'));
    }
    const afterSteering={unitReads,fallbackReads,novemberReads:requests.filter(r=>r.path==='/api/v1/unit-management/month'&&r.search==='?month=2026-11').length};
    events.push('owner-steered-before-accepted-response');releasePost();
    await page.waitForLoadState('networkidle');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.equal(requests.filter(r=>r.path==='/api/v1/unit-management/month'&&r.search==='?month=2026-11').length,afterSteering.novemberReads,'expired accepted result must not read old month');
    assert.equal(await page.locator('[data-profile-parent-refresh]').count(),0);
    if(mode==='post-route-owner')assert.equal(await page.locator('#guide-checklist').count(),1);
    else if(mode==='post-month-owner')assert.equal(await page.locator('#working-month').inputValue(),'2026-12');
    else assert.equal(await page.locator('#section-title').count(),0);
    assert.equal(writes.length,2);assert.deepEqual(errors,[]);
    results.push({width,mode,passed:true,before,afterSteering,after:{unitReads,fallbackReads},writes,requests,errors,events});
   }else{
    await dialog.waitFor({state:'detached'});await until(()=>readArrived,'accepted deletion parent GET must be gated');
    const selector=mode==='read-newer-search-focus'?'input[data-unit-board-search]':'[data-unit-board-card="unit:delete-parent"] button[data-open-unit-modal]';
    await page.locator(selector).evaluate((e,m)=>{window.__deleteOwnerFocus=e;if(m==='read-newer-search-focus'){e.value='Royal Delete';e.dispatchEvent(new Event('input',{bubbles:true}));e.setSelectionRange(1,5);}e.focus({preventScroll:true});},mode);
    assert.equal(await page.evaluate(()=>document.activeElement===window.__deleteOwnerFocus),true);
    events.push('newer-parent-focus-before-get-result');releaseRead();
    await page.waitForFunction(()=>document.querySelector('[data-profile-parent-refresh]')?.textContent.includes('Saved changes are reflected'));
    const observed=await observe();
    assert.equal(observed.hostRetained,true);assert.equal(observed.rowRetained,true);assert.deepEqual(observed.order,['delete-c','delete-b']);assert.equal(observed.saveEnabled,true);assert.equal(observed.campus,'campus:Main');
    if(mode==='read-newer-search-focus'){assert.equal(observed.targetConnected,true);assert.equal(observed.activeIsTarget,true);assert.equal(observed.search,'Royal Delete');assert.deepEqual(observed.selection,[1,5]);}
    else{assert.equal(observed.targetConnected,false);assert.equal(observed.activeIsMessage,true);assert.equal(observed.activeIsBody,false);}
    assert.equal(unitReads,before.unitReads+1);assert.equal(writes.length,2);assert.deepEqual(errors,[]);
    results.push({width,mode,passed:true,before,after:{unitReads,fallbackReads},observed,writes,requests,errors,events});
   }
  }catch(error){results.push({width,mode,passed:false,assertion:error.message,observed:await observe().catch(()=>null),deleted,unitReads,fallbackReads,writes,requests,errors,events});console.log(width,mode,error.message);}
  finally{releasePost();releaseRead();await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }
}finally{await browser.close();}
assert.deepEqual(await hashes(),held);
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/priority19_adoption_review',executor:'/root',application_changed_by_test:false,execution_target:"applied source",scope:'12 Chromium320/1280 applied contexts: posting modal accepted result gated before route/month/account replacement; toolbar monthly deletion parent GET gated before newer surviving search focus or removed board opener focus, with no inert Unit modal underneath; preview cancel with no accepted mutation and zero parent GET. All writes locally fulfilled, other GETs disposable RAM8031. No member-delete smoke, no other-engine owner/focus coverage, no browser run by author.',held_source_sha256:held,candidate_sha256:sha(candidate),test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');
assert.equal(results.length,12);assert.ok(results.every(r=>r.passed),'All actual owner/focus/cancel supplement contexts must pass; failures preserved');
