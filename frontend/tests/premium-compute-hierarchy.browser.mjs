// Actual settings component; all API calls intercepted, no operational writes.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const output = new URL('../../docs/premium-ui/qa-compute-hierarchy/', import.meta.url);
await mkdir(output, { recursive: true });
const cases = [];
for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await launcher.launch({ headless: true });
  try {
    for (const width of [320, 390, 1280]) for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, acceptDownloads: true });
      const page = await context.newPage(), errors = [], calls = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/__compute-hierarchy', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compute settings review</title><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="view-root" class="content"><h1>Compute settings review</h1><div id="host"></div></main></body></html>' }));
      await page.route('**/api/**', route => {
        const request = route.request(); calls.push({ method: request.method(), path: new URL(request.url()).pathname });
        assert.equal(request.method(), 'GET'); assert.ok(request.url().includes('/rota-compute/capabilities'));
        return route.fulfill({ json: { enabled: true, browser_gpu: true, template_compute: true, template_gpu: true, optimizer_gpu: true, context_hash: 'fixture' } });
      });
      await page.route('**/src/compute-worker.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'self.onmessage=e=>self.postMessage({id:e.data.id,error:{code:"unavailable",message:"Injected UI-only device test failure"}});' }));
      await page.goto(base + '/__compute-hierarchy');
      await page.evaluate(async () => { (await import('/src/compute-device.ts')).resetPreference(); await (await import('/src/rota-compute.ts')).renderComputeSettings(document.querySelector('#host')); });
      const setup = page.getByText('GPU setup checklist', { exact: true });
      const guidance = page.getByText('GPU selection and Automatic mode explained', { exact: true });
      for (const selector of ['[data-compute-enable]', '[data-compute-mode]', '[data-compute-power]', '[data-compute-test]', '[data-compute-reset]', '[data-compute-month]', '[data-compute-workload]', '[data-compute-compare]']) {
        assert.equal(await page.locator(selector).count(), 1); assert.equal(await page.locator(selector).isVisible(), true);
        assert.equal(await page.locator(selector).evaluate(el => Boolean(el.closest('details:not([open])'))), false);
      }
      assert.equal(await setup.evaluate(el => el.parentElement.open), false);
      assert.equal(await guidance.evaluate(el => el.parentElement.open), false);
      const geometry = await page.locator('[data-compute-test]').boundingBox();
      assert.ok(geometry.y < 850, `Test Device should precede the first viewport bottom: ${geometry.y}`);
      if (engine === 'chromium') await page.screenshot({ path: fileURLToPath(new URL(`compute-${width}-${colorScheme}.png`, output)), fullPage: true });
      await setup.focus(); await setup.press('Enter'); assert.equal(await setup.evaluate(el => el.parentElement.open), true);
      assert.equal(await page.locator('.compute-steps li').count(), 5);
      await setup.press('Space'); assert.equal(await setup.evaluate(el => el.parentElement.open), false);
      await guidance.click(); assert.equal(await page.getByText(/WebGPU cannot list every installed GPU/).isVisible(), true);
      await page.getByText('NVIDIA or another GPU is missing', { exact: true }).click();
      assert.equal(await page.getByText(/Do not bypass driver blocklists/).isVisible(), true);
      assert.equal(await page.getByText(/at least 20% faster/).isVisible(), true);
      const axe = await new AxeBuilder({ page }).include('.compute-settings').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      assert.deepEqual(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })), []);
      await page.locator('[data-compute-enable]').check();
      await page.locator('[data-compute-mode]').selectOption('local_gpu');
      await page.locator('[data-compute-power]').selectOption('low-power');
      const preference = await page.evaluate(async () => (await import('/src/compute-device.ts')).preference());
      assert.equal(preference.enabled, true); assert.equal(preference.mode, 'local_gpu'); assert.equal(preference.power, 'low-power');
      await page.locator('[data-compute-test]').click();
      await page.locator('[data-compute-status]').filter({ hasText: 'Injected UI-only device test failure' }).waitFor();
      assert.equal(await page.locator('[data-compute-status]').textContent(), 'Injected UI-only device test failure Server computation remains available.');
      assert.equal(await page.locator('[data-compute-test]').isEnabled(), true);
      assert.equal(await page.locator('[data-compute-compare]').isDisabled(), true);
      await page.locator('[data-compute-reset]').click();
      assert.equal(await page.locator('[data-compute-enable]').isChecked(), false);
      assert.equal(await page.locator('[data-compute-mode]').inputValue(), 'server');
      const downloadEvent = page.waitForEvent('download'); await page.locator('[data-compute-diagnostics]').click();
      const download = await downloadEvent; assert.equal(download.suggestedFilename(), 'rota-gpu-diagnostics.json'); JSON.parse(await readFile(await download.path(), 'utf8'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []); assert.equal(calls.length, 1);
      cases.push({ engine, width, colorScheme, testDeviceY: geometry.y, primaryControlsOutsideCollapsedDetails: true, keyboardHelp: true, guidanceAndSafetyCopyAccessible: true, localPreferences: true, injectedWorkerFailureRecovery: true, diagnosticsDownload: true, apiGETs: calls.length, apiWrites: 0, axeViolations: 0, pageErrors: errors.length });
      await context.close();
    }
  } finally { await browser.close(); }
}
const sourceHashes = {};
for (const file of ['frontend/src/rota-compute.ts', 'frontend/src/premium-theme.css']) sourceHashes[file] = createHash('sha256').update(await readFile(new URL('../../' + file, import.meta.url))).digest('hex');
await writeFile(new URL('report.json', output), JSON.stringify({ date: new Date().toISOString(), scope: 'Actual isolated settings component, intercepted capabilities and injected worker failure; no GPU hardware or backend correctness claim.', sourceHashes, cases }, null, 2) + '\n');
console.log(`Compute hierarchy passed: ${cases.length} browser/width/theme cases.`);
