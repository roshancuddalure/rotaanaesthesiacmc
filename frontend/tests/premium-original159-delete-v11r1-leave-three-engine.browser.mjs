import assert from 'node:assert/strict';
import {readFile, writeFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Prepared by specialist; root coordinates browser execution. Every write is
// fulfilled locally; no mutation can reach RAM or production services.
const sha = v => createHash('sha256').update(v).digest('hex');
const paths = ['main','member-workspace','admin-delete','services/api'];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async p => ['frontend/src/'+p+'.ts',sha(await readFile('src/'+p+'.ts'))])));
const initial = await hashes(), candidatePath = '../tmp/delete-parent-refresh-v11r1/main.ts', candidate = await readFile(candidatePath);
assert.equal(initial['frontend/src/main.ts'],'9f5359ad9e8014098bc12c8ed3f9e1c6b1a06d1a4f92797b7f9da24bfba6e6b8');
assert.equal(sha(candidate),'45743fb64260289e50526480572bf25e33d8dc1a69f83397286660a03951cfba');
const base='http://127.0.0.1:5303',report='../docs/premium-ui/qa-original159-delete-v11r1-leave-three-engine.json';
await assert.rejects(access(report),{code:'ENOENT'});
const served=await(await fetch(base+'/src/main.ts')).text(),encoded=served.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
assert.ok(encoded);assert.equal(sha(Buffer.from(JSON.parse(Buffer.from(encoded[1],'base64').toString()).sourcesContent[0])),sha(candidate));
const results=[];
for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){const browser=await launcher.launch();
const members=['target','other'].map((id,i)=>({id:'leave-delete-person-'+id,canonical_name:i?'Dr Unrelated Leave':'Dr Target Leave',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]}));
const records=members.map((person,i)=>({id:'leave-delete-'+(i?'other':'target'),person,person_id:person.id,leave_type:'ANNUAL_LEAVE',leave_slot:'FULL_DAY',starts_on:'2026-11-05',ends_on:'2026-11-05',status:'approved',days:1,source:'manual',notes:null}));
try{for(const width of[320,1280])for(const entry of['row','selected','month'])for(const failure of['none','requests503']){
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),requests=[],writes=[],errors=[];let deleted=false,failedRead=false;
 const reads={calendar:0,requests:0,pressure:0},selection=entry==='month'?{kind:'leave',month:'2026-11'}:{kind:'leave',ids:[records[0].id]},deletedCount=entry==='month'?2:1;
 const live=()=>deleted?(entry==='month'?[]:[records[1]]):records;
 const calendar=()=>({month:'2026-11',summary:{month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',total_requests:live().length,blocking_requests:live().length,people_on_leave:live().length,total_leave_days:live().length,busiest_day:live().length?{date:'2026-11-05',count:live().length}:null,status_counts:{approved:live().length},type_counts:{ANNUAL_LEAVE:live().length},slot_counts:{FULL_DAY:live().length},unit_counts:{},call_level_counts:{'2ND_CALL':live().length}},days:{'2026-11-05':live().map(r=>({person_id:r.person.id,person_name:r.person.canonical_name,status:r.status,leave_type:r.leave_type,leave_slot:r.leave_slot,unit:null,posting_type:null,call_level:'2ND_CALL'}))}});
 page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','leave-delete-local');localStorage.setItem('duty_rota_working_month','2026-11');});
 await page.route('**/api/**',async route=>{
  const q=route.request(),u=new URL(q.url()),p=u.pathname;requests.push({method:q.method(),path:p,search:u.search});
  if(q.method()!=='GET'){
   const body=q.postDataJSON();writes.push({method:q.method(),path:p,body});assert.equal(q.method(),'POST');
   if(p==='/api/v1/admin/delete/preview'){
    assert.deepEqual(body,selection);return route.fulfill({json:{kind:'leave',count:deletedCount,items:(entry==='month'?records:[records[0]]).map(r=>({id:r.id,label:r.person.canonical_name+' leave'})),blocked:[],effects:{},preview_token:'leave-delete-local-token',confirm_phrase:entry==='month'?'DELETE LEAVE NOVEMBER 2026':null}});
   }
   assert.equal(p,'/api/v1/admin/delete');assert.deepEqual(body,{...selection,preview_token:'leave-delete-local-token',...(entry==='month'?{confirm_phrase:'DELETE LEAVE NOVEMBER 2026'}:{})});deleted=true;return route.fulfill({json:{batch_id:'leave-delete-local-batch',deleted:deletedCount}});
  }
  if(p==='/api/v1/admin/members')return route.fulfill({json:members});
  if(p==='/api/v1/leave/calendar'){reads.calendar++;return route.fulfill({json:calendar()});}
  if(p==='/api/v1/leave/requests'){reads.requests++;if(deleted&&failure==='requests503'&&!failedRead){failedRead=true;return route.fulfill({status:503,json:{detail:'Confirmed deletion readback unavailable'}});}return route.fulfill({json:live()});}
  if(p==='/api/v1/leave/pressure'){reads.pressure++;return route.fulfill({json:{month:'2026-11',days:[{date:'2026-11-05',total_people:live().length,blocking_people:live().length}],call_level_totals:{'2ND_CALL':live().length},unit_totals:{}}});}
  return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+p+u.search,maxRetries:2})});
 });
 const visibleScope=()=>width===320?page.locator('section.card-list[aria-label="Leave this month"]:visible'):page.locator('section[aria-labelledby="leave-list-title"]:visible');
 const observe=()=>page.evaluate(()=>({dayList:document.querySelector('[data-leave-calendar-view="list"]')?.getAttribute('aria-pressed'),dayControlRetained:document.querySelector('[data-leave-calendar-view="list"]')===window.__leaveDeleteDayControl,pressureRetained:document.querySelector('.leave-pressure-details')===window.__leaveDeletePressure,pressureOpen:document.querySelector('.leave-pressure-details')?.open,selected:[...document.querySelectorAll('[data-admin-select="leave"]:checked')].map(e=>e.value),targetControls:document.querySelectorAll('[data-delete-leave="leave-delete-target"]').length,otherControls:document.querySelectorAll('[data-delete-leave="leave-delete-other"]').length,context:document.querySelector('[aria-label="Leave actions"] .page-toolbar__context')?.textContent}));
 const assertRetained=async(stage)=>{
  const o=await observe();assert.equal(o.dayList,'true',stage);assert.equal(o.dayControlRetained,true,stage);assert.equal(o.pressureRetained,true,stage);assert.equal(o.pressureOpen,true,stage);
  const expected=entry==='row'?['leave-delete-other']:[];assert.deepEqual([...new Set(o.selected)],expected,stage);
  const buttons=page.locator('[data-delete-selected="leave"]');for(const b of await buttons.all()){assert.equal(await b.isDisabled(),expected.length===0,stage);assert.match(await b.innerText(),expected.length?/\(1\)/:/\(0\)/);}
  return o;
 };
 try{
  await page.goto(base+'/#view=leave',{waitUntil:'domcontentloaded'});
  await visibleScope().locator('[data-delete-leave="leave-delete-target"]').waitFor({state:'attached'});
  await page.locator('[data-leave-calendar-view="list"]').click();await page.locator('.leave-pressure-details > summary').click();
  await page.locator('.leave-pressure-details').evaluate(e=>{window.__leaveDeletePressure=e;window.__leaveDeleteDayControl=document.querySelector('[data-leave-calendar-view="list"]');});
  // Row deletion must keep a genuinely unrelated selected ID. Selected deletion
  // deletes exactly its selected target; month deletion clears all selected IDs.
  const selectedId=entry==='selected'?'leave-delete-target':'leave-delete-other';
  await visibleScope().locator('[data-admin-select="leave"][value="'+selectedId+'"]').check();
  const before={...reads};
  if(entry==='row'){
   const target=visibleScope().locator(width===320?'article.leave-card':'tbody tr').filter({has:page.locator('[data-delete-leave="leave-delete-target"]')});
   await target.locator('details.row-menu > summary').click();await target.locator('[data-delete-leave="leave-delete-target"]').click();
  }else if(entry==='selected')await visibleScope().locator('[data-delete-selected="leave"]').click();
  else{await page.locator('[aria-label="Leave actions"] details.row-menu > summary').click();await page.locator('[data-delete-month="leave"]').click();}
  const dialog=page.locator('dialog.admin-delete');await dialog.locator('[data-delete]').filter({hasText:'Delete '+deletedCount+' leave'}).waitFor();
  if(entry==='month')await dialog.locator('[data-phrase]').fill('DELETE LEAVE NOVEMBER 2026');
  await dialog.locator('[data-delete]:enabled').click();await dialog.waitFor({state:'detached'});
  let failedObserved=null;
  if(failure!=='none'){
   const retry=page.locator('[data-profile-parent-refresh] [data-retry-profile-parent]');await retry.waitFor({state:'visible'});
   failedObserved=await assertRetained('failed readback');assert.equal(failedObserved.targetControls,2,'Last-known target remains visibly stale until successful read');assert.match(failedObserved.context,/2 leave records/);
   assert.match(await page.locator('[data-profile-parent-refresh]').innerText(),/Changes are saved, but this view could not refresh/);
   assert.equal(writes.filter(w=>w.path==='/api/v1/admin/delete').length,1);
   await retry.focus();await page.keyboard.press('Enter');
  }
  await page.locator('[data-profile-parent-refresh]').getByText('Saved changes are reflected in this view.',{exact:true}).waitFor();
  const observed=await assertRetained('successful readback');assert.equal(observed.targetControls,0);assert.equal(observed.otherControls,entry==='month'?0:2);assert.match(observed.context,new RegExp(entry==='month'?'0 leave records':'1 leave record'));
  assert.equal(await page.locator('#working-month').inputValue(),'2026-11');
  for(const key of Object.keys(reads))assert.equal(reads[key],before[key]+(failure==='none'?1:2),key+' read count');
  assert.equal(writes.length,2);assert.equal(writes.filter(w=>w.path==='/api/v1/admin/delete').length,1);assert.deepEqual(errors,[]);
  results.push({engine,width,entry,failure,passed:true,before,after:{...reads},observed,failedObserved,writes,requests,errors});
 }catch(error){results.push({engine,width,entry,failure,passed:false,assertion:error.message,observed:await observe().catch(()=>null),deleted,failedRead,reads:{...reads},writes,requests,errors});console.log(width,entry,failure,'Leave deletion failed:',error.message);}
 finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
}}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);assert.equal(sha(await readFile(candidatePath)),sha(candidate));
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root',author:'/root/delete159_groundwork',application_changed:false,candidate_sha256:sha(candidate),source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),scope:'36 three-engine candidate contexts: real Leave row/card, selected and month delete at320/1280, normal and one post-confirm requestsGET503 with keyboard GET-only retry. Two actual leave identities; row deletion preserves unrelated selected ID, selected deletes precisely selected target, month legitimately clears both. Day list control and pressure disclosure nodes/open state retained. Both existing POSTs local; remaining GETs RAM8031 only. No browser execution by author.',limits:['Chromium only; no Firefox/WebKit/physical-device/native AT claim.','503 injected only in requests endpoint; malformed/wrong-month/calendar/pressure failure and route/month/account races are separate.','Readback replaces record rows by design; identity assertions cover surviving Day list control and pressure container, not deleted record controls.','This test does not establish all original159 mutation families or broader Leave approval/cancellation behavior.'],results},null,2)+'\n');
assert.equal(results.length,36);assert.ok(results.every(r=>r.passed),'All Leave deletion contexts must meet actual retention/recovery assertions');
