// Frozen applied numeric-CSS regression: source/environment gate is additive.
import assertNumericCss from 'node:assert/strict';
import {readFile as readNumericCssSource} from 'node:fs/promises';
import {createHash as createNumericCssHash} from 'node:crypto';
const heldNumericCssSources={"frontend/src/admin-delete.ts": "7a3eb13237272ad8b44f523bea5483ebeae60fc9c8b58d92035fe15c74528979", "frontend/src/admin-preview.ts": "6f6b041bdff47a07f5b02ae932d9a8cebafb14c173dcdcd69d10b190237227ae", "frontend/src/analysis-charts.ts": "823a2cddb07d0f69ba1fe12719e4094ae29fda839769e1f4b2dc75e7aa887c4a", "frontend/src/api-errors.ts": "55d90faf3f364b3a7835fe5dd465f6b3633e05942bd6f71e37d89fb7b7f8b94d", "frontend/src/audit-time.ts": "136542cb2daec343417532d372f2e8ce01a0e6103ef6c62a7a4a8017ac8a6d15", "frontend/src/balance-duties.ts": "ab4f5ffad3f219380ffc74cc0212ace10b57c1d951c2e3e6137547fed6a35113", "frontend/src/component-reference.css": "46ed291bfdd2463fdc470392a12207bf37fca0478587c24a5019b82e6f7262ee", "frontend/src/component-reference.ts": "dcf2631694638459aa31be896bb966e0d8472e56b811d28464392a8fc34b15de", "frontend/src/compute-conflict.ts": "1e69a3b0258c2da5f7588f7a6e2c6a8f26bf9130be9dd34e62e27c9431a05623", "frontend/src/compute-device.ts": "c7083623b77132d2ace7d1a0a815ad457a695c9e381afcfd1aeb91af1a6d4eca", "frontend/src/compute-protocol.ts": "d9dff1ad6ddda42e63da02dc6dd3d322f3cdc17fe824698e578a38cfcc57e1a5", "frontend/src/compute-worker.ts": "f67f75b98cbc72932e706167253d1e4df1f5234fe6346aa0d94191ff31a3fe7b", "frontend/src/connection-status.ts": "bb8080819c5d9aac5c5caf402565256bf2df0129a08367cdb6a41fadc2311007", "frontend/src/data-sync.ts": "8408ff9eb6369d486126b7471ffc15a45fbe7f6fe5decd73b231f1dbf07c2f02", "frontend/src/decorative-icons.ts": "7e2d11356114e96f242435a2cd7cb7bc24cdc1787142e864e1cf053f92c373d7", "frontend/src/diagnostics-summary.ts": "2ff6394f8659735796af81a155592034537507b69c380a6351292c5d6f44e5e7", "frontend/src/extra-duty.ts": "529e420fc05ce5bfa42655b8863e449e09e22a7c0abe9baf4db5c94c4797b8c3", "frontend/src/form-validation.ts": "a6d6cfa746f502cf05e5f4f1e1acade1c7ca82b592a497d98b79661854783a93", "frontend/src/frontend-runtime.ts": "45efce04e229e0bdcbc84de4c9570dd9c04877b2adb869269a6e40ff68b12a01", "frontend/src/generation-comparison.ts": "a331e6a20880b4535401262a3da35f2a98d38af93061552867e6f71d0d18115e", "frontend/src/generation-reversal-scope.ts": "4f5ce7136076e2b9ab3f07f91405083a7955425f19ebc7b8cdd1e6e22108e2af", "frontend/src/import-report.ts": "e33b0081d3f42286b4838160bb73f0dfcba0f77b493271e3fa8ce6a466b68a38", "frontend/src/import-review-presentation.ts": "4371d8a267480de774dbe32232cdeead69c041d8803bdcc9d9b24d5c7d13f8a9", "frontend/src/leave-approval.ts": "42e5a47751ae081d1b97108209c7a2b53272985251d153aa065f7718f43e544f", "frontend/src/leave-calendar-focus.ts": "93bc00fb0c753ef342412e2f58730126d17918c09edfd6f3e58f72b43d1cc2b3", "frontend/src/limits.ts": "f7c040de08fd0a593e1e071d7c09b2696344b9b85bbcd836f5367b49e4ef8db6", "frontend/src/main.ts": "ebf67f1733f620e406054d0c4a82cf1c203fd0e6603a843eec45b25a1a09df4d", "frontend/src/member-bulk.ts": "8ae7cf7d899a528027d9362c6f4c895d0cb9f8b14fdb2a3458acc090617f378d", "frontend/src/member-duplicates.ts": "f43e871e219a6652bad3fa027b2566448ed69ef51a833f185821cbfa0b70f4c5", "frontend/src/member-import-history.ts": "0357db668bac46f7c4c28c575e2f7c688b00c95671acb1f475aea0946e89ec92", "frontend/src/member-import.ts": "d985f4aefa5bfdd71b6f0a53995a8c63b3c827639158ec584b97e72f14ced061", "frontend/src/member-presentation.ts": "71c8c8f7b1eadd1d02e84e3a997f3c636a3b7edb04b4bf527b19bdde223c5f60", "frontend/src/member-profile.ts": "6874284e2437402f0cb00d57841f0d4170d8ecc6f2067ad2a156e38c3b0b69f2", "frontend/src/member-workspace.ts": "506c486046fe6f0bbea5c6c4bf6357fec6e9649d91a9ed1ed890551ed3503cca", "frontend/src/navigation-history.ts": "7987fe6b5034c80e44708b0e46d5bf4009a1e3eabca092a5b8a31ca1afdde0b4", "frontend/src/operational-import.ts": "01d58023203380fedcee010cd3001b8e2bb478397144566ef92142a515a14b38", "frontend/src/past-duties.ts": "659bc4a927a8d4efbaf0ab0050941262555319e3fbc1ca85064332435ea32bd1", "frontend/src/premium-theme.css": "2e4f85d813061ebc9f696b92d50ae24717a7781a3688187d02c7339c00bea4a1", "frontend/src/record-workspace.ts": "20b50cdbd991b5b5a16d06b51020be2838514a553823512373818f65636427aa", "frontend/src/recycle-bin.ts": "7d2e02cd9f198999e2c7eaf788218ed3164781b39536176a63180a92c65ffc17", "frontend/src/reference-workspace.ts": "dbd6d1bdb13893ee49d3f004518177b964101520e2bd2034d8639f1c76f134bd", "frontend/src/rota-compute.ts": "e5f967e6166e2ace9352983a468002d45850188d8811363230305d7597fb70ab", "frontend/src/rota-intelligence.ts": "bda7257a3cafdcf6c4122575cc454abb1623f27dbd13950ea1d61260a23bb79b", "frontend/src/rota-rules.ts": "86bf98ac12a401f7c484647bfaec98c8815abe401406f95b245421e16a1fff4a", "frontend/src/services/api.ts": "5167f842eb4e07cf5216d18bde2ef48ded1a6692490d80dd261e4ceb038a5e3c", "frontend/src/session-role.ts": "bb13b581f4d2320d7010ca754567ed2aa7a504abd4ec3eaae6bfbc830306fb1b", "frontend/src/shell-accessibility.ts": "7a0fea8b59e15ee29cd2cc288102eb767d47c0f8e008697fce5aa9af69a7e1a4", "frontend/src/styles.css": "306928f568686cfc453178f73731a797f7fe5b9f016d7128bf9cd68dc6e1fb86", "frontend/src/superadmin.ts": "ce337c066f127db0d4400daf86e90316d5442dced44c3eea0e996584ef1ed841", "frontend/src/ui-feedback.ts": "af25aa3329afbe97de610ecfd83a00c70991863b2cba8ba5e301c205230f19da", "frontend/src/ui.ts": "680d7830bca8826b46b6f1dc2c0d064d2a3a2e16fb41188d2c323de6bccf85b2", "frontend/src/unit-board-filters.ts": "1c01b57eace54e99d01205fc07273bacbfe1649c4db576763bb55768d0d33766", "frontend/src/unit-member-lists.ts": "9d29fb79214cce10962f480c9efb56741cc24a5f9b98a5ad7ec539ce49eda7ac", "frontend/src/unit-modal-accessibility.ts": "f24dc45dd7b548ac66311252cb03c74430a117949e7b76bc72c0a3c652f6b147", "frontend/src/unit-settings-recovery.ts": "9e899c32f81c23b2fbedbe164e188880c21cc7dad5021a57f6cac9fe98e38679", "frontend/src/vite-env.d.ts": "65996936fbb042915f7b74a200fcdde7e410f32a669b1ab9597cfaa4b0faddb5", "frontend/src/workflow-import-history.ts": "6af21b09f48bb6632ac7afb78759884d4aa0e9750d520f48be0c79ea3d4b5cf5", "frontend/src/workspace-load-state.ts": "cdd0e323d7e83e6e668a381bbfcc37cad4726b1193ac5de31d5f14e03eecd9c6"};
const numericCssSha=b=>createNumericCssHash('sha256').update(b).digest('hex');
for(const[path,digest]of Object.entries(heldNumericCssSources))assertNumericCss.equal(numericCssSha(await readNumericCssSource('../'+path)),digest,'Held applied numeric source '+path);
for(const name of ['main.ts','member-workspace.ts','operational-import.ts','record-workspace.ts']){
 const response=await fetch('http://127.0.0.1:5197/src/'+name);assertNumericCss.equal(response.status,200);
 const encoded=(await response.text()).match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assertNumericCss.ok(encoded);
 assertNumericCss.ok(JSON.parse(Buffer.from(encoded[1],'base64').toString()).sourcesContent.some(s=>numericCssSha(s)===heldNumericCssSources['frontend/src/'+name]),'Actual served applied module '+name);
}
const numericCssModule=await(await fetch('http://127.0.0.1:5197/src/premium-theme.css')).text(),numericCssMatch=numericCssModule.match(/const __vite__css = ("(?:[^"\\]|\\.)*")/);
assertNumericCss.ok(numericCssMatch);assertNumericCss.equal(numericCssSha(JSON.parse(numericCssMatch[1])),heldNumericCssSources['frontend/src/premium-theme.css']);

