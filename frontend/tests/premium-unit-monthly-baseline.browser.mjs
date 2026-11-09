import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
const base='http://127.0.0.1:5197',api='http://127.0.0.1:8031';
const sha=b=>createHash('sha256').update(b).digest('hex');
const paths=['src/main.ts','src/styles.css','src/premium-theme.css','src/shell-accessibility.ts','src/services/api.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>['frontend/'+p,sha(await readFile(p))]))),initial=await hashes();
const units=['a','b','missing'].map((id,i)=>({id:'unit-'+id,name:i===0?'Royal Northern Department':i===1?'Southern Unit':'Unit With Missing Summary',campus:'Main',code:id,minimum_free_people:i===0?2:1,active_status:'active',notes:null}));
const people=Array.from({length:5},(_,i)=>({id:'person-'+i,canonical_name:'Dr Unit Person '+i,call_level:'2ND_CALL',active_status:'active',aliases:[],designations:[]}));
const assignment=(id,p,u,start='2026-05-01',end='2026-05-31')=>({id,person:people[p],unit:units[u],posting_type:'2ND_CALL',starts_on:start,ends_on:end,source:'unit_board',notes:null});
const assignments=[assignment('a0',0,0),assignment('a1',1,0,'2026-05-01','2026-05-15'),assignment('a2',1,0,'2026-05-16','2026-05-31'),assignment('a3',2,0),assignment('b0',3,1),assignment('missing0',4,2)];
const data={month:'2026-05',starts_on:'2026-05-01',ends_on:'2026-05-31',units,assignments,unit_summaries:[{unit_id:units[0].id,assigned_members:3,people_with_leave:3,leave_days:4,leave_by_call_level:{'2ND_CALL':4}},{unit_id:units[1].id,assigned_members:1,people_with_leave:0,leave_days:0,leave_by_call_level:{}}],unit_call_minimums:[{unit_id:units[0].id,call_level:'2ND_CALL',assigned_members:3,minimum_free_people:1,max_allowed:3}],validation_issues:[]};
const results=[];
const active=page=>page.evaluate(()=>{const e=document.activeElement;return{tag:e?.tagName,id:e?.id,label:e?.getAttribute('aria-label'),insideUnit:!!e?.closest('#unit-management-modal')};});
for(const[engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch();
 try{for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],writes=[];let reads=0;
  try{
   page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-05-15T12:00:00Z'));
   await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','unit-baseline');localStorage.setItem('duty_rota_working_month','2026-05');});
   await page.route('**/api/**',async route=>{const q=route.request(),u=new URL(q.url());if(q.method()!=='GET'){writes.push({method:q.method(),path:u.pathname});return route.abort();}if(u.pathname.endsWith('/unit-management/month')){reads++;return route.fulfill({json:data});}if(u.pathname.endsWith('/admin/members'))return route.fulfill({json:people});return route.fulfill({response:await route.fetch({url:api+u.pathname+u.search})});});
   await page.goto(base+'/#view=units');const manage=page.locator('[data-unit-board-card="unit:unit-a"]').getByRole('button',{name:'Manage '+units[0].name,exact:true});await manage.waitFor();await page.waitForLoadState('networkidle');
   const cards=await page.locator('.unit-availability').allTextContents();const missingCard=await page.locator('[data-unit-board-card="unit:unit-missing"] .unit-availability').innerText();
   await manage.focus();await page.keyboard.press('Enter');let modal=page.locator('#unit-management-modal');await modal.waitFor();
   const initialFocus=await active(page),structure=await modal.evaluate(e=>({parent:e.parentElement.id,bodyChild:e.parentElement===document.body,appInert:document.querySelector('#app')?.inert}));
   const targets=await modal.locator('.unit-modal-header-actions button').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect();return{label:e.getAttribute('aria-label'),width:b.width,height:b.height,disabled:e.disabled};}));
   const focusables=modal.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary');await focusables.last().focus();await page.keyboard.press('Tab');const forwardWrap=await active(page);await focusables.first().focus();await page.keyboard.press('Shift+Tab');const reverseWrap=await active(page);
   await modal.locator('[data-close-unit-modal]').focus();await page.keyboard.press('Escape');const escapeCloses=await modal.count()===0;
   if(!escapeCloses)await modal.locator('[data-close-unit-modal]').click();await modal.waitFor({state:'detached'});const firstReturn=await active(page);
   await manage.click();modal=page.locator('#unit-management-modal');await modal.waitFor();const pointerInitialFocus=await active(page);const beforeNavReads=reads;await modal.getByRole('button',{name:'Next unit',exact:true}).click();await modal.locator('#unit-modal-title').filter({hasText:units[1].name}).waitFor();const afterNext=await active(page);assert.equal(reads,beforeNavReads,'Native unit navigation uses existing loaded records');
   await modal.locator('[data-close-unit-modal]').click();await modal.waitFor({state:'detached'});const afterNavReturn=await active(page);
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);results.push({engine,width,cards,missingCard,initialFocus,pointerInitialFocus,structure,targets,forwardWrap,reverseWrap,escapeCloses,firstReturn,afterNext,afterNavReturn,noWrites:true,errors});
  }finally{await context.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial);
await writeFile('../docs/premium-ui/qa-unit-monthly-baseline.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,test_sha256:sha(await readFile(new URL(import.meta.url))),scope:'Read-only current-app diagnostic, not a pass claim. Monthly aggregate UI plus native unit modal targets/focus/Tab/Escape/navigation outcomes. Three engines320/1280. API GETs only local RAM or fixtures; no operational writes. Missing-summary unit is explicitly defensive.',fixture:data,results},null,2)+'\n');console.log('Unit baseline: '+results.length+' diagnostic contexts recorded');
