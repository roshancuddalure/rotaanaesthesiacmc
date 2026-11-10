// Component contract harness only. The launcher is harness UI, not an application route.
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';
const sha = value => createHash('sha256').update(value).digest('hex');
const base = 'http://127.0.0.1:5197';
const candidate = await readFile('../tmp/catalog-consumer-v14r2/reference-workspace.ts');
assert.equal(sha(candidate), '91133b6913c3e7c5a493bbf19436ca06ba5ad9d1813a13974c70d0d6473a434a');
const sourcePaths = ['reference-workspace', 'workspace-load-state', 'member-workspace', 'record-workspace'];
const candidateRecord = await readFile('../tmp/catalog-consumer-v14r2/record-workspace.ts');
assert.equal(sha(candidateRecord), '75589574417ed6f6287e625392417d3776411a8e7ef413a940e33915e57a6c33');
const before = Object.fromEntries(await Promise.all(sourcePaths.map(async name => [name, sha(await readFile('src/' + name + '.ts'))])));
const heldAudit = JSON.parse(await readFile('../tmp/catalog-consumer-v14r2/applied-source-guards.json', 'utf8'));
for (const [path, expected] of Object.entries(heldAudit.source_sha256)) assert.equal(sha(await readFile('../' + path)), expected, 'Frozen applied V13r2 source ' + path);
for (const name of sourcePaths) {
  const response = await fetch(base + '/src/' + name + '.ts'); assert.equal(response.status, 200);
  const map = (await response.text()).match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/); assert.ok(map);
  assert.ok(JSON.parse(Buffer.from(map[1], 'base64').toString()).sourcesContent.some(source => sha(source) === (name === 'reference-workspace' ? sha(candidate) : name === 'record-workspace' ? sha(candidateRecord) : before[name])));
}
const report = '../docs/premium-ui/qa-original159-catalog-v14r2-callback-contract-integrated-20261110.json';
await assert.rejects(access(report), { code: 'ENOENT' });
const results = [];
for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await launcher.launch();
  try { for (const width of [320, 1280]) for (const scenario of ['success-throws-once', 'failed-read-close-throws-once', 'permanent-throw-escape']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(12000);
    const errors = [], requests = [], writes = [];
    let saved = false, savedReads = 0;
    const item = () => ({ key: 'CONTRACT_VALUE', label: saved ? 'Contract Changed Label' : 'Contract Original Label', active: true, aliases: [], version: saved ? 2 : 1, behavior: {}, usage: { records: 0 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/__catalog_v14_contract', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="contract-launcher">Open catalog component contract</button></body></html>' }));
    await page.route('**/api/**', async route => {
      const q = route.request(), path = new URL(q.url()).pathname; requests.push({ method: q.method(), path });
      if (q.method() === 'GET' && path === '/api/v1/normalization/catalog/campus') {
        if (saved) {
          savedReads++;
          if (scenario === 'failed-read-close-throws-once' && savedReads === 1) return route.fulfill({ status: 503, json: { detail: 'Contract own read fails once' } });
        }
        return route.fulfill({ json: [item()] });
      }
      if (q.method() !== 'GET') {
        writes.push({ method: q.method(), path, body: q.postDataJSON() });
        if (q.method() === 'PUT' && path === '/api/v1/normalization/catalog/campus/CONTRACT_VALUE' && !saved) {
          assert.equal(writes[0].body.label, 'Contract Changed Label'); assert.equal(writes[0].body.version, 1);
          saved = true; return route.fulfill({ json: { saved: true } });
        }
      }
      return route.fulfill({ status: 500, json: { detail: 'Contract forbids every other API request or mutation' } });
    });
    let observed;
    try {
      await page.goto(base + '/__catalog_v14_contract');
      await page.evaluate(async scenario => {
        const module = await import('/src/reference-workspace.ts');
        window.__contractCalls = 0; window.__contractCompleted = 0;
        document.querySelector('#contract-launcher').onclick = () => module.openReferenceCatalog(() => {
          window.__contractCalls++;
          if (window.__contractCalls === 1 || scenario === 'permanent-throw-escape') throw new Error('Injected synchronous consumer callback failure');
          window.__contractCompleted++;
        }, 'campus');
      }, scenario);
      await page.locator('#contract-launcher').focus(); await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Reference labels and mappings', exact: true });
      await dialog.locator('button[data-key="CONTRACT_VALUE"]').click();
      await dialog.locator('input[name="label"]').fill('Contract Changed Label');
      await dialog.getByRole('button', { name: 'Save reference', exact: true }).click();
      await dialog.getByRole('heading', { name: 'Change saved; refresh unavailable', exact: true }).waitFor();
      if (scenario === 'failed-read-close-throws-once') {
        assert.equal(await page.evaluate(() => window.__contractCalls), 0);
        const close = dialog.getByRole('button', { name: 'Close', exact: true });
        await close.focus(); await page.keyboard.press('Enter');
      }
      await dialog.getByRole('alert').filter({ hasText: 'Injected synchronous consumer callback failure' }).waitFor();
      assert.equal(await dialog.isVisible(), true); assert.equal(writes.length, 1);
      assert.equal(await page.evaluate(() => window.__contractCalls), 1);
      const retry = dialog.getByRole('button', { name: 'Try again', exact: true });
      await retry.focus(); await page.keyboard.press('Enter');
      if (scenario === 'permanent-throw-escape') {
        await dialog.getByRole('alert').filter({ hasText: 'Injected synchronous consumer callback failure' }).waitFor();
        assert.equal(await page.evaluate(() => window.__contractCalls), 2);
        assert.equal(savedReads, 2); assert.equal(writes.length, 1);
        assert.match(await dialog.getByRole('alert').innerText(), /reference change remains saved.*surrounding view could not refresh.*Close leaves this window without refreshing that view/s);
        observed = { beforeEscape: await page.evaluate(() => ({ calls: window.__contractCalls, completed: window.__contractCompleted })), dialogOpen: await dialog.isVisible() };
        await dialog.getByRole('button', { name: 'Close', exact: true }).focus(); await page.keyboard.press('Enter');
        await dialog.waitFor({ state: 'detached', timeout: 3000 });
        assert.deepEqual(await page.evaluate(() => ({ calls: window.__contractCalls, completed: window.__contractCompleted })), { calls: 2, completed: 0 }, 'Explicit escape must not redeliver permanently failing callback');
        assert.equal(writes.length, 1); assert.deepEqual(errors, []);
        results.push({ engine, width, scenario, passed: true, observed, savedReads, writes, requests, errors });
        continue;
      }
      await dialog.locator('button[data-key="CONTRACT_VALUE"]').filter({ hasText: 'Contract Changed Label' }).waitFor();
      assert.deepEqual(await page.evaluate(() => ({ calls: window.__contractCalls, completed: window.__contractCompleted })), { calls: 2, completed: 1 });
      assert.equal(writes.length, 1); assert.equal(savedReads, 2);
      assert.equal(await dialog.getByRole('alert').filter({ hasText: 'surrounding view could not refresh' }).count(), 0, 'Recovered notification removes prior callback warning');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      observed = await page.evaluate(() => ({ calls: window.__contractCalls, completed: window.__contractCompleted, launcherFocused: document.activeElement === document.querySelector('#contract-launcher') }));
      assert.deepEqual(observed, { calls: 2, completed: 1, launcherFocused: true }); assert.deepEqual(errors, []);
      results.push({ engine, width, scenario, passed: true, observed, savedReads, writes, requests, errors });
    } catch (error) { results.push({ engine, width, scenario, passed: false, assertion: error.message, observed, savedReads, writes, requests, errors }); }
    finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close(); }
  } } finally { await browser.close(); }
}
for (const name of sourcePaths) assert.equal(sha(await readFile('src/' + name + '.ts')), before[name], 'Applied source held ' + name);
for (const [path, expected] of Object.entries(heldAudit.source_sha256)) assert.equal(sha(await readFile('../' + path)), expected, 'Frozen applied source held after contract ' + path);
await writeFile(report, JSON.stringify({ recorded_at_utc: new Date().toISOString(), author: '/root/catalog159_consumer_groundwork', scope: 'Eighteen isolated component-contract contexts, real openReferenceCatalog with deliberately throwing synchronous caller. Harness launcher is not actual product UI. Three engines320/1280; successful-save callback throw or failed-own-read/Close callback throw, explicit keyboard GET retry, exactly one completed delivery, no PUT replay, close focus; permanent callback throw must still allow explicit escape. Expected-correct escape assertion may expose an isolated-candidate defect; inspect before any integration.', candidate_sha256: sha(candidate), source_sha256: before, test_sha256: sha(await readFile(new URL(import.meta.url))), results }, null, 2) + '\n');
assert.equal(results.length, 18); assert.equal(results.filter(result => !result.passed).length, 0);
