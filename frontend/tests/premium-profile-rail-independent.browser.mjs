import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true}),results=[];
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
try{for(const width of [844,1280]){
 const context=await browser.newContext({viewport:{width,height:390}}),page=await context.newPage();let writes=0;
 await page.route('**/__independent_profile_rail',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Profile rail</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open</button></body></html>'}));
 await page.route('**/api/v1/**',route=>{if(route.request().method()!=='GET')writes++;const path=new URL(route.request().url()).pathname;return route.fulfill({json:path.endsWith('/member-workspace/example')?{member:{id:'example',canonical_name:'Dr Independent Example',active_status:'active',call_level:'2ND_CALL',revision:'v1',aliases:[],designations:[]},impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}:{rows:[]}});});
 await page.goto(base+'/__independent_profile_rail');
 await page.evaluate(async()=>{const {openMemberWorkspace}=await import('/src/member-workspace.ts');await openMemberWorkspace('example',true,()=>{},['example'],'activity');});
 const rail=page.getByRole('tablist',{name:'Member sections'}),tabs=rail.getByRole('tab');
 async function orientation(){await page.waitForFunction(()=>{const rail=document.querySelector('dialog [role=tablist]');return rail&&rail.getAttribute('aria-orientation')===(getComputedStyle(rail).flexDirection==='column'?'vertical':'horizontal');});return rail.getAttribute('aria-orientation');}
 async function revealed(tab){await orientation();const rects=await tab.evaluate(el=>{const rail=el.parentElement,a=el.getBoundingClientRect(),b=rail.getBoundingClientRect();return {selected:{top:a.top,bottom:a.bottom,left:a.left,right:a.right},rail:{top:b.top,bottom:b.bottom,left:b.left,right:b.right},orientation:rail.getAttribute('aria-orientation'),scrollTop:rail.scrollTop,offsetTop:el.offsetTop,offsetParent:el.offsetParent?.tagName};});assert.ok(rects.orientation==='vertical'?rects.selected.top>=rects.rail.top-1&&rects.selected.bottom<=rects.rail.bottom+1:rects.selected.left>=rects.rail.left-1&&rects.selected.right<=rects.rail.right+1,JSON.stringify(rects));}
 await revealed(tabs.last());await tabs.last().focus();await page.keyboard.press('Home');await revealed(tabs.first());
 await page.keyboard.press('End');await revealed(tabs.last());
 await page.setViewportSize({width:320,height:570});await page.waitForTimeout(150);await revealed(tabs.last());
 assert.equal(await orientation(),'horizontal');await page.keyboard.press('Home');await revealed(tabs.first());
 await page.setViewportSize({width,height:390});await page.waitForTimeout(150);await revealed(tabs.first());assert.equal(await orientation(),await rail.evaluate(el=>getComputedStyle(el).flexDirection==='column'?'vertical':'horizontal'));
 assert.equal(writes,0);results.push({width,height:390,initial_last_tab_revealed:true,end_home_reveal:true,bidirectional_resize:true,writes:0});await context.close();
}}finally{await browser.close();}
const sourceHashes=Object.fromEntries(await Promise.all(['src/member-workspace.ts','src/premium-theme.css'].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile('../docs/premium-ui/qa-profile-rail-independent.json',JSON.stringify({checked_at:new Date().toISOString(),sourceHashes,results,scope:'Independent Chromium actual member workspace in isolated GET-only fixture, short desktop/landscape and320px resize. Covers rail geometry only; no mutation or account behavior.'},null,2)+'\n');
console.log('Independent profile rail:2 short desktop/mobile resize workflows passed');
