import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const response=(record=id,action='leave_created',next=null)=>({leave_id:record,record_present:true,
 events:[{id:'event-'+action,action,record_id:record,recorded_at:'2026-11-14T10:00:00+00:00',actor:{id:other,name:'Audit Operator'},
  before:{status:'requested',notes:'PRIVATE'},after:{status:'approved',notes:'PRIVATE'},reason:'Reviewed <reason>'}],
 sources:[{record_id:record,filename:'original<file>.csv',sheet:'Sheet1',row:2,batch_id:other,actor:{id:other,name:'Audit Operator'},recorded_at:'2026-11-14T10:00:00Z',raw_value:'PRIVATE'}],
 lineage_ids:[id],related_record_ids:[other],unvisited_record_ids:[],pagination:{next_cursor:next,has_more:Boolean(next)},coverage:{warnings:['legacy_history_may_be_incomplete']}});
const browser=await chromium.launch({headless:true}),report=[];
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],methods=[];
  let first=true,nextFailure=true,delay=false,release,started,waiting;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__leave-history-ui',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Leave history fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="opener">Open history</button></body></html>'}));
  await page.route('**/api/v1/leave/requests/**',async route=>{
   methods.push(route.request().method());const url=new URL(route.request().url()),record=url.pathname.split('/')[5];
   if(delay){started();await waiting;}
   if(first){first=false;return route.fulfill({status:503,json:{detail:'Disposable initial history failure'}});}
   if(url.searchParams.has('cursor')&&nextFailure){nextFailure=false;return route.fulfill({json:{leave_id:record,events:'malformed'}});}
   return route.fulfill({json:response(record,url.searchParams.has('cursor')?'leave_cancelled':url.searchParams.get('category')?'leave_updated':'leave_created',url.searchParams.get('category')&&!url.searchParams.has('cursor')?'cursor-value':null)});
  });
  await page.goto('http://127.0.0.1:5188/__leave-history-ui');await page.locator('#opener').focus();
  const open=()=>page.evaluate(async id=>{const {openMemberLeaveHistory}=await import('/src/member-leave-history.ts');void openMemberLeaveHistory(id);},id);
  await open();await page.locator('[data-history-retry]').click();
  await page.getByRole('heading',{name:'leave created',exact:true}).waitFor();
  assert.doesNotMatch(await page.locator('dialog').textContent(),/PRIVATE/);
  assert.match(await page.locator('dialog').textContent(),/original<file>.csv/);
  assert.equal(await page.locator('dialog img, dialog script').count(),0);
  await page.locator('[data-history-category]').selectOption('audit');
  await page.getByRole('heading',{name:'leave updated',exact:true}).waitFor();
  await page.locator('[data-history-next]').click();
  await page.locator('[data-history-retry]').waitFor();
  assert.equal(await page.getByRole('heading',{name:'leave updated',exact:true}).count(),1);
  await page.locator('[data-history-retry]').click();
  await page.getByRole('heading',{name:'leave cancelled',exact:true}).waitFor();
  assert.equal(await page.locator('[data-history-next]').count(),0);
  await page.locator('[data-history-record-select]').selectOption(other);
  await page.getByRole('heading',{name:'leave created',exact:true}).waitFor();
  assert.equal(await page.locator('[data-history-record]').textContent(),other);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const axe=await new AxeBuilder({page}).include('dialog').analyze();
  assert.deepEqual(axe.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);
  await page.locator('[data-history-close]').click();
  assert.equal(await page.locator('#opener').evaluate(el=>el===document.activeElement),true);
  delay=true;const gate=new Promise(resolve=>started=resolve);waiting=new Promise(resolve=>release=resolve);
  await open();await gate;await page.locator('[data-history-close]').click();release();
  await page.waitForTimeout(150);assert.equal(await page.locator('dialog').count(),0);
  delay=false;
  await page.route('**/api/v1/admin/member-workspace/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/leave'))return route.fulfill({json:{rows:[{id,type:'ANNUAL_LEAVE',slot:'AM',status:'approved',source:'import',starts_on:'2026-11-10',ends_on:'2026-11-10'}]}});
   return route.fulfill({json:{member:{id,canonical_name:'Disposable member',active_status:'active',call_level:'3RD_CALL',revision:'fixture',aliases:[],designations:[],call_level_changes:[]},impact:{}}});
  });
  await page.evaluate(async id=>{const {openMemberWorkspace}=await import('/src/member-workspace.ts');void openMemberWorkspace(id,true,()=>{},[id],'leave');},id);
  await page.locator('[data-leave-lifecycle]').click();
  await page.getByRole('heading',{name:'leave created',exact:true}).waitFor();
  assert.equal(await page.locator('dialog').count(),2);
  await page.locator('dialog').first().evaluate(dialog=>dialog.remove());
  await page.waitForTimeout(100);assert.equal(await page.locator('dialog').count(),0);
  await page.evaluate(async id=>{const {openMemberWorkspace}=await import('/src/member-workspace.ts');void openMemberWorkspace(id,false,()=>{},[id],'leave');},id);
  await page.locator('[data-member-leave-filter-count]').waitFor();
  assert.equal(await page.locator('[data-leave-lifecycle]').count(),0);
  await page.getByRole('button',{name:'Close member profile',exact:true}).click();
  assert.deepEqual(errors,[]);assert.ok(methods.every(method=>method==='GET'));
  report.push({width,initial_read_retry:true,malformed_next_preserves_previous:true,paging_retry:true,linked_source_record:true,private_notes_omitted:true,escaped_filenames:true,close_pending_ignored:true,workspace_link_opens:true,parent_removal_closes_child:true,non_admin_history_hidden:true,only_reads:true,axe_serious_critical:0,errors});
  await context.close();
 }
 await writeFile('../docs/allocation-progress/n21-history-viewer-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
