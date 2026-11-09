import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';

const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const paths = ['src/ui.ts', 'src/member-import.ts', 'src/member-workspace.ts', 'src/operational-import.ts', 'src/past-duties.ts', 'src/services/api.ts', 'src/premium-theme.css', 'src/styles.css', 'tests/premium-match-identity-long.browser.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const initial = await hashes(), results = [];
const members = ['11111111-1111-4111-8111-111111111111', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'].map(id => ({ id, canonical_name: 'Dr Same Name', active_status: 'active', call_level: '2ND_CALL', aliases: [], designations: [], revision: 'one' }));
const candidates = members.map(member => ({ id: member.id, name: member.canonical_name, status: 'active', call_level: '2ND_CALL', designation: 'SeniorRegistrarWithAnUnbrokenDesignationForGeometryInspection', units: ['LongUnitNameWithoutAnyNaturalBreakOpportunityForMobileReview'], reason: 'ResolverReasonWithoutAnyNaturalBreakOpportunityForMobileReview' }));
const inspection = { header_row: 1, fields: ['name'], sheets: [{ name: 'Members', headers: ['Name'], mapping: { name: 0 } }] };
const bytes = Buffer.from('Name\nDr Same Name\n');
const file = { name: 'same-name.csv', mimeType: 'text/csv', buffer: bytes };
const activate = async (page, locator) => { await locator.focus(); await page.keyboard.press('Enter'); };
const multipart = async request => new Request('http://fixture.invalid', { method: 'POST', headers: { 'content-type': request.headers()['content-type'] }, body: request.postDataBuffer() }).formData();

for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await launcher.launch({ headless: true });
  try { for (const width of [320, 390]) for (const surface of ['workbook', 'csv', 'operational', 'past']) {
    const page = await browser.newPage({ viewport: { width, height: 650 } }), errors = [], previews = [];
    page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(15000);
    let mode = 'unresolved', writes = 0, longFixture = false;
    await page.addInitScript(() => { localStorage.setItem('duty_rota_auth_token', 'long-identity-fixture'); localStorage.setItem('duty_rota_working_month', '2026-10'); });
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
        const url = new URL(request.url());
        return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:8031' + url.pathname + url.search }) });
      }
      const form = await multipart(request);
      if (path.endsWith('/columns')) return route.fulfill({ json: { headers: surface === 'csv' ? ['canonical_name'] : ['Name'], fields: ['member_name'], suggested: { Name: 'member_name' } } });
      if (path.endsWith('/inspect')) return route.fulfill({ json: inspection });
      if (!path.endsWith('/preview')) { writes++; throw Error(`Unexpected write ${path}`); }
      const settings = JSON.parse(form.get(surface === 'operational' ? 'settings_json' : surface === 'csv' ? 'corrections' : 'options'));
      assert.equal(form.get('file').name, file.name);
      previews.push(structuredClone(settings));
      const candidates = longFixture ? members.map(member => ({ id: member.id, name: member.canonical_name, status: 'active', call_level: '2ND_CALL', designation: 'SeniorRegistrarWithAnUnbrokenDesignationForGeometryInspection', units: ['LongUnitNameWithoutAnyNaturalBreakOpportunityForMobileReview'], reason: 'ResolverReasonWithoutAnyNaturalBreakOpportunityForMobileReview' })) : [{ id: 'short-a', name: 'Dr A', status: 'active', call_level: '2ND_CALL', units: [] }, { id: 'short-b', name: 'Dr B', status: 'active', call_level: '2ND_CALL', units: [] }];
      const choice = surface === 'workbook' ? settings.resolutions['2'] : surface === 'past' ? settings.resolutions['row-2']?.person_id : surface === 'csv' ? settings['2']?.member_id : settings.corrections['CSV:2']?.person_id;
      const selected = choice || (mode === 'matched' ? '11111111-1111-4111-8111-111111111111' : undefined), name = selected ? 'Dr Same Name' : null;
      const method = choice ? 'member_id' : 'approved_alias';
      if (surface === 'workbook') {
        const decision = settings.resolutions['2'], skip = decision === 'skip', fresh = decision === 'new';
        return route.fulfill({ json: { preview_hash: 'workbook-hash', counts: { create: fresh ? 1 : 0, update: selected ? 1 : 0, needs_review: !selected && !fresh && !skip ? 1 : 0, skip: skip ? 1 : 0 }, rows: [{ row: 2, raw: { name: 'Imported Same' }, normalized: { name: 'Imported Same' }, target_id: skip || fresh ? null : selected, target_name: skip || fresh ? null : name, action: skip ? 'skip' : fresh ? 'create' : selected ? 'update' : 'needs_review', changes: {}, errors: [], candidates, resolution_status: selected && !skip && !fresh ? 'matched' : 'ambiguous', resolution_method: method }] } });
      }
      if (surface === 'csv' && settings['2']?._confirm_distinct === 'yes') return route.fulfill({ json: { id: 'csv-distinct', mode: 'create_only', headers: ['canonical_name'], rows: [{ row_number: 2, values: { canonical_name: 'Imported Same', _confirm_distinct: 'yes', member_id: '' }, action: 'create', errors: [], suggestions: [], person_id: null, before: null, after: { canonical_name: 'Imported Same', active_status: 'active' }, revision: null }], missing: [] } });
      if (surface === 'csv') return route.fulfill({ json: { id: 'csv-preview', mode: 'create_only', headers: ['canonical_name'], rows: [{ row_number: 2, values: { canonical_name: 'Imported Same', ...(choice ? { member_id: choice } : {}) }, action: selected ? 'update' : 'needs_review', errors: [], suggestions: candidates, person_id: selected, before: selected ? { canonical_name: name, active_status: 'active', call_level: '2ND_CALL' } : null, after: { canonical_name: 'Imported Same', active_status: 'active' }, revision: selected ? 'one' : null }], missing: [] } });
      if (surface === 'operational') return route.fulfill({ json: { id: 'operational-preview', kind: 'units', month: '2026-10', mode: 'append', headers: ['Name'], fields: ['member_name'], replacement_scope: [], rows: [{ key: 'CSV:2', source: { sheet: 'CSV', row: 2 }, original: { Name: 'Imported Same' }, values: { member_name: 'Imported Same' }, after: { person_id: selected }, action: selected ? 'create' : 'needs_review', issues: selected ? [] : ['Choose member'], warnings: [], person_match: { state: selected ? 'matched' : 'ambiguous', status: selected ? 'matched' : 'ambiguous', person_id: selected, canonical_name: name, method, candidates, warnings: [] } }] } });
      return route.fulfill({ json: { preview_hash: 'past-hash', month: '2026-09', sheet: 'Members', counts: { create: selected ? 1 : 0, needs_review: selected ? 0 : 1 }, warnings: [], rows: [{ key: 'row-2', row: 2, column: 1, raw: { name: 'Imported Same', date: '2026-09-02' }, normalized: { person_id: selected, name }, action: selected ? 'create' : 'needs_review', resolution_status: selected ? 'matched' : 'ambiguous', resolution_method: method, person_candidates: candidates, errors: selected ? [] : ['Choose member'], conflicts: [], target_assignment: null }] } });
    });
    await page.goto(base + '/#view=' + (surface === 'past' ? 'imports' : 'members'));
    await page.locator(surface === 'past' ? '[data-past="file"]' : '#member-import-host').waitFor({ state: 'attached' });
    await page.evaluate(async surface => {
      const host = document.querySelector(surface === 'past' ? '#past-duties-host' : '#member-import-host');
      const opener = Object.assign(document.createElement('button'), { id: 'open', textContent: 'Open fixture importer' }); document.querySelector('#view-root').append(opener);
      if (surface === 'workbook') { const m = await import('/src/member-import.ts'); m.resetMemberImport(); m.mountMemberImport(host, async () => {}); }
      if (surface === 'past') await (await import('/src/past-duties.ts')).mountPastDuties(host);
      if (surface === 'csv') document.querySelector('#open').onclick = () => import('/src/member-workspace.ts').then(m => m.openMemberCsvImport(() => {}));
      if (surface === 'operational') document.querySelector('#open').onclick = () => import('/src/operational-import.ts').then(m => m.openOperationalImport('units', '2026-10', () => {}, true));
    }, surface);
    if (['csv', 'operational'].includes(surface)) await activate(page, page.locator('#open'));
    const host = ['csv', 'operational'].includes(surface) ? page.locator('dialog').last() : page.locator(surface === 'past' ? '#past-duties-host' : '#member-import-host');
    const preview = () => surface === 'workbook' ? host.locator('[data-mi="preview"]') : surface === 'past' ? host.locator('[data-past="preview"]') : surface === 'csv' ? host.getByRole('button', { name: 'Preview import', exact: true }) : host.getByRole('button', { name: 'Preview and normalize', exact: true });
    if (surface === 'csv') await host.locator('[name=mode]').selectOption('create_only');
    await host.locator('input[type=file]').setInputFiles(file);
    if (surface === 'workbook') await activate(page, host.locator('[data-mi="inspect"]'));
    if (surface === 'past') await activate(page, host.locator('[data-past="inspect"]'));
    if (['csv', 'operational'].includes(surface)) await host.locator(surface === 'csv' ? '[data-map-column]' : '[data-map]').first().waitFor({ state: 'attached' });
    const longId = members[1].id;
    const measure = () => host.evaluate(root => {
      const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, height: r.height }; };
      const details = [...root.querySelectorAll('.member-match__identity, .member-pick')].map(node => {
        let scroller = node.parentElement;
        while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
        const range = document.createRange(); range.selectNodeContents(node);
        return { kind: node.className, text: node.textContent, box: rect(node), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
          textRects: [...range.getClientRects()].map(r => ({ x: r.x, right: r.right, width: r.width })),
          horizontalContainer: scroller ? { tag: scroller.tagName, className: scroller.className, clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth, containsTable: Boolean(scroller.querySelector('table')) } : null,
          textClipped: node.scrollWidth > node.clientWidth + 2 && ['hidden', 'clip'].includes(getComputedStyle(node).overflowX) };
      });
      return { page: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
        dialog: root instanceof HTMLDialogElement ? { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth, box: rect(root) } : null, details };
    });
    await activate(page, preview());
    await host.locator('[data-pick-member="short-b"]').waitFor();
    const shortFixtureGeometry = await measure();
    longFixture = true;
    await activate(page, preview());
    const pick = host.locator(`[data-pick-member="${longId}"]`);
    await pick.waitFor();
    assert.equal(await host.locator('[data-pick-member]').count(), 2);
    const label = await pick.innerText();
    assert.match(label, /Dr Same Name/); assert.ok(label.includes(`Member ID: ${longId}`));
    assert.match(label, /SeniorRegistrarWithAnUnbrokenDesignation/);
    assert.match(label, /LongUnitNameWithoutAnyNaturalBreakOpportunity/);
    if (surface !== 'csv') assert.match(label, /ResolverReasonWithoutAnyNaturalBreakOpportunity/);
    const unresolvedGeometry = await measure();
    await pick.focus(); assert.equal(await pick.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Enter');
    await host.locator('.member-match__identity').filter({ hasText: `Member ID: ${longId}` }).waitFor();
    const selectedText = await host.locator('.member-match__identity').innerText();
    assert.ok(selectedText.includes(`Member ID: ${longId}`));
    const selectedGeometry = await measure();
    const issues = [];
    for (const [state, geometry] of Object.entries({ unresolved: unresolvedGeometry, selected: selectedGeometry })) {
      if (geometry.page.scrollWidth > geometry.page.clientWidth + 2) issues.push(`${state}: document overflows horizontally`);
      if (geometry.dialog && geometry.dialog.scrollWidth > geometry.dialog.clientWidth + 2) issues.push(`${state}: dialog overflows horizontally`);
      for (const item of geometry.details) {
        const containedTable = item.horizontalContainer?.containsTable;
        if (item.box.width > width + 2 && !containedTable) issues.push(`${state}: ${item.kind} exceeds viewport without contained table scrolling`);
        if (item.textClipped) issues.push(`${state}: ${item.kind} clips identity text`);
        if (item.textRects.some(r => r.right > item.box.right + 2 || r.x < item.box.x - 2)) issues.push(`${state}: ${item.kind} text extends beyond its element`);
      }
    }
    assert.equal(writes, 0); assert.deepEqual(errors, []);
    results.push({ engine, width, surface, fixture: { uuid: members[0].id, longId, sameNames: true }, productionShell: true, shortFixtureGeometry, nativeKeyboardPick: true, exactPreviewChoice: previews.at(-1), selectedText, unresolvedGeometry, selectedGeometry, issues, actualBackendWrites: 0 });
    console.log(`Long identity ${engine} ${width} ${surface}: ${issues.length} geometry issues`);
    await page.close();
  } } finally { await browser.close(); }
}
assert.deepEqual(await hashes(), initial, 'Application and own test sources held');
await writeFile('../docs/premium-ui/qa-match-identity-long.json', JSON.stringify({ recorded_at_utc: new Date().toISOString(), source_sha256: initial, scope: 'Actual four import adapters mounted inside the production shell, three engines at320/390 with production CSS and no diagnostic style injection. Short fixture compared with UUID plus160character unbroken ID, equal names and long designation/unit/reason; native keyboard choice, returned selected identity, raw text/element/page/dialog geometry. Existing contained table horizontal scrolling distinguished from document/dialog overflow. Import API responses fulfilled locally; shell GETs use local disposable fixture8031. No Apply, actual persistence, physical-device or native AT claim.', results }, null, 2) + '\n');
assert.deepEqual(results.flatMap(result => result.issues.map(issue => `${result.engine}/${result.width}/${result.surface}: ${issue}`)), [], 'Long identity text must remain readable within the page/dialog or its contained table scroller');
console.log(`Long identity geometry: ${results.length} workflows passed`);
