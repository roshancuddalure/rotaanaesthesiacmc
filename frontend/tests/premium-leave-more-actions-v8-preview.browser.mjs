import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Actual shell; all non-GET requests are refused except the locally answered,
// nonmutating monthly review preview. Never reset or write the shared RAM fixture.
const base=process.env.LEAVE_TOOLBAR_BASE||'http://127.0.0.1:5197',api='http://127.0.0.1:8031';
assert.ok(['http://127.0.0.1:5197','http://127.0.0.1:5201','http://127.0.0.1:5205','http://127.0.0.1:5206'].includes(base));
const candidateDir=process.env.LEAVE_TOOLBAR_CANDIDATE_DIR;
const engines=(process.env.LEAVE_TOOLBAR_ENGINES||'chromium,firefox,webkit').split(',');
const stress=process.env.LEAVE_TOOLBAR_STRESS==='1';
const layouts=stress?[{width:320,height:568,root:200},{width:390,height:320,root:100}]:[{width:320,height:900,root:100},{width:1280,height:900,root:100}];
const paths=['src/main.ts','src/premium-theme.css','src/styles.css','src/leave-approval.ts','src/record-workspace.ts','src/operational-import.ts','src/member-workspace.ts','src/ui.ts','src/services/api.ts'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))])));
const candidateHashes=async()=>candidateDir?Object.fromEntries(await Promise.all(['main.ts','premium-theme.css','leave-calendar-focus.ts'].map(async p=>[p,sha(await readFile(candidateDir+'/'+p))]))):null;
const initial=await hashes(),candidateInitial=await candidateHashes(),testHash=sha(await readFile(new URL(import.meta.url))),results=[];
const month='2026-05',first=month+'-01',last=month+'-31';
function fixture(pending){
 const requests=Array.from({length:pending+1},(_,i)=>({id:`toolbar-leave-${i}`,person:{id:`toolbar-person-${i}`,canonical_name:`Toolbar Member ${i}`,call_level:'1ST_CALL',active:true},leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',starts_on:first,ends_on:first,status:i===0?'approved':i%2?'requested':'imported_pending_review',source:'manual',raw_person_name:null,notes:null,days:1}));
 const entries=requests.map(r=>({leave_id:r.id,person_id:r.person.id,person_name:r.person.canonical_name,leave_type:r.leave_type,leave_slot:r.leave_slot,status:r.status,unit:'Main Unit',posting_type:null,call_level:'1ST_CALL'}));
 const summary={month,starts_on:first,ends_on:last,total_requests:requests.length,blocking_requests:1,people_on_leave:requests.length,total_leave_days:requests.length,busiest_day:{date:first,count:requests.length},status_counts:{approved:1,requested:Math.ceil(pending/2),imported_pending_review:Math.floor(pending/2)},type_counts:{ANNUAL_LEAVE:requests.length},slot_counts:{FULL_DAY:requests.length},unit_counts:{'Main Unit':requests.length},call_level_counts:{'1ST_CALL':requests.length}};
 return {requests,calendar:{month,summary,days:{[first]:entries}},pressure:{month,starts_on:first,ends_on:last,unit_totals:summary.unit_counts,call_level_totals:summary.call_level_counts,blockers:[],days:[{date:first,total_people:entries.length,blocking_people:1,unit_counts:summary.unit_counts,call_level_counts:summary.call_level_counts,entries}]},review:{month,pending_count:pending,review_token:'local-toolbar-preview-only',requests:requests.slice(1).map(r=>({id:r.id,person_name:r.person.canonical_name,starts_on:r.starts_on,ends_on:r.ends_on,status:r.status})),affected_duties:[]}};
}
async function activate(page,locator){await locator.focus();await page.keyboard.press('Enter');}
async function geometry(locator,width){
 await locator.scrollIntoViewIfNeeded();
 const info=await locator.evaluate(el=>{const b=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);const ink=[...range.getClientRects()].filter(r=>r.width&&r.height).map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom}));const c=getComputedStyle(el);return {label:el.textContent.trim(),left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height,ink,whiteSpace:c.whiteSpace,overflow:c.overflow,font:c.fontSize};});
 assert.ok(info.width>=44&&info.height>=44,JSON.stringify(info));
 assert.ok(info.left>=-1&&info.right<=width+1,JSON.stringify(info));
 for(const ink of info.ink)assert.ok(ink.left>=info.left-1&&ink.right<=info.right+1&&ink.top>=info.top-1&&ink.bottom<=info.bottom+1,'Whole control label inside target: '+JSON.stringify(info));
 return info;
}

