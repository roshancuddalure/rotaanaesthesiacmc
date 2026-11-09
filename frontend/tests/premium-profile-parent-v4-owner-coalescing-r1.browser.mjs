import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const sha=b=>createHash('sha256').update(b).digest('hex');
const base='http://127.0.0.1:5292',api='http://127.0.0.1:8031';
const paths=['src/main.ts','src/member-workspace.ts','src/record-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))])));
const initial=await hashes(),candidatePaths=['../tmp/profile-parent-refresh-v4/main.ts','../tmp/profile-parent-refresh-v4/member-workspace.ts'];
assert.equal(initial['frontend/src/main.ts'],'5311e9933a6614747458418a218ac2b22855c2f7baa574e446557a4aa6d9d13d');
assert.equal(initial['frontend/src/member-workspace.ts'],'0ef8c1ef2234c7a50d8ca10b8aaa3998a654d452f563bd4c75531faef09d6c63');
const candidateHashes=Object.fromEntries(await Promise.all(candidatePaths.map(async p=>[p,sha(await readFile(p))])));
assert.equal(candidateHashes[candidatePaths[0]],'355e71753eb79135d4bdefb94837da4fc1ff727b12a2ed1f9c4bdb4b5d744a07');
assert.equal(candidateHashes[candidatePaths[1]],'105cc1d91ea4815d565ad4859fc01412cf576a3203c07834f4010e3fef7ef1a5');
const previewIntegrity=[];
for(const [i,name]of ['main.ts','member-workspace.ts'].entries()){
 const response=await fetch(base+'/src/'+name);assert.equal(response.status,200);
 const text=await response.text(),match=text.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
 assert.ok(match,'Expected inline Vite original-source map for '+name);
 const map=JSON.parse(Buffer.from(match[1],'base64').toString('utf8'));
 assert.ok(map.sourcesContent?.some(source=>typeof source==='string'&&sha(source)===candidateHashes[candidatePaths[i]]),'Preview must serve exact frozen '+name);
 previewIntegrity.push({name,matched_original_source_sha256:candidateHashes[candidatePaths[i]]});
}
const member={id:'parent-person',canonical_name:'Dr Parent Audit',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
const unit={id:'parent-unit',name:'Royal Parent Unit',campus:'Main',code:'PARENT',minimum_free_people:1,active_status:'active',notes:null};
const scenarios=['route-away-return','month-supersession','signout','held-parent-new-draft','two-saves-coalesced','profile-read-failure'];
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of[320,1280])for(const scenario of scenarios){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],requests=[],writes=[];
  let revision=0,unitReads=0,profileReads=0,holdNextParent=false,profileFailed=false,started,release;
  const held=new Promise(r=>started=r),gate=new Promise(r=>release=r);
  const posting=()=>({id:'parent-posting',person:member,person_id:member.id,unit,unit_id:unit.id,posting_type:'2ND_CALL',starts_on:'2026-11-01',ends_on:'2026-11-30',source:'manual',notes:revision?'Saved posting notes NEW '+revision:'Saved posting notes OLD'});
  const unitData=month=>({month,starts_on:month+'-01',ends_on:month+'-30',units:[unit],assignments:[posting()],unit_summaries:[{unit_id:unit.id,assigned_members:1,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[{unit_id:unit.id,call_level:'2ND_CALL',assigned_members:1,minimum_free_people:1,max_allowed:1}],validation_issues:[]});
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','profile-parent-owner');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url()),p=u.pathname;requests.push({method:q.method(),path:p,search:u.search});
   if(q.method()!=='GET'){
    const body=q.postDataJSON();writes.push({method:q.method(),path:p,body});assert.equal(q.method(),'POST');
    assert.equal(body.identity,'parent-posting');
    if(p==='/api/v1/normalization/records/units/preview')return route.fulfill({json:{review_token:'parent-token-'+revision,before:posting(),after:body.values,availability:'Fixture reviewed',duties:[]}});
    assert.equal(p,'/api/v1/normalization/records/units/save');assert.equal(body.review_token,'parent-token-'+revision);
    assert.equal(body.values.notes,'Saved posting notes NEW '+(revision+1));revision++;
    return route.fulfill({json:posting()});
   }
   if(p==='/api/v1/admin/members')return route.fulfill({json:[member]});
   if(p==='/api/v1/normalization/units')return route.fulfill({json:[unit]});
   if(p.startsWith('/api/v1/normalization/catalog/')){const key=p.endsWith('/posting_type')?'2ND_CALL':'approved';return route.fulfill({json:[{key,label:key,active:true}]});}
   if(p==='/api/v1/normalization/records/units/parent-posting')return route.fulfill({json:posting()});
   if(p==='/api/v1/admin/member-workspace/parent-person')return route.fulfill({json:{member,impact:{}}});
   if(p.startsWith('/api/v1/admin/member-workspace/parent-person/')){
    profileReads++;
    if(scenario==='profile-read-failure'&&revision&&!profileFailed){profileFailed=true;return route.fulfill({status:503,json:{detail:'Confirmed save; profile read unavailable'}});}
    return route.fulfill({json:{rows:p.endsWith('/postings')?[{...posting(),unit:unit.name}]:[]}});
   }
   if(p==='/api/v1/unit-management/month'){
    unitReads++;const value=unitData(u.searchParams.get('month'));
    if(holdNextParent){holdNextParent=false;started();await gate;}
    return route.fulfill({json:value});
   }
   return route.fulfill({response:await route.fetch({url:api+p+u.search,maxRetries:2})});
  });
  try{
   await page.goto(base+'/#view=units',{waitUntil:'domcontentloaded'});
   await page.locator('input[data-unit-board-search]').fill('Royal');
   await page.locator('[data-unit-board-card="unit:parent-unit"] button[data-open-unit-modal]').click();
   const parent=page.locator('#unit-management-modal');
   await parent.locator('#unit-minimum-free-people').fill('3');
   await parent.locator('#unit-settings-form').evaluate(e=>{window.__parentOwnerForm=e;window.__parentOwnerInput=e.querySelector('#unit-minimum-free-people');});
   await parent.locator('[data-open-member="parent-person"]').click();
   const profile=page.getByRole('dialog',{name:'Member profile',exact:true}),beforeReads=unitReads;
   const save=async()=>{
    await profile.locator('[data-edit-record="parent-posting"]').click();
    const editor=page.getByRole('dialog',{name:'Edit posting',exact:true});
    await editor.locator('[name=notes]').fill('Saved posting notes NEW '+(revision+1));
    await editor.getByRole('button',{name:'Review changes',exact:true}).click();
    await editor.locator('[data-save]:enabled').click();await editor.waitFor({state:'detached'});
    if(scenario==='profile-read-failure')await profile.getByRole('alert').filter({hasText:'Confirmed save; profile read unavailable'}).waitFor();
    else await profile.getByText('Saved posting notes NEW '+revision,{exact:true}).waitFor();
   };
   await save();
   if(scenario==='two-saves-coalesced')await save();
   assert.equal(unitReads,beforeReads,'Parent reads must defer while profile remains open');
   const hold=!['two-saves-coalesced','profile-read-failure'].includes(scenario);
   holdNextParent=hold;
   await profile.locator('[data-close]').first().click();await profile.waitFor({state:'detached'});
   const outcome={};
   if(hold)await held;
   if(scenario==='held-parent-new-draft'){
    await parent.locator('#unit-minimum-free-people').fill('4');await parent.locator('#unit-minimum-free-people').focus();
    release();await parent.getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();
    assert.equal(await parent.locator('#unit-minimum-free-people').inputValue(),'4');
    assert.equal(await parent.locator('#unit-settings-form').evaluate(e=>e===window.__parentOwnerForm&&e.querySelector('#unit-minimum-free-people')===window.__parentOwnerInput),true);
    assert.equal(await parent.locator('#unit-minimum-free-people').evaluate(e=>e===document.activeElement),true);
    assert.match(await parent.locator('[data-unit-row-form="parent-posting"]').innerText(),/Saved posting notes NEW 1/);
    outcome.newerDraftAndFocusPreserved=true;
   }else if(scenario==='route-away-return'){
    await page.evaluate(()=>location.hash='#view=user-guide');await page.locator('#guide-checklist').waitFor();
    release();await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('[data-profile-parent-refresh]').count(),0);
    assert.equal(await page.locator('#unit-management-modal').count(),0);
    await page.evaluate(()=>location.hash='#view=units');await page.locator('#unit-management-modal [data-unit-row-form="parent-posting"]').waitFor();
    assert.match(await page.locator('[data-unit-row-form="parent-posting"]').innerText(),/Saved posting notes NEW 1/);
    assert.equal(unitReads,beforeReads+2);outcome.oldReadCannotRepaintAwayView=true;outcome.returnReadsFresh=true;
   }else if(scenario==='month-supersession'){
    // Programmatic change dispatch deliberately models a month change racing the held parent GET.
    await page.evaluate(()=>{const input=document.querySelector('#working-month');input.value='2026-12';input.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.waitForFunction(()=>document.querySelector('#working-month')?.value==='2026-12'&&document.querySelector('[data-unit-board-card="unit:parent-unit"]'));
    release();await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('#working-month').inputValue(),'2026-12');
    assert.equal(await page.locator('[data-profile-parent-refresh]').count(),0);
    assert.equal(unitReads,beforeReads+2);outcome.oldMonthCannotRestoreNoticeOrMonth=true;
   }else if(scenario==='signout'){
    await page.evaluate(()=>{localStorage.removeItem('duty_rota_auth_token');window.dispatchEvent(new StorageEvent('storage',{key:'duty_rota_auth_token',oldValue:'profile-parent-owner',newValue:null}));});
    await page.locator('#workflow-tracker').waitFor({state:'detached'});release();await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('[data-profile-parent-refresh],#unit-management-modal,[data-unit-row-form="parent-posting"]').count(),0);
    assert.equal(unitReads,beforeReads+1);outcome.noLatePrivateParentAfterSignout=true;
   }else{
    await parent.getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();
    assert.match(await parent.locator('[data-unit-row-form="parent-posting"]').innerText(),new RegExp('Saved posting notes NEW '+revision));
    assert.equal(await parent.locator('#unit-minimum-free-people').inputValue(),'3');
    assert.equal(unitReads,beforeReads+1);outcome.exactlyOneDeferredParentRead=true;
    if(scenario==='profile-read-failure'){assert.equal(profileFailed,true);outcome.confirmedSaveSurvivesProfileReadFailure=true;}
    else{assert.equal(revision,2);outcome.twoConfirmedChangesCoalesced=true;}
   }
   const saves=writes.filter(w=>w.path.endsWith('/save'));
   assert.equal(saves.length,scenario==='two-saves-coalesced'?2:1);
   assert.equal(writes.length,saves.length*2);assert.deepEqual(errors,[]);
   results.push({engine,width,scenario,beforeReads,unitReads,profileReads,revision,...outcome,allWritesLocallyFulfilled:true,writes,requests,errors});
   console.log(engine,width,scenario,'owner/coalescing assertions passed');
  }finally{release();await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
for(const[p,digest]of Object.entries(candidateHashes))assert.equal(sha(await readFile(p)),digest);
await writeFile('../docs/premium-ui/qa-profile-parent-v4-owner-coalescing-r1.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/stage161_final_review',harness_revision:'R1 preserves original first-run timeout diagnostic; returning to Units restores the selected-unit modal automatically, so await that existing restored modal rather than click its obscured Manage control.',scope:'36 scratch browser contexts: three engines at320/1280, six Units-parent posting-edit ownership/coalescing cases. Route away and fresh return; programmatically dispatched month race; sign-out; newer parent settings input/focus while GET held; two confirmed posting saves before final close coalesce to one parent GET; confirmed save followed by profile read failure still refreshes parent. Every POST is locally fulfilled with exact identity/review token assertions. No forwarded writes, production operations, whole159 acceptance or Leave-parent ownership coverage claim.',source_sha256:initial,candidate_sha256:candidateHashes,preview_integrity:previewIntegrity,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');
