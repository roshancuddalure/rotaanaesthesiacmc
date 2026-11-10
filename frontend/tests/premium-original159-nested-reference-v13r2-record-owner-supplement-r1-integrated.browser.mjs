import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Authoring only. Root coordinates all browser execution; all non-GETs below
// are locally fulfilled or explicitly refused. Remaining GETs use RAM8031.
const sha=b=>createHash('sha256').update(b).digest('hex');
const base='http://127.0.0.1:5197',api='http://127.0.0.1:8031';
const report='../docs/premium-ui/qa-original159-nested-reference-v13r2-record-owner-supplement-r1-integrated.json';
await assert.rejects(access(report),{code:'ENOENT'});
const audit=JSON.parse(await readFile('../docs/premium-ui/reviews/original159-nested-reference-v13r2-integrated-held-sources.json','utf8'));
const manifest=JSON.parse(await readFile('../tmp/nested-reference-v13r2/manifest.json','utf8'));
const candidates=Object.fromEntries(manifest.files.map(f=>['frontend/src/'+f.file,f.candidate_sha256]));
assert.equal(candidates['frontend/src/main.ts'],'ebf67f1733f620e406054d0c4a82cf1c203fd0e6603a843eec45b25a1a09df4d');
assert.equal(audit.source_sha256['frontend/src/main.ts'],'15b79223710a53a9e0ccdd70373a92e568f6ee603f56e3747454ab25ac258cc0');
for(const[path,expected]of Object.entries(audit.source_sha256)){
 assert.equal(sha(await readFile('../'+path)),expected,'Held applied source '+path);
 const name=path.slice('frontend/src/'.length),candidate=candidates[path];
 if(candidate)assert.equal(sha(await readFile('../tmp/nested-reference-v13r2/'+name)),candidate);
 const response=await fetch(base+'/src/'+name);assert.equal(response.status,200);
 const encoded=(await response.text()).match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(encoded);
 assert.ok(JSON.parse(Buffer.from(encoded[1],'base64').toString()).sourcesContent.some(s=>sha(s)===(candidate||expected)),'Exact served source '+path);
}
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 const scenarios=['direct-save','direct-unit-save','direct-member-save','profile-unit-save','existing-cancel','unit-save-parent503',...(engine==='chromium'?['owner-route','owner-month','owner-account']:[])];
 try{for(const width of[320,1280])for(const scenario of scenarios){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(16000);
  const requests=[],writes=[],errors=[],prompts=[];let createdUnit,createdMember,savedValues,unitReads=0,fbReads=0,failedParent=false,profileReads=0;
  const owner=scenario.startsWith('owner-'),profileScenario=scenario==='profile-unit-save',nestedUnit=scenario.includes('unit')||owner,nestedMember=scenario==='direct-member-save';
  const person={id:'chain-person',canonical_name:'Dr Chain Existing',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
  const original={id:'chain-parent',name:'Royal Chain Parent',campus:'Main',code:'CP',minimum_free_people:1,active_status:'active',aliases:[],notes:'',call_minimums:[],revision:'one',usage:{postings:1,duties:0,future_postings:1,future_duties:0,selected_members:1}};
  const units=()=>[original,{...original,id:'chain-b',name:'Royal Chain B',code:'CB'},{...original,id:'chain-c',name:'Royal Chain C',code:'CC'},...(createdUnit?[createdUnit]:[])];
  const members=()=>[person,...(createdMember?[createdMember]:[])];
  const originalPosting=()=>({id:'chain-posting',person,person_id:person.id,unit:original,unit_id:original.id,posting_type:'2ND_CALL',starts_on:'2026-11-01',ends_on:'2026-11-30',source:'manual',notes:'Chain notes OLD'});
  const savedPosting=()=>({...originalPosting(),...savedValues,id:profileScenario?'chain-posting':'chain-created-posting',person:members().find(m=>m.id===savedValues?.person_id)||person,unit:units().find(u=>u.id===savedValues?.unit_id)||original});
  const assignments=()=>savedValues?(profileScenario?[savedPosting()]:[originalPosting(),savedPosting()]):[originalPosting()];
  const unitData=month=>({month,starts_on:month+'-01',ends_on:month+(month==='2026-12'?'-31':'-30'),units:units(),assignments:month==='2026-11'?assignments():[],unit_summaries:units().map(u=>({unit_id:u.id,assigned_members:month==='2026-11'?assignments().filter(a=>a.unit_id===u.id).length:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]});
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{prompts.push(d.message());return d.accept();});
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','nested-chain-local');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),url=new URL(q.url()),p=url.pathname;requests.push({method:q.method(),path:p,search:url.search});
   if(q.method()!=='GET'){
    const body=q.postDataJSON();writes.push({method:q.method(),path:p,body});
    if(q.method()!=='POST')return route.fulfill({status:500,json:{detail:'Unexpected write method forbidden'}});
    if(p==='/api/v1/normalization/units'&&!createdUnit){createdUnit={...original,...body,id:'chain-new-unit',revision:'created',call_minimums:[]};return route.fulfill({json:createdUnit});}
    if(p==='/api/v1/normalization/members/resolve')return route.fulfill({json:{candidates:scenario==='existing-cancel'?[{id:person.id,name:person.canonical_name,status:'active',call_level:'2ND_CALL',designation:null}]:[]}});
    if(p==='/api/v1/admin/members'&&!createdMember){createdMember={...person,...body,id:'chain-new-person'};return route.fulfill({json:createdMember});}
    if(p==='/api/v1/normalization/records/units/preview'){
     assert.equal(body.identity,profileScenario?'chain-posting':undefined);assert.equal(body.values.notes,'Chain notes NEW');
     return route.fulfill({json:{review_token:'chain-exact-review-token',before:profileScenario?originalPosting():null,after:body.values,availability:'Local reviewed fixture',duties:[]}});
    }
    if(p==='/api/v1/normalization/records/units/save'){
     assert.equal(savedValues,undefined,'Exactly one accepted record save');assert.equal(body.identity,profileScenario?'chain-posting':undefined);assert.equal(body.review_token,'chain-exact-review-token');assert.equal(body.values.notes,'Chain notes NEW');savedValues=body.values;return route.fulfill({json:savedPosting()});
    }
    return route.fulfill({status:500,json:{detail:'Unspecified mutation forbidden by isolated test'}});
   }
   if(p==='/api/v1/admin/members')return route.fulfill({json:members()});
   if(p==='/api/v1/normalization/units')return route.fulfill({json:units()});
   if(p==='/api/v1/normalization/units/suggest-code')return route.fulfill({json:{code:'CNEW'}});
   if(p.startsWith('/api/v1/normalization/catalog/'))return route.fulfill({json:[{key:'2ND_CALL',label:'2nd Call',active:true}]});
   if(p==='/api/v1/normalization/records/units/chain-posting')return route.fulfill({json:originalPosting()});
   if(p==='/api/v1/admin/member-workspace/chain-person')return route.fulfill({json:{member:person,impact:{}}});
   if(p.startsWith('/api/v1/admin/member-workspace/chain-person/')){
    if(p.endsWith('/postings'))profileReads++;
    return route.fulfill({json:{rows:p.endsWith('/postings')?[{...(savedValues?savedPosting():originalPosting()),unit:(savedValues?savedPosting():originalPosting()).unit.name}]:[]}});
   }
   if(p==='/api/v1/extra-duty/unit-fallbacks'){fbReads++;return route.fulfill({json:units().map(u=>({unit_id:u.id,unit_name:u.name,fallbacks:u.id===original.id?units().slice(1,3).map(t=>({unit_id:t.id,unit_name:t.name})):[]}))});}
   if(p==='/api/v1/unit-management/month'){
    unitReads++;
    if(savedValues&&scenario==='unit-save-parent503'&&!failedParent){failedParent=true;return route.fulfill({status:503,json:{detail:'Accepted chained changes; parent read temporarily unavailable'}});}
    return route.fulfill({json:unitData(url.searchParams.get('month')||'2026-11')});
   }
   return route.fulfill({response:await route.fetch({url:api+p+url.search,maxRetries:2})});
  });
  const observe=()=>page.evaluate(()=>({settings:document.querySelector('#unit-minimum-free-people')?.value,formRetained:document.querySelector('#unit-settings-form')===window.__chainForm,inputRetained:document.querySelector('#unit-minimum-free-people')===window.__chainInput,hostRetained:document.querySelector('#unit-fallbacks-host')===window.__chainHost,rowRetained:document.querySelector('[data-fallback-unit="chain-parent"]')===window.__chainRow,order:[...document.querySelectorAll('[data-fallback-unit="chain-parent"] [data-fallback-item]')].map(e=>e.dataset.fallbackItem),search:document.querySelector('input[data-unit-board-search]')?.value,campus:document.querySelector('select[data-unit-board-campus]')?.value,notices:[...document.querySelectorAll('[data-profile-parent-refresh]')].map(e=>e.textContent)}));
  const retained=async()=>{const o=await observe();assert.equal(o.settings,'3');assert.equal(o.formRetained,true);assert.equal(o.inputRetained,true);assert.equal(o.hostRetained,true);assert.equal(o.rowRetained,true);assert.deepEqual(o.order,['chain-c','chain-b']);assert.equal(o.search,'Royal');assert.equal(o.campus,'campus:Main');assert.equal(await page.locator('[data-fallback-unit="chain-parent"] [data-fb-save]').isEnabled(),true);return o;};
  try{
   await page.goto(base+'/#view=units',{waitUntil:'domcontentloaded'});
   const fallback=page.locator('[data-fallback-unit="chain-parent"]');await fallback.locator('summary').click();await fallback.locator('[data-fb-up="chain-c"]').click();
   await page.locator('#unit-fallbacks-host').evaluate(e=>{window.__chainHost=e;window.__chainRow=e.querySelector('[data-fallback-unit="chain-parent"]');});
   await page.locator('input[data-unit-board-search]').fill('Royal');await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
   await page.locator('[data-unit-board-card="unit:chain-parent"] button[data-open-unit-modal]').click();
   const parent=page.locator('#unit-management-modal');await parent.locator('#unit-minimum-free-people').fill('3');
   await parent.locator('#unit-settings-form').evaluate(e=>{window.__chainForm=e;window.__chainInput=e.querySelector('#unit-minimum-free-people');});
   const before={unitReads,fbReads};let profile;
   if(profileScenario){
    await parent.locator('[data-open-member="chain-person"]').click();profile=page.getByRole('dialog',{name:'Member profile',exact:true});
    await profile.locator('[data-edit-record="chain-posting"]').click();
   }else await parent.locator('[data-add-operational-record="units"]').click();
   const editor=page.getByRole('dialog',{name:profileScenario?'Edit posting':'Add posting',exact:true});
   await editor.locator('[name=person_id]').waitFor();
   if(nestedUnit){
    await editor.locator('[data-new-unit]').click();const registry=page.getByRole('dialog',{name:'Manage department units',exact:true});
    await registry.locator('[name=name]').fill('Royal Chain New');await registry.locator('[name=campus]').fill('Main');await registry.locator('[name=code]').fill('CNEW');
    await registry.getByRole('button',{name:'Create unit',exact:true}).click();await registry.waitFor({state:'detached'});
    assert.equal(await editor.locator('[name=unit_id]').inputValue(),'chain-new-unit');
   }else if(nestedMember||scenario==='existing-cancel'){
    await editor.locator('[data-new-member]').click();const creator=page.getByRole('dialog',{name:'Create department member',exact:true});
    if(scenario==='existing-cancel'){
     // The control is created only after the existing name-resolution POST.
     await creator.locator('[name=canonical_name]').fill(person.canonical_name);await creator.locator('[name=call_level]').focus();
     await creator.locator('[data-use-existing="chain-person"]').click();
    }else{
     await creator.locator('[name=canonical_name]').fill('Dr Chain Created');await creator.locator('[name=call_level]').selectOption('2ND_CALL');
     await creator.getByRole('button',{name:'Create member',exact:true}).click();
    }
    await creator.waitFor({state:'detached'});assert.equal(await editor.locator('[name=person_id]').inputValue(),nestedMember?'chain-new-person':person.id);
   }
   assert.equal(unitReads,before.unitReads,'No root read while outer record/profile remains open');assert.equal(fbReads,before.fbReads);
   if(owner){
    const variant=scenario.slice(6);
    if(variant==='route'){await page.evaluate(()=>{location.hash='#view=user-guide';});await page.locator('#guide-checklist').waitFor();}
    else if(variant==='month'){
     await page.evaluate(()=>{const input=document.querySelector('#working-month');input.value='2026-12';input.dispatchEvent(new Event('change',{bubbles:true}));});
     await page.waitForFunction(()=>document.querySelector('#working-month')?.value==='2026-12');
    }else{
     await page.evaluate(()=>{localStorage.removeItem('duty_rota_auth_token');window.dispatchEvent(new StorageEvent('storage',{key:'duty_rota_auth_token',oldValue:'nested-chain-local',newValue:null,storageArea:localStorage}));});
     await editor.waitFor({state:'detached'});
    }
    await page.waitForLoadState('networkidle');const afterSteering={unitReads,fbReads};
    if(await editor.count()){await editor.locator('button[data-close]').first().click();await editor.waitFor({state:'detached'});}
    await page.waitForLoadState('networkidle');assert.deepEqual({unitReads,fbReads},afterSteering,'Expired outer close cannot schedule parent month/fallback reads');
    assert.equal(await page.locator('[data-profile-parent-refresh]').count(),0,'No expired-owner status painting');assert.equal(savedValues,undefined);assert.equal(writes.filter(w=>w.path==='/api/v1/normalization/units').length,1);assert.equal(writes.filter(w=>w.path.includes('/records/')).length,0);assert.deepEqual(errors,[]);
    results.push({engine,width,scenario,passed:true,before,afterSteering,after:{unitReads,fbReads},writes,requests,errors});continue;
   }
   if(scenario==='existing-cancel'){
    await editor.locator('button[data-close]').first().click();await editor.waitFor({state:'detached'});await page.waitForLoadState('networkidle');
    assert.deepEqual({unitReads,fbReads},before,'Read-only existing selection/discard produces zero root refresh');assert.equal(createdMember,undefined);assert.equal(createdUnit,undefined);assert.equal(savedValues,undefined);assert.equal(writes.length,1);assert.equal(writes[0].path,'/api/v1/normalization/members/resolve');
    results.push({engine,width,scenario,passed:true,before,after:{unitReads,fbReads},observed:await retained(),writes,requests,errors});assert.deepEqual(errors,[]);continue;
   }
   if(!nestedMember)await editor.locator('[name=person_id]').selectOption(person.id);
   if(!nestedUnit)await editor.locator('[name=unit_id]').selectOption(original.id);
   await editor.locator('[name=notes]').fill('Chain notes NEW');await editor.getByRole('button',{name:'Review changes',exact:true}).click();
   await editor.locator('[data-save]:enabled').click();await editor.waitFor({state:'detached'});
   if(profileScenario){
    await profile.getByText('Chain notes NEW',{exact:true}).waitFor();assert.deepEqual({unitReads,fbReads},before,'Nested editor confirmed save does not close owning profile');
    assert.match(await parent.locator('[data-unit-row-form="chain-posting"]').innerText(),/Chain notes OLD/);await retained();
    await profile.locator('[data-close]').click();await profile.waitFor({state:'detached'});
   }
   let failedObserved=null;
   if(scenario==='unit-save-parent503'){
    const retry=parent.locator('[data-retry-profile-parent]');await retry.waitFor({state:'visible'});failedObserved=await retained();
    assert.match(failedObserved.notices.join(' '),/Changes are saved, but this view could not refresh/);assert.equal(unitReads,before.unitReads+1);assert.equal(fbReads,before.fbReads+1);
    assert.equal(await page.locator('[data-unit-board-card="unit:chain-new-unit"]').count(),0,'Uncommitted month GET failure retains old board');
    await retry.focus();await page.keyboard.press('Enter');
   }
   await parent.getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();await page.waitForLoadState('networkidle');
   const expectedReads=scenario==='unit-save-parent503'?2:1;assert.equal(unitReads,before.unitReads+expectedReads,'One coalesced parent read, plus explicit GET-only retry if failed');
   assert.equal(fbReads,before.fbReads+(nestedUnit?expectedReads:0),'Full reference read only for nested unit mutation');
   assert.equal(writes.filter(w=>w.path==='/api/v1/normalization/records/units/save').length,1);assert.equal(writes.filter(w=>w.path==='/api/v1/normalization/records/units/preview').length,1);
   assert.equal(writes.filter(w=>w.path==='/api/v1/normalization/units').length,nestedUnit?1:0);assert.equal(writes.filter(w=>w.path==='/api/v1/admin/members').length,nestedMember?1:0);
   assert.equal(failedParent,scenario==='unit-save-parent503');
   const observed=await retained();
   if(nestedUnit){
    const newCard=page.locator('[data-unit-board-card="unit:chain-new-unit"]');assert.equal(await newCard.count(),1);
    assert.ok(await newCard.locator('[data-open-member="chain-person"]').count()>0,'Returned saved posting belongs to newly created unit');
    assert.equal(await fallback.locator('[data-fb-select] option[value="chain-new-unit"]').count(),1);
    assert.equal(await parent.locator('[data-unit-row-form="chain-created-posting"]').count(),0,'Original unit modal does not invent new-unit assignment');
   }
   if(!profileScenario&&!nestedUnit)assert.match(await parent.locator('[data-unit-row-form="chain-created-posting"]').innerText(),/Chain notes NEW/);
   if(nestedMember)assert.match(await parent.locator('[data-unit-row-form="chain-created-posting"]').innerText(),/Dr Chain Created/);
   assert.deepEqual(errors,[]);results.push({engine,width,scenario,passed:true,before,after:{unitReads,fbReads},profileReads,failedObserved,observed,writes,requests,errors});
  }catch(error){results.push({engine,width,scenario,passed:false,assertion:error.message,observed:await observe().catch(()=>null),createdUnit:Boolean(createdUnit),createdMember:Boolean(createdMember),savedValues,unitReads,fbReads,profileReads,writes,requests,errors});}
  finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
for(const[path,expected]of Object.entries(audit.source_sha256))assert.equal(sha(await readFile('../'+path)),expected,'Applied source held');
for(const{file,candidate_sha256}of manifest.files)assert.equal(sha(await readFile('../tmp/nested-reference-v13r2/'+file)),candidate_sha256,'Candidate held');
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/leave159_nondelete_groundwork',operator:'/root when actually executed',execution_target:'fresh applied V13r2 source5197',application_changed_by_test:false,source_sha256:audit.source_sha256,candidate_sha256:candidates,test_sha256:sha(await readFile(new URL(import.meta.url))),scope:'42 bounded contexts: 36 Chromium/Firefox/WebKit320/1280 direct reviewed record save alone, nested accepted unit/member then own save, profile nested unit+editor save deferred to final profile close, Use Existing then discard with zero mutation/root refresh, accepted unit+record followed by parent503 and Enter GET-only retry. Six additional Chromium320/1280 route/month/account-expired nested-reference owners reject late close refresh. All actual controls, local non-GETs and RAM-only remaining reads. Existing token/body values checked and exact one accepted record save/no replay; settings/fallback nodes/order/filters retained.',limits:['Author has not run browsers; a generated report is evidence only when root actually executes this frozen file.','Owner scenarios supersede owner while outer editor is open, then close; they do not cover an already-inflight parent read resolving after supersession.','Owner navigation deliberately bypasses modal inert background via actual location/storage/month events to test lifetime ownership.','Only parent month503 injected; independent full fallback GET failure/malformed read and profile replacement Next/Retry are separate gates.','No physical-device/native assistive technology or full original159 acceptance.'],results},null,2)+'\n');
assert.equal(results.length,42);assert.ok(results.every(r=>r.passed),'All record-chain and owner contexts must pass');
