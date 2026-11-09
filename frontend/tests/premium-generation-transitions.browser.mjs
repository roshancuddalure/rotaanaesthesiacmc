import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const paths = ['src/rota-compute.ts', 'src/rota-intelligence.ts', 'src/compute-device.ts', 'src/member-workspace.ts', 'src/workspace-load-state.ts', 'src/services/api.ts', 'src/styles.css', 'src/premium-theme.css', 'tests/premium-generation-transitions.browser.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const initial = await hashes(), results = [], month = '2026-11';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const bounded = async (promise, label) => { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), 10000); })]); } finally { clearTimeout(timer); } };
const decision = { slot_id: 'slot-one', date: '2026-11-02', duty: 'Main duty', unit: 'UNIT I', action: 'assign', person_id: 'person-one', person_name: 'Returned Result Member', reason: 'Eligible fixture choice', score: 1 };
const browser = await chromium.launch({ headless: true });
try { for (const width of [320, 1280]) for (const kind of ['members', 'template', 'intelligence']) for (const scenario of ['recover503-complete', 'returned-failure']) {
  const page = await browser.newPage({ viewport: { width, height: 850 } }), calls = [], errors = [], snapshots = [];
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  const steps = [1, 2, 3].map(() => ({ arrived: deferred(), release: deferred() })), readback = { arrived: deferred(), release: deferred() }, validation = { arrived: deferred(), release: deferred() };
  let stepCount = 0;
  const returnedResultText = kind === 'template' ? 'Eligible fixture choice' : 'Returned Result Member';
  const returnedDecision = kind === 'template' ? { ...decision, action: 'template', person_id: null, person_name: null, score: null, forced: false } : decision;
  const makeJob = (status, revision, processed = 0) => ({ id: 'transition-job', kind: kind === 'template' ? 'template' : 'members', month, status, revision, processed, total: status === 'queued' ? 0 : 7, proposed: status === 'completed' ? 1 : 0, unresolved: 0, decisions: status === 'completed' ? [returnedDecision] : [], engine: 'server', requested_engine: 'server', context_hash: 'transition-fixture', metrics: { planning_ms: 1, steps: revision }, burden: null, ...(status === 'failed' ? { error: 'Returned generation failure' } : {}), ...(kind === 'template' ? { template: { options: { duty_keys: ['MAIN_1ST_24HR'] }, summary: { created_slots: 1 } } } : {}), ...(kind === 'intelligence' ? { intelligence: { selected: 0, alternatives: status === 'completed' ? [{ status: 'feasible', uncovered: 0, changed: 0, elapsed_ms: 1, warnings: [], objectives: [], history_window: { start: '2026-05', end: '2026-10', observed_months: [] } }] : [] } } : {}) });
  await page.route('**/__generation_transitions', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open generation</button></body></html>' }));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, body = request.method() === 'POST' ? request.postDataJSON() : undefined;
    calls.push({ method: request.method(), path, search: url.search, body });
    if (path === '/api/v1/rota-compute/capabilities') return route.fulfill({ json: { enabled: true, browser_gpu: false, template_compute: true, template_gpu: false, optimizer_gpu: false, context_hash: 'transition-fixture' } });
    if (path === '/api/v1/rota-intelligence/setup') return route.fulfill({ json: { slots: [], people: [], history_lookback: 6, history_months: [], rules: {}, holiday_dates: [] } });
    if (path === '/api/v1/rota-compute/jobs') { assert.equal(request.method(), 'GET'); assert.equal(url.searchParams.get('month'), month); return route.fulfill({ json: [makeJob('queued', 1)] }); }
    if (path.endsWith('/step')) {
      const index = stepCount++; assert.ok(index < 3, 'No extra step may be replayed');
      assert.deepEqual(body, { revision: index + 1 });
      steps[index].arrived.resolve(); await steps[index].release.promise;
      if (index === 0) return route.fulfill({ json: makeJob('running', 2, 3) });
      if (scenario === 'returned-failure') return route.fulfill({ json: makeJob('failed', 3, 3) });
      if (index === 1) return route.fulfill({ status: 503, json: { detail: 'Step response unavailable; check saved revision' } });
      return route.fulfill({ json: makeJob('completed', 4, 7) });
    }
    if (path === '/api/v1/rota-compute/jobs/transition-job') {
      assert.equal(request.method(), 'GET'); assert.equal(scenario, 'recover503-complete');
      readback.arrived.resolve(); await readback.release.promise;
      return route.fulfill({ json: makeJob('running', 3, 4) });
    }
    if (path.endsWith('/validate')) {
      assert.deepEqual(body, { revision: 4 }); assert.equal(scenario, 'recover503-complete');
      validation.arrived.resolve(); await validation.release.promise;
      return route.fulfill({ json: { valid: true } });
    }
    throw Error(`Unexpected API ${request.method()} ${path}`);
  });
  try {
    await page.goto(base + '/__generation_transitions');
    await page.evaluate(kind => { document.querySelector('#open').onclick = async () => {
      if (kind === 'intelligence') await (await import('/src/rota-intelligence.ts')).openIntelligentRota('2026-11', true, () => { window.applied = (window.applied || 0) + 1; });
      else await (await import('/src/rota-compute.ts')).openRotaCompute('2026-11', true, () => { window.applied = (window.applied || 0) + 1; }, kind === 'template' ? { duty_keys: ['MAIN_1ST_24HR'] } : undefined);
    }; }, kind);
    await page.locator('#open').focus(); await page.keyboard.press('Enter');
    const dialog = page.locator('dialog.compute-workspace');
    await dialog.locator('[data-resume]').waitFor();
    const snapshot = async (phase, expectedState, processed) => {
      const text = await dialog.innerText();
      if (kind === 'intelligence') assert.match(await dialog.locator('.mw-header').innerText(), new RegExp(`\\b${expectedState}\\b`));
      else assert.equal(await dialog.locator('[data-job-state]').innerText(), { queued: 'Queued', running: 'Generating proposal', completed: 'Ready for review', failed: 'Failed' }[expectedState]);
      assert.doesNotMatch(text, /\b\d+(?:\.\d+)?\s*%/);
      const progress = dialog.locator('progress');
      if (kind === 'intelligence' || ['completed', 'failed'].includes(expectedState)) assert.equal(await progress.count(), 0);
      else if (expectedState === 'queued') { assert.equal(await progress.getAttribute('max'), null); assert.equal(await progress.getAttribute('value'), null); }
      else { assert.equal(await progress.getAttribute('max'), '7'); assert.equal(await progress.getAttribute('value'), String(processed)); }
      if (['queued', 'running', 'failed'].includes(expectedState)) { assert.doesNotMatch(text, /Ready for review|Draft ready for review/); assert.equal(await dialog.locator('[data-apply]').count(), 0); assert.ok(!text.includes(returnedResultText)); }
      snapshots.push({ phase, expectedState, progressMax: await progress.count() ? await progress.getAttribute('max') : null, progressValue: await progress.count() ? await progress.getAttribute('value') : null, visibleText: text });
    };
    await snapshot('returned-queued', 'queued');
    await dialog.locator('[data-resume]').focus(); await page.keyboard.press('Enter');
    await bounded(steps[0].arrived.promise, 'first queued step');
    await snapshot('queued-step-held', 'queued');
    steps[0].release.resolve(); await bounded(steps[1].arrived.promise, 'running step');
    await snapshot('returned-running-next-step-held', 'running', 3);
    steps[1].release.resolve();
    if (scenario === 'returned-failure') {
      if (kind === 'intelligence') await dialog.locator('.mw-header').filter({ hasText: 'failed' }).waitFor();
      else await dialog.locator('[data-job-state]').filter({ hasText: 'Failed' }).waitFor();
      await snapshot('returned-failed', 'failed');
      assert.equal(calls.filter(call => call.path.endsWith('/validate')).length, 0);
      assert.equal(stepCount, 2);
    } else {
      await bounded(readback.arrived.promise, '503 authoritative readback');
      await snapshot('503-readback-held-last-known-running', 'running', 3);
      readback.release.resolve(); await bounded(steps[2].arrived.promise, 'new revision step after readback');
      await snapshot('readback-running-new-revision-next-step-held', 'running', 4);
      steps[2].release.resolve(); await bounded(validation.arrived.promise, 'completed result validation');
      await snapshot('completed-result-present-validation-held', 'completed');
      if (kind !== 'intelligence') { assert.ok((await dialog.innerText()).includes(returnedResultText)); assert.equal(await dialog.locator('[data-apply]').isDisabled(), true); }
      else assert.doesNotMatch(await dialog.innerText(), /Draft ready for review/);
      validation.release.resolve(); await dialog.getByText(/Draft ready for review/).waitFor();
      await snapshot('validated-review-ready', 'completed');
      assert.ok((await dialog.innerText()).includes(returnedResultText));
      assert.equal(await dialog.locator('[data-apply]').isDisabled(), true);
      assert.equal(stepCount, 3);
      assert.equal(calls.filter(call => call.path === '/api/v1/rota-compute/jobs/transition-job').length, 1);
    }
    assert.equal(calls.filter(call => /\/(apply|revert|cancel)$/.test(call.path)).length, 0);
    assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/jobs')).length, 0, 'Resume does not create replacement jobs');
    assert.equal(await page.evaluate(() => window.applied || 0), 0); assert.deepEqual(errors, []);
    results.push({ width, kind, scenario, snapshots, calls, noApply: true, actualBackendWrites: 0, pageErrors: errors });
    console.log(`Generation transitions ${width} ${kind} ${scenario}: passed`);
  } catch (error) {
    await writeFile('../docs/premium-ui/qa-generation-transitions-failure.json', JSON.stringify({ source_sha256: initial, width, kind, scenario, error: String(error), snapshots, calls, pageErrors: errors, visibleText: await page.locator('body').innerText() }, null, 2) + '\n');
    throw error;
  } finally { steps.forEach(step => step.release.resolve()); readback.release.resolve(); validation.release.resolve(); await page.close(); }
} } finally { await browser.close(); }
assert.deepEqual(await hashes(), initial, 'Application/helpers/own test sources held');
await writeFile('../docs/premium-ui/qa-generation-transitions.json', JSON.stringify({ recorded_at_utc: new Date().toISOString(), source_sha256: initial, scope: 'Actual quick/template shared compute and whole-month intelligence modules, Chromium320/1280. Native Resume from authoritative queued jobs; held queued/running/503-readback/newrevision/returnedcompleted/validate and returnedfailed branches. Quick completion label appears only after completed result exists; intelligence explicit review notice follows validation. No inventedpercentages, exact existing revision bodies, no jobcreation/Apply. All API requests fulfilled locally; no real scheduling/GPU/persistence/physical/nativeAT claim.', results }, null, 2) + '\n');
console.log(`Generation transitions: ${results.length} workflows passed`);
