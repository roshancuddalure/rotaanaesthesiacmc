// Real bundled frontend/auth/API and isolated DB: repair an overnight leave conflict.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const base=process.env.FAIRNESS_LEAVE_BASE||'http://127.0.0.1:5213';
const artifact=process.env.FAIRNESS_LEAVE_ARTIFACT||'fairness-modes-revision13-leave-live';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:1000}});
const result={checks:0,synthetic:true,route_mocks:0,status:'running'};
const check=(condition,label)=>{assert.ok(condition,label);result.checks++;};
try {
  const health=async()=>await (await page.request.get(base+'/api/fairness-fixture/health')).json();
  const initial=await health();
  check(initial.identity==='duty-fairness-leave-full-stack-v1'&&initial.database==='in_memory_only'
    &&initial.optimizer_revision===13,'fresh revision13 synthetic fixture');
  const auth=await page.request.post(base+'/api/v1/auth/sign-in',{data:{username:'fairness-fixture-admin',password:'SyntheticFixturePassword123!'}});
  assert.equal(auth.status(),200,await auth.text());
  const {token}=await auth.json(),headers={Authorization:`Bearer ${token}`};
  const before=await (await page.request.get(base+'/api/v1/extra-duty/verify?month=2026-05',{headers})).json();
  check(!before.ok,'independent checker detects initial next-month leave conflict');
  await page.addInitScript(token=>{localStorage.setItem('duty_rota_auth_token',token);localStorage.setItem('duty_rota_working_month','2026-05');},token);
  await page.goto(base+'/#view=rota-template');
  await page.locator('.assignment-tools > summary').click();
  await page.getByRole('button',{name:'Balance duties',exact:true}).click();
  const notice=page.locator('[data-clinical-repair]');
  await notice.waitFor();
  check(/1 duty\/leave conflict/.test(await notice.innerText()),'clinical repair count disclosed');
  check(/Undo cannot restore a duty that still overlaps active leave/.test(await notice.innerText()),'unsafe Undo restriction disclosed before review');
  check(await page.locator('[data-balance-apply]').isDisabled(),'review remains mandatory');
  await page.screenshot({path:`../docs/allocation-progress/${artifact}.png`,fullPage:true});
  await page.locator('[data-balance-reviewed]').check();
  await page.locator('[data-balance-apply]').click();
  await page.locator('[data-balance-notice]').filter({hasText:/applied|balanced/i}).waitFor();
  const after=await (await page.request.get(base+'/api/v1/extra-duty/verify?month=2026-05',{headers})).json();
  check(after.ok&&after.checked===2,'saved duties pass independent verification');
  const applied=await health();
  check(applied.workload.every(row=>row.duties===1&&row.hours===8),'both duties remain filled and counts/hours balanced');
  await page.locator('[data-balance-undo]').first().click();
  const panel=page.locator('[data-balance-undo-panel]');
  await panel.waitFor();
  check(/conflict|cannot|leave/i.test(await panel.innerText()),'unsafe original duty is refused by UI Undo');
  check(await page.locator('[data-balance-undo-confirm]').count()===0,'unsafe Undo cannot be confirmed');
  check(JSON.stringify((await health()).workload)===JSON.stringify(applied.workload),'refused Undo preserves saved safe rota');
  const retained=await (await page.request.get(base+'/api/v1/extra-duty/verify?month=2026-05',{headers})).json();
  check(retained.ok&&retained.checked===2,'unsafe holders were not restored behind unchanged counts');
  result.status='passed';
}catch(error){result.status='failed';result.error=String(error.message);throw error;}
finally{await writeFile(`../docs/allocation-progress/${artifact}-browser.json`,JSON.stringify(result,null,2));await browser.close();}
console.log(JSON.stringify(result));
