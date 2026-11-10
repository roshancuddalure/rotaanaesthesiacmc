// Authored only. Root coordinates execution against disposable loopback RAM API.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=x=>createHash('sha256').update(x).digest('hex');
const baseline='http://127.0.0.1:5197',candidate='http://127.0.0.1:5308',api='http://127.0.0.1:8031';
const report='../docs/premium-ui/qa-original031-numeric-v2-route-pairs.json';
await assert.rejects(access(report),{code:'ENOENT'});
const heldPaths=['main.ts','member-workspace.ts','styles.css','premium-theme.css','component-reference.css','services/api.ts','rota-rules.ts','limits.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(heldPaths.map(async p=>['frontend/src/'+p,sha(await readFile('src/'+p))])));
const initial=await hashes(),cssPath='../tmp/numeric31-tabular-v2/premium-theme.css',candidateCss=await readFile(cssPath);
assert.equal(initial['frontend/src/main.ts'],'15b79223710a53a9e0ccdd70373a92e568f6ee603f56e3747454ab25ac258cc0');
assert.equal(initial['frontend/src/member-workspace.ts'],'88774f277131a1ed83174d288d882653fc04add295b8237fefa62636e08617ea');
assert.equal(initial['frontend/src/premium-theme.css'],'acc46b2249087f365ca855bcd9630628c390c4cdf013301daaee40ede80e55f4');
assert.equal(sha(candidateCss),'2e4f85d813061ebc9f696b92d50ae24717a7781a3688187d02c7339c00bea4a1');
const preflight=[];
for(const base of[baseline,candidate]){
 for(const p of['main.ts','member-workspace.ts']){
  const text=await(await fetch(base+'/src/'+p)).text(),m=text.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(m,p);
  assert.equal(sha(Buffer.from(JSON.parse(Buffer.from(m[1],'base64').toString()).sourcesContent[0])),initial['frontend/src/'+p]);
 }
 const text=await(await fetch(base+'/src/premium-theme.css')).text(),m=text.match(/const __vite__css = ("(?:[^"\\]|\\.)*")/);assert.ok(m);
 const hash=sha(JSON.parse(m[1]));assert.equal(hash,base===candidate?sha(candidateCss):initial['frontend/src/premium-theme.css']);preflight.push({base,cssSha256:hash,servedSourceMatched:true});
}
const views=['overview','analysis','members','leave','units','rota-setup','rota-template','rota-review','rota-publish','user-guide','rota-rules','limits','call-clusters','mappings','imports','accounts','diagnostics','compute-settings','recycle-bin'];
assert.equal(views.length,19);
const sharedResponses=new Map(),results=[],sessions=[];
async function fixture(method,path,search,body){
 const key=method+' '+path+search+' '+(body||'');
 if(!sharedResponses.has(key))sharedResponses.set(key,(async()=>{
  const response=await fetch(api+path+search,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body||undefined});
  const contentType=response.headers.get('content-type')||'application/json';let text=await response.text();
  if(path==='/api/v1/auth/me'&&response.ok){const data=JSON.parse(text);data.role='superadmin';text=JSON.stringify(data);}
  return{status:response.status,contentType,body:text};
 })());
 return sharedResponses.get(key);
}
async function navigate(page,view){
 let direct;
 for(const button of await page.locator(`[data-view="${view}"]:visible`).all()){
  const box=await button.boundingBox();if(box&&box.x>=0&&box.x+box.width<=page.viewportSize().width+1){direct=button;break;}
 }
 if(direct)await direct.click();else{await page.locator('#mobile-more').click();await page.locator(`[data-mobile-more-view="${view}"]`).click();}
 await page.waitForLoadState('networkidle');
 await page.waitForFunction(()=>!document.querySelector('#view-root [aria-busy="true"], #view-root .skeleton'));
 await page.locator('#section-title').waitFor();
 assert.ok(await page.locator(`[data-view="${view}"].active`).count(),'Actual navigation selects requested route');
 await page.evaluate(()=>document.fonts.ready);
}
async function snapshot(page){return page.evaluate(()=>{
 const root=document.querySelector('#view-root');if(!root)throw new Error('Actual view root missing');
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
 const font=e=>{const s=getComputedStyle(e);return{family:s.fontFamily,size:s.fontSize,weight:s.fontWeight,lineHeight:s.lineHeight,style:s.fontStyle,stretch:s.fontStretch};};
 const label=e=>e.getAttribute('aria-label')||(e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()||[...(e.labels||[])].map(l=>l.textContent).join(' ').trim()||e.getAttribute('title')||e.textContent?.trim()||'';
 const all=[...document.querySelectorAll('#view-root button, #view-root a, #view-root input, #view-root select, #view-root textarea, #working-month')];
 const controls=all.map((e,index)=>({index,tag:e.tagName,id:e.id,type:e.getAttribute('type'),text:e.textContent,label:label(e),value:'value'in e?e.value:null,min:e.getAttribute('min'),max:e.getAttribute('max'),step:e.getAttribute('step'),disabled:'disabled'in e?e.disabled:false,readOnly:'readOnly'in e?e.readOnly:false,role:e.getAttribute('role'),pressed:e.getAttribute('aria-pressed'),expanded:e.getAttribute('aria-expanded'),visible:visible(e),font:font(e),options:e instanceof HTMLSelectElement?[...e.options].map(o=>({text:o.text,value:o.value,selected:o.selected,disabled:o.disabled,font:font(o)})):null}));
 const numeric=[];
 const elements=[...root.querySelectorAll('*'),...document.querySelectorAll('#working-month')];
 for(let index=0;index<elements.length;index++){
  const e=elements[index],isOption=e instanceof HTMLOptionElement;
  if(e instanceof SVGElement)continue;
  const native=e.matches('input,select,textarea,option,optgroup');
  const text=native&&'value'in e?e.value:e.childElementCount===0?e.textContent:'';
  if(!/\d/.test(text||'')||(!visible(e)&&!isOption))continue;
  if(isOption&&!visible(e.closest('select')))continue;
  const s=getComputedStyle(e);numeric.push({index,tag:e.tagName,id:e.id,type:e.getAttribute('type'),text:e.textContent,value:'value'in e?e.value:null,variant:s.fontVariantNumeric,font:font(e),native,option:isOption});
 }
 const rootText=root.textContent,branch=root.querySelector('[role="alert"]')?'alert-or-error':rootText?.match(/no .*?(?:found|available|yet)|nothing|empty/i)?'possibly-empty':'populated-or-guidance';
 return{title:document.querySelector('#section-title')?.textContent,rootText,branch,controls,numeric,layout:{viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth+1},optgroups:root.querySelectorAll('optgroup').length};
});}
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of[320,1280])for(const theme of['light','dark']){
  const pages=[],pairErrors={baseline:[],candidate:[]},writes=[],readOnlyChecks=[],transportErrors=[];
  for(const[name,base]of[['baseline',baseline],['candidate',candidate]]){
   const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(15000);pages.push({name,base,context,page});
   await page.clock.setFixedTime(new Date('2026-11-10T04:30:00Z'));
   await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','numeric-v2-route-pairs');localStorage.setItem('duty_rota_working_month','2026-11');});
   page.on('pageerror',error=>pairErrors[name].push(error.message));
   await page.route('**/api/**',async route=>{
    const req=route.request(),u=new URL(req.url()),method=req.method(),path=u.pathname;
    // Existing phase-one check is read-only validation. It is separately counted,
    // never described as a persisted write or hidden behind GET-only wording.
    const readOnlyCheck=method==='POST'&&path==='/api/v1/admin/rota-rules/phase-one/check';
    if(method!=='GET'&&!readOnlyCheck){writes.push({name,method,path});return route.fulfill({status:599,json:{detail:'Numeric style audit refuses mutations'}});}
    if(readOnlyCheck)readOnlyChecks.push({name,method,path,body:req.postData()});
    try{await route.fulfill(await fixture(method,path,u.search,req.postData()));}
    catch(error){transportErrors.push({name,path,error:error.message});await route.fulfill({status:599,json:{detail:'Disposable fixture transport failed'}}).catch(()=>{});}
   });
   await page.goto(base+'/#view=overview',{waitUntil:'domcontentloaded'});await page.locator('#view-root').waitFor();
  }
  try{for(const view of views){
   const row={engine,width,theme,view,passed:false};results.push(row);
   try{
    const observations={};
    for(const{name,page}of pages){await navigate(page,view);observations[name]=await snapshot(page);}
    row.baseline=observations.baseline;row.candidate=observations.candidate;
    assert.equal(row.candidate.title,row.baseline.title,'Actual route title');
    assert.equal(row.candidate.rootText,row.baseline.rootText,'All actual main text, including hidden responsive counterpart, unchanged');
    assert.deepEqual(row.candidate.controls,row.baseline.controls,'DOM action/control text, names, values, types, selected choices, states and nonnumeric font properties unchanged');
    assert.deepEqual(row.candidate.numeric.map(({variant,...n})=>n),row.baseline.numeric.map(({variant,...n})=>n),'Actual numeric text/value, controls/options and nonnumeric font properties unchanged');
    row.numericProbes=row.candidate.numeric.length;
    row.numericVariantFailures=row.candidate.numeric.filter(n=>!n.variant.split(/\s+/).includes('tabular-nums'));
    assert.deepEqual(row.numericVariantFailures,[],'All observed actual numeric leaves/controls/options request tabular digits');
    row.baselineOverflow=row.baseline.layout.overflow;
    row.newOverflow=!row.baseline.layout.overflow&&row.candidate.layout.overflow;
    assert.equal(row.newOverflow,false,'CSS must not introduce page-wide overflow');
    if(row.baselineOverflow)assert.ok(row.candidate.layout.documentWidth<=row.baseline.layout.documentWidth+1,'Existing baseline overflow must not grow');
    row.passed=true;
   }catch(error){row.failure=error.message;}
  }}finally{
   for(const{context,page}of pages){await page.unrouteAll({behavior:'ignoreErrors'});await context.close();}
   sessions.push({engine,width,theme,browserContexts:2,pairErrors,writes,readOnlyChecks,transportErrors});
  }
 }}finally{await browser.close();}
}
const final=await hashes();assert.deepEqual(final,initial);assert.equal(sha(await readFile(cssPath)),sha(candidateCss));
const passed=results.length===228&&results.every(r=>r.passed)&&sessions.length===12&&sessions.every(s=>!s.writes.length&&!s.transportErrors.length&&!s.pairErrors.baseline.length&&!s.pairErrors.candidate.length);
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/core_v12_final_review',operator:'/root when actually executed',execution_target:'Baseline5197 versus isolated V2 CSS5308; actual shared-current TS',candidate_css_sha256:sha(candidateCss),source_sha256:initial,final_source_sha256:final,test_sha256:sha(await readFile(new URL(import.meta.url))),servedSourcePreflight:preflight,scope:'12engine/width/theme comparison cases,24actual isolated browser contexts,228paired actual route observations/456route visits. Same cached RAM8031 response bodies and fixed Date per baseline/candidate. Existing read-only phase-one validation POST explicitly whitelisted/counted; every mutation denied. Actual main/action/control text/value/state/DOM label/font-family,size,weight,line-height comparison; numeric leaf/native-option computed variants and baseline-relative page overflow. No injected representative UI.',limits:['Native DOM labels are inspected; full computed accessibility tree and native AT are not certified.','Native popup/picker OS rendering is not proven by option/input computed styles. No equal-width glyph-shaping claim.','Visible populated numeric instances depend on actual disposable fixture; empty/guidance/error branches are classified and cannot prove missing data families.','No broad mutation outcome certification; existing read-only route navigation and style comparison only. Existing baseline overflow is recorded separately.','Controls are compared with selected option metadata; no claim of every opened popup/editor. Actual six-category V2 test is separate.','No physical-device verification or whole original31/260acceptance.'],sessions,results,passed},null,2)+'\n');
assert.equal(passed,true,'Inspect immutable numeric V2 paired route report for failures');
