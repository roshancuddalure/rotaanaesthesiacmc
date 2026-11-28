// Actual bundled UI/auth/API plus dedicated in-memory fixture. No route mocks.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const base=process.env.FAIRNESS_WEEKEND_BASE||'http://127.0.0.1:5211';
const artifact=process.env.FAIRNESS_WEEKEND_ARTIFACT||'fairness-modes-weekend-live';
const releaseCandidate=process.env.FAIRNESS_WEEKEND_RELEASE==='1';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:1000}});
const result={checks:0,synthetic:true,route_mocks:0,release_candidate:releaseCandidate,status:'running'};
const check=(value,label)=>{assert.ok(value,label);result.checks++;};
try {
  const health=async()=>await (await page.request.get(base+'/api/fairness-fixture/health')).json();
  const initial=await health();
  check(initial.identity==='duty-fairness-weekend-full-stack-v1'&&initial.database==='in_memory_only'&&initial.release_candidate===releaseCandidate,'dedicated synthetic fixture');
  check(JSON.stringify(initial.workload.map(x=>x.weekends))==='[0,2]','actual initial weekend gap2');
  const auth=await page.request.post(base+'/api/v1/auth/sign-in',{data:{username:'fairness-fixture-admin',password:'SyntheticFixturePassword123!'}});
  assert.equal(auth.status(),200,await auth.text());
  const {token}=await auth.json();
  const headers={Authorization:`Bearer ${token}`};
  await page.addInitScript(token=>{localStorage.setItem('duty_rota_auth_token',token);localStorage.setItem('duty_rota_working_month','2026-05');},token);
  const status=await (await page.request.get(base+'/api/v1/balance-duties/status?month=2026-05',{headers})).json();
  check(status.balanced===true&&status.levels[0].min===2&&status.levels[0].max===2,'duty totals already balanced');
  await page.goto(base+'/#view=rota-template');
  await page.locator('.assignment-tools > summary').click();
  await page.getByRole('button',{name:'Balance duties',exact:true}).click();
  const weekend=page.locator('[data-weekend-refinement]');
  await weekend.waitFor();
  check(JSON.stringify(await weekend.locator('tbody td').allTextContents())==='["2","0"]','real preview weekend gap2to0');
  check(await page.locator('[data-balance-apply]').isDisabled(),'review required before apply');
  await weekend.scrollIntoViewIfNeeded();
  await page.screenshot({path:`../docs/allocation-progress/${artifact}.png`,fullPage:true});
  await page.locator('[data-balance-reviewed]').check();
  await page.locator('[data-balance-apply]').click();
  await page.locator('[data-balance-notice]').filter({hasText:/applied|balanced/i}).waitFor();
  const applied=await health();
  check(applied.workload.every(x=>x.duties===2&&x.hours===48&&x.weekends===1),'actual database totals/hours preserved and weekends1/1');
  const safety=await (await page.request.get(base+'/api/v1/extra-duty/verify?month=2026-05',{headers})).json();
  check(safety.ok&&safety.checked===4,'all four saved rows independently verified');
  await page.locator('[data-balance-undo]').first().click();
  await page.locator('[data-balance-undo-confirm]').click();
  await page.locator('[data-balance-notice]').filter({hasText:/undone|restored/i}).waitFor();
  const restored=await health();
  check(JSON.stringify(restored.workload)===JSON.stringify(initial.workload),'actual UI Undo restores original workload');
  result.status='passed';
} catch (error) {
  result.status='failed';
  result.error=String(error.message);
  throw error;
} finally {
  await writeFile(`../docs/allocation-progress/${artifact}-browser.json`,JSON.stringify(result,null,2));
  await browser.close();
}
console.log(JSON.stringify(result));
