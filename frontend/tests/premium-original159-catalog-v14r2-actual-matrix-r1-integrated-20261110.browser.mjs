// Frozen isolated V14r2 R1 actual-product-UI matrix; wait for the real consumer outcome before snapshotting Close counters.
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';
const sha = value => createHash('sha256').update(value).digest('hex');
const base = 'http://127.0.0.1:5197';
const candidate = await readFile('../tmp/catalog-consumer-v14r2/reference-workspace.ts');
assert.equal(sha(candidate), '91133b6913c3e7c5a493bbf19436ca06ba5ad9d1813a13974c70d0d6473a434a');
const report = '../docs/premium-ui/qa-original159-catalog-v14r2-actual-matrix-r1-integrated-20261110.json';
await assert.rejects(access(report), { code: 'ENOENT' });
const audit = JSON.parse(await readFile('../tmp/catalog-consumer-v14r2/applied-source-guards.json', 'utf8'));
for (const [path, expected] of Object.entries(audit.source_sha256)) {
  assert.equal(sha(await readFile('../' + path)), expected, 'Frozen local source ' + path);
  const response = await fetch(base + '/src/' + path.slice('frontend/src/'.length));
  assert.equal(response.status, 200);
  const servedText = await response.text();
  if (path.endsWith('.css')) {
    const encodedCSS = servedText.match(/const __vite__css = ("(?:[^"\\]|\\.)*")/);
    assert.ok(encodedCSS, 'Vite CSS module literal'); assert.equal(sha(JSON.parse(encodedCSS[1])), expected); continue;
  }
  const sourceMap = servedText.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
  assert.ok(sourceMap, 'Served source map ' + path);
  assert.ok(JSON.parse(Buffer.from(sourceMap[1], 'base64').toString()).sourcesContent.some(source => sha(source) === (audit.candidate_overlays[path.slice('frontend/src/'.length)] || expected)), 'Exact served source ' + path);
}
const results = [];
for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await launcher.launch();
  try { for (const width of [320, 1280]) for (const recovery of ['normal', 'close', 'retry', 'async-options-failure']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(12000);
    const writes = [], requests = [], errors = [];
    let saved = false, failedRead = false, catalogReads = 0, savedCatalogReads = 0, memberReads = 0;
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
      if (path === '/api/v1/admin/members') { memberReads++; return route.fulfill({ json: [] }); }
      if (path === '/api/v1/normalization/units') return route.fulfill({ json: [unit] });
      if (path === '/api/v1/normalization/catalog/posting_type') {
        catalogReads++;
        if (saved) {
          savedCatalogReads++;
          const ownFailure = ['close', 'retry'].includes(recovery) && savedCatalogReads === 1;
          const consumerFailure = recovery === 'async-options-failure' && savedCatalogReads === 2;
          if (ownFailure || consumerFailure) { failedRead = true; return route.fulfill({ status: 503, json: { detail: consumerFailure ? 'Locally injected consumer options failure' : 'Locally injected catalog readback failure' } }); }
        }
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
      const beforeNotificationMemberReads = memberReads;
      await editor.locator('[data-references]').click();
      const catalog = page.getByRole('dialog', { name: 'Reference labels and mappings', exact: true });
      // Record editor defaults this catalog to Leave types. Explicitly choose the consumed posting kind.
      await catalog.locator('select[data-kind]').selectOption('posting_type');
      await catalog.locator('button[data-key="2ND_CALL"]').click();
      await catalog.locator('input[name="label"]').fill('Royal Changed Posting Label');
      await catalog.getByRole('button', { name: 'Save reference', exact: true }).click();
      if (['close', 'retry'].includes(recovery)) {
        await catalog.getByRole('heading', { name: 'Change saved; refresh unavailable', exact: true }).waitFor();
        assert.equal(saved, true); assert.equal(failedRead, true); assert.equal(writes.length, 1);
        if (recovery === 'retry') {
          const retry = catalog.getByRole('button', { name: 'Try again', exact: true });
          await retry.focus(); await page.keyboard.press('Enter');
          await catalog.locator('button[data-key="2ND_CALL"]').filter({ hasText: 'Royal Changed Posting Label' }).waitFor();
          await page.waitForLoadState('networkidle');
          await catalog.getByRole('button', { name: 'Cancel', exact: true }).click();
        } else {
          const close = catalog.getByRole('button', { name: 'Close', exact: true });
          await close.focus(); await page.keyboard.press('Enter');
        }
      } else {
        await catalog.locator('button[data-key="2ND_CALL"]').filter({ hasText: 'Royal Changed Posting Label' }).waitFor();
        // Catalog render completes before its consumer's fire-and-forget options GET.
        // networkidle alone can resolve before that GET is even scheduled in WebKit.
        // Observe the actual consumer result before taking the no-duplicate-on-Close baseline.
        if (recovery === 'async-options-failure') {
          await editor.locator('[data-error]').filter({ hasText: 'Locally injected consumer options failure' }).waitFor();
        } else {
          await page.waitForFunction(() => document.querySelector('dialog.record-workspace select[name="posting_type"] option:checked')?.textContent === 'Royal Changed Posting Label');
        }
        await page.waitForLoadState('networkidle');
        const beforeClose = { catalogReads, memberReads };
        await catalog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.waitForLoadState('networkidle');
        assert.equal(catalogReads, beforeClose.catalogReads, 'Successful callback must not repeat options catalog GET on Close');
        assert.equal(memberReads, beforeClose.memberReads, 'Successful callback must not repeat options member GET on Close');
      }
      await catalog.waitFor({ state: 'detached' });
      await page.waitForLoadState('networkidle');
      if (recovery !== 'async-options-failure') await page.waitForFunction(() => document.querySelector('dialog.record-workspace select[name="posting_type"] option:checked')?.textContent === 'Royal Changed Posting Label');
      else await editor.locator('[data-error]').filter({ hasText: 'Locally injected consumer options failure' }).waitFor();
      observed = { label: await editor.locator('select[name="posting_type"] option:checked').textContent(), postingType: await editor.locator('select[name="posting_type"]').inputValue(), notes: await editor.locator('textarea[name="notes"]').inputValue(), settings: await parent.locator('#unit-minimum-free-people').inputValue(), memberReads, retainedSettings: await parent.locator('#unit-settings-form').evaluate(form => form === window.__catalogSettings && form.querySelector('#unit-minimum-free-people') === window.__catalogMinimum), catalogReads };
      assert.equal(writes.length, 1, 'Read recovery must not replay PUT'); assert.deepEqual(errors, []);
      assert.equal(observed.notes, 'Keep this unrelated posting draft'); assert.equal(observed.postingType, '2ND_CALL'); assert.equal(observed.settings, '3'); assert.equal(observed.retainedSettings, true);
      assert.equal(memberReads - beforeNotificationMemberReads, 1, 'Exactly one notification-triggered options read beyond pre-catalog baseline');
      if (recovery === 'async-options-failure') {
        assert.equal(observed.label, 'Original Posting Label', 'Failed consumer GET must retain last-known choice caption');
        assert.match(await editor.locator('[data-error]').innerText(), /Unable to refresh reference options\. Your draft is preserved\..*Locally injected consumer options failure/);
        assert.equal(failedRead, true);
      } else assert.equal(observed.label, 'Royal Changed Posting Label', 'Confirmed rename refreshes the consuming editor');
      observed.focusAfterClose = await editor.locator('button[data-references]').evaluate(button => ({ referenceOpenerFocused: button === document.activeElement, activeTag: document.activeElement?.tagName, activeName: document.activeElement?.getAttribute('name'), activeText: document.activeElement?.textContent?.slice(0, 120) }));
      results.push({ engine, width, recovery, passed: true, observed, writes, requests, errors });
    } catch (error) { results.push({ engine, width, recovery, passed: false, assertion: error.message, observed, writes, requests, errors }); }
    finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); }
  } } finally { await browser.close(); }
}
for (const [path, expected] of Object.entries(audit.source_sha256)) assert.equal(sha(await readFile('../' + path)), expected, 'Source held throughout');
await writeFile(report, JSON.stringify({ recorded_at_utc: new Date().toISOString(), author: '/root/catalog14_runtime_harness', scope: 'Isolated V14r2 R1 waits actual consumer completion before Close counter snapshot; no product change. Actual Units→Add posting→catalog rename.24 contexts:normal success/Close, ownGET503/Close, ownGET503/keyboardGETretry, consumer-options503 draft/warning. Reference and record overlays; local mutation and otherwise RAM8031GETs. Consumer GET counts establish one reload, not instrumented callback invocation. No main-label/universal propagation or new async-retry UI claim.', source_sha256: audit.source_sha256, test_sha256: sha(await readFile(new URL(import.meta.url))), results }, null, 2) + '\n');
assert.equal(results.length, 24); assert.equal(results.filter(result => !result.passed).length, 0, 'Expected-correct catalog consumer diagnostic');
