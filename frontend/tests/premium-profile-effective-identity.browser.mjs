import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Actual exported canonical profile. The returned member is authoritative; this
// test deliberately gives its base, effective value and future history different values.
// All API traffic is locally intercepted. Exact unchanged-save PUTs test contract
// preservation, not backend authorization, persistence or scheduling correctness.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const paths=['frontend/src/member-workspace.ts','frontend/src/record-workspace.ts','frontend/src/ui.ts','frontend/src/audit-time.ts','frontend/src/styles.css','frontend/src/premium-theme.css','frontend/src/services/api.ts','frontend/src/workspace-load-state.ts'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,digest(await readFile('../'+path))])));
const initial=await hashes(),testSha=digest(await readFile(new URL(import.meta.url))),results=[];
const unknown='UNRECOGNISED_<img src=x onerror="window.__identityInjected=1">_&_<script>bad()</script>';
const fixtures=[
 {key:'returned-different',effective:'CO_4TH_CALL',base:'1ST_CALL',value:'Co 4th Call'},
 {key:'returned-null',effective:null,base:'1ST_CALL',value:'Unassigned'},
 {key:'omitted-known-base',omitted:true,base:'1ST_CALL',value:'1st Call'},
 {key:'omitted-null-base',omitted:true,base:null,value:'Unassigned'},
 {key:'returned-unknown',effective:unknown,base:'1ST_CALL',value:unknown},
 {key:'future-different',effective:'2ND_CALL',base:'1ST_CALL',value:'2nd Call',future:true},
];
const memberFor=fixture=>({id:'identity-'+fixture.key,canonical_name:'Dr Identity '+fixture.key,active_status:'active',call_level:fixture.base,...(fixture.omitted?{}:{effective_call_level:fixture.effective}),revision:'identity-revision-1',aliases:[],designations:[{designation:'Consultant',effective_from:'2025-01-01',effective_to:null,notes:'Existing position',source:'manual'}],call_level_changes:fixture.future?[{call_level:'5TH_CALL',effective_from:'2026-12-01',notes:'Future value must never replace the returned current effective value'}]:[]});
async function activate(page,locator){await locator.focus();await page.keyboard.press('Enter');}
async function assertIdentity(dialog,fixture){
 const identity=dialog.locator('[data-member-call-identity]');
 assert.equal(await identity.innerText(),fixture.omitted?'Base default: '+fixture.value:fixture.value);
 if(!fixture.omitted)assert.equal(await identity.getAttribute('aria-label'),'Effective call level: '+fixture.value);
 assert.equal(await dialog.locator('.mw-header [data-member-call-note]').count(),fixture.omitted?1:0);
 if(fixture.omitted)assert.equal(await dialog.locator('.mw-header [data-member-call-note]').innerText(),'Current effective call level not returned.');
 assert.equal(await dialog.locator('img,script').count(),0,'Unknown labels are text, never executable markup');
 const geometry=await dialog.evaluate(node=>({viewport:innerWidth,dialog:node.getBoundingClientRect().width,content:[...node.querySelectorAll('.mw-content,.mw-header > div,.mw-summary article')].map(item=>({width:item.clientWidth,scroll:item.scrollWidth}))}));
 assert.ok(geometry.dialog<=geometry.viewport+1,'Profile fits viewport');
 for(const item of geometry.content)assert.ok(item.scroll<=item.width+2,'Identity text wraps inside its surface: '+JSON.stringify(item));
}
async function assertOverview(page,dialog,fixture){
 await activate(page,dialog.locator('[data-tab="overview"]'));
 const summary=dialog.locator('[data-effective-call-summary]');
 assert.equal(await summary.locator('small').innerText(),fixture.omitted?'Base default':'Effective call level');
 assert.equal(await summary.locator('strong').innerText(),fixture.value);
 assert.equal(await summary.locator('[data-member-call-note]').count(),fixture.omitted?1:0);
 if(fixture.omitted)assert.equal(await summary.locator('[data-member-call-note]').innerText(),'Current effective call level not returned.');
 const needsReview=fixture.omitted||fixture.effective===null||fixture.effective===unknown;
 assert.equal(await dialog.locator('[data-tab-link="details"]').count(),needsReview?1:0);
 if(needsReview)assert.equal(await dialog.locator('[data-tab-link="details"]').innerText(),'Review call level');
 await assertIdentity(dialog,fixture);
}

