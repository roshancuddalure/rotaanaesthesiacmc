import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';

const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const results = [];
async function sourceHashes() {
  const values = {};
  for (const name of ['past-duties.ts', 'services/api.ts', 'import-report.ts']) values[name] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
  return values;
}
const initialSources = await sourceHashes();
const status = { today: '2026-10-21', coverage: [], history: [], duty_types: [{ key: 'night', label: 'Night duty' }], policy: { enabled: true, lookback_months: 6, total_weight: 1, hours24_weight: 2, weekend_weight: 3, group_weight: 4 } };
const member = { id: 'independent-member', canonical_name: 'Dr Independent', active_status: 'active' };
const inspection = { header_row: 1, fields: ['date', 'name', 'duty_type'], sheets: [{ name: 'Duties', headers: ['Date', 'Name', 'Duty'], mapping: { date: 0, name: 1, duty_type: 2 } }] };
const skipped = { key: 'row-3', row: 3, column: 2, action: 'skip', raw: { name: 'Unresolved, member' }, normalized: {}, errors: ['Unknown member'], person_candidates: [], conflicts: [], target_assignment: null };
const preview = { preview_hash: 'independent-reviewed-hash', month: '2026-09', sheet: 'Duties', counts: { create: 1, correct: 0, unchanged: 0, skip: 1 }, warnings: [], rows: [{ key: 'row-2', row: 2, column: 2, action: 'create', raw: { name: 'Dr Independent', date: '2026-09-02' }, normalized: { name: 'Dr Independent', person_id: member.id, date: '2026-09-02', duty_type: 'night' }, errors: [], person_candidates: [], conflicts: [], target_assignment: null }, skipped] };
const workbook = Buffer.from('Independent fixture workbook bytes\n');
const template = Buffer.from('Independent exact template download bytes\n');
const expectedOptions = { month: '2026-09', sheet: 'Duties', layout: 'table', header_row: 1, mapping: { date: 0, name: 1, duty_type: 2 }, resolutions: {}, confirm_corrections: false, confirm_warnings: false };