let failure,diagnostic;
const findings=[];
const describeActive=page=>page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id,text:document.activeElement.textContent?.trim().slice(0,100),insideClosedDetails:!!document.activeElement.closest('details:not([open])')}));
async function childGeometry(locator,width){return locator.evaluate((el,width)=>{const b=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);return{label:el.textContent.trim(),left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height,font:getComputedStyle(el).fontSize,ink:[...range.getClientRects()].filter(r=>r.width&&r.height).map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})),viewport:width};},width);}
try{for(const engine of engines){const browser=await({chromium,firefox,webkit}[engine]).launch();try{for(const layout of layouts){
 diagnostic={engine,...layout};const context=await browser.newContext({viewport:{width:layout.width,height:layout.height},reducedMotion:'reduce',colorScheme:layout.width===320?'dark':'light'}),page=await context.newPage(),data=fixture(2),calls=[],errors=[],rejected=[];const outcomes=[];
 try{page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{throw new Error('Unexpected confirmation in pristine close supplement: '+d.message());});
 await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','leave-more-outcomes');localStorage.setItem('duty_rota_working_month','2026-05');});
 await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url()),call={method:q.method(),path:u.pathname};calls.push(call);
  if(q.method()!=='GET'){
   if(q.method()==='POST'&&u.pathname==='/api/v1/admin/delete/preview'){call.body=q.postDataJSON();assert.deepEqual(call.body,{kind:'leave',month});return route.fulfill({json:{kind:'leave',count:data.requests.length,items:data.requests.map(r=>({id:r.id,label:`${r.person.canonical_name}: Annual leave ${r.starts_on} - ${r.ends_on}`})),blocked:[],effects:{},preview_token:'local-no-delete-token',confirm_phrase:'DELETE LEAVE '+month}});}
   rejected.push(call);return route.abort('blockedbyclient');
  }
  if(u.pathname==='/api/v1/leave/requests')return route.fulfill({json:data.requests});if(u.pathname==='/api/v1/leave/calendar')return route.fulfill({json:data.calendar});if(u.pathname==='/api/v1/leave/pressure')return route.fulfill({json:data.pressure});const response=await route.fetch({url:api+u.pathname+u.search});if(u.pathname==='/api/v1/auth/me'){const user=await response.json();return route.fulfill({json:{...user,role:'computer_admin',role_label:'Computer admin'}});}return route.fulfill({response});
 });
 await page.goto(base+'/#view=leave');const toolbar=page.getByRole('region',{name:'Leave actions',exact:true});await toolbar.waitFor();await page.waitForLoadState('networkidle');if(layout.root!==100)await page.addStyleTag({content:`html{font-size:${layout.root}% !important;}`});
 const details=toolbar.locator('details'),more=details.locator(':scope > summary'),catalog=details.locator('[data-manage-reference-catalog]'),deletion=details.locator('[data-delete-month="leave"]');
 async function openMore(){if(await details.getAttribute('open')===null)await activate(page,more);assert.equal(await details.getAttribute('open'),'');}
 await openMore();const children=details.locator('[role=menuitem]'),menuGeometry=[];assert.equal(await children.count(),4);
 for(let i=0;i<4;i++){const g=await childGeometry(children.nth(i),layout.width);menuGeometry.push(g);if(g.height<44)findings.push({...diagnostic,kind:'menu-target-under44',geometry:g});if(g.left < -1||g.right>layout.width+1)findings.push({...diagnostic,kind:'menu-target-outside-horizontal-viewport',geometry:g});if(!g.ink.every(r=>r.left>=g.left-1&&r.right<=g.right+1&&r.top>=g.top-1&&r.bottom<=g.bottom+1))findings.push({...diagnostic,kind:'menu-label-outside-target',geometry:g});}
 for(const action of ['catalog','delete'])for(const closeMode of ['cancel','escape','header']){
  await openMore();const opener=action==='catalog'?catalog:deletion;await opener.focus();await page.keyboard.press('Enter');
  const dialog=action==='catalog'?page.getByRole('dialog',{name:'Reference labels and mappings',exact:true}):page.getByRole('dialog',{name:'Delete all leave for May 2026',exact:true});await dialog.waitFor();
  if(action==='catalog'){await dialog.locator('[name=key]').waitFor();assert.equal(await dialog.locator('[data-kind]').inputValue(),'leave_type');assert.ok(calls.some(c=>c.method==='GET'&&c.path==='/api/v1/normalization/catalog/leave_type'),'Catalog button actually reads existing registry');}
  else{await dialog.locator('.admin-delete__count').waitFor();assert.match(await dialog.innerText(),/3 leave records will be deleted/);assert.equal(await dialog.locator('[data-phrase]').inputValue(),'');assert.equal(await dialog.locator('[data-delete]').isDisabled(),true);assert.equal(await dialog.locator('.admin-delete__items li').count(),3);for(const r of data.requests)assert.ok((await dialog.innerText()).includes(r.person.canonical_name));}
  const beforeClose=calls.length;if(closeMode==='escape')await page.keyboard.press('Escape');else if(closeMode==='cancel')await activate(page,dialog.getByRole('button',{name:'Cancel',exact:true}));else await activate(page,dialog.locator('.mw-header [data-close]'));
  await dialog.waitFor({state:'detached'});await page.waitForTimeout(80);const active=await describeActive(page),openerVisible=await opener.isVisible(),exact=await opener.evaluate(e=>e===document.activeElement);
  assert.equal(await more.evaluate(e=>e===document.activeElement),true,'Visible More summary regains focus after secondary dialog closes');
  assert.equal(await details.getAttribute('open'),null,'Secondary menu remains closed after dialog return');
  assert.equal(calls.length,beforeClose,'Pristine close performs no requests');outcomes.push({action,closeMode,actualControllerOpened:true,openerVisible,exactOpenerReturn:exact,visibleMoreSummaryReturn:true,afterClose:active,noCloseRequests:true});
 }
 assert.deepEqual(findings,[],'All secondary controls meet44px/full-label/viewport requirements');assert.deepEqual(errors,[]);assert.deepEqual(rejected,[]);assert.equal(calls.filter(c=>c.path==='/api/v1/admin/delete/preview').length,3);assert.equal(calls.filter(c=>c.method!=='GET').length,3,'Only three locally answered nonmutating delete previews; no save/delete/approval request');results.push({...diagnostic,menuGeometry,outcomes,calls,errors,rejected,documentWidth:await page.evaluate(()=>document.documentElement.scrollWidth),viewport:layout.width});console.log('More supplement '+engine+' '+layout.width+' root'+layout.root);
 }finally{await context.close();}
}}finally{await browser.close();}}}catch(e){failure=e;}
assert.deepEqual(await hashes(),initial);assert.deepEqual(await candidateHashes(),candidateInitial);assert.equal(sha(await readFile(new URL(import.meta.url))),testHash);
await writeFile(`../docs/premium-ui/qa-leave-more-actions-v8-preview${stress?'-stress':''}.json`,JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,candidate_sha256:candidateInitial,test_sha256:testHash,scope:'Actual shell More native activation of reference catalog and month-delete preview; eachCancel/Escape/headerclose. Admin role GETs onlyloopback8031, deletepreviewPOSTlocallyfulfilled; actualdelete/save/allothermutationsrejected. Geometry/focusfindingsreportedhonestly; noacceptedbackenddelete/persistence/authorization orphysical/nativeATclaim.',passed:!failure,results,findings,failure:failure?{diagnostic,message:failure.message,stack:failure.stack}:null},null,2)+'\n');if(failure)throw failure;console.log('More actions: '+results.length+' contexts completed; '+findings.length+' geometry/focus findings');
