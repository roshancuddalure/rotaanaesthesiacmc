// Actual Chromium tab zoom, independently verified by extension API, CSS viewport and DPR.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const base='http://127.0.0.1:5198',api='http://127.0.0.1:8033';
const quick=process.env.ZOOM_PROBE==='1';
const out=resolve('../docs/premium-ui/'+(quick?'qa-browser-zoom-before':'qa-browser-zoom-current'));
const sha=value=>createHash('sha256').update(value).digest('hex');
async function hashes(folder){const values={};for(const entry of await readdir(folder,{withFileTypes:true})){const path=join(folder,entry.name);if(entry.isDirectory())Object.assign(values,await hashes(path));else values[relative(resolve('..'),path).replaceAll('\\','/')]=sha(await readFile(path));}return values;}
const sources={...await hashes(resolve('src')),...await hashes(resolve('public')),...await hashes(resolve('dist'))};
const extension=resolve('tests/fixtures/browser-zoom-extension'),extensionHashes=await hashes(extension);
const profile=await mkdtemp(join(tmpdir(),'rota-browser-zoom-'));
assert.ok(!relative(tmpdir(),profile).startsWith('..')&&profile.includes('rota-browser-zoom-'));
await mkdir(out,{recursive:true});
let context;
const results=[],requests=[],errors=[];
try{
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:900},reducedMotion:'reduce',args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 for(const page of context.pages())await page.close();
 await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','actual-browser-zoom');localStorage.setItem('duty_rota_working_month','2026-05');});
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());requests.push({method:request.method(),path:url.pathname});
  assert.equal(request.method(),'GET','Zoom tasks must not submit mutations');
  await route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
 let discard=false;page.on('dialog',dialog=>discard?dialog.accept():dialog.dismiss());
 await page.goto(base);await page.locator('#view-root').waitFor();await page.waitForLoadState('networkidle');
 const baseline=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));
 const navigate=async view=>{
  const width=await page.evaluate(()=>innerWidth);
  if(width<=768){if(['overview','leave','units','rota-template'].includes(view)){await page.locator(`.mobile-bottom-nav [data-view="${view}"]`).focus();await page.keyboard.press('Enter');}else{await page.locator('#mobile-more').focus();await page.keyboard.press('Enter');await page.locator(`[data-mobile-more-view="${view}"]`).focus();await page.keyboard.press('Enter');}}
  else{await page.locator(`.sidebar [data-view="${view}"]`).focus();await page.keyboard.press('Enter');}
  await page.waitForLoadState('networkidle');await page.waitForFunction(()=>!document.querySelector('#view-root [aria-busy=true],#view-root .skeleton'));
  assert.ok(await page.locator(`[data-view="${view}"].active`).count());
 };
 for(const scheme of quick?['light']:['light','dark'])for(const factor of quick?[4]:[1,2,4]){
  await page.emulateMedia({colorScheme:scheme});
  const actual=await worker.evaluate(async factor=>{const tabs=await chrome.tabs.query({url:'http://127.0.0.1:5198/*'});if(tabs.length!==1)throw Error('Expected exactly one disposable test tab');await chrome.tabs.setZoom(tabs[0].id,factor);return chrome.tabs.getZoom(tabs[0].id);},factor);
  await page.waitForFunction(expected=>Math.abs(innerWidth-expected)<=1,baseline.width/factor);
  const metrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,cssZoom:getComputedStyle(document.documentElement).zoom,visualScale:visualViewport.scale}));
  assert.ok(Math.abs(actual-factor)<.001);assert.ok(Math.abs(metrics.dpr-baseline.dpr*factor)<.001);assert.equal(metrics.cssZoom,'1');assert.equal(metrics.visualScale,1);
  for(const view of quick?['members']:['overview','members','leave','units','rota-template','rota-publish','limits']){
   await navigate(view);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${factor}/${view}: page reflow`);
   assert.ok((await page.locator('#view-root').innerText()).trim().length>20);
   await page.screenshot({path:join(out,`${scheme}-${factor}x-${view}.png`)});
   results.push({scheme,factor,actualZoom:actual,metrics,view,passed:true});
  }
  await navigate('members');
  const opener=page.getByRole('button',{name:'Safe Member',exact:true});await opener.focus();await page.keyboard.press('Enter');
  const dialog=page.locator('dialog.member-workspace');await dialog.getByRole('tab',{name:'Details',exact:true}).waitFor();
  await dialog.getByRole('tab',{name:'Details',exact:true}).focus();await page.keyboard.press('Enter');
  const edit=dialog.locator('[data-edit]');await edit.focus();await page.keyboard.press('Enter');
  const field=dialog.getByLabel('Member name',{exact:true});await field.fill('Safe Member unsaved zoom draft');
  await field.focus();await page.keyboard.press('End');await page.keyboard.type(' checked');
  await field.scrollIntoViewIfNeeded();
  const fieldHit=await field.evaluate(element=>{const r=element.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,visible:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,hit:document.elementFromPoint(x,y)===element,dialogScroll:element.closest('dialog').scrollTop};});
  assert.ok(fieldHit.visible&&fieldHit.hit,'Real browser-zoom edit field remains visible and unobscured');
  const geometry=await dialog.evaluate(element=>{const box=element.getBoundingClientRect(),body=element.querySelector('.mw-content').getBoundingClientRect();return {top:box.top,bottom:box.bottom,width:box.width,client:element.clientWidth,scroll:element.scrollWidth,bodyHeight:body.height};});
  results.push({scheme,factor,metrics,task:'Profile editor geometry',geometry});
  await page.screenshot({path:join(out,`${scheme}-${factor}x-profile-draft.png`)});
  assert.ok(geometry.top>=-1&&geometry.bottom<=metrics.height+1,'Zoomed dialog remains inside viewport');
  assert.ok(geometry.scroll<=geometry.client+1,'Zoomed dialog does not clip horizontal content');
  assert.ok(geometry.bodyHeight>=40,'Zoomed editor retains a usable scrolling content region');
  const save=dialog.getByRole('button',{name:'Save changes',exact:true});await save.focus();await save.scrollIntoViewIfNeeded();
  const saveHit=await save.evaluate(element=>{const r=element.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {visible:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,hit:document.elementFromPoint(x,y)===element};});
  assert.ok(saveHit.visible&&saveHit.hit,'Save remains reachable and unobscured without submitting');
  if(factor===4){const cdp=await context.newCDPSession(page);const capture=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:false,captureBeyondViewport:false});await writeFile(join(out,`${scheme}-${factor}x-profile-native-capture.png`),Buffer.from(capture.data,'base64'));await cdp.detach();}
  await dialog.getByRole('tab',{name:'Overview',exact:true}).focus();await page.keyboard.press('Enter');await dialog.getByRole('tab',{name:'Details',exact:true}).focus();await page.keyboard.press('Enter');
  assert.equal(await field.inputValue(),'Safe Member unsaved zoom draft checked');
  const close=dialog.locator('[data-close]').first();const refused=page.waitForEvent('dialog');await close.focus();await page.keyboard.press('Enter');await refused;
  assert.equal(await field.inputValue(),'Safe Member unsaved zoom draft checked');assert.equal(await dialog.count(),1);
  discard=true;await close.focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'detached'});discard=false;
  assert.equal(await opener.evaluate(element=>element===document.activeElement),true);
  results.push({scheme,factor,metrics,task:'Profile draft, tab roundtrip, refusal, explicit discard and opener focus',geometry,fieldHit,saveHit,passed:true});
 }
 assert.deepEqual(errors,[]);
}catch(error){results.push({passed:false,error:error.message});const page=context?.pages().find(page=>page.url().startsWith(base));await page?.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw error;}
finally{
 await context?.close();
 assert.deepEqual({...await hashes(resolve('src')),...await hashes(resolve('public')),...await hashes(resolve('dist'))},sources,'Source/build held');
 assert.deepEqual(await hashes(extension),extensionHashes,'Zoom extension held');
 await writeFile(join(out,'report.json'),JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Actual Chromium tab zoom via disposable extension in fresh profile. Verified getZoom, effective CSS viewport, DPR, CSSzoom1 and visualscale1. Production app with read-only synthetic API; core navigation and unsaved profile tasks only. Not Firefox/WebKit/nativeAT/physical devices or every workflow.',whole_requirement_completion_proven:false,source_sha256:sources,extension_sha256:extensionHashes,requests,errors,results},null,2)+'\n');
 await rm(profile,{recursive:true,force:true,maxRetries:3});
}
