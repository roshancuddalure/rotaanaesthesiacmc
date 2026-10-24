import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium, firefox, webkit} from 'playwright';

// Standalone progress viewer only: no rota app, API or production connection.
const html = await readFile('../docs/premium-ui/progress-window.html', 'utf8');
const recorded = Date.parse('2026-10-24T10:00:00Z');
const fixture = {
  read_at: new Date(recorded).toISOString(), ledger_recorded_at: new Date(recorded).toISOString(),
  counts: {partial: 1, pending: 1, dependency: 1}, total: 3, certified: 0,
  live: {updated_at: new Date(recorded).toISOString(), tasks: [{status: 'Next', title: 'Recorded task', detail: 'Acceptance remains open.'}]},
  items: [{id: 1, requirement: 'Fixture requirement', status: 'partial', reviews: {}, evidence: [], followups: 0, limitations: []}],
  batches: [], unit_tests: {passed: 100}, build: {passed: true}, physical: 'Pending', snapshot_note: 'Fixture snapshot',
};
let passed = 0;
for (const [engine, launcher] of Object.entries({chromium, firefox, webkit})) {
  const browser = await launcher.launch();
  try {
    for (const width of [320, 1280]) {
      const context = await browser.newContext({viewport: {width, height: 800}});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(now => {
        window.__progressNow = now;
        Date.now = () => window.__progressNow;
      }, recorded + 119999);
      let fail = false, requests = 0;
      await page.route('http://progress.test/**', async route => {
        assert.equal(route.request().method(), 'GET');
        if (new URL(route.request().url()).pathname === '/progress.json') {
          requests++;
          return fail ? route.fulfill({status: 503, body: 'Evidence updating'}) : route.fulfill({json: fixture});
        }
        return route.fulfill({contentType: 'text/html', body: html});
      });
      await page.goto('http://progress.test/');
      await page.waitForFunction(() => document.querySelector('#connection').textContent === 'Local evidence connected' && !document.querySelector('#refresh').disabled);
      assert.match(await page.locator('#heartbeat').innerText(), /^Work note updated /);
      await page.evaluate(() => { window.__rowBeforeRefresh = document.querySelector('#rows tr'); });
      const refresh = async () => {
        const response = page.waitForResponse('http://progress.test/progress.json');
        await page.locator('#refresh').click();
        await response;
        await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
      };
      // Identical JSON must not need a rerender to age at the 120-second boundary.
      await page.evaluate(now => { window.__progressNow = now; }, recorded + 120000);
      await refresh();
      assert.match(await page.locator('#heartbeat').innerText(), /^Last work note: .*not a live process check$/);
      assert.equal(await page.evaluate(() => window.__rowBeforeRefresh === document.querySelector('#rows tr')), true);
      fail = true;
      await refresh();
      assert.equal(await page.locator('#connection').innerText(), 'Connection interrupted');
      assert.match(await page.locator('#error').innerText(), /last loaded data remains visible.*503/);
      assert.equal(await page.locator('#partial').innerText(), '1');
      assert.equal(await page.locator('#rows tr').count(), 1);
      assert.match(await page.locator('#live').innerText(), /Recorded task/);
      fail = false;
      await page.evaluate(now => { window.__progressNow = now; }, recorded + 180000);
      await refresh();
      assert.equal(await page.locator('#connection').innerText(), 'Local evidence connected');
      assert.equal(await page.locator('#error').isHidden(), true);
      assert.match(await page.locator('#heartbeat').innerText(), /^Last work note: .*not a live process check$/);
      assert.equal(await page.evaluate(() => window.__rowBeforeRefresh === document.querySelector('#rows tr')), true);
      assert.ok(requests >= 4);
      assert.deepEqual(errors, []);
      console.log(`PASS ${engine} ${width}: unchanged evidence ages; 503 retains data; identical recovery updates status`);
      passed++;
      await context.close();
    }
  } finally { await browser.close(); }
}
assert.equal(passed, 6);
