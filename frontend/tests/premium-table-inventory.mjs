// Source discovery only: literal <table> openings, not runtime route/reachability coverage.
import ts from 'typescript';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
async function files(dir){return(await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?files(dir+'/'+e.name):e.name.endsWith('.ts')?[dir+'/'+e.name]:[]))).flat();}
const tables=[],sources={};
for(const file of await files('src')){
 const source=await readFile(file,'utf8');sources['frontend/'+file]=createHash('sha256').update(await readFile(file)).digest('hex');const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 function visit(node){
  if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||node.kind===ts.SyntaxKind.TemplateHead||node.kind===ts.SyntaxKind.TemplateMiddle||node.kind===ts.SyntaxKind.TemplateTail){
   const raw=node.getText(sf);
   // A dynamic attribute can end the template head before the opening >.
   // Count that literal start once; the following template tail has no <table.
   for(const match of raw.matchAll(/<table\b[^>]*(?:>|$)/g)){
    let owner=node.parent;
    while(owner&&!ts.isFunctionDeclaration(owner)&&!ts.isArrowFunction(owner)&&!ts.isFunctionExpression(owner))owner=owner.parent;
    let name=owner?.name?.getText(sf);
    if(!name&&owner?.parent&&ts.isVariableDeclaration(owner.parent))name=owner.parent.name.getText(sf);
    const at=node.getStart(sf)+match.index;
    tables.push({id:`${file}:${sf.getLineAndCharacterOfPosition(at).line+1}`,source:'frontend/'+file,line:sf.getLineAndCharacterOfPosition(at).line+1,owner:name||'(anonymous/template)',opening:match[0],opening_complete:match[0].endsWith('>'),classification:'review_required',runtime_reachable:'unverified'});
   }
  }
  ts.forEachChild(node,visit);
 }
 visit(sf);
}
const report={recorded_at_utc:new Date().toISOString(),scope:'AST literal table-opening discovery. Nested template parts counted once. No inferred runtime reachability, dead-code finding, mobile correctness or completion.',source_sha256:sources,counts:{source_modules:Object.keys(sources).length,literal_table_openings:tables.length,classified:0},tables};
await writeFile('../docs/premium-ui/table-surface-inventory.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.counts));
