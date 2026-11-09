import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',paths=['frontend/src/member-workspace.ts','frontend/src/member-presentation.ts','frontend/src/record-workspace.ts','frontend/src/services/api.ts','frontend/src/ui.ts','frontend/src/styles.css','frontend/src/premium-theme.css','frontend/src/extra-duty.ts'];
const digest=v=>createHash('sha256').update(v).digest('hex'),hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,digest(await readFile('../'+p))]))),initial=await hashes(),testSha=digest(await readFile(new URL(import.meta.url))),results=[];
const member={id:'provenance',canonical_name:'Dr Provenance',active_status:'active',call_level:'1ST_CALL',effective_call_level:'3RD_CALL',revision:'one',aliases:[{id:'alias-kept',alias:'Known alternate name',source:'CSV <img src=x> source'}],designations:[],call_level_changes:[]};
const provenance={source:'csv_import',author:'Recorded author <img src=x>',recorded_at:'2026-10-01T06:30:00Z',created_at:'2026-09-01T06:30:00Z',updated_at:'2026-10-02T06:30:00Z',import_file:'Roster.csv',import_sheet:'Members',import_row:0};
const essential={notes:'Important record notes <img src=x>',unknown_essential:'Preserved clinical context',count:0,flag:false,empty:'',nullable:null};
const rows={postings:{id:'posting-target',person_id:member.id,unit:'Exact unit',unit_id:'unit-exact',posting_type:'3RD_CALL',starts_on:'2026-10-29',ends_on:'2026-12-03',status:'active',...essential,...provenance},leave:{id:'leave-target',person_id:member.id,type:'SICK_LEAVE',slot:'SECOND_HALF',starts_on:'2026-10-29',ends_on:'2026-12-03',status:'requested',...essential,...provenance},duties:{id:'duty-target',person_id:member.id,date:'2026-10-29',call_level:'3RD_CALL',status:'published',...essential,...provenance}};
const labels={posting_type:['3RD_CALL'],leave_type:['SICK_LEAVE'],leave_slot:['SECOND_HALF'],leave_status:['requested']};
async function activate(page,locator){await locator.focus();await page.keyboard.press('Enter');}
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of[320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'en-GB',timezoneId:'Asia/Kolkata',reducedMotion:'reduce'}),page=await context.newPage(),reads=[],errors=[],cases=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-10-24T06:30:00Z'));
  await page.route('**/__record_provenance',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open profile</button></body></html>'}));
  await page.route('**/api/**',route=>{
   const q=route.request(),url=new URL(q.url()),p=url.pathname;assert.equal(q.method(),'GET','No mutation in provenance test');reads.push(p+url.search);let json;
   if(p==='/api/v1/admin/member-workspace/provenance')json={member,impact:{}};
   else if(p.startsWith('/api/v1/admin/member-workspace/provenance/')){const tab=p.split('/').at(-1);assert.ok(Object.hasOwn(rows,tab)||tab==='duplicates');json={rows:tab==='duplicates'?[]:[rows[tab]]};}
   else if(p==='/api/v1/extra-duty/ledger'){assert.equal(url.searchParams.get('person_id'),member.id);json=[];}
   else if(p==='/api/v1/admin/members')json=[member];
   else if(p==='/api/v1/normalization/units')json=[{id:'unit-exact',name:'Exact unit',active_status:'active'}];
   else if(p.startsWith('/api/v1/normalization/catalog/')){const key=p.split('/').at(-1);assert.ok(Object.hasOwn(labels,key));json=labels[key].map(key=>({key,label:key,active:true}));}
   else if(p==='/api/v1/normalization/records/units/posting-target')json=rows.postings;
   else if(p==='/api/v1/normalization/records/leave/leave-target')json={...rows.leave,leave_type:rows.leave.type,leave_slot:rows.leave.slot};
   else assert.fail('Unexpected provenance request '+p);return route.fulfill({json});
  });
  await page.goto(base+'/__record_provenance');
  for(const admin of[true,false]){
   const original=structuredClone(rows);await page.evaluate(admin=>{document.querySelector('#open').onclick=()=>import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace('provenance',admin,()=>{},['provenance'],'overview'));},admin);await activate(page,page.locator('#open'));const dialog=page.getByRole('dialog',{name:'Member profile',exact:true});await dialog.locator('[data-member-designation]').waitFor();
   for(const tab of['postings','leave','duties']){
    await activate(page,dialog.locator('[data-tab="'+tab+'"]'));const disclosure=dialog.locator('[data-profile-disclosure="record-'+tab+'-'+rows[tab].id+'"]');await disclosure.waitFor();const card=disclosure.locator('..');
    const fields=await card.locator(':scope > dl > div').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.querySelector('dt').textContent,n.querySelector('dd').textContent])));
    assert.equal(fields.notes,essential.notes);assert.equal(fields['unknown essential'],essential.unknown_essential);assert.equal(fields.count,'0');assert.equal(fields.flag,'No');assert.equal(fields.empty,'');assert.equal(fields.nullable,'Not recorded');assert.equal(fields.status,tab==='leave'?'Requested':tab==='postings'?'Active':'Published');
    for(const key of Object.keys(provenance))assert.equal(Object.hasOwn(fields,key.replaceAll('_',' ')),false,'Only declared provenance moves to disclosure');
    assert.equal(await disclosure.evaluate(n=>n.open),false);assert.equal(await disclosure.locator('dd').first().isVisible(),false);await activate(page,disclosure.locator('summary'));
    const metadata=await disclosure.locator('dl > div').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.querySelector('dt').textContent,n.querySelector('dd').textContent])));
    assert.deepEqual(metadata,{'source':'Csv Import','author':provenance.author,'recorded at':provenance.recorded_at,'created at':provenance.created_at,'updated at':provenance.updated_at,'import file':provenance.import_file,'import sheet':provenance.import_sheet,'import row':'0'});assert.equal(await disclosure.locator('dd').first().isVisible(),true);
    await activate(page,disclosure.locator('summary'));assert.equal(await disclosure.evaluate(n=>n.open),false);assert.equal(await card.locator(':scope > dl').isVisible(),true);
    if(tab!=='duties'){
     assert.deepEqual(await card.locator('.mw-record-dates time').evaluateAll(nodes=>nodes.map(n=>n.dateTime)),['2026-10-29','2026-12-03']);
     const edit=card.locator('[data-edit-record]');assert.equal(await edit.getAttribute('data-edit-record'),rows[tab].id);if(tab==='leave')assert.equal(await card.locator('[data-cancel-profile-leave]').getAttribute('data-cancel-profile-leave'),rows[tab].id);
     await activate(page,edit);const editor=page.getByRole('dialog',{name:tab==='postings'?'Edit posting':'Edit leave',exact:true});await editor.locator('[name="starts_on"]').waitFor();assert.equal(await editor.locator('[name="person_id"]').inputValue(),member.id);assert.equal(await editor.locator('[name="starts_on"]').inputValue(),'2026-10-29');assert.equal(await editor.locator('[name="ends_on"]').inputValue(),'2026-12-03');assert.equal(await editor.locator('[name="notes"]').inputValue(),essential.notes);await activate(page,editor.getByRole('button',{name:'Cancel',exact:true}));await editor.waitFor({state:'detached'});assert.equal(await edit.evaluate(n=>n===document.activeElement),true);
    }
   }
   await activate(page,dialog.locator('[data-tab="names"]'));const alias=dialog.locator('[data-member-alias-provenance]');await alias.waitFor();assert.equal(await alias.locator('small').isVisible(),false);assert.equal(await alias.locator('..').locator(':scope > strong').innerText(),'Known alternate name');await activate(page,alias.locator('summary'));assert.equal(await alias.locator('small').innerText(),member.aliases[0].source);assert.equal(await alias.locator('small').isVisible(),true);await activate(page,alias.locator('summary'));assert.equal(await alias.evaluate(n=>n.open),false);assert.equal(await dialog.locator('img').count(),0);assert.deepEqual(rows,original);
   await activate(page,dialog.locator('[data-close]'));await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#open').evaluate(n=>n===document.activeElement),true);cases.push({admin,sections:['postings','leave','duties','aliases'],declaredProvenanceExact:true,unknownAndFalsyEssentialsPreserved:true,exactRecordEditorCancel:true,nativeDisclosureToggle:true});
  }
  assert.deepEqual(errors,[]);results.push({engine,width,cases,reads,pageErrors:errors});console.log('Record provenance passed '+engine+' '+width);await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Application sources held');assert.equal(digest(await readFile(new URL(import.meta.url))),testSha,'Test source held');await writeFile('../docs/premium-ui/qa-profile-record-provenance.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,test_sha256:testSha,scope:'6engine-width contexts/12rendered-role workflows, GET-only local fixtures. All8 declared provenance fields, alias source, unknown essential fields/null/zero/false/empty, visible dates/status/notes, native disclosure toggles, exact posting/leave editor identity and clean native Cancel. No operational leave cancellation, save, backend authorization/persistence, physical devices or native AT claim.',results},null,2)+'\n');console.log('Profile record provenance: '+results.length+' contexts /12 workflows passed');
