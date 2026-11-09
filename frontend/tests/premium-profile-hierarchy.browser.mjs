import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';

// Actual profile exports. Every API response and clipboard write is local to this fixture.
const base=process.env.MEMBER_TEST_URL||'http://127.0.0.1:5197';
const paths=['frontend/src/member-profile.ts','frontend/src/member-workspace.ts','frontend/src/member-presentation.ts','frontend/src/services/api.ts','frontend/src/ui.ts','frontend/src/styles.css','frontend/src/premium-theme.css','frontend/src/audit-time.ts'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,digest(await readFile('../'+path))])));
const initial=await hashes(),testSha=digest(await readFile(new URL(import.meta.url))),results=[];
const long='LongUnbrokenIdentity'.repeat(12),unsafe='<img src=x onerror="window.__injected=1">';
const designation=(id,name,from,to=null)=>({id,designation:name,effective_from:from,effective_to:to,source:'Returned source '+id,notes:'Essential notes '+id+' '+unsafe});
function fixture(kind,legacy){
 const date=legacy?'2026-09-15':'2026-10-24';
 const mixed=[designation('future','Future position','2027-01-01'),designation('past','Past position','2020-01-01','2020-12-31'),designation('current','Current position','2025-01-01'),designation('starts','Starts today',date),designation('invalid','Malformed position','2026-02-30'),designation('missing','Undated position',''),designation('reversed','Reversed position','2026-12-01','2026-01-01'),designation('tie','Same-date position',date),designation('ends','Ends today','2024-01-01',date)];
 const rows=kind==='mixed'?mixed:kind==='empty'?[]:kind==='future-only'?[mixed[0]]:kind==='past-only'?[mixed[1]]:[designation('current',kind==='long'?'Consultant '+unsafe+' '+long:'Consultant', '2025-01-01')];
 const today=kind==='invalid-context'?'2026-02-30':kind==='absent-context'?undefined:date;
 const label=kind==='invalid-context'||kind==='absent-context'?'Current designation not determined':kind==='mixed'?'Current position · Starts today · Same-date position · Ends today':kind==='empty'||kind==='future-only'||kind==='past-only'?'No designation recorded for this date':rows[0].designation;
 return {date,today,rows,label,member:{id:'hierarchy-'+kind,canonical_name:kind==='long'?'Dr '+long:'Dr Meera Raman',active_status:'active',call_level:'1ST_CALL',effective_call_level:'3RD_CALL',revision:'fixture-1',archived_at:null,aliases:[{id:'alias-one',alias:'Known alias',source:'Alias source'}],designations:rows,call_level_changes:[{id:'call-future',call_level:'5TH_CALL',effective_from:'2027-01-01',notes:'Essential future call note'}]}};
}
const calls=[{id:'kept',from:'2ND_CALL',to:'3RD_CALL',effective_from:'2026-09-01',scheduled:false,reason:'Essential returned call reason',author:'Returned author',source:'Returned call source',recorded_at:'2026-09-01T10:00:00Z'},{id:'future',from:'3RD_CALL',to:'4TH_CALL',effective_from:'2026-10-01',scheduled:true,reason:'Server scheduled although device date later',author:'Other author',source:'manual',recorded_at:'2026-09-01T10:00:00Z'}];
const roles=[{surface:'canonical',role:'admin',admin:true},{surface:'canonical',role:'view-only',admin:false},{surface:'legacy',role:'computer_admin',manage:true},{surface:'legacy',role:'hod',manage:true},{surface:'legacy',role:'rota_board_member',manage:false}];
async function activate(page,locator){await locator.focus();await page.keyboard.press('Enter');}
async function arrowEdge(page,locator,end){
 await locator.focus();const before=await locator.evaluate(n=>({top:n.scrollTop,max:n.scrollHeight-n.clientHeight}));
 const selector=await locator.evaluate(n=>n.hasAttribute('data-legacy-identity-region')?'[data-legacy-identity-region]':'[data-member-identity-region]');
 await page.keyboard.press(end?'ArrowDown':'ArrowUp');
 if(end?before.top<before.max-2:before.top>1)await page.waitForFunction(({selector,end,top})=>{const n=document.querySelector(selector);return end?n.scrollTop>top:n.scrollTop<top;},{selector,end,top:before.top});
 for(let i=0;i<140;i++){if(await locator.evaluate((n,end)=>end?n.scrollTop+n.clientHeight>=n.scrollHeight-2:n.scrollTop<=1,end))return;await page.keyboard.press(end?'ArrowDown':'ArrowUp');await page.waitForTimeout(65);}
 assert.fail('Native advertised arrows failed to reach full identity');
}
async function timeline(dialog,f,legacy){
 const rows=dialog.locator('[data-designation-timeline] > li');
 if(!f.rows.length){assert.equal(await rows.count(),0);return;}
 const expected=f.rows.map((row,index)=>({row,index})).sort((a,b)=>{const valid=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(new Date(v+'T00:00:00Z').getTime())&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;return valid(a.row.effective_from)&&valid(b.row.effective_from)?a.row.effective_from.localeCompare(b.row.effective_from)||a.index-b.index:valid(a.row.effective_from)?-1:valid(b.row.effective_from)?1:a.index-b.index;});
 assert.deepEqual(await rows.evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.designationHistoryIndex))),expected.map(e=>e.index),'Read-only sort preserves original editor identities and stable ties');
 for(const {row,index}of expected){
  const card=dialog.locator('[data-designation-history-index="'+index+'"]');assert.equal(await card.locator('h4').innerText(),row.designation||'Designation not recorded');assert.equal(await card.locator('[data-designation-notes]').innerText(),row.notes);
  const state=row.id==='invalid'||row.id==='reversed'?'Date range invalid':row.id==='missing'?'Date range not recorded':f.today===undefined||f.today==='2026-02-30'?'Comparison date not available':row.effective_from>f.date?'Scheduled dates':row.effective_to&&row.effective_to<f.date?'Ended':'Includes displayed date';
  assert.equal(await card.locator('.mw-designation-date-state').innerText(),state,row.id);
  const provenance=card.locator('details');assert.equal(await provenance.locator('summary').innerText(),'Record provenance');assert.equal(await provenance.evaluate(n=>n.open),false);await activate(dialog.page(),provenance.locator('summary'));assert.equal(await provenance.evaluate(n=>n.open),true);assert.match(await provenance.innerText(),new RegExp(row.id));await activate(dialog.page(),provenance.locator('summary'));
 }
 assert.match(await dialog.locator('[data-designation-date-context]').innerText(),f.today===undefined||f.today==='2026-02-30'?/Comparison date not available/:legacy?/returned by the system/:/on this device/);
}

