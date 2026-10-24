import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const width of [320,390,1280])for(const action of ['call','comment','alias','designation','details']){
  const page=await browser.newPage({viewport:{width,height:850}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const id='11111111-1111-1111-1111-111111111111';
  const profile={member:{id,canonical_name:'Dr Recovery Example',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[],revision:'one'},today:'2026-10-21',current_call_level:'2ND_CALL',can_manage:true,call_history:[],comments:[],postings:[],leaves:[],imports:[],statistics:{official_duties:0,hours24:0,weekend_duties:0}};
  let writes=0,failRead=false,gets=0;
  const values={call:{call_level:'3RD_CALL',effective_from:'2026-11-01',reason:'Approved promotion'},comment:{body:'Confirmed comment'},alias:{alias:'Confirmed Alias'},designation:{designation:'Consultant',effective_from:'2026-11-01'},details:{name:'Dr Confirmed Name',status:'historical'}}[action];
  const expected={call:{call_level:'3RD_CALL',effective_from:'2026-11-01',reason:'Approved promotion'},comment:{body:'Confirmed comment'},alias:{alias:'Confirmed Alias',source:'unit_import_resolution'},designation:{designation:'Consultant',effective_from:'2026-11-01',notes:null},details:{revision:'one',canonical_name:'Dr Confirmed Name',active_status:'historical',call_level:'2ND_CALL'}}[action];
  const expectedPath={call:`/api/v1/members/${id}/call-changes`,comment:`/api/v1/members/${id}/comments`,alias:`/api/v1/admin/members/${id}/aliases`,designation:`/api/v1/admin/members/${id}/designations`,details:`/api/v1/admin/members/${id}`}[action];
  await page.route('**/__profile_readback_review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="opener">Open member</button></body></html>'}));
  await page.route('**/api/v1/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   if(req.method()==='GET'){
    assert.equal(path,`/api/v1/members/${id}/profile`);gets++;
    return failRead?route.fulfill({status:503,json:{detail:'Profile refresh unavailable'}}):route.fulfill({json:profile});
   }
   writes++;assert.equal(writes,1,'Confirmed operation must never replay');
   assert.equal(req.method(),action==='details'?'PUT':'POST');assert.equal(path,expectedPath);assert.deepEqual(req.postDataJSON(),expected);
   if(action==='call'){
    profile.current_call_level='3RD_CALL';profile.call_history.push({id:'c',from:'2ND_CALL',to:'3RD_CALL',effective_from:values.effective_from,reason:values.reason,source:'manual',scheduled:true,recorded_at:'2026-10-21T10:00:00Z',author:'Review admin'});
   }else if(action==='comment')profile.comments.push({id:'c',body:values.body,role:'computer_admin',author:'Review admin',recorded_at:'2026-10-21T10:00:00Z'});
   else if(action==='alias')profile.member.aliases.push({alias:values.alias,source:'manual'});
   else if(action==='designation')profile.member.designations.push({designation:values.designation,effective_from:values.effective_from,effective_to:null,notes:null});
   else {profile.member.canonical_name=values.name;profile.member.active_status=values.status;}
   failRead=true;
   return route.fulfill({json:['call','comment'].includes(action)?profile:profile.member});
  });
  await page.goto(base+'/__profile_readback_review');
  await page.evaluate(async id=>{const {openMemberProfile}=await import('/src/member-profile.ts');document.querySelector('#opener').onclick=()=>openMemberProfile(id,'computer_admin',async()=>{});},id);
  await page.locator('#opener').click();
  const dialog=page.locator('#member-profile-dialog'),form=dialog.locator(`[data-profile-form="${action}"]`);
  if(action==='details')await dialog.locator('summary').filter({hasText:'Edit Member Details'}).click();
  for(const [name,value] of Object.entries(values)){
   const field=form.locator(`[name="${name}"]`);
   if(await field.evaluate(el=>el.tagName==='SELECT'))await field.selectOption(value);else await field.fill(value);
  }
  const sibling=action==='comment'?'alias':'comment';
  const siblingField=dialog.locator(`[data-profile-form="${sibling}"] [name="${sibling==='alias'?'alias':'body'}"]`);
  await siblingField.fill('Keep independent draft');
  await form.locator('button').click();
  await dialog.getByRole('button',{name:'Refresh profile',exact:true}).waitFor();
  await dialog.getByRole('status').filter({hasText:'Your change was saved, but the profile could not refresh.'}).waitFor();
  assert.equal(await form.locator('[name]').first().isDisabled(),true,'Confirmed fields cannot acquire an edit that refresh could discard');
  for(const [name,value] of Object.entries(values))assert.equal(await form.locator(`[name="${name}"]`).inputValue(),value);
  assert.equal(await siblingField.inputValue(),'Keep independent draft');
  assert.equal(await siblingField.isEnabled(),true);
  // Real Enter in a sibling input cannot submit another mutation while readback is unresolved.
  await siblingField.focus();if(sibling==='alias')await page.keyboard.press('Enter');
  assert.equal(writes,1);
  const retry=dialog.getByRole('button',{name:'Refresh profile',exact:true});
  await retry.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('[data-profile-refresh]') && !document.querySelector('[data-profile-refresh]').disabled);
  await dialog.getByRole('status').filter({hasText:'Your change was saved, but the profile could not refresh.'}).waitFor();
  assert.equal(writes,1);assert.equal(gets,3,'Manual retry reads once');
  assert.equal(await retry.evaluate(el=>el===document.activeElement),true,'Failed keyboard refresh restores retry focus');
  failRead=false;await retry.click();
  await dialog.getByRole('status').filter({hasText:'Saved. Member list and linked data refreshed.'}).waitFor();
  assert.equal(await dialog.locator('[data-profile-refresh]').count(),0);
  assert.equal(await form.locator('[name]').first().isEnabled(),true);
  assert.equal(await siblingField.inputValue(),'Keep independent draft');
  if(action==='comment')await dialog.getByText(values.body,{exact:true}).waitFor();
  if(action==='alias')await dialog.getByText(values.alias,{exact:true}).waitFor();
  if(action==='details')await dialog.getByRole('heading',{name:values.name,exact:true}).waitFor();
  if(action==='designation')await dialog.locator('strong').filter({hasText:values.designation}).waitFor();
  if(action==='call')await dialog.getByText(values.reason,{exact:true}).waitFor();
  assert.equal(writes,1);assert.equal(gets,4);assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  page.once('dialog',confirmation=>confirmation.accept());await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  results.push({width,action,exact_existing_payload:true,confirmed_saved_values_visible:true,saved_form_guarded:true,sibling_draft_preserved:true,retry_reads_only:true,mutation_count:1,backend_writes:0});
  await page.close();
 }
}finally{await browser.close();}
await writeFile('../docs/premium-ui/qa-profile-readback.json',JSON.stringify({results,scope:'Actual legacy profile component with all five mutation/readback responses intercepted. GET-only manual recovery; no real backend persistence or physical-device claim.'},null,2)+'\n');
console.log('Profile confirmed-save recovery: 15 responsive form/payload/readback workflows passed');
