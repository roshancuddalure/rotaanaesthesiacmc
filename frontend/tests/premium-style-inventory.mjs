/** Source inventory only. CSS/TypeScript parsing never establishes rendered acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import postcss from 'postcss';
import ts from 'typescript';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.join(root,'docs/premium-ui/style-inventory.json');
const rel=p=>path.relative(root,p).replaceAll('\\','/');
const files=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(p,e.name)):[path.join(p,e.name)]);
const sources=files(path.join(root,'frontend/src')).filter(p=>/\.(css|ts)$/.test(p)).sort();
const sourceHashes={},tokens=[],literalColors=[],rules=[],inlineStyles=[],runtimeStyles=[];
const named=/\b(?:white|black|transparent|currentcolor|red|blue|green|gray|grey|orange|yellow|purple|navy|gold|silver|inherit|initial)\b/gi;
const colorProp=/(?:color|background|border|shadow|outline|fill|stroke|accent|caret)/i;
function context(node){const scopes=[];for(let p=node.parent;p;p=p.parent)if(p.type==='atrule')scopes.unshift('@'+p.name+' '+p.params);return scopes;}
for(const file of sources){
 const text=fs.readFileSync(file,'utf8'),source=rel(file);sourceHashes[source]=crypto.createHash('sha256').update(text).digest('hex');
 if(file.endsWith('.css')){
  const ast=postcss.parse(text,{from:file});
  ast.walkRules(rule=>rules.push({source,line:rule.source.start.line,selector:rule.selector,scope:context(rule)}));
  ast.walkDecls(decl=>{
   const entry={source,line:decl.source.start.line,selector:decl.parent.type==='rule'?decl.parent.selector:null,scope:context(decl),property:decl.prop,value:decl.value,important:Boolean(decl.important)};
   if(decl.prop.startsWith('--'))tokens.push(entry);
   const literals=[...decl.value.matchAll(/#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(/gi)].map(m=>m[0]);
   if(colorProp.test(decl.prop)||decl.prop.startsWith('--'))literals.push(...[...decl.value.matchAll(named)].map(m=>m[0]).filter(v=>!['inherit','initial'].includes(v.toLowerCase())));
   if(literals.length)literalColors.push({...entry,literals,classification:decl.prop.startsWith('--')?'token_definition':'literal_declaration_candidate'});
  });
 }else{
  const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  assert.equal(ast.parseDiagnostics.length,0,'TypeScript parse errors: '+source);
  const location=node=>({source,line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1});
  function visit(node){
   if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)){
    for(const m of node.text.matchAll(/\bstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi))inlineStyles.push({...location(node),fragment:m[0],location_scope:'containing_literal_start; interpolation may split attribute'});
   }
   if(ts.isBinaryExpression(node)&&/\.style(?:\.|\[)/.test(node.left.getText(ast))&&ts.isAssignmentOperator(node.operatorToken.kind))runtimeStyles.push({...location(node),kind:'assignment',expression:node.getText(ast)});
   if(ts.isCallExpression(node)){
    const callee=node.expression.getText(ast),args=node.arguments;
    if(/\.style\.(?:setProperty|removeProperty)$/.test(callee)||(callee.endsWith('.setAttribute')&&args[0]&&ts.isStringLiteral(args[0])&&args[0].text==='style'))runtimeStyles.push({...location(node),kind:'call',expression:node.getText(ast)});
   }
   ts.forEachChild(node,visit);
  }
  visit(ast);
 }
}
const groups=new Map();
for(const rule of rules){const key=JSON.stringify([rule.selector.replace(/\s+/g,' ').trim(),rule.scope]);const group=groups.get(key)||[];group.push(rule);groups.set(key,group);}
const duplicateSelectors=[...groups.values()].filter(g=>g.length>1).map(occurrences=>({selector:occurrences[0].selector,scope:occurrences[0].scope,occurrences,classification:'review_candidate; repeated selectors can be intentional cascade or compatibility'}));
const tokenGroups=new Map();
for(const token of tokens){const key=token.property;const values=tokenGroups.get(key)||[];values.push(token);tokenGroups.set(key,values);}
const repeatedTokens=[...tokenGroups].filter(([,v])=>v.length>1).map(([property,definitions])=>({property,definitions,classification:'review theme/media/selector scope before consolidation'}));
const data={schema_version:1,method:'Parse every current frontend/src CSS file with PostCSS and TypeScript source with TypeScript AST. Inventory source declarations/occurrences; preserve exact values/scopes. No code is removed or rewritten.',coverage_claim:'Static source inventory only. Counts are not defects, rendered usage, contrast, reachability or runtime passes. Functional color entries identify the function start; full declaration value is retained. String fragments may include inert/example markup. Source-less styles from dependencies, external CSS, public bootstrap and index.html require separate inventory.',
 source_sha256:sourceHashes,counts:{css_files:sources.filter(p=>p.endsWith('.css')).length,typescript_files:sources.filter(p=>p.endsWith('.ts')).length,custom_property_definitions:tokens.length,unique_custom_properties:tokenGroups.size,color_declaration_candidates:literalColors.length,non_token_color_declaration_candidates:literalColors.filter(c=>c.classification==='literal_declaration_candidate').length,selector_rules:rules.length,duplicate_selector_groups:duplicateSelectors.length,inline_style_fragments:inlineStyles.length,runtime_style_expressions:runtimeStyles.length,runtime_passes:0},tokens,literal_colors:literalColors,duplicate_selectors:duplicateSelectors,repeated_tokens:repeatedTokens,inline_style_fragments:inlineStyles,runtime_style_expressions:runtimeStyles};
if(process.argv.includes('--write'))fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');
if(process.argv.includes('--check'))assert.deepEqual(JSON.parse(fs.readFileSync(output,'utf8')),data,'Style inventory is stale; inspect source changes and regenerate it.');
console.log(JSON.stringify({counts:data.counts,check:process.argv.includes('--check')?'source_inventory_matches':'source_inventory_only'},null,2));
