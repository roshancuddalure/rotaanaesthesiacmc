import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {webkit} from 'playwright';
const base='http://127.0.0.1:5197',api='http://127.0.0.1:8031';
const paths=['frontend/src/main.ts','frontend/src/premium-theme.css','frontend/src/styles.css','frontend/tests/premium-close-menu-inputs-diagnostic.browser.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile('../'+p)).digest('hex')])));
const initial=await hashes(),results=[],browser=await webkit.launch();
try{for(const action of ['close-tap','overlay-click','escape']){
 const context=await browser.newContext({viewport:{width:320,height:568},hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage();
 const errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','close-menu-focus-diagnostic');localStorage.setItem('duty_rota_working_month','2026-11');});
 await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push({path:u.pathname,method:q.method()});return route.abort();}return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});});
 await page.goto(base+'/#view=leave');await page.locator('[data-leave-day]').first().waitFor();await page.waitForLoadState('networkidle');await page.addStyleTag({content:':root{font-size:200%}'});
 const open=page.locator('#sidebar-toggle');await open.focus();await page.keyboard.press('Enter');await page.locator('#sidebar-close').waitFor({state:'visible'});
 if(action==='escape')await page.locator('.sidebar .nav [data-view]').first().focus();else await page.locator('#sidebar-close').focus();
 await page.evaluate(()=>{window.menuDiagnostic=[];const snap=label=>{const n=document.activeElement,s=document.querySelector('.sidebar');window.menuDiagnostic.push({label,activeTag:n?.tagName,activeId:n?.id,activeName:n?.getAttribute('aria-label'),activeInsideSidebar:s.contains(n),sidebarInert:s.inert,sidebarOpen:s.classList.contains('open')});};window.menuDiagnosticSnap=snap;snap('before');for(const name of ['pointerdown','mousedown','click','keydown','focusin','focusout'])document.addEventListener(name,e=>snap(name+':'+e.target.tagName+(e.key?':'+e.key:'')),true);new MutationObserver(()=>snap('mutation')).observe(document.querySelector('.sidebar'),{attributes:true});});
 if(action==='close-tap')await page.locator('#sidebar-close').tap();
 else if(action==='overlay-click'){assert.equal(await page.evaluate(()=>document.elementFromPoint(310,300)?.id),'sidebar-overlay');await page.mouse.click(310,300);}
 else await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!document.querySelector('.sidebar').classList.contains('open'));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const trace=await page.evaluate(()=>{window.menuDiagnosticSnap('after-two-frames');return window.menuDiagnostic;});
 const outcome=await page.evaluate(()=>({activeTag:document.activeElement?.tagName,activeId:document.activeElement?.id,sidebarInert:document.querySelector('.sidebar').inert,expanded:document.querySelector('#sidebar-toggle').getAttribute('aria-expanded')}));
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 results.push({action,trace,outcome,restoredToggle:outcome.activeId==='sidebar-toggle',errors,writes});console.log(JSON.stringify({action,...outcome}));await context.close();
}}finally{await browser.close();}
assert.deepEqual(await hashes(),initial);
await writeFile('../tmp/close37-webkit-menu-inputs-diagnostic.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Bounded actual WebKit menu close inputs diagnostic; records real native outcomes without weakening expected final tests or changing application. All API GETs loopback disposable RAM.',source_sha256:initial,results},null,2)+'\n');
