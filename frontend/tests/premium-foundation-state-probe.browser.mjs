import {chromium} from 'playwright';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const paths=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|css)$/.test(p)).sort();
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/src/'+p,createHash('sha256').update(await readFile('src/'+p)).digest('hex')])));
const initial=await hashes(),results=[],testSha=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const browser=await chromium.launch();
async function measure(locator){return locator.evaluate(e=>{
 const rgba=s=>{const n=s.match(/[\d.]+/g)?.map(Number)||[];return [n[0]||0,n[1]||0,n[2]||0,n.length>3?n[3]:1];};
 const over=(a,b)=>{const z=a[3]+b[3]*(1-a[3]);return [...a.slice(0,3).map((v,i)=>(v*a[3]+b[i]*b[3]*(1-a[3]))/(z||1)),z];};
 const stack=[];for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);stack.push({tag:n.tagName,classes:n.className,rgba:s.backgroundColor,image:s.backgroundImage,opacity:s.opacity});}
 let bg=[255,255,255,1];for(const s of [...stack].reverse())bg=over(rgba(s.rgba),bg);
 const lum=a=>a.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05),s=getComputedStyle(e),fg=over(rgba(s.color),bg),large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700);
 let outer=[255,255,255,1];for(const item of stack.slice(1).reverse())outer=over(rgba(item.rgba),outer);
 const disabled=e.matches(':disabled,[aria-disabled=true]'),unknown=stack.some(x=>x.image!=='none'||Number(x.opacity)!==1);
 return {text:(e.innerText||e.value||'').trim(),color:s.color,background:s.backgroundColor,backgroundStack:stack,compositedBackground:bg,fontSize:s.fontSize,fontWeight:s.fontWeight,large,textContrast:ratio(fg,bg),textThreshold:disabled?null:large?3:4.5,disabled,unknownBackgroundOrOpacity:unknown,border:s.borderTopColor,borderWidth:s.borderTopWidth,borderContrastToOutside:ratio(rgba(s.borderTopColor),outer),outline:s.outlineColor,outlineWidth:s.outlineWidth,outlineStyle:s.outlineStyle,outlineContrastToOutside:ratio(rgba(s.outlineColor),outer),focusVisible:e.matches(':focus-visible'),hover:e.matches(':hover'),active:e.matches(':active')};
});}
async function states(page,locator,label){
 await locator.scrollIntoViewIfNeeded();await page.mouse.move(0,0);await locator.evaluate(e=>e.blur());results.push({label,state:'default',...await measure(locator)});
 await locator.hover();results.push({label,state:'hover',...await measure(locator)});
 await page.evaluate(()=>{window.__foundationSuppress=e=>{e.preventDefault();e.stopImmediatePropagation();};document.addEventListener('click',window.__foundationSuppress,true);});
 const box=await locator.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();results.push({label,state:'active',...await measure(locator)});await page.mouse.up();await page.evaluate(()=>document.removeEventListener('click',window.__foundationSuppress,true));await page.mouse.move(0,0);
 await page.keyboard.press('Tab');await locator.focus();results.push({label,state:'keyboard-focus',...await measure(locator)});
}
try{for(const scheme of ['light','dark'])for(const width of [320,1280]){
 const context=await browser.newContext({viewport:{width,height:900},colorScheme:scheme,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));const start=results.length;
 await page.goto('http://127.0.0.1:5197/component-reference.html');await page.locator('[data-reference-action=primary-default]').waitFor();
 for(const type of ['primary','secondary','quiet','danger']){await states(page,page.locator(`[data-reference-action=${type}-default]`),'reference-'+type);results.push({label:'reference-'+type,state:'disabled',...await measure(page.locator(`[data-reference-variant=${type}] button:disabled`).first())});}
 await states(page,page.locator('[name=name]'),'reference-input');await page.locator('[data-reference-invalid]').click();results.push({label:'reference-input',state:'invalid-focused',...await measure(page.locator('[name=name]'))});
 await page.route('**/__foundation_profile',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open member</button></body></html>'}));
 await page.route('**/api/**',r=>{assert.equal(r.request().method(),'GET');const p=new URL(r.request().url()).pathname;return r.fulfill({json:p.endsWith('/foundation')?{member:{id:'foundation',canonical_name:'Dr Foundation Example',active_status:'active',call_level:'1ST_CALL',aliases:[],designations:[],call_level_changes:[]},impact:{}}:{rows:[]}});});
 await page.goto('http://127.0.0.1:5197/__foundation_profile');await page.evaluate(()=>{document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('foundation',true,()=>{},['foundation'],'details'));});await page.locator('#open').click();const d=page.getByRole('dialog');await d.locator('[data-edit]').click();
 await states(page,d.locator('button.primary[type=submit]'),'actual-profile-save');await states(page,d.locator('[data-field=canonical_name]'),'actual-profile-input');await states(page,d.locator('[data-close]'),'actual-profile-close');await states(page,d.locator('[data-tab=details]'),'actual-profile-selected-tab');
 results.push({label:'actual-profile-next',state:'disabled',...await measure(d.locator('[data-next]'))});
 assert.deepEqual(errors,[]);for(const item of results.slice(start)){item.scheme=scheme;item.width=width;}await context.close();
 }}finally{await browser.close();}
assert.deepEqual(await hashes(),initial);const failures=results.filter(r=>r.textThreshold!==null&&!r.unknownBackgroundOrOpacity&&r.textContrast<r.textThreshold);
await writeFile('../docs/premium-ui/reviews/foundation-state-probe-current.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Read-only Chromium probe: actual canonical profile plus isolated actual component reference, light/dark 320/1280, native hover pointer down keyboard focus. All API GETs fulfilled locally. No generic whole-app or all-engine certification. Essential-border applicability requires separate review; disabled text exempt. RGB ancestor stack includes opacity/gradient flags; flagged samples not certified.',source_sha256:initial,test_sha256:testSha,pointerPressMeasurement:'Click suppressed only during pointer down/up measurement to avoid activating operational controls. This is state styling evidence, not button outcome certification.',results,verifiedTextFailures:failures.map(({label,state,scheme,width,textContrast,textThreshold,color,background})=>({label,state,scheme,width,textContrast,textThreshold,color,background}))},null,2)+'\n');console.log(JSON.stringify({samples:results.length,verifiedTextFailures:failures.map(r=>({label:r.label,state:r.state,scheme:r.scheme,width:r.width,contrast:r.textContrast}))},null,2));
