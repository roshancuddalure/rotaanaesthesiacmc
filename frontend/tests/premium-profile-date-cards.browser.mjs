import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Actual canonical workspace and record editor; all declared GETs fulfilled locally.
// Native keyboard activation only. This is presentation/identity coverage, not persistence.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const paths=['frontend/src/member-workspace.ts','frontend/src/record-workspace.ts','frontend/src/ui.ts','frontend/src/audit-time.ts','frontend/src/styles.css','frontend/src/premium-theme.css','frontend/src/services/api.ts','frontend/src/workspace-load-state.ts'];
const digest=v=>createHash('sha256').update(v).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,digest(await readFile('../'+p))])));
const initial=await hashes(),testSha=digest(await readFile(new URL(import.meta.url))),results=[];
const longNote='Extensive historical context <img src=x> '+('LongUnbrokenClinicalHistory'.repeat(12));
const changes=[
 {call_level:'5TH_CALL',effective_from:'2026-12-01',notes:'Future scheduled '+longNote},
 {call_level:'1ST_CALL',effective_from:'2025-01-01',notes:'Old recorded change'},
 {call_level:'3RD_CALL',effective_from:'2026-10-24',notes:'Today recorded change'},
 {call_level:'PAIN',effective_from:'',notes:'Undated historical import'},
 {call_level:'SICU',effective_from:'2026-02-30',notes:'Malformed imported date'},
 {call_level:'4TH_CALL',effective_from:'2026-10-01',notes:'Earlier this month'},
 {call_level:'2ND_CALL',effective_from:'2026-10-24',notes:'Same day stable-order example'},
];
const member={id:'date-cards',canonical_name:'Dr Long Profile Date Review '+('Extended Name '.repeat(12)),active_status:'active',call_level:'1ST_CALL',effective_call_level:'CO_4TH_CALL',revision:'date-fixture-one',aliases:[],designations:[{designation:'Consultant '+longNote,effective_from:'2025-01-01',effective_to:null,notes:longNote,source:'manual'}],call_level_changes:changes};
const unitNames={'unit-one':'First Unit','unit-two':('Exact Target Unit '+('Extended Clinical Unit Name '.repeat(6))).trim()};
const postings=[
 {id:'posting-first',person_id:member.id,starts_on:'2025-01-01',ends_on:'2025-03-01',posting_type:'2ND_CALL',unit_id:'unit-one',status:'active',notes:'Past posting'},
 {id:'posting-target',person_id:member.id,starts_on:'2026-10-29',ends_on:'2026-12-03',posting_type:'3RD_CALL',unit_id:'unit-two',status:'active',notes:longNote},
 {id:'posting-ongoing',person_id:member.id,starts_on:'2026-10-24',ends_on:null,posting_type:'2ND_CALL',unit_id:'unit-one',status:'active',notes:'Starts today, no end'},
 {id:'posting-unknown',person_id:member.id,starts_on:null,ends_on:null,posting_type:'2ND_CALL',unit_id:'unit-one',status:'active',notes:'Missing dates'},
 {id:'posting-invalid',person_id:member.id,starts_on:'2026-02-30',ends_on:'2026-12-03',posting_type:'2ND_CALL',unit_id:'unit-one',status:'active',notes:'Malformed'},
 {id:'posting-reversed',person_id:member.id,starts_on:'2026-12-03',ends_on:'2026-10-29',posting_type:'2ND_CALL',unit_id:'unit-one',status:'active',notes:'Reversed range'},
].map(row=>({...row,unit:unitNames[row.unit_id]}));
const leave=[
 {id:'leave-first',person_id:member.id,starts_on:'2025-01-01',ends_on:'2025-01-02',type:'ANNUAL_LEAVE',slot:'FULL_DAY',status:'approved',notes:'Past approved'},
 {id:'leave-target',person_id:member.id,starts_on:'2026-10-29',ends_on:'2026-12-03',type:'SICK_LEAVE',slot:'SECOND_HALF',status:'requested',notes:longNote},
 {id:'leave-cancelled-future',person_id:member.id,starts_on:'2026-11-01',ends_on:'2026-11-03',type:'ANNUAL_LEAVE',slot:'FULL_DAY',status:'cancelled',notes:'Cancelled and future'},
 {id:'leave-current',person_id:member.id,starts_on:'2026-10-24',ends_on:'2026-10-24',type:'ANNUAL_LEAVE',slot:'FULL_DAY',status:'requested',notes:'Today only'},
 {id:'leave-missing-end',person_id:member.id,starts_on:'2026-10-24',ends_on:null,type:'ANNUAL_LEAVE',slot:'FULL_DAY',status:'approved',notes:'Unknown range'},
 {id:'leave-invalid',person_id:member.id,starts_on:'2026-12-03',ends_on:'2026-10-29',type:'ANNUAL_LEAVE',slot:'FULL_DAY',status:'approved',notes:'Reversed leave'},
];
const labels={posting_type:['2ND_CALL','3RD_CALL'],leave_type:['ANNUAL_LEAVE','SICK_LEAVE'],leave_slot:['FULL_DAY','SECOND_HALF'],leave_status:['requested','approved','cancelled']};
async function activate(page,locator){await locator.focus();await page.keyboard.press('Enter');}
async function assertDateContext(dialog){
 const context=dialog.locator('p.mw-date-context');assert.equal(await context.count(),1);
 assert.equal(await context.innerText(),'Date labels are compared with 24 Oct 2026 on this device.');
 assert.equal(await context.locator('time').getAttribute('datetime'),'2026-10-24');
}
async function measure(dialog){return dialog.evaluate(el=>({dialog:el.getBoundingClientRect().width,viewport:innerWidth,content:[...el.querySelectorAll('.mw-content')].map(n=>({width:n.clientWidth,scroll:n.scrollWidth})),cards:[...el.querySelectorAll('.mw-call-timeline > li,article.mw-history')].map(n=>({width:n.clientWidth,scroll:n.scrollWidth})),images:el.querySelectorAll('img').length}));}

