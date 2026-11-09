import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Returned-data presentation only. All API requests are fulfilled locally and GET-only.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const paths=['frontend/src/member-presentation.ts','frontend/src/member-workspace.ts','frontend/src/styles.css','frontend/src/premium-theme.css','frontend/src/services/api.ts','frontend/src/ui.ts','frontend/src/workspace-load-state.ts'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,digest(await readFile('../'+path))])));
const initial=await hashes(),testSha=digest(await readFile(new URL(import.meta.url))),results=[];
const title='Consultant <img src=x onerror="window.__designationInjected=1"> '+('LongUnbrokenDesignation'.repeat(12));
const row=(designation,from='2025-01-01',to=null)=>({id:designation,designation,effective_from:from,effective_to:to,source:'manual',notes:'Returned position notes'});
const fixtures=[
 {key:'mixed',rows:[row('Past','2020-01-01','2026-10-23'),row('Current'),row('Future','2026-10-25')],current:['Current']},
 {key:'future-only',rows:[row('Future','2026-10-25')],current:[]},
 {key:'past-only',rows:[row('Past','2020-01-01','2026-10-23')],current:[]},
 {key:'no-records',rows:[],current:[]},
 {key:'invalid-intervals',rows:[row('Invalid','2026-02-30'),row('Reversed','2026-10-24','2026-10-23'),row('Missing','')],current:[]},
 {key:'overlap-returned-order',rows:[row('Second returned first','2026-01-01'),row('First returned second','2025-01-01')],current:['Second returned first','First returned second']},
 {key:'starts-today',rows:[row('Starts today','2026-10-24')],current:['Starts today']},
 {key:'ends-today',rows:[row('Ends today','2025-01-01','2026-10-24')],current:['Ends today']},
 {key:'blank-title',rows:[row('')],current:['Designation not recorded']},
 {key:'long-escaped',rows:[row(title)],current:[title],long:true},
];
async function activate(page,locator){await locator.focus();await page.keyboard.press('Enter');}
async function scrollToEdge(page,locator,end,label){
 await locator.focus();
 const before=await locator.evaluate(node=>({top:node.scrollTop,max:node.scrollHeight-node.clientHeight}));
 await page.keyboard.press(end?'ArrowDown':'ArrowUp');
 if(end?before.top<before.max-2:before.top>1){
  await locator.page().waitForFunction(({selector,end,top})=>{const node=document.querySelector(selector);return end?node.scrollTop>top:node.scrollTop<top;},{selector:await locator.evaluate(node=>node.matches('.mw-content')?'.mw-content':'[data-member-identity-region]'),end,top:before.top});
 }
 for(let attempt=0;attempt<100;attempt++){
  const atEdge=await locator.evaluate((node,end)=>end?node.scrollTop+node.clientHeight>=node.scrollHeight-2:node.scrollTop<=1,end);
  if(atEdge)return;
  await page.keyboard.press(end?'ArrowDown':'ArrowUp');await page.waitForTimeout(65);
 }
 assert.fail('Native arrows cannot reach '+(end?'end':'start')+' '+label+' '+JSON.stringify(await locator.evaluate(node=>({top:node.scrollTop,height:node.clientHeight,scroll:node.scrollHeight,focused:node===document.activeElement,overflow:getComputedStyle(node).overflowY,parentTop:node.parentElement.scrollTop,dialogTop:node.closest('dialog').scrollTop}))));
}

