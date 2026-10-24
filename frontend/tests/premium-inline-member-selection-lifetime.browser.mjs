// Current app -> Units CSV -> inline member chooser; all POSTs intercepted, RAM GETs only.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const probe=process.env.INLINE_SELECTION_PROBE==='1',base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api='http://127.0.0.1:8032',out='../docs/premium-ui/qa-inline-member-selection-lifetime';
const focusProbe=process.env.INLINE_SELECTION_FOCUS_PROBE==='1';
const paths=['src/main.ts','src/operational-import.ts','src/member-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const initial=await hashes(),results=[];await mkdir(out,{recursive:true});
const testSha=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const get=async path=>{const r=await fetch(api+path);assert.equal(r.status,200);return r.json();};
for(const [engine,type]of Object.entries(probe?{chromium}:focusProbe?{webkit}:{chromium,firefox,webkit})){
 const browser=await type.launch();try{for(const width of probe?[320]:focusProbe?[1280]:[320,1280])for(const variant of probe?['changed-success']:focusProbe?['name-reverted']:['changed-success','changed-refusal','unchanged-retry','name-reverted','call-level']){
  const original=await get('/api/v1/admin/members'),safe=original.find(m=>m.canonical_name==='Safe Member'),spare=original.find(m=>m.canonical_name==='Spare One'),other=original.find(m=>m.canonical_name==='Spare Two');assert.ok(safe&&spare&&other);
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],posts=[],previews=[];
  let release,arrived,hold=false;const held=new Promise(r=>release=r),selectionStarted=new Promise(r=>arrived=r);
  let holdResolve=false,resolveRelease,resolveArrived;const heldResolve=new Promise(r=>resolveRelease=r),resolveStarted=new Promise(r=>resolveArrived=r);
  const row=(settings,key='CSV:2')=>{const id=key==='CSV:3'?other.id:settings.corrections?.[key]?.person_id,person=original.find(m=>m.id===id);return {key,source:{sheet:'CSV',row:key==='CSV:3'?3:2},original:{Name:key==='CSV:3'?'Spare Two':'Safe Member'},values:{member_name:key==='CSV:3'?'Spare Two':'Safe Member',posting_type:'2ND_CALL',starts_on:'2026-05-01',ends_on:'2026-05-31'},after:{person_id:id||null,posting_type:'2ND_CALL'},action:person?'create':'needs_review',issues:person?[]:['Choose department member'],warnings:[],person_match:{state:person?'matched':'needs_review',canonical_name:person?.canonical_name||null,method:person?'member_id':null,reason:'Choose identity',candidates:[]}};};
  page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','inline-selection-lifetime');localStorage.setItem('duty_rota_working_month','2026-05');});
  await context.route('**/api/**',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(req.method()==='GET'){
    if(hold&&u.pathname==='/api/v1/admin/members'){hold=false;arrived();await held;if(variant==='changed-refusal'||variant==='unchanged-retry')return route.fulfill({status:503,json:{detail:'Held existing member refusal'}});}
    return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});
   }
   assert.equal(req.method(),'POST');posts.push(u.pathname);
   if(u.pathname.endsWith('/columns'))return route.fulfill({json:{headers:['Name'],fields:['member_name'],suggested:{Name:'member_name'}}});
   if(u.pathname.endsWith('/units/preview')){const settings=JSON.parse(req.postData().match(/name="settings_json"\r?\n\r?\n([^\r\n]+)/)[1]);previews.push(settings);return route.fulfill({json:{id:'selection-preview-'+previews.length,kind:'units',month:'2026-05',mode:'append',headers:['Name'],fields:['member_name'],replacement_scope:[],rows:[row(settings),row(settings,'CSV:3')]}});}
   assert.equal(u.pathname,'/api/v1/normalization/members/resolve','No create/apply/other mutation is allowed');const {name}=req.postDataJSON();if(holdResolve){holdResolve=false;resolveArrived();await heldResolve;}const member=name===spare.canonical_name?spare:safe;return route.fulfill({json:{candidates:[{id:member.id,name:member.canonical_name,status:'active',call_level:member.call_level}]}});
  });
  const activate=async locator=>{await locator.focus();await page.keyboard.press('Enter');};
  try{
   await page.goto(base+'/#view=units');await page.locator('[data-open-normalized-import="units"]').waitFor();await activate(page.locator('[data-open-normalized-import="units"]'));
   const importer=page.locator('dialog.operational-import'),file=importer.locator('input[type=file]');
   await file.setInputFiles({name:'selection.csv',mimeType:'text/csv',buffer:Buffer.from('Name\nSafe Member\nSpare Two\n')});await importer.locator('[data-map="0"]').waitFor();await activate(importer.getByRole('button',{name:'Preview and normalize',exact:true}));await importer.locator('[data-create-member="CSV:2"]').waitFor();
   await activate(importer.locator('[data-create-member="CSV:2"]'));const creator=page.getByRole('dialog',{name:'Create department member',exact:true}),input=creator.locator('[name=canonical_name]'),candidate=creator.locator(`[data-use-existing="${safe.id}"]`);
   await candidate.waitFor();hold=true;await activate(candidate);
   let timer;try{await Promise.race([selectionStarted,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Held selection read did not start')),20000))]);}finally{clearTimeout(timer);}
   if(!probe)await creator.getByRole('status').filter({hasText:'Checking selected member'}).waitFor();
   if(variant==='call-level')await creator.locator('[name=call_level]').selectOption('3RD_CALL');
   else if(variant!=='unchanged-retry'){await input.fill(spare.canonical_name);if(variant==='name-reverted')await input.fill(safe.canonical_name);await input.focus();}
   release();await page.waitForLoadState('networkidle');
   if(probe){await creator.waitFor({state:'detached'});assert.equal(await importer.locator('[data-review-row="CSV:2"] [data-field=person_id]').inputValue(),safe.id);results.push({engine,width,variant,edited_name:spare.canonical_name,selected_stale_identity:safe.canonical_name,observed:true,backend_mutations:0});continue;}
   if(variant!=='call-level'){
   assert.equal(await creator.isVisible(),true,'Changed name/refusal must preserve chooser instead of selecting old identity');
   if(variant==='unchanged-retry')await creator.locator('[data-error]').filter({hasText:'Held existing member refusal'}).waitFor();
   else{assert.equal(await input.inputValue(),variant==='name-reverted'?safe.canonical_name:spare.canonical_name);assert.equal(await input.evaluate(el=>el===document.activeElement),true,'Stale completion cannot steal edited-name focus');assert.equal(await creator.locator('[data-error]').textContent(),'','Obsolete failure cannot replace current draft feedback');assert.equal(await importer.locator('[data-review-row="CSV:2"] [data-field=person_id]').inputValue(),'','Stale result cannot select a parent row identity');}
   holdResolve=variant==='name-reverted';await creator.locator('[name=call_level]').focus();const chosen=variant==='unchanged-retry'||variant==='name-reverted'?safe:spare;
   if(variant==='name-reverted'){
    let timer;try{await Promise.race([resolveStarted,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Held blur lookup did not start')),20000))]);}finally{clearTimeout(timer);}
    const oldCandidate=await creator.locator(`[data-use-existing="${chosen.id}"]`).elementHandle();await creator.locator(`[data-use-existing="${chosen.id}"]`).focus();resolveRelease();await page.waitForFunction(el=>!el.isConnected,oldCandidate);
    const focused=await creator.locator(`[data-use-existing="${chosen.id}"]`).evaluate(el=>el===document.activeElement);
    if(focusProbe){assert.equal(focused,false);results.push({engine,width,variant,candidate_focus_lost_during_name_lookup:true,observed:true,backend_mutations:0});continue;}
    assert.equal(focused,true,'Exact candidate retains keyboard focus after blur lookup repaint');await page.keyboard.press('Enter');
   }else{await creator.locator(`[data-use-existing="${chosen.id}"]`).waitFor();await activate(creator.locator(`[data-use-existing="${chosen.id}"]`));}
   }
   await creator.waitFor({state:'detached'});const chosen=['unchanged-retry','name-reverted','call-level'].includes(variant)?safe:spare;
   assert.equal(await importer.locator('[data-review-row="CSV:2"] [data-field=person_id]').inputValue(),chosen.id);assert.equal(await importer.locator('[data-review-row="CSV:3"] [data-field=person_id]').inputValue(),other.id);assert.equal(await importer.locator('[data-apply]').getAttribute('aria-disabled'),'true','Choice still requires fresh preview');
   const normalized=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/units/preview')&&r.request().method()==='POST');await activate(importer.locator('[data-refresh]'));await normalized;await importer.locator('[data-message]').filter({hasText:'2 rows normalized'}).waitFor();assert.deepEqual(previews.at(-1).corrections,{'CSV:2':{person_id:chosen.id}});assert.equal(await file.evaluate(el=>el.files[0].name),'selection.csv');assert.equal(await file.evaluate(el=>el.files[0].text()),'Name\nSafe Member\nSpare Two\n');assert.equal(await importer.locator('[name=month]').inputValue(),'2026-05');assert.deepEqual(await get('/api/v1/admin/members'),original);assert.deepEqual(errors,[]);
   results.push({engine,width,variant,selected_identity:chosen.canonical_name,stale_result_ignored:!['unchanged-retry','call-level'].includes(variant),explicit_retry_after_refusal:variant==='unchanged-retry',exact_row_correction_and_other_row_preserved:true,file_month_preserved:true,backend_mutations:0,passed:true});
  }catch(error){console.error({engine,width,variant,posts,errors,text:(await page.locator('body').innerText()).slice(-1700)});throw error;}
  finally{release();resolveRelease();await page.waitForLoadState('networkidle').catch(()=>{});await context.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);assert.equal(createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),testSha);await writeFile(`${out}/${probe?'before':focusProbe?'before-focus':'report'}.json`,JSON.stringify({recorded_at_utc:new Date().toISOString(),target_url:base,test_sha256:testSha,scope:probe?'Actual Units CSV inline chooser selects stale member after editable name changes during held GET. No backend mutations.':focusProbe?'Held blur-name lookup replaces focused candidate and loses keyboard activation. WebKit1280; all POSTs intercepted.':'Current app Units CSV inline existing-member selection: changed-name success/refusal, unchanged-name retry, changed-back name and call-level-only change, candidate focus across actual held lookup repaint. All POSTs intercepted; RAM GETs only. Three engines,two widths; no persistence/all-role/native AT certification.',source_sha256:initial,whole_requirement_completion_proven:false,results},null,2)+'\n');
console.log(`Inline member selection lifetime:${results.length} contexts complete`);
