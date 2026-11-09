import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {chromium} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
async function files(dir){return(await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?files(dir+'/'+e.name):[dir+'/'+e.name]))).flat();}
const sources=(await files('src')).filter(p=>/\.(ts|css)$/.test(p));
const source_sha256={},imperative=[];
for(const p of sources){
 const bytes=await readFile(p);source_sha256['frontend/'+p]=createHash('sha256').update(bytes).digest('hex');
 if(!p.endsWith('.ts'))continue;
 const sf=ts.createSourceFile(p,bytes.toString('utf8'),ts.ScriptTarget.Latest,true);
 function visit(node){
  if(ts.isCallExpression(node)){
   const expr=node.expression,method=ts.isPropertyAccessExpression(expr)?expr.name.text:ts.isIdentifier(expr)?expr.text:'';
   if(['scrollIntoView','scrollTo','scroll','animate','startViewTransition','requestAnimationFrame'].includes(method)){
    let owner=node.parent;while(owner&&!ts.isFunctionDeclaration(owner)&&!ts.isArrowFunction(owner)&&!ts.isFunctionExpression(owner))owner=owner.parent;
    const text=node.getText(sf);let classification='Requires contextual review';
    if(method==='requestAnimationFrame')classification='Frame scheduling: inspect layout/focus work separately; API presence is not evidence of visual animation';
    else if(text.includes('reducedMotion()')||text.includes('prefers-reduced-motion'))classification='Explicit reduced-motion branch';
    else if(/behavior:\s*['"]instant['"]/.test(text))classification='Explicit instant positioning';
    else if(/scroll/.test(method))classification='Default positioning; global reduced-motion scroll-behavior applies, caller context still requires review';
    imperative.push({source:'frontend/'+p,line:sf.getLineAndCharacterOfPosition(node.getStart(sf)).line+1,method,owner:owner?.name?.getText(sf)||'(inline function)',text,classification});
   }
  }ts.forEachChild(node,visit);
 }visit(sf);
}
const browser=await chromium.launch();let css;
try{
 const page=await browser.newPage();await page.route('**/__motion_inventory',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"><link rel="stylesheet" href="/src/component-reference.css">'}));await page.goto(base+'/__motion_inventory');
 css=await page.evaluate(()=>{
  const declarations=[],keyframes=[];
  function visit(rules,source,conditions=[]){for(const rule of rules){
   if(rule.type===CSSRule.KEYFRAMES_RULE){keyframes.push({source,name:rule.name,cssText:rule.cssText,conditions});continue;}
   if(rule.style&&rule.selectorText){const properties={};for(const name of rule.style){if(/^(animation|transition|scroll-behavior)/.test(name)||/^--transition/.test(name))properties[name]={value:rule.style.getPropertyValue(name),priority:rule.style.getPropertyPriority(name)};}if(Object.keys(properties).length)declarations.push({source,selector:rule.selectorText,authored_declaration_text:rule.style.cssText,properties,conditions});}
   if(rule.cssRules)visit(rule.cssRules,source,[...conditions,rule.conditionText||rule.name||rule.constructor.name]);
  }}
  for(const sheet of document.styleSheets)visit(sheet.cssRules,new URL(sheet.href).pathname);
  return{declarations,keyframes};
 });await page.close();
}finally{await browser.close();}
const path='tests/premium-motion-inventory.mjs';source_sha256['frontend/'+path]=createHash('sha256').update(await readFile(path)).digest('hex');
await writeFile('../docs/premium-ui/reviews/motion-inventory-current.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'AST discovery of explicit scrolling, Web Animations, view-transition and requestAnimationFrame calls in all current src TypeScript; browser CSSOM declarations/keyframes from all three current source stylesheets. Classified discovery only, not runtime acceptance or arbitrary alias/third-party-code coverage.',source_sha256,imperative,css,limits:['CSSOM selectors/declarations are static discovery even though parsed by a browser. No every-selector state render is inferred.','requestAnimationFrame often positions/focuses UI and is not automatically an animation defect.','Global reduced-motion override plus twelve scoped pathway contexts does not certify every nonessential treatment.','Existing restrained120/200/300ms tokens coexist with explicit150ms literals and continuous pending spinners/shimmer; each runtime treatment requires its own context or justified exception.']},null,2)+'\n');
console.log(JSON.stringify({imperative_calls:imperative.length,css_motion_declarations:css.declarations.length,keyframes:css.keyframes.length,runtime_acceptance:0}));
