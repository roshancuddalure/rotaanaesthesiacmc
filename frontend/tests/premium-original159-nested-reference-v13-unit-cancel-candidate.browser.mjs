// Authored groundwork only. Run sequentially from frontend after root releases browser gate.
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const base = process.env.NESTED_REFERENCE_BASE || 'http://127.0.0.1:5307';
const api = 'http://127.0.0.1:8031';
const report = '../docs/premium-ui/qa-original159-nested-reference-v13-unit-cancel-candidate.json';
await assert.rejects(access(report), { code: 'ENOENT' });
const audit = JSON.parse(await readFile('../docs/premium-ui/reviews/original159-nested-reference-groundwork-20261109.json', 'utf8'));
const manifest = JSON.parse(await readFile('../tmp/nested-reference-v13/manifest.json', 'utf8'));
const candidates = Object.fromEntries(manifest.files.map(f => ['frontend/src/'+f.file,f.candidate_sha256]));
for (const [path, expected] of Object.entries(audit.source_sha256)) {
  assert.equal(sha(await readFile('../' + path)), expected, 'Held applied source '+path);
  const name=path.slice('frontend/src/'.length), candidate=candidates[path];
  if(candidate) assert.equal(sha(await readFile('../tmp/nested-reference-v13/'+name)), candidate);
  const response=await fetch(base+'/src/'+name);assert.equal(response.status,200);
  const encoded=(await response.text()).match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
  assert.ok(encoded,'Source map '+path);
  assert.ok(JSON.parse(Buffer.from(encoded[1],'base64').toString()).sourcesContent.some(s=>sha(s)===(candidate||expected)),'Exact candidate '+path);
}
const original = { id: 'nested-parent', name: 'Royal Nested Parent', campus: 'Main', code: 'NP', minimum_free_people: 1, active_status: 'active', aliases: [], notes: '', call_minimums: [], revision: 'one', usage: { postings: 0, duties: 0, future_postings: 0, future_duties: 0, selected_members: 0 } };
const results = [];
for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await launcher.launch();
  try { for (const width of [320, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(12000);
    const writes = [], requests = [], errors = [];
    let created, reads = 0;
    const units = () => [original, { ...original, id: 'nested-b', name: 'Royal Nested B', code: 'NB' }, { ...original, id: 'nested-c', name: 'Royal Nested C', code: 'NC' }, ...(created ? [created] : [])];
    const fallbacks = () => units().map(u => ({ unit_id: u.id, unit_name: u.name, fallbacks: u.id === original.id ? units().slice(1, 3).map(x => ({ unit_id: x.id, unit_name: x.name })) : [] }));
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.addInitScript(() => { localStorage.setItem('duty_rota_auth_token', 'nested-reference-local'); localStorage.setItem('duty_rota_working_month', '2026-11'); });
    await page.route('**/api/**', async route => {
      const q = route.request(), url = new URL(q.url()), p = url.pathname;
      requests.push({ method: q.method(), path: p });
      if (q.method() !== 'GET') {
        const body = q.postDataJSON(); writes.push({ method: q.method(), path: p, body });
        if (q.method() !== 'POST' || p !== '/api/v1/normalization/units' || created) return route.fulfill({ status: 500, json: { detail: 'Diagnostic forbids every mutation except one new-unit POST' } });
        created = { ...original, ...body, id: 'nested-new', call_minimums: [], revision: 'created', usage: original.usage };
        return route.fulfill({ json: created });
      }
      if (p === '/api/v1/admin/members') return route.fulfill({ json: [] });
      if (p === '/api/v1/normalization/units') return route.fulfill({ json: units() });
      if (p === '/api/v1/normalization/units/suggest-code') return route.fulfill({ json: { code: 'NN' } });
      if (p.startsWith('/api/v1/normalization/catalog/')) return route.fulfill({ json: [{ key: '2ND_CALL', label: '2nd Call', active: true }] });
      if (p === '/api/v1/extra-duty/unit-fallbacks') return route.fulfill({ json: fallbacks() });
      if (p === '/api/v1/unit-management/month') {
        reads++;
        const month = url.searchParams.get('month');
        return route.fulfill({ json: { month, starts_on: month + '-01', ends_on: month + '-30', units: units(), assignments: [], unit_summaries: units().map(u => ({ unit_id: u.id, assigned_members: 0, people_with_leave: 0, leave_days: 0, leave_by_call_level: {} })), unit_call_minimums: [], validation_issues: [] } });
      }
      return route.fulfill({ response: await route.fetch({ url: api + p + url.search, maxRetries: 2 }) });
    });
    try {
      await page.goto(base + '/#view=units', { waitUntil: 'domcontentloaded' });
      const fallback = page.locator('[data-fallback-unit="nested-parent"]');
      await fallback.locator('summary').click(); await fallback.locator('[data-fb-up="nested-c"]').click();
      await page.locator('#unit-fallbacks-host').evaluate(e => { window.__nestedHost = e; window.__nestedRow = e.querySelector('[data-fallback-unit="nested-parent"]'); });
      await page.locator('input[data-unit-board-search]').fill('Royal');
      await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
      await page.locator('[data-unit-board-card="unit:nested-parent"] button[data-open-unit-modal]').click();
      const parent = page.locator('#unit-management-modal');
      await parent.locator('#unit-minimum-free-people').fill('3');
      await parent.locator('#unit-settings-form').evaluate(e => { window.__nestedSettings = e; window.__nestedInput = e.querySelector('#unit-minimum-free-people'); });
      const before = reads;
      await parent.locator('[data-add-operational-record="units"]').click();
      const editor = page.getByRole('dialog', { name: 'Add posting', exact: true });
      await editor.locator('[data-new-unit]').click();
      const registry = page.getByRole('dialog', { name: 'Manage department units', exact: true });
      await registry.locator('[name=name]').fill('Royal Nested New');
      await registry.locator('[name=campus]').fill('Main');
      await registry.locator('[name=code]').fill('NN');
      await registry.getByRole('button', { name: 'Create unit', exact: true }).click();
      // createNew auto-closes after accepted POST (reference-workspace.ts498-503).
      await registry.waitFor({ state: 'detached' });
      assert.equal(await editor.locator('[name=unit_id]').inputValue(), 'nested-new');
      await editor.locator('button[data-close]').first().click();
      await editor.waitFor({ state: 'detached' });
      await page.getByText('Saved changes are reflected in this view.', { exact: true }).waitFor();
      await page.waitForLoadState('networkidle');
      const observed = { parentReads: reads - before, newUnitCard: await page.locator('[data-unit-board-card="unit:nested-new"]').count(), settings: await parent.locator('#unit-minimum-free-people').inputValue(), retainedSettings: await parent.locator('#unit-settings-form').evaluate(e => e === window.__nestedSettings && e.querySelector('#unit-minimum-free-people') === window.__nestedInput), retainedFallback: await page.locator('#unit-fallbacks-host').evaluate(e => e === window.__nestedHost && e.querySelector('[data-fallback-unit="nested-parent"]') === window.__nestedRow), fallbackOrder: await fallback.locator('[data-fallback-item]').evaluateAll(es => es.map(e => e.dataset.fallbackItem)) };
      assert.equal(writes.length, 1); assert.equal(writes[0].path, '/api/v1/normalization/units');
      assert.equal(observed.retainedSettings, true); assert.equal(observed.settings, '3');
      assert.equal(observed.retainedFallback, true); assert.deepEqual(observed.fallbackOrder, ['nested-c', 'nested-b']);
      assert.deepEqual(errors, []);
      assert.equal(await fallback.locator('[data-fb-select] option[value="nested-new"]').count(), 1, 'Complete fallback choices include newly created unit');
      assert.equal(await fallback.locator('[data-fb-save]').isEnabled(), true, 'Unrelated reordered draft remains saveable');
      assert.equal(observed.newUnitCard, 1, JSON.stringify(observed));
      assert.ok(observed.parentReads >= 1, 'Accepted nested unit creation must refresh still-owned parent after editor discard');
      results.push({ engine, width, passed: true, observed, writes, requests, errors });
    } catch (error) {
      results.push({ engine, width, passed: false, assertion: error.message, observed: { parentReads: reads, created: Boolean(created), newUnitCard: await page.locator('[data-unit-board-card="unit:nested-new"]').count(), fallbackOrder: await page.locator('[data-fallback-unit="nested-parent"] [data-fallback-item]').evaluateAll(es => es.map(e => e.dataset.fallbackItem)) }, writes, requests, errors });
    } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); }
  } } finally { await browser.close(); }
}
for (const [path, expected] of Object.entries(audit.source_sha256)) assert.equal(sha(await readFile('../' + path)), expected, 'No source change during diagnostic');
await writeFile(report, JSON.stringify({ recorded_at_utc: new Date().toISOString(), author: '/root/nestedreference159_groundwork', scope: 'Six expected-correct nested record-editor unit creation then editor discard contexts only. Isolated V13 candidate; no import, member, catalog, recovery, physical-device or whole159 acceptance. All mutations locally fulfilled; unknown mutations rejected.', source_sha256: audit.source_sha256, candidate_sha256: candidates, test_sha256: sha(await readFile(new URL(import.meta.url))), results }, null, 2) + '\n');
assert.equal(results.length, 6); assert.equal(results.filter(r => !r.passed).length, 0, 'Expected-correct nested reference diagnostic');
