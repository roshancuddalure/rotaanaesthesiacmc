import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api='http://127.0.0.1:8032',out='../docs/premium-ui/qa-member-create-disclosure';
const files=['src/main.ts','src/styles.css','src/premium-theme.css','src/services/api.ts'];const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>['frontend/'+f,createHash('sha256').update(await readFile(f)).digest('hex')])));
const held=await hashes(),results=[];await mkdir(out,{recursive:true});
const get=async path=>{const r=await fetch(api+path);assert.equal(r.status,200);return r.json();};
for(const [engine,type]of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();try{for(const width of [320,390,768,769,1280]){
  const reset=await fetch(api+'/__equivalence/reset',{method:'POST'});assert.equal((await reset.json()).storage,'disposable-sqlite-memory');
  const original=await get('/api/v1/admin/members'),linked=await get('/__equivalence/import-state');
  const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],writes=[];
  let releaseSave,notifySaved;const saveHeld=new Promise(resolve=>releaseSave=resolve),saveObserved=new Promise(resolve=>notifySaved=resolve);
  page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','member-create-ui');localStorage.setItem('duty_rota_working_month','2026-05');});
  await context.route('**/api/**',async route=>{const r=route.request(),u=new URL(r.url());if(r.method()!=='GET'){assert.equal(r.method(),'POST');assert.equal(u.pathname,'/api/v1/admin/members');writes.push(r.postDataJSON());if(writes.length===1)return route.fulfill({status:503,json:{detail:'Synthetic create refusal; retry explicitly'}});}const response=await route.fetch({url:api+u.pathname+u.search});if(r.method()==='POST'){assert.equal(response.status(),200);notifySaved();await saveHeld;}return route.fulfill({response});});
  const panel=page.locator('#member-add-panel'),summary=panel.locator(':scope > summary'),input=page.locator('#new-member-name');
  const toggle=async()=>{await summary.focus();await page.keyboard.press('Enter');};
  try{
   await page.goto(base+'/#view=members');await panel.waitFor();await page.waitForLoadState('networkidle');const mobile=width<=768;
   assert.equal(await panel.evaluate(el=>el.open),!mobile);assert.equal(await input.isVisible(),!mobile);
   const firstTop=await page.locator(mobile?'#member-card-list':'#member-list').evaluate(el=>el.getBoundingClientRect().top+scrollY);
   if(mobile){
    for(const control of [summary,page.locator('#import-member-csv'),page.locator('.member-more > summary')]){const b=await control.boundingBox();assert.ok(b&&b.width>=44&&b.height>=44);assert.ok(b.x>=0&&b.x+b.width<=width+1);}
    await page.screenshot({path:`${out}/${engine}-${width}-initial.png`,fullPage:true});
    const enlarged=await page.addStyleTag({content:'.member-hub .member-actions {font-size:200% !important;} .member-hub .member-actions :is(button,summary,input) {font-size:inherit !important;line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important;}'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Enlarged spaced actions retain page bounds');
    for(const control of [summary,page.locator('#import-member-csv'),page.locator('.member-more > summary')]){const b=await control.boundingBox();assert.ok(b.width>=44&&b.height>=44&&b.x>=0&&b.x+b.width<=width+1);assert.equal(await control.evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1),true,'Enlarged action label is not clipped');}
    await enlarged.evaluate(el=>el.remove());await toggle();
    await page.setViewportSize({width:1280,height:844});assert.equal(await summary.isVisible(),true,'Focused disclosure remains visible after desktop resize');
    assert.equal(await summary.evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await input.evaluate(el=>el===document.activeElement),true);
    await page.setViewportSize({width,height:844});
   }
   const expandedTop=await page.locator(mobile?'#member-card-list':'#member-list').evaluate(el=>el.getBoundingClientRect().top+scrollY);
   const axe=await new AxeBuilder({page}).include('.member-actions').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[],'Expanded action group tagged accessibility findings');
   await input.fill('Private <draft> member');assert.equal(writes.length,0);
   await page.locator('#member-search').fill('Safe Member');await page.keyboard.press('Tab');assert.equal(await input.inputValue(),'Private <draft> member');
   if(!mobile)await page.setViewportSize({width:320,height:844});
   await toggle();assert.equal(await panel.evaluate(el=>el.open),false);await summary.getByText('Draft',{exact:true}).waitFor();assert.match(await summary.innerText(),/Draft/);assert.equal(writes.length,0);
   await page.evaluate(()=>{location.hash='view=overview';});await page.waitForFunction(()=>document.querySelector('#section-title')?.textContent?.trim()==='CMC Anaesthesia rota board');await page.waitForLoadState('networkidle');
   await page.evaluate(()=>{location.hash='view=members';});await panel.waitFor();assert.equal(await panel.evaluate(el=>el.open),false);await toggle();assert.equal(await input.inputValue(),'Private <draft> member');
   await page.setViewportSize({width,height:844});await input.fill('Synthetic New Arrival');const submit=page.locator('#create-member');await submit.focus();await page.keyboard.press('Enter');
   await page.getByRole('alert').filter({hasText:'Synthetic create refusal'}).waitFor();assert.equal(writes.length,1);assert.equal(await input.inputValue(),'Synthetic New Arrival');assert.equal((await get('/api/v1/admin/members')).length,4);
   await submit.focus();await page.keyboard.press('Enter');let deadline;try{await Promise.race([saveObserved,new Promise((_,reject)=>deadline=setTimeout(()=>reject(Error('Real save did not reach fixture')),20000))]);}finally{clearTimeout(deadline);}
   await page.locator('[data-member-status=all]').focus();await page.keyboard.press('Enter');const differentDraft=[390,769].includes(width);if(differentDraft)await input.fill('Different unsaved draft');releaseSave();await page.getByText('Member "Synthetic New Arrival" created',{exact:true}).waitFor();
   assert.equal(writes.length,2);assert.deepEqual(writes,[{canonical_name:'Synthetic New Arrival',active_status:'active'},{canonical_name:'Synthetic New Arrival',active_status:'active'}]);
   assert.equal(await input.inputValue(),differentDraft?'Different unsaved draft':'','Success clears only submitted draft, including recreated input');const saved=await get('/api/v1/admin/members');assert.equal(saved.length,5);assert.equal(saved.filter(r=>r.canonical_name==='Synthetic New Arrival').length,1);
   assert.deepEqual(saved.filter(r=>r.canonical_name!=='Synthetic New Arrival'),original,'Existing member records unchanged');
   const finalLinked=await get('/__equivalence/import-state');assert.deepEqual(finalLinked.leave,linked.leave);assert.deepEqual(finalLinked.postings,linked.postings);
   await page.reload();await panel.waitFor();if(!await panel.evaluate(el=>el.open))await toggle();assert.equal(await input.inputValue(),'');
   await input.fill('Private logout draft');await page.locator('#account-menu-button').focus();await page.keyboard.press('Enter');await page.locator('#sign-out').focus();await page.keyboard.press('Enter');
   await page.getByLabel('Username',{exact:true}).waitFor();assert.equal(await page.locator('#new-member-name').count(),0);assert.equal(await page.locator('body').getByText('Private logout draft',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage}).includes('Private logout draft')),false);
   assert.deepEqual(errors,[]);results.push({engine,width,firstTop,expandedTop,creation_height_saved:expandedTop-firstTop,initial_mobile_disclosure:true,tagged_action_group_axe_findings:0,draft_preserved_across_filters_and_routes:true,refusal_preserves_draft:true,explicit_retry_real_save_and_fresh_get:true,exact_request_bodies:true,save_viewport_width:width,successful_save_reconciles_rerendered_input:true,different_draft_preserved:differentDraft,existing_members_leave_postings_unchanged:true,logout_clears_private_surface:true,passed:true});
  }catch(error){console.error({engine,width,writes,errors,text:(await page.locator('body').innerText()).slice(-2500)});await page.screenshot({path:`${out}/failure-${engine}-${width}.png`}).catch(()=>{});throw error;}
  finally{releaseSave();await context.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),held);await writeFile(out+'/report.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),scope:'Real member creation on disposable RAM via unchanged UI form: compact mobile native disclosure, full-width editor,draft/filter/route preservation,503refusal/explicitretry,one actual saved newmember,independentGET,existinglinkedrecordpreservation andlogoutclear. Not everyduplicate/concurrency/role/nativeAT case.',source_sha256:held,whole_requirement_completion_proven:false,results},null,2)+'\n');
console.log('Member create disclosure:15 contexts passed');
