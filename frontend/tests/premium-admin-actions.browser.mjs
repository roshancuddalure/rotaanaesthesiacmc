// Outcome contracts for shared administrative controls. All API calls are intercepted;
// no mutation is forwarded to an application server or database.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const browser = await chromium.launch({ headless: true, ...(process.env.MEMBER_TEST_BROWSER ? { executablePath: process.env.MEMBER_TEST_BROWSER } : {}) });
const results = [];
async function harness(width) {
  const page = await browser.newPage({ viewport: { width, height: 850 } });
  const errors = [], unexpected = [], calls = [];
  page.on('pageerror', error => errors.push(error.message));
  const handlers = [];
  await page.route('**/__premium-admin-contracts', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Admin action contracts</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="root"></main></body></html>' }));
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const call = { path: new URL(request.url()).pathname, method: request.method(), body: request.postData() ? request.postDataJSON() : null };
    calls.push(call);
    for (const handler of handlers) { const response = await handler(call); if (response) return route.fulfill(response); }
    unexpected.push(call);
    return route.fulfill({ status: 501, json: { detail: 'Unmocked administrative request' } });
  });
  await page.goto(base + '/__premium-admin-contracts');
  return { page, handlers, calls, async finish(label) {
    assert.deepEqual(errors, [], label + ': no page exceptions');
    assert.deepEqual(unexpected, [], label + ': no unmocked requests');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ': no page overflow');
    results.push({ label, width, passed: true }); await page.close();
  } };
}
try {
  for (const width of [1280, 390]) {
    {
      const h = await harness(width), { page } = h;
      await page.evaluate(async () => {
        const { reviewAndApply } = await import('/src/admin-preview.ts');
        window.__previews = 0; window.__applyTokens = []; window.__applied = 0;
        await reviewAndApply({ title: 'Retry reviewed tool', intro: 'No implicit changes', confirmLabel: 'Apply reviewed change',
          run: async token => { if (!token) { window.__previews++; if (window.__previews === 1) throw new Error('Preview temporarily unavailable'); }
            else window.__applyTokens.push(token); return { preview_token: 'reviewed-retry-token', rows: [{ current_name: 'Asha', cleaned_name: 'Dr Asha' }] }; },
          sections: p => [{ title: 'Names', tone: 'neutral', rows: p.rows, note: 'Reviewed only' }], changeCount: p => p.rows.length, onApplied: () => window.__applied++ });
      });
      await page.getByText('Preview temporarily unavailable', { exact: true }).waitFor();
      assert.equal(await page.locator('p[role=status]').filter({ hasText: /^Preparing the preview/ }).count(), 0, 'error cannot remain a pending preview');
      assert.equal(await page.locator('[data-confirm]').isDisabled(), true);
      await page.locator('[data-retry-preview]').click();
      assert.equal(await page.locator('[data-confirm]').isEnabled(), true);
      assert.equal(await page.evaluate(() => window.__previews), 2);
      assert.deepEqual(await page.evaluate(() => window.__applyTokens), [], 'retry never applies');
      await page.locator('[data-confirm]').click();
      await page.waitForFunction(() => window.__applied === 1);
      assert.deepEqual(await page.evaluate(() => window.__applyTokens), ['reviewed-retry-token']);
      await h.finish('admin-preview-load-failure-retry-explicit-apply');
    }
    {
      const h = await harness(width), { page } = h;
      await page.evaluate(async () => {
        const { reviewAndApply } = await import('/src/admin-preview.ts');
        window.__applyTokens = [];
        window.__pendingLoad = reviewAndApply({ title: 'Slow preview', intro: 'Dismiss while reading', confirmLabel: 'Apply',
          run: token => { if (token) { window.__applyTokens.push(token); return Promise.resolve({ preview_token: 'late', rows: [] }); } return new Promise(resolve => { window.__resolvePreview = resolve; }); },
          sections: () => [], changeCount: () => 0, onApplied: () => {} });
      });
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.evaluate(async () => { window.__resolvePreview({ preview_token: 'late', rows: [] }); await window.__pendingLoad; });
      assert.equal(await page.locator('dialog').count(), 0, 'late preview never resurrects closed dialog');
      assert.deepEqual(await page.evaluate(() => window.__applyTokens), []);
      await h.finish('admin-preview-late-result-after-cancel');
    }
    {
      const h = await harness(width), { page } = h;
      let reads = 0, archive = null;
      h.handlers.push(call => {
        if (call.path.endsWith('/archive-all/preview')) { reads++; return reads === 1 ? { status: 503, json: { detail: 'Counts temporarily unavailable' } } : { json: { members: 2, linked_duties: 3, leave: 1, postings: 2, future_duties: 0, confirm_phrase: 'ARCHIVE 2 MEMBERS', preview_token: 'counts-retry-token' } }; }
        if (call.path.endsWith('/archive-all/batches')) return { json: [] };
        if (call.path.endsWith('/archive-all') && call.method === 'POST') { archive = call.body; return { json: { batch_id: 'archive-retry', archived: 2 } }; }
      });
      await page.evaluate(async () => { window.__changed = 0; const { openArchiveAll } = await import('/src/member-bulk.ts'); await openArchiveAll(() => window.__changed++); });
      await page.getByText('Counts temporarily unavailable', { exact: true }).waitFor();
      assert.equal(await page.locator('p[role=status]').filter({ hasText: /^Counting members and their records/ }).count(), 0);
      await page.locator('[data-retry-counts]').click();
      await page.locator('[data-phrase]').waitFor();
      assert.equal(reads, 2);
      assert.equal(archive, null);
      assert.equal(await page.locator('[data-archive]').isDisabled(), true);
      await page.locator('[data-phrase]').fill('ARCHIVE 2 MEMBERS');
      await page.locator('[data-archive]').click();
      await page.getByText('2 members archived.', { exact: true }).waitFor();
      assert.deepEqual(archive, { preview_token: 'counts-retry-token', confirm_phrase: 'ARCHIVE 2 MEMBERS' });
      assert.equal(await page.evaluate(() => window.__changed), 1);
      await h.finish('archive-count-failure-retry-exact-review-confirm');
    }
    {
      const h = await harness(width), { page } = h;
      let release;
      h.handlers.push(call => {
        if (call.path.endsWith('/archive-all/preview')) return new Promise(resolve => { release = () => resolve({ json: { members: 2, linked_duties: 0, leave: 0, postings: 0, future_duties: 0, confirm_phrase: 'ARCHIVE 2 MEMBERS', preview_token: 'late-count' } }); });
        if (call.path.endsWith('/archive-all/batches')) return { json: [] };
      });
      await page.evaluate(async () => { const { openArchiveAll } = await import('/src/member-bulk.ts'); window.__pendingArchive = openArchiveAll(() => {}); });
      await page.getByRole('button', { name: 'Close clear all members', exact: true }).click();
      while (!release) await new Promise(resolve => setTimeout(resolve, 10));
      release();
      await page.evaluate(async () => { await window.__pendingArchive; });
      assert.equal(await page.locator('dialog').count(), 0, 'late count response does not reopen archive dialog');
      assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
      await h.finish('archive-late-count-after-close');
    }
    {
      const h = await harness(width), { page } = h;
      await page.evaluate(async () => {
        const { reviewAndApply } = await import('/src/admin-preview.ts');
        window.__calls = []; window.__applied = [];
        window.__open = () => reviewAndApply({ title: 'Review name cleanup', intro: 'Review exact names', confirmLabel: 'Apply reviewed names',
          run: async token => { window.__calls.push(token ?? 'preview'); if (token && window.__stale) { window.__stale = false; throw Object.assign(new Error('stale'), { status: 409, detail: { code: 'stale_preview' } }); } return { preview_token: 'token-' + window.__calls.length, rows: [{ current_name: 'Dr Asha', cleaned_name: 'Asha' }] }; },
          sections: p => [{ title: 'Names', tone: 'neutral', rows: p.rows, note: 'Only reviewed names' }], changeCount: p => p.rows.length,
          onApplied: result => window.__applied.push(result) });
        await window.__open();
      });
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.__calls), ['preview']);
      assert.deepEqual(await page.evaluate(() => window.__applied), []);
      await page.evaluate(async () => { window.__stale = true; await window.__open(); });
      await page.locator('[data-confirm]').click();
      await page.getByText('The member list changed since this preview.').waitFor();
      assert.deepEqual(await page.evaluate(() => window.__applied), []);
      assert.equal(await page.locator('dialog').count(), 1);
      await page.locator('[data-confirm]').click();
      await page.waitForFunction(() => window.__applied.length === 1);
      assert.deepEqual(await page.evaluate(() => window.__calls), ['preview', 'preview', 'token-2', 'preview', 'token-4']);
      assert.equal(await page.locator('dialog').count(), 0);
      await h.finish('admin-preview-cancel-stale-reconfirm');
    }
    {
      const h = await harness(width), { page } = h;
      let failLoad = true, failRestore = true, restored = false;
      const batch = { batch_id: 'rb-one', kind: 'leave', count: 1, labels: ['Asha annual leave'], deleted_at: '2026-10-21T08:00:00Z', deleted_by: 'Admin', purge_after: '2026-11-20', restored_at: null };
      h.handlers.push(call => {
        if (call.path === '/api/v1/admin/recycle-bin') { if (failLoad) { failLoad = false; return { status: 503, json: { detail: 'Recycle service unavailable' } }; } return { json: [{ ...batch, restored_at: restored ? '2026-10-21T09:00:00Z' : null }] }; }
        if (call.path.endsWith('/rb-one/restore')) { if (failRestore) { failRestore = false; return { status: 503, json: { detail: 'Restore temporarily unavailable' } }; } restored = true; return { json: { restored: 1, failed: [] } }; }
      });
      await page.evaluate(async () => { const { renderRecycleBin } = await import('/src/recycle-bin.ts'); await renderRecycleBin(document.querySelector('#root')); });
      await page.locator('[data-rb-retry]').click();
      await page.locator('[data-rb-restore]').click();
      await page.getByText('Restore temporarily unavailable', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-rb-restore]').isEnabled(), true);
      assert.equal(restored, false);
      await page.locator('[data-rb-restore]').click();
      await page.getByText('Restored 1 of 1.', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-rb-restore]').count(), 0);
      assert.equal(restored, true);
      assert.equal(h.calls.filter(c => c.path.endsWith('/restore')).length, 2);
      await h.finish('recycle-load-retry-restore-failure-recovery');
    }
    {
      const h = await harness(width), { page } = h;
      let saved = null, rejectSave = true;
      h.handlers.push(call => {
        if (call.path === '/api/v1/normalization/catalog/duty_type') return { json: [{ key: 'MAIN', label: 'Main duty', active: true }, { key: 'OLD', label: 'Old duty', active: false }] };
        if (call.path === '/api/v1/admin/mappings' && call.method === 'POST') { if (rejectSave) { rejectSave = false; return { status: 422, json: { detail: 'Mapping needs review' } }; } saved = call.body; return { json: { id: 'mapping-one', ...saved } }; }
      });
      await page.evaluate(async () => { window.__saved = 0; const { openMappingCreator } = await import('/src/reference-workspace.ts'); await openMappingCreator(() => window.__saved++); });
      assert.equal(await page.locator('[name=target_key] option[value=OLD]').count(), 0);
      await page.locator('[name=source_label]').fill('MAIN OLD');
      await page.locator('[name=target_key]').selectOption('MAIN');
      await page.locator('[name=notes]').fill('Reviewed spelling');
      await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
      await page.getByText('Mapping needs review', { exact: true }).waitFor();
      assert.equal(await page.locator('[name=source_label]').inputValue(), 'MAIN OLD');
      assert.equal(await page.evaluate(() => window.__saved), 0);
      await page.getByRole('button', { name: 'Save mapping', exact: true }).click();
      await page.waitForFunction(() => window.__saved === 1);
      assert.deepEqual(saved, { mapping_type: 'duty_label', source_label: 'MAIN OLD', target_key: 'MAIN', notes: 'Reviewed spelling', status: 'reviewed', target_label: 'Main duty' });
      assert.equal(await page.locator('dialog').count(), 0);
      await h.finish('mapping-save-error-retains-draft-then-success');
    }
    {
      const h = await harness(width), { page } = h;
      h.handlers.push(call => call.path === '/api/v1/normalization/catalog/duty_type' ? { json: [{ key: 'MAIN', label: 'Main duty', active: true }] } : null);
      await page.evaluate(async () => { window.__saved = 0; const { openMappingCreator } = await import('/src/reference-workspace.ts'); await openMappingCreator(() => window.__saved++); });
      await page.locator('[name=source_label]').fill('UNSAVED');
      page.once('dialog', dialog => dialog.dismiss());
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.locator('dialog').count(), 1);
      assert.equal(await page.locator('[name=source_label]').inputValue(), 'UNSAVED');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.locator('dialog').count(), 0);
      assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
      assert.equal(await page.evaluate(() => window.__saved), 0);
      await h.finish('mapping-dirty-cancel-decline-then-discard');
    }
  }
  const output = new URL('../../docs/premium-ui/admin-action-results.json', import.meta.url);
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, JSON.stringify({ schema_version: 1, captured_at: new Date().toISOString(), api_mode: 'fully mocked; no backend mutation', results }, null, 2));
  console.log(`${results.length} premium admin outcome workflows passed`);
} finally { await browser.close(); }
