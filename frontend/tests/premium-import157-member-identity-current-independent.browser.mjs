import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';

const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const paths = ['src/ui.ts', 'src/member-import.ts', 'src/member-workspace.ts', 'src/operational-import.ts', 'src/past-duties.ts', 'src/services/api.ts', 'src/premium-theme.css', 'tests/premium-match-identity.browser.mjs', 'tests/ui.test.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const initial = await hashes(), results = [];
const members = ['same-a', 'same-b'].map(id => ({ id, canonical_name: 'Dr Same Name', active_status: 'active', call_level: '2ND_CALL', aliases: [], designations: [], revision: 'one' }));
const candidates = members.map(member => ({ id: member.id, name: member.canonical_name, status: 'active', call_level: '2ND_CALL', units: [] }));
const inspection = { header_row: 1, fields: ['name'], sheets: [{ name: 'Members', headers: ['Name'], mapping: { name: 0 } }] };
const bytes = Buffer.from('Name\nDr Same Name\n');
const file = { name: 'same-name.csv', mimeType: 'text/csv', buffer: bytes };
const activate = async (page, locator) => { await locator.focus(); await page.keyboard.press('Enter'); };
const multipart = async request => new Request('http://fixture.invalid', { method: 'POST', headers: { 'content-type': request.headers()['content-type'] }, body: request.postDataBuffer() }).formData();

for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await launcher.launch({ headless: true });
  try { for (const width of [320, 1280]) for (const surface of ['workbook', 'csv']) {
    const page = await browser.newPage({ viewport: { width, height: 850 } }), errors = [], previews = [];
    let mode = 'unresolved', writes = 0, failNext = false, releaseChoice;
    let choiceArrived;
    const choiceStarted = new Promise(resolve => { choiceArrived = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route('**/__identity_review', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open import</button><main id="host"></main></body></html>' }));
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() === 'GET') {
        if (path.endsWith('/status')) return route.fulfill({ json: { today: '2026-10-24', policy: { enabled: true, lookback_months: 6 }, coverage: [], duty_types: [], history: [] } });
        if (path.endsWith('/recorded')) return route.fulfill({ json: { items: [], truncated: false } });
        if (path.endsWith('/admin/members')) return route.fulfill({ json: members });
        if (path.endsWith('/normalization/units')) return route.fulfill({ json: [] });
        throw Error(`Unexpected GET ${path}`);
      }
      const form = await multipart(request);
      if (path.endsWith('/columns')) return route.fulfill({ json: { headers: surface === 'csv' ? ['canonical_name'] : ['Name'], fields: ['member_name'], suggested: { Name: 'member_name' } } });
      if (path.endsWith('/inspect')) return route.fulfill({ json: inspection });
      if (!path.endsWith('/preview')) { writes++; throw Error(`Unexpected write ${path}`); }
      const settings = JSON.parse(form.get(surface === 'operational' ? 'settings_json' : surface === 'csv' ? 'corrections' : 'options'));
      assert.equal(form.get('file').name, file.name);
      previews.push(structuredClone(settings));
      if (failNext) { failNext = false; await new Promise(resolve => { releaseChoice = resolve; choiceArrived(); }); return route.fulfill({ status: 503, json: { detail: 'Identity preview unavailable' } }); }
      const choice = surface === 'workbook' ? settings.resolutions['2'] : surface === 'past' ? settings.resolutions['row-2']?.person_id : surface === 'csv' ? settings['2']?.member_id : settings.corrections['CSV:2']?.person_id;
      const selected = choice || (mode === 'matched' ? 'same-a' : undefined), name = selected ? 'Dr Same Name' : null;
      const method = choice ? 'member_id' : 'approved_alias';
      if (surface === 'workbook') {
        const decision = settings.resolutions['2'], skip = decision === 'skip', fresh = decision === 'new';
        return route.fulfill({ json: { preview_hash: 'workbook-hash', counts: { create: fresh ? 1 : 0, update: selected ? 1 : 0, needs_review: !selected && !fresh && !skip ? 1 : 0, skip: skip ? 1 : 0 }, rows: [{ row: 2, raw: { name: 'Imported Same' }, normalized: { name: 'Imported Same' }, target_id: skip || fresh ? null : selected, target_name: skip || fresh ? null : name, action: skip ? 'skip' : fresh ? 'create' : selected ? 'update' : 'needs_review', changes: {}, errors: [], candidates, resolution_status: selected && !skip && !fresh ? 'matched' : 'ambiguous', resolution_method: method }] } });
      }
      if (surface === 'csv' && settings['2']?._confirm_distinct === 'yes') return route.fulfill({ json: { id: 'csv-distinct', mode: 'create_only', headers: ['canonical_name'], rows: [{ row_number: 2, values: { canonical_name: 'Imported Same', _confirm_distinct: 'yes', member_id: '' }, action: 'create', errors: [], suggestions: [], person_id: null, before: null, after: { canonical_name: 'Imported Same', active_status: 'active' }, revision: null }], missing: [] } });
      if (surface === 'csv') return route.fulfill({ json: { id: 'csv-preview', mode: 'create_only', headers: ['canonical_name'], rows: [{ row_number: 2, values: { canonical_name: 'Imported Same', ...(choice ? { member_id: choice } : {}) }, action: selected ? 'update' : 'needs_review', errors: [], suggestions: candidates, person_id: selected, before: selected ? { canonical_name: name, active_status: 'active', call_level: '2ND_CALL' } : null, after: { canonical_name: 'Imported Same', active_status: 'active' }, revision: selected ? 'one' : null }], missing: [] } });
      if (surface === 'operational') return route.fulfill({ json: { id: 'operational-preview', kind: 'units', month: '2026-10', mode: 'append', headers: ['Name'], fields: ['member_name'], replacement_operator:'/root/reference157158_evidence_audit; independent current-source rerun of prior specialist-authored test', scope: [], rows: [{ key: 'CSV:2', source: { sheet: 'CSV', row: 2 }, original: { Name: 'Imported Same' }, values: { member_name: 'Imported Same' }, after: { person_id: selected }, action: selected ? 'create' : 'needs_review', issues: selected ? [] : ['Choose member'], warnings: [], person_match: { state: selected ? 'matched' : 'ambiguous', status: selected ? 'matched' : 'ambiguous', person_id: selected, canonical_name: name, method, candidates, warnings: [] } }] } });
      return route.fulfill({ json: { preview_hash: 'past-hash', month: '2026-09', sheet: 'Members', counts: { create: selected ? 1 : 0, needs_review: selected ? 0 : 1 }, warnings: [], rows: [{ key: 'row-2', row: 2, column: 1, raw: { name: 'Imported Same', date: '2026-09-02' }, normalized: { person_id: selected, name }, action: selected ? 'create' : 'needs_review', resolution_status: selected ? 'matched' : 'ambiguous', resolution_method: method, person_candidates: candidates, errors: selected ? [] : ['Choose member'], conflicts: [], target_assignment: null }] } });
    });
    await page.goto(base + '/__identity_review');
    await page.evaluate(async surface => {
      const host = document.querySelector('#host');
      if (surface === 'workbook') { const m = await import('/src/member-import.ts'); m.resetMemberImport(); m.mountMemberImport(host, async () => {}); }
      if (surface === 'past') await (await import('/src/past-duties.ts')).mountPastDuties(host);
      if (surface === 'csv') document.querySelector('#open').onclick = () => import('/src/member-workspace.ts').then(m => m.openMemberCsvImport(() => {}));
      if (surface === 'operational') document.querySelector('#open').onclick = () => import('/src/operational-import.ts').then(m => m.openOperationalImport('units', '2026-10', () => {}, true));
    }, surface);
    if (['csv', 'operational'].includes(surface)) await activate(page, page.locator('#open'));
    const host = ['csv', 'operational'].includes(surface) ? page.locator('dialog').last() : page.locator('#host');
    const preview = () => surface === 'workbook' ? host.locator('[data-mi="preview"]') : surface === 'past' ? host.locator('[data-past="preview"]') : surface === 'csv' ? host.getByRole('button', { name: 'Preview import', exact: true }) : host.getByRole('button', { name: 'Preview and normalize', exact: true });
    if (surface === 'csv') await host.locator('[name=mode]').selectOption('create_only');
    await host.locator('input[type=file]').setInputFiles(file);
    if (surface === 'workbook') await activate(page, host.locator('[data-mi="inspect"]'));
    if (surface === 'past') await activate(page, host.locator('[data-past="inspect"]'));
    if (['csv', 'operational'].includes(surface)) await host.locator(surface === 'csv' ? '[data-map-column]' : '[data-map]').first().waitFor({ state: 'attached' });
    await activate(page, preview());
    await host.locator('[data-pick-member="same-b"]').waitFor();
    assert.deepEqual(await host.locator('[data-pick-member]').evaluateAll(nodes => nodes.map(node => node.dataset.pickMember)), ['same-a', 'same-b'], `${surface}: unresolved equal names both remain selectable`);
    for (const id of ['same-a', 'same-b']) assert.match(await host.locator(`[data-pick-member="${id}"]`).innerText(), new RegExp(`Member ID: ${id}`));
    mode = 'matched';
    await activate(page, preview());
    await host.locator('.member-match__identity').filter({ hasText: 'Member ID: same-a' }).waitFor();
    assert.equal(await host.locator('.member-match__raw').innerText(), 'Imported Same');
    assert.equal(await host.locator('.member-match__name').innerText(), 'Dr Same Name');
    assert.match(await host.locator('.member-match__why').innerText(), /Match: approved alias/);
    assert.deepEqual(await host.locator('[data-pick-member]').evaluateAll(nodes => nodes.map(node => node.dataset.pickMember)), surface === 'csv' ? [] : ['same-b'], 'Returned selected A excludes only A where alternatives already exist');
    if (surface === 'csv') { mode = 'unresolved'; await activate(page, preview()); await host.locator('[data-pick-member="same-b"]').waitFor(); }
    failNext = true;
    await activate(page, host.locator('[data-pick-member="same-b"]'));
    await choiceStarted;
    if (surface !== 'operational') assert.equal(await host.locator('input[type=file]').isDisabled(), true, 'Native file replacement is blocked while this preview owns its response');
    assert.equal(await host.locator('.member-match__identity').filter({ hasText: 'Member ID: same-b' }).count(), 0);
    if (['csv', 'operational'].includes(surface)) { await page.keyboard.press('Escape'); assert.equal(await host.evaluate(node => node.open), true, 'Pending dialog remains open'); }
    assert.equal(typeof releaseChoice, 'function', 'Held candidate request reached fixture');
    releaseChoice();
    await host.getByText(/Identity preview unavailable/).first().waitFor();
    const apply = host.locator(surface === 'workbook' ? '[data-mi="apply"]' : surface === 'past' ? '[data-past="apply"]' : '[data-apply]');
    await activate(page, apply);
    assert.equal(writes, 0, 'Failed choice refresh cannot Apply the old preview');
    assert.match(await host.locator('.member-match__pending').innerText(), /last preview result/);
    assert.equal(await host.locator('.member-match__identity').filter({ hasText: 'Member ID: same-b' }).count(), 0, 'Pending local B must not replace returned identity');
    await activate(page, host.locator('[data-pick-member="same-b"]'));
    await host.locator('.member-match__identity').filter({ hasText: 'Member ID: same-b' }).waitFor();
    assert.deepEqual(await host.locator('[data-pick-member]').evaluateAll(nodes => nodes.map(node => node.dataset.pickMember)), surface === 'csv' ? [] : ['same-a']);
    assert.equal(await host.locator('.member-match__name').innerText(), 'Dr Same Name');
    const sent = previews.at(-1);
    if (surface === 'workbook') assert.deepEqual(sent.resolutions, { '2': 'same-b' });
    if (surface === 'csv') assert.deepEqual(sent, { '2': { member_id: 'same-b', _confirm_distinct: '' } });
    if (surface === 'operational') { assert.deepEqual(sent.corrections, { 'CSV:2': { person_id: 'same-b' } }); assert.doesNotMatch(await host.locator('.member-match').innerText(), /new member will be created/i); }
    if (surface === 'past') assert.deepEqual(sent.resolutions, { 'row-2': { person_id: 'same-b' } });
    if (surface === 'csv') {
      await activate(page, host.locator('[data-csv-undo]'));
      await host.locator('.member-match__identity').filter({ hasText: 'No existing member selected.' }).waitFor();
      await host.locator('[data-pick-member="same-b"]').waitFor();
      assert.deepEqual(previews.at(-1), { '2': { _confirm_distinct: '', member_id: '' } });
      await activate(page, host.locator('[data-csv-distinct]'));
      await host.locator('.member-match__identity').filter({ hasText: 'New member will be created; no existing member selected.' }).waitFor();
      assert.equal(await host.locator('[data-pick-member]').count(), 0);
      assert.doesNotMatch(await host.locator('.member-match__identity').innerText(), /Member ID:|Existing member/);
      assert.deepEqual(previews.at(-1), { '2': { _confirm_distinct: 'yes', member_id: '' } });
    }
    if (surface === 'workbook') {
      mode = 'unresolved';
      await activate(page, host.locator('[data-mi-resolve=""]'));
      await host.locator('[data-pick-member="same-b"]').waitFor();
      assert.deepEqual(previews.at(-1).resolutions, {});
      await activate(page, host.locator('[data-mi-resolve="new"]'));
      await host.locator('.member-match__identity').filter({ hasText: 'New member will be created; no existing member selected.' }).waitFor();
      assert.deepEqual(previews.at(-1).resolutions, { '2': 'new' });
      await activate(page, host.locator('[data-mi-resolve="skip"]'));
      await host.getByText(/skipped; this row will not be imported/).waitFor();
      assert.deepEqual(previews.at(-1).resolutions, { '2': 'skip' });
    }
    assert.equal(writes, 0); assert.deepEqual(errors, []);
    results.push({ engine, width, surface, unresolvedEqualNamesSelectable: true, selectedAIdentityAndApprovedAlias: true, matchedAlternativePreservedWhereExisting: surface !== 'csv', nativePickReturnsSelectedB: true, failedChoiceKeepsReturnedIdentityAndBlocksApply: true, exactExistingChoiceBody: sent, workbookUndoNewSkip: surface === 'workbook', csvDistinctReturnedNoIdOrSuggestions: surface === 'csv', applies: 0, actualBackendWrites: 0 });
    console.log(`Match identity ${engine} ${width} ${surface}`);
    await page.close();
  } } finally { await browser.close(); }
}
assert.deepEqual(await hashes(), initial, 'Application, helper and test sources held throughout run');
await writeFile('../docs/premium-ui/qa-import157-member-identity-current-independent.json', JSON.stringify({ recorded_at_utc: new Date().toISOString(), source_sha256: initial, operator:'/root/reference157158_evidence_audit; independent current-source rerun of prior specialist-authored test', scope: 'Actual workbook and memberCSV import components, native keyboard selections, returned equal-name identities, exact intercepted preview requests; three engines at320/1280. All API responses fulfilled locally. No Apply or real persistence/backend authorization claim. Existing CSV distinct/undo, candidate failure and lifecycle suites remain separate regressions.', results }, null, 2) + '\n');
console.log(`Match identity: ${results.length} native import workflows passed`);
