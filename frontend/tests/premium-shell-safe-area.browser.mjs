import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const paths=['src/main.ts','src/member-workspace.ts','src/styles.css','src/premium-theme.css','index.html'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async n=>['frontend/'+n,createHash('sha256').update(await readFile(n)).digest('hex')]))),initial=await hashes(),results=[];
assert.match(await readFile('index.html','utf8'),/viewport-fit=cover/);
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,390,768,844,900,1280])for(const synthetic of [false,true]){
  const safe=synthetic?{top:28,right:28,bottom:34,left:24}:{top:0,right:0,bottom:0,left:0};
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','safe-area');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async r=>{const q=r.request(),u=new URL(q.url());assert.equal(q.method(),'GET','Shell and native draft review never writes');if(u.pathname==='/api/v1/admin/member-workspace/safe-person')return r.fulfill({json:{member:{id:'safe-person',canonical_name:'Dr Safe Area',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[]},impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});return r.fulfill({response:await r.fetch({url:'http://127.0.0.1:8031'+u.pathname+u.search})});});
  await page.goto('http://127.0.0.1:5197/#view=user-guide');await page.locator('#guide-checklist').waitFor();await page.addStyleTag({content:':root{'+Object.entries(safe).map(([side,value])=>`--safe-area-${side}:${value}px`).join(';')+'}'});
  const sidebar=page.locator('.sidebar'),mobile=width<=768;
  const paddings=locator=>locator.evaluate(e=>{const s=getComputedStyle(e);return {top:parseFloat(s.paddingTop),right:parseFloat(s.paddingRight),bottom:parseFloat(s.paddingBottom),left:parseFloat(s.paddingLeft)};});
  if(mobile){
   assert.equal(await sidebar.evaluate(e=>e.inert),true);const toggle=page.locator('#sidebar-toggle');await toggle.focus();await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await sidebar.getAttribute('role'),'dialog');assert.equal(await sidebar.evaluate(e=>e.inert),false);assert.equal(await page.locator('.content').evaluate(e=>e.inert),true);
   const p=await paddings(sidebar);for(const side of Object.keys(safe))assert.ok(p[side]>=safe[side],`drawer ${side}`);
   await page.keyboard.press('Escape');assert.equal(await sidebar.evaluate(e=>e.inert),true);assert.equal(await toggle.evaluate(e=>e===document.activeElement),true);
   const nav=page.locator('.mobile-bottom-nav'),box=await nav.boundingBox();assert.ok(box.x>=safe.left-1&&box.x+box.width<=width-safe.right+1&&box.y+box.height<=900-safe.bottom+1);
   for(const b of await nav.locator('button').all()){const bb=await b.boundingBox();assert.ok(bb.width>=44&&bb.height>=44,'Bottom navigation keeps44px controls');}
   const more=page.locator('#mobile-more');await more.focus();await page.keyboard.press('Enter');const sheet=page.locator('.mobile-more-sheet');await sheet.waitFor();const sb=await sheet.boundingBox();assert.ok(sb.x>=safe.left-1&&sb.x+sb.width<=width-safe.right+1&&sb.y+sb.height<=900-safe.bottom+1);await page.keyboard.press('Escape');await sheet.waitFor({state:'detached'});assert.equal(await more.evaluate(e=>e===document.activeElement),true);
  }else{
   assert.equal(await sidebar.evaluate(e=>e.inert),false);assert.equal(await sidebar.getAttribute('role'),null);const box=await sidebar.boundingBox();assert.equal(Math.round(box.width),width<=1024?236:264);assert.equal(await page.locator('.mobile-bottom-nav').isVisible(),false);
  }
  const sidePadding=await paddings(sidebar);for(const side of Object.keys(safe))assert.ok(sidePadding[side]>=safe[side]);
  assert.equal(await page.locator('.sidebar [data-view="user-guide"]').getAttribute('aria-current'),'page');
  await page.evaluate(()=>{const button=document.createElement('button');button.id='safe-profile-open';button.textContent='Review member profile';button.onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('safe-person',true,()=>{}));document.querySelector('#view-root').append(button);});
  const open=page.locator('#safe-profile-open');await open.focus();await page.keyboard.press('Enter');const dialog=page.locator('dialog.member-workspace');await dialog.locator('[data-edit]').waitFor();
  if(width<=700){for(const selector of ['.mw-header','.mw-content','.mw-footer','.mw-rail']){const p=await paddings(dialog.locator(selector));assert.ok(p.left>=safe.left&&p.right>=safe.right,selector+' side clearance');}assert.ok((await paddings(dialog.locator('.mw-header'))).top>=safe.top);assert.ok((await paddings(dialog.locator('.mw-footer'))).bottom>=safe.bottom);}
  await dialog.locator('[data-edit]').click();const name=dialog.locator('[data-field=canonical_name]');await name.fill('Unsaved safe area draft');
  await page.setViewportSize({width,height:500});assert.equal(await name.inputValue(),'Unsaved safe area draft');await dialog.locator('[data-tab=overview]').click();await dialog.locator('[data-tab=details]').click();assert.equal(await name.inputValue(),'Unsaved safe area draft');
  const close=dialog.getByRole('button',{name:'Close member profile',exact:true});await close.scrollIntoViewIfNeeded();const cb=await close.boundingBox();assert.ok(cb.x>=safe.left-1&&cb.x+cb.width<=width-safe.right+1&&cb.y>=0&&cb.y+cb.height<=500);
  for(const button of await dialog.locator('.mw-footer button').all()){const box=await button.boundingBox();if(box)assert.ok(box.x>=safe.left-1&&box.x+box.width<=width-safe.right+1&&box.y+box.height<=500-safe.bottom+1,'Footer controls clear synthetic viewport edges');}
  await close.click();await dialog.waitFor({state:'detached'});assert.equal(await open.evaluate(e=>e===document.activeElement),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  results.push({engine,width,syntheticInsets:synthetic?safe:null,shellState:mobile?'mobile drawer':width<=1024?'compact desktop':'expanded desktop',drawerAndMoreKeyboardReturn:true,navTargets44:mobile,nativeProfileSafePadding:width<=700,draftSurvivesViewportHeightAndTabs:true,noWrites:true,errors});await page.waitForLoadState('networkidle');await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-shell-safe-area.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,scope:'Actual shell desktop/mobile states, drawer/More keyboard, native member draft and reduced emulated viewport height. Zero/custom-property synthetic insets exercise CSS paths; not actual device env()/notch/keyboard/rotation certification. Three engines five widths; GET-only disposable companion shell.',results},null,2)+'\n');console.log(`Shell safe-area contexts: ${results.length}`);
