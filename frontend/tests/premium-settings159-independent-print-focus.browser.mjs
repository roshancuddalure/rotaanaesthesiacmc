import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
// Prepared independently; do not execute until root releases the browser slot.
const version=process.env.SETTINGS_REVIEW_VERSION||'v7',port=process.env.SETTINGS_REVIEW_PORT||'5287';
const folder=`../tmp/settings159-readback-regions-${version}`,report=`../docs/premium-ui/qa-settings159-${version}-independent-print-focus.json`;
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=['main.ts','unit-board-filters.ts','unit-settings-recovery.ts'];
const hashes=async prefix=>Object.fromEntries(await Promise.all(files.map(async name=>[name,sha(await readFile(prefix+'/'+name))])));
const candidate=await hashes(folder),applied=await hashes('src'),results=[];
assert.equal(applied['main.ts'],'d13bd73108d89d6efb70a66426e6f8e9f6e50400475575b7a40cb06eef12c1bc');
const unit={id:'independent-unit',name:'Royal Independent Unit',campus:'Main',code:'IND',minimum_free_people:1,active_status:'active',notes:null};
const other={...unit,id:'other-unit',name:'Excluded Other Unit',campus:'Other',code:'OTHER'};
const people=Array.from({length:106},(_,i)=>({id:'independent-person-'+i,canonical_name:'Independent person '+i,call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[],call_level_changes:[]}));
const ownRows=Array.from({length:103},(_,i)=>({id:'independent-posting-'+i,person:people[i],unit,posting_type:'2ND_CALL',starts_on:'2026-11-01',ends_on:'2026-11-30',source:'manual',notes:'Original '+i}));
const otherRows=Array.from({length:3},(_,i)=>({...ownRows[i],id:'other-posting-'+i,person:people[103+i],unit:other}));
const ids=async page=>page.locator('[data-unit-posting-body] [data-edit-operational-record]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-edit-operational-record')));
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();try{for(const width of[320,1280])for(const scenario of['print-event','print-media','notice-focus','newer-input-focus']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[],writes=[],requests=[];let reads=0,releaseSecond,secondStarted,releaseThird,thirdStarted;
  const secondPending=new Promise(r=>secondStarted=r),thirdPending=new Promise(r=>thirdStarted=r);
  page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','independent-readback');localStorage.setItem('duty_rota_working_month','2026-11');});
  await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url()),path=u.pathname;requests.push({method:q.method(),path});
   if(q.method()!=='GET'){
    assert.equal(q.method(),'PUT');assert.equal(path,'/api/v1/unit-management/units/independent-unit/settings');assert.equal(u.search,'?month=2026-11');
    assert.deepEqual(q.postDataJSON(),{minimum_free_people:2,call_minimums:[{call_level:'2ND_CALL',minimum_free_people:2}]});writes.push(q.postDataJSON());return route.fulfill({json:{...unit,minimum_free_people:2}});
   }
   if(path==='/api/v1/admin/members')return route.fulfill({json:people});
   if(path==='/api/v1/unit-management/month'){
    const attempt=++reads;if(attempt===2){secondStarted();await new Promise(r=>releaseSecond=r);}if(attempt===3){thirdStarted();await new Promise(r=>releaseThird=r);}
    const isFocus=scenario.endsWith('focus'),missing=isFocus&&attempt===2,fresh=attempt>1;
    const rows=missing?[]:fresh?ownRows.slice(0,87).map((row,i)=>({...row,notes:'Fresh '+i})):ownRows;
    return route.fulfill({json:{month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',units:missing?[other]:[{...unit,name:fresh?'Royal Independent Fresh':unit.name,minimum_free_people:fresh?2:1},other],assignments:[...rows,...otherRows],unit_summaries:[...(missing?[]:[{unit_id:unit.id,assigned_members:fresh?87:103,people_with_leave:0,leave_days:0,leave_by_call_level:{}}]),{unit_id:other.id,assigned_members:3,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:missing?[]:[{unit_id:unit.id,call_level:'2ND_CALL',assigned_members:fresh?87:103,minimum_free_people:fresh?2:1,max_allowed:fresh?87:103}],validation_issues:[]}});
   }
   return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031'+path+u.search,maxRetries:2})});
  });
  try{
   await page.goto(`http://127.0.0.1:${port}/#view=units`,{waitUntil:'domcontentloaded',timeout:60000});
   const search=page.locator('input[data-unit-board-search]'),campus=page.locator('select[data-unit-board-campus]');await search.fill('Royal');await campus.selectOption('campus:Main');
   await page.locator('[data-unit-board-card="unit:independent-unit"] button[data-open-unit-modal]').click();
   const modal=page.locator('#unit-management-modal'),form=modal.locator('#unit-settings-form'),input=form.locator('#unit-minimum-free-people'),call=form.locator('[data-unit-call-minimum="2ND_CALL"]'),save=form.locator('button[type=submit]');
   await form.evaluate(e=>{window.__indForm=e;window.__indFallback=e.querySelector('#unit-minimum-free-people');window.__indCall=e.querySelector('[data-unit-call-minimum]');window.__indSearch=document.querySelector('input[data-unit-board-search]');});
   await input.fill('2');await call.fill('2');await save.focus();await page.keyboard.press('Enter');await secondPending;await input.fill('3');
   if(scenario.startsWith('print-')){
    assert.deepEqual(await ids(page),ownRows.slice(0,50).map(x=>x.id));
    if(scenario==='print-event')await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));else await page.emulateMedia({media:'print'});
    assert.equal(await page.evaluate(()=>matchMedia('print').matches),scenario==='print-media');assert.deepEqual(await ids(page),ownRows.map(x=>x.id));releaseSecond();
    await form.getByText('Previous rules are saved and refreshed. New edits are not saved yet.',{exact:true}).waitFor();
    assert.deepEqual(await ids(page),ownRows.slice(0,87).map(x=>x.id));assert.equal(await page.locator('[data-unit-posting-body]').getByText('Fresh 86',{exact:true}).count(),1);assert.equal(await page.locator('[data-unit-posting-body]').getByText('Original 0',{exact:true}).count(),0);
    await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
    assert.deepEqual(await ids(page),ownRows.slice(0,50).map(x=>x.id));assert.equal(reads,2);
   }else{
    // Product establishes notice focusability by displacing an actually focused summary.
    await modal.locator('.unit-modal-validation > summary').focus();releaseSecond();
    const notice=modal.locator('[data-unit-readback-unavailable]'),retry=form.locator('[data-retry-unit-settings-read]');await notice.waitFor();await form.getByText(/Rules saved, but the refresh failed/).waitFor();
    assert.equal(await notice.evaluate(e=>e===document.activeElement),true);assert.equal(await input.evaluate(e=>e.validity.customError),true);
    await retry.focus();await page.keyboard.press('Enter');await thirdPending;
    if(scenario==='notice-focus'){await notice.focus();assert.equal(await notice.evaluate(e=>e===document.activeElement),true);}else{await input.focus();assert.equal(await input.evaluate(e=>e===document.activeElement),true);}
    releaseThird();await form.getByText('Previous rules are saved and refreshed. New edits are not saved yet.',{exact:true}).waitFor();
    assert.equal(await notice.count(),0);assert.equal(await input.evaluate(e=>e.validity.customError),false);
    const focusTarget=scenario==='notice-focus'?form.locator('[data-unit-settings-recovery] > [role=status]'):input;
    assert.equal(await focusTarget.evaluate(e=>e===document.activeElement),true);assert.equal(reads,3);
   }
   assert.equal(await form.evaluate(e=>e===window.__indForm&&e.querySelector('#unit-minimum-free-people')===window.__indFallback&&e.querySelector('[data-unit-call-minimum]')===window.__indCall),true);assert.equal(await input.inputValue(),'3');assert.equal(await call.inputValue(),'2');assert.equal(await modal.locator('#unit-modal-title').innerText(),'Royal Independent Fresh');assert.equal(writes.length,1);assert.deepEqual(errors,[]);
   await modal.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await search.evaluate(e=>e===window.__indSearch),true);assert.equal(await search.inputValue(),'Royal');assert.equal(await campus.inputValue(),'campus:Main');assert.equal(await page.locator('#working-month').inputValue(),'2026-11');
   assert.deepEqual(await ids(page),ownRows.slice(0,50).map(x=>x.id));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   // The normal posting table is intentionally hidden on phones. Test print at
   // the original width, then explicitly use desktop UI for its native pager.
   if(width===320)await page.setViewportSize({width:1280,height:900});
   await page.locator('[data-postings-page="1"]').click();assert.deepEqual(await ids(page),ownRows.slice(50,87).map(x=>x.id));assert.equal(await page.locator('[data-unit-posting-body]').getByText('Fresh 86',{exact:true}).count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   results.push({engine,width,scenario,reads,writes,errors,pagerNativeViewport:1280,phonePrintChecksPrecedeExplicitDesktopResize:width===320,exactFilteredFullPrintIds:scenario.startsWith('print-'),noticeFocusOwned:scenario==='notice-focus',newerInputFocusRetained:scenario==='newer-input-focus',normalFreshPageIds:ownRows.slice(50,87).map(x=>x.id)});console.log(engine+' '+width+' '+scenario+' independent passed');
  }finally{if(releaseSecond)releaseSecond();if(releaseThird)releaseThird();await page.emulateMedia({media:'screen'});await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(folder),candidate);assert.deepEqual(await hashes('src'),applied);assert.equal(results.length,24);
await writeFile(report,JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root/profile_parent_refresh_audit',scope:'Independent24actualscratchworkflows:3engines320/1280, beforeprint/mediafalse and printmediatrue with103matching+3excluded -> fresh87matching -> normal50+37 exactorderedIDs, nooldrows. Two legitimate focus paths establish missingnoticefocus via displacedvalidation summary, then returnedunit focuses currentstatus onlywhen noticeowned, or preservesnewerinputfocus. OnePUT and2/3GET, exactform/input/search nodes/draft/month/campus retained. Noappchanges/backendpersistence/physicalprinter/nativeAT claim.',candidate_sha256:candidate,applied_sha256:applied,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2)+'\n');console.log('Independent settings print/focus:24contexts passed');
