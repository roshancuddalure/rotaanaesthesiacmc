/** Read-only symbol audit. Candidates are never runtime passes or automatic removals. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';

const configPath=ts.findConfigFile(process.cwd(),ts.sys.fileExists,'tsconfig.json');
assert.ok(configPath,'Run from frontend');
const config=ts.readConfigFile(configPath,ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,path.dirname(configPath));
const program=ts.createProgram(parsed.fileNames,parsed.options),checker=program.getTypeChecker();
const main=program.getSourceFiles().find(file=>file.fileName.replaceAll('\\','/').endsWith('/src/main.ts')||file.fileName==='src/main.ts');
assert.ok(main);
const targets=['renderLeaveImportPreview','renderUnitImportPreview','renderUnitImportResolvers','renderUnitImportCorrectionModal','filteredUnitImportRows','refreshUnitImportPreview'];
const files=program.getSourceFiles().filter(file=>!file.isDeclarationFile&&!file.fileName.includes('node_modules'));
const location=node=>({source:path.relative(process.cwd(),node.getSourceFile().fileName).replaceAll('\\','/'),line:node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line+1});
const rows=[];
for(const name of targets){
 const declaration=main.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
 if(!declaration){
  rows.push({name,source:'src/main.ts',reference_count:0,exported:false,disposition:'no_current_declaration_not_a_runtime_pass',note:'Compare retained pre-cleanup audit/removal ranges and build equivalence before attributing absence to safe removal.'});
  continue;
 }
 const symbol=checker.getSymbolAtLocation(declaration.name),references=[];
 for(const file of files){
  const visit=node=>{
   if(ts.isIdentifier(node)&&node!==declaration.name&&checker.getSymbolAtLocation(node)===symbol){
    let owner=node.parent;while(owner&&!ts.isFunctionLike(owner))owner=owner.parent;
    references.push({...location(node),owner:owner?.name?.getText()||'(callback/module)',usage:ts.isCallExpression(node.parent)&&node.parent.expression===node?'direct_call':'reference_requires_review'});
   }
   ts.forEachChild(node,visit);
  };visit(file);
 }
 const exported=declaration.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)||false;
 rows.push({name,...location(declaration),lines:main.getLineAndCharacterOfPosition(declaration.end).line-main.getLineAndCharacterOfPosition(declaration.getStart()).line+1,exported,reference_count:references.length,references,disposition:!exported&&references.length===0?'unreferenced_private_function_candidate':'retained_dependency_review_required'});
}
assert.equal(rows.find(row=>row.name==='renderLeaveImportPreview')?.reference_count,0);
assert.equal(rows.find(row=>row.name==='renderUnitImportPreview')?.reference_count,0);
const hash=createHash('sha256').update(await readFile('src/main.ts')).digest('hex');
await writeFile('../docs/premium-ui/reviews/legacy-import-dependency-current.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),requirements:[239],scope:'TypeScript-bound symbol references across application sources only. This script performs no runtime execution or deletion and makes no whole-item pass claim.',source_sha256:{'src/main.ts':hash},method:'Resolve each target private function symbol with TypeScript checker; count references across source program, classify references by enclosing function. Exported/dynamic/reflection/HTML event entry risks require separate manual review.',rows,retained_boundaries:['Do not delete shared API exports, import-report helpers, month draft/reset guards or delegated branches merely because two renderers were unreferenced.','Current leave/unit toolbar invokes operational-import; preview/report/apply outcome evidence is separate.','Pre-cleanup zero-reference renderer audit is retained separately. Build equivalence and current normalized report suite cover the bounded cleanup; other helpers and delegated branches remain retained pending full entry-graph review.'],completion_claim:false},null,2)+'\n');
console.log(JSON.stringify(rows.map(({name,reference_count,disposition})=>({name,reference_count,disposition})),null,2));
