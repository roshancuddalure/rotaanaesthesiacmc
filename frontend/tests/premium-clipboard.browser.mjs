import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const api = process.env.UX_AUDIT_API || 'http://127.0.0.1:8031';
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const mode of ['unavailable', 'denied', 'available']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      localStorage.setItem('duty_rota_auth_token', 'clipboard-review');
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'unavailable' ? undefined : {
        writeText: async text => {
          if (mode === 'denied') throw new DOMException('Permission denied', 'NotAllowedError');
          window.__copiedDiagnostics = text;
        }
      } });
    }, mode);
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      assert.equal(route.request().method(), 'GET');
      return route.fulfill({ response: await route.fetch({ url: api + url.pathname + url.search }) });
    });
    await page.goto(base + '/#view=diagnostics');
    await page.getByText('Raw diagnostics JSON', {exact:true}).click();
    const pre = page.locator('#diagnostics-pre');
    await pre.waitFor();
    const text = await pre.textContent();
    await page.getByRole('button', { name: 'Copy JSON', exact: true }).click();
    if (mode === 'available') {
      await page.getByText('Diagnostics copied to clipboard', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__copiedDiagnostics), text);
    } else {
      await page.getByText('Copy unavailable. Select the diagnostics text and copy it manually.', { exact: true }).waitFor();
      assert.equal(await pre.evaluate(el => el === document.activeElement), true);
      assert.equal(await page.evaluate(() => getSelection().toString()), text);
    }
    assert.deepEqual(errors, []);
    results.push({ mode, correct_outcome: true, backend_writes: 0 });
    await page.close();
  }
  const page = await browser.newPage();
  let fail = true, attempts = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('duty_rota_auth_token', 'diagnostics-recovery'));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    assert.equal(route.request().method(), 'GET');
    if (url.pathname.endsWith('/diagnostics/summary')) {
      attempts++;
      if (fail) return route.fulfill({status:503,json:{detail:'Unavailable <img src=x onerror=alert(1)>'}});
    }
    return route.fulfill({response:await route.fetch({url:api+url.pathname+url.search})});
  });
  await page.goto(base + '/#view=diagnostics');
  await page.getByRole('heading',{name:'Diagnostics unavailable',exact:true}).waitFor();
  assert.equal(await page.locator('#view-root img').count(),0);
  assert.equal(attempts,1);
  fail=false;
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.locator('#diagnostics-pre').waitFor({state:'attached'});
  assert.equal(attempts,2,'Exactly one explicit retry of diagnostic read');
  await page.getByText('Support details',{exact:true}).click();
  assert.match(await page.locator('.support-details').filter({has:page.getByText('Support details',{exact:true})}).innerText(),/Frontend build: [A-Za-z0-9._-]{1,64}/);
  assert.deepEqual(errors,[]);
  results.push({mode:'diagnostics failure and explicit retry',correct_outcome:true,backend_writes:0});
  await page.close();
} finally { await browser.close(); }
await writeFile('../docs/premium-ui/qa-clipboard.json', JSON.stringify({ results, clipboard_api_is_mocked: true }, null, 2) + '\n');
console.log('Diagnostics: 4 clipboard and explicit retry outcomes passed');
