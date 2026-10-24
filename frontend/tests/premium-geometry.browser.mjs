import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const api = process.env.UX_AUDIT_API || 'http://127.0.0.1:8031';
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('duty_rota_auth_token', 'geometry-review');
    localStorage.setItem('duty_rota_working_month', '2026-05');
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    assert.equal(route.request().method(), 'GET', 'Geometry review only reads disposable fixture data');
    return route.fulfill({ response: await route.fetch({ url: api + url.pathname + url.search }) });
  });
  await page.goto(base);
  await page.locator('#view-root .panel').first().waitFor();
  const sidebar = page.locator('.sidebar');
  assert.equal(await sidebar.evaluate(el => el.inert), true, 'Closed mobile navigation must be inert');
  await page.locator('#sidebar-toggle').focus();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await sidebar.evaluate(el => el.contains(document.activeElement)), false, 'Closed drawer cannot receive keyboard focus');
  }
  await page.locator('#sidebar-toggle').click();
  assert.equal(await sidebar.evaluate(el => el.inert), false);
  const route = sidebar.locator('[data-view]').last();
  await route.focus();
  await page.setViewportSize({ width: 420, height: 700 });
  assert.equal(await route.evaluate(el => el === document.activeElement), true, 'Resizing an open drawer preserves navigation focus');
  await page.keyboard.press('Escape');
  assert.equal(await sidebar.evaluate(el => el.inert), true);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForFunction(() => !document.querySelector('.sidebar').inert);
  assert.equal(await sidebar.evaluate(el => el.inert), false, 'Desktop navigation remains available after mobile close');
  await sidebar.locator('[data-view]').first().focus();
  await page.setViewportSize({ width: 390, height: 700 });
  await page.waitForFunction(() => document.querySelector('.sidebar').inert);
  assert.equal(await sidebar.evaluate(el => el.inert), true);
  assert.equal(await page.locator('#sidebar-toggle').evaluate(el => el === document.activeElement), true, 'Focus leaves navigation when it becomes a hidden drawer');
  results.push({ check: 'closed drawer keyboard access and resize focus', passed: true });

  for (const [width, height] of [[320,568],[568,320],[699,700],[700,700],[701,700],[767,700],[768,700],[769,700],[844,390],[1023,768],[1024,768],[1025,768]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => document.querySelector('.sidebar').inert === (innerWidth <= 768));
    assert.equal(await sidebar.evaluate(el => el.inert), width <= 768);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Document reflows at ${width}x${height}`);
    if (width <= 768) {
      await page.locator('#sidebar-toggle').click();
      const close = sidebar.locator('#sidebar-close');
      await close.click();
      assert.equal(await sidebar.evaluate(el => el.inert), true);
    }
    results.push({ width, height, document_reflow: true, navigation_outcome: true });
  }
  await page.setViewportSize({ width: 390, height: 700 });
  await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Text-spacing override retains document reflow');
  await page.emulateMedia({ forcedColors: 'active' });
  await page.locator('#sidebar-toggle').click();
  await page.keyboard.press('Escape');
  assert.equal(await sidebar.evaluate(el => el.inert), true);
  results.push({ check: 'WCAG text spacing and forced-color navigation outcomes', passed: true });
  await page.emulateMedia({forcedColors:'none'});
  await page.setViewportSize({width:1280,height:900});
  await page.waitForFunction(()=>!document.querySelector('.sidebar').inert);
  await page.locator('.sidebar [data-view="units"]').click();
  await page.getByRole('heading',{name:'All postings',exact:true}).waitFor();
  const manage=page.locator('.row-actions-cell > button[data-open-unit-modal]').first();
  await manage.waitFor();
  const dimensions=await manage.boundingBox();
  assert.ok(dimensions.width>=72,'Manage action reserves readable horizontal room');
  assert.ok(dimensions.height<=60,'Manage label does not split into a vertical letter stack');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  results.push({check:'unit posting action text geometry with enlarged spacing',passed:true});
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
await mkdir('../docs/premium-ui', { recursive: true });
await writeFile('../docs/premium-ui/qa-geometry.json', JSON.stringify({ results, physical_devices: 'pending; emulation selected by user', scope: 'Overview shell geometry and keyboard outcomes; section-specific states require separate tests' }, null, 2) + '\n');
console.log(`Premium geometry: ${results.length} responsive and keyboard checks passed`);
