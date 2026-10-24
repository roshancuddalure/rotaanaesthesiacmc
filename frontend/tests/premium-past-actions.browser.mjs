import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';

const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const results = [];
async function hashes() {
  const result = {};
  for (const name of ['past-duties.ts', 'services/api.ts', 'ui.ts', 'import-report.ts', 'styles.css', 'premium-theme.css']) result[name] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
  return result;
}
const initial = await hashes();
const policy = { enabled: true, lookback_months: 6, total_weight: 1, hours24_weight: 2, weekend_weight: 3, group_weight: 4 };
const members = [{ id: 'member-a', canonical_name: 'Dr Alex A', active_status: 'active' }, { id: 'member-b', canonical_name: 'Dr Alex B', active_status: 'active' }];
const inspection = { header_row: 1, fields: ['date', 'name', 'duty_type'], sheets: ['Duties', 'Archive'].map(name => ({ name, headers: ['Date', 'Name', 'Duty'], mapping: { date: 0, name: 1, duty_type: 2 } })) };
const batchId = 'history special/<batch>&';
const status = { today: '2026-10-21', policy, coverage: [], duty_types: [{ key: 'night', label: 'Night duty' }], history: [{ id: batchId, filename: 'Old <script> history.xlsx', month: '2026-09', sheet: 'Duties', actor: 'Admin', at: null, counts: { create: 1 } }] };
const fileBytes = Buffer.from('Past duty transport fixture, not a parsed workbook');
for (const [engine, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();
  try {
    for (const width of [320, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 850 } });
      const page = await context.newPage(), calls = [], uploads = [], saves = [], errors = [];
      let policyFailure = 0, historyFailure = false, templateFailure = true, hashNumber = 0;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/__past-actions', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main><div id="host"></div></main></body></html>' }));
      await page.route('**/api/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        calls.push({ path, method: request.method() });
        if (path.endsWith('/status')) return route.fulfill({ json: status });
        if (path === '/api/v1/admin/members') return route.fulfill({ json: members });
        if (path.endsWith('/recorded')) return route.fulfill({ json: { items: [], truncated: false } });
        if (path.endsWith('/template')) return templateFailure
          ? route.fulfill({ status: 503, json: { detail: 'Template temporarily unavailable' } })
          : route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: fileBytes });
        if (path.endsWith('/policy')) {
          saves.push(request.postDataJSON());
          if (policyFailure) return route.fulfill({ status: policyFailure, json: { detail: 'Policy rejected; retained values' } });
          return route.fulfill({ json: {} });
        }
        if (path.includes('/history/')) {
          assert.equal(path.split('/history/')[1], encodeURIComponent(batchId));
          if (historyFailure) return route.fulfill({ status: 503, json: { detail: 'History unavailable; retry View Rows' } });
          return route.fulfill({ json: { filename: '<img src=x onerror=alert(1)> history', rows: [{ row: 7, column: 2, action: 'create', raw: { name: '<script>window.injected=true</script>' }, normalized: { name: 'Safe & visible' }, before: { name: '<b>Prior member</b>', status: 'superseded' }, errors: [] }] } });
        }
        if (/\/(inspect|preview)$/.test(path)) {
          const form = await new Request('http://fixture.invalid', { method: 'POST', headers: { 'content-type': request.headers()['content-type'] }, body: request.postDataBuffer() }).formData();
          const action = path.split('/').at(-1), options = JSON.parse(form.get('options'));
          uploads.push({ action, options, hash: form.get('preview_hash'), name: form.get('file').name });
          if (action === 'inspect') return route.fulfill({ json: inspection });
          const resolution = options.resolutions['row-2'] || {}, skipped = resolution.action === 'skip', matched = Boolean(resolution.person_id);
          return route.fulfill({ json: { preview_hash: `review-${++hashNumber}`, month: options.month, sheet: options.sheet, counts: { create: 0, correct: skipped ? 0 : 1, unchanged: 0, skip: skipped ? 1 : 0, needs_review: matched || skipped ? 0 : 1 }, warnings: [{ row: 2, code: 'source', message: 'Review warning' }], rows: [{ key: 'row-2', row: 2, column: 2, action: skipped ? 'skip' : matched ? 'correct' : 'needs_review', raw: { name: 'Dr Alex', date: '2026-09-02' }, normalized: matched ? { person_id: resolution.person_id, name: members.find(member => member.id === resolution.person_id).canonical_name } : {}, resolution_status: matched ? 'matched' : 'ambiguous', resolution_reason: 'Several members match', person_candidates: members.map(member => ({ id: member.id, name: member.canonical_name })), errors: matched || skipped ? [] : ['Choose member'], conflicts: [], target_assignment: null }] } });
        }
        throw new Error(`Unexpected API ${request.method()} ${path}`);
      });
      await page.goto(`${base}/__past-actions`);
      await page.evaluate(async () => { const { mountPastDuties } = await import('/src/past-duties.ts'); await mountPastDuties(document.querySelector('#host')); });
      const host = page.locator('#host'), control = action => host.locator(`[data-past="${action}"]`);
      async function idle() { await page.waitForFunction(() => ![...document.querySelectorAll('#host [role="status"]')].some(node => /Working|Loading past duties/.test(node.textContent || ''))); }
      async function act(action) { await control(action).click(); await idle(); }
      async function chooseMember() { await host.locator('[data-pick-member="member-a"]').click(); await idle(); }
      async function preview() { await act('preview'); }
      async function lastOptions() { return structuredClone(uploads.at(-1).options); }
      await control('file').setInputFiles({ name: 'actions.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fileBytes });
      await act('inspect'); assert.equal(uploads.at(-1).action, 'inspect'); assert.equal(uploads.at(-1).name, 'actions.xlsx');
      await preview(); await host.getByText('Several members fit', { exact: true }).waitFor();
      const rejectedDownload = page.waitForEvent('download');
      await act('rejected');
      const rejected = await rejectedDownload;
      assert.equal(rejected.suggestedFilename(), 'past_duty_rejected_rows.csv');
      assert.equal(await rejected.failure(), null);
      assert.equal(await readFile(await rejected.path(), 'utf8'), '\ufeff"Sheet","Source row","Action","Original","Normalized","Issues"\r\n"","2","needs_review","{""name"":""Dr Alex"",""date"":""2026-09-02""}","{}","[""Choose member""]"');
      await chooseMember(); assert.deepEqual((await lastOptions()).resolutions, { 'row-2': { person_id: 'member-a' } });
      await host.getByRole('button', { name: 'Undo member choice' }).click(); await idle(); assert.deepEqual((await lastOptions()).resolutions, { 'row-2': { person_id: '' } });
      await host.getByRole('button', { name: 'Skip this row' }).click(); await idle(); assert.equal((await lastOptions()).resolutions['row-2'].action, 'skip');
      await host.getByRole('button', { name: 'Include this row again' }).focus(); await page.keyboard.press('Enter'); await idle(); assert.equal((await lastOptions()).resolutions['row-2'].action, '');
      await chooseMember();
      await host.locator('[data-past-edit="row-2"] summary').click();
      await control('confirm-warnings').check(); await control('confirm-corrections').check();
      assert.equal(await host.locator('[data-past-edit="row-2"]').getAttribute('open'), '');
      await host.locator('[data-past-row="row-2"][data-resolution="duty_type"]').selectOption('night');
      assert.equal(await control('confirm-warnings').isChecked(), false); assert.equal(await control('confirm-corrections').isChecked(), false);
      assert.match(await host.locator('#past-apply-blocker').innerText(), /Selections changed/);
      const beforeBlocked = uploads.length; await act('apply'); assert.equal(uploads.length, beforeBlocked, 'Stale preview never submitted');
      await preview(); assert.equal((await lastOptions()).resolutions['row-2'].duty_type, 'night'); assert.equal(uploads.at(-1).hash, '');
      // Each configuration change removes the old preview and clears its corrections and confirmations.
      const invalidations = [
        ['mapping', () => host.locator('[data-past-field="name"]').selectOption('0')],
        ['sheet', () => control('sheet').selectOption('Archive')],
        ['month', async () => { await control('month').fill('2026-08'); await control('month').press('Tab'); }],
        ['layout', () => control('layout').selectOption('matrix')],
        ['header', async () => { await control('header').fill('2'); await control('header').press('Tab'); }],
      ];
      for (const [name, change] of invalidations) {
        if (await host.locator('[data-pick-member="member-a"]').count()) await chooseMember();
        await control('confirm-warnings').check(); await control('confirm-corrections').check();
        await change();
        assert.equal(await control('apply').count(), 0, `${name} invalidates review`);
        if (name === 'header') await act('inspect');
        await preview();
        assert.deepEqual((await lastOptions()).resolutions, {}, `${name} clears old resolutions`);
        assert.equal((await lastOptions()).confirm_warnings, false); assert.equal((await lastOptions()).confirm_corrections, false); assert.equal(uploads.at(-1).hash, '');
      }
      const previewCalls = uploads.length;
      await act('template'); await host.getByRole('status').filter({ hasText: 'Template temporarily unavailable' }).waitFor();
      await host.getByText('actions.xlsx', { exact: true }).waitFor(); assert.equal(await control('apply').count(), 1); assert.equal(uploads.length, previewCalls);
      templateFailure = false;
      const templateDownload = page.waitForEvent('download');
      await control('template').focus(); await page.keyboard.press('Enter'); await idle();
      const template = await templateDownload;
      assert.equal(template.suggestedFilename(), 'past-duties-template.xlsx');
      assert.equal(await template.failure(), null);
      assert.deepEqual(await readFile(await template.path()), fileBytes);
      assert.equal(await control('apply').count(), 1); assert.equal(uploads.length, previewCalls);
      historyFailure = true; const viewRows = host.locator('[data-past-batch]');
      await viewRows.click(); await idle(); await host.getByRole('status').filter({ hasText: 'History unavailable' }).waitFor(); assert.equal(await control('apply').count(), 1);
      historyFailure = false; await viewRows.focus(); await page.keyboard.press('Enter'); await idle();
      await host.getByRole('heading', { name: '<img src=x onerror=alert(1)> history', exact: true }).waitFor();
      assert.equal(await host.locator('img,script').count(), 0); assert.equal(await page.evaluate(() => window.injected), undefined);
      await host.getByText('name: <script>window.injected=true</script>', { exact: true }).waitFor();
      assert.equal(await control('apply').count(), 1); assert.equal(uploads.length, previewCalls);
      await host.locator('[data-policy="lookback_months"]').fill('9'); await control('effective-from').fill('2026-11-01'); await control('effective-from').press('Tab');
      for (const failure of [422, 503, 0]) {
        policyFailure = failure; await act('save-policy');
        assert.deepEqual(saves.at(-1), { policy: { ...policy, lookback_months: 9 }, effective_from: '2026-11-01' });
        assert.equal(await host.locator('[data-policy="lookback_months"]').inputValue(), '9'); assert.equal(await control('effective-from').inputValue(), '2026-11-01');
        assert.equal(await control('apply').count(), 1);
      }
      await host.getByRole('status').filter({ hasText: 'Fairness settings saved, effective 2026-11-01' }).waitFor();
      assert.match(await host.locator('#past-apply-blocker').innerText(), /Selections changed/);
      assert.equal(calls.filter(call => call.path.endsWith('/apply')).length, 0);
      assert.deepEqual(errors, []);
      results.push({ engine, width, memberChoiceUndo: true, skipIncludeExactRepreview: true, rowEditRetained: true, staleRowChangeBlocked: true, configInvalidations: invalidations.map(([name]) => name), rejectedCsvFilenameAndExactContent: true, templateFailureRetainsFileAndPreview: true, templateKeyboardRetryExactDownloadedBytes: true, exactEncodedHistoryId: true, escapedHistoryMarkup: true, historyReadRetryRetainsPreview: true, exactPolicyPayload422503Success: true, policySaveInvalidatesReview: true, interceptedUploads: uploads.length, interceptedPolicySaves: saves.length, liveWrites: 0, pageErrors: errors.length });
      await context.close();
    }
  } finally { await browser.close(); }
}
const sources = await hashes(); assert.deepEqual(sources, initial, 'App sources stable during action checks');
await writeFile(new URL('../../docs/premium-ui/qa-past-actions.json', import.meta.url), JSON.stringify({ createdAt: new Date().toISOString(), command: 'node tests/premium-past-actions.browser.mjs (frontend directory)', testSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'), scope: 'Actual past-duties component, services/api and production CSS. All API responses intercepted. Workbook and downloaded template are transport fixtures only, not Excel parser or real template validity tests. Rejected CSV bytes are verified against the controlled rejected row. Browser emulation; no physical device, actual screen reader or live write claim. Apply success/recovery is separate and not claimed by these action cases.', sources, results }, null, 2) + '\n');
console.log(`${results.length} past-duty action cases passed`);
