import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';

const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const results = [];
async function sourceHashes() {
  const hashes = {};
  for (const name of ['workflow-import-history.ts', 'member-import-history.ts', 'ui.ts']) hashes[name] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
  return hashes;
}
const initialSources = await sourceHashes();
const memberBatch = { id: 'member-batch', filename: 'members.csv', sheet: 'Members', actor: 'Reviewer', status: 'completed', completed_at: '2026-10-21T08:00:00Z', counts: { created: 1 }, call_changes_confirmed: false };
for (const [engine, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch({ headless: true });
  try {
    for (const width of [320, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 850 }, acceptDownloads: true });
      const page = await context.newPage();
      const errors = [], writes = [], reads = [];
      let failInitial = false, failDetail = false, hold = false, release, maliciousId = '';
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/__history-focus', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="outside">Outside action</button><main id="host"></main></body></html>' }));
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url());
        if (request.method() !== 'GET') { writes.push(request.method() + ' ' + url.pathname); return route.abort(); }
        reads.push(url.pathname + url.search);
        if (hold) { hold = false; await new Promise(resolve => { release = resolve; }); }
        if (url.pathname.endsWith('/rejected.csv')) return route.fulfill({ contentType: 'text/csv', body: 'row,error\n3,invalid\n' });
        const member = url.pathname.startsWith('/api/v1/admin/members/import/history');
        const listing = member ? url.pathname.endsWith('/history') : /^\/api\/v1\/imports\/[^/]+\/history$/.test(url.pathname);
        if (listing && failInitial) { failInitial = false; return route.fulfill({ status: 503, json: { detail: 'History temporarily unavailable' } }); }
        if (!listing && failDetail) { failDetail = false; return route.fulfill({ status: 503, json: { detail: 'Recorded rows temporarily unavailable' } }); }
        if (member) return route.fulfill({ json: listing ? [{ ...memberBatch, id: maliciousId || memberBatch.id }] : { batch: memberBatch, rows: [{ row: 3, sheet: 'Members', action: 'created', raw: { name: 'Dr Independent' }, normalized: { name: 'Dr Independent' }, changes: {}, errors: [], member_id: 'member-one' }] } });
        const offset = Number(url.searchParams.get('offset') || 0);
        return route.fulfill({ json: listing ? { items: [{ id: `batch-${offset}`, filename: `batch-${offset}.csv`, month: '2026-10', status: 'completed', at: '2026-10-21T08:00:00Z', actor: 'Reviewer', counts: { created: 1 } }], offset, has_more: offset === 0 } : { filename: 'recorded.csv', offset, has_more: offset === 0, rows: [{ sheet: 'Data', row: offset + 3, raw: { name: 'Dr Independent' }, normalized: { name: 'Dr Independent' }, outcome: { created: true }, record_id: 'record-one' }] } });
      });
      await page.goto(`${base}/__history-focus`);
      const host = page.locator('#host'), outside = page.locator('#outside');
      async function keyboard(button) { await button.focus(); await page.keyboard.press('Enter'); }
      async function focused(button, message) { const selector = await button.evaluate(element => { if (element.dataset.history) return `[data-history="${element.dataset.history}"]`; if (element.dataset.memberBatch) return '[data-member-batch]'; return '#outside'; }); try { await page.waitForFunction(selector => { const element = document.querySelector(selector); return element && document.activeElement === element && !element.disabled; }, selector, { timeout: 5000 }); } catch (error) { throw new Error(`${engine}/${width}: ${message}; selector=${selector}; active=${await page.evaluate(() => document.activeElement?.outerHTML.slice(0,400))}`, { cause: error }); } assert.equal(await button.evaluate(element => document.activeElement === element), true, message); }
      async function settle() { await page.waitForFunction(() => ![...document.querySelectorAll('#host [role="status"]')].some(element => /Loading/.test(element.textContent || ''))); }
      async function heldClick(button, steal = false) {
        release = undefined; hold = true; await keyboard(button);
        await page.waitForFunction(() => [...document.querySelectorAll('#host [role="status"]')].some(element => /Loading/.test(element.textContent || '')));
        for (let i = 0; i < 50 && !release; i++) await new Promise(resolve => setTimeout(resolve, 10));
        assert.ok(release, 'Held GET reached fixture');
        if (steal === true) await outside.focus();
        else if (steal) await steal.focus();
        release(); await settle();
        if (steal === true) await focused(outside, 'Late result must preserve deliberate outside focus');
        else if (steal) { const label = await steal.getAttribute('aria-label'); await page.waitForFunction(label => document.activeElement?.getAttribute('aria-label') === label, label); }
      }
      for (const kind of ['leave', 'units', 'past', 'members']) {
        failInitial = true;
        await page.evaluate(async kind => { const module = await import('/src/workflow-import-history.ts'); await module.mountWorkflowImportHistory(document.querySelector('#host'), kind, '2026-10'); }, kind);
        await host.getByRole('alert').filter({ hasText: 'History temporarily unavailable' }).waitFor();
        await keyboard(host.getByRole('button', { name: 'Try again', exact: true }));
        await host.locator('[data-history="open"]').waitFor();
        await focused(host.locator('[data-history="open"]'), 'Successful initial retry restores a usable review control');
        const open = () => host.locator('[data-history="open"]');
        await heldClick(open()); await focused(open(), 'View rows retains focus after replacement');
        assert.equal(await host.getByRole('table').count(), 2);
        const nextRows = () => host.locator('[data-history="rows-next"]');
        await keyboard(nextRows()); await settle();
        assert.equal(await nextRows().isDisabled(), true);
        await focused(host.locator('[data-history="rows-previous"]'), 'Last row page focuses usable previous rows');
        await keyboard(host.locator('[data-history="rows-previous"]')); await settle();
        await focused(nextRows(), 'First row page focuses usable next rows');
        failDetail = true; await keyboard(open()); await settle();
        await host.getByRole('status').filter({ hasText: 'Recorded rows temporarily unavailable' }).waitFor();
        await focused(open(), 'Failed detail read retains retry action');
        await heldClick(open(), true);
        await heldClick(open(), host.getByRole('region', { name: 'Import batch history', exact: true }).or(host.locator('[aria-label="Import batch history"]')));
        failInitial = true;
        await keyboard(host.locator('[data-history="next"]')); await settle();
        await host.getByRole('status').filter({ hasText: 'History temporarily unavailable' }).waitFor();
        await focused(host.locator('[data-history="next"]'), 'Failed page read retains keyboard retry');
        assert.match(await host.locator('tbody tr').first().locator('td').first().textContent(), /^batch-0\.csv/);
        await keyboard(host.locator('[data-history="next"]')); await settle();
        assert.equal(await host.locator('[data-history="next"]').isDisabled(), true);
        await focused(host.locator('[data-history="previous"]'), 'Last batch page focuses usable previous batches');
        await keyboard(host.locator('[data-history="previous"]')); await settle();
        await focused(host.locator('[data-history="next"]'), 'First batch page focuses usable next batches');
        const downloadPromise = page.waitForEvent('download');
        await keyboard(host.locator('[data-history="download"]'));
        const download = await downloadPromise;
        assert.equal(download.suggestedFilename(), `rejected_${kind}_batch-0.csv`);
        assert.equal(await readFile(await download.path(), 'utf8'), 'row,error\n3,invalid\n');
        await settle(); await focused(host.locator('[data-history="download"]'), 'Download retains focus');
        release = undefined; hold = true; await keyboard(open());
        for (let i = 0; i < 50 && !release; i++) await new Promise(resolve => setTimeout(resolve, 10));
        assert.ok(release);
        await page.evaluate(async kind => { const module = await import('/src/workflow-import-history.ts'); await module.mountWorkflowImportHistory(document.querySelector('#host'), kind, '2026-10'); }, kind);
        await outside.focus(); const lateResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/history/batch-0'));
        release(); await lateResponse; await page.waitForLoadState('networkidle');
        await focused(outside, 'Superseded detail must not steal current focus');
        assert.equal(await host.getByRole('table').count(), 1, 'Superseded detail must not replace current mount');
        results.push({ engine, width, component: `workflow:${kind}`, initialReadRetry: true, keyboardRows: true, rowPagerFallback: true, batchPagerFallback: true, failedReadRetainsRetry: true, failedPageRetainsRowsAndRetry: true, outsideFocusPreserved: true, tableRegionFocusPreserved: true, supersededReadIgnored: true, downloadBytesAndName: true });
      }
      failInitial = true;
      await page.evaluate(async () => { const module = await import('/src/member-import-history.ts'); await module.mountMemberImportHistory(document.querySelector('#host')); });
      await host.getByRole('alert').filter({ hasText: 'History temporarily unavailable' }).waitFor();
      await keyboard(host.getByRole('button', { name: 'Try again', exact: true }));
      const memberOpen = host.locator('[data-member-batch]');
      await memberOpen.waitFor(); await focused(memberOpen, 'Member initial retry restores review action');
      await heldClick(memberOpen); await focused(memberOpen, 'Member detail retains focus');
      await host.getByText('Dr Independent', { exact: false }).first().waitFor();
      failDetail = true; await heldClick(memberOpen);
      await host.getByRole('status').filter({ hasText: 'Recorded rows temporarily unavailable' }).waitFor();
      await focused(memberOpen, 'Failed member detail retains retry');
      await heldClick(memberOpen, true);
      await heldClick(memberOpen, host.getByRole('region', { name: 'Member import batch history', exact: true }));
      release = undefined; hold = true; await keyboard(memberOpen);
      for (let i = 0; i < 50 && !release; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(release);
      await page.evaluate(async () => { const module = await import('/src/member-import-history.ts'); await module.mountMemberImportHistory(document.querySelector('#host')); });
      await outside.focus(); const memberLateResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/history/member-batch'));
      release(); await memberLateResponse; await page.waitForLoadState('networkidle');
      await focused(outside, 'Superseded member detail must not steal focus');
      assert.equal(await host.getByRole('table').count(), 1);
      maliciousId = 'batch-" onclick="window.__unsafeHistory=true"><img src=x onerror="window.__unsafeHistory=true">';
      await page.evaluate(async () => { const module = await import('/src/member-import-history.ts'); await module.mountMemberImportHistory(document.querySelector('#host')); });
      assert.equal(await host.locator('[data-member-batch]').getAttribute('data-member-batch'), maliciousId);
      assert.equal(await host.locator('[onclick], [onerror], img, script').count(), 0, 'Untrusted identifier remains one escaped attribute value');
      assert.equal(await page.evaluate(() => window.__unsafeHistory), undefined);
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      results.push({ engine, width, component: 'member', initialReadRetry: true, keyboardRows: true, failedReadRetainsRetry: true, outsideFocusPreserved: true, tableRegionFocusPreserved: true, supersededReadIgnored: true, untrustedIdentifierEscaped: true, reads: reads.length, writes: writes.length, pageErrors: errors.length });
      await context.close();
    }
  } finally { await browser.close(); }
}
const sources = await sourceHashes();
assert.deepEqual(sources, initialSources, 'Reviewed component sources must remain stable throughout this run');
await writeFile(new URL('../../docs/premium-ui/qa-history-focus-independent.json', import.meta.url), JSON.stringify({ createdAt: new Date().toISOString(), scope: 'Actual imported UI components and production CSS; Chromium/Firefox/WebKit emulation at 320/1280. GETs and downloads intercepted; no live backend writes, native assistive-technology or physical-device claim. Focus assertions use actual keyboard activation and held requests.', sources, results }, null, 2) + '\n');
console.log(`${results.length} independent import-history keyboard/focus cases passed`);
