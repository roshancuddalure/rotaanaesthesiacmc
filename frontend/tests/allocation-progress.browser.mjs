import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const evidence = new URL('../../docs/allocation-progress/', import.meta.url);
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const checks = [];
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:5201/');
    await page.getByRole('status').filter({ hasText: 'Tracker connected' }).waitFor();
    assert.equal(await page.locator('#tasks tr').count(), 50);
    assert.equal(await page.locator('#phases .phase').count(), 7);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('searchbox').fill('Thursday');
    assert.ok(await page.locator('#tasks tr').count() >= 1);
    assert.ok(await page.locator('#tasks tr').count() < 50);
    await page.getByRole('searchbox').fill('');
    await page.getByLabel('Filter action status').selectOption('In progress');
    assert.ok(await page.locator('#tasks tr').count() >= 1);
    await page.getByLabel('Filter action status').selectOption('');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: fileURLToPath(new URL(`dashboard-${width}.png`, evidence)), fullPage: false });
    checks.push({ width, taskCount: 50, workstreams: 7, noPageOverflow: true, searchAndFilter: 'passed' });
    await page.close();
  }
  const page = await browser.newPage();
  let fail = false;
  await page.route('**/progress.json', async route => {
    if (fail) return route.fulfill({ status: 503, body: 'updating' });
    return route.continue();
  });
  await page.goto('http://127.0.0.1:5201/');
  await page.getByRole('status').filter({ hasText: 'Tracker connected' }).waitFor();
  fail = true;
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await page.getByRole('alert').filter({ hasText: 'stale' }).waitFor();
  assert.equal(await page.locator('#tasks tr').count(), 50);
  fail = false;
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await page.getByRole('status').filter({ hasText: 'Tracker connected' }).waitFor();
  assert.equal(await page.locator('#alert').textContent(), '');
  assert.deepEqual(errors, []);
  checks.push({ unavailableTracker: 'last snapshot retained and labeled stale', recovery: 'passed', pageErrors: 0 });
  await writeFile(new URL('dashboard-browser.json', evidence), JSON.stringify({ recorded_at: new Date().toISOString(), checks }, null, 2));
  console.log(JSON.stringify(checks));
} finally {
  await browser.close();
}
