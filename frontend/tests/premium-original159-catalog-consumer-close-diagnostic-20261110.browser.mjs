// Frozen groundwork: root executes only after releasing the browser gate.
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';
const sha = value => createHash('sha256').update(value).digest('hex');
const base = process.env.CATALOG_CONSUMER_BASE || 'http://127.0.0.1:5197';
const report = '../docs/premium-ui/qa-original159-catalog-consumer-close-diagnostic-20261110.json';
await assert.rejects(access(report), { code: 'ENOENT' });
const audit = JSON.parse(await readFile('../docs/premium-ui/reviews/original159-catalog-consumer-map-20261110.json', 'utf8'));
for (const [path, expected] of Object.entries(audit.source_sha256)) {
  assert.equal(sha(await readFile('../' + path)), expected, 'Frozen local source ' + path);
  const response = await fetch(base + '/src/' + path.slice('frontend/src/'.length));
  assert.equal(response.status, 200);
  const sourceMap = (await response.text()).match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
  assert.ok(sourceMap, 'Served source map ' + path);
  assert.ok(JSON.parse(Buffer.from(sourceMap[1], 'base64').toString()).sourcesContent.some(source => sha(source) === expected), 'Exact served source ' + path);
}
const results = [];
for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await launcher.launch();
  try { for (const width of [320, 1280]) for (const recovery of ['close', 'retry']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(12000);
    const writes = [], requests = [], errors = [];
    let saved = false, failedRead = false, catalogReads = 0;
    const unit = { id: 'catalog-parent', name: 'Royal Catalog Parent', campus: 'Main', code: 'CP', minimum_free_people: 1, active_status: 'active', notes: null };
    const references = () => [{ key: '2ND_CALL', label: saved ? 'Royal Changed Posting Label' : 'Original Posting Label', aliases: [], active: true, version: saved ? 2 : 1, behavior: { maps_to: '2ND_CALL' }, usage: { records: 1 } }];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.addInitScript(() => { localStorage.setItem('duty_rota_auth_token', 'catalog-consumer-local'); localStorage.setItem('duty_rota_working_month', '2026-11'); });
    await page.route('**/api/**', async route => {
      const q = route.request(), url = new URL(q.url()), path = url.pathname;
      requests.push({ method: q.method(), path });
      if (q.method() !== 'GET') {
        const body = q.postDataJSON(); writes.push({ method: q.method(), path, body });
        if (q.method() !== 'PUT' || path !== '/api/v1/normalization/catalog/posting_type/2ND_CALL' || saved) return route.fulfill({ status: 500, json: { detail: 'Only one local catalog PUT is permitted' } });
        assert.equal(body.label, 'Royal Changed Posting Label'); assert.equal(body.version, 1); assert.equal(body.behavior.maps_to, '2ND_CALL');
        saved = true; return route.fulfill({ json: { saved: true } });
      }
      if (path === '/api/v1/admin/members') return route.fulfill({ json: [] });
      if (path === '/api/v1/normalization/units') return route.fulfill({ json: [unit] });
      if (path === '/api/v1/normalization/catalog/posting_type') {
        catalogReads++;
        if (saved && !failedRead) { failedRead = true; return route.fulfill({ status: 503, json: { detail: 'Locally injected catalog readback failure' } }); }
        return route.fulfill({ json: references() });
      }
      if (path === '/api/v1/extra-duty/unit-fallbacks') return route.fulfill({ json: [{ unit_id: unit.id, unit_name: unit.name, fallbacks: [] }] });
      if (path === '/api/v1/unit-management/month') return route.fulfill({ json: { month: url.searchParams.get('month'), starts_on: '2026-11-01', ends_on: '2026-11-30', units: [unit], assignments: [], unit_summaries: [{ unit_id: unit.id, assigned_members: 0, people_with_leave: 0, leave_days: 0, leave_by_call_level: {} }], unit_call_minimums: [], validation_issues: [] } });
      return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:8031' + path + url.search, maxRetries: 2 }) });
    });
    let observed;
    try {
      await page.goto(base + '/#view=units', { waitUntil: 'domcontentloaded' });
      await page.locator('[data-unit-board-card="unit:catalog-parent"] button[data-open-unit-modal]').click();
      const parent = page.locator('#unit-management-modal');
      await parent.locator('#unit-minimum-free-people').fill('3');
      await parent.locator('#unit-settings-form').evaluate(form => { window.__catalogSettings = form; window.__catalogMinimum = form.querySelector('#unit-minimum-free-people'); });
      await parent.locator('[data-add-operational-record="units"]').click();
      const editor = page.getByRole('dialog', { name: 'Add posting', exact: true });
      assert.equal(await editor.locator('select[name="posting_type"] option:checked').textContent(), 'Original Posting Label');
      await editor.locator('textarea[name="notes"]').fill('Keep this unrelated posting draft');
      await editor.locator('[data-references]').click();
      const catalog = page.getByRole('dialog', { name: 'Reference labels and mappings', exact: true });
      // Record editor defaults this catalog to Leave types. Explicitly choose the consumed posting kind.
      await catalog.locator('select[data-kind]').selectOption('posting_type');
      await catalog.locator('button[data-key="2ND_CALL"]').click();
      await catalog.locator('input[name="label"]').fill('Royal Changed Posting Label');
      await catalog.getByRole('button', { name: 'Save reference', exact: true }).click();
      await catalog.getByRole('heading', { name: 'Change saved; refresh unavailable', exact: true }).waitFor();
      assert.equal(saved, true); assert.equal(failedRead, true); assert.equal(writes.length, 1);
      if (recovery === 'retry') {
        await catalog.getByRole('button', { name: 'Try again', exact: true }).click();
        await catalog.locator('button[data-key="2ND_CALL"]').filter({ hasText: 'Royal Changed Posting Label' }).waitFor();
        await catalog.getByRole('button', { name: 'Cancel', exact: true }).click();
      } else await catalog.getByRole('button', { name: 'Close', exact: true }).click();
      await catalog.waitFor({ state: 'detached' });
      await page.waitForLoadState('networkidle');
      observed = { label: await editor.locator('select[name="posting_type"] option:checked').textContent(), postingType: await editor.locator('select[name="posting_type"]').inputValue(), notes: await editor.locator('textarea[name="notes"]').inputValue(), settings: await parent.locator('#unit-minimum-free-people').inputValue(), retainedSettings: await parent.locator('#unit-settings-form').evaluate(form => form === window.__catalogSettings && form.querySelector('#unit-minimum-free-people') === window.__catalogMinimum), catalogReads };
      assert.equal(writes.length, 1, 'Read recovery must not replay PUT'); assert.deepEqual(errors, []);
      assert.equal(observed.notes, 'Keep this unrelated posting draft'); assert.equal(observed.postingType, '2ND_CALL'); assert.equal(observed.settings, '3'); assert.equal(observed.retainedSettings, true);
      assert.equal(observed.label, 'Royal Changed Posting Label', 'A confirmed reference rename must refresh the actual consuming editor after nested catalog close');
      results.push({ engine, width, recovery, passed: true, observed, writes, requests, errors });
    } catch (error) { results.push({ engine, width, recovery, passed: false, assertion: error.message, observed, writes, requests, errors }); }
    finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); }
  } } finally { await browser.close(); }
}
for (const [path, expected] of Object.entries(audit.source_sha256)) assert.equal(sha(await readFile('../' + path)), expected, 'Source held throughout');
await writeFile(report, JSON.stringify({ recorded_at_utc: new Date().toISOString(), author: '/root/catalog159_consumer_groundwork', scope: 'Expected-correct actual Units→Add posting→catalog rename PUT→own GET503→Close versus explicit GET retry. Twelve contexts, local mutations only; source-risk diagnostic until executed, no universal catalog/main rename claim.', source_sha256: audit.source_sha256, test_sha256: sha(await readFile(new URL(import.meta.url))), results }, null, 2) + '\n');
assert.equal(results.length, 12); assert.equal(results.filter(result => !result.passed).length, 0, 'Expected-correct catalog consumer diagnostic');
