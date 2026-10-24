/** One-shot guarded cleanup. Private bound-reference closure and executable emit equality. */
import assert from 'node:assert/strict';
import ts from 'typescript';
import {transform} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const names=new Set(['unitImportRowMatchesFilter','filteredUnitImportRows','unitImportMatchSummary','renderUnitImportMemberResolver','renderUnitImportUnitResolver','renderUnitImportPostingResolver','renderUnitImportResolvers','renderUnitImportCorrectionModal']);
const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,'.');
const program=ts.createProgram(parsed.fileNames,parsed.options),checker=program.getTypeChecker();
const file=program.getSourceFiles().find(f=>/(^|\/)src\/main\.ts$/.test(f.fileName.replaceAll('\\','/')));
const before=await readFile('src/main.ts','utf8');assert.equal(before,file.text);
const declarations=file.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name&&names.has(n.name.text));
assert.equal(declarations.length,8,'Only run on the audited pre-cleanup snapshot');
const ranges=declarations.map(node=>({name:node.name.text,start:node.getStart(file),end:node.end,lines:node.getText(file).split('\n').length}));
const references=[];
for(const declaration of declarations){
 assert.ok(!declaration.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword));
 const symbol=checker.getSymbolAtLocation(declaration.name);
 for(const source of program.getSourceFiles().filter(s=>!s.isDeclarationFile)){
  const visit=node=>{
   if(ts.isIdentifier(node)&&node!==declaration.name&&checker.getSymbolAtLocation(node)===symbol){
    assert.equal(source,file,'Private symbol has an external reference');
    assert.ok(ranges.some(r=>node.getStart(file)>=r.start&&node.end<=r.end),'Live reference outside removed closure: '+declaration.name.text);
    references.push({name:declaration.name.text,position:node.getStart(file)});
   }
   ts.forEachChild(node,visit);
  };visit(source);
 }
}
let after=before;for(const range of [...ranges].sort((a,b)=>b.start-a.start))after=after.slice(0,range.start)+after.slice(range.end);
const options={loader:'ts',format:'esm',target:'es2022',treeShaking:true,minifySyntax:true,minifyWhitespace:true,minifyIdentifiers:false,legalComments:'none'};
const [oldEmit,newEmit]=await Promise.all([transform(before,options),transform(after,options)]);
assert.ok(newEmit.code===oldEmit.code,'Executable output differs; do not remove');
const sha=value=>createHash('sha256').update(value).digest('hex');
assert.equal(await readFile('src/main.ts','utf8'),before,'Concurrent main edit; rerun audit');
await writeFile('../tmp/legacy-private-cleanup-main-before.ts',before);
await writeFile('../docs/premium-ui/reviews/legacy-private-cleanup-current.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),requirements:[239],completion_claim:false,scope:'Exactly eight private legacy import renderer/filter functions; TypeScript-bound reference closure and isolated esbuild module emit equivalence. Shared API exports, state, delegated branches and current operational import untouched.',before_main_sha256:sha(before),source_sha256:{'frontend/src/main.ts':sha(after)},removed:ranges,references,executable_emit:{method:'esbuild transform TypeScript, ESM es2022 tree-shaking and minification; imports remain external. Byte-for-byte output equality asserted before app mutation.',before_sha256:sha(oldEmit.code),after_sha256:sha(newEmit.code),bytes:Buffer.byteLength(newEmit.code),equal:true},limits:['Isolated main-module emit equivalence, not full production bundle equivalence. Full build and real operational-import regressions required separately.','No reflected name/public export observed; compiled TypeScript-bound references audited.','No backend, API export, handler, persisted state, mutation or export-content change.']},null,2)+'\n');
await writeFile('src/main.ts',after);
console.log('Removed eight private functions after bound-reference closure and exact executable emit equality.');
