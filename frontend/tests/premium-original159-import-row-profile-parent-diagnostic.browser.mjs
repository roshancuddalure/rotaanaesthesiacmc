// Source-risk diagnostic only; root coordinates execution. Run from frontend.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),base='http://127.0.0.1:5197',api='http://127.0.0.1:8031';
const report='../docs/premium-ui/qa-original159-import-row-profile-parent-diagnostic.json';
await assert.rejects(access(report),{code:'ENOENT'});
const held=JSON.parse(await readFile('../docs/premium-ui/reviews/original159-nested-reference-v13r1-held-sources.json','utf8')).source_sha256;
for(const[path,h]of Object.entries(held)){
 assert.equal(sha(await readFile('../'+path)),h,'Applied source '+path);
 const name=path.slice('frontend/src/'.length),res=await fetch(base+'/src/'+name);assert.equal(res.status,200);
 const m=(await res.text()).match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(m);
 assert.ok(JSON.parse(Buffer.from(m[1],'base64').toString()).sourcesContent.some(s=>sha(s)===h),'Exact applied '+path);
}
const originalMember={id:'row-profile-person',canonical_name:'Dr Row Original OLD',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[]};
const originalUnit={id:'row-profile-unit',name:'Royal Row Profile Unit',campus:'Main',code:'RP',minimum_free_people:1,active_status:'active',notes:null};
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of[320,1280])for(const scenario of['core-save','posting-save']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(15000);
  const requests=[],writes=[],errors=[],prompts=[];let saved=false,unitReads=0,fbReads=0;
  const member=()=>({...originalMember,canonical_name:saved&&scenario==='core-save'?'Dr Row Renamed NEW':originalMember.canonical_name});
  const units=()=>[originalUnit,{...originalUnit,id:'row-profile-b',name:'Royal Row B',code:'RB'},{...originalUnit,id:'row-profile-c',name:'Royal Row C',code:'RC'}];
  const posting=()=>({id:'row-profile-posting',person:member(),person_id:member().id,unit:originalUnit,unit_id:originalUnit.id,posting_type:'2ND_CALL',starts_on:'2026-11-01',ends_on:'2026-11-30',source:'manual',notes:saved&&scenario==='posting-save'?'Row profile posting NEW':'Row profile posting OLD'});
  const previewRow=()=>({key:'Sheet:2',source:{sheet:'Sheet',row:2},original:{member_name:'Dr Row Typo'},values:{member_name:'Dr Row Typo',unit_name:originalUnit.name,posting_type:'2ND_CALL',starts_on:'2026-11-03',ends_on:'2026-11-05'},after:{unit_id:originalUnit.id,posting_type:'2ND_CALL',starts_on:'2026-11-03',ends_on:'2026-11-05'},action:'needs_review',issues:['Review candidate identity.'],warnings:[],person_match:{state:'unmatched',status:'unmatched',reason:'Candidate needs an explicit choice.',candidates:[{id:member().id,name:member().canonical_name,status:'active',call_level:'2ND_CALL',designation:null}],warnings:[]},unit_match:{state:'matched',name:originalUnit.name}});
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{prompts.push(d.message());return d.accept();});
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','row-profile-local');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),url=new URL(q.url()),p=url.pathname;requests.push({method:q.method(),path:p,search:url.search});
   if(q.method()!=='GET'){
    const body=p.includes('/import-review/')?undefined:q.postDataJSON();writes.push({method:q.method(),path:p,body});
    if(q.method()==='POST'&&p==='/api/v1/import-review/columns')return route.fulfill({json:{headers:['member_name'],fields:['member_name'],suggested:{member_name:'member_name'}}});
    if(q.method()==='POST'&&p==='/api/v1/import-review/units/preview')return route.fulfill({json:{id:'row-profile-preview',kind:'units',month:'2026-11',mode:'append',headers:['member_name'],fields:['member_name'],rows:[previewRow()],replacement_scope:[]}});
    if(scenario==='core-save'&&q.method()==='PUT'&&p==='/api/v1/admin/member-workspace/row-profile-person'&&!saved){
     assert.equal(body.canonical_name,'Dr Row Renamed NEW');assert.equal(body.preserve_previous_name,true);saved=true;return route.fulfill({json:member()});
    }
    if(scenario==='posting-save'&&q.method()==='POST'&&p==='/api/v1/normalization/records/units/preview'){
     assert.equal(body.identity,'row-profile-posting');assert.equal(body.values.notes,'Row profile posting NEW');return route.fulfill({json:{review_token:'row-profile-token',before:posting(),after:body.values,availability:'Fixture reviewed',duties:[]}});
    }
    if(scenario==='posting-save'&&q.method()==='POST'&&p==='/api/v1/normalization/records/units/save'&&!saved){
     assert.equal(body.identity,'row-profile-posting');assert.equal(body.review_token,'row-profile-token');assert.equal(body.values.notes,'Row profile posting NEW');saved=true;return route.fulfill({json:posting()});
    }
    return route.fulfill({status:500,json:{detail:'Diagnostic rejects Apply, fallback save and unexpected mutation'}});
   }
   if(p==='/api/v1/admin/members')return route.fulfill({json:[member()]});
   if(p==='/api/v1/normalization/units')return route.fulfill({json:units()});
   if(p.startsWith('/api/v1/normalization/catalog/'))return route.fulfill({json:[{key:'2ND_CALL',label:'2nd Call',active:true}]});
   if(p==='/api/v1/normalization/records/units/row-profile-posting')return route.fulfill({json:posting()});
   if(p==='/api/v1/admin/member-workspace/row-profile-person')return route.fulfill({json:{member:member(),impact:{}}});
   if(p.startsWith('/api/v1/admin/member-workspace/row-profile-person/'))return route.fulfill({json:{rows:p.endsWith('/postings')?[{...posting(),unit:originalUnit.name}]:[]}});
   if(p==='/api/v1/extra-duty/unit-fallbacks'){
    fbReads++;return route.fulfill({json:units().map(u=>({unit_id:u.id,unit_name:u.name,fallbacks:u.id===originalUnit.id?units().slice(1).map(t=>({unit_id:t.id,unit_name:t.name})):[]}))});
   }
   if(p==='/api/v1/unit-management/month'){
    unitReads++;return route.fulfill({json:{month:url.searchParams.get('month'),starts_on:'2026-11-01',ends_on:'2026-11-30',units:units(),assignments:[posting()],unit_summaries:units().map(u=>({unit_id:u.id,assigned_members:u.id===originalUnit.id?1:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]}});
   }
   return route.fulfill({response:await route.fetch({url:api+p+url.search,maxRetries:2})});
  });
  let before;
  try{
   await page.goto(base+'/#view=units',{waitUntil:'domcontentloaded'});
   const fallback=page.locator('[data-fallback-unit="row-profile-unit"]');await fallback.locator('summary').click();await fallback.locator('[data-fb-up="row-profile-c"]').click();
   await page.locator('#unit-fallbacks-host').evaluate(e=>{window.__rowProfileHost=e;window.__rowProfileFallback=e.querySelector('[data-fallback-unit="row-profile-unit"]');});
   await page.locator('input[data-unit-board-search]').fill('Royal');await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');before={unitReads,fbReads};
   await page.locator('[data-open-normalized-import="units"]').click();const importer=page.locator('dialog.operational-import');
   await importer.locator('input[type=file]').setInputFiles({name:'row-profile.csv',mimeType:'text/csv',buffer:Buffer.from('member_name\nDr Row Typo\n')});await importer.locator('[data-map]').first().waitFor({state:'attached'});
   await importer.getByRole('button',{name:'Preview and normalize',exact:true}).click();
   const row=importer.locator('[data-review-row="Sheet:2"]');await row.waitFor();await row.locator('details.import-row__edit > summary').click();
   // Deliberately the direct row-candidate action, never Create member's lookup.
   await row.locator('[data-review-candidate="row-profile-person"]').click();
   const profile=page.getByRole('dialog',{name:'Member profile',exact:true});
   if(scenario==='core-save'){
    await profile.locator('[data-edit]').click();await profile.locator('[data-field="canonical_name"]').fill('Dr Row Renamed NEW');await profile.getByRole('button',{name:'Save changes',exact:true}).click();await profile.locator('[data-edit]').waitFor();
    assert.equal(await profile.locator('[data-field="canonical_name"]').inputValue(),'Dr Row Renamed NEW');
   }else{
    await profile.locator('[data-tab="postings"]').click();await profile.locator('[data-edit-record="row-profile-posting"]').click();
    const editor=page.getByRole('dialog',{name:'Edit posting',exact:true});await editor.locator('[name=notes]').fill('Row profile posting NEW');await editor.getByRole('button',{name:'Review changes',exact:true}).click();await editor.locator('[data-save]:enabled').click();await editor.waitFor({state:'detached'});await profile.getByText('Row profile posting NEW',{exact:true}).waitFor();
   }
   assert.equal(saved,true);assert.equal(unitReads,before.unitReads,'No parent refresh before outer importer closes');
   await profile.locator('header [data-close]').click();await profile.waitFor({state:'detached'});
   assert.equal(await importer.locator('input[type=file]').evaluate(e=>e.files[0]?.name),'row-profile.csv');
   await importer.locator('header [data-close]').click();await importer.waitFor({state:'detached'});await page.waitForLoadState('networkidle');
   const observed={parentReads:unitReads-before.unitReads,fallbackReads:fbReads-before.fbReads,parentNames:await page.locator('[data-open-member="row-profile-person"]').allTextContents(),fallbackRetained:await page.locator('#unit-fallbacks-host').evaluate(e=>e===window.__rowProfileHost&&e.querySelector('[data-fallback-unit="row-profile-unit"]')===window.__rowProfileFallback),fallbackOrder:await fallback.locator('[data-fallback-item]').evaluateAll(es=>es.map(e=>e.dataset.fallbackItem)),search:await page.locator('input[data-unit-board-search]').inputValue(),campus:await page.locator('select[data-unit-board-campus]').inputValue()};
   assert.equal(observed.fallbackRetained,true);assert.deepEqual(observed.fallbackOrder,['row-profile-c','row-profile-b']);assert.equal(await fallback.locator('[data-fb-save]').isEnabled(),true);assert.equal(observed.search,'Royal');assert.equal(observed.campus,'campus:Main');assert.equal(observed.fallbackReads,0);
   assert.equal(writes.filter(w=>!w.path.includes('/import-review/')&&!w.path.endsWith('/preview')).length,1);assert.equal(writes.filter(w=>/\/apply$|\/extra-duty\//.test(w.path)).length,0);assert.deepEqual(errors,[]);
   if(scenario==='core-save')assert.ok(observed.parentNames.some(n=>n.includes('Dr Row Renamed NEW')),JSON.stringify(observed));
   assert.equal(observed.parentReads,1,JSON.stringify(observed));
   if(scenario==='posting-save'){
    await page.locator('[data-unit-board-card="unit:row-profile-unit"] button[data-open-unit-modal]').click();assert.match(await page.locator('[data-unit-row-form="row-profile-posting"]').innerText(),/Row profile posting NEW/);
   }
   results.push({engine,width,scenario,passed:true,observed,writes,requests,prompts,errors});
  }catch(error){results.push({engine,width,scenario,passed:false,assertion:error.message,saved,reads:{unitReads,fbReads},before,observed:{parentNames:await page.locator('[data-open-member="row-profile-person"]').allTextContents(),profileCount:await page.locator('dialog.member-workspace').count(),importerCount:await page.locator('dialog.operational-import').count()},writes,requests,prompts,errors});}
  finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
for(const[path,h]of Object.entries(held))assert.equal(sha(await readFile('../'+path)),h,'Held source unchanged');
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/nestedreference159_groundwork',scope:'12 expected-correct applied-source diagnostic contexts: direct import row data-review-candidate profile action, core or posting Save, close profile then discard importer without Apply. Separate from Create member lookup Review/restore. All mutations local, only unhandled GETs RAM8031. No recovery/ownership/physical/nativeAT or whole159 acceptance.',source_sha256:held,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');
assert.equal(results.length,12);assert.equal(results.filter(r=>!r.passed).length,0,'Direct import row-profile accepted mutations must refresh parent after final no-Apply discard');
