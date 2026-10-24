import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const member={id:'container-member',canonical_name:'Dr Alexandra Long Department Member',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],revision:'one'};
const names=['member-workspace.ts','styles.css','premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(names.map(async n=>[n,createHash('sha256').update(await readFile('src/'+n)).digest('hex')])));
const before=await hashes();
for(const[engine,type]of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{for(const noObserver of [false,true]){
  const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'}),page=await context.newPage(),writes=[],errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(noObserver=>{if(noObserver)window.ResizeObserver=undefined;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedMemberId=value;}}});},noObserver);
  await page.route('**/__member_container',r=>r.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open</button></body></html>'}));
  await page.route('**/api/**',r=>{const req=r.request(),path=new URL(req.url()).pathname;if(req.method()!=='GET'){writes.push(path);return r.fulfill({status:599,json:{detail:'Read-only review'}});}if(path.endsWith('/admin/member-workspace/container-member'))return r.fulfill({json:{member,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});if(path.endsWith('/members/container-member/profile'))return r.fulfill({json:{member,today:'2026-10-22',current_call_level:'2ND_CALL',can_manage:true,call_history:[],comments:[],postings:[],leaves:[],imports:[],statistics:{official_duties:0,hours24:0,weekend_duties:0}}});return r.fulfill({json:{rows:[]}});});
  await page.goto(base+'/__member_container');await page.evaluate(async()=>{const m=await import('/src/member-workspace.ts');await m.openMemberWorkspace('container-member',true,()=>{});});
  const dialog=page.getByRole('dialog',{name:'Member profile',exact:true}),rail=dialog.getByRole('tablist',{name:'Member sections',exact:true});await rail.waitFor();
  const sizes=noObserver?[[1280,720,360],[320,568,null],[844,390,null]]:[[1280,720,360],[1280,720,699],[1280,720,700],[1280,720,701],[1280,720,702],[1280,720,703],[1280,720,1120],[320,568,null],[844,390,null]];
  const outcomes=[];
  for(const[width,height,size]of sizes){
   await page.setViewportSize({width,height});await dialog.evaluate((el,size)=>{el.style.width=size?size+'px':'';el.style.maxWidth=size?size+'px':'';},size);
   if(noObserver)await page.evaluate(()=>dispatchEvent(new Event('resize')));
   await page.waitForTimeout(100);
   const actualWidth=await dialog.evaluate(el=>el.clientWidth),horizontal=actualWidth<=700;
   assert.equal(await rail.getAttribute('aria-orientation'),horizontal?'horizontal':'vertical');
   assert.equal(await rail.evaluate(el=>getComputedStyle(el).flexDirection),horizontal?'row':'column');
   await dialog.getByRole('tab',{name:'Activity',exact:true}).click();
   await page.waitForTimeout(60);
   const visible=await rail.evaluate(el=>{const s=el.querySelector('[aria-selected=true]'),r=el.getBoundingClientRect(),t=s.getBoundingClientRect();return{left:t.left>=r.left-1,right:t.right<=r.right+1,top:t.top>=r.top-1,bottom:t.bottom<=r.bottom+1};});
   assert.equal(horizontal?visible.left&&visible.right:visible.top&&visible.bottom,true,'Selected Activity must be revealed in actual rail direction');
   await page.keyboard.press('Home');assert.equal(await dialog.getByRole('tab',{name:'Overview',exact:true}).getAttribute('aria-selected'),'true');
   await page.keyboard.press(horizontal?'ArrowRight':'ArrowDown');assert.equal(await dialog.getByRole('tab',{name:'Details',exact:true}).getAttribute('aria-selected'),'true');
   await page.keyboard.press('End');assert.equal(await dialog.getByRole('tab',{name:'Activity',exact:true}).getAttribute('aria-selected'),'true');
   await page.keyboard.press('Home');await page.keyboard.press(horizontal?'ArrowRight':'ArrowDown');
   const details=dialog.getByRole('tab',{name:'Details',exact:true});await details.focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('role')==='tabpanel'),true,'Native Tab leaves roving rail for Details panel');
   const copy=dialog.getByRole('button',{name:'Copy member ID',exact:true});await copy.click();assert.equal(await page.evaluate(()=>window.__copiedMemberId),'container-member');
   const fieldWidth=await dialog.locator('[data-field="canonical_name"]').evaluate(el=>el.getBoundingClientRect().width);
   if(size===360)assert.ok(fieldWidth>=250,`Constrained profile field must recover readable width, measured ${fieldWidth}`);
   outcomes.push({width,height,constrainedWidth:size,actualWidth,fieldWidth,orientation:horizontal?'horizontal':'vertical',selectedActivityRevealed:true,homeEndArrowKeyboard:true,nativeTabToContent:true,copy:true,documentOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)});
  }
  await dialog.getByRole('button',{name:'Edit profile',exact:true}).click();const name=dialog.locator('[data-field="canonical_name"]');await name.fill('Dr Retained Container Draft');await name.focus();await name.evaluate(el=>el.setSelectionRange(3,11));
  await page.setViewportSize({width:1280,height:720});await dialog.evaluate(el=>{el.style.width='360px';el.style.maxWidth='360px';});if(noObserver)await page.evaluate(()=>dispatchEvent(new Event('resize')));await page.waitForTimeout(100);
  assert.equal(await name.inputValue(),'Dr Retained Container Draft');assert.equal(await name.evaluate(el=>el===document.activeElement),true);assert.deepEqual(await name.evaluate(el=>[el.selectionStart,el.selectionEnd]),[3,11]);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);results.push({engine,noResizeObserver:noObserver,outcomes,draftAndFieldFocusAndSelectionRetained:true});await writeFile('../tmp/premium-member-container-partial.json',JSON.stringify({sourcesBefore:before,results},null,2));await context.close();
 }}finally{await browser.close();}
}
const after=await hashes();assert.deepEqual(after,before);
await writeFile('../docs/premium-ui/qa-member-container-independent.json',JSON.stringify({createdAt:new Date().toISOString(),sources:after,scope:'Production canonical member UI/CSS with intercepted GETs and local clipboard stub. Three engines; actual dialog widths across700 boundary and phone/landscape; no ResizeObserver fallback uses window resize event. No physical device, native clipboard persistence, writes or all-profile-action claim.',results},null,2)+'\n');
console.log('Independent member container: six engine/observer workflows passed');
