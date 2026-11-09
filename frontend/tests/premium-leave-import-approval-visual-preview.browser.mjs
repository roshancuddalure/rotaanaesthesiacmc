import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const base=process.env.LEAVE_STATUS_BASE||'http://127.0.0.1:5208';
assert.ok(['http://127.0.0.1:5208','http://127.0.0.1:5197'].includes(base));
const candidatePath=process.env.LEAVE_IMPORT_CANDIDATE||'../tmp/leave-import-status-v2/operational-import.ts';
const sha=b=>createHash('sha256').update(b).digest('hex');
const paths=['src/operational-import.ts','src/member-workspace.ts','src/reference-workspace.ts','src/ui.ts','src/import-review-presentation.ts','src/services/api.ts','src/styles.css','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))])));
const initial=await hashes(),candidateSha=sha(await readFile(candidatePath)),testSha=sha(await readFile(new URL(import.meta.url)));
const stress=process.env.LEAVE_STATUS_STRESS==='1';
const layouts=stress?[{width:320,height:568,font:200},{width:390,height:320,font:100}]:[{width:320,height:900,font:100},{width:1280,height:900,font:100}];
const hostile='<img src=x onerror="window.leaveImportInjected=true"> '+ 'LONG_UNRECOGNIZED_STATUS'.repeat(12);
const cases=[
 {value:'approved',input:'APPROVAL_ALIAS',label:'Approved'},
 {value:'requested',input:'PENDING_ALIAS',label:'Requested'},
 {value:'imported_pending_review',input:'IMPORT_REVIEW_ALIAS',label:'Imported, Pending Review'},
 {value:'cancelled',input:'cancelled',label:'Cancelled'},
 {value:'rejected',input:'rejected',label:'Rejected'},
 {value:'constructor',input:'constructor',label:'constructor',defensive:true},
 {value:'__proto__',input:'__proto__',label:'__proto__',defensive:true},
 {value:'toString',input:'toString',label:'toString',defensive:true},
 {value:hostile,input:hostile,label:hostile,defensive:true},
 {omit:true,inputOmit:true,label:'Not returned',defensive:true},
 {value:null,input:null,label:'Not returned',defensive:true},
 {value:'',input:'',label:'Blank (no approval state)',defensive:true},
 {value:'  ',input:'  ',label:'Blank (whitespace)',defensive:true},
 {value:42,input:42,label:'Unsupported value',defensive:true},
 {value:{state:'approved'},input:{state:'approved'},label:'Unsupported value',defensive:true},
];
const known=new Map([['approved','Approved'],['requested','Requested'],['imported_pending_review','Imported, Pending Review'],['cancelled','Cancelled'],['rejected','Rejected']]);
const inputLabel=c=>c.inputOmit||c.input===null?'Not returned':typeof c.input!=='string'?'Unsupported value':c.input===''?'Blank (no approval state)':c.input.trim()===''?'Blank (whitespace)':known.get(c.input)??c.input;
const member={id:'approval-person',canonical_name:'Dr Approval Preview',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],revision:'one'};
const file={name:'approval-states.csv',mimeType:'text/csv',buffer:Buffer.from('Member,Start,End,Status\nDr Approval Preview,2026-05-01,2026-05-02,APPROVAL_ALIAS\n')};
const multipart=q=>new Request('http://fixture.invalid',{method:'POST',headers:{'content-type':q.headers()['content-type']},body:q.postDataBuffer()}).formData();
const activate=async(page,node)=>{await node.focus();await page.keyboard.press('Enter');};
const results=[];let diagnostic,failure;
try{for(const[engine,launcher]of Object.entries({chromium})){
 const browser=await launcher.launch();
 try{for(const layout of layouts.slice(0,1))for(const scheme of ['dark']){
  diagnostic={engine,...layout,scheme};
  const context=await browser.newContext({viewport:{width:layout.width,height:layout.height},colorScheme:scheme,reducedMotion:'reduce'}),page=await context.newPage();
  const errors=[],calls=[],previews=[],unexpected=[];let mode='normal',heldRoute,releaseHeld,arriveHeld,returnedCorrection='';
  const arrived=new Promise(resolve=>arriveHeld=resolve);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.route('**/__approval_states',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open leave import</button></body></html>'}));
  await page.route('**/api/**',async route=>{
   const q=route.request(),url=new URL(q.url());calls.push({method:q.method(),path:url.pathname});
   if(q.method()==='GET'){
    if(url.pathname.endsWith('/admin/members'))return route.fulfill({json:[member]});
    if(url.pathname.endsWith('/normalization/units'))return route.fulfill({json:[]});
   }
   if(q.method()==='POST'&&url.pathname==='/api/v1/import-review/columns')return route.fulfill({json:{headers:['Member','Start','End','Status'],fields:['member_name','starts_on','ends_on','status'],suggested:{Member:'member_name',Start:'starts_on',End:'ends_on',Status:'status'}}});
   if(q.method()==='POST'&&url.pathname.endsWith('/leave/preview')){
    const data=await multipart(q),settings=JSON.parse(data.get('settings_json'));assert.equal(data.get('file').name,file.name);assert.equal(data.get('month'),'2026-05');assert.equal(data.get('mode'),'append');
    assert.deepEqual(Object.keys(settings).sort(),['corrections','date_format','excluded','mapping','repeated']);previews.push(settings);
    if(mode==='held'){heldRoute=route;arriveHeld();await new Promise(resolve=>releaseHeld=resolve);return;}
    returnedCorrection=settings.corrections['CSV:0']?.status||'';
    const rows=Array.from({length:30},(_,i)=>{const c=cases[i%cases.length],values={member_name:member.canonical_name,starts_on:'2026-05-01',ends_on:'2026-05-02'},after={person_id:member.id,starts_on:'2026-05-01',ends_on:'2026-05-02',leave_slot:'FULL_DAY',leave_type:'ANNUAL_LEAVE'};
     if(!c.inputOmit)values.status=c.input;if(!c.omit)after.status=c.value;
     if(i===0&&returnedCorrection){values.status=returnedCorrection;after.status=returnedCorrection;}
     return{key:'CSV:'+i,source:{sheet:'CSV',row:i+2},original:{Member:member.canonical_name},values,after,action:c.defensive?'needs_review':'create',issues:c.defensive?['Defensive malformed approval-state fixture; review required']:[],warnings:[],normalizations:[],person_match:{state:'matched',status:'matched',person_id:member.id,canonical_name:member.canonical_name,method:'approved_alias',reason:'Fixture matched identity',candidates:[],warnings:[]}};});
    return route.fulfill({json:{id:'approval-preview-'+previews.length,kind:'leave',month:'2026-05',mode:'append',headers:['Member','Start','End','Status'],fields:['member_name','starts_on','ends_on','status'],rows,replacement_scope:[]}});
   }
   unexpected.push({method:q.method(),path:url.pathname});return route.abort('blockedbyclient');
  });
  try{
   diagnostic.calls=calls;diagnostic.unexpected=unexpected;diagnostic.errors=errors;
   await page.goto(base+'/__approval_states');if(layout.font!==100)await page.addStyleTag({content:`html{font-size:${layout.font}% !important;}`});
   await page.evaluate(()=>{document.querySelector('#open').onclick=()=>import('/src/operational-import.ts').then(m=>m.openOperationalImport('leave','2026-05',()=>{},true));});
   await activate(page,page.locator('#open'));const dialog=page.getByRole('dialog');await dialog.locator('input[type=file]').setInputFiles(file);await dialog.locator('[data-map]').first().waitFor({state:'attached'});
   await activate(page,dialog.getByRole('button',{name:'Preview and normalize',exact:true}));await dialog.locator('[data-review-row="CSV:0"] [data-leave-normalized-status]').waitFor();
   async function checkPage(offset,count){
    const rows=dialog.locator('[data-review-row]');assert.equal(await rows.count(),count);
    for(let n=0;n<count;n++){const i=offset+n,c=cases[i%cases.length],row=rows.nth(n);assert.equal(await row.getAttribute('data-review-row'),'CSV:'+i);
     assert.equal(await row.locator('[data-leave-normalized-status]').textContent(),i===0&&returnedCorrection?known.get(returnedCorrection):c.label);
     assert.equal(await row.locator('[data-leave-input-status]').textContent(),i===0&&returnedCorrection?known.get(returnedCorrection):inputLabel(c));
     const g=await row.locator('.import-row__leave-status').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,text:e.textContent,wrap:getComputedStyle(e).overflowWrap}));assert.ok(g.width>0&&g.scroll<=g.width+1,JSON.stringify(g));
    }assert.equal(await dialog.locator('[data-leave-approval-status] img').count(),0);
   }
   await checkPage(0,25);await dialog.locator('[data-review-row="CSV:0"] .import-row__leave-status').scrollIntoViewIfNeeded();await page.screenshot({path:'../tmp/leave-import-status-v2-first-row.png'});await dialog.locator('[data-review-row="CSV:8"] .import-row__leave-status').scrollIntoViewIfNeeded();await page.screenshot({path:'../tmp/leave-import-status-v2-unknown-row.png'});assert.equal(await dialog.locator('[data-leave-approval-authority]').filter({hasText:'not an import-save confirmation'}).count(),25);
   const reads=calls.length;await activate(page,dialog.locator('[data-page="1"]'));await checkPage(25,5);await activate(page,dialog.locator('[data-page="-1"]'));await checkPage(0,25);assert.equal(calls.length,reads,'Paging is local');
   const first=dialog.locator('[data-review-row="CSV:0"]');await activate(page,first.locator('summary'));const input=first.locator('[data-field=status]');await input.fill('rejected');await input.press('Tab');
   assert.equal(await input.inputValue(),'rejected');assert.equal(await first.locator('[data-leave-normalized-status]').textContent(),'Approved','Draft must not masquerade as a returned normalized value');
   assert.equal(await dialog.locator('[data-leave-approval-authority]').filter({hasText:'Last preview only'}).count(),25);assert.equal(await dialog.locator('[data-apply]').getAttribute('aria-disabled'),'true');
   await activate(page,dialog.locator('[data-apply]'));assert.equal(calls.some(c=>c.path.endsWith('/apply')),false,'Stale Apply never sends a mutation');
   const excluded=dialog.locator('[data-review-row="CSV:1"] [data-include]');await excluded.uncheck();await activate(page,dialog.locator('[data-page="1"]'));assert.equal(await dialog.locator('[data-leave-approval-authority]').filter({hasText:'Last preview only'}).count(),5);await activate(page,dialog.locator('[data-page="-1"]'));
   assert.equal(await dialog.locator('[data-review-row="CSV:0"] [data-field=status]').inputValue(),'rejected');assert.equal(await dialog.locator('[data-review-row="CSV:1"] [data-include]').isChecked(),false);
   mode='held';await activate(page,dialog.locator('[data-refresh]'));await arrived;assert.equal(previews.at(-1).corrections['CSV:0'].status,'rejected');assert.deepEqual(previews.at(-1).excluded,['CSV:1']);
   const close=dialog.locator('.mw-header [data-close]');await close.focus();await heldRoute.fulfill({status:503,json:{detail:'Approval preview temporarily unavailable'}});releaseHeld();await dialog.getByText(/Approval preview temporarily unavailable/).first().waitFor();
   assert.equal(await close.evaluate(e=>e===document.activeElement),true,'Failed refresh respects newer focus');assert.equal(await dialog.locator('[data-leave-approval-authority]').filter({hasText:'Last preview only'}).count(),25);
   assert.equal(await dialog.locator('[data-review-row="CSV:0"] [data-field=status]').inputValue(),'rejected');
   mode='normal';await activate(page,dialog.locator('[data-refresh]'));await dialog.locator('[data-review-row="CSV:0"] [data-leave-normalized-status]').filter({hasText:/^Rejected$/}).waitFor();await checkPage(0,25);
   assert.equal(await dialog.locator('[data-leave-approval-authority]').filter({hasText:'not an import-save confirmation'}).count(),25);assert.equal(await dialog.locator('[data-review-row="CSV:1"] [data-include]').isChecked(),false);
   assert.equal(await page.evaluate(()=>window.leaveImportInjected),undefined);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
   results.push({...diagnostic,knownAndDefensiveCases:15,rowsCompared:80,inputVersusNormalizedDistinct:true,dirtyDraftNotConfirmed:true,pagingNoRequests:true,excludedChoiceRetained:true,held503RetryRetainsDraft:true,newerFocusPreserved:true,previewPayloads:previews,noApplyRequests:true,errors});
   console.log(`Approval status ${engine} ${layout.width}x${layout.height} ${layout.font}% ${scheme}`);
  }finally{await context.close();}
 }}finally{await browser.close();}
}
 assert.deepEqual(await hashes(),initial);assert.equal(sha(await readFile(candidatePath)),candidateSha);assert.equal(sha(await readFile(new URL(import.meta.url))),testSha);
}catch(e){failure={message:e.message,stack:e.stack,diagnostic};}
const report={recorded_at_utc:new Date().toISOString(),base,candidate:{path:candidatePath,sha256:candidateSha},source_sha256:initial,final_source_sha256:await hashes(),test_sha256:testSha,scope:'Actual operational leave import controller; local POST preview/columns fixture and GET responses only. Five known approval states plus defensive malformed/unknown states, preview-input provenance, paging, dirty edits, exclusion, held503/newer-focus/manual retry. Not parser/backend-normalization or saved approval correctness; no Apply request permitted. Emulation only.',results,failure};
await writeFile('../docs/premium-ui/qa-leave-import-approval-visual-preview'+(stress?'-stress':'')+'.json',JSON.stringify(report,null,2)+'\n');if(failure)throw new Error(failure.message);console.log('Approval states: '+results.length+' contexts passed');
