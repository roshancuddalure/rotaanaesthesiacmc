import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base='http://127.0.0.1:5187',api='http://127.0.0.1:8042';
const browser=await chromium.launch({headless:true});
const report=[];
await mkdir('../docs/allocation-progress/elective-browser',{recursive:true});
try {
 for(const width of [1440,390,320]) {
  await fetch(api+'/__fixture/elective-reset',{method:'POST'});
  const context=await browser.newContext({viewport:{width,height:950}});
  const page=await context.newPage(),errors=[],calls=[];
  page.setDefaultTimeout(60000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/elective-members-export'))calls.push(r.url());});
  await page.addInitScript(()=>{localStorage.setItem('duty_rota_auth_token','disposable');localStorage.setItem('duty_rota_working_month','2026-05');});
  await page.route('**/api/**',async r=>{const u=new URL(r.request().url());const response=await r.fetch({url:api+u.pathname+u.search});await r.fulfill({response});});
  await page.goto(base);
  await page.locator('[data-view="rota-review"]').first().evaluate(el=>el.click());
  const button=page.locator('#download-elective-members-export');await button.waitFor();
  const eagle=page.locator('#download-review-eagle-eye-export');assert.equal(await eagle.isVisible(),true);
  assert.equal(await button.evaluate(el=>el.previousElementSibling.id),'download-review-eagle-eye-export');
  const before=await(await fetch(api+'/__fixture')).json();
  const download=page.waitForEvent('download');await button.focus();await page.keyboard.press('Enter');
  const file=await download;assert.equal(file.suggestedFilename(),'elective-list-members-2026-05.xlsx');
  const path=`../docs/allocation-progress/elective-browser/elective-${width}.xlsx`;await file.saveAs(path);
  const bytes=await readFile(path);assert.equal(bytes.subarray(0,2).toString(),'PK');
  await page.getByText('Elective list members Excel sent to your browser',{exact:true}).waitFor();
  assert.equal((await(await fetch(api+'/__fixture')).json()).assignments,before.assignments);
  await page.locator('#elective-export-start').fill('12:00');await page.locator('#elective-export-end').fill('16:00');
  const second=page.waitForEvent('download');await button.click();await second;
  assert.ok(calls.at(-1).includes('starts=12%3A00')&&calls.at(-1).includes('ends=16%3A00'));
  await page.locator('#elective-export-end').fill('10:00');const count=calls.length;await button.click();
  await page.getByText('Choose an increasing same-day elective window.',{exact:true}).waitFor();assert.equal(calls.length,count);
  await page.locator('#elective-export-end').fill('17:00');
  await fetch(api+'/__fixture/elective-unlock',{method:'POST'});await button.click();
  await page.getByText("Lock the month's unit scope before exporting elective members",{exact:true}).waitFor();
  assert.equal(await button.isEnabled(),true);
  await fetch(api+'/__fixture/elective-reset',{method:'POST'});
  const retry=page.waitForEvent('download');await button.click();await retry;
  const eagleDownload=page.waitForEvent('download');await eagle.click();assert.match((await eagleDownload).suggestedFilename(),/eagle-eye/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const accessibility=await new AxeBuilder({page}).include('.page-toolbar').include('[aria-label="Elective availability export window"]').analyze();
  assert.deepEqual(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact)),[]);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`../docs/allocation-progress/elective-browser/review-${width}.png`,fullPage:true});
  report.push({width,adjacent_eagle_eye:true,keyboard_download:true,date_workbook:true,custom_window:true,invalid_window_no_request:true,unlocked_scope_retry:true,no_assignment_mutation:true,serious_critical_export_accessibility_violations:0,overflow:false,errors});
  await context.close();
 }
}finally{await browser.close();await writeFile('../docs/allocation-progress/elective-browser.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
