import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),paths=['src/main.ts','src/member-workspace.ts','src/record-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes(),results=[];
assert.equal(initial['frontend/src/main.ts'],'5311e9933a6614747458418a218ac2b22855c2f7baa574e446557a4aa6d9d13d');
const candidatePaths=['../tmp/profile-parent-refresh-v4/main.ts','../tmp/profile-parent-refresh-v4/member-workspace.ts'];
const candidateHashes=Object.fromEntries(await Promise.all(candidatePaths.map(async p=>[p,sha(await readFile(p))])));
assert.equal(candidateHashes[candidatePaths[0]],'355e71753eb79135d4bdefb94837da4fc1ff727b12a2ed1f9c4bdb4b5d744a07');
const served=await (await fetch('http://127.0.0.1:5292/src/main.ts')).text();
const encoded=served.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(encoded,'Vite inline source map required');
const mapped=JSON.parse(Buffer.from(encoded[1],'base64').toString());assert.equal(sha(Buffer.from(mapped.sourcesContent[0])),candidateHashes[candidatePaths[0]],'Exact scratch main served');
const member={id:'parent-person',canonical_name:'Dr Parent Audit',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]};
const unit={id:'parent-unit',name:'Royal Parent Unit',campus:'Main',code:'PARENT',minimum_free_people:1,active_status:'active',notes:null};
for(const [engine,launcher] of Object.entries({chromium,firefox,webkit}))for(const width of[320,1280])for(const scenario of['posting-edit']){
 const browser=await launcher.launch(),page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],requests=[],writes=[];let saved=false,unitReads=0,leaveReads=0,profileReads=0;
 const posting=()=>({id:'parent-posting',person:member,person_id:member.id,unit,unit_id:unit.id,posting_type:'2ND_CALL',starts_on:'2026-11-01',ends_on:'2026-11-30',source:'manual',notes:saved?'Saved posting notes NEW':'Saved posting notes OLD'});
 const leave=()=>({id:'parent-leave',person:member,person_id:member.id,leave_type:'ANNUAL_LEAVE',type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',slot:'FULL_DAY',starts_on:'2026-11-05',ends_on:'2026-11-05',status:saved?'cancelled':'approved',days:1,source:'manual',raw_person_name:null,notes:'Parent leave target'});
 const unitData=()=>({month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',units:[unit],assignments:[posting()],unit_summaries:[{unit_id:unit.id,assigned_members:1,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[{unit_id:unit.id,call_level:'2ND_CALL',assigned_members:1,minimum_free_people:1,max_allowed:1}],validation_issues:[]});
 page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','profile-parent-independent');localStorage.setItem('duty_rota_working_month','2026-11');});
 await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url()),p=u.pathname;requests.push({method:q.method(),path:p});
  if(q.method()!=='GET'){
   writes.push({method:q.method(),path:p,body:q.postDataJSON()});assert.equal(q.method(),'POST');
   if(p==='/api/v1/normalization/records/units/preview'){assert.equal(q.postDataJSON().identity,'parent-posting');return route.fulfill({json:{review_token:'parent-token',before:posting(),after:q.postDataJSON().values,availability:'Fixture reviewed',duties:[]}});}
   if(p==='/api/v1/normalization/records/units/save'){assert.equal(q.postDataJSON().identity,'parent-posting');assert.equal(q.postDataJSON().review_token,'parent-token');assert.equal(q.postDataJSON().values.notes,'Saved posting notes NEW');saved=true;return route.fulfill({json:posting()});}
   assert.equal(p,'/api/v1/leave/requests/parent-leave/cancel');saved=true;return route.fulfill({json:leave()});
  }
  if(p==='/api/v1/admin/members')return route.fulfill({json:[member]});
  if(p==='/api/v1/normalization/units')return route.fulfill({json:[unit]});
  if(p.startsWith('/api/v1/normalization/catalog/')){const kind=p.split('/').at(-1),key={posting_type:'2ND_CALL',leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',leave_status:'approved'}[kind];return route.fulfill({json:[{key,label:key,active:true}]});}
  if(p==='/api/v1/normalization/records/units/parent-posting')return route.fulfill({json:posting()});
  if(p==='/api/v1/admin/member-workspace/parent-person')return route.fulfill({json:{member,impact:{}}});
  if(p.startsWith('/api/v1/admin/member-workspace/parent-person/')){profileReads++;return route.fulfill({json:{rows:p.endsWith('/postings')?[{...posting(),unit:unit.name}]:p.endsWith('/leave')?[leave()]:[]}});}
  if(p==='/api/v1/unit-management/month'){unitReads++;return route.fulfill({json:unitData()});}
  if(p==='/api/v1/leave/requests'){leaveReads++;return route.fulfill({json:[leave()]});}
  if(p==='/api/v1/leave/calendar')return route.fulfill({json:{month:'2026-11',summary:{month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',total_requests:1,blocking_requests:saved?0:1,people_on_leave:saved?0:1,total_leave_days:saved?0:1,busiest_day:null,status_counts:{},type_counts:{},slot_counts:{},unit_counts:{},call_level_counts:{}},days:{}}});
  if(p==='/api/v1/leave/pressure')return route.fulfill({json:{month:'2026-11',days:[],call_level_totals:{},unit_totals:{}}});
  return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+p+u.search,maxRetries:2})});
 });
 try{
  await page.goto('http://127.0.0.1:5292/#view='+(scenario==='posting-edit'?'units':'leave'),{waitUntil:'domcontentloaded'});
  let parent,readsBefore;
  if(scenario==='posting-edit'){
   await page.locator('input[data-unit-board-search]').fill('Royal');await page.locator('[data-unit-board-card="unit:parent-unit"] button[data-open-unit-modal]').click();
   parent=page.locator('#unit-management-modal');await parent.locator('#unit-minimum-free-people').fill('3');await parent.locator('#unit-settings-form').evaluate(e=>{window.__parentForm=e;window.__parentInput=e.querySelector('#unit-minimum-free-people');});
   await parent.locator('[data-edit-operational-record="parent-posting"]').click();readsBefore=unitReads;
  }else{
   await page.locator('[data-leave-calendar-view="list"]').click();
   parent=width===320?page.locator('.card-list[aria-label="Leave this month"]:visible'):page.locator('section[aria-labelledby="leave-list-title"]:visible');
   await parent.locator('[data-open-member="parent-person"]').click();readsBefore=leaveReads;
  }
  const editor=page.getByRole('dialog',{name:'Edit posting',exact:true});
  await editor.locator('[name=notes]').fill('Saved posting notes NEW');
  await editor.getByRole('button',{name:'Review changes',exact:true}).click();
  await editor.locator('[data-save]:enabled').click();await editor.waitFor({state:'detached'});
  assert.equal(await page.locator('#working-month').inputValue(),'2026-11');assert.deepEqual(errors,[]);
  await parent.locator('[data-unit-row-form="parent-posting"]').getByText('Saved posting notes NEW',{exact:true}).waitFor();
  let freshText;
  if(scenario==='posting-edit'){
   freshText=await parent.locator('[data-unit-row-form="parent-posting"]').innerText();assert.match(freshText,/Saved posting notes NEW/);assert.doesNotMatch(freshText,/Saved posting notes OLD/);assert.equal(unitReads,readsBefore+1);
   assert.equal(await parent.locator('#unit-minimum-free-people').inputValue(),'3');assert.equal(await parent.locator('#unit-settings-form').evaluate(e=>e===window.__parentForm&&e.querySelector('#unit-minimum-free-people')===window.__parentInput),true);
   assert.equal(await parent.locator('[data-profile-parent-refresh]').count(),0);await parent.locator('[data-close-unit-modal]').click();assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Royal');
  }else{
   freshText=await parent.innerText();assert.match(freshText,/Cancelled/);assert.doesNotMatch(freshText,/Approved/);assert.equal(leaveReads,readsBefore+1);assert.equal(await page.locator('[data-leave-calendar-view="list"]').getAttribute('aria-pressed'),'true');
  }
  assert.equal(writes.filter(w=>!w.path.endsWith('/preview')).length,1);assert.equal(profileReads,0);assert.deepEqual(errors,[]);
  results.push({engine,width,scenario,passed:true,parentFreshAfterDirectEditorSave:true,freshText,readsBefore,readsAfterParentRefresh:scenario==='posting-edit'?unitReads:leaveReads,profileReads,selectedMonthRetained:true,unrelatedDraftOrViewRetained:true,deferredOwnedParentRead:true,writes,requests,errors});console.log(width+' '+scenario+' parent fresh after profile close');
 }catch(error){
  const observed=await page.evaluate(()=>({fallback:document.querySelector('#unit-minimum-free-people')?.value,formRetained:document.querySelector('#unit-settings-form')===window.__parentForm,inputRetained:document.querySelector('#unit-minimum-free-people')===window.__parentInput,search:document.querySelector('input[data-unit-board-search]')?.value,unitModalPresent:Boolean(document.querySelector('#unit-management-modal'))})).catch(()=>null);
  results.push({engine,width,scenario,passed:false,assertion:error.message,observed,unitReads,leaveReads,profileReads,writes,requests,errors});console.log(`${engine} ${width} direct posting edit diagnostic failed: ${error.message}`);
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
}
assert.deepEqual(await hashes(),initial);for(const p of candidatePaths)assert.equal(sha(await readFile(p)),candidateHashes[p]);
const failed=results.filter(r=>!r.passed);
await writeFile('../docs/premium-ui/qa-original159-direct-posting-draft-v4-diagnostic.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/profile_parent_final_audit',decision:failed.length?'Expected-correct diagnostic exposes unresolved direct posting parent-refresh failures':'Six bounded direct-posting draft-retention contexts passed',scope:'Six scratch contexts, three engines320/1280, existing Unit modal draft fallback3/server1, direct existing posting editor saves notes and refreshes dependent parent. Requires retained draft/control identities and chosen Royal filter; does not accept whole159. Local fulfilled preview/save only. Per-context failures retained.',source_sha256:initial,candidate_sha256:candidateHashes,test_sha256:sha(await readFile(new URL(import.meta.url))),expected_contexts:6,failed_contexts:failed.length,results},null,2)+'\n');
assert.equal(results.length,6);assert.equal(failed.length,0,'Direct posting mutation must preserve unrelated settings draft and controls');
console.log('Original159 direct posting draft6contexts passed');
