import assert from 'node:assert/strict';
import {readFile, writeFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const sha = value => createHash('sha256').update(value).digest('hex');
const base = 'http://127.0.0.1:5197';
const folder = '../tmp/registry-parent-refresh-v10r4';
const report = '../docs/premium-ui/qa-original159-registry-v10r4-integrated-focus-supplement.json';
await assert.rejects(access(report), {code: 'ENOENT'});
const manifest = JSON.parse(await readFile(folder + '/manifest.json', 'utf8'));
const held = {};
for (const [name, binding] of Object.entries(manifest.files)) {
  held[name] = sha(await readFile('src/' + name));
  assert.equal(held[name], binding.candidate_sha256);
  assert.equal(sha(await readFile(folder + '/' + name)), binding.candidate_sha256);
  const served = await (await fetch(base + '/src/' + name)).text();
  const map = served.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
  assert.ok(map, 'Actual preview exposes its exact source map');
  assert.ok(JSON.parse(Buffer.from(map[1], 'base64').toString()).sourcesContent.some(source => sha(source) === binding.candidate_sha256));
}
const original = {id:'registry-parent',name:'Royal Registry Parent',campus:'Main',code:'PARENT',minimum_free_people:1,active_status:'active',aliases:[],notes:'',call_minimums:[],revision:'one',usage:{postings:0,duties:0,future_postings:0,future_duties:0,selected_members:0}};
const results = [];
const browser = await chromium.launch();
try {
  for (const width of [320, 1280]) for (const mode of ['removed-board-action', 'surviving-search']) {
    const page = await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    page.setDefaultTimeout(10000);
    const requests = [], writes = [], errors = [], events = [];
    let boardReads = 0, fallbackReads = 0, boardReturned = false, gateArrived = false, failedOnce = false;
    let releaseGate;
    const fallbackGate = new Promise(resolve => { releaseGate = resolve; });
    let units = [original, {...original,id:'registry-b',name:'Royal Fallback B',code:'B'}, {...original,id:'registry-c',name:'Royal Fallback C',code:'C'}];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.addInitScript(() => {
      localStorage.setItem('duty_rota_auth_token', 'registry-local');
      localStorage.setItem('duty_rota_working_month', '2026-11');
    });
    const board = month => ({month,starts_on:'2026-11-01',ends_on:'2026-11-30',units,assignments:[],unit_summaries:units.map(unit => ({unit_id:unit.id,assigned_members:0,people_with_leave:0,leave_days:0,leave_by_call_level:{}})),unit_call_minimums:[],validation_issues:[]});
    const fallbackRows = () => units.map(unit => ({unit_id:unit.id,unit_name:unit.name,fallbacks:unit.id === 'registry-parent' ? ['registry-b','registry-c'].map(id => ({unit_id:id,unit_name:units.find(item => item.id === id).name})) : []}));
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      requests.push({method:request.method(),path,search:url.search});
      if (request.method() !== 'GET') {
        assert.equal(request.method(), 'PUT');
        assert.equal(path, '/api/v1/normalization/units/registry-b');
        const payload = request.postDataJSON();
        writes.push({method:request.method(),path,payload});
        const saved = {...units.find(unit => unit.id === 'registry-b'), ...payload, revision:'two'};
        units = units.map(unit => unit.id === saved.id ? saved : unit);
        return route.fulfill({json:saved});
      }
      if (path === '/api/v1/admin/members') return route.fulfill({json:[]});
      if (path === '/api/v1/normalization/units') return route.fulfill({json:units});
      if (path === '/api/v1/unit-management/month') {
        boardReads++;
        await route.fulfill({json:board(url.searchParams.get('month'))});
        if (writes.length) { boardReturned = true; events.push('post-close-board-returned'); }
        return;
      }
      if (path === '/api/v1/extra-duty/unit-fallbacks') {
        fallbackReads++;
        if (writes.length && !failedOnce) {
          failedOnce = true; gateArrived = true; events.push('post-close-fallback-gated');
          await fallbackGate;
          events.push('post-close-fallback-released-503');
          return route.fulfill({status:503,json:{detail:'Gated fallback reference read unavailable'}});
        }
        return route.fulfill({json:fallbackRows()});
      }
      return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:8031' + path + url.search,maxRetries:2})});
    });
    try {
      await page.goto(base + '/#view=units', {waitUntil:'domcontentloaded'});
      const host = page.locator('#unit-fallbacks-host');
      const row = host.locator('[data-fallback-unit="registry-parent"]');
      await row.locator('summary').click();
      await row.locator('[data-fb-up="registry-c"]').click();
      await host.evaluate(element => {
        window.__registryFocusHost = element;
        window.__registryFocusRow = element.querySelector('[data-fallback-unit="registry-parent"]');
      });
      await page.locator('input[data-unit-board-search]').fill('Royal');
      await page.locator('select[data-unit-board-campus]').selectOption('campus:Main');
      const before = {boardReads,fallbackReads};
      await page.locator('[aria-label="Unit actions"] details.row-menu > summary').click();
      await page.locator('[data-manage-department-units]').click();
      const dialog = page.getByRole('dialog', {name:'Manage department units',exact:true});
      await dialog.locator('[data-select-unit="registry-b"]').click();
      await dialog.locator('[name=name]').fill('Royal Renamed registry-b');
      await dialog.getByRole('button', {name:'Save unit',exact:true}).click();
      await dialog.locator('[data-select-unit="registry-b"]').filter({hasText:'Royal Renamed registry-b'}).waitFor();
      assert.equal(boardReads, before.boardReads);
      assert.equal(fallbackReads, before.fallbackReads);
      await dialog.getByRole('button', {name:'Close unit management',exact:true}).click();
      await dialog.waitFor({state:'detached'});
      await assert.doesNotReject(async () => {
        const deadline = Date.now() + 10000;
        while (!(gateArrived && boardReturned)) {
          assert.ok(Date.now() < deadline, 'Both actual post-close request events arrived');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      });
      events.push('both-parent-read-events-observed');
      const focusSelector = mode === 'removed-board-action'
        ? '[data-unit-board-card="unit:registry-b"] button[data-open-unit-modal="registry-b"]'
        : 'input[data-unit-board-search]';
      assert.equal(await page.locator(focusSelector).isVisible(), true);
      await page.locator(focusSelector).evaluate((element, focusMode) => {
        window.__registryFocusTarget = element;
        if (focusMode === 'surviving-search') {
          element.value = 'Royal';
          element.dispatchEvent(new Event('input', {bubbles:true}));
          element.setSelectionRange(1, 4);
        }
        element.focus({preventScroll:true});
      }, mode);
      assert.equal(await page.evaluate(() => document.activeElement === window.__registryFocusTarget), true);
      events.push('actual-parent-target-focused');
      releaseGate();
      const panel = page.locator('[data-profile-parent-refresh]');
      const retry = panel.locator('[data-retry-profile-parent]');
      await retry.waitFor({state:'visible'});
      await page.waitForFunction(() => !document.querySelector('[data-retry-profile-parent]')?.disabled);
      assert.match(await panel.innerText(), /could not refresh/);
      await page.locator('[data-unit-board-card="unit:registry-b"]').filter({hasText:'Royal Renamed registry-b'}).waitFor();
      const observed = await page.evaluate(() => {
        const host = document.querySelector('#unit-fallbacks-host');
        const row = host?.querySelector('[data-fallback-unit="registry-parent"]');
        const target = window.__registryFocusTarget;
        return {
          targetConnected:target.isConnected,
          activeIsTarget:document.activeElement === target,
          activeIsMessage:document.activeElement === document.querySelector('[data-profile-parent-refresh] [role=status]'),
          activeIsBody:document.activeElement === document.body,
          value:target instanceof HTMLInputElement ? target.value : null,
          selection:target instanceof HTMLInputElement ? [target.selectionStart,target.selectionEnd] : null,
          hostRetained:host === window.__registryFocusHost,
          rowRetained:row === window.__registryFocusRow,
          order:[...row.querySelectorAll('[data-fallback-item]')].map(element => element.dataset.fallbackItem),
          saveEnabled:!row.querySelector('[data-fb-save]').disabled,
        };
      });
      assert.equal(observed.activeIsBody, false);
      if (mode === 'removed-board-action') {
        assert.equal(observed.targetConnected, false);
        assert.equal(observed.activeIsMessage, true);
      } else {
        assert.equal(observed.targetConnected, true);
        assert.equal(observed.activeIsTarget, true);
        assert.equal(observed.value, 'Royal');
        assert.deepEqual(observed.selection, [1,4]);
      }
      assert.equal(observed.hostRetained, true);
      assert.equal(observed.rowRetained, true);
      assert.deepEqual(observed.order, ['registry-c','registry-b']);
      assert.equal(observed.saveEnabled, true);
      assert.equal(writes.length, 1);
      await retry.click();
      await page.waitForFunction(() => document.querySelector('[data-profile-parent-refresh]')?.textContent.includes('Saved changes are reflected'));
      assert.equal(writes.length, 1);
      assert.equal(boardReads - before.boardReads, 2);
      assert.equal(fallbackReads - before.fallbackReads, 2);
      assert.deepEqual(errors, []);
      results.push({engine:'chromium',width,mode,passed:true,before,after:{boardReads,fallbackReads},observed,events,writes,requests,errors});
      console.log('chromium',width,mode,'PASS');
    } catch (error) {
      results.push({engine:'chromium',width,mode,passed:false,assertion:error.message,events,writes,requests,errors,boardReads,fallbackReads});
      console.log('chromium',width,mode,'FAIL',error.message);
    } finally {
      releaseGate();
      await page.unrouteAll({behavior:'ignoreErrors'});
      await page.close();
    }
  }
} finally { await browser.close(); }
for (const [name, binding] of Object.entries(manifest.files)) {
  assert.equal(sha(await readFile('src/' + name)), held[name]);
  assert.equal(sha(await readFile(folder + '/' + name)), binding.candidate_sha256);
}
await writeFile(report, JSON.stringify({recorded_at_utc:new Date().toISOString(),operator:'/root',application_changed_by_test:false,execution_target:"applied source",scope:'Four applied exact-source Chromium contexts: initial-close optional fallback GET failure after successful primary read while newer parent focus is either replaced or survives; subsequent GET-only retry. No physical-device, native AT, cross-engine focus, applied acceptance or production proof.',candidate_manifest:manifest,held_source_sha256:held,test_sha256:sha(await readFile(new URL(import.meta.url))),results},null,2) + '\n');
assert.equal(results.length, 4);
assert.ok(results.every(result => result.passed), 'All failures preserved in the unique report');
