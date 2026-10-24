// Real API + disposable in-memory DB. Sequential original/current runs restore identical seed IDs.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const baseline = resolve('../tmp/premium-ui-baseline-20261021T130359Z');
const api = 'http://127.0.0.1:8032';
const out = resolve('../docs/premium-ui/equivalence-generation');
const manifest = JSON.parse(await readFile(join(baseline, 'manifest.json'), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const hashes = async root => {
  const result = {};
  async function visit(path) {
    for (const entry of await readdir(join(root, path), {withFileTypes: true})) {
      const child = path + '/' + entry.name;
      if (entry.isDirectory()) await visit(child);
      else result[child] = sha(await readFile(join(root, child)));
    }
  }
  await visit('src');
  return result;
};
const held = await hashes(resolve('.'));
const baselineHeld = await hashes(join(baseline, 'frontend'));
for (const [file, digest] of Object.entries(baselineHeld)) {
  assert.equal(digest, manifest.files['frontend/' + file], `Captured baseline ${file}`);
}
const backendHeld = {};
async function holdBackend(path = '../backend/app') {
  for (const entry of await readdir(path, {withFileTypes: true})) {
    if (entry.name === '__pycache__') continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) await holdBackend(child);
    else backendHeld[child] = sha(await readFile(child));
  }
}
await holdBackend();
await mkdir(out, {recursive: true});
const fetchJSON = async (path, init) => {
  const response = await fetch(api + path, init);
  assert.equal(response.ok, true, `${path}: ${response.status}`);
  return response.json();
};
const state = async () => {
  const value = await fetchJSON('/__equivalence/state');
  assert.equal(value.storage, 'disposable-sqlite-memory');
  const {slot_id_map, ...data} = value;
  return {data, slotIds: slot_id_map};
};
// Independent bounded oracle: tools/generation_smoke_server.py requests only
// MAIN_1ST_24HR for May 1–4. tests/test_rota_auto_fill.py seeds four 1st-call
// Unit I postings and approved full-day leave for Blocked Member on May 2.
// This does not try to certify the optimizer's fairness objective or all rules.
const expectedSlotKeys = [1, 2, 3, 4].map(day =>
  [`2026-05-0${day}`, 'MAIN_1ST_24HR', 'Unit I', '1ST_CALL', 'UNIT_I:primary']);
const expectedPeople = ['Blocked Member', 'Safe Member', 'Spare One', 'Spare Two'];
const assertTemplateScope = data => {
  assert.deepEqual(data.slots.map(row => row.key), expectedSlotKeys,
    'Exactly the four requested dates, duty type, unit, call and label are saved');
  for (const [index, slot] of data.slots.entries()) {
    assert.equal(slot.starts_at, `2026-05-0${index + 1}T08:00:00`);
    assert.equal(slot.ends_at, `2026-05-0${index + 2}T08:00:00`);
    assert.equal(slot.is_24hr, true);
    assert.equal(slot.max_assignees, 1);
    assert.equal(slot.source, 'phase4_template');
  }
};
const assertSeedEligibility = (proposal, preview) => {
  assert.deepEqual(preview.data.fixture_people.map(([, name]) => name).sort(), expectedPeople);
  const people = new Map(preview.data.fixture_people);
  assert.equal(proposal.decisions.length, 4, 'One decision per requested duty');
  assert.equal(proposal.proposed, 4);
  assert.equal(proposal.unresolved, 0);
  const covered = new Set();
  for (const decision of proposal.decisions) {
    const key = preview.slotIds[decision.slot_id];
    assert.ok(key, 'Every assignment targets a saved fixture duty');
    assert.equal(decision.action, 'proposed');
    assert.equal(people.get(decision.person_id), decision.person_name,
      'Proposed identity matches the seeded member ID, not just a display name');
    assert.ok(expectedPeople.includes(decision.person_name), 'Member has the seeded matching Unit I / 1st-call posting');
    assert.equal(key[3], '1ST_CALL');
    assert.equal(key[2], 'Unit I');
    assert.equal(decision.date, key[0]);
    assert.equal(decision.unit, key[2]);
    assert.equal(decision.duty, key[4]);
    assert.equal(decision.is_24hr, true);
    assert.ok(!(key[0] === '2026-05-02' && decision.person_name === 'Blocked Member'),
      'Approved full-day leave is respected independently of baseline parity');
    const semanticKey = JSON.stringify(key);
    assert.equal(covered.has(semanticKey), false, 'No duplicate decision or overfilled duty');
    covered.add(semanticKey);
  }
  assert.deepEqual([...covered].sort(), expectedSlotKeys.map(key => JSON.stringify(key)).sort());
};
const results = [];
const engines = process.env.EQUIVALENCE_ENGINE ? {[process.env.EQUIVALENCE_ENGINE]: {chromium, firefox, webkit}[process.env.EQUIVALENCE_ENGINE]} : process.env.EQUIVALENCE_QUICK === '1' ? {chromium} : {chromium, firefox, webkit};
const widths = process.env.EQUIVALENCE_QUICK === '1' ? [1280] : [320, 1280];
for (const [engine, launcher] of Object.entries(engines)) {
  const browser = await launcher.launch();
  try { for (const width of widths) {
    const runs = [];
    for (const [label, origin] of [['baseline', 'http://127.0.0.1:5200'], ['current', 'http://127.0.0.1:5197']]) {
      assert.equal((await fetchJSON('/__equivalence/reset', {method: 'POST'})).restored, true);
      const initial = await state();
      assert.equal(initial.data.slots.length, 0);
      assert.equal(initial.data.assignments.length, 0);
      const context = await browser.newContext({viewport: {width, height: 900}, acceptDownloads: true});
      const page = await context.newPage(), errors = [], mutations = [], jobs = new Map(), stages = [];
      let templateSaved;
      const runDir = join(out, `${engine}-${width}-${label}`);
      await mkdir(runDir, {recursive: true});
      page.setDefaultTimeout(45000);
      page.on('pageerror', error => errors.push(error.message));
      await context.addInitScript(() => {
        localStorage.setItem('duty_rota_auth_token', 'disposable-equivalence');
        localStorage.setItem('duty_rota_working_month', '2026-05');
      });
      await page.route('**/__equivalence-ui', route => route.fulfill({contentType: 'text/html', body:
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>UI equivalence fixture</title><link rel="stylesheet" href="/src/styles.css">' +
        (label === 'current' ? '<link rel="stylesheet" href="/src/premium-theme.css">' : '') +
        '</head><body><main><h1>Generation verification</h1><button id="open">Open generator</button></main></body></html>'}));
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url());
        const response = await route.fetch({url: api + url.pathname + url.search, timeout: 120000});
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
          const body = request.postDataJSON();
          if (url.pathname === '/api/v1/rota-compute/jobs' && response.ok()) {
            const job = await response.json();
            jobs.set(job.id, `<${job.kind || 'members'}-job-${jobs.size + 1}>`);
          }
          let path = url.pathname;
          for (const [id, symbol] of jobs) path = path.replace(id, symbol);
          assert.ok(!/[a-f\d]{8}-[a-f\d-]{27}/i.test(path), `Unmapped generated path ${path}`);
          mutations.push({method: request.method(), path, query: url.search, body, status: response.status(),
            ...(!response.ok() ? {error: await response.text()} : {})});
        }
        await route.fulfill({response});
      });
      try {
        await page.goto(origin + '/__equivalence-ui');
        await page.evaluate(async () => {
          const device = await import('/src/compute-device.ts');
          device.resetPreference(); device.savePreference({enabled: false, mode: 'server', power: 'default'});
          window.applied = 0;
        });
        for (const kind of ['template', 'members']) {
          const beforePreview = await state();
          await page.evaluate(async kind => {
            await (await import('/src/rota-compute.ts')).openRotaCompute('2026-05', true, () => window.applied++,
              kind === 'template' ? {duty_keys: ['MAIN_1ST_24HR'], starts_on: '2026-05-01', ends_on: '2026-05-04', replace_existing: true} : undefined);
          }, kind);
          await page.locator('[data-generate]').click();
          await page.locator('[data-review-confirm]').waitFor();
          assert.equal(await page.locator('[data-apply]').isDisabled(), true);
          const preview = await state();
          // The state endpoint contains saved slots, assignments and fixture
          // identities only. Compute job/revision/timing metadata is intentionally
          // outside this equality; no saved rota field is filtered out.
          assert.deepEqual(preview, beforePreview,
            `${kind} preview preserves every saved rota field and existing slot ID`);
          assert.equal(preview.data.assignments.length, 0);
          if (kind === 'template') assert.equal(preview.data.slots.length, 0);
          assert.equal(mutations.filter(call => call.path.endsWith('/apply')).length, kind === 'template' ? 0 : 1);
          const proposalDownload = page.waitForEvent('download');
          await page.locator('[data-download]').focus();
          await page.keyboard.press('Enter');
          const proposalFile = await proposalDownload;
          assert.equal(proposalFile.suggestedFilename(), 'rota-compute-2026-05.json');
          await proposalFile.saveAs(join(runDir, `${kind}-proposal.json`));
          const exported = JSON.parse(await readFile(join(runDir, `${kind}-proposal.json`), 'utf8'));
          assert.ok(jobs.has(exported.id), 'Downloaded report identifies observed proposal');
          assert.equal(exported.status, 'completed');
          assert.equal(exported.month, '2026-05');
          if (kind === 'members') assertSeedEligibility(exported, preview);
          const proposal = Object.fromEntries(['month', 'kind', 'status', 'engine', 'requested_engine', 'revision',
            'processed', 'total', 'proposed', 'unresolved', 'burden'].map(key => [key, exported[key]]));
          proposal.decisions = exported.decisions.map(decision => {
            if (kind === 'template') return decision;
            const slot = preview.slotIds[decision.slot_id];
            assert.ok(slot, 'Every member decision resolves to a saved fixture slot');
            return {...decision, slot_id: slot};
          });
          await page.locator('[data-review-confirm]').check();
          await page.locator('[data-apply]').click();
          await page.locator('[data-revert]').waitFor({state: 'attached'});
          const saved = await state();
          assert.equal(saved.data.slots.length, 4);
          assertTemplateScope(saved.data);
          if (kind === 'template') templateSaved = saved;
          if (kind === 'members') {
            assert.deepEqual(saved.data.slots, beforePreview.data.slots, 'Member apply preserves complete template slot semantics');
            assert.deepEqual(saved.slotIds, beforePreview.slotIds, 'Member apply preserves template slot identities');
            const expectedAssignments = proposal.decisions.map(decision => ({slot: decision.slot_id,
              person: decision.person_name, status: 'assigned', source: 'reviewed_compute_draft', override_reason: null}));
            const canonical = rows => rows.map(row => JSON.stringify(row)).sort();
            assert.deepEqual(canonical(saved.data.assignments), canonical(expectedAssignments),
              'Saved assignments exactly implement the independently checked reviewed proposal');
          }
          stages.push({kind, proposal, preview: preview.data, saved: saved.data,
            preview_semantically_unchanged: true});
          if (kind === 'template') await page.locator('[data-close]').click();
        }
        assert.equal(await page.evaluate(() => window.applied), 2);
        // A second full-app page exports populated duties while the original
        // reviewed-job dialog stays open for its existing reversal workflow.
        const beforePopulatedExport = await state();
        const exportPage = await context.newPage();
        try {
          await exportPage.route('**/api/**', async route => {
            const request = route.request(), url = new URL(request.url());
            assert.equal(request.method(), 'GET', 'Populated export must not submit mutations');
            await route.fulfill({response: await route.fetch({url: api + url.pathname + url.search})});
          });
          await exportPage.goto(origin + '/');
          const routeControl = exportPage.locator('[data-view="rota-template"]').first();
          await routeControl.waitFor({state: 'attached'});
          if (width <= 768) { await exportPage.locator('#sidebar-toggle').focus(); await exportPage.keyboard.press('Enter'); }
          await routeControl.focus(); await exportPage.keyboard.press('Enter');
          const exportControl = exportPage.locator('#download-eagle-eye-export');
          await exportControl.waitFor({state: 'attached'});
          const menu = exportPage.locator('summary[aria-label="Export rota"]');
          if (await menu.count()) { await menu.focus(); await exportPage.keyboard.press('Enter'); }
          await exportControl.focus();
          const populatedDownload = exportPage.waitForEvent('download');
          await exportPage.keyboard.press('Enter');
          const populated = await populatedDownload;
          assert.equal(populated.suggestedFilename(), 'eagle-eye-rota-template-2026-05.xlsx');
          await populated.saveAs(join(runDir, 'eagle-eye-populated.xlsx'));
          await exportPage.waitForLoadState('networkidle');
          assert.deepEqual(await state(), beforePopulatedExport, 'Full-app populated export preserves exact saved state');
          await writeFile(join(runDir, 'populated-state.json'), JSON.stringify(beforePopulatedExport.data, null, 2)+'\n');
        } finally { await exportPage.close(); }
        // Exercise the real component's member reversal, then keep template for UI export.
        await page.locator('summary').filter({hasText: 'Reverse this generation'}).click();
        await page.locator('[data-reversal-confirm]').check();
        await page.locator('[data-revert]').click();
        await page.getByText(/Generation reversed after unchanged-draft validation/).waitFor();
        const reversed = await state();
        assert.equal(reversed.data.assignments.filter(item => item.status === 'assigned').length, 0);
        assert.deepEqual(reversed, templateSaved,
          'Member reversal exactly restores the saved template-only state, including all duty fields and identities');
        assert.equal(await page.evaluate(() => window.applied), 3);
        await page.locator('[data-close]').click();
        // Full application export control: a real pointer/keyboard action, no direct handler invocation.
        await page.goto(origin + '/');
        const routeButton = page.locator('[data-view="rota-template"]').first();
        await routeButton.waitFor({state: 'attached'});
        if (width <= 768) {
          await page.locator('#sidebar-toggle').focus();
          await page.keyboard.press('Enter');
        }
        await routeButton.focus();
        await page.keyboard.press('Enter');
        const exportButton = page.locator('#download-eagle-eye-export');
        await exportButton.waitFor({state: 'attached'});
        const exportMenu = page.locator('summary[aria-label="Export rota"]');
        if (await exportMenu.count()) { await exportMenu.focus(); await page.keyboard.press('Enter'); }
        await exportButton.focus();
        const downloaded = page.waitForEvent('download');
        await page.keyboard.press('Enter');
        const download = await downloaded;
        assert.equal(download.suggestedFilename(), 'eagle-eye-rota-template-2026-05.xlsx');
        await download.saveAs(join(runDir, 'eagle-eye.xlsx'));
        await page.waitForLoadState('networkidle');
        assert.deepEqual(errors, []);
        assert.equal(mutations.every(call => call.status >= 200 && call.status < 300), true, 'Real mutations succeeded');
        const report = {label, steps: ['template preview protected', 'template applied', 'member preview protected', 'members applied', 'populated eagle eye exported without writes', 'members reversed', 'eagle eye exported'],
          semantic_assertions: {template_preview_entire_state_unchanged: true,
            member_preview_entire_state_unchanged: true, requested_duty_scope_and_bounds: true,
            seeded_member_identity_posting_and_leave_eligibility: true,
            member_apply_preserves_template_fields_and_ids: true,
            saved_assignments_exactly_match_reviewed_proposal: true,
            member_reversal_exact_template_only_snapshot: true,
            populated_export_exact_state_unchanged: true}, errors, mutations};
        await writeFile(join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
        runs.push({label, initial: initial.data, stages, reversed: reversed.data, mutations, errors});
      } catch (error) {
        await page.screenshot({path: join(out, `failure-${engine}-${width}-${label}.png`)}).catch(() => {});
        console.error(JSON.stringify({engine, width, label, errors, mutations, text: (await page.locator('body').innerText()).slice(-5000)}));
        throw error;
      } finally { await context.close(); }
    }
    for (const key of ['initial', 'stages', 'reversed', 'mutations', 'errors']) assert.deepEqual(runs[1][key], runs[0][key], `${engine}/${width}: ${key}`);
    results.push({engine, width, passed: true, comparison: runs});
    console.log(`${engine}/${width}: real template/member apply, reversal and requests match`);
  }} finally { await browser.close(); }
}
assert.deepEqual(await hashes(resolve('.')), held, 'Current UI source held');
assert.deepEqual(await hashes(join(baseline, 'frontend')), baselineHeld, 'Baseline source held');
for (const [path, digest] of Object.entries(backendHeld)) assert.equal(sha(await readFile(path)), digest, `Backend held ${path}`);
await writeFile(join(out, 'report.json'), JSON.stringify({recorded_at_utc: new Date().toISOString(),
  scope: 'Real server-engine template and quick-member generation on identical SQLite RAM seeds. Saved duty/assignment semantics, exact requests except response-mapped job IDs, downloaded proposal decisions/scores/burden with saved slot IDs mapped to semantic keys; current backend held identical. JSON report timing/context hashes and generated IDs excluded from comparison explicitly. Single-connection fixture requests serialized; production concurrency outside scope. Actual UI workbook exported; workbook comparison is separate. Not every workflow, role, fixture or hardware GPU.',
  whole_requirement_completion_proven: false, baseline_manifest_verified: true,
  source_sha256: Object.fromEntries(Object.entries(held).map(([path, digest]) => ['frontend/' + path, digest])),
  backend_source_held: true, results}, null, 2) + '\n');