import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Returned-data presentation only. All API requests are fulfilled locally and GET-only.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const paths=['frontend/src/member-presentation.ts','frontend/src/member-workspace.ts','frontend/src/styles.css','frontend/src/premium-theme.css','frontend/src/services/api.ts','frontend/src/ui.ts','frontend/src/workspace-load-state.ts'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,digest(await readFile('../'+path))])));
const initial=await hashes(),testSha=digest(await readFile(new URL(import.meta.url))),results=[];
const title='Consultant <img src=x onerror="window.__designationInjected=1"> '+('LongUnbrokenDesignation'.repeat(12));
const row=(designation,from='2025-01-01',to=null)=>({id:designation,designation,effective_from:from,effective_to:to,source:'manual',notes:'Returned position notes'});
const fixtures=[
 {key:'mixed',rows:[row('Past','2020-01-01','2026-10-23'),row('Current'),row('Future','2026-10-25')],current:['Current']},
 {key:'future-only',rows:[row('Future','2026-10-25')],current:[]},
 {key:'past-only',rows:[row('Past','2020-01-01','2026-10-23')],current:[]},
 {key:'no-records',rows:[],current:[]},
 {key:'invalid-intervals',rows:[row('Invalid','2026-02-30'),row('Reversed','2026-10-24','2026-10-23'),row('Missing','')],current:[]},
 {key:'overlap-returned-order',rows:[row('Second returned first','2026-01-01'),row('First returned second','2025-01-01')],current:['Second returned first','First returned second']},
 {key:'starts-today',rows:[row('Starts today','2026-10-24')],current:['Starts today']},
 {key:'ends-today',rows:[row('Ends today','2025-01-01','2026-10-24')],current:['Ends today']},
 {key:'blank-title',rows:[row('')],current:['Designation not recorded']},
 {key:'long-escaped',rows:[row(title)],current:[title],long:true},
];
async function activate(page,locator){await locator.focus();await page.keyboard.press('Enter');}
async function scrollToEdge(page,locator,end,label){
 await locator.focus();
 const before=await locator.evaluate(node=>({top:node.scrollTop,max:node.scrollHeight-node.clientHeight}));
 await page.keyboard.press(end?'ArrowDown':'ArrowUp');
 if(end?before.top<before.max-2:before.top>1){
  await locator.page().waitForFunction(({selector,end,top})=>{const node=document.querySelector(selector);return end?node.scrollTop>top:node.scrollTop<top;},{selector:await locator.evaluate(node=>node.matches('.mw-content')?'.mw-content':'[data-member-identity-region]'),end,top:before.top});
 }
 for(let attempt=0;attempt<100;attempt++){
  const atEdge=await locator.evaluate((node,end)=>end?node.scrollTop+node.clientHeight>=node.scrollHeight-2:node.scrollTop<=1,end);
  if(atEdge)return;
  await page.keyboard.press(end?'ArrowDown':'ArrowUp');await page.waitForTimeout(65);
 }
 assert.fail('Native arrows cannot reach '+(end?'end':'start')+' '+label+' '+JSON.stringify(await locator.evaluate(node=>({top:node.scrollTop,height:node.clientHeight,scroll:node.scrollHeight,focused:node===document.activeElement,overflow:getComputedStyle(node).overflowY,parentTop:node.parentElement.scrollTop,dialogTop:node.closest('dialog').scrollTop}))));
}

