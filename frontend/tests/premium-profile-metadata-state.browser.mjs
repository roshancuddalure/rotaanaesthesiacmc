import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const paths=['frontend/src/member-profile.ts','frontend/src/member-workspace.ts','frontend/src/member-presentation.ts','frontend/src/services/api.ts','frontend/src/ui.ts','frontend/src/styles.css','frontend/src/premium-theme.css'];
const digest=v=>createHash('sha256').update(v).digest('hex'),hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,digest(await readFile('../'+p))])));
const initial=await hashes(),testSha=digest(await readFile(new URL(import.meta.url))),results=[];
const position=(id,name,date='2025-01-01')=>({id,designation:name,effective_from:date,effective_to:null,notes:'Essential '+name+' notes',source:'Secondary '+name+' source'});
const call=(id,date='2026-09-01')=>({id,from:'2ND_CALL',to:'3RD_CALL',effective_from:date,reason:'Essential '+id+' reason',source:'Secondary '+id+' source',author:'Secondary '+id+' author',recorded_at:'2026-09-01T10:00:00Z',scheduled:false});
const member=()=>({id:'metadata-review',canonical_name:'Dr Metadata Review',active_status:'active',call_level:'1ST_CALL',effective_call_level:'3RD_CALL',revision:'metadata-one',aliases:[],designations:[position('position-kept','Kept position')],call_level_changes:[]});
async function activate(page,locator){await locator.focus();await page.keyboard.press('Enter');}
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of[320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'en-GB',timezoneId:'Asia/Kolkata',reducedMotion:'reduce'}),page=await context.newPage(),cases=[],requests=[],errors=[];
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-10-24T06:30:00Z'));
  let current,profile,release,posted,postStarted,rolesRelease,rolesStarted,resolveRolesStarted,postNumber=0;
  await page.route('**/__metadata_state',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open profile</button></body></html>'}));
  await page.route('**/api/**',async route=>{
   const q=route.request(),path=new URL(q.url()).pathname,method=q.method();requests.push({method,path,...(method==='POST'?{body:q.postDataJSON()}:{})});
   if(method==='POST'){
    assert.equal(path,'/api/v1/members/metadata-review/comments');assert.deepEqual(q.postDataJSON(),{body:'Hierarchy rerender check '+postNumber},'Exact existing comment contract');assert.equal(profile.can_manage,true);
    postStarted();await new Promise(resolve=>{release=resolve;});
    profile={...profile,member:{...profile.member,designations:postNumber===1?[position('inserted','Inserted earlier position','2024-01-01'),...profile.member.designations]:profile.member.designations.filter(p=>p.id!=='inserted')},call_history:postNumber===1?[call('inserted-call','2026-01-01'),...profile.call_history]:profile.call_history.filter(c=>c.id!=='inserted-call')};
    return route.fulfill({json:profile});
   }
   assert.equal(method,'GET');
   if(path==='/api/v1/members/metadata-review/profile')return route.fulfill({json:profile});
   if(path==='/api/v1/admin/member-workspace/metadata-review')return route.fulfill({json:{member:current,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
   if(path==='/api/v1/admin/member-workspace/metadata-review/roles'){resolveRolesStarted();await new Promise(resolve=>{rolesRelease=resolve;});return route.fulfill({json:{rows:[]}});}
   assert.fail('Unexpected metadata request '+method+' '+path);
  });
  await page.goto(base+'/__metadata_state');
  for(const role of['computer_admin','hod','rota_board_member'])for(const manage of[true,false]){
   current=member();postNumber=0;profile={member:current,today:'2026-09-15',current_call_level:'3RD_CALL',can_manage:manage,call_history:[call('kept')],comments:[{id:'comment-one',body:'Existing protected comment',author:'HOD author',role:'hod',recorded_at:'2026-09-01T10:00:00Z'}],postings:[],leaves:[],imports:[],statistics:{official_duties:0,hours24:0,weekend_duties:0}};
   await page.evaluate(role=>{document.querySelector('#open').onclick=()=>import('/src/member-profile.ts').then(m=>m.openMemberProfile('metadata-review',role,async()=>{}));},role);await activate(page,page.locator('#open'));const dialog=page.getByRole('dialog',{name:'Department member profile',exact:true});await dialog.locator('[data-legacy-member-name]').waitFor();
   const admin=role==='computer_admin';for(const form of['designation','alias','details'])assert.equal(await dialog.locator('[data-profile-form="'+form+'"]').count(),admin?1:0,'Existing independent admin role guard');for(const form of['comment','call'])assert.equal(await dialog.locator('[data-profile-form="'+form+'"]').count(),manage?1:0,'Existing returned can_manage guard');assert.equal(await dialog.getByText('Existing protected comment',{exact:true}).count(),manage?1:0);
   const positionDisclosure=dialog.locator('[data-profile-disclosure="designation-source-position-kept"]'),callDisclosure=dialog.locator('[data-profile-disclosure="call-provenance-kept"]');
   await activate(page,positionDisclosure.locator('summary'));await activate(page,callDisclosure.locator('summary'));
   for(const disclosure of[positionDisclosure,callDisclosure])assert.equal(await disclosure.evaluate(n=>n.open),true);
   const writesBefore=requests.filter(r=>r.method==='POST').length;
   if(manage)for(postNumber of[1,2]){
    posted=new Promise(resolve=>{postStarted=resolve;});const form=dialog.locator('[data-profile-form="comment"]');await form.locator('textarea').fill('Hierarchy rerender check '+postNumber);await activate(page,form.locator('button'));await posted;
    await positionDisclosure.locator('summary').focus();assert.equal(await positionDisclosure.evaluate(n=>n.open),true);release();
    await dialog.getByText('Saved. Member list and linked data refreshed.',{exact:true}).waitFor();
    assert.equal(await positionDisclosure.evaluate(n=>n.open),true,'Open state follows original record after insertion/removal before it');assert.equal(await callDisclosure.evaluate(n=>n.open),true,'Call provenance keeps identity across preceding insertion/removal');assert.equal(await positionDisclosure.locator('summary').evaluate(n=>n===document.activeElement),true,'Focus follows stable original record key, not array ordinal');
    const inserted=dialog.locator('[data-profile-disclosure="designation-source-inserted"]');assert.equal(await inserted.count(),postNumber===1?1:0);if(postNumber===1)assert.equal(await inserted.evaluate(n=>n.open),false,'New record does not inherit open state');
    assert.equal(await positionDisclosure.locator('p').innerText(),'Source: Secondary Kept position source');
   }
   assert.equal(requests.filter(r=>r.method==='POST').length-writesBefore,manage?2:0);await activate(page,dialog.locator('[data-profile-close]'));await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#open').evaluate(n=>n===document.activeElement),true);cases.push({surface:'legacy',role,manage,independentGuardsPreserved:true,locallyFulfilledCommentPosts:manage?2:0,keyedDisclosureInsertionRemovalFocus:manage});
  }
  for(const admin of[true,false]){
   current=member();rolesStarted=new Promise(resolve=>{resolveRolesStarted=resolve;});
   await page.evaluate(admin=>{document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('metadata-review',admin,()=>{},['metadata-review'],'details'));},admin);await activate(page,page.locator('#open'));const dialog=page.getByRole('dialog',{name:'Member profile',exact:true});await dialog.locator('[data-member-record-identification]').waitFor();
   const identification=dialog.locator('[data-member-record-identification]');await activate(page,identification.locator('summary'));
   if(admin){await activate(page,dialog.locator('[data-edit]'));assert.equal(await identification.evaluate(n=>n.open),true);await activate(page,dialog.locator('[data-cancel-edit]'));assert.equal(await identification.evaluate(n=>n.open),true);}
   await activate(page,dialog.locator('[data-tab="roles"]'));await rolesStarted;
   const provenance=dialog.locator('[data-profile-disclosure="designation-source-position-kept"]');await activate(page,provenance.locator('summary'));await provenance.locator('summary').focus();rolesRelease();
   await page.waitForFunction(()=>!document.querySelector('.mw-content [role="status"]'));
   assert.equal(await provenance.evaluate(n=>n.open),true,'Late linked-record loading preserves metadata disclosure');assert.equal(await provenance.locator('summary').evaluate(n=>n===document.activeElement),true,'Late rerender restores exact disclosure summary focus');
   await activate(page,dialog.locator('[data-tab="details"]'));assert.equal(await identification.evaluate(n=>n.open),true,'Existing disclosure survives tab return');await activate(page,dialog.locator('[data-close]'));await dialog.waitFor({state:'detached'});cases.push({surface:'canonical',admin,keyedDisclosureAsyncFocus:true,identificationStateAcrossEditCancelTabs:true});
  }
  assert.deepEqual(errors,[]);results.push({engine,width,cases,requests,pageErrors:errors});console.log('Metadata state passed '+engine+' '+width+' '+cases.length+' workflows');await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Application sources held');assert.equal(digest(await readFile(new URL(import.meta.url))),testSha,'Test source held');
await writeFile('../docs/premium-ui/qa-profile-metadata-state.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,test_sha256:testSha,scope:'6engine-width contexts/48 workflows: independent computer_admin/HOD/view role versus returned can_manage guards, keyed disclosure insertion/removal and async-render focus, exact36 locally fulfilled comment POSTs. Canonical unchanged edit/cancel/tab metadata state and deferred roles GET focus. No backend authorization/persistence, production, physical-device or native AT certification.',results},null,2)+'\n');console.log('Profile metadata state: '+results.length+' contexts /48 workflows passed');