for (const [engine, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch({ headless: true });
  try {
    for (const width of [320, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 850 }, acceptDownloads: true });
      const page = await context.newPage();
      // Browser automation's request postData may redact uploaded file bytes. Observe the
      // actual production FormData at fetch without replacing or transforming it.
      await page.addInitScript(() => {
        window.__observedMultipart = [];
        const originalFetch = window.fetch;
        window.fetch = function(input, init) {
          if (init?.body instanceof FormData) {
            const form = init.body, file = form.get('file');
            window.__observedMultipart.push({ action: String(input).split('/').at(-1), keys: [...form.keys()].sort(), name: file.name, bytes: file.arrayBuffer().then(buffer => [...new Uint8Array(buffer)]), header_row: form.get('header_row'), options: JSON.parse(form.get('options')), hash: form.get('preview_hash') });
          }
          return originalFetch.apply(this, arguments);
        };
      });
      const errors = [], calls = [], uploads = [];
      let failStatus = 0, failMembers = 0, applyMode = 'success', heldPath = '', release;
      let responseMarker = '';
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/__past-independent', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="outside">Outside action</button><main id="wrapper"><div id="host"></div></main></body></html>' }));
      await page.route('**/api/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        calls.push({ method: request.method(), path });
        const marker = responseMarker;
        if (heldPath === path) { heldPath = ''; await new Promise(resolve => { release = resolve; }); }
        if (path.endsWith('/status')) {
          if (failStatus) { failStatus--; return route.fulfill({ status: 503, json: { detail: 'Coverage unavailable independently' } }); }
          return route.fulfill({ json: marker ? { ...status, coverage: [{ month: marker, assignments: 1, members: 1, days_with_records: 1, latest_duty_date: '2026-09-02', coverage: 'observed' }] } : status });
        }
        if (path === '/api/v1/admin/members') {
          if (failMembers) { failMembers--; return route.fulfill({ status: 503, json: { detail: 'Member list unavailable independently' } }); }
          return route.fulfill({ json: [member] });
        }
        if (path.endsWith('/recorded')) return route.fulfill({ json: { items: [], truncated: false } });
        if (path.endsWith('/template')) return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: template });
        if (request.method() === 'POST' && /\/(inspect|preview|apply)$/.test(path)) {
          const form = await new Request('http://independent.invalid', { method: 'POST', headers: { 'content-type': request.headers()['content-type'] }, body: request.postDataBuffer() }).formData();
          const file = form.get('file');
          uploads.push({ action: path.split('/').at(-1), keys: [...form.keys()].sort(), name: file.name, bytes: Buffer.from(await file.arrayBuffer()), header_row: form.get('header_row'), options: JSON.parse(form.get('options')), hash: form.get('preview_hash') });
          if (path.endsWith('/inspect')) return route.fulfill({ json: inspection });
          if (path.endsWith('/preview')) return route.fulfill({ json: preview });
          if (applyMode === 'uncertain') return route.fulfill({ status: 503, json: { detail: 'Apply outcome unknown independently' } });
          return route.fulfill({ json: { counts: preview.counts } });
        }
        throw new Error(`Unexpected request ${request.method()} ${path}`);
      });
      await page.goto(`${base}/__past-independent`);
      const host = page.locator('#host'), outside = page.locator('#outside');
      const button = action => host.locator(`[data-past="${action}"]`);
      async function mount() { await page.evaluate(async () => { const { mountPastDuties } = await import('/src/past-duties.ts'); await mountPastDuties(document.querySelector('#host')); }); }
      async function keyboard(control) { await control.focus(); await page.keyboard.press('Enter'); }
      async function idle() { await page.waitForFunction(() => ![...document.querySelectorAll('#host [role="status"]')].some(element => /Working|Loading past duties/.test(element.textContent || ''))); }
      async function waitHeld() { for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(release, 'Held request actually reached fixture'); }
      async function focusIs(control, message) { await page.waitForFunction(selector => document.querySelector(selector) === document.activeElement, await control.evaluate(element => element.id ? `#${element.id}` : `[data-past="${element.dataset.past}"]`)); assert.equal(await control.evaluate(element => element === document.activeElement), true, message); }

      for (const failed of ['status', 'members']) {
        if (failed === 'status') failStatus = 1; else failMembers = 1;
        await mount();
        await host.getByRole('alert').filter({ hasText: failed === 'status' ? 'Coverage unavailable independently' : 'Member list unavailable independently' }).waitFor();
        const before = calls.length;
        await keyboard(host.getByRole('button', { name: 'Try again', exact: true }));
        await button('template').waitFor();
        assert.ok(calls.slice(before).length >= 2);
        assert.ok(calls.slice(before).every(call => call.method === 'GET'), 'Initial retry only repeats safe reads');
      }
      // Hold an old initial load and remount the exact same host before it resolves.
      responseMarker = 'STALE-INITIAL'; heldPath = '/api/v1/admin/past-duties/status'; release = undefined;
      await page.evaluate(() => { window.__oldMount = import('/src/past-duties.ts').then(module => module.mountPastDuties(document.querySelector('#host'))); });
      await waitHeld(); responseMarker = ''; await mount();
      await outside.focus(); release(); await page.evaluate(() => window.__oldMount);
      assert.equal(await host.getByText('STALE-INITIAL', { exact: true }).count(), 0);
      await focusIs(outside, 'Superseded load preserves outside focus');
      // A detached host must never receive the late failure UI either.
      heldPath = '/api/v1/admin/past-duties/status'; release = undefined; failStatus = 1;
      await page.evaluate(() => { window.__detachedHost = document.querySelector('#host'); window.__detachedMount = import('/src/past-duties.ts').then(module => module.mountPastDuties(window.__detachedHost)); });
      await waitHeld();
      await page.evaluate(() => { window.__detachedHost.remove(); window.__detachedMarkup = window.__detachedHost.innerHTML; const replacement = document.createElement('div'); replacement.id = 'host'; document.querySelector('#wrapper').append(replacement); });
      release(); await page.evaluate(() => window.__detachedMount);
      assert.equal(await page.evaluate(() => window.__detachedHost.innerHTML === window.__detachedMarkup), true, 'Detached load leaves disconnected host untouched');
      await mount();

      const downloadPromise = page.waitForEvent('download'); await keyboard(button('template'));
      const download = await downloadPromise; assert.equal(download.suggestedFilename(), 'past-duties-template.xlsx'); assert.deepEqual(await readFile(await download.path()), template); await idle();
      async function inspectPreview() {
        await button('file').setInputFiles({ name: 'independent-duties.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbook });
        await keyboard(button('inspect')); await button('preview').waitFor(); await idle();
        await keyboard(button('preview')); await button('apply').waitFor(); await idle();
      }
      await inspectPreview();
      const rejectionPromise = page.waitForEvent('download'); await keyboard(button('rejected'));
      const rejected = await rejectionPromise;
      assert.equal(rejected.suggestedFilename(), 'past_duty_rejected_rows.csv');
      const csv = '\ufeff"Sheet","Source row","Action","Original","Normalized","Issues"\r\n"","3","skip","{""name"":""Unresolved, member""}","{}","[""Unknown member""]"';
      assert.equal(await readFile(await rejected.path(), 'utf8'), csv); await idle();
      // A confirmed apply followed by failed status GET must preserve its saved outcome.
      failStatus = 1; heldPath = '/api/v1/admin/past-duties/apply'; release = undefined;
      const applyBefore = uploads.filter(upload => upload.action === 'apply').length;
      await keyboard(button('apply')); await waitHeld();
      assert.equal(await button('apply').isDisabled(), true, 'Pending apply is natively disabled');
      await page.keyboard.press('Enter');
      release(); await idle();
      assert.equal(uploads.filter(upload => upload.action === 'apply').length, applyBefore + 1, 'Held apply cannot submit twice');
      await host.getByRole('status').filter({ hasText: 'Recorded 1 new duties' }).waitFor();
      await host.getByRole('alert').filter({ hasText: 'Coverage unavailable independently' }).waitFor();
      assert.equal(await button('apply').count(), 0, 'Confirmed apply cannot be repeated from retained preview');
      const beforeRecovery = calls.length;
      failStatus = 1;
      await keyboard(button('refresh-status')); await idle();
      await host.getByRole('alert').filter({ hasText: 'Coverage unavailable independently' }).waitFor();
      await host.getByRole('status').filter({ hasText: 'Recorded 1 new duties' }).waitFor();
      await focusIs(button('refresh-status'), 'Failed safe read retry preserves its retry control');
      await keyboard(button('refresh-status')); await idle();
      assert.ok(calls.slice(beforeRecovery).length > 0);
      assert.ok(calls.slice(beforeRecovery).every(call => call.method === 'GET'), 'Confirmed-save recovery never replays apply');
      await host.getByRole('status').filter({ hasText: 'Recorded 1 new duties' }).waitFor();
      // An uncertain mutation is not silently considered reviewed or replayed.
      await mount(); await inspectPreview(); applyMode = 'uncertain';
      const uncertainBefore = uploads.filter(upload => upload.action === 'apply').length;
      await keyboard(button('apply')); await idle();
      await host.getByRole('status').filter({ hasText: 'Apply outcome unknown independently' }).waitFor();
      await host.getByText('Selections changed. Preview again before applying.', { exact: true }).first().waitFor();
      await keyboard(button('apply')); await idle();
      assert.equal(uploads.filter(upload => upload.action === 'apply').length, uncertainBefore + 1, 'Unknown outcome requires a fresh preview; no automatic or repeated apply');
      await focusIs(button('apply'), 'Blocked apply retains keyboard focus');

      // An apply may finish after navigating away. It must not issue a follow-up read
      // or replace the newer mount, even though the server accepted the request.
      applyMode = 'success'; await mount(); await inspectPreview();
      heldPath = '/api/v1/admin/past-duties/apply'; release = undefined;
      await keyboard(button('apply')); await waitHeld();
      await mount(); await outside.focus();
      const statusReadsBeforeLateApply = calls.filter(call => call.path.endsWith('/status')).length;
      const lateApplyResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/apply'));
      release(); await lateApplyResponse; await page.waitForLoadState('networkidle');
      assert.equal(calls.filter(call => call.path.endsWith('/status')).length, statusReadsBeforeLateApply, 'Superseded apply does not start old readback');
      assert.equal(await host.getByRole('region', { name: 'Last applied import' }).count(), 0, 'Superseded apply cannot inject its outcome into the newer mount');
      await focusIs(outside, 'Superseded apply cannot take focus from current UI');

      const actualForms = await page.evaluate(async () => Promise.all(window.__observedMultipart.map(async upload => ({ ...upload, bytes: await upload.bytes }))));
      assert.equal(actualForms.length, uploads.length, 'Each actual FormData is observed and reaches intercepted transport');
      for (const upload of actualForms) {
        assert.deepEqual(upload.keys, ['file', 'header_row', 'options', 'preview_hash']);
        assert.equal(upload.name, 'independent-duties.xlsx'); assert.deepEqual(Buffer.from(upload.bytes), workbook); assert.equal(upload.header_row, '1');
        assert.deepEqual(upload.options, upload.action === 'inspect' ? { ...expectedOptions, sheet: '', mapping: {} } : expectedOptions);
        assert.equal(upload.hash, upload.action === 'apply' ? preview.preview_hash : '');
      }
      for (const upload of uploads) { assert.deepEqual(upload.options, upload.action === 'inspect' ? { ...expectedOptions, sheet: '', mapping: {} } : expectedOptions); assert.equal(upload.hash, upload.action === 'apply' ? preview.preview_hash : ''); }
      assert.deepEqual(errors, []);
      results.push({ engine, width, initialStatusRetry: true, initialMembersRetry: true, supersededInitialIgnored: true, detachedFailureIgnored: true, exactTemplateBytes: true, exactRejectedCsvBytes: true, exactMultipartAndPreviewHash: true, duplicatePendingApplyBlocked: true, confirmedSaveSurvivesFailedReadback: true, repeatedReadbackFailureRetainsOutcomeAndFocus: true, readbackRetryGetOnly: true, uncertainApplyRequiresPreview: true, supersededApplySkipsReadbackAndFocus: true, interceptedUploads: uploads.length, liveWrites: 0, pageErrors: errors.length });
      await context.close();
    }
  } finally { await browser.close(); }
}
const sources = await sourceHashes();
assert.deepEqual(sources, initialSources, 'Sources remain stable throughout independent run');
await writeFile(new URL('../../docs/premium-ui/qa-past-recovery-independent.json', import.meta.url), JSON.stringify({ createdAt: new Date().toISOString(), scope: 'Actual imported component, production CSS and services/api multipart transport with all API calls intercepted. Chromium/Firefox/WebKit at 320/1280 emulated widths. Workbook bytes are a transport fixture, not a backend Excel parser test. No live writes, physical-device or screen-reader claim.', sources, results }, null, 2) + '\n');
console.log(`${results.length} independent past-duty recovery cases passed`);
