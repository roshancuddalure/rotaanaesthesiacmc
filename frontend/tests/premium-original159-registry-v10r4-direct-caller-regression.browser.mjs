import assert from 'node:assert/strict';import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';import{chromium,firefox,webkit}from'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),base='http://127.0.0.1:5301',api='http://127.0.0.1:8031';
const held={"main.ts": "96ab7c4c6b14d41736ad4153313b1270677e324fcab6b11c3a5b0d8ac3e47a0b", "reference-workspace.ts": "78c231ea1d5ab15bd3a4b5f2f8265529451a51bacc68d2a4aac1708a4be30292", "extra-duty.ts": "52084624922de21f2a0fa478eb1ca4c883cdeb66dd1d05147d0f21fe806bc7ea", "member-workspace.ts": "105cc1d91ea4815d565ad4859fc01412cf576a3203c07834f4010e3fef7ef1a5", "operational-import.ts": "1ccbcf4181330a5f66c59b0723ec02f878a268b6b3030aa99b177de1b7070355", "record-workspace.ts": "469fd6bf2e4118b15ad343d8059cd3cfb0acbc6483bea969ca5fb93488644335", "services/api.ts": "5167f842eb4e07cf5216d18bde2ef48ded1a6692490d80dd261e4ceb038a5e3c"},candidates={"main.ts": "9f5359ad9e8014098bc12c8ed3f9e1c6b1a06d1a4f92797b7f9da24bfba6e6b8", "reference-workspace.ts": "dbd6d1bdb13893ee49d3f004518177b964101520e2bd2034d8639f1c76f134bd", "extra-duty.ts": "529e420fc05ce5bfa42655b8863e449e09e22a7c0abe9baf4db5c94c4797b8c3", "member-workspace.ts": "105cc1d91ea4815d565ad4859fc01412cf576a3203c07834f4010e3fef7ef1a5", "operational-import.ts": "1ccbcf4181330a5f66c59b0723ec02f878a268b6b3030aa99b177de1b7070355", "record-workspace.ts": "469fd6bf2e4118b15ad343d8059cd3cfb0acbc6483bea969ca5fb93488644335", "services/api.ts": "5167f842eb4e07cf5216d18bde2ef48ded1a6692490d80dd261e4ceb038a5e3c"};
const sourcePath=n=>['main.ts','reference-workspace.ts','extra-duty.ts'].includes(n)?'../tmp/registry-parent-refresh-v10r4/'+n:'src/'+n;
const hashes=async()=>Object.fromEntries(await Promise.all(Object.keys(held).map(async n=>['frontend/src/'+n,sha(await readFile('src/'+n))]))),initial=await hashes();for(const[n,h]of Object.entries(held))assert.equal(initial['frontend/src/'+n],h);
const candidatePaths=Object.keys(candidates).map(sourcePath),candidateHashes=Object.fromEntries(await Promise.all(candidatePaths.map(async p=>[p,sha(await readFile(p))])));for(const[n,h]of Object.entries(candidates)){assert.equal(sha(await readFile(sourcePath(n))),h);const r=await fetch(base+'/src/'+n);assert.equal(r.status,200);const t=await r.text(),m=t.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(m);assert.ok(JSON.parse(Buffer.from(m[1],'base64').toString()).sourcesContent.some(s=>sha(s)===h),'Exact served '+n);}
const member={id:'parent-person',canonical_name:'Dr Parent Audit',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
const unit={id:'parent-unit',name:'Royal Parent Unit',campus:'Main',code:'PARENT',minimum_free_people:1,active_status:'active',notes:null};
const second={...unit,id:'fallback-b',name:'Royal Fallback B'},third={...unit,id:'fallback-c',name:'Royal Fallback C'};
const scenarios=['add-success','edit-read-failure'];
const results=[];
for(const[engine,launcher]of Object.entries({chromium})){
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
     await page.evaluate(()=>location.hash='#view=units');await page.locator('#unit-management-modal [data-unit-row-form="parent-posting"]').waitFor();
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
await writeFile('../docs/premium-ui/qa-original159-registry-v10r4-direct-caller-regression.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/profile_parent_final_audit',decision:failed.length?'Expected-correct candidate regression failures retained':'4 bounded Chromium Units direct caller regression contexts passed',scope:'Chromium320/1280 Units Add success and Edit parent503 GET-only keyboard retry; route/newerinput cases are not executed by this bounded supplement. Real unrelated inline fallback reorder and settings drafts retained. All POSTs fulfilled locally; no production or whole159 claim. No Leave direct Add/day-owner, import/registry/delete/core-member certification.',source_sha256:initial,candidate_sha256:candidateHashes,test_sha256:sha(await readFile(new URL(import.meta.url))),expected_contexts:4,failed_contexts:failed.length,results},null,2)+'\n');
assert.equal(results.length,4);assert.equal(failed.length,0,'All direct-record retained-parent cases must pass');console.log('Registry V10r4 direct caller4 contexts passed');
