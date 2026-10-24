import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

// Independent component review: actual native dialog and input/keyboard controls;
// requests are intercepted, and no persistent backend data is changed.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const browser=await chromium.launch({headless:true}),results=[];
try {
 for(const width of [320,390,1280]) {
  const page=await browser.newPage({viewport:{width,height:850}});
  page.setDefaultTimeout(10000);
  const id='11111111-1111-1111-1111-111111111111';
  const profile={member:{id,canonical_name:'Dr Draft Example',active_status:'active',call_level:'2ND_CALL',aliases:[],designations:[]},today:'2026-10-21',current_call_level:'2ND_CALL',can_manage:true,call_history:[],comments:[],postings:[],leaves:[],imports:[],statistics:{official_duties:0,hours24:0,weekend_duties:0}};
  const errors=[],writes=[];let releaseSave,saveStarted,failed=false,failReadback=false,profileReads=0;
  let saveStartedPromise=new Promise(resolve=>saveStarted=resolve);
  await page.route('**/__profile_draft_review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="opener">Open member</button><input id="next-edit" aria-label="Next edit"></body></html>'}));
  await page.route('**/api/v1/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()==='GET'&&url.pathname===`/api/v1/members/${id}/profile`) {
    profileReads++;
    return failReadback?route.fulfill({status:503,json:{detail:'Readback temporarily unavailable'}}):route.fulfill({json:profile});
   }
   if(request.method()==='POST'&&url.pathname===`/api/v1/members/${id}/comments`) {
    writes.push(request.postDataJSON());saveStarted();
    await new Promise(resolve=>releaseSave=resolve);
    if(failed)return route.fulfill({status:503,json:{detail:'Review service temporarily unavailable'}});
    profile.comments.push({id:'c'+writes.length,author:'Review admin',role:'computer_admin',body:request.postDataJSON().body,recorded_at:'2026-10-21T10:00:00Z'});
    return route.fulfill({json:profile});
   }
   throw new Error(`Unexpected API request ${request.method()} ${url.pathname}`);
  });
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/__profile_draft_review');
  await page.evaluate(async id=>{
   const {openMemberProfile}=await import('/src/member-profile.ts');
   document.querySelector('#opener').onclick=()=>openMemberProfile(id,'computer_admin',async()=>{});
  },id);
  const dialog=page.locator('#member-profile-dialog');
  const form=name=>dialog.locator(`[data-profile-form="${name}"]`);
  const beforeUnloadPrevented=()=>page.evaluate(()=>{
   const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;
  });
  // Pristine initial values, including preselected call level/date, are not dirty.
  await page.locator('#opener').click();await form('comment').waitFor();
  assert.equal(await beforeUnloadPrevented(),false);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  assert.equal(await page.locator('#opener').evaluate(el=>el===document.activeElement),true);
  // Returning an edit to its initial value removes dirty state.
  await page.locator('#opener').click();await form('comment').waitFor();
  await form('comment').locator('textarea').fill('Temporary draft');
  assert.equal(await beforeUnloadPrevented(),true);
  await form('comment').locator('textarea').fill('');
  assert.equal(await beforeUnloadPrevented(),false);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'detached'});
  // Both pointer Close and Escape offer a cancellable discard decision.
  await page.locator('#opener').click();await form('comment').waitFor();
  await form('comment').locator('textarea').fill('Keep this clinical draft');
  page.once('dialog',confirmation=>confirmation.dismiss());
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  assert.equal(await dialog.evaluate(el=>el.open),true);
  assert.equal(await form('comment').locator('textarea').inputValue(),'Keep this clinical draft');
  page.once('dialog',confirmation=>confirmation.dismiss());await page.keyboard.press('Escape');
  assert.equal(await dialog.evaluate(el=>el.open),true);
  assert.equal(await form('comment').locator('textarea').inputValue(),'Keep this clinical draft');
  page.once('dialog',confirmation=>confirmation.accept());await page.keyboard.press('Escape');
  await dialog.waitFor({state:'detached'});assert.equal(await beforeUnloadPrevented(),false,'Removed dialogs release unload guard');
  // Pending save cannot close; successful independent save retains the sibling draft.
  await page.locator('#opener').click();await form('comment').waitFor();
  await form('alias').locator('input').fill('Unsaved sibling alias');
  await form('comment').locator('textarea').fill('Save just this comment');
  await form('comment').getByRole('button',{name:'Add Comment',exact:true}).click();await saveStartedPromise;
  await page.keyboard.press('Escape');assert.equal(await dialog.evaluate(el=>el.open),true);
  const close=dialog.getByRole('button',{name:'Close',exact:true});
  if(await close.isEnabled())await close.click();
  assert.equal(await dialog.evaluate(el=>el.open),true);
  assert.equal(await beforeUnloadPrevented(),true,'Pending mutation warns before unload');
  releaseSave();await form('comment').locator('fieldset:not([disabled])').waitFor();
  assert.equal(await form('comment').locator('textarea').inputValue(),'');
  assert.equal(await form('alias').locator('input').inputValue(),'Unsaved sibling alias');
  assert.deepEqual(writes,[{body:'Save just this comment'}]);
  assert.equal(await beforeUnloadPrevented(),true);
  await form('alias').locator('input').fill('');assert.equal(await beforeUnloadPrevented(),false,'Confirmed saved form and reverted sibling are clean');
  // Error retains submitted input and offers no automatic replay.
  failed=true;saveStartedPromise=new Promise(resolve=>saveStarted=resolve);
  await form('comment').locator('textarea').fill('Preserve failed submission');
  await form('comment').getByRole('button',{name:'Add Comment',exact:true}).click();await saveStartedPromise;
  releaseSave();await form('comment').locator('fieldset:not([disabled])').waitFor();
  assert.equal(await form('comment').locator('textarea').inputValue(),'Preserve failed submission');
  assert.equal(writes.length,2);
  page.once('dialog',confirmation=>confirmation.accept());await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await dialog.waitFor({state:'detached'});assert.equal(await beforeUnloadPrevented(),false);
  // Confirmed write plus failed readback offers GET-only recovery and locks the
  // already-saved form so subsequent text cannot be discarded by its reset.
  failed=false;
  await page.locator('#opener').click();await form('comment').waitFor();
  await form('alias').locator('input').fill('Sibling before readback failure');
  await form('comment').locator('textarea').fill('Confirmed comment, readback unavailable');
  saveStartedPromise=new Promise(resolve=>saveStarted=resolve);
  await form('comment').getByRole('button',{name:'Add Comment',exact:true}).click();await saveStartedPromise;
  failReadback=true;releaseSave();
  const retry=dialog.getByRole('button',{name:'Refresh profile',exact:true});await retry.waitFor();
  await page.waitForFunction(()=>!document.querySelector('[data-profile-refresh]')?.disabled);
  assert.equal(await form('comment').locator('textarea').isEnabled(),false,'Confirmed saved form cannot accept edits that readback would reset');
  assert.equal(await form('alias').locator('input').isEnabled(),true);
  await form('alias').locator('input').fill('Sibling edited during readback recovery');
  const readsBefore=profileReads,writesBefore=writes.length;
  await retry.click();
  await page.waitForFunction(()=>!document.querySelector('[data-profile-refresh]')?.disabled);
  assert.equal(profileReads,readsBefore+1);assert.equal(writes.length,writesBefore);
  assert.equal(await form('alias').locator('input').inputValue(),'Sibling edited during readback recovery');
  assert.equal(await retry.evaluate(el=>el===document.activeElement),true,'Failed readback restores keyboard focus to Refresh');
  failReadback=false;await page.keyboard.press('Enter');await form('comment').locator('fieldset:not([disabled])').waitFor();
  assert.equal(await dialog.locator('[data-profile-refresh]').count(),0);
  assert.equal(await form('comment').locator('textarea').inputValue(),'');
  assert.equal(await form('alias').locator('input').inputValue(),'Sibling edited during readback recovery');
  assert.equal(writes.length,writesBefore,'Refresh never replays the confirmed mutation');
  assert.equal(profile.comments.filter(comment=>comment.body==='Confirmed comment, readback unavailable').length,1);
  page.once('dialog',confirmation=>confirmation.accept());await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await dialog.waitFor({state:'detached'});assert.equal(await beforeUnloadPrevented(),false);
  assert.deepEqual(errors,[]);
  results.push({width,pristine_and_reverted_close:true,dirty_close_and_escape_decline_preserve:true,accepted_discard_and_cleanup:true,busy_close_rejected:true,independent_save_preserves_sibling:true,failed_save_preserves_input:true,confirmed_save_fields_locked_until_readback:true,get_only_repeated_readback_retry:true,new_sibling_edits_preserved_during_recovery:true,exact_comment_payload:true,beforeunload_cancellable_event_guard:true,automatic_replays:0,backend_writes:0});
  await page.close();
 }
} finally {await browser.close();}
await writeFile('../docs/premium-ui/qa-profile-draft-independent.json',JSON.stringify({results,scope:'Isolated actual legacy member-profile native dialog. Chromium viewport emulation; all mutation responses intercepted. beforeunload listener checked through cancellable event, not a claim about browser exit confirmation or physical hardware.'},null,2)+'\n');
console.log('Independent profile draft review: 3 responsive Close/Escape, busy, save/error, sibling-draft and cleanup workflows passed');
