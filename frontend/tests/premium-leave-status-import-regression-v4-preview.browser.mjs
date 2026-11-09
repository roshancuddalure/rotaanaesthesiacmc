import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';

const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const paths = ['src/import-review-presentation.ts', 'src/member-import.ts', 'src/member-workspace.ts', 'src/operational-import.ts', 'src/past-duties.ts', 'src/services/api.ts', 'src/ui.ts', 'src/styles.css', 'src/premium-theme.css', 'tests/premium-leave-status-import-regression-v4-preview.browser.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const initial = await hashes(), results = [];
const candidatePath='../tmp/leave-import-status-v4/operational-import.ts';const candidateSha=createHash('sha256').update(await readFile(candidatePath)).digest('hex');
const activate = async (page, control) => { await control.focus(); await page.keyboard.press('Enter'); };
const members = ['member-a', 'member-b'].map(id => ({ id, canonical_name: 'Dr Same Name', active_status: 'active', call_level: '2ND_CALL', aliases: [], designations: [], revision: 'one' }));
const candidates = members.map(member => ({ id: member.id, name: member.canonical_name, status: 'active', call_level: '2ND_CALL', units: [] }));
const longIssue = 'Invalid department member <img src=x onerror=alert(1)> ' + 'Detailed correction explanation '.repeat(12);
const file = { name: 'review-context.csv', mimeType: 'text/csv', buffer: Buffer.from('Name\nDr Same Name\n') };
const inspection = { header_row: 1, fields: ['name'], sheets: [{ name: 'Selected sheet', headers: ['Name'], mapping: { name: 0 } }] };
const multipart = async request => new Request('http://fixture.invalid', { method: 'POST', headers: { 'content-type': request.headers()['content-type'] }, body: request.postDataBuffer() }).formData();
const modes = { roster_sync: 'Roster sync', create_only: 'Create new members only', update_existing: 'Update existing members only', append: 'Append new records', update_matching: 'Update matching member/date records', replace_month: 'Replace imported records' };

for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await launcher.launch({ headless: true });
  try { for (const width of [320, 1280]) for (const surface of ['leave', 'units']) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [], requests = [];
    let writes = 0, variant = 'main', returnedMode = surface === 'csv' ? 'create_only' : 'replace_month', failNext = false, cleanReady = false, probeApply = false, selectedFileName = file.name;
    const eligibilityProbes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => probeApply ? dialog.accept() : dialog.dismiss());
    await page.route('**/__import_review_context', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open import</button><main id="host"></main></body></html>' }));
    await page.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (request.method() === 'GET') {
        if (pathname.endsWith('/status')) return route.fulfill({ json: { today: '2026-10-28', policy: { enabled: true, lookback_months: 6 }, coverage: [], duty_types: [], history: [] } });
        if (pathname.endsWith('/recorded')) return route.fulfill({ json: { items: [], truncated: false } });
        if (pathname.endsWith('/admin/members')) return route.fulfill({ json: members });
        if (pathname.endsWith('/normalization/units')) return route.fulfill({ json: [] });
        errors.push(`Unexpected GET ${pathname}`); return route.abort();
      }
      if (!/\/(columns|inspect|preview)$/.test(pathname)) {
        if (probeApply && /\/apply$/.test(pathname)) {
          eligibilityProbes.push({ pathname, method: request.method(), contentType: request.headers()['content-type'], body: request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : Object.fromEntries([...await multipart(request)].map(([key,value]) => [key, typeof value === 'string' ? value : { filename: value.name, size: value.size }])) });
          return route.fulfill({ status: 503, json: { detail: 'Eligibility probe unavailable; nothing persisted in this local fixture' } });
        }
        writes++; return route.abort();
      }
      const form = await multipart(request);
      assert.equal(form.get('file').name, selectedFileName);
      if (pathname.endsWith('/columns')) return route.fulfill({ json: { headers: surface === 'csv' ? ['canonical_name'] : ['Name'], fields: ['member_name'], suggested: { Name: 'member_name' } } });
      if (pathname.endsWith('/inspect')) return route.fulfill({ json: inspection });
      const operational = ['leave', 'units'].includes(surface);
      const options = JSON.parse(form.get(operational ? 'settings_json' : surface === 'csv' ? 'corrections' : 'options'));
      requests.push({ options, mode: form.get('mode'), month: form.get('month'), variant, returnedMode });
      if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { detail: 'Review fixture preview unavailable' } }); }
      const descriptions = cleanReady ? [{ action: 'update', status: 'matched', issues: [], selected: 'member-a' }] : [
        { action: 'update', status: 'matched', issues: [], selected: 'member-a' },
        { action: 'needs_review', status: 'ambiguous', issues: ['Choose the department member; several members fit.'] },
        { action: surface === 'csv' ? 'invalid' : 'needs_review', status: 'matched', issues: ['Repeated member name in this file; keep one row per member'], selected: 'member-a' },
        { action: surface === 'csv' ? 'invalid' : 'needs_review', status: 'matched', issues: [longIssue], selected: 'member-a' },
        { action: 'needs_review', status: 'inactive', issues: ['The department member is inactive; review their profile.'] },
        { action: 'skip', status: 'not_found', issues: [] },
      ];
      const rows = descriptions.map((description, index) => {
        const row = index + 2, selected = description.selected;
        if (surface === 'csv') return { row_number: row, values: { canonical_name: 'Dr Same Name', member_id: selected ?? '' }, action: description.action === 'skip' ? 'unchanged' : description.action, errors: description.issues, suggestions: description.status === 'ambiguous' ? candidates : [], person_id: selected, before: selected ? { canonical_name: 'Dr Same Name', active_status: 'active', call_level: '2ND_CALL' } : null, after: { canonical_name: 'Dr Same Name', active_status: 'active' }, revision: selected ? 'one' : null };
        if (operational) return { key: `CSV:${row}`, source: { sheet: 'CSV', row }, original: { Name: 'Dr Same Name' }, values: { member_name: 'Dr Same Name', starts_on: '2026-09-02', ends_on: '2026-09-03' }, after: { person_id: selected }, action: description.action === 'update' ? 'create' : description.action, issues: description.issues, warnings: [], person_match: { state: description.status, status: description.status, person_id: selected, canonical_name: selected ? 'Dr Same Name' : null, method: 'approved_alias', reason: description.issues[0] ?? '', candidates: description.status === 'ambiguous' ? candidates : [], warnings: [] } };
        if (surface === 'workbook') return { row, raw: { name: 'Dr Same Name' }, normalized: { name: 'Dr Same Name' }, target_id: selected, target_name: selected ? 'Dr Same Name' : null, action: description.action, changes: {}, errors: description.issues, candidates: description.status === 'ambiguous' ? candidates : [], resolution_status: description.status, resolution_reason: description.issues[0] ?? '', resolution_method: 'approved_alias' };
        return { key: `row-${row}`, row, column: 1, raw: { name: 'Dr Same Name', date: '2026-09-02' }, normalized: { person_id: selected, name: selected ? 'Dr Same Name' : null }, action: description.action === 'update' ? 'create' : description.action, resolution_status: description.status, resolution_reason: description.issues[0] ?? '', resolution_method: 'approved_alias', person_candidates: description.status === 'ambiguous' ? candidates : [], errors: description.issues, conflicts: [], target_assignment: null };
      });
      const marker = `Preview revision ${requests.length}`;
      if (surface === 'csv') rows[0].values.canonical_name = marker;
      else if (operational) rows[0].values.member_name = marker;
      else rows[0].raw.name = marker;
      const payload = surface === 'csv' ? { id: 'csv-reviewed', mode: returnedMode, headers: ['canonical_name'], rows } : operational ? { id: 'operational-reviewed', kind: surface, month: '2026-09', mode: returnedMode, headers: ['Name'], fields: ['member_name'], rows } : { preview_hash: `${surface}-reviewed`, sheet: 'Returned <b>sheet</b>', ...(surface === 'past' ? { month: '2026-09', warnings: [] } : {}), counts: { create: 1, update: 0, unchanged: 0, needs_review: 4, skip: 1 }, rows };
      if (surface === 'csv' || operational) {
        const key = surface === 'csv' ? 'missing' : 'replacement_scope';
        if (variant !== 'omitted') payload[key] = variant === 'null' ? null : variant === 'object' ? { length: 1 } : variant === 'string' ? 'wrong shape' : variant === 'empty' ? [] : surface === 'csv' ? [{ id: 'archive-returned', canonical_name: 'Returned missing member', call_level: '2ND_CALL' }] : [{ person_id: 'member-a', starts_on: '2026-09-01', ends_on: '2026-09-30' }];
        if (variant === 'mode-omitted') delete payload.mode;
        if (variant === 'mode-null') payload.mode = null;
      }
      return route.fulfill({ json: payload });
    });
    await page.goto(base + '/__import_review_context');
    await page.evaluate(async surface => {
      const host = document.querySelector('#host');
      if (surface === 'workbook') { const m = await import('/src/member-import.ts'); m.resetMemberImport(); m.mountMemberImport(host, async () => {}); }
      if (surface === 'past') await (await import('/src/past-duties.ts')).mountPastDuties(host);
      if (surface === 'csv') document.querySelector('#open').onclick = () => import('/src/member-workspace.ts').then(m => m.openMemberCsvImport(() => {}));
      if (['leave', 'units'].includes(surface)) document.querySelector('#open').onclick = () => import('/src/operational-import.ts').then(m => m.openOperationalImport(surface, '2026-10', () => {}, true));
    }, surface);
    if (['csv', 'leave', 'units'].includes(surface)) await activate(page, page.locator('#open'));
    const host = ['csv', 'leave', 'units'].includes(surface) ? page.locator('dialog').last() : page.locator('#host');
    const preview = () => surface === 'workbook' ? host.locator('[data-mi="preview"]') : surface === 'past' ? host.locator('[data-past="preview"]') : host.getByRole('button', { name: surface === 'csv' ? 'Preview import' : 'Preview and normalize', exact: true });
    await host.locator('input[type=file]').setInputFiles(file);
    if (['workbook', 'past'].includes(surface)) await activate(page, host.locator(surface === 'workbook' ? '[data-mi="inspect"]' : '[data-past="inspect"]'));
    else await host.locator(surface === 'csv' ? '[data-map-column]' : '[data-map]').first().waitFor({ state: 'attached' });
    const refresh = async () => {
      const expectedRevision = requests.length + 1;
      const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/preview'));
      await activate(page, preview()); await response;
      await host.locator('.member-match__raw').filter({ hasText: new RegExp(`^Preview revision ${expectedRevision}$`) }).waitFor();
      await host.locator('[data-import-preview-authority]').filter({ hasText: 'Current returned preview' }).waitFor();
    };
    await refresh();
    if(surface==='leave'){assert.equal(await host.locator('[data-leave-approval-status]').count(),6);assert.deepEqual(await host.locator('[data-leave-normalized-status]').allTextContents(),Array(6).fill('Not returned'));assert.equal(await host.locator('[data-leave-input-status]').count(),0,'Identical omitted input and normalized values do not duplicate captions');assert.equal(await host.locator('[data-leave-approval-authority]').filter({hasText:'Preview only.'}).count(),6);}else assert.equal(await host.locator('[data-leave-approval-status]').count(),0);
    assert.match(await host.innerText(), /Duplicate or conflicting row/);
    assert.match(await host.innerText(), /Invalid values/);
    assert.match(await host.innerText(), /Unresolved member match|Needs review/);
    const row = number => host.locator(surface === 'csv' ? `[data-csv-row="${number}"]` : surface === 'workbook' ? `[data-mi-row-key="${number}"]` : surface === 'past' ? `[data-past-row-key="row-${number}"]` : `[data-review-row="CSV:${number}"]`);
    assert.match(await row(3).locator('.import-row__attention').innerText(), /Unresolved member match/);
    assert.match(await row(4).locator('.import-row__attention').innerText(), /Duplicate or conflicting row/);
    assert.match(await row(5).locator('.import-row__attention').innerText(), /Invalid values/);
    assert.match(await row(6).innerText(), /inactive/);
    const invalidEditor = row(5).locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Edit row$/ }) }).first();
    await activate(page, invalidEditor.locator('summary'));
    const invalidField = invalidEditor.locator('input,select').first();
    await invalidField.focus();
    // Native focus scrolls smoothly in this theme. Wait for its actual viewport outcome.
    await page.waitForFunction(node => { const rect = node.getBoundingClientRect(); return rect.y >= -1 && rect.bottom <= innerHeight + 1; }, await invalidField.elementHandle(), {timeout:5000});
    const invalidFieldGeometry = await invalidField.boundingBox();
    if (!(invalidFieldGeometry && invalidFieldGeometry.width > 0 && invalidFieldGeometry.x >= -1 && invalidFieldGeometry.x + invalidFieldGeometry.width <= width + 1 && invalidFieldGeometry.y >= -1 && invalidFieldGeometry.y + invalidFieldGeometry.height <= 851)) {
      await writeFile('../tmp/import-review-context-geometry-failure.json', JSON.stringify({engine,width,surface,source_sha256:initial,invalidFieldGeometry, focused:await invalidField.evaluate(node=>document.activeElement===node), ancestor:await invalidField.evaluate(node=>node.closest('details').outerHTML)},null,2));
      await page.screenshot({path:'../tmp/import-review-context-geometry-failure.png'});
    }
    assert.ok(invalidFieldGeometry && invalidFieldGeometry.width > 0 && invalidFieldGeometry.x >= -1 && invalidFieldGeometry.x + invalidFieldGeometry.width <= width + 1 && invalidFieldGeometry.y >= -1 && invalidFieldGeometry.y + invalidFieldGeometry.height <= 851, 'Long invalid row correction control is actually focusable and visible inside the viewport');
    await activate(page, invalidEditor.locator('summary'));
    assert.equal(await host.locator('img[src=x], b').count(), 0, 'Returned HTML-looking data is escaped');
    assert.match(await host.innerText(), /Invalid department member <img src=x onerror=alert\(1\)>/);
    if (['leave', 'units'].includes(surface)) assert.match(await host.innerText(), /The department member is inactive; review their profile/);
    if (['workbook', 'past'].includes(surface)) assert.match(await host.innerText(), /Returned <b>sheet<\/b>/);
    const scopeVariants = [];
    if (surface === 'csv' || ['leave', 'units'].includes(surface)) {
      const modeValues = surface === 'csv' ? ['create_only', 'update_existing', 'roster_sync'] : ['append', 'update_matching', 'replace_month'];
      const nativeMode = await host.locator('[name=mode]').inputValue();
      let returnedDiffers = false;
      for (const mode of modeValues) { returnedMode = mode; await refresh(); assert.match(await host.locator('[aria-label="Server import preview scope"]').innerText(), new RegExp(modes[mode])); returnedDiffers ||= nativeMode !== mode; assert.equal(await host.locator('[name=mode]').inputValue(), nativeMode, 'Response rendering preserves the actual selected mode'); }
      assert.equal(returnedDiffers, true, 'Returned-mode explanations were checked against a differing native mode');
      if (surface === 'csv') await host.locator('[name=mode]').selectOption('create_only');
      for (const value of ['main', 'empty', 'omitted', 'null', 'object', 'string']) {
        variant = value; await refresh();
        const text = await host.locator('[aria-label="Server import preview scope"]').innerText();
        if (value === 'main') assert.match(text, surface === 'csv' ? /1 active members returned as missing/ : /1 existing imported records returned/);
        else if (value === 'empty') assert.match(text, surface === 'csv' ? /0 active members returned as missing/ : /0 existing imported records returned/);
        else assert.match(text, surface === 'csv' ? /Missing-member scope was not returned/ : /Replacement scope was not returned/);
        if (surface === 'csv') assert.equal(await host.locator('[data-archive]').count(), value === 'main' ? 1 : 0);
        scopeVariants.push(value);
      }
      for (const value of ['mode-omitted', 'mode-null', 'mode-unknown']) {
        variant = value; if (value === 'mode-unknown') returnedMode = '<img src=x onerror=alert(1)>';
        await refresh();
        const text = await host.locator('[aria-label="Server import preview scope"]').innerText();
        assert.match(text, value === 'mode-unknown' ? /No explanation is available/ : /Preview mode was not returned/);
        assert.equal(await host.locator('img[src=x]').count(), 0);
      }
      for (const value of ['__proto__', 'constructor', 'toString']) {
        variant = 'mode-adversarial'; returnedMode = value; await refresh();
        const text = await host.locator('[aria-label="Server import preview scope"]').innerText();
        assert.ok(text.includes(`Preview mode: ${value}. No explanation is available`), 'Inherited object properties are treated as unknown returned modes');
        assert.doesNotMatch(text, /native code|\[object Object\]/);
      }
    }
    cleanReady = true; variant = 'empty'; returnedMode = surface === 'csv' ? 'update_existing' : 'replace_month'; await refresh();
    const apply = host.locator(surface === 'workbook' ? '[data-mi="apply"]' : surface === 'past' ? '[data-past="apply"]' : '[data-apply]');
    if (['leave', 'units'].includes(surface)) await host.locator('[data-acknowledge]').check();
    assert.equal(await host.locator('.import-row__attention').count(), 0, 'Eligibility fixture has one valid matched row and no row issues');
    probeApply = true;
    const eligibilityResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/apply'));
    await activate(page, apply); await eligibilityResponse;
    await host.getByText(/Eligibility probe unavailable/).first().waitFor();
    probeApply = false;
    assert.equal(eligibilityProbes.length, 1, 'Fresh issue-free preview reaches actual native Apply path; response is intercepted locally');
    assert.equal(eligibilityProbes[0].method, 'POST');
    if (surface === 'csv') assert.deepEqual(eligibilityProbes[0].body, { excluded: [], archive_missing: [] });
    else if (['leave', 'units'].includes(surface)) assert.deepEqual(eligibilityProbes[0].body, { excluded: [], acknowledge_warnings: true });
    else { assert.equal(eligibilityProbes[0].body.preview_hash, `${surface}-reviewed`); assert.equal(eligibilityProbes[0].body.file.filename, file.name); }
    await refresh();
    if (['leave', 'units'].includes(surface)) await host.locator('[data-acknowledge]').check();
    const correction = surface === 'csv' ? host.locator('[data-row="2"][data-key="canonical_name"]') : surface === 'workbook' ? host.locator('[data-mi-row="2"]') : surface === 'past' ? host.locator('[data-past-row="row-2"][data-resolution="person_id"]') : host.locator('[data-row="CSV:2"][data-field="starts_on"]');
    await correction.locator('xpath=ancestor::details[1]/summary').click();
    if (surface === 'workbook') await correction.selectOption('new');
    else if (surface === 'past') await correction.selectOption('member-b');
    else { await correction.fill(surface === 'csv' ? 'Corrected member' : '2026-09-04'); if (surface !== 'csv') await correction.press('Tab'); }
    await host.locator('[data-import-preview-authority]').filter({ hasText: 'Previous preview only' }).waitFor();
    if(surface==='leave')assert.equal(await host.locator('[data-leave-approval-authority]').filter({hasText:'Last preview.'}).count(),1,'Input edits synchronously mark the last returned approval status stale without defaulting it');
    await activate(page, apply); assert.equal(writes, 0, 'Stale preview cannot write');
    assert.match(await host.innerText(), surface === 'csv' ? /Values changed\. Refresh the preview/ : surface === 'workbook' ? /Selections changed\. Preview again/ : surface === 'past' ? /preview.*before applying/i : /Changes need a refreshed preview before applying/);
    assert.equal(eligibilityProbes.length, 1, 'No additional Apply probe while stale');
    failNext = true;
    const failedResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/preview'));
    await activate(page, preview()); await failedResponse;
    await host.getByText(/Review fixture preview unavailable/).first().waitFor();
    assert.match(await host.locator('[data-import-preview-authority]').innerText(), /Previous preview only/);
    await activate(page, apply); assert.equal(writes, 0, 'Failed refresh cannot apply retained preview');
    variant = 'empty'; returnedMode = surface === 'csv' ? 'update_existing' : 'replace_month'; await refresh();
    if (['csv', 'leave', 'units'].includes(surface)) {
      const include = host.locator('[data-include]').first();
      await include.uncheck(); assert.match(await host.locator('[data-import-preview-authority]').innerText(), surface === 'csv' ? /Current returned preview/ : /Previous preview only/);
      assert.equal(await host.locator('.import-row__attention').filter({ hasText: 'Excluded from this import' }).count(), 0);
      await include.check(); await refresh();
      if (['leave', 'units'].includes(surface)) await host.locator('[data-acknowledge]').check();
      const modeControl = host.locator('[name=mode]');
      const modeBeforeChange = await modeControl.inputValue();
      const nextNativeMode = surface === 'csv' ? modeBeforeChange === 'create_only' ? 'update_existing' : 'create_only' : modeBeforeChange === 'append' ? 'update_matching' : 'append';
      await modeControl.selectOption(nextNativeMode);
      assert.notEqual(await modeControl.inputValue(), modeBeforeChange, 'The native mode value actually changed');
      await host.locator('[data-import-preview-authority]').filter({ hasText: 'Previous preview only' }).waitFor();
      await activate(page, apply); assert.equal(writes, 0, 'Mode change invalidates a previously eligible clean preview');
      await refresh();
    }
    selectedFileName = 'replacement-context.csv';
    await host.locator('input[type=file]').setInputFiles({ ...file, name: selectedFileName });
    assert.equal(await host.locator('[data-import-preview-authority]').count(), 0, 'Replacing file removes old preview authority');
    assert.equal(await apply.count(), 0, 'Replacing file removes old Apply control');
    assert.equal(writes, 0); assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No document horizontal overflow');
    results.push({ engine, width, surface, invalidFieldGeometry, rowSpecificAttention: true, returnedModeDifferentFromInput: ['csv','leave','units'].includes(surface), scopeVariants, freshEligibilityProbes: eligibilityProbes, nativeCorrectionStaleBlockedApply: true, modeInvalidation: ['csv','leave','units'].includes(surface), nativeReplacementClearsAuthority: true, preview503RetainsStaleAuthority: true, manualRetry: true, escapedFullServerIssue: true, unexpectedWrites: writes, actualBackendWrites: 0, previewRequests: requests });
    console.log(`Import review context ${engine} ${width} ${surface}`);
    await page.close();
  } } finally { await browser.close(); }
}
assert.deepEqual(await hashes(), initial, 'Application and test sources held throughout run');
assert.equal(createHash('sha256').update(await readFile(candidatePath)).digest('hex'),candidateSha,'Preview candidate held');
await writeFile('../docs/premium-ui/qa-leave-status-import-regression-v4-preview.json', JSON.stringify({ recorded_at_utc: new Date().toISOString(), source_sha256: initial, candidate:{path:candidatePath,sha256:candidateSha,base}, scope: 'Two actual operational import components (leave/units), collapsedmissingstatus/staleness cues plus native file/correction controls and intercepted requests in three engines at320/1280. Scope variants and returned-mode authority. No Apply persistence, production endpoint or physical-device claim.', results }, null, 2) + '\n');
console.log(`Import review context: ${results.length} native workflows passed`);
