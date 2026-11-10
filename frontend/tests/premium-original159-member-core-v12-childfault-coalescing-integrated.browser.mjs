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
const report = '../docs/premium-ui/qa-original159-member-core-v12-integrated-childfault-coalescing.json';
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
  try { for (const width of [320, 1280]) for (const view of ['units', 'leave']) for (const mode of ['postaccepted-childfault', 'two-saves-coalesced']) {
    const page = await browser.newPage({viewport: {width, height: 900}, reducedMotion: 'reduce'});
    page.setDefaultTimeout(15000);
    const requests = [], writes = [], errors = [];
    let saved = false, saveCount = 0, unitReads = 0, leaveReads = 0, memberReads = 0;
    const member = () => ({id: 'core-parent-person', canonical_name: saveCount > 1 ? 'Dr Core Renamed FINAL' : saved ? 'Dr Core Renamed NEW' : 'Dr Core Original OLD', call_level: saved ? '3RD_CALL' : '2ND_CALL', active_status: 'active', aliases: [], designations: [], call_level_changes: []});
    const units = ['parent', 'b', 'c'].map(id => ({id: 'core-' + id, name: 'Royal Core ' + id, campus: 'Main', code: id.toUpperCase(), minimum_free_people: 1, active_status: 'active', notes: null}));
    const posting = () => ({id: 'core-parent-posting', person: member(), person_id: member().id, unit: units[0], unit_id: units[0].id, posting_type: '2ND_CALL', starts_on: '2026-11-01', ends_on: '2026-11-30', source: 'manual', notes: null});
    const leave = () => ({id: 'core-parent-leave', person: member(), person_id: member().id, leave_type: 'ANNUAL_LEAVE', leave_slot: 'FULL_DAY', starts_on: '2026-11-05', ends_on: '2026-11-05', status: 'approved', days: 1, source: 'manual', notes: null});
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('duty_rota_auth_token', 'core-parent-local'); localStorage.setItem('duty_rota_working_month', '2026-11'); });
    await page.route('**/api/**', async route => {
      const q = route.request(), u = new URL(q.url()), p = u.pathname;
      requests.push({method: q.method(), path: p, search: u.search});
      if (q.method() !== 'GET') {
        const body = q.postDataJSON(); writes.push({method: q.method(), path: p, body});
        assert.equal(q.method(), 'PUT'); assert.equal(p, '/api/v1/admin/member-workspace/core-parent-person');
        assert.ok(saveCount < (mode === 'two-saves-coalesced' ? 2 : 1), 'No automatic or unexpected mutation replay');
        assert.deepEqual(body, {...member(), canonical_name: saveCount ? 'Dr Core Renamed FINAL' : 'Dr Core Renamed NEW', call_level: '3RD_CALL', preserve_previous_name: true});
        saved = true; saveCount++;
        if (mode === 'postaccepted-childfault') await page.evaluate(() => { window.__coreCloneFaultArmed = true; });
        return route.fulfill({status: 200, json: member()});
      }
      if (p === '/api/v1/admin/members') { memberReads++; return route.fulfill({json: [member()]}); }
      if (p === '/api/v1/admin/member-workspace/core-parent-person') return route.fulfill({json: {member: member(), impact: {}}});
      if (p.startsWith('/api/v1/admin/member-workspace/core-parent-person/')) return route.fulfill({json: {rows: p.endsWith('/postings') ? [{...posting(), unit: units[0].name}] : p.endsWith('/leave') ? [leave()] : []}});
      if (p === '/api/v1/extra-duty/unit-fallbacks') return route.fulfill({json: units.map((unit, i) => ({unit_id: unit.id, unit_name: unit.name, fallbacks: i ? [] : units.slice(1).map(target => ({unit_id: target.id, unit_name: target.name}))}))});
      if (p === '/api/v1/unit-management/month') {
        unitReads++;
        return route.fulfill({json: {month: u.searchParams.get('month'), starts_on: '2026-11-01', ends_on: '2026-11-30', units, assignments: [posting()], unit_summaries: units.map((unit, i) => ({unit_id: unit.id, assigned_members: i ? 0 : 1, people_with_leave: 0, leave_days: 0, leave_by_call_level: {}})), unit_call_minimums: [], validation_issues: []}});
      }
      if (p === '/api/v1/leave/requests') { leaveReads++; return route.fulfill({json: [leave()]}); }
      if (p === '/api/v1/leave/calendar') return route.fulfill({json: {month: '2026-11', summary: {month: '2026-11', starts_on: '2026-11-01', ends_on: '2026-11-30', total_requests: 1, blocking_requests: 1, people_on_leave: 1, total_leave_days: 1, busiest_day: null, status_counts: {approved: 1}, type_counts: {}, slot_counts: {}, unit_counts: {}, call_level_counts: {}}, days: {}}});
      if (p === '/api/v1/leave/pressure') return route.fulfill({json: {month: '2026-11', days: [], call_level_totals: {}, unit_totals: {}}});
      return route.fulfill({response: await route.fetch({url: 'http://127.0.0.1:8031' + p + u.search, maxRetries: 2})});
    });
    // Install before opening the profile. The throw is armed only after its
    // PUT has been captured and its successful response prepared. It matches
    // only the returned saved member, not the initial or unrelated clones.
    await page.addInitScript(() => {
      const clone = window.structuredClone.bind(window);
      window.__coreCloneFaultArmed = false;
      window.__coreCloneFaults = [];
      window.structuredClone = function(value, options) {
        if (window.__coreCloneFaultArmed && value?.id === 'core-parent-person' && value?.canonical_name === 'Dr Core Renamed NEW' && value?.call_level === '3RD_CALL') {
          window.__coreCloneFaultArmed = false;
          const error = new Error('INJECTED_CORE_POSTACCEPTED_CLONE_FAULT');
          window.__coreCloneFaults.push({name: value.canonical_name, stack: error.stack});
          throw error;
        }
        return clone(value, options);
      };
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
      let childFaultEvidence;
      if (mode === 'postaccepted-childfault') {
        await profile.locator('#mw-error').filter({hasText: 'INJECTED_CORE_POSTACCEPTED_CLONE_FAULT'}).waitFor({state: 'visible'});
        await page.waitForFunction(() => {
          const button = document.querySelector('#mw-error')?.closest('dialog')?.querySelector('button[type="submit"]');
          return Boolean(button && !button.disabled);
        });
        childFaultEvidence = await page.evaluate(() => ({faults: window.__coreCloneFaults, armed: window.__coreCloneFaultArmed, errorText: document.querySelector('#mw-error')?.textContent}));
        assert.equal(childFaultEvidence.faults.length, 1);
        assert.equal(childFaultEvidence.armed, false);
        assert.ok(childFaultEvidence.faults[0].stack.includes('member-workspace.ts'), 'Fault must originate in child completion, after request returned');
      } else {
        await profile.locator('[data-edit]').waitFor({state: 'visible'});
        assert.equal(await profile.locator('[data-field="canonical_name"]').inputValue(), 'Dr Core Renamed NEW');
        assert.equal(view === 'units' ? unitReads : leaveReads, view === 'units' ? before.unitReads : before.leaveReads, 'First confirmed save must await final profile close');
        await profile.locator('[data-edit]').click();
        await profile.locator('[data-field="canonical_name"]').fill('Dr Core Renamed FINAL');
        await profile.getByRole('button', {name: 'Save changes', exact: true}).click();
        await profile.locator('[data-edit]').waitFor({state: 'visible'});
        assert.equal(await profile.locator('[data-field="canonical_name"]').inputValue(), 'Dr Core Renamed FINAL');
      }
      assert.equal(view === 'units' ? unitReads : leaveReads, view === 'units' ? before.unitReads : before.leaveReads, 'Both accepted saves coalesce until final close');
      assert.equal((await observe()).parentNames.includes('Dr Core Original OLD'), true);
      await profile.locator('[data-close]').first().click(); await profile.waitFor({state: 'detached'});
      // Fresh parent identity is the expected behavior; collect the actual stale
      // snapshot if this bounded wait fails, then continue the remaining engines.
      const expectedName = mode === 'two-saves-coalesced' ? 'Dr Core Renamed FINAL' : 'Dr Core Renamed NEW';
      await page.waitForFunction(expected => [...document.querySelectorAll('[data-open-member="core-parent-person"]')].some(e => e.textContent === expected), expectedName, {timeout: 5000});
      const observed = await observe();
      assert.ok(observed.parentNames.includes(expectedName));
      if (view === 'units') {
        assert.equal(unitReads, before.unitReads + 1); assert.equal(observed.settingsValue, '3'); assert.equal(observed.formRetained, true); assert.equal(observed.inputRetained, true);
        assert.equal(observed.fallbackHostRetained, true); assert.equal(observed.fallbackRowRetained, true); assert.deepEqual(observed.fallbackOrder, ['core-c', 'core-b']); assert.equal(observed.fallbackSaveEnabled, true); assert.equal(observed.search, 'Royal'); assert.equal(observed.campus, 'campus:Main');
      } else { assert.equal(leaveReads, before.leaveReads + 1); assert.equal(observed.leaveList, 'true'); }
      assert.equal(writes.length, mode === 'two-saves-coalesced' ? 2 : 1); assert.deepEqual(errors, [], 'The injected clone fault is caught by child completion; no unhandled product JS errors');
      results.push({engine, width, view, mode, childFaultEvidence, passed: true, before, after: {unitReads, leaveReads, memberReads}, observed, writes, requests, errors});
    } catch (error) {
      results.push({engine, width, view, mode, passed: false, assertion: error.message, saved, observed: await observe().catch(() => null), reads: {unitReads, leaveReads, memberReads}, writes, requests, errors});
      console.log(engine, width, view, mode, 'member core childfault/coalescing diagnostic:', error.message);
    } finally { await page.unrouteAll({behavior: 'ignoreErrors'}); await page.close(); }
  }} finally {await browser.close();}
}
assert.deepEqual(await hashes(), initial);assert.equal(sha(await readFile("../tmp/member-core-parent-v12/member-workspace.ts")),sha(candidate));
await writeFile(report, JSON.stringify({recorded_at_utc: new Date().toISOString(), operator: '/root', author: '/root/core_v12_fault_tests', execution_target: 'Fresh applied V12 source; bounded execution, no whole159 acceptance',candidate_sha256:sha(candidate), application_changed_by_test: false, source_sha256: initial, test_sha256: sha(await readFile(new URL(import.meta.url))), scope: '8 Chromium contexts at320/1280 from Unit modal or Leave list: successful core PUT followed by one injected child structuredClone failure, and two successful core PUTs coalesced into one dependent parent GET only after final close. Local writes strictly bounded and exact full payloads asserted. Unit minimum3 and fallback C,B drafts, Royal/Main filters and Leave list retained. Fault must be caught without unhandled JS errors or automatic mutation replay. Only unhandled GETs use RAM8031. No physical-device/native AT or real database verification.', results}, null, 2) + '\n');
assert.equal(results.length, 8); assert.ok(results.every(r => r.passed), 'Confirmed member core edits must refresh current dependent parents without draft loss');
