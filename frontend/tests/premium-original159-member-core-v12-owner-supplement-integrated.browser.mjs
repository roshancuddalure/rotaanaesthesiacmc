import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';

// Authored for root-coordinated execution. All mutations are fulfilled here;
// only otherwise-unhandled GETs reach the disposable RAM fixture on port 8031.
const sha = v => createHash('sha256').update(v).digest('hex');
const paths = ['main', 'member-workspace', 'extra-duty', 'services/api'];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async p =>
  ['frontend/src/' + p + '.ts', sha(await readFile('src/' + p + '.ts'))])));
const initial = await hashes();
assert.equal(initial['frontend/src/main.ts'], '45743fb64260289e50526480572bf25e33d8dc1a69f83397286660a03951cfba');
assert.equal(initial['frontend/src/member-workspace.ts'], '88774f277131a1ed83174d288d882653fc04add295b8237fefa62636e08617ea');
const report = '../docs/premium-ui/qa-original159-member-core-v12-integrated-owner-supplement.json';
await assert.rejects(access(report), {code: 'ENOENT'});
const base = 'http://127.0.0.1:5197';
const candidate=await readFile('../tmp/member-core-parent-v12/member-workspace.ts');assert.equal(sha(candidate),'88774f277131a1ed83174d288d882653fc04add295b8237fefa62636e08617ea');
for (const p of ['main', 'member-workspace']) {
  const served = await (await fetch(base + '/src/' + p + '.ts')).text();
  const encoded = served.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
  assert.ok(encoded, 'Inline source map required for ' + p);
  assert.equal(sha(Buffer.from(JSON.parse(Buffer.from(encoded[1], 'base64').toString()).sourcesContent[0])), p==='member-workspace'?sha(candidate):initial['frontend/src/' + p + '.ts']);
}
const results = [];
for (const [engine, launcher] of Object.entries({chromium})) {
  const browser = await launcher.launch();
  try { for (const width of [320, 1280]) for (const view of ['units', 'leave']) for (const scenario of ['route', 'month', 'account']) {
    const page = await browser.newPage({viewport: {width, height: 900}, reducedMotion: 'reduce'});
    page.setDefaultTimeout(15000);
    const requests = [], writes = [], errors = [];
    let closeWindow = false; const expiredCloseGets = [];
    let saved = false, unitReads = 0, leaveReads = 0, memberReads = 0;
    const member = () => ({id: 'core-parent-person', canonical_name: saved ? 'Dr Core Renamed NEW' : 'Dr Core Original OLD', call_level: saved ? '3RD_CALL' : '2ND_CALL', active_status: 'active', aliases: [], designations: [], call_level_changes: []});
    const units = ['parent', 'b', 'c'].map(id => ({id: 'core-' + id, name: 'Royal Core ' + id, campus: 'Main', code: id.toUpperCase(), minimum_free_people: 1, active_status: 'active', notes: null}));
    const posting = () => ({id: 'core-parent-posting', person: member(), person_id: member().id, unit: units[0], unit_id: units[0].id, posting_type: '2ND_CALL', starts_on: '2026-11-01', ends_on: '2026-11-30', source: 'manual', notes: null});
    const leave = () => ({id: 'core-parent-leave', person: member(), person_id: member().id, leave_type: 'ANNUAL_LEAVE', leave_slot: 'FULL_DAY', starts_on: '2026-11-05', ends_on: '2026-11-05', status: 'approved', days: 1, source: 'manual', notes: null});
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('duty_rota_auth_token', 'core-parent-local'); localStorage.setItem('duty_rota_working_month', '2026-11'); });
    await page.route('**/api/**', async route => {
      const q = route.request(), u = new URL(q.url()), p = u.pathname;
      const inFixtureMonth = (u.searchParams.get('month') || '2026-11') === '2026-11';
      requests.push({method: q.method(), path: p, search: u.search, closeWindow});
      if (closeWindow && q.method() === 'GET') expiredCloseGets.push({path: p, search: u.search});
      if (q.method() !== 'GET') {
        const body = q.postDataJSON(); writes.push({method: q.method(), path: p, body});
        assert.equal(q.method(), 'PUT'); assert.equal(p, '/api/v1/admin/member-workspace/core-parent-person');
        assert.equal(body.canonical_name, 'Dr Core Renamed NEW'); assert.equal(body.call_level, '3RD_CALL');
        assert.equal(body.preserve_previous_name, true); assert.deepEqual(body.aliases, []);
        saved = true; return route.fulfill({json: member()});
      }
      if (p === '/api/v1/admin/members') { memberReads++; return route.fulfill({json: [member()]}); }
      if (p === '/api/v1/admin/member-workspace/core-parent-person') return route.fulfill({json: {member: member(), impact: {}}});
      if (p.startsWith('/api/v1/admin/member-workspace/core-parent-person/')) return route.fulfill({json: {rows: p.endsWith('/postings') ? [{...posting(), unit: units[0].name}] : p.endsWith('/leave') ? [leave()] : []}});
      if (p === '/api/v1/extra-duty/unit-fallbacks') return route.fulfill({json: units.map((unit, i) => ({unit_id: unit.id, unit_name: unit.name, fallbacks: i ? [] : units.slice(1).map(target => ({unit_id: target.id, unit_name: target.name}))}))});
      if (p === '/api/v1/unit-management/month') {
        unitReads++;
        return route.fulfill({json: {month: u.searchParams.get('month'), starts_on: (u.searchParams.get('month') || '2026-11') + '-01', ends_on: (u.searchParams.get('month') || '2026-11') + (u.searchParams.get('month') === '2026-12' ? '-31' : '-30'), units, assignments: inFixtureMonth ? [posting()] : [], unit_summaries: units.map((unit, i) => ({unit_id: unit.id, assigned_members: i || !inFixtureMonth ? 0 : 1, people_with_leave: 0, leave_days: 0, leave_by_call_level: {}})), unit_call_minimums: [], validation_issues: []}});
      }
      if (p === '/api/v1/leave/requests') { leaveReads++; return route.fulfill({json: inFixtureMonth ? [leave()] : []}); }
      if (p === '/api/v1/leave/calendar') return route.fulfill({json: {month: u.searchParams.get('month') || '2026-11', summary: {month: u.searchParams.get('month') || '2026-11', starts_on: (u.searchParams.get('month') || '2026-11') + '-01', ends_on: (u.searchParams.get('month') || '2026-11') + (u.searchParams.get('month') === '2026-12' ? '-31' : '-30'), total_requests: +inFixtureMonth, blocking_requests: +inFixtureMonth, people_on_leave: +inFixtureMonth, total_leave_days: +inFixtureMonth, busiest_day: null, status_counts: inFixtureMonth ? {approved: 1} : {}, type_counts: {}, slot_counts: {}, unit_counts: {}, call_level_counts: {}}, days: {}}});
      if (p === '/api/v1/leave/pressure') return route.fulfill({json: {month: u.searchParams.get('month') || '2026-11', days: [], call_level_totals: {}, unit_totals: {}}});
      return route.fulfill({response: await route.fetch({url: 'http://127.0.0.1:8031' + p + u.search, maxRetries: 2})});
    });
    const observe = () => page.evaluate(() => {
      const host = document.querySelector('#unit-fallbacks-host'), row = host?.querySelector('[data-fallback-unit="core-parent"]');
      return {parentNames: [...document.querySelectorAll('[data-open-member="core-parent-person"]')].map(e => e.textContent), settingsValue: document.querySelector('#unit-minimum-free-people')?.value, formRetained: document.querySelector('#unit-settings-form') === window.__coreParentForm, inputRetained: document.querySelector('#unit-minimum-free-people') === window.__coreParentInput, fallbackHostRetained: host === window.__coreParentFallback, fallbackRowRetained: row === window.__coreParentFallbackRow, fallbackOrder: [...(row?.querySelectorAll('[data-fallback-item]') || [])].map(e => e.dataset.fallbackItem), fallbackSaveEnabled: Boolean(row?.querySelector('[data-fb-save]') && !row.querySelector('[data-fb-save]').disabled), search: document.querySelector('[data-unit-board-search]')?.value, campus: document.querySelector('[data-unit-board-campus]')?.value, leaveList: document.querySelector('[data-leave-calendar-view="list"]')?.getAttribute('aria-pressed'), notices: [...document.querySelectorAll('[data-profile-parent-refresh]')].map(e => e.textContent)};
    });
    try {
      await page.goto(base + '/#view=' + view, {waitUntil: 'domcontentloaded'});
      if (view === 'units') {
        const fallback = page.locator('[data-fallback-unit="core-parent"]');
        await fallback.locator('summary').click(); await fallback.locator('[data-fb-up="core-c"]').click();
        await page.locator('#unit-fallbacks-host').evaluate(e => {window.__coreParentFallback = e; window.__coreParentFallbackRow = e.querySelector('[data-fallback-unit="core-parent"]');});
        await page.locator('input[data-unit-board-search]').fill('Royal'); await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
        await page.locator('[data-unit-board-card="unit:core-parent"] button[data-open-unit-modal]').click();
        await page.locator('#unit-minimum-free-people').fill('3');
        await page.locator('#unit-settings-form').evaluate(e => {window.__coreParentForm = e; window.__coreParentInput = e.querySelector('#unit-minimum-free-people');});
        await page.locator('#unit-management-modal [data-open-member="core-parent-person"]').click();
      } else {
        await page.locator('[data-leave-calendar-view="list"]').click();
        const scope = width === 320 ? page.locator('section.card-list[aria-label="Leave this month"]:visible') : page.locator('section[aria-labelledby="leave-list-title"]:visible');
        await scope.locator('[data-open-member="core-parent-person"]').click();
      }
      const before = {unitReads, leaveReads, memberReads};
      const profile = page.getByRole('dialog', {name: 'Member profile', exact: true});
      await profile.locator('[data-edit]').click();
      await profile.locator('[data-field="canonical_name"]').fill('Dr Core Renamed NEW');
      await profile.locator('[data-field="call_level"]').selectOption('3RD_CALL');
      await profile.getByRole('button', {name: 'Save changes', exact: true}).click();
      await profile.locator('[data-edit]').waitFor({state: 'visible'});
      assert.equal(await profile.locator('[data-field="canonical_name"]').inputValue(), 'Dr Core Renamed NEW');
      // These actions intentionally bypass the native modal's inert background.
      // They model newer route/month/account ownership while this profile is open.
      const afterSave = {unitReads, leaveReads};
      assert.deepEqual(afterSave, {unitReads: before.unitReads, leaveReads: before.leaveReads}, 'Core accepted while profile open must defer parent read');
      if (scenario === 'route') {
        await page.evaluate(() => {location.hash = '#view=user-guide';});
        await page.locator('#guide-checklist').waitFor();
      } else if (scenario === 'month') {
        await page.evaluate(() => {const input = document.querySelector('#working-month'); input.value = '2026-12'; input.dispatchEvent(new Event('change', {bubbles: true}));});
        await page.waitForFunction(() => document.querySelector('#working-month')?.value === '2026-12');
        await page.waitForLoadState('networkidle');
      } else {
        // The account event itself may dismiss the dialog. Start observing first,
        // so an expired owner's automatic close cannot escape this assertion.
        await page.waitForLoadState('networkidle');
        closeWindow = true;
        await page.evaluate(() => {localStorage.removeItem('duty_rota_auth_token'); window.dispatchEvent(new StorageEvent('storage', {key: 'duty_rota_auth_token', oldValue: 'core-parent-local', newValue: null, storageArea: localStorage}));});
        await profile.waitFor({state: 'detached'});
      }
      const afterSteering = {unitReads, leaveReads};
      closeWindow = true;
      if (await profile.count()) {await profile.locator('[data-close]').first().click(); await profile.waitFor({state: 'detached'});}
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual({unitReads, leaveReads}, afterSteering, 'Expired profile final close must start zero parent GETs');
      assert.deepEqual(expiredCloseGets, [], 'Expired owner must start no GET after close');
      assert.equal(await page.locator('[data-profile-parent-refresh]').count(), 0, 'No stale parent notice');
      if (scenario === 'route') assert.equal(await page.evaluate(() => location.hash), '#view=user-guide');
      else if (scenario === 'month') assert.equal(await page.locator('#working-month').inputValue(), '2026-12');
      else assert.equal(await page.locator('#section-title').count(), 0);
      const observed = await observe();
      assert.equal(writes.length, 1); assert.deepEqual(errors, []);
      results.push({engine, width, view, scenario, expiredCloseGets, passed: true, before, after: {unitReads, leaveReads, memberReads}, observed, writes, requests, errors});
    } catch (error) {
      results.push({engine, width, view, scenario, expiredCloseGets, passed: false, assertion: error.message, saved, observed: await observe().catch(() => null), reads: {unitReads, leaveReads, memberReads}, writes, requests, errors});
      console.log(engine, width, view, scenario, 'member core owner supplement:', error.message);
    } finally { await page.unrouteAll({behavior: 'ignoreErrors'}); await page.close(); }
  }} finally {await browser.close();}
}
assert.deepEqual(await hashes(), initial);assert.equal(sha(await readFile("../tmp/member-core-parent-v12/member-workspace.ts")),sha(candidate));
await writeFile(report, JSON.stringify({recorded_at_utc: new Date().toISOString(), operator: '/root', author: '/root/core_v12_owner_tests', execution_target: 'Fresh applied V12 source; bounded execution, no whole159 acceptance',candidate_sha256:sha(candidate), application_changed_by_test: false, source_sha256: initial, test_sha256: sha(await readFile(new URL(import.meta.url))), scope: '12 Chromium contexts:320/1280 x Units/Leave x newer route/month/account ownership after accepted core profile save while modal remains open. Explicit programmatic navigation/month/storage steering bypasses native dialog inert background. Final expired close must make no GET or stale notice. All mutations locally fulfilled; unhandled GETs only disposable RAM8031. No integration, broader engine, physical-device, native AT, or production claim.', results}, null, 2) + '\n');
assert.equal(results.length, 12); assert.ok(results.every(r => r.passed), 'Expired member core parent owner must not read or restore stale notices');
