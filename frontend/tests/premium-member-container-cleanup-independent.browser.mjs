import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',results=[];
const names=['member-workspace.ts','styles.css','premium-theme.css'];const hashes=async()=>Object.fromEntries(await Promise.all(names.map(async n=>[n,createHash('sha256').update(await readFile('src/'+n)).digest('hex')])));const before=await hashes();
for(const[engine,type]of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch({headless:true});
 try{const page=await browser.newPage({viewport:{width:1280,height:720},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const Native=ResizeObserver;window.__sizes=[];window.ResizeObserver=class{constructor(callback){this.callback=callback;this.native=new Native(callback);window.__sizes.push(this);this.observed=[];this.disconnected=0;}observe(el){this.observed.push(el);this.native.observe(el);}unobserve(el){this.native.unobserve(el);}disconnect(){this.disconnected++;this.native.disconnect();}};});
 await page.route('**/__member_cleanup',r=>r.fulfill({contentType:'text/html',body:'<html><head><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button>Outside focus</button></body></html>'}));
 await page.route('**/api/**',r=>{assert.equal(r.request().method(),'GET');const path=new URL(r.request().url()).pathname;if(path.endsWith('/admin/member-workspace/example'))return r.fulfill({json:{member:{id:'example',canonical_name:'Dr Cleanup Member',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],revision:'one'},impact:{}}});return r.fulfill({json:{rows:[]}});});
 await page.goto(base+'/__member_cleanup');await page.evaluate(async()=>{const m=await import('/src/member-workspace.ts');await m.openMemberWorkspace('example',true,()=>{},[],'details');});
 const dialog=page.getByRole('dialog',{name:'Member profile',exact:true});await dialog.locator('[data-field="canonical_name"]').waitFor();await dialog.evaluate(el=>{el.style.width='360px';el.style.maxWidth='360px';});await page.waitForTimeout(100);
 const fieldWidth=await dialog.locator('[data-field="canonical_name"]').evaluate(el=>el.getBoundingClientRect().width);assert.ok(fieldWidth>=250,`Constrained field readability ${fieldWidth}`);
 const initial=await page.evaluate(()=>{const el=document.querySelector('dialog'),entry=window.__sizes.find(s=>s.observed.includes(el));window.__removedDialog=el;window.__entry=entry;return{observed:!!entry,orientation:el.querySelector('[role=tablist]').getAttribute('aria-orientation')};});assert.equal(initial.observed,true);assert.equal(initial.orientation,'horizontal');
 await dialog.evaluate(el=>el.remove());await page.waitForTimeout(50);assert.ok(await page.evaluate(()=>window.__entry.disconnected>0),'Direct body removal disconnects the actual ResizeObserver');
 await page.getByRole('button',{name:'Outside focus',exact:true}).focus();
 const beforeLate=await page.evaluate(()=>({style:window.__removedDialog.getAttribute('style'),orientation:window.__removedDialog.querySelector('[role=tablist]').getAttribute('aria-orientation')}));
 await page.evaluate(()=>{window.__entry.callback([],window.__entry.native);dispatchEvent(new Event('resize'));});
 const afterLate=await page.evaluate(()=>({style:window.__removedDialog.getAttribute('style'),orientation:window.__removedDialog.querySelector('[role=tablist]').getAttribute('aria-orientation')}));assert.deepEqual(afterLate,beforeLate);assert.equal(await page.getByRole('button',{name:'Outside focus',exact:true}).evaluate(el=>el===document.activeElement),true);assert.deepEqual(errors,[]);
 results.push({engine,constrainedFieldWidth:fieldWidth,nativeObserverWasAttached:true,directRemovalDisconnected:true,lateDetachedObserverCallbackIgnored:true,outsideFocusPreserved:true});
 }finally{await browser.close();}
}
const after=await hashes();assert.deepEqual(after,before);await writeFile('../docs/premium-ui/qa-member-container-cleanup-independent.json',JSON.stringify({createdAt:new Date().toISOString(),sources:after,scope:'Production UI/CSS; wrapped native ResizeObserver records actual observe/disconnect and explicitly invokes a late callback after removal. GET-only mocked member read; three engines. Not physical-device or every editor lifecycle certification.',results},null,2)+'\n');console.log('Independent member container cleanup: three engine workflows passed');
