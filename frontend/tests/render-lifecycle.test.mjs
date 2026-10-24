import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source=await readFile(new URL('../src/main.ts',import.meta.url),'utf8');
const tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const ticket=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='renderTicket');
assert.ok(ticket,'Render lifecycle contract must exist');
const compiled=ts.transpileModule(ticket.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
const createLifecycle=new Function(`let viewSeq=0;let renderSeq=0;${compiled};return {ticket:renderTicket,navigate:()=>{viewSeq++;}};`);

test('later refresh on the same screen invalidates only the earlier render',()=>{
  const lifecycle=createLifecycle();
  const earlier=lifecycle.ticket();assert.equal(earlier(),true);
  const newer=lifecycle.ticket();assert.equal(earlier(),false);assert.equal(newer(),true);
  const latest=lifecycle.ticket();assert.equal(newer(),false);assert.equal(latest(),true);
});

test('navigation invalidates an in-flight render even before another screen starts loading',()=>{
  const lifecycle=createLifecycle();const pending=lifecycle.ticket();
  lifecycle.navigate();assert.equal(pending(),false);
  const destination=lifecycle.ticket();assert.equal(destination(),true);
});

test('frontend route parsing allows only known destinations and does not interpret hash content as markup',async()=>{
  const source=await readFile(new URL('../src/navigation-history.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText;
  const {routeFromHash}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const allowed=['overview','leave','units'];
  assert.equal(routeFromHash('#view=leave',allowed),'leave');
  assert.equal(routeFromHash('#view=units&ignored=anything',allowed),'units');
  for(const hash of ['','#view=accounts','#view=%3Cscript%3E','#view=../../admin','#other=leave'])assert.equal(routeFromHash(hash,allowed),null);
});

test('guide deep links admit only public section IDs and never treat arbitrary hash text as a target',async()=>{
  const source=await readFile(new URL('../src/navigation-history.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText;
  const {guideSectionFromHash,GUIDE_SECTION_IDS}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  assert.equal(GUIDE_SECTION_IDS.length,10);
  for(const section of GUIDE_SECTION_IDS)assert.equal(guideSectionFromHash('#view=user-guide&section='+section),section);
  for(const hash of ['#guide-phase-1','#view=members&section=guide-admin','#view=user-guide&section=private-record','#view=user-guide&section=%3Cimg%20src=x%3E','#view=user-guide&section=../../admin','#view=user-guide'])assert.equal(guideSectionFromHash(hash),null);
});

test('route writes retain valid guide sections and discard unrelated or private hash parameters',async()=>{
  const source=await readFile(new URL('../src/navigation-history.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText;
  const {writeRoute}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const previous=globalThis.window,calls=[];
  const location={href:'http://127.0.0.1/#view=user-guide&section=guide-admin&record=private'};
  globalThis.window={location,history:{pushState:(_state,_unused,url)=>{calls.push('push');location.href=String(url);},replaceState:(_state,_unused,url)=>{calls.push('replace');location.href=String(url);}}};
  try{
    writeRoute('user-guide',true);assert.equal(new URL(location.href).hash,'#view=user-guide&section=guide-admin');
    assert.deepEqual(calls,['replace']);writeRoute('user-guide',true);assert.equal(calls.length,1,'Same location adds no duplicate history');
    writeRoute('leave');assert.equal(new URL(location.href).hash,'#view=leave');
    location.href='http://127.0.0.1/#view=user-guide&section=unknown';writeRoute('user-guide',true);
    assert.equal(new URL(location.href).hash,'#view=user-guide');
  }finally{globalThis.window=previous;}
});

test('manual route scroll restoration is installed without blocking browsers with locked history',async()=>{
  const source=await readFile(new URL('../src/navigation-history.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText;
  const {installManualScrollRestoration}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const previous=globalThis.window;
  try{
    globalThis.window={history:{scrollRestoration:'auto'}};
    installManualScrollRestoration();assert.equal(window.history.scrollRestoration,'manual');
    globalThis.window={history:Object.defineProperty({},'scrollRestoration',{set(){throw new Error('History unavailable');}})};
    assert.doesNotThrow(installManualScrollRestoration);
  }finally{globalThis.window=previous;}
});

const mappingFunctions=['loadMappings','updateLocalMapping'].map(name=>{
  const node=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
  assert.ok(node,`${name} source must exist`);return node.getText(tree);
}).join('\n');
const mappingCode=ts.transpileModule(mappingFunctions,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
const createMappingLifecycle=new Function('getMappingOptions','getMappings',`let mappingLoadSequence=0,mappingLoadError='',mappingScanConfirmed=false,currentUser={id:'first'},options={duty_types:[]},mappings=[{id:'one',notes:'loaded draft'}];const mappingDraftIds=new Set();${mappingCode};return {load:loadMappings,edit:updateLocalMapping,switchAccount:()=>{currentUser={id:'second'};},state:()=>({options,mappings,error:mappingLoadError,draftIds:[...mappingDraftIds]})};`);

test('mapping refreshes commit only the latest load and preserve loaded drafts on failure',async()=>{
  const pending=[];
  const lifecycle=createMappingLifecycle(async()=>({duty_types:[]}),()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));
  const old=lifecycle.load(),newer=lifecycle.load();
  pending[1].resolve([{id:'one',notes:'newest'}]);assert.equal(await newer,true);
  pending[0].resolve([{id:'one',notes:'obsolete'}]);assert.equal(await old,false);
  assert.equal(lifecycle.state().mappings[0].notes,'newest');
  const failed=lifecycle.load();pending[2].reject(new Error('Refresh unavailable'));assert.equal(await failed,true);
  assert.equal(lifecycle.state().mappings[0].notes,'newest');assert.equal(lifecycle.state().error,'Refresh unavailable');
});

test('mapping edits and account changes invalidate background refreshes',async()=>{
  const pending=[];
  const lifecycle=createMappingLifecycle(async()=>({duty_types:[]}),()=>new Promise(resolve=>pending.push(resolve)));
  const old=lifecycle.load();lifecycle.edit('one',{notes:'unsaved edit'});
  pending[0]([{id:'one',notes:'stale server value'}]);assert.equal(await old,false);
  assert.equal(lifecycle.state().mappings[0].notes,'unsaved edit');
  const account=lifecycle.load();lifecycle.switchAccount();pending[1]([{id:'private',notes:'old account'}]);assert.equal(await account,false);
  assert.equal(lifecycle.state().mappings[0].notes,'unsaved edit');
});

test('scan readback retains local drafts while exposing new labels and clearing confirmed saved drafts',async()=>{
  let rows=[{id:'one',notes:'old server value'},{id:'new',notes:'new scanned label'}];
  const lifecycle=createMappingLifecycle(async()=>({duty_types:[{key:'current'}]}),async()=>rows);
  lifecycle.edit('one',{notes:'private draft'});
  assert.equal(await lifecycle.load(true),true);
  assert.equal(lifecycle.state().mappings.find(row=>row.id==='one').notes,'private draft');
  assert.equal(lifecycle.state().mappings.find(row=>row.id==='new').notes,'new scanned label');
  assert.deepEqual(lifecycle.state().draftIds,['one']);
  lifecycle.edit('one',{notes:'confirmed saved'},false);
  assert.deepEqual(lifecycle.state().draftIds,[]);
  rows=[{id:'one',notes:'confirmed saved'}];
  assert.equal(await lifecycle.load(true),true);
  assert.equal(lifecycle.state().mappings[0].notes,'confirmed saved');
});

test('scan readback does not silently drop an edited mapping absent from the refreshed response',async()=>{
  const lifecycle=createMappingLifecycle(async()=>({duty_types:[]}),async()=>[{id:'new',notes:'new label'}]);
  lifecycle.edit('one',{notes:'unsaved local decision'});
  await lifecycle.load(true);
  assert.equal(lifecycle.state().mappings.find(row=>row.id==='one').notes,'unsaved local decision');
  assert.equal(lifecycle.state().mappings.find(row=>row.id==='new').notes,'new label');
});

test('scan readback cannot commit after its originating view context expires',async()=>{
  let release,contextCurrent=true;
  const lifecycle=createMappingLifecycle(async()=>({duty_types:[{key:'obsolete'}]}),()=>new Promise(resolve=>release=resolve));
  lifecycle.edit('one',{notes:'retained current draft'});
  const pending=lifecycle.load(true,()=>contextCurrent);
  contextCurrent=false;
  release([{id:'old-context',notes:'obsolete scan data'}]);
  assert.equal(await pending,false);
  assert.equal(lifecycle.state().mappings[0].notes,'retained current draft');
  assert.deepEqual(lifecycle.state().options,{duty_types:[]});
});

const monthFunction=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='applyWorkingMonth');
const monthCode=ts.transpileModule(monthFunction.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
const createMonthLifecycle=new Function('allowDiscard',`
 let leaveMonth='2026-10',unitMonth=leaveMonth,rotaSetupMonth=leaveMonth,rotaTemplateMonth=leaveMonth,rotaReviewMonth=leaveMonth,rotaPublishMonth=leaveMonth;
 let leaveImportFile={name:'leave.csv'},unitImportFile=null,leaveImportPreview={review:'pending'},unitImportPreview=null,unitImportFilter='all',unitImportSearch='',unitImportResolutions={},unitEditingAssignmentId=null,exchangeSelectedAssignmentId='',viewSeq=0;
 const fields=[{value:'2026-11'}],writes=[],prompts=[];
 const window={confirm:message=>{prompts.push(message);return allowDiscard;}},document={querySelectorAll:()=>fields,querySelector:()=>fields[0]},safeLocalStorage={setItem:(...args)=>writes.push(args)},WORKING_MONTH_KEY='month';
 const isValidWorkingMonth=value=>/^2026-(10|11)$/.test(value),invalidateUnitManagementCache=()=>{},rejectedRotaCandidates=new Set(),paintWorkflowTracker=()=>{};
 ${monthCode};return {apply:applyWorkingMonth,state:()=>({leaveMonth,unitMonth,leaveImportFile,leaveImportPreview,viewSeq,fields,writes,prompts})};`);

test('declining a month switch preserves selected import, review, month and storage',()=>{
 const lifecycle=createMonthLifecycle(false);assert.equal(lifecycle.apply('2026-11'),false);
 const state=lifecycle.state();assert.equal(state.leaveMonth,'2026-10');assert.equal(state.unitMonth,'2026-10');
 assert.equal(state.leaveImportFile.name,'leave.csv');assert.equal(state.leaveImportPreview.review,'pending');
 assert.equal(state.viewSeq,0);assert.deepEqual(state.writes,[]);assert.equal(state.fields[0].value,'2026-10');assert.equal(state.prompts.length,1);
});

test('explicitly accepting a changed month clears the old import once and applies selected context',()=>{
 const lifecycle=createMonthLifecycle(true);assert.equal(lifecycle.apply('2026-11'),true);
 const state=lifecycle.state();assert.equal(state.leaveMonth,'2026-11');assert.equal(state.unitMonth,'2026-11');assert.equal(state.leaveImportFile,null);assert.equal(state.leaveImportPreview,null);
 assert.equal(state.viewSeq,1);assert.deepEqual(state.writes,[['month','2026-11']]);assert.equal(state.prompts.length,1);
 assert.equal(lifecycle.apply('2026-11'),false);assert.equal(lifecycle.state().prompts.length,1,'No repeat discard prompt for unchanged month');
});

test('every legacy month handler stops before clearing drafts when a switch is declined',async()=>{
 const branches=new Map();
 const visit=node=>{
  if(ts.isIfStatement(node)) {
   const match=node.expression.getText(tree).match(/^target\.id === "(leave-month|unit-month|rota-setup-month|rota-template-month|rota-review-month|rota-publish-month)"$/);
   if(match)branches.set(match[1],node.thenStatement.getText(tree));
  }
  ts.forEachChild(node,visit);
 };visit(tree);assert.equal(branches.size,6);
 for(const [id,branch] of branches){
  const code=ts.transpileModule(`async function handler(){${branch}}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const run=new Function(`return(async()=>{
   let leaveImportPreview='leave-review',leaveImportFile='leave-file',unitImportPreview='unit-review',unitImportFile='unit-file',unitImportFilter='unresolved',unitImportSearch='draft search',unitImportResolutions={row:'person'},unitEditingAssignmentId='editing',exchangeSelectedAssignmentId='exchange';
   const calls=[],target={value:'2026-11'},applyWorkingMonth=()=>false,UNIT_IMPORT_TABLE_ID='unit-import',setPage=()=>calls.push('page'),closeUnitModal=()=>calls.push('close-unit'),invalidateUnitManagementCache=()=>calls.push('invalidate'),rejectedRotaCandidates={clear:()=>calls.push('reject-clear')},closeRotaDayModal=()=>calls.push('close-day'),renderLeave=()=>calls.push('leave'),renderUnitManagement=()=>calls.push('units'),renderRotaSetup=()=>calls.push('setup'),renderRotaTemplate=()=>calls.push('template'),renderRotaReview=()=>calls.push('review'),renderRotaPublish=()=>calls.push('publish');
   ${code};await handler();return{leaveImportPreview,leaveImportFile,unitImportPreview,unitImportFile,unitImportFilter,unitImportSearch,unitImportResolutions,unitEditingAssignmentId,exchangeSelectedAssignmentId,calls};})()`);
  assert.deepEqual(await run(),{leaveImportPreview:'leave-review',leaveImportFile:'leave-file',unitImportPreview:'unit-review',unitImportFile:'unit-file',unitImportFilter:'unresolved',unitImportSearch:'draft search',unitImportResolutions:{row:'person'},unitEditingAssignmentId:'editing',exchangeSelectedAssignmentId:'exchange',calls:[]},id);
 }
});
