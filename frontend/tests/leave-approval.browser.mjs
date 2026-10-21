import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base=process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const api=process.env.LEAVE_TEST_API || 'http://127.0.0.1:8025';
const browser=await chromium.launch({headless:true,executablePath:process.env.MEMBER_TEST_BROWSER || chromium.executablePath()});
const report={workflows:[]};
async function pageAt(width) {
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    const response=await route.fetch({url:api+url.pathname+url.search});await route.fulfill({response});
  });
  await page.addInitScript(()=>{
    localStorage.setItem('duty_rota_auth_token','disposable');
    localStorage.setItem('duty_rota_working_month','2026-05');
  });
  await page.goto(base);await page.getByRole('heading',{name:'Duty workload at a glance',exact:true}).waitFor();
  await page.locator('[data-view="leave"]').first().evaluate(button=>button.click());
  await page.locator('[data-add-operational-record="leave"]').waitFor();
  return {page,errors};
}
try {
  for(const width of [1280,390,320]) {
    await fetch(api+'/__fixture/leave-approval',{method:'POST'});
    const {page,errors}=await pageAt(width);
    // The existing individual approval editor remains available.
    const menu=page.locator(width>700?'.hide-mobile .row-menu':'.leave-card .row-menu').first();
    await menu.locator('summary').click();await menu.locator('[data-edit-operational-record]').click();
    await page.getByRole('heading',{name:'Edit leave',exact:true}).waitFor();
    assert.equal(await page.locator('dialog select[name="status"]').count(),1);
    await page.getByRole('button',{name:'Close editor',exact:true}).click();
    await page.locator('[data-approve-month-leave]').click();
    await page.getByText('2 pending requests to approve.',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-approve]').isDisabled(),true);
    await page.locator('[data-confirm]').check();assert.equal(await page.locator('[data-approve]').isDisabled(),true);
    await page.locator('[data-duty-ack]').check();assert.equal(await page.locator('[data-approve]').isEnabled(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('dialog .table-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    const accessibility=await new AxeBuilder({page}).include('dialog').analyze();
    assert.deepEqual(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[]);
    if(width===390){await mkdir('tests/artifacts',{recursive:true});await page.screenshot({path:'tests/artifacts/leave-month-approval-mobile.png'});}
    if(width===320) {
      await fetch(api+'/__fixture/leave-approval-change',{method:'POST'});
      await page.locator('[data-approve]').click();
      await page.getByRole('alert').filter({hasText:'Refresh'}).waitFor();
      assert.equal((await(await fetch(api+'/api/v1/leave/requests?month=2026-05')).json()).filter(l=>l.status==='requested').length,2);
      await page.locator('[data-refresh]').click();await page.getByText('3 pending requests to approve.',{exact:true}).waitFor();
      await page.locator('[data-confirm]').check();await page.locator('[data-duty-ack]').check();
    }
    await page.locator('[data-approve]').click();await page.locator('dialog').waitFor({state:'detached'});
    await page.getByRole('button',{name:'Approve all pending (0)',exact:true}).waitFor();
    assert.equal(await page.locator('[data-approve-month-leave]').isDisabled(),true);
    const leaves=await(await fetch(api+'/api/v1/leave/requests?month=2026-05')).json();
    assert.equal(leaves.filter(l=>['requested','imported_pending_review'].includes(l.status)).length,0);
    assert.equal(leaves.filter(l=>l.status==='cancelled').length,1);
    assert.equal(leaves.filter(l=>l.status==='rejected').length,1);
    assert.equal((await(await fetch(api+'/__fixture')).json()).active_assignments,1);
    assert.deepEqual(errors,[]);
    report.workflows.push({width,individual_editor_preserved:true,review_and_duty_ack_required:true,stale_review_recovery:width===320,assignments_preserved:true,axe_serious_critical:0});await page.close();
  }
  await fetch(api+'/__fixture/leave-approval',{method:'POST'});
  await fetch(api+'/__fixture/leave-approval-board',{method:'POST'});
  const {page,errors}=await pageAt(390);
  assert.equal(await page.locator('[data-approve-month-leave]').count(),0);
  assert.equal((await fetch(api+'/api/v1/leave/approval-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month:'2026-05'})})).status,403);
  assert.deepEqual(errors,[]);report.workflows.push({non_admin_control_hidden:true,api_forbidden:true});await page.close();
} finally {await browser.close();}
await writeFile('../docs/benchmarks/leave_approval_browser.json',JSON.stringify(report,null,2)+'\n');
console.log('Monthly leave approval passed: 3 responsive review/apply workflows and non-admin access checks.');
