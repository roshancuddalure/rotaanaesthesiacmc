import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

// Completely intercepted APIs: persistence assertions use independent GET/reopen
// against an in-memory fixture, never the operational database.
const base = process.env.PREMIUM_TEST_URL || 'http://127.0.0.1:5197';
const browser = await chromium.launch({headless:true, ...(process.env.MEMBER_TEST_BROWSER ? {executablePath:process.env.MEMBER_TEST_BROWSER}: {})});
const results=[];
try {
  for(const width of [1280,390,320]) {
    const page=await browser.newPage({viewport:{width,height:850}});
    page.setDefaultTimeout(10000);
    const errors=[], requests=[], unexpected=[];
    page.on('pageerror',e=>errors.push(e.message));
    const fit=async dlg=>{
      const box=await dlg.evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth}));
      assert.ok(box.width<=width+1,JSON.stringify(box));
      assert.ok(box.scroll<=box.client+1,JSON.stringify(box));
    };
    const id='11111111-1111-1111-1111-111111111111';
    const profile={member:{id,canonical_name:'Dr Royal Example',active_status:'active',call_level:'2ND_CALL',revision:'v1',aliases:[],designations:[]},today:'2026-10-21',current_call_level:'2ND_CALL',can_manage:true,call_history:[],comments:[],postings:[],leaves:[],imports:[],statistics:{official_duties:0,hours24:0,weekend_duties:0}};
    const catalogs={leave_type:[{key:'ANNUAL_LEAVE',label:'Annual leave',aliases:[],active:true,version:1,behavior:{},usage:{records:0}}],leave_slot:[{key:'FULL_DAY',label:'Full day',active:true}],leave_status:[{key:'requested',label:'Requested',active:true}],posting_type:[{key:'2ND_CALL',label:'Second call',active:true}]};
    const units=[{id:'unit-1',name:'Royal Unit',code:'ROYAL',campus:'Main',active_status:'active',minimum_free_people:1,aliases:[],notes:'',revision:'u1',usage:{postings:1,duties:0,future_postings:1,future_duties:0,selected_members:3},call_minimums:[]}];
    const mappings=[],importSettings=[];
    let savedRecord, denyComment=false, holdComment=false, releaseComment;
    await page.route('**/__premium-member-actions',route=>route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="opener">Open</button></body></html>'}));
    await page.route('**/api/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
      const body=method==='GET'?undefined:req.headers()['content-type']?.includes('application/json')?req.postDataJSON():undefined;
      requests.push({path,method,body});
      if(path===`/api/v1/members/${id}/profile`) return route.fulfill({json:profile});
      if(path===`/api/v1/members/${id}/call-changes`) {
        profile.current_call_level=body.call_level;
        profile.call_history.push({id:'change',from:'2ND_CALL',to:body.call_level,effective_from:body.effective_from,reason:body.reason,source:'manual',scheduled:true,recorded_at:'2026-10-21T10:00:00Z',author:'Admin'});
        return route.fulfill({json:profile});
      }
      if(path===`/api/v1/members/${id}/comments`) {
        if(holdComment) await new Promise(resolve=>{releaseComment=resolve;});
        if(denyComment) return route.fulfill({status:503,json:{detail:'Comment service temporarily unavailable'}});
        profile.comments.push({id:'comment',body:body.body,role:'computer_admin',author:'Admin',recorded_at:'2026-10-21T10:00:00Z'});
        return route.fulfill({json:profile});
      }
      if(path===`/api/v1/admin/members/${id}/aliases`) {profile.member.aliases.push({alias:body.alias,source:body.source});return route.fulfill({json:profile.member});}
      if(path===`/api/v1/admin/members/${id}/designations`) {profile.member.designations.push(body);return route.fulfill({json:profile.member});}
      if(path===`/api/v1/admin/members/${id}` && method==='PUT') {Object.assign(profile.member,body);return route.fulfill({json:profile.member});}
      if(path==='/api/v1/admin/members') {
        if(method==='POST') {const created={...profile.member,...body,id:'new-member-id',aliases:[],designations:[]};return route.fulfill({json:created});}
        return route.fulfill({json:[profile.member]});
      }
      if(path==='/api/v1/normalization/members/resolve') return route.fulfill({json:{candidates:[]}});
      if(path==='/api/v1/admin/mappings') {mappings.push(body);return route.fulfill({json:body});}
      if(path==='/api/v1/normalization/activity') return route.fulfill({json:[{action:'reference_updated',operator:'Test Operator',created_at:'2026-10-21T10:00:00Z',details:{after:{label:'Historical label'}}}]});
      if(path===`/api/v1/admin/member-workspace/${id}`) {
        if(method==='PUT') {
          Object.assign(profile.member,body,{aliases:body.aliases.map(alias=>({alias,source:'manual'})),revision:'v2'});
          return route.fulfill({json:profile.member});
        }
        return route.fulfill({json:{member:profile.member,impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
      }
      if(path.startsWith(`/api/v1/admin/member-workspace/${id}/`)) return route.fulfill({json:{rows:[]}});
      if(path==='/api/v1/normalization/units/suggest-code') return route.fulfill({json:{code:'SUGGESTED_UNIT'}});
      if(path==='/api/v1/normalization/units' || path.startsWith('/api/v1/normalization/units/')) {
        if(method==='POST'||method==='PUT') {
          const value={...units[0],...body,id:method==='POST'?'unit-new':path.split('/').at(-1),revision:'u2',call_minimums:body.call_minimums.map(x=>[x.call_level,x.minimum_free_people])};
          const index=units.findIndex(x=>x.id===value.id);if(index<0)units.push(value);else units[index]=value;
          return route.fulfill({json:value});
        }
        return route.fulfill({json:units});
      }
      if(path==='/api/v1/import-review/columns') return route.fulfill({json:{headers:['member_name','unit_name','starts_on'],fields:['member_name','unit_name','starts_on'],suggested:{member_name:'member_name',unit_name:'unit_name',starts_on:'starts_on'}}});
      if(path==='/api/v1/import-review/units/preview') {
        const match=req.postDataBuffer().toString().match(/name="settings_json"\r\n\r\n([^\r]*)/);
        importSettings.push(JSON.parse(match?.[1]||'{}'));
        return route.fulfill({json:{id:'import-1',kind:'units',month:'2026-10',mode:'append',replacement_scope:[],rows:['Repeated','Repeated','Different'].map((label,i)=>({key:`CSV:${i+2}`,source:{sheet:'CSV',row:i+2},original:{member_name:label,unit_name:label},values:{member_name:label,unit_name:label,posting_type:'2ND_CALL',starts_on:'2026-10-22',ends_on:'2026-10-23'},after:{person_id:id,unit_id:'unit-1'},person_match:{reason:'Exact',candidates:[]},unit_match:{reason:'Exact',candidates:[]},issues:[],warnings:[],action:'create'}))}});
      }
      if(path==='/api/v1/import-review/import-1/apply') return route.fulfill({json:{created:2,updated:0,unchanged:0,excluded:body.excluded.length,removed:0,batch_id:'import-1'}});
      if(path.startsWith('/api/v1/normalization/catalog/')) {
        const [,kind,key]=path.match(/catalog\/([^/]+)(?:\/([^/]+))?$/)||[];
        if(method==='PUT') {
          const value={key,...body,version:2,usage:{records:0}};
          catalogs[kind]=[...(catalogs[kind]||[]).filter(x=>x.key!==key),value];
          return route.fulfill({json:value});
        }
        return route.fulfill({json:catalogs[kind]||[]});
      }
      if(path.endsWith('/records/leave/preview')) return route.fulfill({json:{before:null,after:body.values,review_token:'review-current',duties:[],availability:'Requested leave warns.'}});
      if(path.endsWith('/records/leave/save')) {savedRecord=body;return route.fulfill({json:{id:'saved',...body.values}});}
      unexpected.push(`${method} ${path}`);
      return route.fulfill({status:500,json:{detail:'Unexpected fixture request'}});
    });
    await page.goto(`${base}/__premium-member-actions`);
    await page.locator('#opener').focus();
    const openProfile=async(role='computer_admin')=>page.evaluate(async({id,role})=>{const {openMemberProfile}=await import('/src/member-profile.ts');await openMemberProfile(id,role,async()=>{});},{id,role});
    await openProfile();
    let dlg=page.locator('#member-profile-dialog');
    await fit(dlg);
    // All five profile submit controls: request payload, returned state and fresh GET.
    let form=dlg.locator('[data-profile-form="call"]');
    await form.locator('[name=call_level]').selectOption('3RD_CALL');
    await form.locator('[name=effective_from]').fill('2026-11-01');
    await form.locator('[name=reason]').fill('Approved promotion');
    await form.getByRole('button',{name:'Record Call Change',exact:true}).click();
    await dlg.getByText('Approved promotion',{exact:true}).waitFor();
    assert.deepEqual(requests.find(x=>x.path.endsWith('/call-changes')).body,{call_level:'3RD_CALL',effective_from:'2026-11-01',reason:'Approved promotion'});
    form=dlg.locator('[data-profile-form="designation"]');
    await form.locator('[name=designation]').fill('Senior Registrar');
    await form.locator('[name=effective_from]').fill('2026-11-01');
    await form.getByRole('button',{name:'Add Designation',exact:true}).click();
    await dlg.locator('strong').filter({hasText:'Senior Registrar'}).waitFor();
    form=dlg.locator('[data-profile-form="alias"]');
    await form.locator('[name=alias]').fill('Dr Example Alias');
    await form.getByRole('button',{name:'Add Alias',exact:true}).click();
    await dlg.getByText('Dr Example Alias',{exact:true}).waitFor();
    form=dlg.locator('[data-profile-form="comment"]');
    await form.locator('[name=body]').fill('Retained comment draft');
    denyComment=true;
    await form.getByRole('button',{name:'Add Comment',exact:true}).focus();
    await page.keyboard.press('Enter');
    await dlg.getByRole('status').filter({hasText:'Comment service temporarily unavailable'}).waitFor();
    assert.equal(await dlg.locator('[name=body]').inputValue(),'Retained comment draft');
    assert.equal(await dlg.getByRole('button',{name:'Add Comment',exact:true}).evaluate(el=>el===document.activeElement),true,'Failed keyboard submit restores its action rather than BODY');
    assert.equal(profile.comments.length,0);
    // A user who moves to another enabled control while saving keeps that
    // destination when the response arrives; the old submit action cannot steal focus.
    holdComment=true;
    await page.keyboard.press('Enter');
    await dlg.getByRole('status').filter({hasText:'Saving'}).waitFor();
    const historySummary=dlg.getByText('Unit Posting and Leave History',{exact:true});
    await historySummary.click();
    assert.equal(await historySummary.evaluate(el=>el===document.activeElement),true);
    const commentDeadline=Date.now()+1000;
    while(!releaseComment && Date.now()<commentDeadline) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(typeof releaseComment,'function','Delayed comment request must reach the intercepted endpoint');
    releaseComment();
    await dlg.getByRole('status').filter({hasText:'Comment service temporarily unavailable'}).waitFor();
    assert.equal(await dlg.getByText('Unit Posting and Leave History',{exact:true}).evaluate(el=>el===document.activeElement),true,'Async response must preserve the newer focus destination');
    assert.equal(await dlg.locator('[name=body]').inputValue(),'Retained comment draft');
    holdComment=false;
    denyComment=false;
    await dlg.getByRole('button',{name:'Add Comment',exact:true}).click();
    await dlg.getByText('Retained comment draft',{exact:true}).waitFor();
    await dlg.getByText('Edit Member Details',{exact:true}).click();
    form=dlg.locator('[data-profile-form="details"]');
    await form.locator('[name=name]').fill('Dr Saved Name');
    await form.locator('[name=status]').selectOption('historical');
    await form.getByRole('button',{name:'Save Member Details',exact:true}).click();
    await dlg.getByRole('heading',{name:'Dr Saved Name',exact:true}).waitFor();
    const fresh=await page.evaluate(async id=>(await fetch(`/api/v1/members/${id}/profile`)).json(),id);
    assert.equal(fresh.member.canonical_name,'Dr Saved Name');
    assert.equal(fresh.member.active_status,'historical');
    await dlg.locator('[data-profile-close]').click();
    await dlg.waitFor({state:'detached'});
    assert.equal(await page.locator('#member-profile-dialog').count(),0);
    assert.equal(await page.locator('#opener').evaluate(el=>el===document.activeElement),true);
    await openProfile();
    dlg=page.locator('#member-profile-dialog');
    assert.equal(await dlg.getByRole('heading',{name:'Dr Saved Name',exact:true}).count(),1);
    assert.equal(profile.member.designations[0].designation,'Senior Registrar');
    assert.equal(profile.comments.length,1);
    await dlg.locator('[data-profile-close]').click();
    await dlg.waitFor({state:'detached'});
    profile.can_manage=false;
    await openProfile('board_member');
    assert.equal(await page.locator('[data-profile-form]').count(),0);
    await page.locator('[data-profile-close]').click();
    await page.locator('#member-profile-dialog').waitFor({state:'detached'});
    profile.can_manage=true;
    results.push({width,scenario:'profile-five-actions-failure-recovery-reopen-role-gating',keyboard_failed_submit_focus:true,newer_focus_preserved:true,passed:true});

    // Workspace draft-row controls must change the intended collection and save
    // the actual selected values; removing rows never writes immediately.
    await page.evaluate(async id=>{const {openMemberWorkspace}=await import('/src/member-workspace.ts');await openMemberWorkspace(id,true,()=>{},[id]);},id);
    dlg=page.locator('dialog.member-workspace');
    await dlg.locator('[data-tab-link="names"]').click();
    assert.equal(await dlg.locator('[data-tab="names"]').getAttribute('aria-selected'),'true');
    await dlg.locator('[data-edit]').click();
    const writesBefore=requests.filter(x=>x.method==='PUT').length;
    await dlg.locator('[data-remove-alias]').first().click();
    assert.equal(await dlg.locator('[data-remove-alias]').count(),0);
    await dlg.locator('[data-tab="roles"]').click();
    await dlg.locator('[data-add-designation-row]').click();
    assert.equal(await dlg.locator('[data-remove-designation]').count(),2);
    await dlg.locator('[data-remove-designation="1"]').click();
    assert.equal(await dlg.locator('[data-remove-designation]').count(),1);
    await dlg.locator('[data-add-call-change]').click();
    await dlg.locator('[data-call-change="0"][data-key=call_level]').selectOption('4TH_CALL');
    await dlg.locator('[data-call-change="0"][data-key=effective_from]').fill('2026-12-01');
    await dlg.locator('[data-call-change="0"][data-key=notes]').fill('Reviewed dated change');
    await dlg.locator('[data-add-call-change]').click();
    await dlg.locator('[data-remove-call-change="1"]').click();
    assert.equal(await dlg.locator('[data-remove-call-change]').count(),1);
    assert.equal(requests.filter(x=>x.method==='PUT').length,writesBefore);
    await dlg.locator('[data-tab="details"]').click();
    await dlg.locator('[data-preserve-name]').uncheck();
    await dlg.getByRole('button',{name:'Save changes',exact:true}).click();
    await dlg.locator('[data-edit]').waitFor();
    await fit(dlg);
    const workspaceSave=requests.filter(x=>x.path===`/api/v1/admin/member-workspace/${id}` && x.method==='PUT').at(-1).body;
    assert.equal(workspaceSave.preserve_previous_name,false);
    assert.deepEqual(workspaceSave.aliases,[]);
    assert.deepEqual(workspaceSave.call_level_changes,[{call_level:'4TH_CALL',effective_from:'2026-12-01',notes:'Reviewed dated change'}]);
    await dlg.locator('[data-close]').click();
    await page.evaluate(async id=>{const {openMemberWorkspace}=await import('/src/member-workspace.ts');await openMemberWorkspace(id,true,()=>{},[id],'roles');},id);
    dlg=page.locator('dialog.member-workspace');
    assert.equal(await dlg.locator('[data-call-change-history="0"] time').getAttribute('datetime'),'2026-12-01');
    assert.match(await dlg.locator('[data-call-change-history="0"]').innerText(),/Reviewed dated change/);
    await dlg.locator('[data-edit]').click();
    assert.equal(await dlg.locator('[data-call-change="0"][data-key=effective_from]').inputValue(),'2026-12-01');
    await dlg.locator('[data-cancel-edit]').click();
    await dlg.locator('[data-close]').click();
    results.push({width,scenario:'workspace-add-remove-rows-preserve-name-exact-save-reopen',passed:true});

    // Reference select/filter/create/dirty-cancel contracts.
    await page.evaluate(async()=>{const {openReferenceCatalog}=await import('/src/reference-workspace.ts');await openReferenceCatalog(()=>{});});
    dlg=page.locator('dialog.reference-workspace');
    await dlg.locator('[data-search]').fill('missing');
    assert.equal(await dlg.locator('[data-key]:visible').count(),0);
    await dlg.locator('[data-search]').fill('Annual');
    await dlg.locator('[data-key="ANNUAL_LEAVE"]').click();
    assert.equal(await dlg.locator('[name=key]').inputValue(),'ANNUAL_LEAVE');
    assert.equal(await dlg.locator('[name=key]').getAttribute('readonly'),'');
    await dlg.locator('[data-new]').click();
    await dlg.locator('[name=key]').fill('STUDY_LEAVE');
    await dlg.locator('[name=label]').fill('Study leave');
    await dlg.locator('[name=aliases]').fill('SL\nStudy LV');
    await dlg.getByRole('button',{name:'Save reference',exact:true}).click();
    await dlg.locator('[data-key="STUDY_LEAVE"]').waitFor();
    await fit(dlg);
    assert.deepEqual(catalogs.leave_type.find(x=>x.key==='STUDY_LEAVE').aliases,['SL','Study LV']);
    await dlg.locator('[data-key="STUDY_LEAVE"]').click();
    await dlg.locator('[data-reference-history]').click();
    const activity=page.getByRole('dialog',{name:'Reference activity',exact:true});
    await activity.getByText('Historical label',{exact:true}).waitFor();
    assert.ok(requests.some(x=>x.path==='/api/v1/normalization/activity'));
    await activity.locator('[data-close]').click();
    await dlg.locator('[data-add-mapping]').click();
    assert.equal(await dlg.locator('[name=aliases]').evaluate(el=>el===document.activeElement),true);
    await page.evaluate(async()=>{const {openMappingCreator}=await import('/src/reference-workspace.ts');await openMappingCreator(()=>{});});
    const mapping=page.locator('dialog:has([name=mapping_type])');
    await mapping.locator('[name=mapping_type]').selectOption('unit_label');
    await mapping.locator('[name=target_key] option[value="unit-1"]').waitFor({state:'attached'});
    await mapping.locator('[data-find]').fill('missing');
    assert.equal(await mapping.locator('[name=target_key] option[value="unit-1"]').evaluate(el=>el.hidden),true);
    await mapping.locator('[data-find]').fill('Royal');
    await mapping.locator('[name=target_key]').selectOption('unit-1');
    await mapping.locator('[name=source_label]').fill('Imported royal');
    await mapping.locator('[name=notes]').fill('Reviewed destination');
    await mapping.getByRole('button',{name:'Save mapping',exact:true}).click();
    await mapping.waitFor({state:'detached'});
    assert.deepEqual(mappings[0],{mapping_type:'unit_label',source_label:'Imported royal',target_key:'unit-1',notes:'Reviewed destination',status:'reviewed',target_label:'Main Royal Unit'});
    const before=requests.filter(x=>x.method==='PUT').length;
    await dlg.locator('[name=label]').fill('Unsaved reference');
    page.once('dialog',d=>d.dismiss());
    await dlg.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await dlg.locator('[name=label]').inputValue(),'Unsaved reference');
    assert.equal(requests.filter(x=>x.method==='PUT').length,before);
    page.once('dialog',d=>d.accept());
    await dlg.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.locator('dialog[open]').count(),0);
    results.push({width,scenario:'reference-select-filter-create-dirty-cancel',passed:true});

    await page.evaluate(async()=>{const {openUnitRegistry}=await import('/src/reference-workspace.ts');await openUnitRegistry(()=>{});});
    dlg=page.locator('dialog.reference-workspace');
    await dlg.locator('[data-search]').fill('missing');
    assert.equal(await dlg.locator('[data-select-unit]:visible').count(),0);
    await dlg.locator('[data-search]').fill('Royal');
    await dlg.locator('[data-select-unit="unit-1"]').click();
    await dlg.locator('[data-unit-history]').click();
    await page.getByRole('dialog',{name:'Reference activity',exact:true}).getByText('Historical label',{exact:true}).waitFor();
    await page.getByRole('dialog',{name:'Reference activity',exact:true}).locator('[data-close]').click();
    await dlg.locator('[name=minimum_free_people]').fill('2');
    await dlg.getByText('Call-wise staffing minimums',{exact:true}).click();
    await dlg.locator('[data-call-minimum="2ND_CALL"]').fill('3');
    await dlg.locator('[name=aliases]').fill('Royal alternative');
    await dlg.locator('[name=notes]').fill('Reviewed staffing');
    await dlg.getByRole('button',{name:'Save unit',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-dirty]')?.textContent==='Saved details');
    assert.equal(units[0].minimum_free_people,2);
    assert.deepEqual(units[0].call_minimums,[['2ND_CALL',3]]);
    assert.equal(units[0].notes,'Reviewed staffing');
    await dlg.locator('[data-unit-status]').selectOption('archived');
    assert.equal(await dlg.locator('[data-select-unit]:visible').count(),0);
    await dlg.locator('[data-unit-status]').selectOption('active');
    await fit(dlg);
    assert.equal(await dlg.locator('[data-select-unit]:visible').count(),1);
    await dlg.locator('[data-unit-month]').fill('2026-11');
    await page.waitForFunction(()=>document.querySelector('[data-select-unit]')?.textContent.includes('2026-11'));
    await dlg.getByRole('button',{name:'Cancel',exact:true}).click();
    results.push({width,scenario:'unit-search-select-history-minimums-save-status-month',passed:true});

    await page.evaluate(async()=>{const {openOperationalImport}=await import('/src/operational-import.ts');await openOperationalImport('units','2026-10',()=>{},true);});
    dlg=page.getByRole('dialog',{name:/Import unitwise/});
    await dlg.locator('input[type=file]').setInputFiles({name:'units.csv',mimeType:'text/csv',buffer:Buffer.from('member_name,unit_name,starts_on\nRepeated,Repeated,2026-10-22\n')});
    await dlg.getByText('Check column mappings, then preview the records.',{exact:true}).waitFor();
    await dlg.getByRole('button',{name:'Preview and normalize',exact:true}).click();
    await dlg.locator('[data-repeat-member="CSV:2"]').waitFor();
    await fit(dlg);
    page.once('dialog',d=>d.dismiss());
    await dlg.locator('[data-repeat-member="CSV:2"]').click();
    await dlg.locator('[data-refresh]').click();
    await page.waitForFunction(()=>document.querySelector('[data-message]')?.textContent.includes('3 rows normalized'));
    assert.deepEqual(importSettings.at(-1).corrections,{});
    page.once('dialog',d=>d.accept());
    await dlg.locator('[data-repeat-member="CSV:2"]').click();
    await dlg.locator('[data-review-row="CSV:2"] .import-row__edit > summary').click();
    page.once('dialog',d=>d.accept());
    await dlg.locator('[data-repeat-unit="CSV:2"]').click();
    await dlg.locator('[data-refresh]').click();
    await page.waitForFunction(()=>document.querySelector('[data-message]')?.textContent.includes('3 rows normalized'));
    assert.deepEqual(importSettings.at(-1).corrections,{'CSV:2':{person_id:id,unit_id:'unit-1'},'CSV:3':{person_id:id,unit_id:'unit-1'}});
    await dlg.locator('[data-create-member="CSV:4"]').click();
    const creator=page.getByRole('dialog',{name:'Create department member',exact:true});
    await creator.locator('[name=canonical_name]').fill('Brand New Identity');
    await creator.locator('[name=call_level]').selectOption('3RD_CALL');
    await creator.getByRole('button',{name:'Create member',exact:true}).click();
    await creator.waitFor({state:'detached'});
    await dlg.locator('[data-refresh]').click();
    await page.waitForFunction(()=>document.querySelector('[data-message]')?.textContent.includes('3 rows normalized'));
    assert.equal(importSettings.at(-1).corrections['CSV:4'].person_id,'new-member-id');
    assert.equal(requests.filter(x=>x.path==='/api/v1/admin/members' && x.method==='POST').length,1);
    const [rowReport]=await Promise.all([page.waitForEvent('download'),dlg.locator('[data-report]').click()]);
    assert.equal(rowReport.suggestedFilename(),'units-normalization-report.csv');
    const rowContent=await readFile(await rowReport.path(),'utf8');
    assert.match(rowContent,/"sheet","row","name","action"/);
    assert.match(rowContent,/Repeated/);
    assert.match(rowContent,/Different/);
    await dlg.locator('[data-include="CSV:4"]').uncheck();
    await dlg.locator('[data-refresh]').click();
    await page.waitForFunction(()=>document.querySelector('[data-message]')?.textContent.includes('3 rows normalized'));
    await dlg.locator('[data-acknowledge]').check();
    page.once('dialog',d=>d.dismiss());
    await dlg.locator('[data-apply]').click();
    assert.equal(requests.filter(x=>x.path.endsWith('/import-1/apply')).length,0);
    page.once('dialog',d=>d.accept());
    await dlg.locator('[data-apply]').click();
    await dlg.getByRole('heading',{name:'Import complete',exact:true}).waitFor();
    assert.deepEqual(requests.find(x=>x.path.endsWith('/import-1/apply')).body,{excluded:['CSV:4'],acknowledge_warnings:true});
    const [completeReport]=await Promise.all([page.waitForEvent('download'),dlg.locator('[data-download-completed-report]').click()]);
    assert.match(await readFile(await completeReport.path(),'utf8'),/"Yes"/);
    page.once('dialog',d=>d.accept());
    await dlg.locator('[data-close]').click();
    results.push({width,scenario:'import-repeat-exact-label-cancel-create-inline-correction',passed:true});

    // Leave review is invalidated by editing, and cancel never saves.
    await page.evaluate(async id=>{const {openRecordEditor}=await import('/src/record-workspace.ts');await openRecordEditor('leave',id,undefined,true,()=>{},{starts_on:'2026-10-22',ends_on:'2026-10-23'});},id);
    dlg=page.locator('dialog.record-workspace');
    await dlg.getByRole('button',{name:'Review changes',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-save]')?.disabled===false);
    assert.equal(savedRecord,undefined);
    await dlg.locator('[name=notes]').fill('New notes invalidate preview');
    assert.equal(await dlg.locator('[data-save]').isDisabled(),true);
    await dlg.getByRole('button',{name:'Review changes',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-save]')?.disabled===false);
    await dlg.locator('[data-save]').click();
    await dlg.waitFor({state:'detached'});
    assert.equal(savedRecord.review_token,'review-current');
    assert.equal(savedRecord.values.notes,'New notes invalidate preview');
    assert.equal(savedRecord.values.person_id,id);
    assert.deepEqual(unexpected,[]);
    assert.deepEqual(errors,[]);
    results.push({width,scenario:'leave-review-invalidation-save-payload',passed:true});
    await page.close();
  }
  await mkdir('../docs/premium-ui',{recursive:true});
  await writeFile('../docs/premium-ui/member-actions-results.json',JSON.stringify({generated_at:new Date().toISOString(),fixture:'fully mocked; no production writes',results},null,2));
  console.log(`${results.length} member/profile/reference/record outcome workflows passed`);
} finally {await browser.close();}
