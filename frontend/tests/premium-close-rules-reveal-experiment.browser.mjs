import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Exported controller launches use native fixture buttons. Private nested dialogs
// use their real in-controller controls; leave-day uses the actual app route.
// CLOSE_EXPECT_SVG=0 records the current glyph baseline, never a migrated pass.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api='http://127.0.0.1:8031';
const expectSvg=process.env.CLOSE_EXPECT_SVG!=='0',probe=process.env.CLOSE_PROBE==='1';
const modules=['admin-delete','admin-preview','main','member-bulk','member-duplicates','member-workspace','operational-import','record-workspace','reference-workspace','rota-rules','decorative-icons','ui','workspace-load-state','shell-accessibility','import-review-presentation','member-presentation'];
const paths=[...modules.map(n=>'src/'+n+'.ts'),'src/services/api.ts','src/styles.css','src/premium-theme.css','tests/premium-close-rules-reveal-experiment.browser.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const initial=await hashes(),results=[];
const native=async(page,node)=>{await node.focus();await page.keyboard.press('Enter');};
const member={id:'close-person',canonical_name:'Dr A Long Department Member Name For Close Alignment Review',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[],revision:'one'};
const unit={id:'close-unit',name:'Close fixture unit',code:'CLOSE',campus:'Main',minimum_free_people:1,active_status:'active',aliases:[],call_minimums:[],usage:{postings:0,duties:0,future_postings:0,future_duties:0,selected_members:0}};
const reference={key:'ANNUAL_LEAVE',id:'close-reference',label:'Annual leave fixture',active:true,aliases:[],behavior:{},usage:{records:0},revision:'one'};
const sections={duty_count_limits:{max_24hr_per_month:8,max_weekend_24hr_per_month:null,max_same_group_per_month:null,max_same_campus_per_month:null},rest_rules:{minimum_gap_after_24hr_hours:24,post_24hr_blocks_next_day_elective:true},unit_staffing_rules:{minimum_available_count:1,warning_unavailable_percent:30,hard_block_unavailable_percent:40,small_unit_uses_absolute_minimum:true},fairness_rules:{max_gap_within_call_level:1,target_mode:'auto'},extra_duty_rules:{justice_lookback_months:12}};
const rule={key:'CLOSE_DUTY',label:'Close fixture duty',group:'pac',campus:'Main',duration_hours:8,start_time:'08:00',end_time:'16:00',is_24hr:false,counts_in_main_24hr:false,is_mandatory:false,is_adjustable:true,blocks_elective_same_day:false,blocks_elective_next_day:false,active:true,allowed_call_levels:['3RD_CALL'],allowed_cluster_keys:[],excluded_cluster_keys:[],allowed_designations:[],allowed_units:[],excluded_units:[]};
const rules={revision:'close-one',groups:[],units:[],rule_version:{id:'close-version',name:'Close fixture',description:null,effective_from:'2026-01-01',effective_to:null,is_active:true,created_at:'2026-01-01T00:00:00Z'},duty_rules:[rule],...sections};
const surfaces=[['rules-saved','Close review']];
for(const [engine,launcher] of Object.entries({webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320])for(const theme of ['light'])for(const input of ['click']){
  const context=await browser.newContext({viewport:{width,height:800},colorScheme:theme,reducedMotion:'reduce',hasTouch:true}),page=await context.newPage();page.setDefaultTimeout(12000);
  const errors=[],unexpected=[],reads=[],checks=[],saves=[],placements=[],navigationPrompts=[],menuTargets=[];let saved=false,surface='',allowNavigation=false;
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{if(allowNavigation&&d.type()==='beforeunload'){navigationPrompts.push(d.type());return d.accept();}return d.dismiss();});
  const navigate=async url=>{allowNavigation=true;try{await page.goto(url);}finally{allowNavigation=false;}};
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','close-icon-fixture');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/__close_icons',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open actual controller</button><main id="root"></main></body></html>'}));

  await page.route('**/src/rota-rules.ts',async route=>{
    const response=await route.fetch();let body=await response.text();
    const capture='const ownsReviewFocus = document.activeElement === st.page.querySelector("[data-review], [data-save-refresh]");';
    assert.equal(body.split(capture).length,2,'Observe actual compiled ownership capture exactly once');
    body=body.replace(capture,capture+' window.__currentRuleCloseState=[{label:"ownership-capture",ownsReviewFocus,active:document.activeElement?.outerHTML.slice(0,300),selected:st.page.querySelector("[data-review], [data-save-refresh]")?.outerHTML.slice(0,300)}];');
    const condition='if (ownsReviewFocus && st.root.isConnected';
    assert.equal(body.split(condition).length,2,'Observe actual compiled close guard exactly once');
    body=body.replace(condition,'window.__currentRuleCloseState.push({label:"before-owned-close-guard",ownsReviewFocus,rootConnected:st.root.isConnected,pageContained:st.root.contains(st.page),changes:changeCount(st),confirmed:saved?.confirmed,sameSave:st.saveOperation===saved,active:document.activeElement?.outerHTML.slice(0,300),activeTag:document.activeElement?.tagName,body:document.activeElement===document.body,recovery:st.page.querySelector("[data-save-refresh]")?.outerHTML}); '+condition);
    const focusLine='st.page.querySelector("[data-review], [data-save-refresh]")?.focus({ preventScroll: true });';
    assert.equal(body.split(focusLine).length,2,'Observe recovery focus exactly once');
    const snapshot='const target=st.page.querySelector("[data-review], [data-save-refresh]"); const rect=target?.getBoundingClientRect(); const ancestors=[];for(let n=target;n;n=n.parentElement){const c=getComputedStyle(n);ancestors.push({tag:n.tagName,class:n.className,hidden:n.hidden,disabled:n.disabled,inert:n.inert,display:c.display,visibility:c.visibility,contentVisibility:c.contentVisibility});} window.__currentRuleCloseState.push({label,activeTag:document.activeElement?.tagName,active:document.activeElement?.outerHTML.slice(0,300),target:target?.outerHTML,connected:target?.isConnected,disabled:target?.disabled,inert:target?.inert,ancestorInert:target?.closest("[inert]")?.outerHTML.slice(0,200),rect:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null,ancestors,matches:[...st.page.querySelectorAll("[data-review], [data-save-refresh]")].map(n=>({html:n.outerHTML,connected:n.isConnected,rect:n.getBoundingClientRect().toJSON(),disabled:n.disabled})),display:target?getComputedStyle(target).display:null,visibility:target?getComputedStyle(target).visibility:null,dialogCount:document.querySelectorAll("dialog[open]").length});';
    body=body.replace(focusLine,'{ const recoveryTarget = st.page.querySelector("[data-review], [data-save-refresh]"); recoveryTarget?.scrollIntoView({block:"nearest",behavior:"instant"}); recoveryTarget?.focus({preventScroll:true}); }'+' const observeRecoveryFocus=(label)=>{'+snapshot+'}; observeRecoveryFocus("after-focus"); queueMicrotask(()=>observeRecoveryFocus("microtask-after-focus")); requestAnimationFrame(()=>observeRecoveryFocus("frame-after-focus"));');
    return route.fulfill({response,body});
  });
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;
   if(req.method()==='POST'&&path==='/api/v1/admin/delete/preview'){checks.push({surface,path,body:req.postDataJSON()});return route.fulfill({json:{preview_token:'delete-read-only',count:0,items:[],blocked:[],effects:{}}});}
   if(req.method()==='POST'&&path==='/api/v1/normalization/members/resolve'){checks.push({surface,path,body:req.postDataJSON()});return route.fulfill({json:{candidates:[]}});}
   if(req.method()==='POST'&&path.endsWith('/rota-rules/phase-one/check')){checks.push({surface,path,body:req.postDataJSON()});return route.fulfill({json:{problems:[],duties:{}}});}
   if(req.method()==='PUT'&&path.endsWith('/rota-rules/phase-one')&&surface==='rules-saved'){saves.push({surface,path,body:req.postDataJSON()});saved=true;return route.fulfill({json:{saved:true}});}
   if(req.method()!=='GET'){unexpected.push({surface,path,method:req.method()});return route.abort();}
   reads.push({surface,path});
   if(surface==='leave-day')return route.fulfill({response:await route.fetch({url:api+path+url.search})});
   if(path==='/api/v1/admin/member-workspace/'+member.id)return route.fulfill({json:{member,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
   if(path.startsWith('/api/v1/admin/member-workspace/'+member.id+'/'))return route.fulfill({json:{rows:[]}});
   if(path==='/api/v1/admin/members')return route.fulfill({json:[member]});
   if(path==='/api/v1/admin/members/archive-all/preview')return route.fulfill({json:{members:2,linked_duties:0,future_duties:0,leave:0,postings:0,preview_token:'close-archive-read-only',confirm_phrase:'ARCHIVE 2 MEMBERS'}});
   if(['/api/v1/admin/members/archive-all/batches','/api/v1/admin/members/suspected-duplicates','/api/v1/admin/members/merges'].includes(path))return route.fulfill({json:[]});
   if(path==='/api/v1/normalization/units')return route.fulfill({json:[unit]});
   if(path.startsWith('/api/v1/normalization/catalog/'))return route.fulfill({json:[reference]});
   if(path==='/api/v1/normalization/activity')return route.fulfill({json:[]});
   if(path.endsWith('/rota-rules/phase-one/versions'))return route.fulfill({json:[]});
   if(path.endsWith('/rota-rules/phase-one'))return saved?route.fulfill({status:503,json:{detail:'Controlled saved-details readback unavailable'}}):route.fulfill({json:rules});
   unexpected.push({surface,path,method:req.method()});return route.abort();
  });
  for(const [kind,name] of surfaces){surface=kind;saved=false;
   let opener,dialog;
   if(kind==='leave-day'){
    await navigate(base+'/#view=leave');await page.locator('[data-leave-day]').first().waitFor();await page.waitForLoadState('networkidle');
    if(width===320){
     const menuOpen=page.locator('#sidebar-toggle'),menuClose=page.locator('#sidebar-close');
     const openGeometry=await menuOpen.boundingBox();assert.ok(openGeometry&&openGeometry.width>=43.9&&openGeometry.height>=43.9&&openGeometry.x>=-1&&openGeometry.x+openGeometry.width<=width+1,'Actual mobile menu opener is44px and fits header');menuTargets.push({label:'open',...openGeometry});
     await native(page,menuOpen);await menuClose.waitFor({state:'visible'});
     const closeGeometry=await menuClose.boundingBox();assert.ok(closeGeometry&&closeGeometry.width>=43.9&&closeGeometry.height>=43.9&&closeGeometry.x>=-1&&closeGeometry.x+closeGeometry.width<=width+1,'Actual mobile menu close is44px and fits drawer');menuTargets.push({label:'close',...closeGeometry});
     if(input==='keyboard')await native(page,menuClose);else if(input==='click')await menuClose.click();else await menuClose.tap();
     await page.waitForFunction(()=>document.activeElement===document.querySelector('#sidebar-toggle'));
    }
    opener=page.locator('[data-leave-day]').first();await native(page,opener);dialog=page.locator('#leave-day-modal');
   }else{
    await navigate(base+'/__close_icons');
    await page.evaluate(kind=>{
     document.querySelector('#open').onclick=async()=>{
      const noop=()=>{};
      if(kind==='delete')return (await import('/src/admin-delete.ts')).confirmAdminDelete({kind:'member',ids:['close-person'],title:'close-only deletion'});
      if(kind==='preview')return (await import('/src/admin-preview.ts')).reviewAndApply({title:'close-only review',intro:'Controlled read-only preview',confirmLabel:'Apply',run:async()=>({preview_token:'close-preview',rows:[]}),sections:()=>[],changeCount:()=>0,onApplied:()=>{throw Error('Unexpected preview Apply');}});
      if(kind==='archive')return (await import('/src/member-bulk.ts')).openArchiveAll(noop);
      if(kind==='duplicates')return (await import('/src/member-duplicates.ts')).openSuspectedDuplicates(noop);
      if(kind==='profile')return (await import('/src/member-workspace.ts')).openMemberWorkspace('close-person',true,noop,[],'details');
      if(kind==='csv')return (await import('/src/member-workspace.ts')).openMemberCsvImport(noop);
      if(kind==='create')return (await import('/src/operational-import.ts')).createMemberInline('Close candidate',noop);
      if(kind==='import')return (await import('/src/operational-import.ts')).openOperationalImport('leave','2026-11',noop,true);
      if(kind==='record')return (await import('/src/record-workspace.ts')).openRecordEditor('leave','close-person',undefined,true,noop);
      if(kind==='mapping')return (await import('/src/reference-workspace.ts')).openMappingCreator(noop);
      if(kind==='units')return (await import('/src/reference-workspace.ts')).openUnitRegistry(noop,'close-unit');
      if(['catalog','activity'].includes(kind))return (await import('/src/reference-workspace.ts')).openReferenceCatalog(noop,'leave_type');
      if(kind.startsWith('rules-'))return (await import('/src/rota-rules.ts')).renderRotaRulesPage(document.querySelector('#root'),{onNavigate:noop});
     };
    },kind);
    opener=page.locator('#open');await native(page,opener);
    if(kind==='activity'){
     const parent=page.locator('dialog').last();await native(page,parent.locator('[data-key="ANNUAL_LEAVE"]'));opener=parent.locator('[data-reference-history]');await native(page,opener);
    }
    if(kind.startsWith('rules-')){
     if(kind==='rules-history'){opener=page.locator('[data-act=history]');await native(page,opener);}
     else{const duty=page.locator('[data-duty-row=CLOSE_DUTY]');await native(page,duty.locator('[data-toggle-duty]'));await duty.locator('[data-text-field=label]').fill('Close fixture edited');opener=page.locator('[data-review]');await native(page,opener);
      if(kind==='rules-saved'){const review=page.locator('dialog').last();await review.locator('[data-save]:not([disabled])').waitFor();await native(page,review.locator('[data-save]'));await review.getByRole('heading',{name:'Rules saved',exact:true}).waitFor();await review.getByText('Controlled saved-details readback unavailable',{exact:false}).waitFor();opener=page.locator('[data-save-refresh]');}
     }
    }
    dialog=page.locator('dialog').last();
   }
   const close=dialog.getByRole('button',{name,exact:true});await close.waitFor();
   // Wait until actual ready markup appears, not the common loading close control.
   if(kind==='profile')await dialog.locator('[data-edit]').waitFor();
   if(kind==='archive')await dialog.locator('[data-phrase]').waitFor();
   if(kind==='create')await dialog.getByText('No matching identities found.',{exact:true}).waitFor();
   const geometry=await close.evaluate((button,expectSvg)=>{
    const b=button.getBoundingClientRect(),header=button.closest('header'),h=header?.getBoundingClientRect(),svg=button.querySelector('svg'),s=svg?getComputedStyle(svg):null,r=svg?.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
    return{button:{x:b.x,y:b.y,width:b.width,height:b.height},header:h?{x:h.x,y:h.y,width:h.width,height:h.height}:null,name:button.getAttribute('aria-label'),hit:hit===button||button.contains(hit),svg:svg?{hidden:svg.getAttribute('aria-hidden'),focusable:svg.getAttribute('focusable'),viewBox:svg.getAttribute('viewBox'),strokeWidth:s.strokeWidth,stroke:s.stroke,width:r.width,height:r.height,x:r.x,y:r.y,paths:svg.querySelectorAll('path').length}:null,glyph:button.textContent.trim(),expectedSvg:expectSvg};
   },expectSvg);
   assert.equal(geometry.name,name);assert.ok(geometry.hit&&geometry.button.width>=43.9&&geometry.button.height>=43.9,kind+': named target remains at least44 and hit-testable '+JSON.stringify(geometry));
   assert.ok(geometry.button.x>=-1&&geometry.button.x+geometry.button.width<=width+1&&geometry.button.y>=-1&&geometry.button.y+geometry.button.height<=801,kind+': close fits viewport');
   if(expectSvg){assert.ok(geometry.svg,kind+': shared SVG present');assert.equal(geometry.svg.hidden,'true');assert.equal(geometry.svg.focusable,'false');assert.equal(geometry.svg.viewBox,'0 0 24 24');assert.equal(geometry.svg.strokeWidth,'2px');assert.ok(geometry.svg.stroke!=='none'&&geometry.svg.paths>0);assert.ok(Math.abs(geometry.svg.width-24)<.1&&Math.abs(geometry.svg.height-24)<.1);assert.ok(Math.abs(geometry.svg.x+12-(geometry.button.x+geometry.button.width/2))<=1&&Math.abs(geometry.svg.y+12-(geometry.button.y+geometry.button.height/2))<=1,kind+': optical box centered');}
   else{assert.equal(geometry.svg,null);assert.equal(geometry.glyph,'×');}
   const readCount=reads.length,checkCount=checks.length,saveCount=saves.length;
   let pointerEvent;
   if(kind==='leave-day'){
    await page.evaluate(()=>{window.closePointerEvents=[];document.addEventListener('click',event=>{const target=event.target;if(target instanceof Element&&target.closest('[data-close-leave-day-modal]'))window.closePointerEvents.push({tag:target.tagName,class:target.getAttribute('class'),matchesButton:target.matches('[data-close-leave-day-modal]')});},{capture:true});});
    const firstDialog=await dialog.elementHandle();
    // Actual pointer coordinates over the new SVG, with no force/dispatch.
    await page.mouse.click(geometry.svg?geometry.svg.x+geometry.svg.width/2:geometry.button.x+geometry.button.width/2,geometry.svg?geometry.svg.y+geometry.svg.height/2:geometry.button.y+geometry.button.height/2);
    await page.waitForFunction(node=>!node.isConnected,firstDialog);
    pointerEvent=await page.evaluate(()=>window.closePointerEvents.at(-1));assert.ok(pointerEvent?.matchesButton,'Decorative SVG/path must preserve existing target.matches delegate');
    await page.waitForFunction(node=>document.activeElement===node,await opener.elementHandle());
    await native(page,opener);await dialog.waitFor();
   }
   await page.evaluate(()=>{window.actualCloseEvents=[];document.addEventListener('click',event=>{const target=event.target;if(target instanceof Element){const button=target.closest('[data-close],[data-close-leave-day-modal]');if(button)window.actualCloseEvents.push({tag:target.tagName,class:target.getAttribute('class'),buttonName:button.getAttribute('aria-label'),targetMatchesButton:target===button});}},{capture:true,once:true});});
   await page.evaluate(()=>{window.rulesCloseTrace=[];const snap=label=>{const a=document.activeElement;window.rulesCloseTrace.push({label,activeTag:a?.tagName,activeId:a?.id,activeMarkup:a?.outerHTML.slice(0,500),recoveryCount:document.querySelectorAll('[data-save-refresh]').length,dialogOpen:document.querySelector('dialog')?.open});};window.rulesCloseSnap=snap;snap('before-click');for(const type of ['pointerdown','mousedown','mouseup','click','focusin','focusout'])document.addEventListener(type,e=>snap(type+':'+e.target.tagName),true);document.querySelector('dialog').addEventListener('close',()=>snap('close-event-after-app'));});
   const actualDialog=await dialog.elementHandle();
   if(input==='keyboard')await native(page,close);
   else if(input==='click')await close.click();
   else await close.tap();
   await page.waitForFunction(node=>!node.isConnected,actualDialog);
   const actualCloseEvent=await page.evaluate(()=>window.actualCloseEvents.at(-1));assert.equal(actualCloseEvent?.buttonName,name,'Actual close activation targets named button or its decorative descendant');
   if(kind==='rules-saved')try{await page.waitForFunction(()=>document.activeElement?.matches('[data-save-refresh]'),null,{timeout:3000});}catch(error){await page.evaluate(()=>window.rulesCloseSnap('after-timeout'));await writeFile('../tmp/close37-webkit-rules-focus-reveal-experiment.json',JSON.stringify({source_sha256:initial,trace:await page.evaluate(()=>window.rulesCloseTrace),observedState:await page.evaluate(()=>window.__currentRuleCloseState),observability:'Response-only proposed targeted instant reveal before existing guarded focus; no application filesystem changes. Not current application proof.'},null,2)+'\n');await page.screenshot({path:'../tmp/close37-webkit-rules-focus-reveal-experiment.png'});throw error;}
   else await page.waitForFunction(node=>document.activeElement===node,await opener.elementHandle());
   await writeFile('../tmp/close37-webkit-rules-focus-reveal-experiment-success.json',JSON.stringify({source_sha256:initial,trace:await page.evaluate(()=>window.rulesCloseTrace),observedState:await page.evaluate(()=>window.__currentRuleCloseState),observability:'Response-only proposed targeted instant reveal before existing guarded focus; no application filesystem changes. Not current application proof.'},null,2)+'\n');
   assert.ok((await page.locator('[data-save-refresh]').boundingBox()).y>=-1,'Proposed recovery control visible');assert.equal(reads.length,readCount,kind+': close does not read');assert.equal(checks.length,checkCount,kind+': close does not validate');assert.equal(saves.length,saveCount,kind+': close does not save');
   assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);placements.push({kind,name,input,geometry,pointerEvent,actualCloseEvent,closeRestoredExactOpener:kind!=='rules-saved',closeRestoredCurrentRecoveryControl:kind==='rules-saved',noCloseRequest:true});
   console.log(`Close placement ${engine} ${width} ${theme} ${input} ${kind}`);
  }
  assert.equal(placements.length,1);assert.equal(saves.length,1,'Only one locally fulfilled saved-state fixture PUT; never sent to backend');
  results.push({engine,width,theme,input,placements,menuTargets,reads,checks,saves,navigationPrompts,unexpected,errors,backendWrites:0});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Held app/test snapshot');
await writeFile('../tmp/close37-reveal-experiment-placements'+(probe?'-probe':expectSvg?'':'-before')+'.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,migratedSvgExpected:expectSvg,scope:'Seventeen named close markup instances: actual exported controllers use native fixture launchers, private activity/Rules dialogs use actual in-controller launchers, leave-day uses actual signed-in shell. Three engines/lightdark/3201280 and native keyboard/click/tap close modalities when not probe. All APIs fulfilled locally except GET-only RAM shell. One locally intercepted incomplete Rules PUT and subsequent503readback per context creates the saved-refresh close variant; no backend mutation. No whole37acceptance.',limitations:['Keyboard, true mouse click and emulated native tap; no physical device/nativeAT/fullbuttonaudit.','Normal800pxheight only in this matrix; reduced-height/enlarged-text cases require separate evidence.','Refused-discard and pending-save guards retain existing separate lifecycle regression tests; this matrix does not independently re-exercise every dirty/pending branch.','The source classifier retains remaining meaningful/status symbols for separately justified handling; named close migration alone does not finish37.'],results},null,2)+'\n');
console.log(`Close icon contexts: ${results.length}; placements: ${results.reduce((n,c)=>n+c.placements.length,0)}`);
