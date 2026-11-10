import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';

// Root coordinates execution. This expected-correct diagnostic never sends writes
// through to a service: both existing delete POSTs are fulfilled locally.
const sha = value => createHash('sha256').update(value).digest('hex');
const files = ['main', 'extra-duty', 'admin-delete', 'services/api'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async name =>
  ['frontend/src/' + name + '.ts', sha(await readFile('src/' + name + '.ts'))])));
const initial = await hashes();
assert.equal(initial['frontend/src/main.ts'], '9f5359ad9e8014098bc12c8ed3f9e1c6b1a06d1a4f92797b7f9da24bfba6e6b8');
const report = '../docs/premium-ui/qa-original159-delete-v11r1-fallback-retention.json';
await assert.rejects(access(report), { code: 'ENOENT' });
const base = 'http://127.0.0.1:5303';
const served = await (await fetch(base + '/src/main.ts')).text();
const encoded = served.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
assert.ok(encoded, 'Actual Vite inline source map required');
const candidate=await readFile('../tmp/delete-parent-refresh-v11r1/main.ts');assert.equal(sha(Buffer.from(JSON.parse(Buffer.from(encoded[1], 'base64').toString()).sourcesContent[0])),sha(candidate));
const results = [];
const member = { id: 'delete-parent-person', canonical_name: 'Dr Royal Delete Parent', call_level: '2ND_CALL', active_status: 'active', aliases: [], designations: [], call_level_changes: [] };
const units = ['parent', 'b', 'c'].map((id, index) => ({ id: 'delete-' + id, name: 'Royal Delete ' + id, campus: 'Main', code: id.toUpperCase(), minimum_free_people: 1, active_status: 'active', notes: null }));
const posting = { id: 'delete-parent-posting', person: member, person_id: member.id, unit: units[0], unit_id: units[0].id, posting_type: '2ND_CALL', starts_on: '2026-11-01', ends_on: '2026-11-30', source: 'manual', notes: 'Delete only this posting' };
for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await launcher.launch();
  try {
    for (const width of [320, 1280]) for (const entry of (width === 320 ? ['modal', 'month'] : ['modal', 'month', 'row', 'selected'])) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const requests = [], writes = [], errors = []; let deleted = false, unitReads = 0, fallbackReads = 0;
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem('duty_rota_auth_token', 'delete-fallback-local');
        localStorage.setItem('duty_rota_working_month', '2026-11');
      });
      const selection = entry === 'month' ? { kind: 'posting', month: '2026-11' } : { kind: 'posting', ids: [posting.id] };
      await page.route('**/api/**', async route => {
        const q = route.request(), u = new URL(q.url()), p = u.pathname;
        requests.push({ method: q.method(), path: p, search: u.search });
        if (q.method() !== 'GET') {
          const body = q.postDataJSON(); writes.push({ method: q.method(), path: p, body });
          assert.equal(q.method(), 'POST');
          if (p === '/api/v1/admin/delete/preview') {
            assert.deepEqual(body, selection);
            return route.fulfill({ json: { kind: 'posting', count: 1, items: [{ id: posting.id, label: 'Dr Royal Delete Parent posting' }], blocked: [], effects: {}, preview_token: 'delete-fallback-preview', confirm_phrase: entry === 'month' ? 'DELETE POSTINGS NOVEMBER 2026' : null } });
          }
          assert.equal(p, '/api/v1/admin/delete');
          assert.deepEqual(body, { ...selection, preview_token: 'delete-fallback-preview', ...(entry === 'month' ? { confirm_phrase: 'DELETE POSTINGS NOVEMBER 2026' } : {}) });
          deleted = true;
          return route.fulfill({ json: { batch_id: 'delete-fallback-local-batch', deleted: 1 } });
        }
        if (p === '/api/v1/admin/members') return route.fulfill({ json: [member] });
        if (p === '/api/v1/extra-duty/unit-fallbacks') {
          fallbackReads++;
          return route.fulfill({ json: units.map((unit, index) => ({ unit_id: unit.id, unit_name: unit.name, fallbacks: index ? [] : units.slice(1).map(target => ({ unit_id: target.id, unit_name: target.name })) })) });
        }
        if (p === '/api/v1/unit-management/month') {
          unitReads++;
          return route.fulfill({ json: { month: u.searchParams.get('month'), starts_on: '2026-11-01', ends_on: '2026-11-30', units, assignments: deleted ? [] : [posting], unit_summaries: units.map((unit, index) => ({ unit_id: unit.id, assigned_members: index || deleted ? 0 : 1, people_with_leave: 0, leave_days: 0, leave_by_call_level: {} })), unit_call_minimums: [], validation_issues: [] } });
        }
        return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:8031' + p + u.search, maxRetries: 2 }) });
      });
      const observe = () => page.evaluate(() => {
        const host = document.querySelector('#unit-fallbacks-host'), row = host?.querySelector('[data-fallback-unit="delete-parent"]');
        return { hostRetained: host === window.__deleteFallbackHost, rowRetained: row === window.__deleteFallbackRow, order: [...(row?.querySelectorAll('[data-fallback-item]') || [])].map(e => e.dataset.fallbackItem), saveEnabled: Boolean(row?.querySelector('[data-fb-save]') && !row.querySelector('[data-fb-save]').disabled), search: document.querySelector('input[data-unit-board-search]')?.value, campus: document.querySelector('select[data-unit-board-campus]')?.value };
      });
      try {
        await page.goto(base + '/#view=units', { waitUntil: 'domcontentloaded' });
        const fallback = page.locator('[data-fallback-unit="delete-parent"]');
        await fallback.locator('summary').click();
        await fallback.locator('[data-fb-up="delete-c"]').click();
        assert.deepEqual(await fallback.locator('[data-fallback-item]').evaluateAll(es => es.map(e => e.dataset.fallbackItem)), ['delete-c', 'delete-b']);
        assert.equal(await fallback.locator('[data-fb-save]').isEnabled(), true);
        await page.locator('#unit-fallbacks-host').evaluate(e => { window.__deleteFallbackHost = e; window.__deleteFallbackRow = e.querySelector('[data-fallback-unit="delete-parent"]'); });
        await page.locator('input[data-unit-board-search]').fill('Royal');
        await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
        const before = { unitReads, fallbackReads };
        if (entry === 'modal') {
          await page.locator('[data-unit-board-card="unit:delete-parent"] button[data-open-unit-modal]').click();
          await page.locator('#unit-management-modal [data-delete-unit-assignment="delete-parent-posting"]').click();
        } else if (entry === 'month') {
          await page.locator('[aria-label="Unit actions"] details.row-menu > summary').click();
          await page.locator('[data-delete-month="posting"]').click();
        } else if (entry === 'row') {
          const row = page.locator('[data-unit-board-row="unit:delete-parent"]');
          await row.locator('details.row-menu > summary').click();
          await row.locator('[data-delete-posting="delete-parent-posting"]').click();
        } else {
          await page.locator('[data-admin-select="posting"][value="delete-parent-posting"]').check();
          await page.locator('[data-delete-selected="posting"]').click();
        }
        const dialog = page.locator('dialog.admin-delete');
        await dialog.locator('[data-delete]').filter({ hasText: 'Delete 1 posting' }).waitFor();
        if (entry === 'month') await dialog.locator('[data-phrase]').fill('DELETE POSTINGS NOVEMBER 2026');
        await dialog.locator('[data-delete]:enabled').click();
        await dialog.waitFor({ state: 'detached' });
        // The read must settle through visible refreshed posting count before checking retention.
        await page.locator('.page-toolbar__context').filter({ hasText: '0 postings' }).waitFor();
        await page.locator('[data-fallback-unit="delete-parent"]').waitFor();
        const observed = await observe();
        assert.equal(observed.hostRetained, true, 'Confirmed posting deletion must retain unrelated fallback draft host');
        assert.equal(observed.rowRetained, true);
        assert.deepEqual(observed.order, ['delete-c', 'delete-b']);
        assert.equal(observed.saveEnabled, true);
        assert.equal(observed.search, 'Royal'); assert.equal(observed.campus, 'campus:Main');
        assert.equal(unitReads, before.unitReads + 1);
        assert.equal(writes.filter(w => w.path === '/api/v1/admin/delete').length, 1);
        assert.equal(writes.length, 2); assert.deepEqual(errors, []);
        results.push({ engine, width, entry, passed: true, observed, before, after: { unitReads, fallbackReads }, writes, requests, errors });
      } catch (error) {
        results.push({ engine, width, entry, passed: false, assertion: error.message, observed: await observe().catch(() => null), deleted, unitReads, fallbackReads, writes, requests, errors });
        console.log(engine, width, entry, 'posting-delete diagnostic failed:', error.message);
      } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); }
    }
  } finally { await browser.close(); }
}
assert.deepEqual(await hashes(), initial);
await writeFile(report, JSON.stringify({ recorded_at_utc: new Date().toISOString(), operator: '/root', author: '/root/delete159_groundwork', application_changed:false, candidate_sha256:sha(candidate), scope: '18 isolated candidate actual-UI posting deletion contexts: modal and month across three engines at320/1280; desktop row and selected across three engines. Each starts unrelated fallback C,B draft and Royal/Main filters. Only preview/delete POSTs locally fulfilled; unhandled GETs disposable RAM8031. No browser run by author; a failed assertion is diagnostic evidence, not acceptance.', source_sha256: initial, test_sha256: sha(await readFile(new URL(import.meta.url))), results }, null, 2) + '\n');
assert.equal(results.length, 18); assert.ok(results.every(r => r.passed), 'Posting deletions must preserve unrelated drafts; all observations retained');
