import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';
import { observeImportUploads, observedImportFile } from './fixtures/import-upload-observer.mjs';

const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const engines = process.env.PROGRESS_ENGINES?.split(',') || ['chromium', 'firefox', 'webkit'];
const widths = process.env.PROGRESS_WIDTHS?.split(',').map(Number) || [320, 1280];
const surfaces = process.env.PROGRESS_SURFACES?.split(',') || ['workbook', 'csv', 'units', 'leave'];
const sourcePaths = ['src/ui.ts', 'src/member-import.ts', 'src/member-workspace.ts', 'src/operational-import.ts', 'src/services/api.ts', 'src/styles.css', 'src/premium-theme.css', 'tests/premium-leave-import-status-progress-integrated.browser.mjs', 'tests/fixtures/import-upload-observer.mjs'];
const sha = value => createHash('sha256').update(value).digest('hex');
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async name => [name, sha(await readFile(name))])));
const initial = await hashes(), results = [];
let activeCase;
process.on('uncaughtExceptionMonitor', error => {
  writeFileSync(process.env.PROGRESS_FAILURE_REPORT || '../tmp/leave-import-status-progress-integrated-failure.json', JSON.stringify({ recorded_at_utc: new Date().toISOString(), source_sha256: initial, status: 'Diagnostic failure; not a product-defect conclusion', error: error.stack, active_case: activeCase, completed_results: results }, null, 2) + '\n');
});
const bytes = Buffer.from('canonical_name,call_level\nImported Same,2ND_CALL\n');
const inputFile = name => ({ name, mimeType: 'text/csv', buffer: bytes });
const members = ['a', 'b'].map(id => ({ id, canonical_name: `Dr Member ${id.toUpperCase()}`, active_status: 'active', call_level: '2ND_CALL', aliases: [], designations: [], call_level_changes: [], revision: 'one' }));
const candidates = members.map(m => ({ id: m.id, name: m.canonical_name, status: 'active', call_level: '2ND_CALL' }));
const inspection = { header_row: 1, fields: ['name', 'call_level'], sheets: [{ name: 'Members', headers: ['canonical_name', 'call_level'], mapping: { name: 0, call_level: 1 } }] };
const activate = async (page, locator) => { await locator.focus(); await page.keyboard.press('Enter'); };
const multipart = async request => new Request('http://fixture.invalid', { method: 'POST', headers: { 'content-type': request.headers()['content-type'] }, body: request.postDataBuffer() }).formData();
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const awaitGate = async (gate, label, host) => {
  let timer;
  try { await Promise.race([gate.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label}: fixture gate timed out`)), 12000); })]); }
  catch (error) { throw Error(`${error.message}. UI: ${await host.innerText().catch(() => '(page closed)')}`); }
  finally { clearTimeout(timer); }
};

async function stage(host, index) {
  const expected = Array.from({ length: 4 }, (_, i) => i < index ? 'done' : i === index ? 'current' : 'upcoming');
  await host.locator('[data-import-steps] .ds-steps__item').first().waitFor();
  await host.page().waitForFunction(({ selector, expected }) => {
    const root = document.querySelector(selector);
    return root && JSON.stringify([...root.querySelectorAll('[data-import-steps] .ds-steps__item')].map(n => n.dataset.state)) === JSON.stringify(expected);
  }, { selector: await host.evaluate(n => n.id ? `#${n.id}` : `dialog.${[...n.classList].join('.')}`), expected });
  assert.deepEqual(await host.locator('[data-import-steps] .ds-steps__item').evaluateAll(nodes => nodes.map(n => n.dataset.state)), expected);
  assert.equal(await host.locator('[data-import-steps] [aria-current="step"]').count(), index < 4 ? 1 : 0);
}

for (const engine of engines) {
  const browser = await ({ chromium, firefox, webkit })[engine].launch({ headless: true });
  try { for (const width of widths) for (const surface of surfaces) {
    const variants = surface === 'workbook' ? ['ordinary-remount', 'replayed-remount', 'ordinary-throw', 'replayed-throw'] : ['ordinary-throw'];
    for (const variant of variants) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 568 : 900 } });
      await observeImportUploads(page);
      page.setDefaultTimeout(12000);
      const errors = [], previews = [], applies = [], dialogs = [], columnFiles = [];
      const requests = []; activeCase = { engine, width, surface, variant, requests, previews, applies, dialogs };
      let firstColumns = true, holdColumns, failPreview = false, holdApply, callbackMode = variant, acceptDialog = true;
      page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', async dialog => { dialogs.push(dialog.message()); await (acceptDialog ? dialog.accept() : dialog.dismiss()); });
      await page.route('**/__progress_recovery', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open import</button><main id="host"></main></body></html>' }));
      await page.route('**/api/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        requests.push({ method: request.method(), path });
        if (request.method() === 'GET') {
          if (path.endsWith('/admin/members')) return route.fulfill({ json: members });
          if (path.endsWith('/normalization/units')) return route.fulfill({ json: [] });
          throw Error(`Unexpected GET ${path}`);
        }
        if (path.endsWith('/apply')) {
          const payload = surface === 'workbook' ? await multipart(request) : request.postDataJSON();
          if (surface === 'workbook') {
            assert.equal(payload.get('file').name, 'mapped.csv');
            const observed = await observedImportFile(page, path);
            assert.equal(observed.filename, 'mapped.csv');
            assert.equal(observed.bytes, bytes.toString());
            if (engine !== 'webkit') assert.equal(await payload.get('file').text(), bytes.toString());
            applies.push({ options: JSON.parse(payload.get('options')), preview_hash: payload.get('preview_hash') });
          } else applies.push(payload);
          const gate = holdApply; assert.ok(gate, 'Apply must be explicitly held by the scenario');
          gate.started.resolve(); await awaitGate(gate.release, 'Apply fixture release', page.locator('body'));
          if (gate.fail) return route.fulfill({ status: 503, json: { detail: 'Apply diagnostic unavailable' } });
          return route.fulfill({ json: { counts: { create: 0, update: 1, unchanged: 0, skip: 0 }, created: 0, updated: 1, unchanged: 0, archived: 0, excluded: 0, removed: 0, batch_id: 'confirmed-batch', members: [], replayed: variant.startsWith('replayed') } });
        }
        const form = await multipart(request);
        const observed = await observedImportFile(page, path);
        assert.equal(observed.filename, form.get('file').name);
        assert.equal(observed.bytes, bytes.toString(), 'Actual File passed to native fetch retains bytes');
        if (engine !== 'webkit') assert.equal(await form.get('file').text(), bytes.toString(), 'Intercepted multipart file bytes retained');
        if (path.endsWith('/columns') || path.endsWith('/inspect')) {
          columnFiles.push(form.get('file').name);
          if (holdColumns) { const gate = holdColumns; gate.started.resolve(); await awaitGate(gate.release, 'Columns fixture release', page.locator('body')); holdColumns = undefined; }
          if (firstColumns) { firstColumns = false; return route.fulfill({ status: 503, json: { detail: 'Columns diagnostic unavailable' } }); }
          if (surface === 'workbook') return route.fulfill({ json: inspection });
          return route.fulfill({ json: { headers: ['canonical_name', 'call_level'], fields: ['member_name', 'posting_type'], suggested: { canonical_name: 'member_name' } } });
        }
        assert.ok(path.endsWith('/preview'), `Unexpected POST ${path}`);
        const settings = surface === 'workbook' ? JSON.parse(form.get('options')) : surface === 'csv' ? { corrections: JSON.parse(form.get('corrections')), mapping: JSON.parse(form.get('mapping')), mode: form.get('mode') } : { ...JSON.parse(form.get('settings_json')), mode: form.get('mode'), month: form.get('month') };
        previews.push({ file: form.get('file').name, bytes: sha(observed.bytes), byte_observation: engine === 'webkit' ? 'native fetch FormData File; interception protocol omits file bytes' : 'native fetch FormData File and intercepted multipart', settings });
        if (failPreview) { failPreview = false; return route.fulfill({ status: 503, json: { detail: 'Preview diagnostic unavailable' } }); }
        const chosen = surface === 'workbook' ? settings.resolutions['2'] : surface === 'csv' ? settings.corrections['2']?.member_id : settings.corrections['CSV:2']?.person_id;
        const selected = members.find(m => m.id === chosen), name = selected?.canonical_name;
        if (surface === 'workbook') return route.fulfill({ json: { preview_hash: 'reviewed-hash', counts: { create: 0, update: selected ? 1 : 0, needs_review: selected ? 0 : 1 }, rows: [{ row: 2, raw: { name: 'Imported Same' }, normalized: { name: 'Imported Same' }, target_id: chosen || null, target_name: name || null, action: selected ? 'update' : 'needs_review', changes: {}, errors: [], candidates, resolution_status: selected ? 'matched' : 'ambiguous', resolution_method: 'member_id' }] } });
        if (surface === 'csv') return route.fulfill({ json: { id: 'reviewed-preview', mode: settings.mode, headers: ['canonical_name', 'call_level'], rows: [{ row_number: 2, values: { canonical_name: 'Imported Same', ...(chosen ? { member_id: chosen } : {}) }, action: selected ? 'update' : 'needs_review', errors: [], suggestions: candidates, person_id: chosen || null, before: selected ? { canonical_name: name, active_status: 'active', call_level: '2ND_CALL' } : null, after: { canonical_name: 'Imported Same', active_status: 'active', call_level: '2ND_CALL' }, revision: selected ? 'one' : null }], missing: [] } });
        return route.fulfill({ json: { id: 'reviewed-preview', kind: surface, month: settings.month, mode: settings.mode, headers: ['canonical_name', 'call_level'], fields: ['member_name'], replacement_scope: [], rows: [{ key: 'CSV:2', source: { sheet: 'CSV', row: 2 }, original: { canonical_name: 'Imported Same' }, values: { member_name: 'Imported Same', starts_on: '2026-10-01', ends_on: '2026-10-02', posting_type: '2ND_CALL', leave_type: 'CL', leave_slot: 'FULL_DAY', status: 'approved' }, after: { person_id: chosen || null, posting_type: '2ND_CALL', starts_on: '2026-10-01' }, action: selected ? 'create' : 'needs_review', issues: selected ? [] : ['Choose member'], warnings: [], person_match: { state: selected ? 'matched' : 'ambiguous', status: selected ? 'matched' : 'ambiguous', person_id: chosen || null, canonical_name: name, method: 'member_id', candidates, warnings: [] } }] } });
      });
      await page.goto(base + '/__progress_recovery');
      await page.evaluate(async ({ surface, callbackMode }) => {
        if (surface === 'workbook') {
          const m = await import('/src/member-import.ts'); m.resetMemberImport();
          m.mountMemberImport(document.querySelector('#host'), async () => {
            if (callbackMode.endsWith('remount')) { const next = document.createElement('main'); next.id = 'host'; document.querySelector('#host').replaceWith(next); m.mountMemberImport(next, async () => {}); }
            throw Error('Confirmed callback unavailable');
          });
        } else document.querySelector('#open').onclick = async () => {
          if (surface === 'csv') (await import('/src/member-workspace.ts')).openMemberCsvImport(() => { throw Error('Confirmed callback unavailable'); });
          else (await import('/src/operational-import.ts')).openOperationalImport(surface, '2026-10', () => { throw Error('Confirmed callback unavailable'); }, true);
        };
      }, { surface, callbackMode });
      if (surface !== 'workbook') await activate(page, page.locator('#open'));
      const host = surface === 'workbook' ? page.locator('#host') : page.locator('dialog').last();
      const message = () => host.locator(surface === 'workbook' ? '.member-import > p[role=status]' : surface === 'csv' ? '#csv-message' : '[data-message]');
      const preview = () => surface === 'workbook' ? host.locator('[data-mi=preview]') : host.getByRole('button', { name: surface === 'csv' ? 'Preview import' : 'Preview and normalize', exact: true });
      const apply = () => host.locator(surface === 'workbook' ? '[data-mi=apply]' : '[data-apply]');
      const columns = () => host.locator(surface === 'workbook' ? '[data-mi-field]' : surface === 'csv' ? '[data-map-column]' : '[data-map]');
      const successfulPreview = async () => {
        const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/preview') && r.status() === 200);
        await activate(page, preview()); await response;
        await page.waitForFunction(() => !document.querySelector('input[type=file]:disabled') && !/Reading and validating CSV|Parsing and normalizing records|Working\u2026/.test(document.body.innerText));
      };
      if (surface === 'workbook') await activate(page, host.locator('summary').first());
      await stage(host, 0);
      if (surface !== 'workbook') await host.locator('[name=mode]').selectOption(surface === 'csv' ? 'roster_sync' : 'update_matching');
      await host.locator('input[type=file]').setInputFiles(inputFile('initial.csv'));
      if (surface === 'workbook') await activate(page, host.locator('[data-mi=inspect]'));
      await message().filter({ hasText: 'Columns diagnostic unavailable' }).waitFor();
      assert.match(await message().innerText(), /retained/i); await stage(host, 0);
      if (surface === 'workbook') { await activate(page, host.locator('[data-mi=inspect]')); await columns().first().waitFor(); await stage(host, 1); }
      else { await successfulPreview(); await host.locator('[data-pick-member=b]').waitFor(); await stage(host, 2); assert.equal(previews.at(-1).file, 'initial.csv'); }
      const columnGate = { started: deferred(), release: deferred() }; holdColumns = columnGate;
      await host.locator('input[type=file]').setInputFiles(inputFile('mapped.csv'));
      if (surface === 'workbook') await activate(page, host.locator('[data-mi=inspect]'));
      await awaitGate(columnGate.started, 'Replacement columns', host);
      await stage(host, 0); assert.equal(await columns().count(), 0, 'Abandoned mapping controls removed on replacement');
      assert.equal(await host.locator('.member-match').count(), 0);
      columnGate.release.resolve(); await columns().first().waitFor({ state: 'attached' }); await stage(host, 1);
      if (surface === 'workbook') await host.locator('[data-mi-field=call_level]').selectOption('');
      else if (surface === 'csv') { await activate(page, host.locator('#csv-column-mapping summary')); await host.locator('[data-map-column="0"]').selectOption('canonical_name'); await host.locator('[data-map-column="1"]').selectOption(''); }
      else { await host.locator('[data-map="0"]').selectOption('member_name'); await host.locator('[name=date_format]').selectOption('DMY'); }
      await successfulPreview(); await host.locator('[data-pick-member=b]').waitFor(); await stage(host, 2);
      failPreview = true; await activate(page, host.locator('[data-pick-member=b]'));
      await message().filter({ hasText: 'Preview diagnostic unavailable' }).waitFor();
      assert.match(await message().innerText(), /retained/); assert.equal(applies.length, 0);
      const failedPreview = structuredClone(previews.at(-1));
      await activate(page, apply()); assert.equal(applies.length, 0, 'Stale failed preview blocks Apply');
      assert.match(await host.locator('.member-match__pending').innerText(), /last preview result/);
      await successfulPreview(); await host.locator('.member-match__identity').filter({ hasText: 'Member ID: b' }).waitFor();
      assert.deepEqual(previews.at(-1), failedPreview, 'Native retry preserves actual file bytes, mapping and member correction settings');
      if (surface === 'workbook') assert.deepEqual(failedPreview.settings.mapping, { name: 0 });
      else if (surface === 'csv') assert.deepEqual(failedPreview.settings.mapping, { canonical_name: 'canonical_name', call_level: '' });
      else { assert.deepEqual(failedPreview.settings.mapping, { canonical_name: 'member_name' }); assert.equal(failedPreview.settings.date_format, 'DMY'); }
      if (surface !== 'workbook') {
        acceptDialog = false; const promptCount = dialogs.length; await page.keyboard.press('Escape');
        await page.waitForFunction(() => Boolean(document.querySelector('dialog[open]')));
        assert.equal(await host.evaluate(n => n.open), true); assert.equal(dialogs.length, promptCount + 1); assert.match(dialogs.at(-1), /Discard this import draft/); acceptDialog = true;
      }
      const failedApply = { started: deferred(), release: deferred(), fail: true }; holdApply = failedApply;
      await activate(page, apply()); await awaitGate(failedApply.started, 'Failed Apply', host); await stage(host, 3);
      assert.equal(await host.locator('input[type=file]').isDisabled(), true);
      failedApply.release.resolve(); await message().filter({ hasText: 'Apply diagnostic unavailable' }).waitFor(); await stage(host, 2);
      assert.match(await message().innerText(), /may already have saved changes/); assert.match(await message().innerText(), /Check existing records or import history/);
      assert.equal(await host.locator('input[type=file]').isDisabled(), false);
      if (surface === 'workbook') { await activate(page, apply()); assert.equal(applies.length, 1); }
      await successfulPreview(); await host.locator('.member-match__identity').filter({ hasText: 'Member ID: b' }).waitFor();
      assert.deepEqual(previews.at(-1), failedPreview);
      const confirmedApply = { started: deferred(), release: deferred(), fail: false }; holdApply = confirmedApply;
      await activate(page, apply()); await awaitGate(confirmedApply.started, 'Confirmed Apply', host); await stage(host, 3); confirmedApply.release.resolve();
      await stage(host, 4);
      if (surface === 'workbook' && variant.endsWith('remount')) {
        await message().filter({ hasText: variant.startsWith('replayed') ? 'already applied' : 'Changes were confirmed' }).waitFor();
        assert.doesNotMatch(await message().innerText(), /Master list and counts refreshed|Apply has not returned|Confirmed callback unavailable/);
      } else {
        await message().filter({ hasText: 'Confirmed callback unavailable' }).waitFor();
        assert.match(await message().innerText(), /Import was confirmed/); assert.doesNotMatch(await message().innerText(), /Apply has not returned/);
      }
      assert.equal(applies.length, 2, 'Only two explicitly activated Apply requests; confirmed callback failure never replays');
      assert.deepEqual(applies[0], applies[1], 'Manual retry preserves exact apply contract');
      if (surface === 'workbook') assert.deepEqual(applies[0], { options: failedPreview.settings, preview_hash: 'reviewed-hash' });
      else if (surface === 'csv') assert.deepEqual(applies[0], { excluded: [], archive_missing: [] });
      else assert.deepEqual(applies[0], { excluded: [], acknowledge_warnings: false });
      const replacementGate = { started: deferred(), release: deferred() }; holdColumns = replacementGate;
      await host.locator('input[type=file]').setInputFiles(inputFile('replacement.csv'));
      if (surface === 'workbook') await activate(page, host.locator('[data-mi=inspect]'));
      await awaitGate(replacementGate.started, 'Postcompletion replacement columns', host); await stage(host, 0); assert.equal(await columns().count(), 0);
      replacementGate.release.resolve(); await columns().first().waitFor({ state: 'attached' }); await stage(host, 1);
      assert.deepEqual(errors, []);
      results.push({ engine, width, surface, variant, columnFailureRetainedFileSafeNativeRetry: true, replacementResetsStagesAndControls: true, previewFailureRetainsExactFileMappingAndChoice: failedPreview, applyPendingAndUnconfirmedFailure: true, confirmedCallbackFailureKeepsCompletion: true, nativeDiscardRetained: surface !== 'workbook', applyBodies: applies, columnFiles, pageErrors: errors });
      console.log(`Progress recovery ${engine} ${width} ${surface} ${variant}`);
      await page.close();
    }
  } } finally { await browser.close(); }
}
assert.deepEqual(await hashes(), initial, 'Actual app and test sources held throughout all workflows');
const output = process.env.PROGRESS_REPORT || '../docs/premium-ui/qa-leave-import-status-progress-integrated.json';
await writeFile(output, JSON.stringify({ recorded_at_utc: new Date().toISOString(), source_sha256: initial, status: 'Scoped browser evidence; not requirement acceptance', file_byte_evidence: 'All engines: passive observation of the actual File name/text in FormData passed to native fetch, with original fetch arguments/body/return unchanged. Chromium/Firefox also assert intercepted multipart bytes. WebKit interception omits raw file payload; browser FormData evidence is not server-received-byte certification.', scope: 'Actual mounted four CSV-capable import surfaces, native keyboard/file/mapping/choice interactions, intercepted existing settings/multipart fields, staged failure/retry and confirmed-apply callback failures. All API requests fulfilled locally; no backend or persistence claim. Additional modes, include/archive/exclusion retention, full reload boundaries and independent acceptance remain separate.', results }, null, 2) + '\n');
console.log(`Progress recovery: ${results.length} workflows passed`);
