import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Actual shell; all non-GET requests are refused except the locally answered,
// nonmutating monthly review preview. Never reset or write the shared RAM fixture.
const base=process.env.LEAVE_TOOLBAR_BASE||'http://127.0.0.1:5197',api='http://127.0.0.1:8031';
assert.ok(['http://127.0.0.1:5197','http://127.0.0.1:5201'].includes(base));
const candidateDir=process.env.LEAVE_TOOLBAR_CANDIDATE_DIR;
const engines=(process.env.LEAVE_TOOLBAR_ENGINES||'chromium,firefox,webkit').split(',');
const stress=process.env.LEAVE_TOOLBAR_STRESS==='1';
const layouts=stress?[{width:320,height:568,root:200},{width:390,height:320,root:100}]:[{width:320,height:900,root:100},{width:1280,height:900,root:100}];
const paths=['src/main.ts','src/premium-theme.css','src/styles.css','src/leave-approval.ts','src/record-workspace.ts','src/operational-import.ts','src/member-workspace.ts','src/ui.ts','src/services/api.ts'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))])));
const candidateHashes=async()=>candidateDir?Object.fromEntries(await Promise.all(['main.ts','premium-theme.css'].map(async p=>[p,sha(await readFile(candidateDir+'/'+p))]))):null;
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
try{
 for(const engine of engines){assert.ok(Object.hasOwn({chromium,firefox,webkit},engine));const browser=await({chromium,firefox,webkit}[engine]).launch();
  try{for(const layout of layouts)for(const role of ['computer_admin','board'])for(const pending of [0,123]){
   diagnostic={engine,...layout,role,pending};
   const context=await browser.newContext({viewport:{width:layout.width,height:layout.height},reducedMotion:'reduce',colorScheme:role==='board'?'dark':'light',acceptDownloads:true}),page=await context.newPage(),errors=[],unexpected=[],calls=[],data=fixture(pending);
   page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
   try{
    await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','leave-toolbar-hierarchy');localStorage.setItem('duty_rota_working_month','2026-05');});
    await page.route('**/api/**',async route=>{
     const q=route.request(),u=new URL(q.url()),call={method:q.method(),path:u.pathname};calls.push(call);
     if(q.method()!=='GET'){
      if(q.method()==='POST'&&u.pathname==='/api/v1/leave/approval-preview'){
       call.body=q.postDataJSON();assert.deepEqual(call.body,{month});return route.fulfill({json:data.review});
      }
      unexpected.push(call);return route.abort('blockedbyclient');
     }
     if(u.pathname==='/api/v1/leave/requests')return route.fulfill({json:data.requests});
     if(u.pathname==='/api/v1/leave/calendar')return route.fulfill({json:data.calendar});
     if(u.pathname==='/api/v1/leave/pressure')return route.fulfill({json:data.pressure});
     const response=await route.fetch({url:api+u.pathname+u.search});
     if(u.pathname==='/api/v1/auth/me'){const user=await response.json();return route.fulfill({json:{...user,role,role_label:role==='board'?'Board reviewer':'Computer admin',permissions:role==='board'?['view_workflow']:user.permissions}});}
     return route.fulfill({response});
    });
    await page.goto(base+'/#view=leave');
    const toolbar=page.getByRole('region',{name:'Leave actions',exact:true});await toolbar.waitFor();
    if(layout.root!==100)await page.addStyleTag({content:`html{font-size:${layout.root}% !important;}`});
    const actions=toolbar.locator('.page-toolbar__actions'),add=actions.getByRole('button',{name:'Add leave',exact:true}),csv=actions.getByRole('button',{name:'Import leave CSV',exact:true}),monthly=actions.locator('[data-approve-month-leave]'),more=actions.locator('summary[aria-label="More leave tools"]');
    // Use the actual native summary rather than imposing an ARIA button role.
    assert.equal(await add.getAttribute('class'),'primary');
    const order=await actions.evaluate(el=>[...el.children].map(n=>n.tagName==='DETAILS'?'More':n.textContent.trim()));
    assert.deepEqual(order,role==='computer_admin'?['Add leave','Import leave CSV',`Approve all pending (${pending})`,'More']:['Add leave','Import leave CSV','More']);
    assert.equal(await monthly.count(),role==='computer_admin'?1:0);
    if(role==='computer_admin'){assert.equal(await monthly.innerText(),`Approve all pending (${pending})`);assert.equal(await monthly.isDisabled(),pending===0);}
    const controls=[];for(const target of [add,csv,...(role==='computer_admin'?[monthly]:[]),more])controls.push(await geometry(target,layout.width));
    await activate(page,add);const editor=page.locator('dialog.record-workspace');await editor.locator('[name=notes]').waitFor();assert.equal(await editor.getByRole('heading',{name:'Add leave',exact:true}).count(),1);
    await editor.getByRole('button',{name:'Close editor',exact:true}).click();await editor.waitFor({state:'detached'});assert.equal(await add.evaluate(e=>e===document.activeElement),true);
    await activate(page,csv);const importer=page.locator('dialog').filter({has:page.locator('input[type=file]')});await importer.waitFor();assert.equal(await importer.locator('[name=month]').inputValue(),month);
    await importer.getByRole('button',{name:'Close import review',exact:true}).click();await importer.waitFor({state:'detached'});assert.equal(await csv.evaluate(e=>e===document.activeElement),true);
    await activate(page,more);assert.equal(await actions.locator('details').getAttribute('open'),'');
    assert.equal(await actions.locator('[data-manage-reference-catalog]').count(),role==='computer_admin'?1:0);assert.equal(await actions.locator('[data-delete-month="leave"]').count(),role==='computer_admin'?1:0);
    const menu=actions.locator('.row-menu__list');assert.equal(await menu.isVisible(),true);
    for(const file of ['leave-records.csv','leave-records-example.csv']){
     if(await actions.locator('details').getAttribute('open')===null)await activate(page,more);
     const link=menu.locator(`a[href="/templates/${file}"]`);assert.equal(await link.isVisible(),true);assert.equal(await link.getAttribute('download'),'');
     const response=await context.request.get(base+'/templates/'+file);assert.equal(response.status(),200);const columns=(await response.text()).split(/\r?\n/)[0].split(',');for(const col of ['member_name','starts_on','ends_on'])assert.ok(columns.includes(col));
     const downloadPromise=page.waitForEvent('download');await link.click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),file);assert.equal(await download.failure(),null);
    }
    if(await actions.locator('details').getAttribute('open')===null)await activate(page,more);
    await activate(page,more);assert.equal(await actions.locator('details').getAttribute('open'),null);
    if(role==='computer_admin'&&pending){
     await activate(page,monthly);const review=page.getByRole('dialog',{name:'Approve monthly leave',exact:true});await review.locator('[data-confirm]').waitFor();
     assert.equal(await review.locator('tbody tr').count(),pending);assert.match(await review.getByRole('status').innerText(),/^123 pending requests to approve\./);assert.equal(await review.locator('[data-approve]').isDisabled(),true);
     await review.locator('[data-confirm]').check();assert.equal(await review.locator('[data-approve]').isEnabled(),true);
     // Explicitly refuse applying by closing; no approve endpoint is ever answered.
     await review.locator('[data-close]').click();await review.waitFor({state:'detached'});assert.equal(await monthly.evaluate(e=>e===document.activeElement),true);
    }
    assert.equal(calls.filter(c=>c.method!=='GET').length,role==='computer_admin'&&pending?1:0);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
    await toolbar.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Document contains responsive toolbar');
    results.push({...diagnostic,scheme:role==='board'?'dark':'light',primaryOrder:order,controls,addAndImportActualDialog:true,exactOpenerFocus:true,moreNativeKeyboardGrouping:true,bothActualDownloadsAndHeaders:true,monthlyPreviewLocallyAnswered:role==='computer_admin'&&pending>0,approvalRefusedWithoutApply:true,unexpectedMutations:unexpected,errors});
    console.log(`Leave toolbar hierarchy: ${engine} ${layout.width}x${layout.height} root${layout.root} ${role} pending${pending}`);
   }finally{await context.close();}
  }}finally{await browser.close();}
 }
}catch(e){failure=e;}
assert.deepEqual(await hashes(),initial);assert.deepEqual(await candidateHashes(),candidateInitial);
const out=process.env.LEAVE_TOOLBAR_REPORT||`../docs/premium-ui/qa-leave-toolbar-hierarchy${stress?'-stress':''}.json`;
await writeFile(out,JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,candidate_sha256:candidateInitial,test_sha256:testHash,base,scope:'Original141 actual-shell role/count/geometry/native Add+Import+More/download/monthly-preview-close. GET proxy only to disposable8031, sole POST preview answered locally; no mutation/persistence/authorization claim. Emulation only; physical/nativeAT pending.',passed:!failure,results,failure:failure?{context:diagnostic,message:failure.message,stack:failure.stack}:null},null,2)+'\n');
if(failure)throw failure;console.log(`Leave toolbar hierarchy: ${results.length} contexts passed`);