for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch({headless:true});
 try{for(const config of[{width:320,height:480,scale:1},{width:1280,height:900,scale:1},{width:320,height:640,scale:2}]){
  const context=await browser.newContext({viewport:{width:config.width,height:config.height},locale:'en-GB',timezoneId:'Asia/Kolkata',reducedMotion:'reduce'}),page=await context.newPage(),cases=[],requests=[],errors=[];let f,role,profile;
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-10-24T06:30:00Z'));
  await page.route('**/__profile_hierarchy',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open profile</button></body></html>'}));
  await page.route('**/api/**',r=>{
   const q=r.request(),path=new URL(q.url()).pathname;requests.push({method:q.method(),path});assert.equal(q.method(),'GET','Hierarchy matrix is GET-only');
   if(path==='/api/v1/members/'+f.member.id+'/profile')return r.fulfill({json:profile});
   if(path==='/api/v1/admin/member-workspace/'+f.member.id)return r.fulfill({json:{member:f.member,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
   if(path==='/api/v1/admin/member-workspace/'+f.member.id+'/roles')return r.fulfill({json:{rows:[]}});
   assert.fail('Unexpected hierarchy request '+path);
  });
  await page.goto(base+'/__profile_hierarchy');if(config.scale===2)await page.addStyleTag({content:'html {font-size:200% !important}'});
  await page.evaluate(()=>{window.__copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>window.__copied.push(value)}});});
  for(role of roles)for(const kind of['normal','mixed','empty','future-only','past-only','long',...(role.surface==='legacy'?['invalid-context','absent-context']:[])]){
   const legacy=role.surface==='legacy';f=fixture(kind,legacy);const original=structuredClone(f.member);
   profile={member:f.member,...(f.today===undefined?{}:{today:f.today}),current_call_level:'3RD_CALL',can_manage:!!role.manage,call_history:calls,comments:[{id:'c',author:'HOD reviewer',role:'hod',body:'Role-limited comment',recorded_at:'2026-09-01T10:00:00Z'}],postings:[],leaves:[],imports:[{file:'Roster.csv',sheet:'Staff',row:12,recorded_at:'2026-09-01T10:00:00Z'}],statistics:{official_duties:0,hours24:0,weekend_duties:0}};
   await page.evaluate(({id,role,legacy,admin})=>{document.querySelector('#open').onclick=()=>legacy?import('/src/member-profile.ts').then(m=>m.openMemberProfile(id,role,async()=>{})):import('/src/member-workspace.ts').then(m=>m.openMemberWorkspace(id,admin,()=>{},[id],'overview'));},{id:f.member.id,role:role.role,legacy,admin:role.admin});
   await activate(page,page.locator('#open'));const dialog=page.getByRole('dialog',{name:legacy?'Department member profile':'Member profile',exact:true});
   const designationSelector=legacy?'[data-legacy-member-designation]':'[data-member-designation]',regionSelector=legacy?'[data-legacy-identity-region]':'[data-member-identity-region]';
   await dialog.locator(designationSelector).waitFor();assert.equal(await dialog.locator(designationSelector).innerText(),f.label);
   assert.equal(await dialog.locator(legacy?'[data-legacy-member-call]':'[data-member-call-identity]').innerText(),legacy?'3RD CALL':'3rd Call');
   const note=await dialog.locator(legacy?'[data-legacy-designation-context]':'[data-member-designation-context]').innerText();
   assert.match(note,kind==='invalid-context'||kind==='absent-context'?/Comparison date not available/:legacy?/15 Sept 2026 returned by the system/:/24 Oct 2026 on this device/);
   if(kind==='mixed')assert.match(note,/Multiple recorded positions match this date/);
   if(!legacy){assert.equal(await dialog.locator('[data-member-designation-summary] strong').innerText(),f.label);assert.equal(await dialog.locator('[data-member-designation-summary] p').innerText(),note);}
   const geometry=await dialog.evaluate((node,legacy)=>{
    const region=node.querySelector(legacy?'[data-legacy-identity-region]':'[data-member-identity-region]'),close=node.querySelector(legacy?'[data-profile-close]':'[data-close]'),r=region.getBoundingClientRect(),c=close.getBoundingClientRect(),panel=legacy?node:node.querySelector('.mw-content');
    const bounds=node.getBoundingClientRect(),header=node.querySelector(legacy?'.member-profile-header':'.mw-header').getBoundingClientRect();
    return {region:r.toJSON(),close:c.toJSON(),viewport:{width:innerWidth,height:innerHeight},dialog:bounds.toJSON(),panelHeight:legacy?Math.max(0,Math.min(bounds.bottom,innerHeight)-Math.max(header.bottom,bounds.top)):panel.clientHeight,regionHeight:region.clientHeight,regionScroll:region.scrollHeight,regionWidth:region.clientWidth,regionScrollWidth:region.scrollWidth};
   },legacy);
   assert.ok(geometry.region.right<=geometry.close.left+1);assert.ok(geometry.close.top>=-1&&geometry.close.bottom<=config.height+1);assert.ok(geometry.dialog.width<=config.width+1);assert.ok(geometry.regionScrollWidth<=geometry.regionWidth+2);assert.ok(geometry.panelHeight>=80);
   if(kind==='normal'&&config.scale===1){const visible=await dialog.evaluate((node,legacy)=>{const region=node.querySelector(legacy?'[data-legacy-identity-region]':'[data-member-identity-region]').getBoundingClientRect();return [...node.querySelectorAll(legacy?'[data-legacy-member-name],[data-legacy-member-designation],[data-legacy-active-status],[data-legacy-member-call]':'[data-member-identity],[data-member-designation],[data-member-active-status],[data-member-call-identity]')].every(n=>n.getBoundingClientRect().top>=region.top-1&&n.getBoundingClientRect().bottom<=region.bottom+1);},legacy);assert.equal(visible,true,'All four ordinary primary identity values initially visible');}
   if(kind==='long'){
    const region=dialog.locator(regionSelector);assert.equal(await region.getAttribute('tabindex'),'0');await arrowEdge(page,region,true);await arrowEdge(page,region,false);await page.keyboard.press('Tab');assert.equal(await dialog.locator(legacy?'[data-profile-close]':'[data-close]').evaluate(n=>n===document.activeElement),true);
   }
   if(legacy&&kind==='long'){
    const last=dialog.locator('details > summary').last();await dialog.locator('[data-profile-close]').focus();
    for(let i=0;i<160&&!(await last.evaluate(n=>n===document.activeElement));i++)await page.keyboard.press('Tab');
    assert.equal(await last.evaluate(n=>n===document.activeElement),true,'Native Tab reaches final disclosure after long identity');
    for(let i=0;i<40;i++){
     if(await last.evaluate(n=>{const r=n.getBoundingClientRect(),d=n.closest('dialog').getBoundingClientRect();return r.top>=d.top-1&&r.bottom<=Math.min(d.bottom,innerHeight)+1;}))break;
     await page.keyboard.press('ArrowDown');await page.waitForTimeout(65);
    }
    await page.waitForFunction(()=>{const nodes=document.querySelectorAll('#member-profile-dialog details > summary'),n=nodes[nodes.length-1],r=n.getBoundingClientRect(),d=n.closest('dialog').getBoundingClientRect();return r.top>=d.top-1&&r.bottom<=Math.min(d.bottom,innerHeight)+1;}).catch(async error=>{throw new Error(JSON.stringify({engine,...config,role:role.role,kind,last:await last.evaluate(n=>({rect:n.getBoundingClientRect().toJSON(),dialog:n.closest('dialog').getBoundingClientRect().toJSON(),focused:n===document.activeElement,scroll:n.closest('dialog').scrollTop,max:n.closest('dialog').scrollHeight-n.closest('dialog').clientHeight}))})+' '+error.message);});
   }
   if(legacy){
    const isAdmin=role.role==='computer_admin'||role.role==='superadmin';
    assert.equal(await dialog.locator('[data-profile-form="designation"]').count(),isAdmin?1:0);assert.equal(await dialog.locator('[data-profile-form="alias"]').count(),isAdmin?1:0);assert.equal(await dialog.locator('[data-profile-form="details"]').count(),isAdmin?1:0);assert.equal(await dialog.locator('[data-profile-form="comment"]').count(),role.manage?1:0);assert.equal(await dialog.locator('[data-profile-form="call"]').count(),role.manage?1:0);
    assert.equal(await dialog.getByText('Role-limited comment',{exact:true}).count(),role.manage?1:0);
    const call=dialog.locator('.member-timeline li').first();assert.match(await call.innerText(),/Essential returned call reason/);assert.equal(await call.locator('details').evaluate(n=>n.open),false);assert.equal(await call.locator('small').isVisible(),false);await activate(page,call.locator('summary'));assert.equal(await call.locator('small').isVisible(),true);await activate(page,call.locator('summary'));
    assert.match(await dialog.locator('.member-timeline li').nth(1).locator('strong').innerText(),/scheduled/,'Returned scheduled flag preserved despite device date');
   }else await activate(page,dialog.locator('[data-tab="roles"]'));
   await timeline(dialog,f,legacy);
   const editorNativeDates=[];
   if(!legacy&&role.admin&&kind==='mixed'){
    await activate(page,dialog.locator('[data-edit]'));
    for(let i=0;i<f.rows.length;i++){assert.equal(await dialog.locator('[data-d="'+i+'"][data-key="designation"]').inputValue(),f.rows[i].designation);const input=dialog.locator('[data-d="'+i+'"][data-key="effective_from"]');assert.equal(await input.getAttribute('value'),f.rows[i].effective_from,'Original returned raw date stays with original editor row');const native=await input.evaluate(n=>({value:n.value,valid:n.validity.valid,raw:n.getAttribute('value')}));if(f.rows[i].id!=='invalid')assert.equal(native.value,f.rows[i].effective_from);editorNativeDates.push({originalIndex:i,...native});}
    await activate(page,dialog.locator('[data-cancel-edit]'));
   }
   if(!legacy&&kind==='normal'){
    await activate(page,dialog.locator('[data-tab="details"]'));const identification=dialog.locator('[data-member-record-identification]');assert.equal(await identification.evaluate(n=>n.open),false);await activate(page,identification.locator('summary'));assert.equal(await identification.locator('[data-member-id]').inputValue(),f.member.id);await activate(page,identification.locator('[data-copy-member-id]'));assert.equal(await page.evaluate(()=>window.__copied.at(-1)),f.member.id,'Existing copy action invokes exact fixture clipboard contract');
   }
   assert.equal(await dialog.locator('img,script').count(),0);assert.deepEqual(f.member,original);
   await activate(page,dialog.locator(legacy?'[data-profile-close]':'[data-close]'));await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#open').evaluate(n=>n===document.activeElement),true);
   cases.push({surface:role.surface,role:role.role,canManage:role.manage,fixture:kind,label:f.label,comparisonDate:f.today??'absent',geometry,editorNativeDates,originalRecordsPreserved:true});
  }
  assert.deepEqual(errors,[]);results.push({engine,...config,clock:'2026-10-24T06:30:00Z',cases,requests,pageErrors:errors});console.log('Hierarchy passed '+engine+' '+JSON.stringify(config)+' '+cases.length+' workflows');await context.close();
 }}finally{await browser.close();}
}
assert.deepEqual(await hashes(),initial,'Application sources held');assert.equal(digest(await readFile(new URL(import.meta.url))),testSha,'Test source held');
await writeFile('../docs/premium-ui/qa-profile-hierarchy.json',JSON.stringify({recorded_at_utc:new Date().toISOString(),source_sha256:initial,test_sha256:testSha,scope:'Actual canonical and legacy profile exports; GET-only locally fulfilled fixture matrix, fixed device clock2026-10-24 vs legacy systemdate2026-09-15, invalid/absent system date without device fallback.3engines x3 viewport/rootfont contexts; native arrows, exact read-only timeline/editor identity, existing role guards and mocked clipboard invocation. No backend authorization, persistence, scheduling, physical devices or native AT certification.',results},null,2)+'\n');
console.log('Profile hierarchy: '+results.length+' contexts / '+results.reduce((n,r)=>n+r.cases.length,0)+' GET-only workflows passed');
