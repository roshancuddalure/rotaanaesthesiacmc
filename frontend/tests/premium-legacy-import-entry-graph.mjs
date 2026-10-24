/** Bounded documentary entry graph. No product edits or runtime certification. */
import ts from 'typescript';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,'.');
const program=ts.createProgram(parsed.fileNames,parsed.options),checker=program.getTypeChecker();
const sources=program.getSourceFiles().filter(file=>!file.isDeclarationFile&&/(^|\/)src\//.test(file.fileName.replaceAll('\\','/')));
const main=program.getSourceFiles().find(file=>/(^|\/)src\/main\.ts$/.test(file.fileName.replaceAll('\\','/')));
const line=(file,node)=>file.getLineAndCharacterOfPosition(node.getStart(file)).line+1;
const declarations=new Map();
for(const statement of main.statements)if(ts.isFunctionDeclaration(statement)&&statement.name)declarations.set(statement.name.text,statement);
const owner=node=>{for(let current=node.parent;current;current=current.parent){if(ts.isFunctionDeclaration(current)&&current.name)return current.name.text;if(ts.isArrowFunction(current)||ts.isFunctionExpression(current))return '(delegated callback)';}return '(module)';};
const targets=[...declarations.keys()].filter(name=>/UnitImport|LeaveImport|^unitImport/.test(name));
const rows=[];
for(const name of targets){
 const declaration=declarations.get(name),symbol=checker.getSymbolAtLocation(declaration.name),references=[],dependencies=new Set();
 for(const file of sources){const visit=node=>{if(ts.isIdentifier(node)&&node!==declaration.name&&checker.getSymbolAtLocation(node)===symbol)references.push({file:file.fileName.replaceAll('\\','/').replace(/^.*\/frontend\//,'frontend/'),line:line(file,node),owner:owner(node),usage:ts.isCallExpression(node.parent)&&node.parent.expression===node?'direct_call':'reference'});ts.forEachChild(node,visit);};visit(file);}
 const visit=node=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression))dependencies.add(node.expression.text);ts.forEachChild(node,visit);};visit(declaration.body);
 rows.push({name,line:line(main,declaration),end_line:main.getLineAndCharacterOfPosition(declaration.end).line+1,reference_count:references.length,references,called_identifiers:[...dependencies].sort(),exported:Boolean(declaration.modifiers?.some(mod=>mod.kind===ts.SyntaxKind.ExportKeyword)),disposition:references.length===0?'private_zero_reference_candidate':'retained_until_entry_edges_disposed'});
}
const selectors=['leave-import-form','leave-import-file','unit-import-form','unit-import-file','unit-import-replace','apply-leave-import','apply-unit-import','data-preview-rejections','data-unit-import-filter','unit-import-search','data-open-unit-import-correction','data-close-unit-import-correction','data-clear-unit-import-correction','unit-import-correction-form','data-unit-import-accept-suggested','data-unit-import-create-member','data-unit-import-save-alias','data-unit-import-save-unit-map','data-unit-import-person','data-unit-import-unit','data-unit-import-posting'];
const selectorRows=selectors.map(selector=>{
 const occurrences=[];
 for(const file of sources){const visit=node=>{if((ts.isStringLiteralLike(node)||ts.isTemplateExpression(node))&&node.getText(file).includes(selector)){
   // Parent template expressions encompass literal segments; only record complete expression once.
   if(ts.isStringLiteralLike(node)&&ts.isTemplateExpression(node.parent))return;
   occurrences.push({file:file.fileName.replaceAll('\\','/').replace(/^.*\/frontend\//,'frontend/'),line:line(file,node),owner:owner(node),kind:ts.isTemplateExpression(node)||ts.isNoSubstitutionTemplateLiteral(node)?'template_markup_or_dynamic_text':'literal_selector_or_action_key',text_excerpt:node.getText(file).slice(0,180)});
  }ts.forEachChild(node,visit);};visit(file);}
 return {selector,occurrences,assessment:'Source occurrences only; distinguish unreachable private-renderer markup from active handler selectors before cleanup.'};
});
const sourcePath=file=>{const value=file.fileName.replaceAll('\\','/').replace(/^.*\/frontend\//,'frontend/');return value.startsWith('src/')?'frontend/'+value:value;};
for(const row of rows)for(const ref of row.references)if(ref.file.startsWith('src/'))ref.file='frontend/'+ref.file;
for(const row of selectorRows)for(const occurrence of row.occurrences)if(occurrence.file.startsWith('src/'))occurrence.file='frontend/'+occurrence.file;
const output={recorded_at_utc:new Date().toISOString(),reviewer:'preview_rejection_artifacts',requirements:[239],scope:'Bounded current TypeScript-bound private symbol references and source literal/template entry graph. Removed private closures are evidenced separately by legacy-private-cleanup-current.json; this script makes no app edit or runtime certification.',source_hashes:Object.fromEntries(sources.map(file=>[sourcePath(file),crypto.createHash('sha256').update(file.text).digest('hex')])),rows,selectors:selectorRows,completion_claim:false,
 candidate_waves:[
  {wave:1,status:'private_zero_reference_candidates_after_typechecker_confirmation',symbols:['filteredUnitImportRows','unitImportMatchSummary','renderUnitImportResolvers','renderUnitImportCorrectionModal'],rationale:'Private declaration symbols have no TypeScript-bound references. No public export/reflection entry is observed. Root must recheck current hashes and build/tests before deletion; zero-reference source alone does not certify runtime equivalence.'},
  {wave:2,status:'dependency_closure_candidates_after_wave1_only',symbols:['unitImportRowMatchesFilter','renderUnitImportMemberResolver','renderUnitImportUnitResolver','renderUnitImportPostingResolver'],rationale:'Filter predicate is referenced only from filteredUnitImportRows; resolver renderers only from renderUnitImportResolvers. Their markup is therefore reachable only from already unreferenced private roots. Do not delete symbols still referenced by retained delegated branches.'},
  {wave:3,status:'delegated_entry_candidates_retain_until_coordinated_branch_audit',symbols:['refreshUnitImportPreview','scheduleUnitImportPreviewRender','unitImportRowByKey','unitImportResolutionFor'],selectors:['leave-import-form','unit-import-form','unit-import-correction-form','data-preview-rejections','apply-leave-import','apply-unit-import','data-unit-import-filter','unit-import-search','data-open-unit-import-correction','data-close-unit-import-correction','data-clear-unit-import-correction','data-unit-import-accept-suggested','data-unit-import-create-member','data-unit-import-save-alias','data-unit-import-save-unit-map','data-unit-import-person','data-unit-import-unit','data-unit-import-posting'],rationale:'References originate in live delegated event callbacks but require legacy selector markup not emitted by current operational toolbar. Some selector markup is emitted by now-unreferenced renderer roots. Whole branches must be checked together; counting references alone cannot label these functions safe to remove.'}
 ],
 entry_edges:[
  {entry:'Current leave/unit toolbar data-open-normalized-import',path:['main.ts delegated click','openOperationalImport(kind, selectedMonth, callback, isAdmin)','operational-import.ts private file/settings/review state','/api/v1/import-review/columns','/api/v1/import-review/{kind}/preview','/api/v1/import-review/{kind}/apply'],disposition:'Retain live path. Existing12case actualapp report certifies downloads only; other preview/apply suites separate.'},
  {entry:'Legacy leave-import-form / unit-import-form submit',path:['main.ts delegated submit','previewLeaveImport / previewUnitAssignmentImport','legacy module state','renderLeave / renderUnitManagement'],disposition:'No current form markup producer found; neither main view renders removed private preview. Retain until coordinated branch removal approved and regressions run.'},
  {entry:'Legacy unit correction/member/unit/posting controls',path:['now unreferenced resolver/correction renderers','main.ts click/change/submit branches','refreshUnitImportPreview','previewUnitAssignmentImport'],disposition:'Nine refresh references are callback-level edges, not evidence of current user entry. Some callbacks mutate aliases/mappings/member records before refresh, so do not exercise via synthetic injected DOM or remove shared API helpers.'},
  {entry:'Review action kind apply-leave-import / apply-unit-import',path:['ReviewAction union and dispatcher','querySelector legacy apply button','legacy apply handlers'],disposition:'No current action producer found after two renderers removal. Retain type/dispatcher clauses until reviewButton and all callers are separately audited.'}
 ],
 retained_shared_boundaries:[
  {symbols:['SPECIAL_UNIT_POSTING_KEYS','UNIT_POSTING_TYPES','units','members','mappings','unitMonth','leaveMonth'],reason:'Shared with live unit-card grouping, direct assignment forms, mapping management and operational context. Never remove based on legacy dependency graph.'},
  {symbols:['loadUnitManagementData','invalidateUnitManagementCache','renderUnitManagement','renderLeave','applyWorkingMonth','resetPrivateState'],reason:'Live load/current-context/month/session controls. Legacy state fields remain inputs to shared discard/reset logic; no partial state deletion proposed.'},
  {symbols:['previewLeaveImport','previewUnitAssignmentImport','applyLeaveImport','applyUnitAssignmentImport','downloadPreviewIssues','createMemberChecked','addMemberAlias','createMapping','updateMapping'],reason:'API exports/shared helpers remain retained regardless of private-renderer reachability. Changing exported API surface or server behavior is outside this cleanup.'},
  {symbols:['UNIT_IMPORT_POSTING_OPTIONS','UNIT_IMPORT_TABLE_ID','unitImportCorrectionRowKey','unitImportResolutions','unitImportFile','unitImportPreview','leaveImportFile','leaveImportPreview'],reason:'Potentially legacy data/constants still referenced by retained branches or shared guards. Keep until whole dependency closure and exact source ownership confirmed.'}
 ],
 limits:['AST symbol binding covers compiled application TypeScript, not runtime reflection or injected selectors. No injected DOM test is proposed.','Current source is authoritative; line locations and references must be refreshed after any cleanup.','No claim every orphan handler is removable or every current import action is certified.','Report-only work; application/backend changes and mutation requests are zero.']};
for(const wave of output.candidate_waves.slice(0,2)){
 const present=wave.symbols.filter(name=>declarations.has(name));
 if(!present.length){wave.status='removed_private_closure_see_exact_cleanup_evidence';wave.rationale='All symbols in this wave are absent from current declarations. See legacy-private-cleanup-current.json for bound-reference closure, exact ranges and executable emit equivalence; actual operational regressions recorded separately.';}
}
fs.writeFileSync('../docs/premium-ui/reviews/legacy-import-entry-graph-current.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(rows.map(({name,reference_count})=>({name,reference_count})),null,2));
