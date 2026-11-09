import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const base='http://127.0.0.1:5293',api='http://127.0.0.1:8031';
const paths=['src/main.ts','src/member-workspace.ts','src/record-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))])));
const initial=await hashes(),candidatePaths=['../tmp/profile-parent-refresh-v5/main.ts','../tmp/profile-parent-refresh-v5/member-workspace.ts'];
assert.equal(initial['frontend/src/main.ts'],'5311e9933a6614747458418a218ac2b22855c2f7baa574e446557a4aa6d9d13d');
const candidateHashes=Object.fromEntries(await Promise.all(candidatePaths.map(async p=>[p,sha(await readFile(p))])));
assert.equal(candidateHashes[candidatePaths[0]],'2b8f68c069e599af50a4ac1b2146a7018d6268f290b90a9949130a057dc91b43');
assert.equal(candidateHashes[candidatePaths[1]],'105cc1d91ea4815d565ad4859fc01412cf576a3203c07834f4010e3fef7ef1a5');
const previewIntegrity=[];
for(const[i,name]of ['main.ts','member-workspace.ts'].entries()){
 const response=await fetch(base+'/src/'+name);assert.equal(response.status,200);
 const text=await response.text(),match=text.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(match);
 const map=JSON.parse(Buffer.from(match[1],'base64').toString('utf8'));
 assert.ok(map.sourcesContent?.some(source=>typeof source==='string'&&sha(source)===candidateHashes[candidatePaths[i]]));
 previewIntegrity.push({name,sha256:candidateHashes[candidatePaths[i]]});
}
const first={id:'parent-person',canonical_name:'Dr Parent Audit',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
const second={...first,id:'replacement-person',canonical_name:'Dr Zed Replacement'};
const unit={id:'parent-unit',name:'Royal Parent Unit',campus:'Main',code:'PARENT',minimum_free_people:1,active_status:'active',notes:null};
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of[320,1280])for(const scenario of['next-final-close','next-initial503-retry-final-close']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],requests=[],writes=[];
  let saved=false,unitReads=0,firstIdentityReads=0,secondIdentityReads=0,profilePostingsReads=0;
  const posting=()=>({id:'parent-posting',person:first,person_id:first.id,unit,unit_id:unit.id,posting_type:'2ND_CALL',starts_on:'2026-11-01',ends_on:'2026-11-30',source:'manual',notes:saved?'Saved posting notes NEW':'Saved posting notes OLD'});
  const unitData=()=>({month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',units:[unit],assignments:[posting()],unit_summaries:[{unit_id:unit.id,assigned_members:1,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[],validation_issues:[]});
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','profile-replacement-audit');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url()),p=u.pathname;requests.push({method:q.method(),path:p,search:u.search});
   if(q.method()!=='GET'){
    const body=q.postDataJSON();writes.push({method:q.method(),path:p,body});assert.equal(q.method(),'POST');assert.equal(body.identity,'parent-posting');assert.equal(body.values.person_id,first.id);
    if(p==='/api/v1/normalization/records/units/preview')return route.fulfill({json:{review_token:'replacement-review-token',before:posting(),after:body.values,availability:'Fixture reviewed',duties:[]}});
    assert.equal(p,'/api/v1/normalization/records/units/save');assert.equal(body.review_token,'replacement-review-token');assert.equal(body.values.notes,'Saved posting notes NEW');assert.equal(saved,false);
    saved=true;return route.fulfill({json:posting()});
   }
   if(p==='/api/v1/admin/members')return route.fulfill({json:[first,second]});
   if(p==='/api/v1/normalization/units')return route.fulfill({json:[unit]});
   if(p.startsWith('/api/v1/normalization/catalog/'))return route.fulfill({json:[{key:'2ND_CALL',label:'2ND_CALL',active:true}]});
   if(p==='/api/v1/normalization/records/units/parent-posting')return route.fulfill({json:posting()});
   if(p==='/api/v1/admin/member-workspace/'+first.id){firstIdentityReads++;return route.fulfill({json:{member:first,impact:{}}});}
   if(p==='/api/v1/admin/member-workspace/'+second.id){
    secondIdentityReads++;
    if(scenario==='next-initial503-retry-final-close'&&secondIdentityReads===1)return route.fulfill({status:503,json:{detail:'Replacement identity temporarily unavailable'}});
    return route.fulfill({json:{member:second,impact:{}}});
   }
   if(p.startsWith('/api/v1/admin/member-workspace/'+first.id+'/')){if(p.endsWith('/postings'))profilePostingsReads++;return route.fulfill({json:{rows:p.endsWith('/postings')?[{...posting(),unit:unit.name}]:[]}});}
   if(p.startsWith('/api/v1/admin/member-workspace/'+second.id+'/'))return route.fulfill({json:{rows:[]}});
   if(p==='/api/v1/unit-management/month'){unitReads++;return route.fulfill({json:unitData()});}
   return route.fulfill({response:await route.fetch({url:api+p+u.search,maxRetries:2})});
  });
  try{
   await page.goto(base+'/#view=units',{waitUntil:'domcontentloaded'});
   await page.locator('[data-unit-board-card="unit:parent-unit"] button[data-open-unit-modal]').click();
   const parent=page.locator('#unit-management-modal');await parent.locator('#unit-minimum-free-people').fill('3');
   await parent.locator('#unit-settings-form').evaluate(e=>{window.__replacementParentForm=e;window.__replacementParentInput=e.querySelector('#unit-minimum-free-people');});
   await parent.locator('[data-open-member="parent-person"]').click();
   let profile=page.getByRole('dialog',{name:'Member profile',exact:true});
   await profile.locator('[data-member-identity]').filter({hasText:first.canonical_name}).waitFor();
   assert.equal(await profile.locator('[data-next]').isEnabled(),true,'Actual filtered member navigation contains both returned members');
   assert.equal(await profile.locator('[data-prev]').isDisabled(),true);
   const beforeReads=unitReads;
   await profile.locator('[data-edit-record="parent-posting"]').click();
   const editor=page.getByRole('dialog',{name:'Edit posting',exact:true});await editor.locator('[name=notes]').fill('Saved posting notes NEW');
   await editor.getByRole('button',{name:'Review changes',exact:true}).click();await editor.locator('[data-save]:enabled').click();await editor.waitFor({state:'detached'});
   await profile.getByText('Saved posting notes NEW',{exact:true}).waitFor();
   assert.equal(unitReads,beforeReads,'Confirmed operation must defer parent read while original profile remains open');
   await profile.locator('[data-next]').click();
   if(scenario==='next-initial503-retry-final-close'){
    profile=page.getByRole('dialog',{name:'Member profile',exact:true});
    await profile.getByRole('alert').filter({hasText:'Replacement identity temporarily unavailable'}).waitFor();
    assert.equal(unitReads,beforeReads,'Closing the first profile for Next must not trigger parent read, even when replacement initial GET fails');
    assert.match(await parent.locator('[data-unit-row-form="parent-posting"]').innerText(),/Saved posting notes OLD/);
    assert.equal(writes.filter(w=>w.path.endsWith('/save')).length,1);
    await profile.locator('[data-load-retry]').focus();await page.keyboard.press('Enter');
   }
   profile=page.getByRole('dialog',{name:'Member profile',exact:true});
   await profile.locator('[data-member-identity]').filter({hasText:second.canonical_name}).waitFor();
   assert.equal(await profile.locator('[data-next]').isDisabled(),true);assert.equal(await profile.locator('[data-prev]').isEnabled(),true);
   assert.equal(unitReads,beforeReads,'Next and explicit initial-load Retry are replacement closes, not the final profile close');
   assert.match(await parent.locator('[data-unit-row-form="parent-posting"]').innerText(),/Saved posting notes OLD/);
   assert.equal(writes.length,2,'Only the original review and original accepted save; replacements send reads');
   await profile.locator('[data-close]').click();await profile.waitFor({state:'detached'});
   await parent.getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();
   assert.match(await parent.locator('[data-unit-row-form="parent-posting"]').innerText(),/Saved posting notes NEW/);
   assert.equal(unitReads,beforeReads+1,'One deferred parent GET after final close, with native close notification deduplicated');
   assert.equal(await parent.locator('#unit-minimum-free-people').inputValue(),'3');
   assert.equal(await parent.locator('#unit-settings-form').evaluate(e=>e===window.__replacementParentForm&&e.querySelector('#unit-minimum-free-people')===window.__replacementParentInput),true);
   assert.equal(firstIdentityReads,1);assert.equal(secondIdentityReads,scenario==='next-initial503-retry-final-close'?2:1);assert.equal(profilePostingsReads,2);assert.equal(writes.length,2);assert.deepEqual(errors,[]);
   results.push({engine,width,scenario,beforeReads,unitReads,firstIdentityReads,secondIdentityReads,profilePostingsReads,oneFinalDeferredParentRead:true,noPrematureReplacementCloseRead:true,retainedDraftAndFormIdentity:true,noSaveReplay:true,writes,requests,errors});
   console.log(engine,width,scenario,'profile replacement lifecycle passed');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.equal(results.length,12);assert.deepEqual(await hashes(),initial);for(const[p,digest]of Object.entries(candidateHashes))assert.equal(sha(await readFile(p)),digest);
await writeFile('../docs/premium-ui/qa-profile-parent-v5-replacement-lifecycle.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/profile_payload_guard',scope:'12 scratch contexts across three engines320/1280: confirmed posting save, actual Next to second returned member, then final close; and Next replacement initial identity HTTP503 followed by keyboard initial-load Retry replacement, then final close. Assertions distinguish replacement closes from the single final deferred parent GET and preserve unrelated settings draft/form nodes. Actual controls/API paths only. Every review/save POST locally fulfilled; no production/backend writes or whole159 acceptance.',source_sha256:initial,candidate_sha256:candidateHashes,preview_integrity:previewIntegrity,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');
