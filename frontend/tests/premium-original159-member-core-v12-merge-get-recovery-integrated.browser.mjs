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
const report = '../docs/premium-ui/qa-original159-member-core-v12-integrated-merge-get-recovery.json';
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
for (const [engine, launcher] of Object.entries({chromium,firefox,webkit})) {
  const browser = await launcher.launch();
  try { for (const width of [320, 1280]) for (const view of ['units', 'leave']) {
    const page = await browser.newPage({viewport: {width, height: 900}, reducedMotion: 'reduce'});
    page.setDefaultTimeout(15000);
    const requests = [], writes = [], errors = [];
    let failedParent=false;let saved = false, unitReads = 0, leaveReads = 0, memberReads = 0;
    const member = () => ({id: 'core-parent-person', canonical_name: 'Dr Core Original OLD', revision: saved ? 'target-rev-8' : 'target-rev-7', call_level: '2ND_CALL', active_status: 'active', aliases: [], designations: [], call_level_changes: []});
    const units = ['parent', 'b', 'c'].map(id => ({id: 'core-' + id, name: 'Royal Core ' + id, campus: 'Main', code: id.toUpperCase(), minimum_free_people: 1, active_status: 'active', notes: null}));
    const posting = () => ({id: 'core-parent-posting', person: member(), person_id: member().id, unit: units[0], unit_id: units[0].id, posting_type: '2ND_CALL', starts_on: '2026-11-01', ends_on: '2026-11-30', source: 'manual', notes: null});
    const leave = () => ({id: 'core-parent-leave', person: member(), person_id: member().id, leave_type: 'ANNUAL_LEAVE', leave_slot: 'FULL_DAY', starts_on: '2026-11-05', ends_on: '2026-11-05', status: 'approved', days: 1, source: 'manual', notes: null});
    const source = () => ({...member(), id: 'core-source-person', canonical_name: 'Dr Source To Merge', revision: 'source-rev-11'});
    const sourcePosting = () => ({...posting(), id: 'core-source-posting', person: saved ? member() : source(), person_id: saved ? member().id : source().id, starts_on: '2026-11-10', ends_on: '2026-11-20'});
    const sourceLeave = () => ({...leave(), id: 'core-source-leave', person: saved ? member() : source(), person_id: saved ? member().id : source().id, starts_on: '2026-11-10', ends_on: '2026-11-10'});
    const duplicates = () => saved ? [] : [{id: source().id, name: source().canonical_name, status: source().active_status, call_level: source().call_level, revision: source().revision, member: source(), designations: [], duties: 0, postings: 1, leave: 1, memberships: 0}];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('duty_rota_auth_token', 'core-parent-local'); localStorage.setItem('duty_rota_working_month', '2026-11'); });
    await page.route('**/api/**', async route => {
      const q = route.request(), u = new URL(q.url()), p = u.pathname;
      requests.push({method: q.method(), path: p, search: u.search});
      if (q.method() !== 'GET') {
        const body = q.postDataJSON(); writes.push({method: q.method(), path: p, body});
        assert.equal(q.method(), 'POST'); assert.equal(p, '/api/v1/admin/member-workspace/core-parent-person/merge');
        assert.deepEqual(body, {source_id: 'core-source-person', target_revision: 'target-rev-7', source_revision: 'source-rev-11'});
        saved = true; return route.fulfill({json: member()});
      }
      if (p === '/api/v1/admin/members') { memberReads++; return route.fulfill({json: saved ? [member()] : [member(), source()]}); }
      if (p === '/api/v1/admin/member-workspace/core-parent-person') return route.fulfill({json: {member: member(), impact: {}}});
      if (p === '/api/v1/admin/member-workspace/core-parent-person/duplicates') return route.fulfill({json: {rows: duplicates()}});
      if (p.startsWith('/api/v1/admin/member-workspace/core-parent-person/')) return route.fulfill({json: {rows: p.endsWith('/postings') ? [{...posting(), unit: units[0].name}] : p.endsWith('/leave') ? [leave()] : []}});
      if (p === '/api/v1/extra-duty/unit-fallbacks') return route.fulfill({json: units.map((unit, i) => ({unit_id: unit.id, unit_name: unit.name, fallbacks: i ? [] : units.slice(1).map(target => ({unit_id: target.id, unit_name: target.name}))}))});
      if (p === '/api/v1/unit-management/month') {
        unitReads++;
        if(saved&&!failedParent){failedParent=true;return route.fulfill({status:503,json:{detail:"Confirmed merge; parent unit read unavailable"}});}
        return route.fulfill({json: {month: u.searchParams.get('month'), starts_on: '2026-11-01', ends_on: '2026-11-30', units, assignments: [posting(), sourcePosting()], unit_summaries: units.map((unit, i) => ({unit_id: unit.id, assigned_members: i ? 0 : (saved ? 1 : 2), people_with_leave: 0, leave_days: 0, leave_by_call_level: {}})), unit_call_minimums: [], validation_issues: []}});
      }
      if (p === '/api/v1/leave/requests') { leaveReads++;if(saved&&!failedParent){failedParent=true;return route.fulfill({status:503,json:{detail:'Confirmed merge; parent leave read unavailable'}});} return route.fulfill({json: [leave(), sourceLeave()]}); }
      if (p === '/api/v1/leave/calendar') return route.fulfill({json: {month: '2026-11', summary: {month: '2026-11', starts_on: '2026-11-01', ends_on: '2026-11-30', total_requests: 2, blocking_requests: 2, people_on_leave: saved ? 1 : 2, total_leave_days: 2, busiest_day: null, status_counts: {approved: 2}, type_counts: {}, slot_counts: {}, unit_counts: {}, call_level_counts: {}}, days: {}}});
      if (p === '/api/v1/leave/pressure') return route.fulfill({json: {month: '2026-11', days: [], call_level_totals: {}, unit_totals: {}}});
      return route.fulfill({response: await route.fetch({url: 'http://127.0.0.1:8031' + p + u.search, maxRetries: 2})});
    });
    const observe = () => page.evaluate(() => {
      const host = document.querySelector('#unit-fallbacks-host'), row = host?.querySelector('[data-fallback-unit="core-parent"]');
      return {sourceLinks: document.querySelectorAll('[data-open-member="core-source-person"]').length, survivorLinks: document.querySelectorAll('[data-open-member="core-parent-person"]').length, transferredPostingLinks: [...document.querySelectorAll('#unit-management-modal [data-open-member]')].map(e => ({personId:e.dataset.openMember, text:e.textContent})), transferredLeaveLinks: [...document.querySelectorAll('section[aria-labelledby=leave-list-title] tbody [data-open-member]')].map(e=>({personId:e.dataset.openMember,text:e.textContent})), parentNames: [...document.querySelectorAll('[data-open-member="core-parent-person"]')].map(e => e.textContent), settingsValue: document.querySelector('#unit-minimum-free-people')?.value, formRetained: document.querySelector('#unit-settings-form') === window.__coreParentForm, inputRetained: document.querySelector('#unit-minimum-free-people') === window.__coreParentInput, fallbackHostRetained: host === window.__coreParentFallback, fallbackRowRetained: row === window.__coreParentFallbackRow, fallbackOrder: [...(row?.querySelectorAll('[data-fallback-item]') || [])].map(e => e.dataset.fallbackItem), fallbackSaveEnabled: Boolean(row?.querySelector('[data-fb-save]') && !row.querySelector('[data-fb-save]').disabled), search: document.querySelector('input[data-unit-board-search]')?.value, campus: document.querySelector('select[data-unit-board-campus]')?.value, leaveList: document.querySelector('[data-leave-calendar-view="list"]')?.getAttribute('aria-pressed'), notices: [...document.querySelectorAll('[data-profile-parent-refresh]')].map(e => e.textContent)};
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
      assert.ok(await page.locator('[data-open-member="core-source-person"]').count() > 0, 'Source member is present in the old parent before merge');
      await profile.locator('[data-tab="names"]').click();
      await profile.locator('[data-merge-source="core-source-person"]').waitFor({state:'visible'});
      const confirmations=[];
      page.once('dialog', async d => {confirmations.push(d.message()); await d.accept();});
      await profile.locator('[data-merge-source="core-source-person"]').click();
      await profile.getByText('No duplicate candidates found.', {exact:true}).waitFor();
      assert.equal(confirmations.length,1); assert.match(confirmations[0], /Merge Dr Source To Merge into Dr Core Original OLD/);
      assert.equal(unitReads,before.unitReads,'No early Unit read while profile remains open');
      assert.equal(leaveReads,before.leaveReads,'No early Leave read while profile remains open');
      assert.ok(await page.locator('[data-open-member="core-source-person"]').count() > 0,'Old parent remains visible until final close');
      await profile.locator('[data-close]').first().click(); await profile.waitFor({state: 'detached'});
      const retry=page.locator('[data-profile-parent-refresh] [data-retry-profile-parent]');await retry.waitFor({state:'visible'});
      assert.equal(writes.length,1);assert.equal(await page.locator('[data-open-member="core-source-person"]').count()>0,true);
      await retry.focus();await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('[data-open-member="core-source-person"]') && [...document.querySelectorAll('[data-profile-parent-refresh]')].some(e=>e.textContent.includes('Saved changes are reflected in this view.')), null, {timeout:5000});
      const observed = await observe();
      assert.equal(observed.sourceLinks,0,'Transferred records no longer reference source identity');
      assert.ok(observed.parentNames.every(n=>n==='Dr Core Original OLD'),'Surviving identity keeps its original name');
      if(view==='units') {
        assert.equal(observed.transferredPostingLinks.length,2);assert.ok(observed.transferredPostingLinks.every(r=>r.personId==='core-parent-person'));
        const transferred=page.locator('#unit-management-modal [data-unit-row-form="core-source-posting"]');
        assert.equal(await transferred.locator('[data-open-member="core-parent-person"]').count(),1);
        assert.equal(await transferred.locator('[data-edit-operational-record="core-source-posting"]').count(),1);
      } else {
        assert.equal(observed.transferredLeaveLinks.length,2);assert.ok(observed.transferredLeaveLinks.every(r=>r.personId==='core-parent-person'));
        const transferred=page.locator('section[aria-labelledby="leave-list-title"] tbody tr').filter({has:page.locator('[data-edit-operational-record="core-source-leave"]')});
        assert.equal(await transferred.locator('[data-open-member="core-parent-person"]').count(),1);
      }
      if (view === 'units') {
        assert.equal(unitReads, before.unitReads + 2); assert.equal(observed.settingsValue, '3'); assert.equal(observed.formRetained, true); assert.equal(observed.inputRetained, true);
        assert.equal(observed.fallbackHostRetained, true); assert.equal(observed.fallbackRowRetained, true); assert.deepEqual(observed.fallbackOrder, ['core-c', 'core-b']); assert.equal(observed.fallbackSaveEnabled, true); assert.equal(observed.search, 'Royal'); assert.equal(observed.campus, 'campus:Main');
      } else { assert.equal(leaveReads, before.leaveReads + 2); assert.equal(observed.leaveList, 'true'); }
      assert.equal(writes.length, 1); assert.deepEqual(errors, []);
      results.push({engine, width, view, passed: true, before, after: {unitReads, leaveReads, memberReads}, observed, writes, requests, errors});
    } catch (error) {
      results.push({engine, width, view, passed: false, assertion: error.message, saved, observed: await observe().catch(() => null), reads: {unitReads, leaveReads, memberReads}, writes, requests, errors});
      console.log(engine, width, view, 'member core parent diagnostic:', error.message);
    } finally { await page.unrouteAll({behavior: 'ignoreErrors'}); await page.close(); }
  }} finally {await browser.close();}
}
assert.deepEqual(await hashes(), initial);assert.equal(sha(await readFile("../tmp/member-core-parent-v12/member-workspace.ts")),sha(candidate));
await writeFile(report, JSON.stringify({recorded_at_utc: new Date().toISOString(), operator: '/root', author: '/root/membercore159_independent_design', execution_target: 'Fresh applied V12 source; bounded execution, no whole159 acceptance',candidate_sha256:sha(candidate), application_changed_by_test: false, source_sha256: initial, test_sha256: sha(await readFile(new URL(import.meta.url))), scope: '12 actual UI confirmed member merges with parentGET503/keyboardreadretry, Chromium/Firefox/WebKit at320/1280 from Units/Leave, exact source/target revisions, transferred source posting/leave records retain IDs but now reference same surviving member. Parent source identity disappears only after final close. Unit draft minimum3 and fallbackC,B/filter retention; Leave list retained. All writes locally fulfilled; unhandled GETs RAM8031. No physical/nativeAT/realDB evidence', results}, null, 2) + '\n');
assert.equal(results.length, 12); assert.ok(results.every(r => r.passed), 'Confirmed member merge must refresh transferred record identities without draft loss');
