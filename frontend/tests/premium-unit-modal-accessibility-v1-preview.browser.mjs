import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base='http://127.0.0.1:5212',api='http://127.0.0.1:8031';
const sha=b=>createHash('sha256').update(b).digest('hex');
const paths=['src/main.ts','src/shell-accessibility.ts','src/record-workspace.ts','src/member-workspace.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
const units=['a','b'].map((id,i)=>({id:'unit-'+id,name:i?'Southern Unit':'Royal Northern Department',campus:'Main',code:id,minimum_free_people:1,active_status:'active',notes:null}));
const person={id:'modal-person',canonical_name:'Dr Modal Person',call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]};
const assignments=units.map((unit,i)=>({id:'posting-'+i,person,unit,posting_type:'2ND_CALL',starts_on:'2026-05-01',ends_on:'2026-05-31',source:'unit_board',notes:null}));
const data={month:'2026-05',starts_on:'2026-05-01',ends_on:'2026-05-31',units,assignments,unit_summaries:units.map(unit=>({unit_id:unit.id,assigned_members:1,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]};
const refs={posting_type:[{key:'2ND_CALL',label:'Second call',active:true}],leave_type:[{key:'CL',label:'Casual leave',active:true}],leave_slot:[{key:'FULL_DAY',label:'Full day',active:true}],leave_status:[{key:'requested',label:'Requested',active:true}]};
const results=[];
const active=page=>page.evaluate(()=>{const e=document.activeElement;return{tag:e?.tagName,label:e?.getAttribute('aria-label'),text:e?.textContent?.trim().slice(0,90),insideUnit:!!e?.closest('#unit-management-modal'),insideNative:!!e?.closest('dialog[open]')};});
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],writes=[];let reads=0;
  try{
   page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-05-15T12:00:00Z'));
   await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','unit-modal-preview');localStorage.setItem('duty_rota_working_month','2026-05');});
   await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push({method:q.method(),path:u.pathname});return route.abort();}if(u.pathname.endsWith('/unit-management/month')){reads++;return route.fulfill({json:data});}if(u.pathname==='/api/v1/admin/members')return route.fulfill({json:[person]});if(u.pathname==='/api/v1/normalization/units')return route.fulfill({json:units});if(u.pathname.includes('/normalization/catalog/')){const key=u.pathname.split('/').at(-1);return route.fulfill({json:refs[key]??[]});}if(u.pathname.includes('/admin/member-workspace/'))return route.fulfill({status:503,json:{detail:'Read-only profile unavailable fixture'}});return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});});
   await page.goto(base+'/#view=units');const manage=page.locator('[data-unit-board-card="unit:unit-a"]').getByRole('button',{name:'Manage '+units[0].name,exact:true});await manage.waitFor();await page.waitForLoadState('networkidle');
   await manage.focus();await page.keyboard.press('Enter');let modal=page.locator('#unit-management-modal');await modal.waitFor();
   await page.waitForFunction(()=>document.activeElement?.matches('#unit-management-modal [data-close-unit-modal]'));
   const keyboardInitial=await active(page),structure=await modal.evaluate(e=>({parent:e.parentElement.id,bodyChild:e.parentElement===document.body,appInert:document.querySelector('#app')?.inert,cardInert:document.querySelector('[data-unit-board-card="unit:unit-a"]')?.closest('[inert]')!==null}));
   assert.equal(structure.parent,'view-root');assert.equal(structure.appInert,false);assert.equal(structure.cardInert,true);
   const controls=modal.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary').filter({visible:true});
   await controls.last().focus();await page.keyboard.press('Tab');assert.equal(await controls.first().evaluate(e=>e===document.activeElement),true,'Forward Tab cycles inside unit');
   await controls.first().focus();await page.keyboard.press('Shift+Tab');assert.equal(await controls.last().evaluate(e=>e===document.activeElement),true,'Reverse Tab cycles inside unit');
   await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});assert.equal(await manage.evaluate(e=>e===document.activeElement),true);assert.equal(await manage.evaluate(e=>!!e.closest('[inert]')),false);
   await manage.click();await modal.waitFor();await page.waitForFunction(()=>document.activeElement?.matches('#unit-management-modal [data-close-unit-modal]'));const pointerInitial=await active(page);
   const beforeNavReads=reads;await modal.getByRole('button',{name:'Next unit',exact:true}).click();await modal.locator('#unit-modal-title').filter({hasText:units[1].name}).waitFor();assert.equal(reads,beforeNavReads);assert.equal((await active(page)).insideUnit,true);
   await modal.getByRole('button',{name:'Previous unit',exact:true}).click();await modal.locator('#unit-modal-title').filter({hasText:units[0].name}).waitFor();assert.equal(reads,beforeNavReads);await modal.locator('[data-close-unit-modal]').click();await modal.waitFor({state:'detached'});assert.equal(await manage.evaluate(e=>e===document.activeElement),true,'Navigation preserves original opener');
   await manage.click();await modal.waitFor();const add=modal.locator('[data-add-operational-record="units"]');await add.focus();await page.keyboard.press('Enter');const record=page.locator('dialog.record-workspace');await record.locator('[name=notes]').waitFor();assert.equal((await active(page)).insideNative,true);await page.keyboard.press('Escape');await record.waitFor({state:'detached'});assert.equal(await modal.isVisible(),true,'Native Escape owns only the native editor');assert.equal(await add.evaluate(e=>e===document.activeElement),true,'Native editor returns to exact unit control');
   const member=modal.locator('[data-open-member]').first();await member.focus();await page.keyboard.press('Enter');const profile=page.locator('dialog.member-workspace');await profile.getByText('Read-only profile unavailable fixture',{exact:false}).waitFor();assert.equal((await active(page)).insideNative,true);await page.keyboard.press('Escape');await profile.waitFor({state:'detached'});assert.equal(await modal.isVisible(),true);assert.equal(await member.evaluate(e=>e===document.activeElement),true,'Profile failure close retains native opener');
   await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});assert.equal(await manage.evaluate(e=>e===document.activeElement),true);
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);results.push({engine,width,keyboardInitial,pointerInitial,structure,tabForwardReverse:true,escapeClose:true,originalOpenerAfterNavigation:true,cachedNavigation:true,nativeRecordEscapeAndExactOpener:true,nativeProfileFailureEscapeAndExactOpener:true,delegatedControlsPreserved:true,noWrites:true,errors});console.log(engine+' '+width+' passed');
  }finally{await context.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-unit-modal-accessibility-v1-preview.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),test_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:initial,scope:'Scratch candidate actual app controller, three engines phone/desktop. Existing viewRoot mount and delegated controls preserved. Keyboard/pointer initial focus, actual Tab wraps, Escape, Prev/Next opener, native record/profile-failure ownership. All API writes rejected; reads only fixture/local RAM. No application-source change or item acceptance.',results},null,2)+'\n');console.log('Unit modal accessibility V1: '+results.length+' contexts passed');
