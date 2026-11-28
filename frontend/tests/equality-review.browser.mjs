import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base=process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5195';
const browser=await chromium.launch({headless:true});
const result={checks:0,workflows:[],writes:0};
const check=(condition,label)=>{assert.ok(condition,label);result.checks++;};
const report={status:'feasible',uncovered:0,changed:2,elapsed_ms:3000,warnings:[],
  objective_basis:{version:1,equality:'uniform_call_level_v1',fixed_duties:'included_in_month_total',
    personal_prorata_optimized:false,preferences_before_equality:false,worst_gap_optimized:true,hours_and_extra_optimized:true},
  gap_feasibility:[{limit:1,status:'unknown'},{limit:2,status:'infeasible_in_candidate_model'}],
  fairness_exceptions:[{call_level:'1ST_CALL',gap:4,outliers:[{person_name:'<img src=x onerror="window.xss=true">',
    duties:0,fixed_duties:0,clear_candidate_duties:0,initial_candidate_restrictions:{leave:3,rest_after_24hr:2}}]}],
  objectives:[{name:'worst_call_gap',value:4,proven:false}],history_window:{start:'2026-01-01',end:'2026-04-30',observed_months:[]}};
const job={id:'equality-fixture',month:'2026-05',status:'completed',revision:1,engine:'server',processed:2,total:2,
  proposed:2,unresolved:0,decisions:[],intelligence:{selected:0,alternatives:[report]}};
try {
  for(const width of [1280,390,320]) {
    const context=await browser.newContext({viewport:{width,height:1000}});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/__equality-review',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Equality review fixture</title><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="opener">Open review</button></body></html>'}));
    await page.route('**/api/**',async r=>{
      if(r.request().method()!=='GET')result.writes++;
      const url=new URL(r.request().url());
      const body=url.pathname.endsWith('/setup')?{slots:[],people:[],history_lookback:4,history_months:[],rules:{},holiday_dates:[]}
        :url.pathname.endsWith('/jobs/equality-fixture')?job:url.pathname.endsWith('/jobs')?[job]:[];
      await r.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.goto(base+'/__equality-review');
    await page.evaluate(async()=>{
      localStorage.setItem('duty_rota_auth_token','fixture');
      const m=await import('/src/rota-intelligence.ts');
      await m.openIntelligentRota('2026-05',true,()=>{},()=>document.querySelector('#opener'),'equality-fixture');
    });
    const dialog=page.locator('dialog[open]');
    check(await dialog.locator('[data-gap-evidence]').count()===1,'Gap feasibility evidence is visible');
    const text=await dialog.locator('[data-gap-evidence]').innerText();
    check(text.includes('Not proven within the search time'),'Timeout remains unknown');
    check(text.includes('Impossible in this candidate model'),'Impossibility is scoped');
    check(text.includes('Other unit layouts may differ'),'Unit-layout limit is disclosed');
    check((await dialog.locator('[data-objective-basis]').innerText()).includes('Hours and extra-duty burden'),'Saved burden basis is shown');
    await dialog.locator('[data-fairness-exceptions] summary').click();
    check((await dialog.locator('[data-fairness-exceptions]').innerText()).includes('leave: 3; rest after 24hr: 2'),'Actual restriction counts are shown');
    check(await dialog.locator('[data-fairness-exceptions] img').count()===0,'Names are escaped');
    check(await page.evaluate(()=>!window.xss),'Outlier names cannot execute HTML');
    check(await dialog.locator('[data-apply]').isDisabled(),'Review is required before apply');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow');
    for(const scheme of ['light','dark']) {
      await page.emulateMedia({colorScheme:scheme});
      const audit=await new AxeBuilder({page}).include('dialog').analyze();
      check(audit.violations.length===0,`Accessibility at ${width}px/${scheme}: ${JSON.stringify(audit.violations.map(v=>v.id))}`);
      result.workflows.push({width,scheme,accessibility_violations:0});
    }
    check(errors.length===0,`No script errors: ${errors.join('; ')}`);
    await context.close();
  }
  check(result.writes===0,'Read-only review sends no writes');
  await writeFile('../docs/allocation-progress/equality-hour-review-browser.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {await browser.close();}