for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const config of [{width:320,height:480,scale:1},{width:1280,height:900,scale:1},{width:320,height:640,scale:2}]){
  const {width,height,scale}=config,context=await browser.newContext({viewport:{width,height},locale:'en-GB',timezoneId:'Asia/Kolkata',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],reads=[],cases=[];let current;
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000);
  await page.clock.setFixedTime(new Date('2026-10-24T06:30:00Z'));
  await page.route('**/__designation_header',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open profile</button></body></html>'}));
  await page.route('**/api/**',route=>{
   const request=route.request(),url=new URL(request.url());assert.equal(request.method(),'GET','Read-only identity never mutates');assert.equal(url.search,'');reads.push(url.pathname);
   assert.equal(url.pathname,'/api/v1/admin/member-workspace/'+current.id);
   return route.fulfill({json:{member:current,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
  });
  await page.goto(base+'/__designation_header');
  if(scale===2)await page.addStyleTag({content:'html { font-size:200% !important; }'});
  for(const fixture of fixtures)for(const admin of [true,false]){
   current={id:'designation-'+fixture.key,canonical_name:fixture.long?'Dr '+('LongUnbrokenIdentity'.repeat(14)):'Dr '+fixture.key,active_status:'active',call_level:'1ST_CALL',effective_call_level:'3RD_CALL',revision:'unchanged',aliases:[],designations:structuredClone(fixture.rows),call_level_changes:[]};
   const before=structuredClone(current);
   await page.evaluate(({id,admin})=>{document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace(id,admin,()=>{},[id],'overview'));},{id:current.id,admin});
   await activate(page,page.locator('#open'));
   const dialog=page.getByRole('dialog',{name:'Member profile',exact:true});
   await dialog.locator('[data-member-designation]').waitFor();
   const header=dialog.locator('[data-member-designation]'),summary=dialog.locator('[data-member-designation-summary]');
   const expected=fixture.current.length?fixture.current.join(' · '):'No designation recorded for this date';
   assert.equal(await header.innerText(),expected,fixture.key+' header');
   assert.equal(await summary.locator('strong').innerText(),expected,fixture.key+' overview agrees');
   const note=(fixture.key==='overlap-returned-order'?'Multiple recorded positions match this date. ':'')+(fixture.key==='invalid-intervals'?'Some designation dates are missing or invalid; review designation history. ':'')+'Based on recorded dates; compared with 24 Oct 2026 on this device.';
   assert.equal(await dialog.locator('[data-member-designation-context]').innerText(),note);
   assert.equal(await summary.locator('p').innerText(),note);
   assert.equal(await dialog.locator('[data-member-identity]').innerText(),current.canonical_name);
   assert.equal(await dialog.locator('[data-member-call-identity]').innerText(),'3rd Call','Returned effective level preserved');
   assert.match(await dialog.locator('.mw-header').innerText(),/Active/);
   assert.equal(await dialog.locator('img,script').count(),0);
   if(fixture.key==='mixed'&&scale===1){
    const visible=await dialog.evaluate(node=>{
     const region=node.querySelector('[data-member-identity-region]').getBoundingClientRect();
     return [...node.querySelectorAll('[data-member-identity],[data-member-designation],[data-member-call-identity],[data-member-active-status]')].map(item=>({selector:item.hasAttribute('data-member-call-identity')?'call':item.hasAttribute('data-member-designation')?'designation':item.hasAttribute('data-member-active-status')?'status':'name',top:item.getBoundingClientRect().top,bottom:item.getBoundingClientRect().bottom,regionTop:region.top,regionBottom:region.bottom}));
    });
    for(const item of visible)assert.ok(item.top>=item.regionTop-1&&item.bottom<=item.regionBottom+1,'Normal primary identity visible before secondary context: '+JSON.stringify(item));
   }
   const geometry=await dialog.evaluate(node=>{
    const identity=node.querySelector('[data-member-identity-region]'),close=node.querySelector('[data-close]'),content=node.querySelector('.mw-content'),header=node.querySelector('.mw-header');
    const a=identity.getBoundingClientRect(),b=close.getBoundingClientRect(),c=content.getBoundingClientRect();
    return {viewport:{width:innerWidth,height:innerHeight},dialog:node.getBoundingClientRect().toJSON(),identity:a.toJSON(),close:b.toJSON(),content:c.toJSON(),contentHeight:content.clientHeight,identityWidth:identity.clientWidth,identityScrollWidth:identity.scrollWidth,identityHeight:identity.clientHeight,identityScrollHeight:identity.scrollHeight,headerOverflow:header.scrollWidth>header.clientWidth+2,tabindex:identity.getAttribute('tabindex')};
   });
   assert.ok(geometry.dialog.width<=width+1);assert.equal(geometry.headerOverflow,false);
   assert.ok(geometry.identity.right<=geometry.close.left+1,'Full identity does not overlap Close');
   assert.ok(geometry.close.top>=-1&&geometry.close.bottom<=height+1,'Close remains visible');
   assert.ok(geometry.contentHeight>=80,fixture.key+' admin='+admin+' profile panel retains usable visible space: '+JSON.stringify(geometry));
   assert.ok(geometry.identityScrollWidth<=geometry.identityWidth+2,'Unbroken identity wraps');
   let nativeScroll=null;
   assert.equal(await dialog.locator('[data-member-identity-cue]').isVisible(),geometry.identityScrollHeight>geometry.identityHeight+1,'Visual instruction follows actual identity overflow');
   if(geometry.identityScrollHeight>geometry.identityHeight+1){
    const region=dialog.locator('[data-member-identity-region]');assert.equal(geometry.tabindex,'0','Clipped identity region is keyboard reachable');
    const description=await region.getAttribute('aria-description');assert.ok(description,'Overflow has discoverable instruction');
    await scrollToEdge(page,region,true,JSON.stringify({engine,...config,fixture:fixture.key,admin,area:'identity'}));
    nativeScroll=await region.evaluate(node=>({top:node.scrollTop,height:node.clientHeight,scroll:node.scrollHeight}));
    assert.ok(nativeScroll.top+nativeScroll.height>=nativeScroll.scroll-2,'Native keyboard reaches full identity end');
    await scrollToEdge(page,region,false,JSON.stringify({engine,...config,fixture:fixture.key,admin,area:'identity'}));
    await page.keyboard.press('Tab');
    assert.equal(await dialog.locator('[data-close]').evaluate(node=>node===document.activeElement),true,'Tab from identity region reaches Close');
   }
   const panel=dialog.locator('.mw-content');await scrollToEdge(page,panel,true,JSON.stringify({engine,...config,fixture:fixture.key,admin,area:'panel'}));
   const panelEnd=await panel.evaluate(node=>({top:node.scrollTop,height:node.clientHeight,scroll:node.scrollHeight}));
   assert.deepEqual(current,before,'Identity presentation preserves returned records and order');
   await activate(page,dialog.getByRole('button',{name:'Close member profile',exact:true}));await dialog.waitFor({state:'detached'});
   assert.equal(await page.locator('#open').evaluate(node=>node===document.activeElement),true);
   assert.equal(await page.evaluate(()=>window.__designationInjected||0),0);
   cases.push({fixture:fixture.key,admin,expected,note,geometry,nativeScroll,panelEnd,headerOverviewAgreement:true,returnedOrderPreserved:true,closeFocusRestored:true});
  }
  assert.deepEqual(errors,[]);results.push({engine,...config,clock:'2026-10-24T06:30:00Z',timezone:'Asia/Kolkata',cases,reads,pageErrors:errors});console.log('Passed '+engine+' '+JSON.stringify(config)+' '+cases.length+' workflows');await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Application sources held');assert.equal(digest(await readFile(new URL(import.meta.url))),testSha,'Test source held');
await writeFile('../docs/premium-ui/qa-profile-designation-header.json',JSON.stringify({checked_at:new Date().toISOString(),source_sha256:initial,test_sha256:testSha,scope:'Actual canonical profile, GET-only locally fulfilled fixtures.3 engines x320short/1280desktop/320roottext200%,10 histories xadmin/view-only=180 workflows within9 contexts. Fixed device date2026-10-24. No backend authorization, persistence, physical devices, native assistive technology, production bundle or scheduling correctness claim.',results},null,2)+'\n');
console.log('Profile designation header: '+results.length+' contexts / '+results.reduce((sum,row)=>sum+row.cases.length,0)+' GET-only workflows passed');