for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const config of [{width:320,height:480,scale:1},{width:1280,height:800,scale:1}]){
  const {width,height,scale}=config,context=await browser.newContext({viewport:{width,height},locale:'en-GB',timezoneId:'Asia/Kolkata',colorScheme:width===320?'dark':'light',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],reads=[],cases=[];let current;
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000);
  await page.clock.setFixedTime(new Date('2026-10-24T06:30:00Z'));
  await page.route('**/__designation_header',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open profile</button></body></html>'}));
  await page.route('**/api/**',route=>{
   const request=route.request(),url=new URL(request.url());assert.equal(request.method(),'GET','Read-only identity never mutates');assert.equal(url.search,'');reads.push(url.pathname);
   assert.equal(url.pathname,'/api/v1/admin/member-workspace/'+current.id);
   return route.fulfill({json:{member:current,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
  });
  await page.goto(base+'/__designation_header');
  if(scale===2)await page.addStyleTag({content:'html { font-size:200% !important; }'});
  for(const fixture of fixtures.filter(fixture=>fixture.long))for(const admin of [true,false]){
   current={id:'designation-'+fixture.key,canonical_name:fixture.long?('Dr '+('LongUnbrokenIdentity'.repeat(14))).slice(0,255):'Dr '+fixture.key,active_status:'active',call_level:'1ST_CALL',effective_call_level:'3RD_CALL',revision:'unchanged',aliases:[],designations:structuredClone(fixture.rows),call_level_changes:[]};
   const before=structuredClone(current);
   await page.evaluate(({id,admin})=>{document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace(id,admin,()=>{},[id],'overview'));},{id:current.id,admin});
   await activate(page,page.locator('#open'));
   const dialog=page.getByRole('dialog',{name:'Member profile',exact:true});
   await dialog.locator('[data-member-designation]').waitFor();
   const header=dialog.locator('[data-member-designation]'),summary=dialog.locator('[data-member-designation-summary]');
   const expected=fixture.current.length?fixture.current.join(' · '):'No designation recorded for this date';
   assert.equal(await header.innerText(),expected,fixture.key+' header');
   assert.equal(await summary.locator('strong').innerText(),expected,fixture.key+' overview agrees');
   const note=(fixture.key==='overlap-returned-order'?'Multiple recorded positions match this date. ':'')+(fixture.key==='invalid-intervals'?'Some designation dates are missing or invalid; review designation history. ':'')+'Based on recorded dates; compared with 24 Oct 2026 on this device.';
   assert.equal(await dialog.locator('[data-member-designation-context]').innerText(),note);
   assert.equal(await summary.locator('p').innerText(),note);
   assert.equal(await dialog.locator('[data-member-identity]').innerText(),current.canonical_name);
   assert.equal(await dialog.locator('[data-member-call-identity]').innerText(),'3rd Call','Returned effective level preserved');
   assert.match(await dialog.locator('.mw-header').innerText(),/Active/);
   assert.equal(await dialog.locator('img,script').count(),0);
   if(fixture.key==='mixed'&&scale===1){
    const visible=await dialog.evaluate(node=>{
     const region=node.querySelector('[data-member-identity-region]').getBoundingClientRect();
     return [...node.querySelectorAll('[data-member-identity],[data-member-designation],[data-member-call-identity],[data-member-active-status]')].map(item=>({selector:item.hasAttribute('data-member-call-identity')?'call':item.hasAttribute('data-member-designation')?'designation':item.hasAttribute('data-member-active-status')?'status':'name',top:item.getBoundingClientRect().top,bottom:item.getBoundingClientRect().bottom,regionTop:region.top,regionBottom:region.bottom}));
    });
    for(const item of visible)assert.ok(item.top>=item.regionTop-1&&item.bottom<=item.regionBottom+1,'Normal primary identity visible before secondary context: '+JSON.stringify(item));
   }
   const geometry=await dialog.evaluate(node=>{
    const identity=node.querySelector('[data-member-identity-region]'),close=node.querySelector('[data-close]'),content=node.querySelector('.mw-content'),header=node.querySelector('.mw-header');
    const a=identity.getBoundingClientRect(),b=close.getBoundingClientRect(),c=content.getBoundingClientRect();
    return {viewport:{width:innerWidth,height:innerHeight},dialog:node.getBoundingClientRect().toJSON(),identity:a.toJSON(),close:b.toJSON(),content:c.toJSON(),contentHeight:content.clientHeight,identityWidth:identity.clientWidth,identityScrollWidth:identity.scrollWidth,identityHeight:identity.clientHeight,identityScrollHeight:identity.scrollHeight,headerOverflow:header.scrollWidth>header.clientWidth+2,tabindex:identity.getAttribute('tabindex')};
   });
   assert.ok(geometry.dialog.width<=width+1);assert.equal(geometry.headerOverflow,false);
   assert.ok(geometry.identity.right<=geometry.close.left+1,'Full identity does not overlap Close');
   assert.ok(geometry.close.top>=-1&&geometry.close.bottom<=height+1,'Close remains visible');
   assert.ok(geometry.contentHeight>=80,fixture.key+' admin='+admin+' profile panel retains usable visible space: '+JSON.stringify(geometry));
   assert.ok(geometry.identityScrollWidth<=geometry.identityWidth+2,'Unbroken identity wraps');
   let nativeScroll=null;
   assert.equal(await dialog.locator('[data-member-identity-cue]').isVisible(),geometry.identityScrollHeight>geometry.identityHeight+1,'Visual instruction follows actual identity overflow');
   if(geometry.identityScrollHeight>geometry.identityHeight+1){
    const region=dialog.locator('[data-member-identity-region]');assert.equal(geometry.tabindex,'0','Clipped identity region is keyboard reachable');
    const description=await region.getAttribute('aria-description');assert.ok(description,'Overflow has discoverable instruction');
    await scrollToEdge(page,region,true,JSON.stringify({engine,...config,fixture:fixture.key,admin,area:'identity'}));
    nativeScroll=await region.evaluate(node=>({top:node.scrollTop,height:node.clientHeight,scroll:node.scrollHeight}));
    assert.ok(nativeScroll.top+nativeScroll.height>=nativeScroll.scroll-2,'Native keyboard reaches full identity end');
    await scrollToEdge(page,region,false,JSON.stringify({engine,...config,fixture:fixture.key,admin,area:'identity'}));
    await page.keyboard.press('Tab');
    assert.equal(await dialog.locator('[data-close]').evaluate(node=>node===document.activeElement),true,'Tab from identity region reaches Close');
   }
   const panel=dialog.locator('.mw-content');await scrollToEdge(page,panel,true,JSON.stringify({engine,...config,fixture:fixture.key,admin,area:'panel'}));
   const panelEnd=await panel.evaluate(node=>({top:node.scrollTop,height:node.clientHeight,scroll:node.scrollHeight}));
   assert.deepEqual(current,before,'Identity presentation preserves returned records and order');
   await activate(page,dialog.getByRole('button',{name:'Close member profile',exact:true}));await dialog.waitFor({state:'detached'});
   assert.equal(await page.locator('#open').evaluate(node=>node===document.activeElement),true);
   assert.equal(await page.evaluate(()=>window.__designationInjected||0),0);
   cases.push({fixture:fixture.key,admin,expected,note,geometry,nativeScroll,panelEnd,headerOverviewAgreement:true,returnedOrderPreserved:true,closeFocusRestored:true});
  }
  assert.deepEqual(errors,[]);results.push({engine,...config,clock:'2026-10-24T06:30:00Z',timezone:'Asia/Kolkata',cases,reads,pageErrors:errors});console.log('Passed '+engine+' '+JSON.stringify(config)+' '+cases.length+' workflows');await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Application sources held');assert.equal(digest(await readFile(new URL(import.meta.url))),testSha,'Test source held');
await writeFile('../docs/premium-ui/qa-original031-mounted-profile-header-applied-r1.json',JSON.stringify({checked_at:new Date().toISOString(),source_sha256:initial,test_sha256:testSha,scope:'Actual canonical profile, GET-only locally fulfilled fixtures.3 engines x320short480dark/1280desktop800light,long255name plus longescapeddesignation xadmin/view-only=12 workflows within6 contexts. NumericCSS mounted126 regression. Fixed device date2026-10-24. No backend authorization, persistence, physical devices, native assistive technology, production bundle or scheduling correctness claim.',results},null,2)+'\n');
console.log('Profile designation header: '+results.length+' contexts / '+results.reduce((sum,row)=>sum+row.cases.length,0)+' GET-only workflows passed');

for(const[path,digest]of Object.entries(heldNumericCssSources))assertNumericCss.equal(numericCssSha(await readNumericCssSource('../'+path)),digest,'Applied numeric source unchanged at final gate '+path);
