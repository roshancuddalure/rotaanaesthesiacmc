// Authored diagnostic, not a product patch. All writes are local fixtures.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const sha=x=>createHash('sha256').update(x).digest('hex');
const base='http://127.0.0.1:5197',ram='http://127.0.0.1:8031';
const smoke=process.env.MEMBERCSV159_SMOKE==='1';
const report='../docs/premium-ui/qa-original159-membercsv-result-profile-diagnostic'+(smoke?'-smoke':'')+'-20261110.json';
await assert.rejects(access(report),{code:'ENOENT'});
const held={
 'frontend/src/main.ts':'ebf67f1733f620e406054d0c4a82cf1c203fd0e6603a843eec45b25a1a09df4d',
 'frontend/src/member-workspace.ts':'506c486046fe6f0bbea5c6c4bf6357fec6e9649d91a9ed1ed890551ed3503cca',
 'frontend/src/services/api.ts':'5167f842eb4e07cf5216d18bde2ef48ded1a6692490d80dd261e4ceb038a5e3c',
 'frontend/src/premium-theme.css':'2e4f85d813061ebc9f696b92d50ae24717a7781a3688187d02c7339c00bea4a1',
 'frontend/src/styles.css':'306928f568686cfc453178f73731a797f7fe5b9f016d7128bf9cd68dc6e1fb86'
};
for(const[p,h]of Object.entries(held)){
 assert.equal(sha(await readFile('../'+p)),h,p);
 const response=await fetch(base+'/src/'+p.slice('frontend/src/'.length));assert.equal(response.status,200);
 const text=await response.text();
 if(p.endsWith('.ts')){const m=text.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(m);assert.ok(JSON.parse(Buffer.from(m[1],'base64').toString()).sourcesContent.some(s=>sha(s)===h));}
 else{const m=text.match(/const __vite__css = ("(?:[^"\\]|\\.)*")/);assert.ok(m);assert.equal(sha(JSON.parse(m[1])),h);}
}
const results=[];
for(const[engine,launcher]of Object.entries(smoke?{chromium}:{chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of(smoke?[320]:[320,1280])){
  console.log('[membercsv159] start '+engine+' '+width+' '+new Date().toISOString());
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(15000);
  const requests=[],writes=[],errors=[];let memberReads=0,saved=false,applied=false,readsBeforeProfile=null,observed=null;
  const id='csv159-result-person';
  const member=()=>({id,canonical_name:saved?'Dr CSV Result Renamed NEW':'Dr CSV Result Original OLD',call_level:'2ND_CALL',active_status:'active',revision:saved?'two':'one',aliases:[],designations:[],call_level_changes:[]});
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
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
    assert.equal(q.method(),'PUT');assert.equal(p,'/api/v1/admin/member-workspace/'+id);assert.equal(saved,false);assert.equal(body.canonical_name,'Dr CSV Result Renamed NEW');assert.equal(body.preserve_previous_name,true);saved=true;return route.fulfill({json:member()});
   }
   if(p==='/api/v1/admin/members'){memberReads++;return route.fulfill({json:applied?[member()]:[]});}
   if(p==='/api/v1/admin/member-workspace/'+id)return route.fulfill({json:{member:member(),impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
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
   const profile=page.getByRole('dialog',{name:'Member profile',exact:true});await profile.locator('[data-edit]').click();
   await profile.locator('[data-field="canonical_name"]').fill('Dr CSV Result Renamed NEW');await profile.getByRole('button',{name:'Save changes',exact:true}).click();
   await profile.locator('[data-edit]').waitFor({state:'visible'});assert.equal(saved,true);assert.equal(await profile.locator('[data-field="canonical_name"]').inputValue(),member().canonical_name);
   await profile.getByRole('button',{name:'Close member profile',exact:true}).click();await profile.waitFor({state:'detached'});
   await importer.locator('[data-close]').click();await importer.waitFor({state:'detached'});
   // Expected correct behavior. Failure captures stale rendered names and GET counts.
   await page.waitForFunction(id=>[...document.querySelectorAll('#view-root [data-open-member]')].some(e=>e.dataset.openMember===id&&e.textContent==='Dr CSV Result Renamed NEW'),id,{timeout:3000});
   observed=await observe();assert.ok(observed.parentNames.includes(member().canonical_name));assert.equal(writes.length,2);assert.deepEqual(errors,[]);
   results.push({engine,width,passed:true,readsBeforeProfile,observed,writes,requests,errors});
  }catch(error){observed=await observe().catch(()=>null);results.push({engine,width,passed:false,assertion:error.message,readsBeforeProfile,observed,writes,requests,errors});}
  finally{console.log('[membercsv159] finish '+engine+' '+width+' passed='+results.at(-1).passed+' '+new Date().toISOString());await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
for(const[p,h]of Object.entries(held))assert.equal(sha(await readFile('../'+p)),h);
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),author:'/root/generation174_harness_repair',operator:'/root when actually executed',scope:'Actual Members → CSV file/preview/accepted Apply → result-member profile → accepted core rename → final profile/CSV close. Expected current underlying member identity; raw GET counts distinguish skipped refresh. All writes intercepted; otherwise only disposable RAM8031 GETs. No scheduling/backend changes. Smoke one Chromium320; full3engines320/1280.',source_sha256:held,test_sha256:sha(await readFile(new URL(import.meta.url))),smoke,results},null,2)+'\n');
assert.equal(results.length,smoke?1:6);assert.ok(results.every(r=>r.passed),'MemberCSV result profile must refresh underlying Members list after accepted edit');
