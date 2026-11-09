import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';

const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const paths = ['src/member-import.ts', 'src/ui.ts', 'src/services/api.ts', 'tests/premium-workbook-choice-lifetime.browser.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const initial = await hashes(), results = [];
for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
const browser = await launcher.launch({ headless: true });
try { for (const width of [320, 1280]) for (const scenario of ['old-success-current-ready', 'old-refusal-current-pending']) {
  const requests = [], errors = [];
  const page = await browser.newPage({ viewport: { width, height: 850 } });
  page.on('pageerror', error => errors.push(error.message));
  let release, arrived, delivered, releaseCurrent, currentArrived, applies = 0;
  const held = new Promise(resolve => { arrived = resolve; });
  const sent = new Promise(resolve => { delivered = resolve; });
  const currentHeld = new Promise(resolve => { currentArrived = resolve; });
  const row = (id, name) => ({ row: 2, raw: { name: 'Source spelling' }, normalized: { name: 'Source spelling' }, target_id: id, target_name: name, action: id ? 'update' : 'needs_review', changes: {}, errors: [], resolution_status: id ? 'matched' : 'ambiguous', candidates: [{ id: 'old-a', name: 'Old same name' }, { id: 'old-b', name: 'Old same name' }] });
  const preview = item => ({ preview_hash: 'fixture-' + (item.target_id || 'unresolved'), counts: { update: item.target_id ? 1 : 0, needs_review: item.target_id ? 0 : 1 }, rows: [item] });
  await page.route('**/__workbook_lifetime', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host"></main></body></html>' }));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const form = await new Request('http://fixture.invalid', { method: 'POST', headers: { 'content-type': request.headers()['content-type'] }, body: request.postDataBuffer() }).formData();
    const options = JSON.parse(form.get('options')), filename = form.get('file').name;
    requests.push({ path, filename, options });
    if (path.endsWith('/inspect')) return route.fulfill({ json: { header_row: 1, fields: ['name'], sheets: [{ name: 'Members', headers: ['Name'], mapping: { name: 0 } }] } });
    if (path.endsWith('/apply')) { applies++; return route.fulfill({ status: 599, json: { detail: 'Apply forbidden' } }); }
    assert.match(path, /\/preview$/);
    if (filename === 'old.csv' && options.resolutions['2'] === 'old-b') {
      assert.deepEqual(options.resolutions, { '2': 'old-b' });
      await new Promise(resolve => { release = resolve; arrived(); });
      await route.fulfill(scenario === 'old-refusal-current-pending' ? { status: 503, json: { detail: 'Old account choice refused' } } : { json: preview(row('old-b', 'Old same name')) });
      delivered(); return;
    }
    if (filename === 'current.csv') {
      assert.deepEqual(options.resolutions, {}, 'New account file must not inherit old member decisions');
      if (scenario === 'old-refusal-current-pending') await new Promise(resolve => { releaseCurrent = resolve; currentArrived(); });
    }
    return route.fulfill({ json: filename === 'current.csv' ? preview(row('current-c', 'Current account member')) : preview(row(null, null)) });
  });
  await page.goto(base + '/__workbook_lifetime');
  const mount = () => page.evaluate(async () => { const m = await import('/src/member-import.ts'); m.resetMemberImport(); document.querySelector('#host').replaceWith(Object.assign(document.createElement('main'), { id: 'host' })); m.mountMemberImport(document.querySelector('#host'), async () => {}); });
  const native = async selector => { await page.locator(selector).focus(); await page.keyboard.press('Enter'); };
  const upload = async filename => {
    await page.locator('[data-mi="file"]').setInputFiles({ name: filename, mimeType: 'text/csv', buffer: Buffer.from('Name\nSource spelling\n') });
    await native('[data-mi="inspect"]'); await page.locator('[data-mi="preview"]').waitFor();
    await native('[data-mi="preview"]');
  };
  await mount(); await upload('old.csv'); await page.locator('[data-pick-member="old-b"]').waitFor();
  await native('[data-pick-member="old-b"]'); await held;
  await mount(); await upload('current.csv');
  if (scenario === 'old-refusal-current-pending') await currentHeld;
  else await page.locator('.member-match__identity').filter({ hasText: 'Member ID: current-c' }).waitFor();
  const before = await page.locator('#host').innerText();
  release(); await sent;
  // Wait for fetch parsing and its catch/finally before exercising the current mount.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  let pendingState;
  if (scenario === 'old-refusal-current-pending') {
    pendingState = {
      fileDisabled: await page.locator('[data-mi="file"]').isDisabled(),
      working: /Working/.test(await page.locator('#host [role=status]').innerText()),
      staleMessage: (await page.locator('#host').innerText()).includes('Old account choice refused'),
      oldIdentity: (await page.locator('#host').innerText()).includes('Member ID: old-b'),
      applyCount: await page.locator('[data-mi="apply"]').count(),
    };
    releaseCurrent();
    await page.locator('.member-match__identity').filter({ hasText: 'Member ID: current-c' }).waitFor();
  }
  // Native filter rendering exercises the state subsequently read by the current mount.
  await page.locator('[data-mi="filter"]').selectOption('update');
  const after = await page.locator('#host').innerText();
  const selectedIdentity = await page.locator('.member-match__identity').innerText();
  results.push({ engine, width, scenario, delayedOldChoiceCannotOverwrite: selectedIdentity.includes('Member ID: current-c') && !selectedIdentity.includes('Member ID: old-b'), oldRequestWasHeld: true, currentFile: 'current.csv', pendingState, selectedIdentity, before, after, requests, applies, errors });
  console.log(`Workbook lifetime ${engine} ${width} ${scenario}`);
  await page.close();
} } finally { await browser.close(); }
}
assert.deepEqual(await hashes(), initial, 'Application and own test sources held');
await writeFile('../docs/premium-ui/qa-workbook-choice-lifetime.json', JSON.stringify({ recorded_at_utc: new Date().toISOString(), source_sha256: initial, scope: 'Actual workbook component with native upload/inspect/preview/pick/filter; existing resetMemberImport and mount used for account reset/remount. Three engines at320/1280: delayed old candidate success after current ready, and old503 while current pending. All API responses fulfilled locally; no actual backend writes or persistence claim.', results }, null, 2) + '\n');
for (const result of results) {
  assert.equal(result.delayedOldChoiceCannotOverwrite, true, 'Old candidate response must not replace current account preview on its next native render');
  if (result.pendingState) assert.deepEqual(result.pendingState, { fileDisabled: true, working: true, staleMessage: false, oldIdentity: false, applyCount: 0 });
  assert.equal(result.applies, 0); assert.deepEqual(result.errors, []);
}
console.log(`Workbook delayed choice preserves current reset/remount: ${results.length} workflows`);
