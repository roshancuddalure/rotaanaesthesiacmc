// Authored diagnostic, not a product patch. All writes are local fixtures.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=x=>createHash('sha256').update(x).digest('hex');
const base='http://127.0.0.1:5313',ram='http://127.0.0.1:8031';
const smoke=process.env.MEMBERCSV159_V15_SMOKE==='1';
const report='../docs/premium-ui/qa-original159-membercsv-result-profile-v15r1-candidate'+(smoke?'-smoke':'')+'-20261110.json';
await assert.rejects(access(report),{code:'ENOENT'});
const held={
 'frontend/src/main.ts':'ebf67f1733f620e406054d0c4a82cf1c203fd0e6603a843eec45b25a1a09df4d',
 'frontend/src/reference-workspace.ts':'91133b6913c3e7c5a493bbf19436ca06ba5ad9d1813a13974c70d0d6473a434a',
 'frontend/src/record-workspace.ts':'75589574417ed6f6287e625392417d3776411a8e7ef413a940e33915e57a6c33',
 'frontend/src/workspace-load-state.ts':'cdd0e323d7e83e6e668a381bbfcc37cad4726b1193ac5de31d5f14e03eecd9c6',
 'frontend/src/member-workspace.ts':'506c486046fe6f0bbea5c6c4bf6357fec6e9649d91a9ed1ed890551ed3503cca',
 'frontend/src/services/api.ts':'5167f842eb4e07cf5216d18bde2ef48ded1a6692490d80dd261e4ceb038a5e3c',
 'frontend/src/premium-theme.css':'2e4f85d813061ebc9f696b92d50ae24717a7781a3688187d02c7339c00bea4a1',
 'frontend/src/styles.css':'306928f568686cfc453178f73731a797f7fe5b9f016d7128bf9cd68dc6e1fb86'
};
const candidateHashes={'frontend/src/main.ts':'cc2bc958023b942b9c0cf0644067d93f31f0cd4100dda24d1cf38f94c15da802','frontend/src/member-workspace.ts':'527f4f55aac3c4ac9de54f679940ff0c06b679a8fb28543bba963b3baa43a52b'};
for(const[p,h]of Object.entries(held)){
 assert.equal(sha(await readFile('../'+p)),h,p);
 const response=await fetch(base+'/src/'+p.slice('frontend/src/'.length));assert.equal(response.status,200);
 const text=await response.text();
 if(p.endsWith('.ts')){const m=text.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(m);assert.ok(JSON.parse(Buffer.from(m[1],'base64').toString()).sourcesContent.some(s=>sha(s)===(candidateHashes[p]||h)));}
 else{const m=text.match(/const __vite__css = ("(?:[^"\\]|\\.)*")/);assert.ok(m);assert.equal(sha(JSON.parse(m[1])),h);}
}
const candidate={
 'frontend/src/main.ts':'cc2bc958023b942b9c0cf0644067d93f31f0cd4100dda24d1cf38f94c15da802',
 'frontend/src/member-workspace.ts':'527f4f55aac3c4ac9de54f679940ff0c06b679a8fb28543bba963b3baa43a52b'
};
const results=[];
for(const[engine,launcher]of Object.entries(smoke?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of(smoke?[320]:[320,1280]))for(const scenario of(smoke?['normal']:['normal','no-op','refused','two-saves','clone-fault','initial-get-retry','dirty-csv','route-expired','account-expired'])){
  console.log('[membercsv159] start '+engine+' '+width+' '+scenario+' '+new Date().toISOString());
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(15000);
  const requests=[],writes=[],errors=[];let memberReads=0,saved=false,applied=false,readsBeforeProfile=null,observed=null,profileReads=0,corePuts=0,savedName='Dr CSV Result Original OLD',heldMembersRoute,releaseHeldMembers;
  const deferredMembers=new Promise(resolve=>releaseHeldMembers=resolve);
  const id='csv159-result-person';
  const member=()=>({id,canonical_name:savedName,call_level:'2ND_CALL',active_status:'active',revision:saved?'two':'one',aliases:[],designations:[],call_level_changes:[]});
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{const clone=structuredClone;window.__csv159Faults=[];window.__csv159FaultArmed=false;window.structuredClone=function(value,options){if(window.__csv159FaultArmed&&value?.id==='csv159-result-person'&&value?.canonical_name==='Dr CSV Result Renamed NEW'){window.__csv159FaultArmed=false;const e=new Error('CSV159_POSTACCEPTED_CLONE_FAULT');window.__csv159Faults.push({message:e.message,stack:e.stack});throw e;}return clone(value,options);};});
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','membercsv159-local');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{
   const q=route.request(),u=new URL(q.url()),p=u.pathname;requests.push({method:q.method(),path:p,query:u.search});
   if(q.method()!=='GET'){
    if(p.endsWith('/member-workspace/csv/columns')){assert.equal(q.method(),'POST');return route.fulfill({json:{headers:['canonical_name']}});}
    if(p.endsWith('/member-workspace/csv/preview')){assert.equal(q.method(),'POST');return route.fulfill({json:{id:'csv159-preview',mode:'roster_sync',headers:['canonical_name'],missing:[],rows:[{row_number:2,values:{canonical_name:member().canonical_name},action:'create',errors:[],suggestions:[],before:null,after:{canonical_name:member().canonical_name,active_status:'active',call_level:'2ND_CALL'},person_id:null,revision:null}]}});}
    const body=q.postDataJSON();writes.push({method:q.method(),path:p,body});
    if(p==='/api/v1/admin/member-workspace/csv/csv159-preview/apply'){
     assert.equal(q.method(),'POST');assert.equal(applied,false);assert.deepEqual(body,{excluded:[],archive_missing:[]});applied=true;
     return route.fulfill({json:{batch_id:'csv159-preview',created:1,updated:0,unchanged:0,archived:0,excluded:0,members:[member()]}});
    }
    assert.equal(q.method(),'PUT');assert.equal(p,'/api/v1/admin/member-workspace/'+id);corePuts++;assert.ok(corePuts<=(scenario==='two-saves'?2:1));assert.ok(['Dr CSV Result Renamed NEW','Dr CSV Result Renamed FINAL'].includes(body.canonical_name));assert.equal(body.preserve_previous_name,true);if(scenario==='refused')return route.fulfill({status:503,json:{detail:'CSV159 core save refused'}});saved=true;savedName=body.canonical_name;return route.fulfill({json:member()});
   }
   if(p==='/api/v1/admin/members'){memberReads++;if(scenario==='dirty-csv'&&saved){heldMembersRoute=route;await deferredMembers;}return route.fulfill({json:applied?[member()]:[]});}
   if(p==='/api/v1/admin/member-workspace/'+id){profileReads++;if(scenario==='initial-get-retry'&&profileReads===1)return route.fulfill({status:503,json:{detail:'CSV159 initial profile read unavailable'}});return route.fulfill({json:{member:member(),impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});}
   if(p.startsWith('/api/v1/admin/member-workspace/'+id+'/'))return route.fulfill({json:{rows:[]}});
   return route.fulfill({response:await route.fetch({url:ram+p+u.search,maxRetries:2})});
  });
  const observe=async()=>({saved,applied,memberReads,expectedApiName:member().canonical_name,parentNames:await page.locator('#view-root [data-open-member="'+id+'"]').allTextContents(),search:await page.locator('#member-search').inputValue().catch(()=>null),errors});
  try{
   await page.goto(base+'/#view=members');await page.locator('#import-member-csv').click();
   const importer=page.getByRole('dialog',{name:'Import department members',exact:true});
   await importer.locator('input[type=file]').setInputFiles({name:'csv159.csv',mimeType:'text/csv',buffer:Buffer.from('canonical_name\r\nDr CSV Result Original OLD\r\n')});
   await importer.getByText('Map CSV columns',{exact:true}).waitFor();await importer.getByRole('button',{name:'Preview import',exact:true}).click();
   await importer.locator('[data-include="2"]').waitFor();await importer.locator('[data-apply]').click();
   await importer.getByRole('heading',{name:'Import complete',exact:true}).waitFor();
   await page.locator('#view-root [data-open-member="'+id+'"]').first().waitFor({state:'attached'});
   await page.waitForFunction(id=>[...document.querySelectorAll('#view-root [data-open-member]')].some(e=>e.dataset.openMember===id&&e.textContent==='Dr CSV Result Original OLD'),id);
   readsBeforeProfile=memberReads;
   await importer.locator('[data-result-member="'+id+'"]').click();
   const profile=page.getByRole('dialog',{name:'Member profile',exact:true});
   if(scenario==='initial-get-retry'){await profile.getByText('CSV159 initial profile read unavailable',{exact:true}).waitFor();await profile.getByRole('button',{name:'Try again',exact:true}).click();}
   const saveCore=async name=>{await profile.locator('[data-edit]').click();await profile.locator('[data-field="canonical_name"]').fill(name);await profile.getByRole('button',{name:'Save changes',exact:true}).click();};
   if(scenario!=='no-op'){
    if(scenario==='clone-fault')await page.evaluate(()=>window.__csv159FaultArmed=true);
    await saveCore('Dr CSV Result Renamed NEW');
    if(scenario==='refused'){await profile.locator('#mw-error').filter({hasText:'CSV159 core save refused'}).waitFor();await profile.locator('[data-cancel-edit]').click();}
    else if(scenario==='clone-fault'){await profile.locator('#mw-error').filter({hasText:'CSV159_POSTACCEPTED_CLONE_FAULT'}).waitFor();assert.equal(await page.evaluate(()=>window.__csv159Faults.length),1);await profile.locator('[data-cancel-edit]').click();}
    else{await profile.locator('[data-edit]').waitFor({state:'visible'});assert.equal(await profile.locator('[data-field="canonical_name"]').inputValue(),member().canonical_name);}
    if(scenario==='two-saves'){await saveCore('Dr CSV Result Renamed FINAL');await profile.locator('[data-edit]').waitFor({state:'visible'});}
   }
   assert.equal(memberReads,readsBeforeProfile,'Accepted child edits wait final profile close; existing CSV ownApply already refreshed once');
   let ownerReads=memberReads;
   if(scenario==='route-expired'){
    await page.evaluate(()=>{location.hash='#view=user-guide';});await page.locator('#guide-checklist').waitFor();ownerReads=memberReads;
   }else if(scenario==='account-expired'){
    await page.evaluate(()=>{localStorage.removeItem('duty_rota_auth_token');window.dispatchEvent(new StorageEvent('storage',{key:'duty_rota_auth_token',oldValue:'membercsv159-local',newValue:null,storageArea:localStorage}));});await profile.waitFor({state:'detached'});ownerReads=memberReads;
   }
   if(await profile.count()){await profile.getByRole('button',{name:'Close member profile',exact:true}).click();await profile.waitFor({state:'detached'});}
   if(scenario==='dirty-csv'){
    await page.waitForFunction(()=>document.querySelector('dialog.mw-import input[type=file]')!==null);
    for(let i=0;i<60&&!heldMembersRoute;i++)await new Promise(resolve=>setTimeout(resolve,25));assert.ok(heldMembersRoute,'New dependent GET held after final profile Close');
    await importer.locator('input[type=file]').setInputFiles({name:'new-dirty-csv159.csv',mimeType:'text/csv',buffer:Buffer.from('canonical_name\r\nNew unsent draft\r\n')});
    await importer.getByText('Map CSV columns',{exact:true}).waitFor();releaseHeldMembers();
   }
   const expectedRefresh=saved&&!scenario.endsWith('expired');
   if(expectedRefresh){await page.waitForFunction(expected=>[...document.querySelectorAll('#view-root [data-open-member]')].some(e=>e.dataset.openMember==='csv159-result-person'&&e.textContent===expected),member().canonical_name,{timeout:5000});assert.equal(memberReads,readsBeforeProfile+1);}
   else{await page.waitForLoadState('networkidle');assert.equal(memberReads,ownerReads,'No profile followup for no accepted mutation or expired owner');}
   if(scenario==='dirty-csv'){assert.equal(await importer.locator('input[type=file]').evaluate(e=>e.files[0]?.name),'new-dirty-csv159.csv');assert.equal(await importer.locator('[data-result-member]').count(),0);}
   if(await importer.count()){await importer.locator('[data-close]').click();await importer.waitFor({state:'detached'});}
   await page.waitForLoadState('networkidle');assert.equal(memberReads,expectedRefresh?readsBeforeProfile+1:ownerReads,'CSV final close cannot repeat already delivered profile notification');
   observed=await observe();assert.equal(writes.length,1+corePuts);assert.deepEqual(errors,[]);
   results.push({engine,width,scenario,passed:true,readsBeforeProfile,corePuts,profileReads,observed,writes,requests,errors});
  }catch(error){observed=await observe().catch(()=>null);results.push({engine,width,scenario,passed:false,assertion:error.message,readsBeforeProfile,observed,writes,requests,errors});}
  finally{releaseHeldMembers();console.log('[membercsv159] finish '+engine+' '+width+' passed='+results.at(-1).passed+' '+new Date().toISOString());await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
for(const[p,h]of Object.entries(held))assert.equal(sha(await readFile('../'+p)),h);
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/generation174_harness_repair',operator:'/root when actually executed',scope:'Isolated V15r1 two-file5313 preview,54contexts:3engines320/1280 x normal,no-op,refused,two-saves,caught clonefault,initial profileGETretry,CSV replacement after profile detached while background ownerGET held,and programmatic route/account expiry. OwnCSVApply refresh baseline and one accepted-profile finalClose followup only. Allwrites local; supportingGET RAM8031. No actual Next because result profile ids empty. Not whole159.',source_sha256:held,candidate_sha256:candidate,test_sha256:sha(await readFile(new URL(import.meta.url))),smoke,results},null,2)+'\n');
assert.equal(results.length,smoke?1:54);assert.ok(results.every(r=>r.passed),'MemberCSV result profile must refresh underlying Members list after accepted edit');
