// Actual bundled UI + actual HTTP API/auth/SQLite; no route mocks.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:5210';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:1000}});
const result={checks:0,synthetic:true,route_mocks:0};
const check=(value,label)=>{assert.ok(value,label);result.checks++;};
try {
 const health=await (await page.request.get(base+'/api/fairness-fixture/health')).json();
 check(health.identity==='duty-fairness-synthetic-full-stack-v1','dedicated fixture identity');
 const auth=await page.request.post(base+'/api/v1/auth/sign-in',{data:{username:'fairness-fixture-admin',password:'SyntheticFixturePassword123!'}});
 assert.equal(auth.status(),200,await auth.text());
 const {token}=await auth.json();
 const headers={Authorization:`Bearer ${token}`};
 await page.addInitScript(token=>{
   localStorage.setItem('duty_rota_auth_token',token);
   localStorage.setItem('duty_rota_working_month','2026-05');
 },token);
 await page.goto(base+'/#view=limits');
 const choice=page.locator('[data-limit-choice="fairness_rules.allocation_mode"]');
 await choice.waitFor();
 check(await choice.inputValue()==='availability','real default policy loaded');
 await choice.selectOption('equal_counts');
 await page.locator('[data-limits-save]').click();
 const dialog=page.locator('dialog[open]');
 await dialog.locator('.limits-impact').waitFor();
 await dialog.getByLabel('I understand this changes how every rota is generated').check();
 await dialog.locator('[data-confirm-save]').click();
 await page.locator('dialog').waitFor({state:'detached'});
 const limits=await (await page.request.get(base+'/api/v1/admin/limits?month=2026-05',{headers})).json();
 check(limits.limits.fairness_rules.allocation_mode==='equal_counts','actual API persisted selected policy');
 let status=await (await page.request.get(base+'/api/v1/balance-duties/status?month=2026-05',{headers})).json();
 check(status.levels[0].min===2&&status.levels[0].max===4,'saving settings did not reallocate duties');
 await page.goto(base+'/#view=rota-template');
 await page.locator('.assignment-tools > summary').click();
 await page.getByRole('button',{name:'Balance duties',exact:true}).click();
 await page.locator('[data-balance-move]').first().waitFor();
 check(/Equal duty count targets/.test(await page.locator('.balance-members caption').textContent()),'review identifies equal-count policy');
 await page.locator('[data-balance-reviewed]').check();
 await page.locator('[data-balance-apply]').click();
 await page.locator('[data-balance-notice]').filter({hasText:/applied|balanced/i}).waitFor();
 status=await (await page.request.get(base+'/api/v1/balance-duties/status?month=2026-05',{headers})).json();
 check(status.levels[0].min===3&&status.levels[0].max===3,'reviewed real API application produces3/3');
 const safety=await (await page.request.get(base+'/api/v1/extra-duty/verify?month=2026-05',{headers})).json();
 check(safety.ok&&safety.checked===6,'all six actual assignments pass independent safety');
 const batch=status.batches.find(b=>b.status==='applied');
 const undo=await page.request.post(base+`/api/v1/balance-duties/batches/${batch.id}/undo`,{headers,data:{dry_run:false}});
 check(undo.status()===200,'real safe undo succeeds');
 result.status='passed';
} finally {
 await writeFile('../docs/allocation-progress/fairness-modes-live-browser.json',JSON.stringify(result,null,2));
 await browser.close();
}
console.log(JSON.stringify(result));
