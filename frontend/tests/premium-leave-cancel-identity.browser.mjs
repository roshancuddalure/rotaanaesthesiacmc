// Full application shell; synthetic leave records and mutations never reach a backend.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const fixture='http://127.0.0.1:8032',out='../docs/premium-ui/qa-leave-cancel-identity';
const files=['src/main.ts','src/services/api.ts','src/ui.ts','src/premium-theme.css','src/styles.css'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async name=>['frontend/'+name,digest(await readFile(name))])));
const initial=await hashes(),testHash=digest(await readFile(new URL(import.meta.url))),results=[];
await mkdir(out,{recursive:true});
const format=value=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));
const label=value=>value.replace(/_/g,' ').toLowerCase().replace(/\b\w/g,char=>char.toUpperCase());
const status=value=>({approved:'Approved',requested:'Requested',imported_pending_review:'Imported, Pending Review'})[value]||label(value);

for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280])for(const scheme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:scheme,reducedMotion:'reduce'}),page=await context.newPage();
  const member={id:'leave-cancel-member',canonical_name:'Dr <img src=x onerror="window.leaveCancelInjected=true"> Long exact member name',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],call_level_changes:[]};
  const rows=[
   {id:'cross-month',leave_type:'annual_leave',leave_slot:'full_day',starts_on:'2026-10-29',ends_on:'2026-12-03',status:'approved'},
   {id:'overlap-two',leave_type:'CASUAL <img src=x>',leave_slot:'morning',starts_on:'2026-11-01',ends_on:'2026-11-08',status:'requested'},
   {id:'overlap-three',leave_type:'sick_leave',leave_slot:'afternoon',starts_on:'2026-11-01',ends_on:'2026-11-09',status:'imported_pending_review'}
  ].map(row=>({...row,person:member,days:3,source:'manual',raw_person_name:null,notes:null}));
  const before=structuredClone(rows),reads=[],writes=[],messages=[],errors=[],unexpected=[];
  let accepting=false,failNext=true,held=null;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',async dialog=>{assert.equal(dialog.type(),'confirm');messages.push(dialog.message());await(accepting?dialog.accept():dialog.dismiss());});
  await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','leave-cancel-identity');localStorage.setItem('duty_rota_working_month','2026-11');});
  await context.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;
   if(request.method()!=='GET'){
    writes.push({method:request.method(),path,body:request.postData()});
    if(held&&request.method()==='POST'&&path==='/api/v1/leave/requests/cross-month/cancel'&&request.postData()==='{}'){
     const operation=held;operation.arrived();await operation.gate;
     return operation.failure?route.fulfill({status:503,json:{detail:'Late cancellation synthetic failure'}}):route.fulfill({json:{...rows[0],status:'cancelled'}});
    }
    if(request.method()!=='POST'||path!=='/api/v1/leave/requests/overlap-two/cancel'||request.postData()!=='{}'){
     unexpected.push(writes.at(-1));return route.fulfill({status:400,json:{detail:'Unexpected mutation blocked by test'}});
    }
    if(failNext){failNext=false;return route.fulfill({status:503,json:{detail:'Cancellation temporarily unavailable'}});}
    rows[1].status='cancelled';return route.fulfill({json:rows[1]});
   }
   reads.push(path);
   if(path==='/api/v1/admin/members')return route.fulfill({json:[member]});
   if(path==='/api/v1/leave/requests')return route.fulfill({json:rows});
   if(path==='/api/v1/leave/calendar')return route.fulfill({json:{month:'2026-11',summary:{month:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30',total_requests:3,blocking_requests:1,people_on_leave:1,total_leave_days:9,busiest_day:null,status_counts:{},type_counts:{},slot_counts:{},unit_counts:{},call_level_counts:{}},days:{}}});
   if(path==='/api/v1/leave/pressure')return route.fulfill({json:{month:'2026-11',days:[],call_level_totals:{},unit_totals:{}}});
   return route.fulfill({response:await route.fetch({url:fixture+path+url.search})});
  });
  const activate=async locator=>{await locator.scrollIntoViewIfNeeded();await locator.focus();await page.keyboard.press('Enter');};
  const region=()=>width===320?page.locator('.card-list[aria-label="Leave this month"]:visible'):page.locator('section[aria-labelledby="leave-list-title"]:visible');
  const container=id=>region().locator(width===320?'article.leave-card':'tbody tr').filter({has:page.locator(`[data-cancel-leave="${id}"]`)});
  const openAction=async id=>{
   const row=container(id),menu=row.locator('details.row-menu');assert.equal(await row.count(),1,'Exactly one rendered responsive target');
   if(!await menu.evaluate(el=>el.open))await activate(menu.locator(':scope > summary'));
   const button=menu.locator(`[data-cancel-leave="${id}"]`);assert.equal(await button.isVisible(),true);return button;
  };
  const confirmText=row=>`Cancel leave for ${member.canonical_name}?\nFrom: ${format(row.starts_on)}\nUntil: ${format(row.ends_on)}\nCategory: ${label(row.leave_type)}\nSlot: ${label(row.leave_slot)}\nStatus: ${status(row.status)}\nRecord ID: ${row.id}\n\nHistory is retained. Existing duties remain assigned and may need review.`;
  try{
   await page.goto(base+'/#view=leave');await region().locator('[data-cancel-leave]').first().waitFor({state:'attached'});
   assert.equal(await region().locator('img').count(),0);assert.equal(await page.evaluate(()=>window.leaveCancelInjected),undefined);
   for(const row of rows){
    await activate(await openAction(row.id));assert.equal(messages.at(-1),confirmText(row));assert.equal(writes.length,0,'Declining confirmation never sends a mutation');
   }
   assert.equal(messages.length,3);const readsBeforeFailure=reads.filter(path=>path==='/api/v1/leave/requests').length;
   accepting=true;await activate(await openAction('overlap-two'));
   await page.getByText('Cancellation temporarily unavailable',{exact:true}).waitFor();await page.waitForLoadState('networkidle');
   assert.deepEqual(writes,[{method:'POST',path:'/api/v1/leave/requests/overlap-two/cancel',body:'{}'}]);
   assert.equal(reads.filter(path=>path==='/api/v1/leave/requests').length,readsBeforeFailure,'Failed cancellation does not refresh or replay');
   assert.deepEqual(rows,before,'Failure leaves all synthetic records unchanged');
   const retry=await openAction('overlap-two');assert.equal(await retry.isEnabled(),true,'Failed action is explicitly retryable');await activate(retry);
   await page.waitForFunction(()=>[...document.querySelectorAll('.leave-card,tr')].some(el=>el.textContent?.includes('Casual <Img Src=X>')&&el.textContent?.includes('Cancelled')));
   await page.waitForLoadState('networkidle');
   assert.deepEqual(writes,[{method:'POST',path:'/api/v1/leave/requests/overlap-two/cancel',body:'{}'},{method:'POST',path:'/api/v1/leave/requests/overlap-two/cancel',body:'{}'}]);
   assert.equal(reads.filter(path=>path==='/api/v1/leave/requests').length,readsBeforeFailure+1,'Successful cancellation performs existing GET refresh');
   assert.deepEqual(rows[0],before[0]);assert.deepEqual(rows[2],before[2]);assert.deepEqual(rows[1],{...before[1],status:'cancelled'});
   assert.equal(await region().locator('[data-cancel-leave="overlap-two"]').count(),0);
   for(const row of [rows[0],rows[2]])assert.ok((await container(row.id).innerText()).includes(status(row.status)),'Sibling status remains visible');
   assert.equal(messages.length,5);assert.equal(messages[3],confirmText(before[1]));assert.equal(messages[4],confirmText(before[1]));
   // Synthetic DOM corruption probes refusal; this is not an ordinary user interaction.
   const missing=await openAction('cross-month');await missing.evaluate(button=>button.dataset.cancelLeave='missing-target');await activate(region().locator('[data-cancel-leave="missing-target"]'));
   await page.getByText('This leave record is no longer available in this view. Refresh Leave before cancelling.',{exact:true}).waitFor();
   await page.waitForLoadState('networkidle');assert.equal(writes.length,2);assert.equal(messages.length,5,'Missing targets never guess identity or open confirmation');
   assert.equal(await region().locator('img').count(),0);assert.equal(await page.evaluate(()=>window.leaveCancelInjected),undefined);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
   const ownedMutations=structuredClone(writes),lateCases=[];
   for(const departure of ['members','signout'])for(const failure of [false,true]){
    // A new synthetic authenticated page isolates each ownership scenario; no sign-in POST is forwarded.
    await page.evaluate(()=>localStorage.setItem('duty_rota_auth_token','leave-cancel-identity'));
    await page.goto(base+`/?leave-cancel-case=${departure}-${failure?'failure':'success'}#view=leave`);await region().locator('[data-cancel-leave="cross-month"]').waitFor({state:'attached'});
    while(await page.locator('.toast-dismiss').count())await activate(page.locator('.toast-dismiss').first());
    let release,arrived;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>arrived=resolve);held={gate,arrived,failure};
    const count=writes.length;await activate(await openAction('cross-month'));
    let timeout;try{await Promise.race([started,new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('Held cancellation did not start')),15000))]);}finally{clearTimeout(timeout);}
    let input;
    if(departure==='members'){
     if(width===320){await activate(page.locator('#mobile-more'));await activate(page.locator('[data-mobile-more-view="members"]'));}
     else await activate(page.locator('.sidebar [data-view="members"]'));
     const panel=page.locator('#member-add-panel');await panel.waitFor();if(!await panel.evaluate(el=>el.open))await activate(panel.locator(':scope > summary'));
     const field=page.locator('#new-member-name');await field.fill('Private draft during leave cancellation');await field.focus();input=await field.elementHandle();
    }else{
     await activate(page.locator('#account-menu-button'));await activate(page.locator('#sign-out'));await page.getByLabel('Username',{exact:true}).waitFor();
    }
    const leaveReads=reads.filter(path=>path==='/api/v1/leave/requests').length;
    const completed=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/v1/leave/requests/cross-month/cancel');
    release();const response=await completed;assert.equal(response.status(),failure?503:200);assert.equal(await response.finished(),null);
    await page.evaluate(()=>new Promise(resolve=>setTimeout(()=>setTimeout(resolve,0),0)));await page.waitForLoadState('networkidle');held=null;
    assert.equal(writes.length,count+1,'Late completion never replays a mutation');assert.equal(reads.filter(path=>path==='/api/v1/leave/requests').length,leaveReads,'Departed view never refreshes Leave');
    assert.equal(await page.locator('.toast[data-message="Leave cancelled"],.toast[data-message="Late cancellation synthetic failure"]').count(),0,'Late result never adds stale feedback');
    if(departure==='members'){
     assert.equal(await input.evaluate(el=>el.isConnected&&el===document.activeElement),true,'New view draft and focus remain owned');
     assert.equal(await page.locator('#new-member-name').inputValue(),'Private draft during leave cancellation');
    }else{assert.equal(await page.getByLabel('Username',{exact:true}).isVisible(),true);assert.equal(await page.locator('#view-root').count(),0,'Late result cannot recreate authenticated shell');}
    lateCases.push({departure,response:failure?503:200,no_stale_toast:true,no_leave_refresh:true,new_view_or_login_preserved:true});
   }
   assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
   results.push({engine,width,scheme,passed:true,native_confirmation_text:messages.slice(0,3),declined_mutation_count:0,exact_mutations:ownedMutations,failed_mutation_not_automatically_replayed:true,explicit_same_target_retry:true,successful_get_refresh:true,sibling_records_unchanged:true,html_like_values_inert:true,synthetic_missing_target_refused:true,late_result_cases:lateCases,total_intercepted_mutations:writes.length,forwarded_mutation_requests:0,page_errors:errors});
  }catch(error){console.error({engine,width,scheme,messages,writes,unexpected,errors,body:(await page.locator('body').innerText()).slice(-2200)});throw error;}
  finally{await context.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);assert.equal(digest(await readFile(new URL(import.meta.url))),testHash);
await writeFile(out+'/report.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),target_url:base,test_sha256:testHash,source_sha256:initial,scope:'Actual fullshell Leave screen, native confirmation and keyboard row menus in three engines, two widths and themes. Synthetic overlapping and cross-month leave rows. GET requests not intercepted locally forward only to RAM fixture 8032. All mutations locally intercepted; exact existing POST {} contract. Missing-target refusal uses explicit synthetic DOM corruption. No backend enforcement, physical device, native prompt visual appearance or assistive technology certification.',whole_requirement_completion_proven:false,results},null,2)+'\n');
console.log(`Leave cancellation target identity: ${results.length} contexts passed`);