for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'en-GB',timezoneId:'Asia/Kolkata',colorScheme:width===320?'dark':'light',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],unexpected=[],prompts=[],reads=[],writes=[],cases=[];
  let current,admin,changed=0;
  page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',async prompt=>{prompts.push(prompt.message());await prompt.dismiss();});
  await page.clock.setFixedTime(new Date('2026-10-24T06:30:00Z'));
  await page.route('**/__profile_effective_identity',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en" data-theme="${width===320?'dark':'light'}"><head><title>Effective profile identity review</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open member profile</button></body></html>`}));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;
   assert.equal(url.search,'','Identity rendering adds no API parameters');
   if(req.method()==='GET'){
    reads.push(path);
    if(path==='/api/v1/admin/member-workspace/'+current.id)return route.fulfill({json:{member:current,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
    if(path==='/api/v1/admin/member-workspace/'+current.id+'/roles')return route.fulfill({json:{rows:[]}});
   }else{
    const observed={method:req.method(),path,body:req.postDataJSON()};writes.push(observed);
    assert.equal(admin,true,'View-only profile cannot initiate a save');
    assert.equal(req.method(),'PUT');assert.equal(path,'/api/v1/admin/member-workspace/'+current.id);
    const expected={...current,preserve_previous_name:true,aliases:current.aliases.map(alias=>alias.alias),designations:current.designations.map(row=>({...row,id:row.id||null}))};
    assert.deepEqual(observed.body,expected,'Saving unchanged edit preserves exact existing payload, including returned effective null or omission; no client-derived effective value');
    return route.fulfill({json:current});
   }
   unexpected.push({method:req.method(),path});return route.fulfill({status:599,json:{detail:'Unexpected effective identity request'}});
  });
  await page.goto(base+'/__profile_effective_identity');
  await page.exposeFunction('__identityChanged',()=>{changed++;});
  for(const fixture of fixtures)for(const canManage of [true,false]){
   current=memberFor(fixture);admin=canManage;
   const beforeMember=structuredClone(current),beforeWrites=writes.length,beforeChanged=changed;
   await page.evaluate(({id,admin})=>{document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(module=>module.openMemberWorkspace(id,admin,()=>window.__identityChanged(),[id],'overview'));},{id:current.id,admin});
   await activate(page,page.locator('#open'));
   const dialog=page.getByRole('dialog',{name:'Member profile',exact:true});
   await dialog.locator('[data-effective-call-summary]').waitFor();
   await assertOverview(page,dialog,fixture);
   await activate(page,dialog.locator('[data-tab="roles"]'));
   const timeline=dialog.locator('[data-effective-call-context]');
   const baseValue=fixture.base?'1st Call':'Unassigned';
   assert.equal(await timeline.innerText(),fixture.omitted?`Current effective call level not returned. Base default: ${baseValue}.`:`Current effective call level returned by the system: ${fixture.value}. Base default: ${baseValue}.`);
   await assertIdentity(dialog,fixture);
   if(fixture.future){
    const row=dialog.locator('[data-call-change-history="0"]');
    assert.match(await row.innerText(),/Default changes to 5th Call/);assert.match(await row.innerText(),/Scheduled change/);
    assert.equal(await row.locator('time').getAttribute('datetime'),'2026-12-01');
    assert.equal(await dialog.locator('[data-member-call-identity]').innerText(),'2nd Call');
   }
   await activate(page,dialog.locator('[data-tab="details"]'));
   assert.equal(await dialog.locator('select[data-field="call_level"]').inputValue(),fixture.base||'');
   assert.equal(await dialog.locator('select[data-field="call_level"]').isDisabled(),true);
   assert.equal(await dialog.locator('[data-edit]').count(),admin?1:0);
   if(admin){
    await activate(page,dialog.locator('[data-edit]'));
    assert.equal(await dialog.locator('select[data-field="call_level"]').isEnabled(),true);
    assert.equal(await dialog.locator('select[data-field="call_level"]').inputValue(),fixture.base||'');
    assert.equal(await dialog.locator('#mw-save-status').innerText(),'Editing profile','Entering edit causes no draft mutation');
    await assertIdentity(dialog,fixture);
    await activate(page,dialog.locator('[data-cancel-edit]'));
    assert.equal(writes.length,beforeWrites,'Cancel unchanged edit sends no mutation');
    await activate(page,dialog.locator('[data-edit]'));
    await activate(page,dialog.getByRole('button',{name:'Save changes',exact:true}));
    await dialog.locator('[data-edit]').waitFor();
    assert.equal(writes.length,beforeWrites+1,'One explicit native save sends one locally fulfilled PUT');
    await page.waitForFunction(()=>document.querySelector('#mw-save-status')?.textContent==='');
    await assertOverview(page,dialog,fixture);
   }else{
    assert.equal(await dialog.locator('.mw-footer').getByText('View only',{exact:true}).count(),1);
    assert.equal(await dialog.locator('[data-cancel-edit],button[type="submit"]').count(),0);
   }
   assert.deepEqual(current,beforeMember,'Rendering, navigation, edit/cancel and unchanged save never mutate server fixture');
   await activate(page,dialog.getByRole('button',{name:'Close member profile',exact:true}));
   await dialog.waitFor({state:'detached'});
   assert.equal(await page.locator('#open').evaluate(node=>node===document.activeElement),true,'Native close restores exact opener');
   await activate(page,page.locator('#open'));
   await dialog.locator('[data-effective-call-summary]').waitFor();
   await assertOverview(page,dialog,fixture);
   await activate(page,dialog.getByRole('button',{name:'Close member profile',exact:true}));
   await dialog.waitFor({state:'detached'});
   assert.equal(await page.locator('#open').evaluate(node=>node===document.activeElement),true,'Reopened profile retains identity and restores opener again');
   const geometry=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
   assert.ok(geometry.document<=geometry.viewport+1);
   assert.equal(changed-beforeChanged,admin?1:0);
   assert.equal(await page.evaluate(()=>window.__identityInjected||0),0);
   cases.push({fixture:fixture.key,admin,base:fixture.base,effectiveOmitted:!!fixture.omitted,effective:fixture.omitted?'not-returned':fixture.effective,presentedValue:fixture.value,headerOverviewTimelineConsistent:true,baseEditorPreserved:true,unchangedEditClean:true,nativeCloseReopenFocus:true,exactLocallyFulfilledPuts:writes.length-beforeWrites});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(prompts,[]);
  results.push({engine,width,height:900,clock:'2026-10-24T06:30:00Z',cases,reads,writes,forwardedMutations:0,pageErrors:errors,unexpectedRequests:unexpected,unexpectedPrompts:prompts});
  await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Application sources held throughout browser run');
assert.equal(digest(await readFile(new URL(import.meta.url))),testSha,'Test source held throughout browser run');
await writeFile('../docs/premium-ui/qa-profile-effective-identity.json',JSON.stringify({checked_at:new Date().toISOString(),source_sha256:initial,test_sha256:testSha,scope:'Actual exported canonical profile:3 engines x320/1280,6 returned-effective/base/future fixtures xadmin/view-only=72 profile workflows within6 browser contexts. Fixed local calendar2026-10-24. Consistent header/overview/timeline presentation, explicit null distinct from omitted legacy field, escaped unknown values, unchanged base edit contract, native cancel/close/reopen focus,36 exact locally fulfilled PUTs. No backend authorization/persistence, physical devices, native AT, production bundle or scheduling correctness certification.',results},null,2)+'\n');
console.log('Profile effective identity: '+results.length+' contexts / '+results.reduce((sum,row)=>sum+row.cases.length,0)+' profile workflows complete');
