import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const browser=await chromium.launch({headless:true}),report=[];
const id='11111111-1111-4111-8111-111111111111';
const rows=[{id:'record-one',type:'ANNUAL_LEAVE',slot:'AM',status:'approved',source:'import',starts_on:'2026-10-31',ends_on:'2026-11-02',notes:'PRIVATE diagnosis'},
 {id:'record-two',type:'CASUAL_LEAVE',slot:'PM',status:'requested',source:'manual',starts_on:'2026-11-10',ends_on:'2026-11-10'},
 {id:'record-three',type:'ANNUAL_LEAVE',slot:'NIGHT',status:'cancelled',source:'manual',starts_on:'2026-11-20',ends_on:'2026-11-20'}];
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[];
  let fail=true,reads=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__member-leave-filter',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Member leave fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="opener">Open profile</button></body></html>'}));
  await page.route('**/api/v1/admin/member-workspace/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/leave')){reads++;if(fail){fail=false;return route.fulfill({status:503,json:{detail:'Disposable leave load failure'}});}return route.fulfill({json:{rows}});}
   return route.fulfill({json:{member:{id,canonical_name:'Disposable profile',active_status:'active',call_level:'3RD_CALL',aliases:[],designations:[],call_level_changes:[],revision:'fixture'},impact:{future_duties:0,current_or_future_postings:0,eligibility_memberships:0}}});
  });
  await page.goto('http://127.0.0.1:5188/__member-leave-filter');
  await page.locator('#opener').focus();
  await page.evaluate(async id=>{const {openMemberWorkspace}=await import('/src/member-workspace.ts');await openMemberWorkspace(id,true,()=>{},[id],'leave');},id);
  await page.locator('dialog [data-retry]').click();
  await page.locator('[data-member-leave-filter-count]').getByText(/3 of 3/).waitFor();
  assert.doesNotMatch(await page.locator('dialog').textContent(),/PRIVATE diagnosis/);
  await page.locator('[data-leave-filter="status"]').selectOption('approved');
  await page.getByRole('button',{name:'Apply leave filters',exact:true}).click();
  await page.locator('[data-member-leave-filter-count]').getByText(/1 of 3/).waitFor();
  assert.equal(await page.locator('dialog [data-edit-record]').count(),1);
  assert.equal(await page.locator('[data-member-leave-filter-count]').evaluate(el=>el===document.activeElement),true);
  await page.getByRole('button',{name:'Clear leave filters',exact:true}).click();
  assert.equal(await page.locator('[data-leave-filter="search"]').evaluate(el=>el===document.activeElement),true);
  await page.locator('[data-leave-filter="from"]').fill('2026-11-01');
  await page.locator('[data-leave-filter="until"]').fill('2026-11-01');
  await page.getByRole('button',{name:'Apply leave filters',exact:true}).click();
  await page.locator('[data-member-leave-filter-count]').getByText(/1 of 3/).waitFor();
  assert.match(await page.locator('dialog [data-edit-record]').getAttribute('data-edit-record'),/record-one/);
  await page.locator('[data-leave-filter="until"]').fill('2026-10-01');
  await page.getByRole('button',{name:'Apply leave filters',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'on or after'}).waitFor();
  await page.getByRole('button',{name:'Clear leave filters',exact:true}).click();
  await page.locator('[data-leave-filter="search"]').fill('diagnosis');
  await page.getByRole('button',{name:'Apply leave filters',exact:true}).click();
  await page.locator('[data-member-leave-filter-count]').getByText(/0 of 3/).waitFor();
  assert.equal(reads,2); // Filters never mutate/read another leave source.
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const axe=await new AxeBuilder({page}).include('dialog').analyze();
  assert.deepEqual(axe.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);
  assert.deepEqual(errors,[]);
  report.push({width,failed_load_retry:true,status_search_date_filters:true,invalid_range_visible:true,source_dates_preserved:true,private_notes_excluded:true,focus_restored:true,reads,axe_serious_critical:0,errors});
  await context.close();
 }
 await writeFile('../docs/allocation-progress/n21-leave-filter-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
