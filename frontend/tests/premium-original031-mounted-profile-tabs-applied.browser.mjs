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

// Actual exported canonical profile, native keyboard navigation and local GETs.
// Run from frontend. No write request is forwarded or fulfilled as successful.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const sourcePaths=['frontend/src/member-workspace.ts','frontend/src/styles.css','frontend/src/premium-theme.css','frontend/src/services/api.ts'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,digest(await readFile('../'+p))])));
const initial=await hashes(),testSha=digest(await readFile(new URL(import.meta.url))),results=[];
const keys=['overview','details','roles','postings','leave','duties','names','activity'];
const labels=['Overview','Details','Roles & eligibility','Postings','Leave','Duty history','Names & duplicates','Activity'];
const member={id:'tabs-complete-member',canonical_name:'Dr Complete Tab Review',active_status:'active',call_level:'2ND_CALL',effective_call_level:'2ND_CALL',revision:'tabs-one',aliases:[],designations:[],call_level_changes:[]};

for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:800},colorScheme:width===320?'dark':'light',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],reads=[],writes=[],roleResults=[];
  page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__profile_tabs_complete',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open member profile</button><button id="outside">Ordinary page action</button></body></html>'}));
  await page.route('**/api/**',route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   if(req.method()!=='GET'){writes.push({method:req.method(),path,body:req.postData()});return route.fulfill({status:599,json:{detail:'Mutations forbidden in tab presentation test'}});}
   reads.push(path);
   if(path==='/api/v1/admin/member-workspace/'+member.id)return route.fulfill({json:{member,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
   if(path==='/api/v1/extra-duty/ledger')return route.fulfill({json:[]});
   const match=path.match(/^\/api\/v1\/admin\/member-workspace\/tabs-complete-member\/(roles|postings|leave|duties|duplicates|activity)$/);
   assert.ok(match,'Only declared existing profile reads are allowed: '+path);
   return route.fulfill({json:{rows:[]}});
  });
  await page.goto(base+'/__profile_tabs_complete');
  for(const admin of [false,true]){
   await page.evaluate(admin=>{document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('tabs-complete-member',admin,()=>{}));},admin);
   await page.locator('#open').focus();await page.keyboard.press('Enter');
   const dialog=page.getByRole('dialog',{name:'Member profile',exact:true});
   const rail=dialog.getByRole('tablist',{name:'Member sections',exact:true});
   const selected=()=>rail.locator('[role=tab][aria-selected=true]');
   const tab=key=>rail.locator('[data-tab="'+key+'"]');
   await rail.waitFor();
   const settle=async()=>{await page.waitForLoadState('networkidle');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
   const expectFocus=async locator=>assert.equal(await locator.evaluate(el=>el===document.activeElement),true,'Expected native focus on '+await locator.evaluate(el=>el.outerHTML.slice(0,150))+'; actual '+JSON.stringify(await page.evaluate(()=>({element:document.activeElement?.outerHTML.slice(0,350),documentHasFocus:document.hasFocus()}))));
   const semantics=async(expected)=>{
    await settle();
    assert.equal(await rail.count(),1);assert.equal(await rail.getByRole('tab').count(),keys.length);
    assert.deepEqual(await rail.getByRole('tab').evaluateAll(es=>es.map(el=>el.getAttribute('data-tab'))),keys);
    assert.deepEqual(await rail.getByRole('tab').evaluateAll(es=>es.map(el=>{const copy=el.cloneNode(true);copy.querySelectorAll('[aria-hidden=true]').forEach(n=>n.remove());return copy.textContent.trim();})),labels);
    const snapshot=await rail.getByRole('tab').evaluateAll(es=>es.map(el=>({id:el.id,key:el.dataset.tab,selected:el.getAttribute('aria-selected'),index:el.getAttribute('tabindex'),controls:el.getAttribute('aria-controls')})));
    assert.equal(new Set(snapshot.map(s=>s.id)).size,keys.length);assert.ok(snapshot.every(s=>s.id));
    assert.equal(snapshot.filter(s=>s.selected==='true').length,1);assert.equal(snapshot.filter(s=>s.index==='0').length,1);
    assert.ok(snapshot.every(s=>s.selected===(s.key===expected?'true':'false')&&s.index===(s.key===expected?'0':'-1')));
    const panel=dialog.getByRole('tabpanel');assert.equal(await panel.count(),1);
    const panelId=await panel.getAttribute('id');assert.ok(panelId);assert.ok(snapshot.every(s=>s.controls===panelId));
    assert.equal(await panel.getAttribute('aria-labelledby'),snapshot.find(s=>s.key===expected).id);
    assert.equal(await panel.getAttribute('tabindex'),'0');
    for(const id of [...snapshot.map(s=>s.id),panelId])assert.equal(await page.locator('[id="'+id+'"]').count(),1,'Every tab/panel ID is unique in rendered document');
    assert.equal(await selected().getAttribute('data-tab'),expected);
   };
   const reveal=async()=>{
    const value=await rail.evaluate(el=>{const s=el.querySelector('[aria-selected=true]'),r=el.getBoundingClientRect(),t=s.getBoundingClientRect(),horizontal=getComputedStyle(el).flexDirection==='row';return{horizontal,revealed:horizontal?t.left>=r.left-1&&t.right<=r.right+1:t.top>=r.top-1&&t.bottom<=r.bottom+1};});
    assert.equal(value.revealed,true,'Selected tab must be fully revealed inside actual rail');return value.horizontal;
   };
   const cue=async()=>{
    const state=await rail.evaluate(el=>({horizontal:getComputedStyle(el).flexDirection==='row',overflow:getComputedStyle(el).flexDirection==='row'?el.scrollWidth>el.clientWidth+1:el.scrollHeight>el.clientHeight+1}));
    const instruction=dialog.locator('[data-member-sections-cue]');assert.equal(await instruction.count(),1);
    const id=await instruction.getAttribute('id');assert.ok(id);assert.equal(await page.locator('[id="'+id+'"]').count(),1,'Unique cue ID');
    const relation=await rail.getAttribute('aria-describedby');
    assert.equal(await instruction.isVisible(),state.overflow,'Scroll cue visibility must match real axis overflow');
    if(state.overflow){
     assert.ok(relation,'Overflowing tab rail must expose discoverable scroll instructions');const ids=relation.trim().split(/\s+/);assert.equal(new Set(ids).size,ids.length);assert.ok(ids.includes(id));
     const visibleEdges=await rail.evaluate(el=>{const r=el.getBoundingClientRect(),horizontal=getComputedStyle(el).flexDirection==='row',boxes=[...el.querySelectorAll('[role=tab]')].map(t=>t.getBoundingClientRect());return{before:boxes.some(t=>horizontal?t.left<r.left-1:t.top<r.top-1),after:boxes.some(t=>horizontal?t.right>r.right+1:t.bottom>r.bottom+1)};});
     const {before,after}=visibleEdges;
     const direction=state.horizontal?(before&&after?'to the left and right':before?'to the left':'to the right'):(before&&after?'above and below':before?'above':'below');
     assert.equal(await instruction.innerText(),`More sections ${direction}. Scroll or use ${state.horizontal?'Left/Right':'Up/Down'} arrow keys on a tab.`);
     assert.equal(await instruction.getAttribute('tabindex'),null,'Cue adds no keyboard stop');assert.equal(await instruction.getAttribute('aria-live'),null,'Cue does not repeatedly announce passive scrolling');
    }
    else assert.equal(relation,null,'Nonoverflowing rail has no obsolete scroll description');
    return state;
   };
   const navigate=async()=>{
    const horizontal=await rail.evaluate(el=>getComputedStyle(el).flexDirection==='row');
    assert.equal(await rail.getAttribute('aria-orientation'),horizontal?'horizontal':'vertical');
    const forward=horizontal?'ArrowRight':'ArrowDown',reverse=horizontal?'ArrowLeft':'ArrowUp';
    await tab('overview').focus();await page.keyboard.press('Enter');await semantics('overview');await expectFocus(tab('overview'));
    for(let i=1;i<=keys.length;i++){await page.keyboard.press(forward);const key=keys[i%keys.length];await semantics(key);await expectFocus(tab(key));await reveal();}
    await page.keyboard.press(reverse);await semantics('activity');await expectFocus(tab('activity'));await reveal();
    for(let i=keys.length-2;i>=0;i--){await page.keyboard.press(reverse);await semantics(keys[i]);await expectFocus(tab(keys[i]));await reveal();}
    await page.keyboard.press('End');await semantics('activity');await expectFocus(tab('activity'));await reveal();
    await page.keyboard.press('Home');await semantics('overview');await expectFocus(tab('overview'));await reveal();
    for(const key of horizontal?['ArrowUp','ArrowDown']:['ArrowLeft','ArrowRight']){await page.keyboard.press(key);await semantics('overview');await expectFocus(tab('overview'));}
    await page.keyboard.press('End');await semantics('activity');await page.keyboard.press('Tab');await expectFocus(dialog.getByRole('tabpanel'));
    await page.keyboard.press('Shift+Tab');await expectFocus(tab('activity'));
    await page.keyboard.press('Shift+Tab');await expectFocus(dialog.locator('[data-close]'));
    await page.keyboard.press('Tab');await expectFocus(tab('activity'));
    await page.keyboard.press('Tab');await expectFocus(dialog.getByRole('tabpanel'));
    await page.keyboard.press('Tab');
    const terminalTab=await page.evaluate(()=>({activeTag:document.activeElement?.tagName,activeRole:document.activeElement?.getAttribute('role'),activeDataTab:document.activeElement?.getAttribute('data-tab'),documentHasFocus:document.hasFocus(),insideTablist:!!document.activeElement?.closest('[role=tablist]')}));
    // The last native modal stop can hand focus to browser chrome; engines
    // differ in their activeElement representation there. Requirement 125 does
    // not authorize a custom dialog trap or require immediate Close wrapping.
    if(admin)await expectFocus(dialog.locator('[data-edit]'));
    else assert.equal(terminalTab.insideTablist,false,'Leaving the panel must not restart the roving tab pattern');
    if(admin){await page.keyboard.press('Shift+Tab');await expectFocus(dialog.getByRole('tabpanel'));}
    await tab('details').focus();await page.keyboard.press('Enter');await semantics('details');
    await page.keyboard.press('Tab');await expectFocus(dialog.getByRole('tabpanel'));await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement?.closest('[role=tablist]')===null),true,'Tab reaches ordinary profile controls outside tab pattern');
    assert.equal(await page.evaluate(()=>document.activeElement?.closest('dialog.member-workspace')!==null),true);
    return{orientation:horizontal?'horizontal':'vertical',forwardReverseAllTabsAndWrap:true,homeEnd:true,perpendicularKeysInert:true,panelCloseAndOrdinaryControlNativeTab:true,adminFooterNativeTab:admin,terminalTabObservation:terminalTab};
   };
   const navigation=[];
   for(const viewport of [{width:1280,height:800},{width:320,height:800}]){await page.setViewportSize(viewport);await settle();navigation.push(await navigate());await cue();}
   // Reflow must preserve both the current section and current active element.
   await tab('activity').focus();await page.keyboard.press('Enter');await semantics('activity');
   const reflows=[];
   for(const [viewWidth,height,containerWidth]of [[1280,800,null],[320,800,null],[1280,320,null],[1280,800,360],[1280,800,699],[1280,800,703],[1280,800,null]]){
    await page.setViewportSize({width:viewWidth,height});await dialog.evaluate((el,size)=>{el.style.width=size?size+'px':'';el.style.maxWidth=size?size+'px':'';},containerWidth);await settle();
    await semantics('activity');await expectFocus(tab('activity'));const horizontal=await reveal(),cueState=await cue();
    assert.equal(await rail.getAttribute('aria-orientation'),horizontal?'horizontal':'vertical');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'No page-level horizontal overflow');
    reflows.push({viewport:{width:viewWidth,height},containerWidth,orientation:horizontal?'horizontal':'vertical',cue:cueState,selectedAndFocusRetained:true});
   }
   await tab('details').focus();await page.keyboard.press('Enter');await semantics('details');
   const ordinary=dialog.locator('[data-field=canonical_name]');await ordinary.focus();
   for(const [viewWidth,height,containerWidth]of [[320,800,null],[1280,320,null],[1280,800,360],[1280,800,null]]){
    await page.setViewportSize({width:viewWidth,height});await dialog.evaluate((el,size)=>{el.style.width=size?size+'px':'';el.style.maxWidth=size?size+'px':'';},containerWidth);await settle();
    await semantics('details');await expectFocus(ordinary);await reveal();await cue();
   }
   // Native horizontal wheel changes the cue without activating another section
   // or moving focus away from an ordinary profile field.
   await page.setViewportSize({width:320,height:800});await settle();await ordinary.focus();
   const wheelTrace=[];
   const wheelToEdge=async direction=>{
    for(let attempt=0;attempt<12;attempt++){
     const before=await rail.evaluate(el=>({left:el.scrollLeft,max:el.scrollWidth-el.clientWidth}));
     if(direction<0?before.left<=1:before.left>=before.max-1)return;
     const box=await rail.boundingBox();assert.ok(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
     await page.mouse.wheel(direction*10000,0);
     // Gecko can clamp one wheel event to roughly one viewport. Require real
     // progress per native event, then repeat toward the edge with a hard bound.
     await page.waitForFunction(({previous,direction})=>{const r=document.querySelector('dialog.member-workspace .mw-rail');return r&&direction*(r.scrollLeft-previous)>.5;},{previous:before.left,direction},{timeout:3000});
     await settle();const after=await rail.evaluate(el=>({left:el.scrollLeft,max:el.scrollWidth-el.clientWidth}));
     assert.ok(direction*(after.left-before.left)>.5,'Every wheel attempt must make actual progress');
     wheelTrace.push({direction,attempt,before,after});await cue();await expectFocus(ordinary);assert.equal(await selected().getAttribute('data-tab'),'details');
    }
    const final=await rail.evaluate(el=>({left:el.scrollLeft,max:el.scrollWidth-el.clientWidth}));
    assert.ok(direction<0?final.left<=1:final.left>=final.max-1,'Bounded native wheel attempts must reach the actual edge: '+JSON.stringify(final));
   };
   await wheelToEdge(-1);await settle();
   await cue();await expectFocus(ordinary);assert.equal(await selected().getAttribute('data-tab'),'details');assert.match(await dialog.locator('[data-member-sections-cue]').innerText(),/to the right\./);
   await wheelToEdge(1);await settle();
   await cue();await expectFocus(ordinary);assert.equal(await selected().getAttribute('data-tab'),'details');assert.match(await dialog.locator('[data-member-sections-cue]').innerText(),/to the left\./);
   await wheelToEdge(-1);await settle();await cue();await expectFocus(ordinary);assert.match(await dialog.locator('[data-member-sections-cue]').innerText(),/to the right\./);
   if(admin)assert.equal(await dialog.locator('[data-edit]').count(),1);else assert.equal(await dialog.locator('[data-edit]').count(),0);
   await dialog.locator('[data-close]').focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'detached'});await expectFocus(page.locator('#open'));
   await page.keyboard.press('Tab');await expectFocus(page.locator('#outside'));
   roleResults.push({admin,navigation,reflows,ordinaryControlFocusRetainedAcrossFourReflows:true,nativeRailWheelUpdatesBothCueDirectionsWithoutFocusOrSelectionChange:true,nativeWheelProgress:wheelTrace,roleEditGateRetained:true,closedProfileRestoresOpenerAndPageTab:true});
  }
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  results.push({engine,initialWidth:width,theme:width===320?'dark':'light',roles:roleResults,localGetRequests:reads,interceptedMutations:0,forwardedRequests:0,javascriptErrors:errors});
  await context.close();console.log('Complete profile tabs',engine,width);
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Application source held unchanged during browser run');
assert.equal(digest(await readFile(new URL(import.meta.url))),testSha,'Test source held unchanged during browser run');
await writeFile('../docs/premium-ui/qa-original031-mounted-profile-tabs-applied.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),target_url:base,source_sha256:initial,test_sha256:testSha,requirements:[123,125],scope:'Actual canonical profile in isolated CSS harness; six engine/initial-width contexts, two existing role presentations each. Complete native orientation keyboard/roving semantics and panel/close/footer/ordinary navigation, selected/ordinary focus and section preservation through mobile/desktop/short-height/container reflow, actual-overflow cue truth and unique description IDs. All API GETs locally fulfilled; no API writes, backend authorization/persistence, legacy-profile, native-screenreader or physical-device certification.',results},null,2)+'\n');
console.log('Complete profile tab workflows: '+results.length+' contexts, '+results.reduce((sum,r)=>sum+r.roles.length,0)+' role variants');

for(const[path,digest]of Object.entries(heldNumericCssSources))assertNumericCss.equal(numericCssSha(await readNumericCssSource('../'+path)),digest,'Applied numeric source unchanged at final gate '+path);
