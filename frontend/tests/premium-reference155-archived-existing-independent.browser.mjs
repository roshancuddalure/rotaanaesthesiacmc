import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base='http://127.0.0.1:5197',results=[],sha=b=>createHash('sha256').update(b).digest('hex');
const sourcePaths=['src/record-workspace.ts','src/reference-workspace.ts','src/services/api.ts','src/member-workspace.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
const person={id:'11111111-1111-4111-8111-111111111111',canonical_name:'Dr Archived Reference Context',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]};
const unit={id:'22222222-2222-4222-8222-222222222222',name:'Existing Active Unit',campus:'Main',active_status:'active'};
const identity='33333333-3333-4333-8333-333333333333';
const catalog={posting_type:[{key:'1ST_CALL',label:'1st Call',active:true},{key:'2ND_CALL',label:'2nd Call',active:true}],leave_type:[{key:'ANNUAL_LEAVE',label:'Annual leave',active:true},{key:'CL',label:'Casual leave',active:true}],leave_slot:[{key:'FULL_DAY',label:'Full day',active:true},{key:'AM',label:'Morning',active:true}],leave_status:[{key:'approved',label:'Approved',active:true},{key:'requested',label:'Requested',active:true}]};
const scenarios=[['units','posting_type','posting_type','2ND_CALL'],['leave','leave_type','leave_type','CL'],['leave','leave_slot','leave_slot','AM'],['leave','status','leave_status','requested']];
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of [320,1280]){
  const page=await browser.newPage({viewport:{width,height:850}}),errors=[],unexpected=[],posts=[],cases=[];let current;
  page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.route('**/__reference155_existing',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Edit existing dated record</button></body></html>'}));
   await page.route('**/api/**',async r=>{const q=r.request(),path=new URL(q.url()).pathname;
    if(q.method()==='POST'&&path==='/api/v1/normalization/records/'+current.kind+'/preview'){posts.push({path,body:q.postDataJSON()});return r.fulfill({status:503,json:{detail:'Independent preview intercepted; no data saved'}});}
    if(q.method()!=='GET'){unexpected.push(q.method()+' '+path);return r.abort();}
    if(path==='/api/v1/admin/members')return r.fulfill({json:[person]});
    if(path==='/api/v1/normalization/units')return r.fulfill({json:[unit]});
    if(path==='/api/v1/normalization/records/'+current.kind+'/'+identity)return r.fulfill({json:current.record});
    if(path.startsWith('/api/v1/normalization/catalog/')){const key=path.split('/').at(-1);assert.ok(catalog[key]);return r.fulfill({json:catalog[key].map(v=>({...v,active:!(current.archived&&key===current.reference&&v.key===current.expected)}))});}
    unexpected.push(q.method()+' '+path);return r.abort();
   });
   await page.goto(base+'/__reference155_existing');
   for(const[kind,field,reference,expected]of scenarios)for(const archived of [false,true]){
    current={kind,field,reference,expected,archived,record:{id:identity,person_id:person.id,unit_id:unit.id,posting_type:'2ND_CALL',leave_type:'CL',leave_slot:'AM',status:'requested',starts_on:'2026-06-03',ends_on:'2026-06-13',notes:'Existing unchanged record'}};
    await page.evaluate(({kind,identity,personId})=>{document.querySelector('#open').onclick=()=>import('/src/record-workspace.ts').then(m=>m.openRecordEditor(kind,personId,identity,true,()=>{}));},{kind,identity,personId:person.id});
    await page.locator('#open').focus();await page.keyboard.press('Enter');const dialog=page.locator('dialog.record-workspace');await dialog.locator('[name=notes]').waitFor();const selected=await dialog.locator(`[name=${field}]`).inputValue(),options=await dialog.locator(`[name=${field}] option`).evaluateAll(es=>es.map(e=>({value:e.value,label:e.textContent,selected:e.selected,disabled:e.disabled})));
    if(!archived)assert.equal(selected,expected,'Active control retains returned existing value');
    const before=posts.length;await dialog.getByRole('button',{name:'Review changes',exact:true}).click();await dialog.locator('[data-error]').filter({hasText:'Independent preview intercepted'}).waitFor();assert.equal(posts.length,before+1);assert.equal(posts.at(-1).body.identity,identity);assert.equal(posts.at(-1).body.values[field],selected);
    cases.push({kind,field,reference,archived,returnedExistingValue:expected,visibleSelected:selected,previewValue:posts.at(-1).body.values[field],valuePreserved:selected===expected,options});
    await dialog.locator('header [data-close]').click();await dialog.waitFor({state:'detached'});
   }
   assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);results.push({engine,width,cases,errors,unexpected,previewPosts:posts.length,saveRequests:0});console.log(engine+' '+width+' '+cases.filter(c=>c.archived&&!c.valuePreserved).length+' archived-value gaps');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);await writeFile('../docs/premium-ui/qa-reference155-archived-existing-independent.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),reviewer:'/root/reference155_159_audit',source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),scope:'Independent actual exported record-workspace diagnostic6engine/width contexts with4fields×active/archived scenarios each. Native unchanged Review captures exact locally intercepted preview body; all saves/other writes rejected. Catalog shape matches source-supported persisted inactive built-in overrides; not a backend persistence or policy test. Archived failures recorded,not falsely asserted passed.',results},null,2)+'\n');console.log('Archived existing reference diagnostic complete: '+results.length+' contexts');
