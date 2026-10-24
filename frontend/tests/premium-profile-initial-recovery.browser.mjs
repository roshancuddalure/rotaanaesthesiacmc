// Visible canonical profile initial GET recovery; read-only disposable fixture.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const probe=process.env.PROFILE_INITIAL_PROBE==='1',base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197',api='http://127.0.0.1:8032',out='../docs/premium-ui/qa-profile-initial-recovery';
const files=['src/member-workspace.ts','src/main.ts','src/workspace-load-state.ts','src/services/api.ts','src/styles.css','src/premium-theme.css'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>['frontend/'+f,createHash('sha256').update(await readFile(f)).digest('hex')])));
const source=await hashes(),scriptHash=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),results=[];await mkdir(out,{recursive:true});
const get=async path=>{const r=await fetch(api+path);assert.equal(r.status,200);return r.json();};
for(const[engine,type]of Object.entries(probe?{chromium}:{chromium,firefox,webkit})){
 const browser=await type.launch();try{for(const width of probe?[320]:[320,1280])for(const scheme of probe?['dark']:['light','dark'])for(const origin of probe?['members']:['members','leave']){
  const original=await get('/api/v1/admin/members'),member=original.find(m=>m.canonical_name===(origin==='members'?'Safe Member':'Blocked Member'));assert.ok(member);
  const path='/api/v1/admin/member-workspace/'+member.id,context=await browser.newContext({viewport:{width,height:844},colorScheme:scheme,reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[];
  let phase='held-initial',release,arrived;let gate=new Promise(r=>release=r),arrivedGate=new Promise(r=>arrived=r);
  const newGate=()=>{gate=new Promise(r=>release=r);arrivedGate=new Promise(r=>arrived=r);};
  page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','initial-profile-recovery');localStorage.setItem('duty_rota_working_month','2026-05');});
  await context.route('**/api/**',async route=>{
   const req=route.request(),u=new URL(req.url());assert.equal(req.method(),'GET','Initial recovery must never mutate');
   if(u.pathname===path){requests.push({path:u.pathname,phase});const currentPhase=phase;
    if(currentPhase.startsWith('held-')){arrived();await gate;}
    if(currentPhase==='failure'||currentPhase==='held-failure')return route.fulfill({status:503,json:{detail:'Synthetic initial profile refusal'}});
   }
   return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});
  });
  const dialog=page.getByRole('dialog',{name:'Member profile',exact:true});
  const activate=async locator=>{await locator.focus();await page.keyboard.press('Enter');};
  const waitHeld=async()=>{let t;try{await Promise.race([arrivedGate,new Promise((_,reject)=>t=setTimeout(()=>reject(Error('Initial profile GET did not arrive')),20000))]);}finally{clearTimeout(t);}};
  try{
   await page.goto(base+'/#view='+origin);const opener=page.locator(`[data-open-member="${member.id}"]:visible`).filter({hasText:member.canonical_name}).first();await opener.waitFor();await activate(opener);await waitHeld();await dialog.getByRole('status').waitFor();
   const loadingClose=dialog.getByRole('button',{name:/Close/});
   if(probe){const closeCount=await loadingClose.count();assert.equal(closeCount,0);await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});release();await page.waitForLoadState('networkidle');phase='failure';await activate(opener);await dialog.getByRole('alert').waitFor();const retryCount=await dialog.getByRole('button',{name:/Try again|Retry/}).count();assert.equal(retryCount,0);results.push({engine,width,scheme,origin,loading_close_controls:closeCount,failure_retry_controls:retryCount,observed:true,backend_mutations:0});continue;}
   assert.equal(await loadingClose.count(),1);const closeBox=await loadingClose.boundingBox();
   const closeStyle=await loadingClose.evaluate(el=>{const box=el.getBoundingClientRect(),style=getComputedStyle(el);return {minHeight:parseFloat(style.minHeight),minWidth:parseFloat(style.minWidth),hit:el===document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('button')};});
   assert.ok(closeBox.width>=43.99&&closeBox.height>=43.99&&closeStyle.minHeight>=44&&closeStyle.minWidth>=44&&closeStyle.hit,'Touch close target (0.01CSSpx floating-point tolerance): '+JSON.stringify({closeBox,closeStyle}));
   const axe=async()=>{const result=await new AxeBuilder({page}).include('dialog.member-workspace').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();assert.deepEqual(result.violations.map(v=>v.id),[]);};await axe();
   if(engine==='chromium'&&width===320&&scheme==='dark'&&origin==='members')await page.screenshot({path:out+'/loading-320-dark.png'});
   await activate(loadingClose);await dialog.waitFor({state:'detached'});release();await page.waitForLoadState('networkidle');assert.equal(await dialog.count(),0);assert.equal(await opener.evaluate(el=>el===document.activeElement),true);
   phase='failure';await activate(opener);await dialog.getByRole('alert').filter({hasText:'Synthetic initial profile refusal'}).waitFor();const retry=dialog.getByRole('button',{name:'Try again',exact:true});await retry.waitFor();await axe();
   if(engine==='chromium'&&width===320&&scheme==='dark'&&origin==='members')await page.screenshot({path:out+'/failure-320-dark.png'});
   phase='held-failure';newGate();await activate(retry);await waitHeld();assert.equal(requests.length,3);await page.keyboard.press('Enter');assert.equal(requests.length,3,'Native repeat cannot duplicate retry');assert.equal(await dialog.getByRole('button',{name:/Close/}).count(),1);release();await dialog.getByRole('alert').filter({hasText:'Synthetic initial profile refusal'}).waitFor();
   phase='success';await activate(dialog.getByRole('button',{name:'Try again',exact:true}));await dialog.locator('[data-member-identity]').filter({hasText:member.canonical_name}).waitFor();const expectedTab=origin==='leave'?'leave':'overview';assert.equal(await dialog.locator(`[data-tab="${expectedTab}"]`).getAttribute('aria-selected'),'true');assert.equal(await dialog.locator('[data-edit]').count(),1);await activate(dialog.getByRole('button',{name:'Close member profile',exact:true}));await dialog.waitFor({state:'detached'});assert.equal(await opener.evaluate(el=>el===document.activeElement),true);
   phase='failure';await activate(opener);await dialog.getByRole('button',{name:'Try again',exact:true}).waitFor();phase='held-success';newGate();await activate(dialog.getByRole('button',{name:'Try again',exact:true}));await waitHeld();await activate(dialog.getByRole('button',{name:/Close/}));await dialog.waitFor({state:'detached'});release();await page.waitForLoadState('networkidle');assert.equal(await dialog.count(),0);assert.equal(await opener.evaluate(el=>el===document.activeElement),true);
   assert.equal(requests.length,6);assert.ok(requests.every(r=>r.path===path));assert.deepEqual(errors,[]);assert.deepEqual(await get('/api/v1/admin/members'),original);
   results.push({engine,width,scheme,origin,exact_member_gets:requests.length,pending_touch_close:true,close_geometry:closeBox,close_computed_minimums_and_hit:closeStyle,repeated_retry_guard:true,second_refusal_then_real_get_recovery:true,entry_tab_retained:expectedTab,late_completion_after_initial_and_retry_dismissal_ignored:true,opener_focus_restored:true,tagged_loading_error_axe_findings:0,backend_mutations:0,passed:true});
  }catch(error){console.error({engine,width,scheme,origin,requests,errors,text:(await page.locator('body').innerText()).slice(-1500)});throw error;}
  finally{release();await page.waitForLoadState('networkidle').catch(()=>{});await context.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),source);assert.equal(createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),scriptHash);await writeFile(`${out}/${probe?'before':'report'}.json`,JSON.stringify({recorded_at_utc:new Date().toISOString(),target_url:base,test_sha256:scriptHash,scope:probe?'Actual app canonical profile initial loading lacks Close and initial failure lacks Retry. GET-only fixture.':'Canonical initial profile GET recovery via actual Members/Leave controls. Three engines,two widths,two themes; held close,503 retry/repeat/second failure,real GET same identity/tab,late dismissal focus and scoped axe. No mutations/all-role/native AT/physical certification.',source_sha256:source,whole_requirement_completion_proven:false,results},null,2)+'\n');console.log(`Profile initial recovery:${results.length} contexts complete`);
