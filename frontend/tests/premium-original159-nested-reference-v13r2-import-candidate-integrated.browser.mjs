// Candidate-only harness. Run sequentially from frontend; no production mutation.
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),base='http://127.0.0.1:5197',api='http://127.0.0.1:8031';
const report='../docs/premium-ui/qa-original159-nested-reference-v13r2-import-candidate-integrated.json';
await assert.rejects(access(report),{code:'ENOENT'});
const audit=JSON.parse(await readFile('../docs/premium-ui/reviews/original159-nested-reference-v13r2-integrated-held-sources.json','utf8'));
const manifest=JSON.parse(await readFile('../tmp/nested-reference-v13r2/manifest.json','utf8'));
const candidates=Object.fromEntries(manifest.files.map(f=>['frontend/src/'+f.file,f.candidate_sha256]));
for(const[path,expected]of Object.entries(audit.source_sha256)){
 assert.equal(sha(await readFile('../'+path)),expected,'Held applied source '+path);
 const name=path.slice('frontend/src/'.length),candidate=candidates[path];
 if(candidate)assert.equal(sha(await readFile('../tmp/nested-reference-v13r2/'+name)),candidate);
 const response=await fetch(base+'/src/'+name);assert.equal(response.status,200);
 const encoded=(await response.text()).match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(encoded);
 assert.ok(JSON.parse(Buffer.from(encoded[1],'base64').toString()).sourcesContent.some(s=>sha(s)===(candidate||expected)),'Exact candidate '+path);
}
const member={id:'nested-import-person',canonical_name:'Nested Existing Person',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[]};
const original={id:'nested-import-unit',name:'Royal Nested Import',campus:'Main',code:'NI',minimum_free_people:1,active_status:'active',aliases:[],notes:'',call_minimums:[],revision:'one',usage:{postings:0,duties:0,future_postings:0,future_duties:0,selected_members:0}};
const scenarios=['unit-create','unit-choices503','member-create','member-null','use-existing','cancel-unit','cancel-member'];
const results=[];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of[320,1280])for(const scenario of scenarios){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(15000);
  const requests=[],writes=[],errors=[],prompts=[];let createdUnit,createdMember,unitReads=0,fbReads=0,choiceFailure=false;
  const units=()=>[original,{...original,id:'nested-import-b',name:'Royal Import B',code:'IB'},{...original,id:'nested-import-c',name:'Royal Import C',code:'IC'},...(createdUnit?[createdUnit]:[])];
  const members=()=>[member,...(createdMember?[createdMember]:[])];
  const isUnit=scenario.includes('unit')||scenario==='unit-choices503';
  const row=()=>({key:'Sheet:2',source:{sheet:'Sheet',row:2},original:{member_name:'Nested New Person',unit_name:'Royal Nested New'},values:{member_name:'Nested New Person',unit_name:'Royal Nested New',posting_type:'2ND_CALL',starts_on:'2026-11-03',ends_on:'2026-11-05'},after:{person_id:isUnit?member.id:undefined,unit_id:isUnit?undefined:original.id,posting_type:'2ND_CALL',starts_on:'2026-11-03',ends_on:'2026-11-05'},action:'needs_review',issues:['Choose the unresolved identity or unit before applying.'],warnings:[],person_match:{state:isUnit?'matched':'unmatched',status:isUnit?'matched':'unmatched',person_id:isUnit?member.id:undefined,canonical_name:isUnit?member.canonical_name:undefined,method:isUnit?'member_id':undefined,candidates:[],warnings:[]},unit_match:{state:isUnit?'unmatched':'matched',name:isUnit?undefined:original.name}});
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{prompts.push(d.message());return d.accept();});
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','nested-import-local');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),url=new URL(q.url()),p=url.pathname;requests.push({method:q.method(),path:p,search:url.search});
   if(q.method()!=='GET'){
    writes.push({method:q.method(),path:p,body:p.includes('/import-review/')?undefined:q.postDataJSON()});
    if(q.method()==='POST'&&p==='/api/v1/import-review/columns')return route.fulfill({json:{headers:['member_name','unit_name'],fields:['member_name','unit_name'],suggested:{member_name:'member_name',unit_name:'unit_name'}}});
    if(q.method()==='POST'&&p==='/api/v1/import-review/units/preview')return route.fulfill({json:{id:'nested-preview',kind:'units',month:'2026-11',mode:'append',headers:['member_name','unit_name'],fields:['member_name','unit_name'],rows:[row()],replacement_scope:[]}});
    if(q.method()==='POST'&&p==='/api/v1/normalization/members/resolve')return route.fulfill({json:{candidates:scenario==='use-existing'?[{id:member.id,name:member.canonical_name,status:'active',call_level:'2ND_CALL',designation:null}]:[]}});
    if(q.method()==='POST'&&p==='/api/v1/normalization/units'&&!createdUnit){createdUnit={...original,...q.postDataJSON(),id:'nested-import-new',call_minimums:[],revision:'created'};return route.fulfill({json:createdUnit});}
    if(q.method()==='POST'&&p==='/api/v1/admin/members'&&!createdMember){createdMember={...member,...q.postDataJSON(),id:'nested-import-new-person'};return route.fulfill({json:scenario==='member-null'?null:createdMember});}
    return route.fulfill({status:500,json:{detail:'Diagnostic forbids Apply, fallback saves, records saves and all other mutations'}});
   }
   if(p==='/api/v1/admin/members')return route.fulfill({json:members()});
   if(p==='/api/v1/normalization/units'){
    if(createdUnit&&scenario==='unit-choices503'&&!choiceFailure){choiceFailure=true;return route.fulfill({status:503,json:{detail:'Accepted unit; importer choices temporarily unavailable'}});}
    return route.fulfill({json:units()});
   }
   if(p==='/api/v1/normalization/units/suggest-code')return route.fulfill({json:{code:'NIN'}});
   if(p==='/api/v1/extra-duty/unit-fallbacks'){fbReads++;return route.fulfill({json:units().map(u=>({unit_id:u.id,unit_name:u.name,fallbacks:u.id===original.id?units().slice(1,3).map(x=>({unit_id:x.id,unit_name:x.name})):[]}))});}
   if(p==='/api/v1/unit-management/month'){
    unitReads++;return route.fulfill({json:{month:url.searchParams.get('month'),starts_on:'2026-11-01',ends_on:'2026-11-30',units:units(),assignments:[],unit_summaries:units().map(u=>({unit_id:u.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]}});
   }
   return route.fulfill({response:await route.fetch({url:api+p+url.search,maxRetries:2})});
  });
  try{
   await page.goto(base+'/#view=units',{waitUntil:'domcontentloaded'});
   const fallback=page.locator('[data-fallback-unit="nested-import-unit"]');await fallback.locator('summary').click();await fallback.locator('[data-fb-up="nested-import-c"]').click();
   await page.locator('#unit-fallbacks-host').evaluate(e=>{window.__nestedImportHost=e;window.__nestedImportRow=e.querySelector('[data-fallback-unit="nested-import-unit"]');});
   await page.locator('input[data-unit-board-search]').fill('Royal');await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
   const before={unitReads,fbReads};
   await page.locator('[data-open-normalized-import="units"]').click();const dialog=page.locator('dialog.operational-import');
   await dialog.locator('input[type=file]').setInputFiles({name:'nested-reference.csv',mimeType:'text/csv',buffer:Buffer.from('member_name,unit_name\nNested New Person,Royal Nested New\n')});
   await dialog.locator('[data-map]').first().waitFor({state:'attached'});await dialog.getByRole('button',{name:'Preview and normalize',exact:true}).click();await dialog.locator('[data-review-row="Sheet:2"]').waitFor();
   if(isUnit){
    await dialog.locator('[data-review-row="Sheet:2"] details.import-row__edit > summary').click();await dialog.locator('[data-create-unit]').click();
    const registry=page.getByRole('dialog',{name:'Manage department units',exact:true});await registry.locator('[name=name]').fill('Royal Nested New');await registry.locator('[name=campus]').fill('Main');await registry.locator('[name=code]').fill('NIN');
    if(scenario==='cancel-unit')await registry.locator('button[aria-label="Close unit management"]').click();
    else await registry.getByRole('button',{name:'Create unit',exact:true}).click();
    await registry.waitFor({state:'detached'});
    if(scenario==='unit-choices503')await dialog.locator('[data-retry-unit-options]').waitFor();
    else if(scenario==='unit-create'){await dialog.locator('[data-message]').getByText('Unit created and selected for this row. Refresh the normalized preview before applying.',{exact:true}).waitFor();assert.equal(await dialog.locator('[data-field="unit_id"]').inputValue(),'nested-import-new');}
   }else{
    await dialog.locator('[data-create-member]').click();const creator=page.getByRole('dialog',{name:'Create department member',exact:true});
    if(scenario==='use-existing')await creator.locator('[data-use-existing="nested-import-person"]').click();
    else{
     await creator.locator('[name=canonical_name]').fill('Nested New Person');
     if(scenario==='cancel-member')await creator.locator('button[aria-label="Close member creation"]').click();
     else{await creator.locator('[name=call_level]').selectOption('2ND_CALL');await creator.getByRole('button',{name:'Create member',exact:true}).click();}
    }
    await creator.waitFor({state:'detached'});
    if(!scenario.startsWith('cancel-')&&scenario!=='member-null')assert.equal(await dialog.locator('[data-field="person_id"]').inputValue(),scenario==='use-existing'?member.id:'nested-import-new-person');
   }
   assert.equal(unitReads,before.unitReads,'Parent does not refresh while enclosing importer remains open');assert.equal(fbReads,before.fbReads);
   assert.equal(await dialog.locator('input[type=file]').evaluate(e=>e.files[0]?.name),'nested-reference.csv');
   await dialog.locator('header [data-close]').click();await dialog.waitFor({state:'detached'});
   const mutated=Boolean(createdUnit||createdMember);
   if(mutated)await page.getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();
   else await page.waitForLoadState('networkidle');
   assert.equal(unitReads-before.unitReads,mutated?1:0,'Only actual accepted mutation schedules exactly one parent read');
   assert.equal(fbReads-before.fbReads,createdUnit?1:0,'Complete fallback references refresh only after actual unit mutation');
   assert.equal(await page.locator('#unit-fallbacks-host').evaluate(e=>e===window.__nestedImportHost&&e.querySelector('[data-fallback-unit="nested-import-unit"]')===window.__nestedImportRow),true);
   assert.deepEqual(await fallback.locator('[data-fallback-item]').evaluateAll(es=>es.map(e=>e.dataset.fallbackItem)),['nested-import-c','nested-import-b']);assert.equal(await fallback.locator('[data-fb-save]').isEnabled(),true);
   assert.equal(await page.locator('input[data-unit-board-search]').inputValue(),'Royal');assert.equal(await page.locator('select[data-unit-board-campus]').inputValue(),'campus:Main');assert.equal(await page.locator('#working-month').inputValue(),'2026-11');
   if(createdUnit){assert.equal(await page.locator('[data-unit-board-card="unit:nested-import-new"]').count(),1);assert.equal(await fallback.locator('[data-fb-select] option[value="nested-import-new"]').count(),1);}
   assert.equal(choiceFailure,scenario==='unit-choices503');
   const actualMutations=writes.filter(w=>['/api/v1/admin/members','/api/v1/normalization/units'].includes(w.path));assert.equal(actualMutations.length,mutated?1:0);
   assert.equal(writes.filter(w=>/\/apply$|\/records\/|\/extra-duty\//.test(w.path)).length,0,'No Apply/record/fallback mutation');assert.deepEqual(errors,[]);
   results.push({engine,width,scenario,passed:true,parentReads:unitReads-before.unitReads,fallbackReads:fbReads-before.fbReads,choiceFailure,writes,requests,prompts,errors});
  }catch(error){results.push({engine,width,scenario,passed:false,assertion:error.message,unitReads,fbReads,choiceFailure,createdUnit:Boolean(createdUnit),createdMember:Boolean(createdMember),writes,requests,prompts,errors});}
  finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
for(const[path,h]of Object.entries(audit.source_sha256))assert.equal(sha(await readFile('../'+path)),h,'Held applied source');
for(const{file,candidate_sha256}of manifest.files)assert.equal(sha(await readFile('../tmp/nested-reference-v13r2/'+file)),candidate_sha256,'Frozen candidate');
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/nestedreference159_groundwork',scope:'42 isolated V13r2 candidate contexts: actual CSV preview then nested unit/member create or cancel/Use existing; no Apply. Includes accepted member POST returning JSON-null and actual importer options GET503 after accepted unit creation then final discard. Does not cover profile/record own Save, owner supersession, parent503 or physical devices.',source_sha256:audit.source_sha256,candidate_sha256:candidates,test_sha256:sha(await readFile(new URL(import.meta.url))),expected_contexts:42,results},null,2)+'\n');
assert.equal(results.length,42);assert.equal(results.filter(r=>!r.passed).length,0,'Nested import candidate matrix');
