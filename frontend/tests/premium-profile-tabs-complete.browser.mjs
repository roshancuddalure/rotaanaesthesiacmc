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
await writeFile('../docs/premium-ui/qa-profile-tabs-complete.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),target_url:base,source_sha256:initial,test_sha256:testSha,requirements:[123,125],scope:'Actual canonical profile in isolated CSS harness; six engine/initial-width contexts, two existing role presentations each. Complete native orientation keyboard/roving semantics and panel/close/footer/ordinary navigation, selected/ordinary focus and section preservation through mobile/desktop/short-height/container reflow, actual-overflow cue truth and unique description IDs. All API GETs locally fulfilled; no API writes, backend authorization/persistence, legacy-profile, native-screenreader or physical-device certification.',results},null,2)+'\n');
console.log('Complete profile tab workflows: '+results.length+' contexts, '+results.reduce((sum,r)=>sum+r.roles.length,0)+' role variants');