for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const config of [{width:320,scale:1},{width:1280,scale:1},...(engine==='chromium'?[{width:320,scale:2}]:[])]){
  const {width,scale}=config,theme=width===320?'dark':'light';
  const context=await browser.newContext({viewport:{width,height:900},locale:'en-GB',timezoneId:'Asia/Kolkata',colorScheme:theme,reducedMotion:'reduce'});
  const page=await context.newPage(),reads=[],writes=[],errors=[],unexpected=[],prompts=[];let returnedEffective=member.effective_call_level;
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',async prompt=>{prompts.push(prompt.message());await prompt.dismiss();});
  await page.clock.setFixedTime(new Date('2026-10-24T06:30:00Z'));
  await page.route('**/__profile_date_cards',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en" data-theme="${theme}" style="font-size:${scale*100}%"><head><title>Profile date cards</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open member profile</button></body></html>`}));
  await page.route('**/api/**',r=>{
   const req=r.request(),url=new URL(req.url()),path=url.pathname;
   if(req.method()!=='GET'){writes.push({method:req.method(),path,body:req.postData()});return r.fulfill({status:599,json:{detail:'Operational writes forbidden in date presentation test'}});}
   reads.push(path);let json;
   if(path==='/api/v1/admin/member-workspace/'+member.id)json={member:{...member,effective_call_level:returnedEffective},impact:{}};
   else if(path==='/api/v1/admin/member-workspace/'+member.id+'/roles')json={rows:[]};
   else if(path==='/api/v1/admin/member-workspace/'+member.id+'/postings')json={rows:postings};
   else if(path==='/api/v1/admin/member-workspace/'+member.id+'/leave')json={rows:leave};
   else if(path==='/api/v1/admin/members')json=[member];
   else if(path==='/api/v1/normalization/units')json=Object.entries(unitNames).map(([id,name])=>({id,name,active_status:'active'}));
   else if(path.startsWith('/api/v1/normalization/catalog/')&&Object.hasOwn(labels,path.split('/').at(-1)))json=labels[path.split('/').at(-1)].map(key=>({key,label:key,active:true}));
   else if(path==='/api/v1/normalization/records/units/posting-target')json=postings[1];
   else if(path==='/api/v1/normalization/records/leave/leave-target')json={...leave[1],leave_type:leave[1].type,leave_slot:leave[1].slot};
   else{unexpected.push(path);return r.fulfill({status:599,json:{detail:'Unexpected GET'}});}
   assert.equal(url.search,'','No additional contract parameters expected');return r.fulfill({json});
  });
  await page.goto(base+'/__profile_date_cards');
  await page.evaluate(()=>{document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('date-cards',true,()=>{window.__changed=(window.__changed||0)+1;},['date-cards'],'roles'));});
  await activate(page,page.locator('#open'));const dialog=page.getByRole('dialog',{name:'Member profile',exact:true});
  await dialog.locator('.mw-call-timeline > li').first().waitFor();
  const timeline=dialog.locator('.mw-call-timeline > li');
  await assertDateContext(dialog);
  assert.match(await dialog.locator('#mw-panel').innerText(),/Current effective call level returned by the system: Co 4th Call\. Base default: 1st Call\./);
  assert.equal(await timeline.count(),changes.length);
  assert.deepEqual(await timeline.evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.callChangeHistory))),[1,5,2,6,0,3,4],'Read-only chronology sorted on a copy with stable ties and unknowns last');
  assert.equal(await dialog.locator('[data-call-change],[data-remove-call-change],[data-add-call-change]').count(),0,'Read mode contains prose, no disabled dated-change form');
  for(const [index,c]of changes.entries()){
   const item=dialog.locator(`[data-call-change-history="${index}"]`),text=await item.innerText();
   assert.ok(text.includes(c.notes),'Every note belongs to its exact dated change');
   assert.ok(text.includes(index===0?'Scheduled change':index===3?'Date not recorded':index===4?'Date invalid':'Recorded change'));
   if(index!==3&&index!==4)assert.equal(await item.locator('time').getAttribute('datetime'),c.effective_from);
  }
  const rolesGeometry=await measure(dialog);assert.equal(rolesGeometry.images,0);
  for(const m of [...rolesGeometry.content,...rolesGeometry.cards])assert.ok(m.scroll<=m.width+2,'Long timeline text wraps inside its surface: '+JSON.stringify(m));
  await activate(page,dialog.locator('[data-tab="overview"]'));
  const overview=await dialog.locator('#mw-panel').innerText();assert.match(overview,/Co 4th Call/);assert.ok(!overview.includes('5th Call'),'Authoritative returned effective level remains distinct from latest future row');
  await activate(page,dialog.locator('[data-tab="roles"]'));
  await activate(page,dialog.locator('[data-edit]'));
  for(const [index,c]of changes.entries()){
   assert.equal(await dialog.locator(`select[data-call-change="${index}"]`).inputValue(),c.call_level);
   assert.equal(await dialog.locator(`input[data-call-change="${index}"][data-key="effective_from"]`).getAttribute('value'),c.effective_from,'Editing preserves raw original index/date attribute, including malformed imports');
   assert.equal(await dialog.locator(`input[data-call-change="${index}"][data-key="notes"]`).inputValue(),c.notes);
  }
  await activate(page,dialog.locator('[data-cancel-edit]'));
  assert.equal(await timeline.count(),changes.length);assert.equal(writes.length,0);
  const rangeResults=[];
  for(const [key,rows,expectedStates]of [['postings',postings,['Ended','Scheduled dates','Includes today','Date range not recorded','Date range invalid','Date range invalid']],['leave',leave,['Ended','Scheduled dates','Scheduled dates','Includes today','Date range not recorded','Date range invalid']]]){
   await activate(page,dialog.locator(`[data-tab="${key}"]`));await dialog.locator(`[data-edit-record="${rows.at(-1).id}"]`).waitFor();
   await assertDateContext(dialog);
   for(const [index,row]of rows.entries()){
    const card=dialog.locator('article.mw-history').filter({has:page.locator(`[data-edit-record="${row.id}"]`)});
    assert.equal(await card.count(),1);const state=await card.locator('.mw-date-state').innerText();assert.equal(state,expectedStates[index]);
   assert.equal(await card.locator('.mw-record-heading').count(),1);
   if(key==='postings')assert.equal(await card.locator('.mw-record-heading').innerText(),`Posting: ${row.unit} · ${row.posting_type==='3RD_CALL'?'3rd Call':'2nd Call'}`,'Posting heading identifies returned unit, independently of call level');
   else assert.equal(await card.locator('.mw-record-status').innerText(),'Status: '+row.status.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()),'Top-level returned approval state is separate from temporal state');
   const targets=await card.locator('[data-edit-record],[data-cancel-profile-leave]').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width})));
   assert.ok(targets.length>0);for(const target of targets)assert.ok(target.height>=44&&target.width>=44,'Native record actions meet44px target geometry: '+JSON.stringify(target));
    const descriptions=await card.locator('[data-edit-record]').evaluate(button=>(button.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent||''));
    assert.ok(descriptions.length>=2&&descriptions.every(Boolean),'Record action describes its own heading and complete dates');
    if(row.id.endsWith('target')){assert.ok(descriptions.join(' ').includes('29 Oct 2026'));assert.ok(descriptions.join(' ').includes('3 Dec 2026'));}
    if(row.id==='posting-ongoing')assert.match(await card.innerText(),/Ongoing/);
    if(row.id==='leave-current'){assert.ok((await card.innerText()).includes('24 Oct 2026'));assert.ok((await card.innerText()).includes('Requested'));}
    if(row.id==='leave-cancelled-future'){assert.ok((await card.innerText()).includes('Cancelled'));assert.equal(await card.locator('[data-cancel-profile-leave]').count(),0);}
   }
   const geometry=await measure(dialog);for(const m of [...geometry.content,...geometry.cards])assert.ok(m.scroll<=m.width+2,'Long record text wraps locally: '+JSON.stringify(m));
   const target=dialog.locator(`[data-edit-record="${rows[1].id}"]`),before=reads.length;
   await activate(page,target);const editor=page.getByRole('dialog',{name:key==='postings'?'Edit posting':'Edit leave',exact:true});await editor.locator('input[name="starts_on"]').waitFor();
   assert.equal(await editor.locator('input[name="starts_on"]').inputValue(),'2026-10-29');assert.equal(await editor.locator('input[name="ends_on"]').inputValue(),'2026-12-03');
   assert.equal(await editor.locator('select[name="person_id"]').inputValue(),member.id);assert.equal(await editor.locator('textarea[name="notes"]').inputValue(),longNote);
   if(key==='postings'){assert.equal(await editor.locator('select[name="unit_id"]').inputValue(),'unit-two');assert.equal(await editor.locator('select[name="posting_type"]').inputValue(),'3RD_CALL');}
   else{assert.equal(await editor.locator('select[name="leave_type"]').inputValue(),'SICK_LEAVE');assert.equal(await editor.locator('select[name="leave_slot"]').inputValue(),'SECOND_HALF');assert.equal(await editor.locator('select[name="status"]').inputValue(),'requested');}
   const exactReads=['/api/v1/admin/members','/api/v1/normalization/units',...(key==='postings'?['posting_type']:['leave_type','leave_slot','leave_status']).map(k=>'/api/v1/normalization/catalog/'+k),`/api/v1/normalization/records/${key==='postings'?'units':'leave'}/${rows[1].id}`];
   assert.deepEqual(reads.slice(before),exactReads,'Exact non-first record identity and existing option GET contracts');
   await activate(page,editor.getByRole('button',{name:'Cancel',exact:true}));await editor.waitFor({state:'detached'});assert.equal(await target.evaluate(el=>el===document.activeElement),true,'Closing nested editor restores the exact original record action');
   assert.equal(writes.length,0);rangeResults.push({section:key,records:rows.length,states:expectedStates,exactEditorReads:exactReads,nonFirstTarget:rows[1].id,focusRestored:true,geometry});
  }
  await activate(page,dialog.getByRole('button',{name:'Close member profile',exact:true}));await dialog.waitFor({state:'detached'});
  assert.equal(await page.locator('#open').evaluate(el=>el===document.activeElement),true);
  returnedEffective=null;await activate(page,page.locator('#open'));await dialog.locator('.mw-call-timeline > li').first().waitFor();
  await assertDateContext(dialog);
  assert.match(await dialog.locator('#mw-panel').innerText(),/Current effective call level returned by the system: Unassigned\. Base default: 1st Call\./,'Explicit returned null never replaced by base default or inferred from timeline');
  await activate(page,dialog.getByRole('button',{name:'Close member profile',exact:true}));await dialog.waitFor({state:'detached'});
  assert.equal(await page.locator('#open').evaluate(el=>el===document.activeElement),true);assert.deepEqual(prompts,[],'Read-only sorting and editor cancellation do not dirty the profile');assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(writes,[]);assert.equal(await page.evaluate(()=>window.__changed||0),0);
  results.push({engine,width,height:900,theme,rootFontScale:scale,clock:'2026-10-24T06:30:00Z',chronologicalOriginalIndices:[1,5,2,6,0,3,4],authoritativeEffectiveLevel:'CO_4TH_CALL',returnedNullEffectivePreserved:true,rawEditorOrderPreserved:true,readOnlyTimeline:true,rangeResults,rolesGeometry,reads,unexpectedPrompts:prompts,operationalWrites:writes,pageErrors:errors});
  await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Application sources held throughout this run');assert.equal(digest(await readFile(new URL(import.meta.url))),testSha,'Test held throughout this run');
await writeFile('../docs/premium-ui/qa-profile-date-cards.json',JSON.stringify({checked_at:new Date().toISOString(),source_sha256:initial,test_sha256:testSha,scope:'Actual exported canonical member workspace and nested record editor; local GET-only fixture;3 engines x320/1280 plus Chromium320 root-font200%. Chronological read timeline copy, authoritative effective level, original edit order, date-only states independent of returned status, exact non-first record GETs, complete cross-month/single/open ranges, long content geometry, native actions and close focus. No operational writes, backend authorization/persistence, physical devices, native AT, real browser zoom or deployed-bundle certification.',results},null,2)+'\n');
console.log('Profile date cards: '+results.length+' contexts complete');
