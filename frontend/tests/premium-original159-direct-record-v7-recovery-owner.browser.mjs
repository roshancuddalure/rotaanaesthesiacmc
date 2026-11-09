import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),base='http://127.0.0.1:5295',api='http://127.0.0.1:8031';
const sourcePaths=['src/main.ts','src/member-workspace.ts','src/record-workspace.ts','src/services/api.ts','src/extra-duty.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
assert.equal(initial['frontend/src/main.ts'],'2b8f68c069e599af50a4ac1b2146a7018d6268f290b90a9949130a057dc91b43');
assert.equal(initial['frontend/src/member-workspace.ts'],'105cc1d91ea4815d565ad4859fc01412cf576a3203c07834f4010e3fef7ef1a5');
const candidatePaths=['../tmp/profile-parent-refresh-v7/main.ts','../tmp/profile-parent-refresh-v7/member-workspace.ts'];
const candidateHashes=Object.fromEntries(await Promise.all(candidatePaths.map(async p=>[p,sha(await readFile(p))])));
assert.equal(candidateHashes[candidatePaths[0]],'7ab96e2109aec76f027bbd80bc9535ee40c0eaacc4040eea3261e4b4c8e3d2d6');
assert.equal(candidateHashes[candidatePaths[1]],initial['frontend/src/member-workspace.ts']);
for(const [i,name]of ['main.ts','member-workspace.ts'].entries()){
 const response=await fetch(base+'/src/'+name);assert.equal(response.status,200);const text=await response.text();
 const encoded=text.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(encoded,'Inline original-source map '+name);
 const map=JSON.parse(Buffer.from(encoded[1],'base64').toString());assert.ok(map.sourcesContent.some(s=>sha(s)===candidateHashes[candidatePaths[i]]),'Exact candidate '+name);
}
const member={id:'parent-person',canonical_name:'Dr Parent Audit',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
const unit={id:'parent-unit',name:'Royal Parent Unit',campus:'Main',code:'PARENT',minimum_free_people:1,active_status:'active',notes:null};
const second={...unit,id:'fallback-b',name:'Royal Fallback B'},third={...unit,id:'fallback-c',name:'Royal Fallback C'};
const scenarios=['add-success','edit-read-failure','add-read-failure','newer-settings-draft','route-owner'];
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of[320,1280])for(const scenario of scenarios){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),writes=[],requests=[],errors=[];
  let saved=false,unitReads=0,readAfterSave=0,fallbackReads=0,held=false,signalHeld,release;
  const heldStarted=new Promise(r=>signalHeld=r),gate=new Promise(r=>release=r),isAdd=scenario.startsWith('add-'),failure=scenario.endsWith('read-failure'),hold=['newer-settings-draft','route-owner'].includes(scenario);
  const posting=(id='parent-posting')=>({id,person:member,person_id:member.id,unit,unit_id:unit.id,posting_type:'2ND_CALL',starts_on:'2026-11-01',ends_on:'2026-11-30',source:'manual',notes:saved&&(!isAdd||id==='added-posting')?'Saved posting notes NEW':'Saved posting notes OLD'});
  const unitData=month=>({month,starts_on:month+'-01',ends_on:month+'-30',units:[unit,second,third],assignments:isAdd&&saved?[posting(),posting('added-posting')]:[posting()],unit_summaries:[{unit_id:unit.id,assigned_members:isAdd&&saved?2:1,people_with_leave:0,leave_days:0,leave_by_call_level:{}},{unit_id:second.id,assigned_members:0,people_with_leave:0,leave_days:0},{unit_id:third.id,assigned_members:0,people_with_leave:0,leave_days:0}],unit_call_minimums:[{unit_id:unit.id,call_level:'2ND_CALL',assigned_members:isAdd&&saved?2:1,minimum_free_people:1,max_allowed:isAdd&&saved?2:1}],validation_issues:[]});
  const fallbackRows=[{unit_id:unit.id,unit_name:unit.name,fallbacks:[{unit_id:second.id,unit_name:second.name},{unit_id:third.id,unit_name:third.name}]},{unit_id:second.id,unit_name:second.name,fallbacks:[]},{unit_id:third.id,unit_name:third.name,fallbacks:[]}];
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','direct-parent-v6');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url()),p=u.pathname;requests.push({method:q.method(),path:p,search:u.search});
   if(q.method()!=='GET'){
    const body=q.postDataJSON();writes.push({method:q.method(),path:p,body});assert.equal(q.method(),'POST');assert.equal(body.identity,isAdd?undefined:'parent-posting');
    assert.equal(body.values.person_id,member.id);assert.equal(body.values.unit_id,unit.id);assert.equal(body.values.posting_type,'2ND_CALL');assert.equal(body.values.starts_on,'2026-11-01');assert.equal(body.values.ends_on,'2026-11-30');assert.equal(body.values.notes,'Saved posting notes NEW');
    if(p==='/api/v1/normalization/records/units/preview')return route.fulfill({json:{review_token:'v6-target-token',before:isAdd?null:posting(),after:body.values,availability:'Fixture reviewed',duties:[]}});
    assert.equal(p,'/api/v1/normalization/records/units/save');assert.equal(body.review_token,'v6-target-token');assert.equal(saved,false,'Exactly one accepted mutation');saved=true;return route.fulfill({json:posting(isAdd?'added-posting':'parent-posting')});
   }
   if(p==='/api/v1/admin/members')return route.fulfill({json:[member]});
   if(p==='/api/v1/normalization/units')return route.fulfill({json:[unit,second,third]});
   if(p.startsWith('/api/v1/normalization/catalog/'))return route.fulfill({json:[{key:'2ND_CALL',label:'2nd Call',active:true}]});
   if(p==='/api/v1/normalization/records/units/parent-posting')return route.fulfill({json:posting()});
   if(p==='/api/v1/extra-duty/unit-fallbacks'){fallbackReads++;return route.fulfill({json:fallbackRows});}
   if(p==='/api/v1/unit-management/month'){
    unitReads++;const value=unitData(u.searchParams.get('month'));
    if(saved){readAfterSave++;if(hold&&!held){held=true;signalHeld();await gate;}if(failure&&readAfterSave===1)return route.fulfill({status:503,json:{detail:'Accepted posting; parent read unavailable'}});}
    return route.fulfill({json:value});
   }
   return route.fulfill({response:await route.fetch({url:api+p+u.search,maxRetries:2})});
  });
  try{
   await page.goto(base+'/#view=units',{waitUntil:'domcontentloaded'});
   // Create an actual unrelated inline draft through existing reorder controls.
   const fallback=page.locator('[data-fallback-unit="parent-unit"]');await fallback.locator('summary').click();await fallback.locator('[data-fb-up="fallback-c"]').click();
   assert.deepEqual(await fallback.locator('[data-fallback-item]').evaluateAll(es=>es.map(e=>e.dataset.fallbackItem)),['fallback-c','fallback-b']);
   assert.equal(await fallback.locator('[data-fb-save]').isEnabled(),true);
   await page.locator('#unit-fallbacks-host').evaluate(e=>{window.__fallbackHost=e;window.__fallbackRow=e.querySelector('[data-fallback-unit="parent-unit"]');});
   await page.locator('input[data-unit-board-search]').fill('Royal');await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
   await page.locator('[data-unit-board-card="unit:parent-unit"] button[data-open-unit-modal]').click();
   const parent=page.locator('#unit-management-modal');await parent.locator('#unit-minimum-free-people').fill('3');
   await parent.locator('#unit-settings-form').evaluate(e=>{window.__parentForm=e;window.__parentInput=e.querySelector('#unit-minimum-free-people');});
   const readsBefore=unitReads,fallbackReadsBefore=fallbackReads;
   await parent.locator(isAdd?'[data-add-operational-record="units"]':'[data-edit-operational-record="parent-posting"]').click();
   const editor=page.getByRole('dialog',{name:isAdd?'Add posting':'Edit posting',exact:true});if(isAdd)await editor.locator('[name=person_id]').selectOption(member.id);
   await editor.locator('[name=notes]').fill('Saved posting notes NEW');await editor.getByRole('button',{name:'Review changes',exact:true}).click();await editor.locator('[data-save]:enabled').click();await editor.waitFor({state:'detached'});
   let outcome={};
   if(hold){
    await heldStarted;assert.equal(held,true);
    if(scenario==='route-owner'){
     await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();release();await page.waitForLoadState('networkidle');
     assert.equal(await page.locator('[data-profile-parent-refresh]').count(),0);assert.equal(await page.locator('#unit-management-modal').count(),0);
     await page.evaluate(()=>location.hash='#view=units');await page.locator('[data-unit-board-card="unit:parent-unit"] button[data-open-unit-modal]').click();
     assert.match(await page.locator('[data-unit-row-form="parent-posting"]').innerText(),/Saved posting notes NEW/);assert.equal(unitReads,readsBefore+2);
     outcome={staleReadCannotPaintGuide:true,explicitReturnFresh:true,parentReads:unitReads-readsBefore};
    }else{
     const input=parent.locator('#unit-minimum-free-people');await input.fill('4');await input.focus();release();
    }
   }
   if(scenario!=='route-owner'){
    if(failure){
     const notice=parent.locator('[data-profile-parent-refresh]');await notice.getByText(/Changes are saved, but this view could not refresh/).waitFor();
     assert.equal(await parent.locator('#unit-minimum-free-people').inputValue(),'3');assert.match(await parent.locator('[data-unit-row-form="parent-posting"]').innerText(),/Saved posting notes OLD/);
     assert.equal(writes.length,2);assert.equal(unitReads,readsBefore+1);
     const retry=notice.locator('[data-retry-profile-parent]');await retry.focus();await page.keyboard.press('Enter');
    }
    await parent.getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();
    const target=isAdd?'added-posting':'parent-posting';assert.match(await parent.locator(`[data-unit-row-form="${target}"]`).innerText(),/Saved posting notes NEW/);
    if(isAdd){assert.equal(await parent.locator('[data-unit-row-form]').count(),2);assert.match(await parent.locator('[data-unit-row-form="parent-posting"]').innerText(),/Saved posting notes OLD/);}
    assert.equal(await parent.locator('#unit-minimum-free-people').inputValue(),scenario==='newer-settings-draft'?'4':'3');
    assert.equal(await parent.locator('#unit-settings-form').evaluate(e=>e===window.__parentForm&&e.querySelector('#unit-minimum-free-people')===window.__parentInput),true);
    if(scenario==='newer-settings-draft')assert.equal(await parent.locator('#unit-minimum-free-people').evaluate(e=>e===document.activeElement),true,'Newer intentional settings focus survives');
    assert.equal(await page.locator('#unit-fallbacks-host').evaluate(e=>e===window.__fallbackHost&&e.querySelector('[data-fallback-unit="parent-unit"]')===window.__fallbackRow),true);
    assert.deepEqual(await fallback.locator('[data-fallback-item]').evaluateAll(es=>es.map(e=>e.dataset.fallbackItem)),['fallback-c','fallback-b']);assert.equal(await fallback.locator('[data-fb-save]').isEnabled(),true);
    assert.equal(fallbackReads,fallbackReadsBefore,'Do not remount/refetch independent fallback editor');assert.equal(unitReads,readsBefore+(failure?2:1));
    assert.equal(await page.locator('#working-month').inputValue(),'2026-11');await parent.locator('[data-close-unit-modal]').click();assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Royal');assert.equal(await page.locator('select[data-unit-board-campus]').inputValue(),'campus:Main');
    outcome={oneAcceptedMutation:true,parentFresh:true,parentReads:unitReads-readsBefore,settingsValue:scenario==='newer-settings-draft'?'4':'3',settingsNodesRetained:true,dirtyInlineFallbackHostAndOrderRetained:true,searchCampusMonthRetained:true,GETOnlyRetry:failure,newerFocusRetained:scenario==='newer-settings-draft'};
   }
   assert.equal(writes.length,2);assert.equal(writes.filter(w=>w.path.endsWith('/save')).length,1);assert.deepEqual(errors,[]);
   results.push({engine,width,scenario,passed:true,outcome,writes,requests,errors});console.log(`${engine} ${width} ${scenario} passed`);
  }catch(error){
   const observed=await page.evaluate(()=>({month:document.querySelector('#working-month')?.value,view:location.hash,settings:document.querySelector('#unit-minimum-free-people')?.value,formRetained:document.querySelector('#unit-settings-form')===window.__parentForm,fallbackHostRetained:document.querySelector('#unit-fallbacks-host')===window.__fallbackHost})).catch(()=>null);
   results.push({engine,width,scenario,passed:false,assertion:error.message,observed,writes,requests,errors,unitReads,fallbackReads});console.log(`${engine} ${width} ${scenario} failed: ${error.message}`);
  }finally{release();await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);for(const p of candidatePaths)assert.equal(sha(await readFile(p)),candidateHashes[p]);
const failed=results.filter(r=>!r.passed);
await writeFile('../docs/premium-ui/qa-original159-direct-record-v7-recovery-owner.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/profile_parent_final_audit',decision:failed.length?'Expected-correct candidate regression failures retained':'30 bounded direct-record retained-parent candidate contexts passed',scope:'Existing normalized Unit Add/Edit, parent503 GET-only keyboard retry, newer settings input/focus, stale route read. Real unrelated inline fallback reorder and settings drafts retained. All POSTs fulfilled locally; no production or whole159 claim. No Leave direct Add/day-owner, import/registry/delete/core-member certification.',source_sha256:initial,candidate_sha256:candidateHashes,test_sha256:sha(await readFile(new URL(import.meta.url))),expected_contexts:30,failed_contexts:failed.length,results},null,2)+'\n');
assert.equal(results.length,30);assert.equal(failed.length,0,'All direct-record retained-parent cases must pass');console.log('V7 direct record30 recovery/owner contexts passed');
