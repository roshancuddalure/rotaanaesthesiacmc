// Bounded reference controls: real sequential keyboard focus, disabled skips and local outcomes.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox} from 'playwright';
const out='../docs/premium-ui/qa-reference-focus-states';
await mkdir(out,{recursive:true});
const files=['src/component-reference.ts','src/component-reference.css','src/ui.ts','src/styles.css','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async file=>['frontend/'+file,createHash('sha256').update(await readFile(file)).digest('hex')])));
const before=await hashes(),results=[];
async function focusEvidence(control){
 return control.evaluate(el=>{
  const r=el.getBoundingClientRect(),s=getComputedStyle(el),pad=parseFloat(s.outlineWidth)+Math.max(0,parseFloat(s.outlineOffset)),clippers=[];
  for(let p=el.parentElement;p;p=p.parentElement){const style=getComputedStyle(p);if(/hidden|clip/.test(style.overflowX+' '+style.overflowY)){const b=p.getBoundingClientRect();clippers.push({tag:p.tagName,left:b.left,right:b.right,top:b.top,bottom:b.bottom});}}
  return {focusVisible:el.matches(':focus-visible'),outlineStyle:s.outlineStyle,outlineWidth:parseFloat(s.outlineWidth),outlineOffset:s.outlineOffset,outlineColor:s.outlineColor,
   box:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},viewport:{width:innerWidth,height:innerHeight},pad,clippers,
   hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el};
 });
}
function checkFocus(e,label){
 assert.ok(e.focusVisible,label+': keyboard focus-visible');
 assert.ok(!['none','hidden'].includes(e.outlineStyle)&&e.outlineWidth>=2,label+': visible outline geometry');
 assert.ok(e.hit,label+': unobscured focused control');
 assert.ok(e.box.left-e.pad>=-1&&e.box.right+e.pad<=e.viewport.width+1&&e.box.top-e.pad>=-1&&e.box.bottom+e.pad<=e.viewport.height+1,label+': outline within viewport');
 for(const c of e.clippers)assert.ok(e.box.left-e.pad>=c.left-1&&e.box.right+e.pad<=c.right+1&&e.box.top-e.pad>=c.top-1&&e.box.bottom+e.pad<=c.bottom+1,label+': outline not clipped by '+c.tag);
}
for(const [engine,type]of Object.entries({chromium,firefox})){
 const browser=await type.launch();
 try{for(const colorScheme of ['light','dark'])for(const width of [320,1280])for(const forcedColors of ['none','active']){
  const context=await browser.newContext({viewport:{width,height:800},colorScheme,forcedColors,reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{requests.push(route.request().url());return route.abort();});
  try{
   await page.goto('http://127.0.0.1:5197/component-reference.html');
   const supported=await page.evaluate(()=>matchMedia('(forced-colors: active)').matches);
   assert.equal(supported,forcedColors==='active','Requested forced-colors emulation must actually activate');
   const controls=[];
   // These are the first enabled tab stops; disabled and busy controls between them must be skipped.
   for(const key of ['primary','secondary','quiet','danger']){
    const group=page.locator(`[data-reference-variant="${key}"]`),button=group.locator('[data-reference-action]');
    await page.keyboard.press('Tab');assert.equal(await button.evaluate(el=>el===document.activeElement),true,key+': sequential Tab skips disabled/busy controls');
    const focus=await focusEvidence(button);checkFocus(focus,key);
    await page.keyboard.press('Enter');assert.match(await page.locator('[data-reference-result]').innerText(),/completed locally; no record was saved/);
    const status=await page.locator('[data-reference-result]').innerText();
    for(const disabled of await group.locator('button:disabled').all()){
     assert.equal(await disabled.isDisabled(),true);
     await disabled.evaluate(el=>el.click());
     assert.equal(await page.locator('[data-reference-result]').innerText(),status,'Native disabled activation has no local outcome');
    }
    assert.equal(await group.locator('[aria-busy=true]').isDisabled(),true);
    controls.push({key,focus,disabled_skipped:true,busy_disabled:true,local_action:true});
   }
   const ready=page.locator('#reference-tab-ready'),recovery=page.locator('#reference-tab-recovery');
   await page.keyboard.press('Tab');
   // Firefox adds a native keyboard stop on the horizontally scrollable tab rail.
   const nativeRailStop=await page.getByRole('tablist',{name:'Reference state panels'}).evaluate(el=>el===document.activeElement);
   if(nativeRailStop)await page.keyboard.press('Tab');
   assert.equal(await ready.evaluate(el=>el===document.activeElement),true,JSON.stringify({engine,colorScheme,width,forcedColors,active:await page.evaluate(()=>document.activeElement.outerHTML)}));
   checkFocus(await focusEvidence(ready),'Ready tab');
   await page.keyboard.press('ArrowRight');assert.equal(await recovery.evaluate(el=>el===document.activeElement),true);
   assert.equal(await ready.getAttribute('aria-selected'),'true','Arrow focus retains manual selection');
   checkFocus(await focusEvidence(recovery),'Recovery tab');
   await page.keyboard.press('Space');assert.equal(await recovery.getAttribute('aria-selected'),'true');
   const selected=await recovery.evaluate(el=>{const s=getComputedStyle(el);return {border:s.borderBottom,color:s.color,background:s.backgroundColor,fontWeight:s.fontWeight,textDecoration:s.textDecorationLine,textDecorationThickness:s.textDecorationThickness};});
   const unselected=await ready.evaluate(el=>{const s=getComputedStyle(el);return {border:s.borderBottom,color:s.color,background:s.backgroundColor,fontWeight:s.fontWeight,textDecoration:s.textDecorationLine,textDecorationThickness:s.textDecorationThickness};});
   assert.notDeepEqual(selected,unselected,'Selected tab retains a computed visual distinction');
   await page.keyboard.press('Tab');assert.equal(await page.locator('#reference-panel-recovery').evaluate(el=>el===document.activeElement),true);
   await page.keyboard.press('Shift+Tab');assert.equal(await recovery.evaluate(el=>el===document.activeElement),true);
   await page.screenshot({path:`${out}/${engine}-${colorScheme}-${width}-${forcedColors}.png`});
   assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
   results.push({engine,colorScheme,width,forcedColors,forcedColorsActivated:supported,controls,selected,unselected,nativeRailStop,manual_tab_selection:true,api_requests:0,page_errors:0,passed:true});
  }finally{await context.close();}
 }}finally{await browser.close();}
}
assert.equal(results.length,16);assert.deepEqual(await hashes(),before,'Declared reference and imported theme/UI sources held');
await writeFile(`${out}/report.json`,JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Isolated reference: four action variants and manual selection tabs, actual sequential Tab/ShiftTab, disabled/busy exclusion, outline geometry/viewport/ancestor clips, local outcomes and forced-colors emulation. Computed distinctions do not certify pixel contrast, every operational control, native Windows high contrast, physical devices or native AT.',whole_requirement_completion_proven:false,source_sha256:before,results},null,2)+'\n');
console.log('Reference focus states:16 contexts passed');
