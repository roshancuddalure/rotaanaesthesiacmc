import assert from 'node:assert/strict';
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium, firefox, webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const sourceFiles=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|css)$/.test(p)).sort();
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async p=>['frontend/src/'+p,createHash('sha256').update(await readFile('src/'+p)).digest('hex')])));
const initial=await hashes(),testHash=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const results=[],names=['close','menu','star','warning','lock','check','chevron','search'];
const selectors=['[data-family=body]','.readonly-field','.member-match__raw','.person-metric strong','.person-day strong'];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const theme of ['light','dark'])for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,reducedMotion:'reduce'}),page=await context.newPage();
  const errors=[],requests=[],aborted=[],unexpected=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(!['127.0.0.1','localhost'].includes(url.hostname)){aborted.push({url:url.href,type:request.resourceType()});return route.abort('failed');}
   if(url.pathname.includes('/api/')){
    requests.push({method:request.method(),path:url.pathname});
    if(request.method()!=='GET'){unexpected.push({method:request.method(),path:url.pathname});return route.abort();}
    if(url.pathname==='/api/v1/admin/members/archive-all/preview')return route.fulfill({json:{members:2,linked_duties:0,future_duties:0,leave:0,postings:0,preview_token:'font-local-preview',confirm_phrase:'ARCHIVE 2 MEMBERS'}});
    if(url.pathname==='/api/v1/admin/members/archive-all/batches')return route.fulfill({json:[]});
    unexpected.push({method:request.method(),path:url.pathname});return route.abort();
   }
   return route.continue();
  });
  await page.goto(base+'/component-reference.html');
  await page.locator('[data-reference-action=primary-default]').waitFor();
  await page.evaluate(async names=>{
   const {decorativeIcon}=await import('/src/decorative-icons.ts');
   const {memberMatch}=await import('/src/ui.ts');
   const section=document.createElement('section');section.className='panel';section.id='font-family-fixture';
   section.innerHTML='<h2>Controlled family failure review</h2><p data-family="body">Body label 0123456789 WWW iii</p><label>Readonly ID<span class="readonly-field">source-id-0123456789</span></label>'+memberMatch('font-row',{raw:'Imported spelling 0123456789',status:'matched',name:'Dr Actual Shared Helper',selectedId:'font-member',selectedIdentity:{id:'font-member'},method:'canonical_exact'})+'<div class="person-metric"><strong>12345</strong><span>Inactive metric CSS fixture</span></div><div class="person-day"><strong>67890</strong><span>Inactive day CSS fixture</span></div><div id="font-icons" style="display:grid;gap:12px">'+names.map(name=>`<div data-font-icon="${name}" style="display:flex;align-items:center;gap:12px">${decorativeIcon(name)}<span>${name}</span></div>`).join('')+'</div><button id="open-font-archive" type="button">Review actual archive confirmation</button>';
   document.querySelector('#component-reference').prepend(section);
   document.querySelector('#open-font-archive').onclick=()=>import('/src/member-bulk.ts').then(m=>m.openArchiveAll(()=>{throw Error('Unexpected archive callback');}));
   const style=document.createElement('style');style.textContent='@font-face{font-family:Inter;src:url("https://font-failure.invalid/inter-family.woff2") format("woff2");font-weight:100 900;font-display:swap}@font-face{font-family:Georgia;src:url("https://font-failure.invalid/georgia-family.woff2") format("woff2");font-weight:100 900;font-display:swap}';document.head.append(style);
   window.__familyOutcomes=await Promise.all(['Inter','Georgia'].map(async family=>({family,...await document.fonts.load(`16px ${family}`,'Family labels 0123456789').then(()=>({unexpectedSuccess:true}),e=>({rejected:true,name:e.name}))})));
   await document.fonts.ready;
  },names);
  const families=[];
  const inspect=async(selector,label)=>{
   const target=page.locator(selector);await target.scrollIntoViewIfNeeded();
   const result=await target.evaluate((element,label)=>{
    const style=getComputedStyle(element),rect=element.getBoundingClientRect(),text=element instanceof HTMLInputElement?element.value:element.textContent.trim();
    const fallback=style.fontFamily.replace(/^\s*["']?(Inter|Georgia)["']?\s*,\s*/i,'');
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    ctx.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;const width=ctx.measureText(text).width;
    ctx.font=`${style.fontWeight} ${style.fontSize} ${fallback}`;const fallbackWidth=ctx.measureText(text).width;
    const point={x:Math.min(innerWidth-1,Math.max(1,rect.x+rect.width/2)),y:Math.min(innerHeight-1,Math.max(1,rect.y+rect.height/2))},hit=document.elementFromPoint(point.x,point.y);
    return{label,text,family:style.fontFamily,fallback,fontSize:style.fontSize,width,fallbackWidth,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},visible:style.visibility!=='hidden'&&style.display!=='none'&&rect.height>0&&rect.width>0,hit:element===hit||element.contains(hit),color:style.color};
   },label);
   assert.ok(result.text&&result.visible&&result.hit,label+' real rendered text remains present and unobscured');
   assert.match(result.family,/sans-serif|monospace|serif/);
   assert.ok(result.width>0,label+' rendered text has positive measured width');
   if(!/^Georgia,/.test(result.family))assert.ok(Math.abs(result.width-result.fallbackWidth)<0.02,label+' current stack agrees with its local/generic fallback after failed webfont '+JSON.stringify(result));
   assert.ok(result.rect.x>=-1&&result.rect.x+result.rect.width<=width+1,label+' target stays within viewport');
   families.push(result);return result;
  };
  for(const selector of selectors)await inspect(selector,selector);
  const icons=await page.locator('#font-icons [data-font-icon]').evaluateAll(rows=>rows.map(row=>{const svg=row.querySelector('svg'),s=getComputedStyle(svg),r=svg.getBoundingClientRect();return{name:row.dataset.fontIcon,label:row.querySelector('span').innerText,hidden:svg.getAttribute('aria-hidden'),focusable:svg.getAttribute('focusable'),viewBox:svg.getAttribute('viewBox'),width:r.width,height:r.height,stroke:s.stroke,strokeWidth:s.strokeWidth,localPaths:svg.querySelectorAll('path,rect,circle').length,remoteNodes:svg.querySelectorAll('use,image').length};}));
  assert.deepEqual(icons.map(i=>i.name),names);
  assert.ok(icons.every(i=>i.name===i.label&&i.hidden==='true'&&i.focusable==='false'&&i.viewBox==='0 0 24 24'&&Math.abs(i.width-24)<.1&&Math.abs(i.height-24)<.1&&i.stroke!=='none'&&i.localPaths>0&&i.remoteNodes===0));
  await page.locator('#open-font-archive').focus();await page.keyboard.press('Enter');
  const dialog=page.locator('dialog.archive-all');await dialog.locator('[data-phrase]').waitFor();
  const archive=dialog.locator('[data-archive]');assert.equal(await archive.isDisabled(),true);
  const phrase=dialog.locator('[data-phrase]');await phrase.fill('ARCHIVE 2 MEMBERS');await phrase.press('Tab');assert.equal(await archive.isEnabled(),true);
  await inspect('dialog.archive-all .archive-all__phrase input','actual archive confirmation monospace input');
  assert.equal(await phrase.inputValue(),'ARCHIVE 2 MEMBERS');
  const cancel=dialog.getByRole('button',{name:'Cancel',exact:true});await cancel.focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'detached'});
  assert.equal(await page.locator('#open-font-archive').evaluate(e=>document.activeElement===e),true,'Actual archive Cancel restores native launcher focus');
  const font=await page.evaluate(()=>({outcomes:window.__familyOutcomes,status:document.fonts.status,faces:[...document.fonts].map(f=>({family:f.family,status:f.status})),overflow:document.documentElement.scrollWidth>innerWidth}));
  assert.ok(font.outcomes.every(o=>o.rejected));assert.equal(font.status,'loaded');assert.ok(['Inter','Georgia'].every(name=>font.faces.some(f=>f.family.replace(/["']/g,'')===name&&f.status==='error')));assert.equal(font.overflow,false);
  assert.equal(aborted.length,2);assert.ok(aborted.every(a=>a.url.startsWith('https://font-failure.invalid/')));
  assert.deepEqual(requests.map(r=>r.path).sort(),['/api/v1/admin/members/archive-all/batches','/api/v1/admin/members/archive-all/preview']);assert.ok(requests.every(r=>r.method==='GET'));assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
  results.push({engine,theme,width,families,icons,font,aborted,requests,unexpected,errors,archivePhraseNativeTyped:true,archiveEnabledWithoutApply:true,archiveCancelRestoredFocus:true});
  console.log(`Font family/icons PASS ${engine} ${theme} ${width}`);await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Source held during classified-family and icon-failure matrix');
await writeFile('../docs/premium-ui/reviews/font-family-icons-failure-current.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,test_sha256:testHash,scope:'All six current CSS font-family selector declarations in a controlled production-CSS component-reference fixture, actual memberMatch helper, all eight shared SVG families and actual archive confirmation type/enable/Cancel. External test-only Inter and Georgia webfont requests fail; the deployed stacks stay unchanged. Local generic monospace remains intrinsic. Three engines, two themes,320/1280. All API reads locally fulfilled and all mutations refused.','limits':['Controlled readonly-field and legacy person metric/day samples are CSS family fixtures, not a claim to exercise Setup or an operational person calendar. No current TS/HTML caller was found for person metric/day selectors.','Eight-icon family fixture proves the shared helper under font failure, not every operational placement. Current source classification links placements to the same helper; original24actualshell/profile/referencecases remain separately bound.','Failed external Georgia FontFace does not remove an OS-installed Georgia family: width against the secondary Times stack is diagnostic, not an equality assertion. Actual serif labels must remain positive-width, visible, hit-testable and contained. Inter stack metric equivalence is still asserted.','No actual production external font dependency, physical device, native assistive technology, OS font removal or universal200%text scaling claim.','The real archive destructive control is enabled but never activated; only actual Cancel is executed. No backend request or persistence.'],results},null,2)+'\n');
console.log(`Font family/icons workflows: ${results.length}`);
