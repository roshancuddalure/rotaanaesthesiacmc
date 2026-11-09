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
const paths=[...modules.map(n=>'src/'+n+'.ts'),'src/services/api.ts','src/styles.css','src/premium-theme.css','tests/premium-close-icon-placements.browser.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const initial=await hashes(),results=[];
const native=async(page,node)=>{await node.focus();await page.keyboard.press('Enter');};
const member={id:'close-person',canonical_name:'Dr A Long Department Member Name For Close Alignment Review',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[],revision:'one'};
const unit={id:'close-unit',name:'Close fixture unit',code:'CLOSE',campus:'Main',minimum_free_people:1,active_status:'active',aliases:[],call_minimums:[],usage:{postings:0,duties:0,future_postings:0,future_duties:0,selected_members:0}};
const reference={key:'ANNUAL_LEAVE',id:'close-reference',label:'Annual leave fixture',active:true,aliases:[],behavior:{},usage:{records:0},revision:'one'};
const sections={duty_count_limits:{max_24hr_per_month:8,max_weekend_24hr_per_month:null,max_same_group_per_month:null,max_same_campus_per_month:null},rest_rules:{minimum_gap_after_24hr_hours:24,post_24hr_blocks_next_day_elective:true},unit_staffing_rules:{minimum_available_count:1,warning_unavailable_percent:30,hard_block_unavailable_percent:40,small_unit_uses_absolute_minimum:true},fairness_rules:{max_gap_within_call_level:1,target_mode:'auto'},extra_duty_rules:{justice_lookback_months:12}};
const rule={key:'CLOSE_DUTY',label:'Close fixture duty',group:'pac',campus:'Main',duration_hours:8,start_time:'08:00',end_time:'16:00',is_24hr:false,counts_in_main_24hr:false,is_mandatory:false,is_adjustable:true,blocks_elective_same_day:false,blocks_elective_next_day:false,active:true,allowed_call_levels:['3RD_CALL'],allowed_cluster_keys:[],excluded_cluster_keys:[],allowed_designations:[],allowed_units:[],excluded_units:[]};
const rules={revision:'close-one',groups:[],units:[],rule_version:{id:'close-version',name:'Close fixture',description:null,effective_from:'2026-01-01',effective_to:null,is_active:true,created_at:'2026-01-01T00:00:00Z'},duty_rules:[rule],...sections};
const surfaces=[['delete','Close close-only deletion'],['preview','Close close-only review'],['archive','Close clear all members'],['duplicates','Close Possible duplicate members'],['profile','Close member profile'],['csv','Close import'],['create','Close member creation'],['import','Close import review'],['record','Close editor'],['mapping','Close mapping creation'],['units','Close unit management'],['catalog','Close reference management'],['activity','Close activity'],['rules-review','Close review'],['rules-history','Close history'],['rules-saved','Close review'],['leave-day','Close']];
for(const [engine,launcher] of Object.entries(probe?{chromium}:process.env.CLOSE_ENGINES?Object.fromEntries(process.env.CLOSE_ENGINES.split(',').map(name=>[name,{chromium,firefox,webkit}[name]])):{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of probe?[320]:[320,1280])for(const theme of probe?['light']:['light','dark'])for(const input of probe?['keyboard']:['keyboard','click','tap']){
  const context=await browser.newContext({viewport:{width,height:800},colorScheme:theme,reducedMotion:'reduce',hasTouch:true}),page=await context.newPage();page.setDefaultTimeout(12000);
  const errors=[],unexpected=[],reads=[],checks=[],saves=[],placements=[],navigationPrompts=[],menuTargets=[];let saved=false,surface='',allowNavigation=false;
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{if(allowNavigation&&d.type()==='beforeunload'){navigationPrompts.push(d.type());return d.accept();}return d.dismiss();});
  const navigate=async url=>{allowNavigation=true;try{await page.goto(url);}finally{allowNavigation=false;}};
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','close-icon-fixture');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/__close_icons',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open actual controller</button><main id="root"></main></body></html>'}));
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
   await close.click({trial:true});
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
   const actualDialog=await dialog.elementHandle();
   if(input==='keyboard')await native(page,close);
   else if(input==='click')await close.click();
   else await close.tap();
   await page.waitForFunction(node=>!node.isConnected,actualDialog);
   const actualCloseEvent=await page.evaluate(()=>window.actualCloseEvents.at(-1));assert.equal(actualCloseEvent?.buttonName,name,'Actual close activation targets named button or its decorative descendant');
   let recoveryTargetGeometry;
   if(kind==='rules-saved'){
    await page.waitForFunction(()=>document.activeElement?.matches('[data-save-refresh]'));
    await page.waitForFunction(()=>{const node=document.querySelector('[data-save-refresh]'),rect=node?.getBoundingClientRect();return !!rect&&rect.width>0&&rect.height>0&&rect.top>=-1&&rect.bottom<=innerHeight+1&&rect.left>=-1&&rect.right<=innerWidth+1;});
    recoveryTargetGeometry=await page.locator('[data-save-refresh]').boundingBox();
   }
   else await page.waitForFunction(node=>document.activeElement===node,await opener.elementHandle());
   assert.equal(reads.length,readCount,kind+': close does not read');assert.equal(checks.length,checkCount,kind+': close does not validate');assert.equal(saves.length,saveCount,kind+': close does not save');
   assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);placements.push({kind,name,input,geometry,pointerEvent,actualCloseEvent,recoveryTargetGeometry,closeRestoredExactOpener:kind!=='rules-saved',closeRestoredCurrentRecoveryControl:kind==='rules-saved',noCloseRequest:true});
   console.log(`Close placement ${engine} ${width} ${theme} ${input} ${kind}`);
  }
  assert.equal(placements.length,17);assert.equal(saves.length,1,'Only one locally fulfilled saved-state fixture PUT; never sent to backend');
  results.push({engine,width,theme,input,placements,menuTargets,reads,checks,saves,navigationPrompts,unexpected,errors,backendWrites:0});await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Held app/test snapshot');
await writeFile('../docs/premium-ui/qa-close-icon-placements'+(process.env.CLOSE_ENGINES?'-'+process.env.CLOSE_ENGINES:probe?'-probe':expectSvg?'':'-before')+'.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,migratedSvgExpected:expectSvg,scope:'Seventeen named close markup instances: actual exported controllers use native fixture launchers, private activity/Rules dialogs use actual in-controller launchers, leave-day uses actual signed-in shell. Three engines/lightdark/3201280 and native keyboard/click/tap close modalities when not probe. All APIs fulfilled locally except GET-only RAM shell. One locally intercepted incomplete Rules PUT and subsequent503readback per context creates the saved-refresh close variant; no backend mutation. No whole37acceptance.',limitations:['Keyboard, true mouse click and emulated native tap; no physical device/nativeAT/fullbuttonaudit.','Normal800pxheight only in this matrix; reduced-height/enlarged-text cases require separate evidence.','Refused-discard and pending-save guards retain existing separate lifecycle regression tests; this matrix does not independently re-exercise every dirty/pending branch.','The source classifier retains remaining meaningful/status symbols for separately justified handling; named close migration alone does not finish37.'],results},null,2)+'\n');
console.log(`Close icon contexts: ${results.length}; placements: ${results.reduce((n,c)=>n+c.placements.length,0)}`);
