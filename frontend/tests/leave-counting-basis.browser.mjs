import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base=process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5188';
const browser=await chromium.launch({headless:true});
const report=[];
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  const page=await context.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/__leave-counting-fixture',route=>route.fulfill({contentType:'text/html',body:
   '<!doctype html><html lang="en"><head><title>Leave coverage fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main style="max-width:70rem;padding:16px;margin:auto"><h1>Leave coverage</h1><div id="coverage"></div><div id="unit"></div><div id="warnings"></div></main></body></html>'}));
  await page.goto(base+'/__leave-counting-fixture');
  await page.evaluate(async()=>{
   const renderer=await import('/src/leave-counting-basis.ts');
   const group=()=>({precise:true,clock_hours:60,person_calendar_dates:3,known_clock_hours:60,known_person_calendar_dates:3,unresolved_record_ids:[]});
   const value={version:1,groups:{approved:group(),pending:group(),active:group()}};
   value.groups.pending={...group(),precise:false,clock_hours:null,person_calendar_dates:null,unresolved_record_ids:['private-id']};
   document.querySelector('#coverage').innerHTML=renderer.renderLeaveCoverage(value);
   document.querySelector('#unit').innerHTML=renderer.renderUnitLeaveBasis({unresolved_leave_person_dates:2});
   document.querySelector('#warnings').innerHTML=renderer.renderLeaveAttributionWarnings([{leave_id:'private-id',date:'2026-11-10',codes:['posting_unit_ambiguous']}]);
  });
  assert.equal(await page.locator('[data-leave-coverage-group]').count(),3);
  await page.getByText(/Exact coverage unknown: 1/).waitFor();
  await page.getByText(/2 person-dates have conflicting/).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const axe=await new AxeBuilder({page}).include('main').analyze();
  assert.deepEqual(axe.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);
  await page.evaluate(async()=>{
   const {renderLeaveCoverage}=await import('/src/leave-counting-basis.ts');
   document.querySelector('#coverage').innerHTML=renderLeaveCoverage({version:2});
  });
  await page.locator('[data-leave-coverage-unavailable]').waitFor();
  assert.deepEqual(errors,[]);
  report.push({width,approved_pending_union:true,unknown_total_explicit:true,unit_conflicts_visible:true,malformed_fallback:true,overflow:false,axe_serious_critical:0,errors});
  await context.close();
 }
 await writeFile('../docs/allocation-progress/n20-counting-basis-browser.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}finally{await browser.close();}
