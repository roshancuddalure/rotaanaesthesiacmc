import assert from 'node:assert/strict';
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium, firefox, webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const fixture=process.env.UX_AUDIT_API||'http://127.0.0.1:8031';
assert.equal(new URL(fixture).hostname,'127.0.0.1');
const files=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|css)$/.test(p)).sort();
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>['frontend/src/'+p,createHash('sha256').update(await readFile('src/'+p)).digest('hex')])));
const initial=await hashes(),testHash=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const results=[],failures=[];
const member={id:'font-member',canonical_name:'Dr Font Fallback Example',active_status:'active',call_level:'1ST_CALL',aliases:[],designations:[],call_level_changes:[]};

async function fontProbe(page,label){
 await page.evaluate(async()=>{
  const style=document.createElement('style');
  style.textContent='@font-face{font-family:Inter;src:url("https://font-failure.invalid/forced-unavailable-inter.woff2") format("woff2");font-weight:100 900;font-style:normal;font-display:swap}';
  document.head.append(style);
  window.__fontLoadOutcome=await document.fonts.load('16px Inter','Fallback label measurement').then(()=>({unexpectedSuccess:true}),e=>({rejected:true,name:e.name}));
  await document.fonts.ready;
 });
 return page.evaluate(label=>{
  const family=getComputedStyle(document.body).fontFamily;
  const fallback=family.replace(/^\s*["']?Inter["']?\s*,\s*/i,'');
  const text='Fallback label measurement WWW iii 0123456789';
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  ctx.font=`16px ${family}`;const actualWidth=ctx.measureText(text).width;
  ctx.font=`16px ${fallback}`;const fallbackWidth=ctx.measureText(text).width;
  const span=document.createElement('span');span.textContent=text;span.style.cssText='position:absolute;visibility:hidden;white-space:nowrap;font-size:16px;line-height:24px;font-weight:400';document.body.append(span);
  const originalRect=span.getBoundingClientRect().toJSON();span.style.fontFamily=fallback;const fallbackRect=span.getBoundingClientRect().toJSON();span.remove();
  return {label,family,fallback,rootFontSize:getComputedStyle(document.documentElement).fontSize,bodyFontSize:getComputedStyle(document.body).fontSize,actualWidth,fallbackWidth,originalRect,fallbackRect,fontStatus:document.fonts.status,fontLoadOutcome:window.__fontLoadOutcome,fontFaces:[...document.fonts].map(f=>({family:f.family,status:f.status})),fontCheckInter:document.fonts.check('16px Inter'),overflow:document.documentElement.scrollWidth>innerWidth};
 },label);
}
async function geometry(control){
 await control.scrollIntoViewIfNeeded();
 return control.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {width:r.width,height:r.height,text:(e.innerText||e.getAttribute('aria-label')||'').trim(),color:s.color,fontFamily:s.fontFamily,fontSize:s.fontSize,minimum44:r.width>=43.9&&r.height>=43.9,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e||e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});
}

for(const [engine,launcher] of Object.entries(process.env.FONT_TEST_ENGINES?Object.fromEntries(process.env.FONT_TEST_ENGINES.split(',').map(n=>[n,{chromium,firefox,webkit}[n]])):{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const scheme of ['light','dark'])for(const width of [320,1280])for(const enlarged of [false,true]){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:scheme,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(12000);
  const errors=[],aborted=[],failedRequests=[],reads=[],unexpected=[],fontResults=[],controls=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
  await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','font-fixture');localStorage.setItem('duty_rota_working_month','2026-11');});
  await context.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url());
   if(!['127.0.0.1','localhost'].includes(u.hostname)){aborted.push({url:q.url(),type:q.resourceType(),synthetic:u.hostname==='font-failure.invalid'});return r.abort('failed');}
   if(u.pathname.includes('/api/')){
    reads.push({method:q.method(),path:u.pathname+u.search});
    if(q.method()!=='GET'){unexpected.push({method:q.method(),path:u.pathname});return r.abort();}
    if(u.pathname.includes('font-member'))return r.fulfill({json:u.pathname.endsWith('/font-member')?{member,impact:{}}:{rows:[]}});
    return r.fulfill({response:await r.fetch({url:fixture+u.pathname+u.search})});
   }
   return r.continue();
  });
  await page.route('**/__font_profile',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open member profile</button></body></html>'}));
  const zoom=async()=>{if(enlarged)await page.addStyleTag({content:':root{font-size:200%}'});};
  const recordFont=async label=>{const p=await fontProbe(page,label);fontResults.push(p);assert.match(p.family,/^Inter,/);assert.equal(p.fontLoadOutcome.rejected,true);assert.ok(p.fontFaces.some(f=>f.family.replace(/["']/g,'')==='Inter'&&f.status==='error'),'Declared primary FontFace must be in error state');assert.equal(p.fontStatus,'loaded');assert.ok(Math.abs(p.actualWidth-p.fallbackWidth)<0.02);assert.ok(Math.abs(p.originalRect.width-p.fallbackRect.width)<0.02);assert.ok(p.originalRect.height>0);assert.equal(p.overflow,false,label+' page overflow');};
  try{
   await page.goto(base+'/#view=user-guide');await page.locator('#guide-checklist').waitFor();await zoom();await recordFont('actual-shell-guide');
   if(width===320){const open=page.locator('#sidebar-toggle'),close=page.locator('#sidebar-close');controls.push({label:'menu-open',...await geometry(open)});await open.focus();await page.keyboard.press('Enter');await close.waitFor({state:'visible'});controls.push({label:'menu-close',...await geometry(close)});await close.focus();await page.keyboard.press('Enter');assert.equal(await open.evaluate(e=>e===document.activeElement),true);}
   else {await page.locator('#account-menu-button').click();await page.locator('#profile').waitFor({state:'visible'});await page.keyboard.press('Escape');}
   const icons=await page.locator('#sidebar-toggle svg,#sidebar-close svg').evaluateAll(ns=>ns.map(e=>({hidden:e.getAttribute('aria-hidden'),focusable:e.getAttribute('focusable'),paths:e.querySelectorAll('path,line,polyline,circle').length,stroke:getComputedStyle(e).stroke})));
   assert.equal(icons.length,2);assert.ok(icons.every(i=>i.hidden==='true'&&i.focusable==='false'&&i.paths>0&&i.stroke!=='none'));
   assert.equal(await page.locator('#working-month').inputValue(),'2026-11');
   await page.goto(base+'/__font_profile');await zoom();await page.evaluate(()=>{document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('font-member',true,()=>{},[],'details'));});await page.locator('#open').click();const dialog=page.locator('dialog.member-workspace');await dialog.locator('[data-edit]').click();await recordFont('actual-canonical-profile');
   await dialog.locator('[data-field=canonical_name]').fill('Unsaved fallback edit');const cancel=dialog.getByRole('button',{name:'Cancel',exact:true});controls.push({label:'profile-cancel',...await geometry(cancel)});const confirmation=page.waitForEvent('dialog');const cancelled=cancel.click();const prompt=await confirmation;assert.equal(prompt.message(),'Discard unsaved changes?');await prompt.accept();await cancelled;assert.equal(await dialog.locator('[data-field=canonical_name]').inputValue(),member.canonical_name);assert.equal(await dialog.locator('[data-field=canonical_name]').getAttribute('readonly'),'');assert.equal(await dialog.locator('[data-edit]').count(),1);assert.match(await dialog.innerText(),/Dr Font Fallback Example/);const close=dialog.locator('[data-close]');controls.push({label:'profile-close',...await geometry(close)});await close.click();await dialog.waitFor({state:'detached'});
   await page.goto(base+'/component-reference.html');await page.locator('[data-reference-action=primary-default]').waitFor();await zoom();await recordFont('actual-component-reference');const action=page.locator('[data-reference-action=primary-default]');controls.push({label:'reference-primary',...await geometry(action)});await action.focus();await page.keyboard.press('Enter');assert.match(await page.locator('[data-reference-result]').innerText(),/completed locally; no record was saved/);
   assert.ok(controls.every(c=>c.width>0&&c.height>0&&c.text&&c.hit),'Tested operational targets remain readable and hit-testable');
   assert.equal(aborted.filter(r=>r.synthetic).length,3,'One actual forced unavailable font request per tested document');assert.ok(failedRequests.filter(r=>r.url.includes('font-failure.invalid')).length===3);
   assert.deepEqual(reads.map(r=>r.path).sort(),['/api/health','/api/v1/admin/mappings','/api/v1/admin/mappings/options','/api/v1/admin/member-workspace/font-member','/api/v1/auth/me'].sort(),'Exact expected read set; no mutation or extra request');assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
   results.push({engine,scheme,width,enlarged,fontResults,controls,icons,reads,aborted,failedRequests,errors,profileEditCancelledWithoutWrite:true,referenceLocalActionOutcome:true,workingMonthPreserved:true});
   console.log(`Font fallback PASS ${engine} ${scheme} ${width} enlarged=${enlarged}`);
  }catch(error){failures.push({engine,scheme,width,enlarged,message:error.message,stack:error.stack,fontResults,controls,reads,aborted,failedRequests,errors});console.log(`Font fallback FAIL ${engine} ${scheme} ${width} enlarged=${enlarged}: ${error.message}`);}
  await context.close();
 }}finally{await browser.close();}
}
const final=await hashes();assert.deepEqual(final,initial,'Application source unchanged throughout the run');
const report={recorded_at_utc:new Date().toISOString(),source_sha256:initial,test_sha256:testHash,scope:'Actual application guide/shell, canonical member workspace opened through real exported module and native launcher, and deployed component reference. Three engines, light/dark, 320/1280, normal/200% root font-size override (explicit px-token text may remain unchanged). Injected test-only failed Inter @font-face; deployed font-family stack is never replaced. All external resources aborted and all API traffic GET-only to disposable loopback fixture or locally fulfilled profile reads. No persistence, application changes, physical devices or native assistive technology.',limits:['Synthetic blocked Inter request proves unavailable-primary fallback; the application itself currently requests no optional external font/icon assets, so no actual production external-font outage was exercised.','Text metrics and native outcomes cover named surfaces/controls, not every label or operating-system font installation. FontFace error state and rejected load establish failure; fontCheckInter is diagnostic because WebKit returned true despite the rejected/error face in this local run.','200% root font-size override is not universal text enlargement: actual root/body/control font sizes are recorded; explicit px-token control text may stay unchanged. No physical zoom or software keyboard is exercised.','No whole-item acceptance is granted by this report.'],existing_target_geometry_findings:results.flatMap(r=>r.controls.filter(c=>!c.minimum44).map(c=>({engine:r.engine,scheme:r.scheme,width:r.width,enlarged:r.enlarged,...c}))),application_external_resources:results.flatMap(r=>r.aborted.filter(a=>!a.synthetic)),results,failures};
await writeFile('../docs/premium-ui/reviews/font-resource-fallback-current.json',JSON.stringify(report,null,2)+'\n');assert.equal(failures.length,0,failures.map(f=>`${f.engine}/${f.scheme}/${f.width}/${f.enlarged}: ${f.message}`).join('\n'));console.log(`Font fallback workflows: ${results.length}`);
