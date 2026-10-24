import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Isolated frontend fixtures. No live API call, import apply, or assignment write.
const base = process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const evidence = [];
const browser = await chromium.launch({ headless: true });
const memberName = 'Dr Alexandra Catherine Montgomery Department Member';
const unitName = 'Northern Campus Comprehensive Emergency and Critical Care Unit';
const member = { id: 'p1', canonical_name: memberName, active_status: 'active', call_level: '2ND_CALL', aliases: [], designations: [] };
async function setup(viewport, handler) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [], calls = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/__sticky-review', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Long review fixture</title><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open review</button></body></html>' }));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    calls.push({ path, method: route.request().method() });
    const response = handler(path, route.request());
    assert.ok(response, `Unmocked ${path}`);
    await route.fulfill({ json: response });
  });
  await page.goto(base + '/__sticky-review');
  return { context, page, errors, calls };
}
async function wheelToEnd(page, locator) {
  const box = await locator.boundingBox();
  assert.ok(box && box.height >= 30, 'Review content retains usable vertical space');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 100000);
  await page.waitForTimeout(150);
}
async function geometry(locator, viewport, footer = null) {
  const rect = await locator.boundingBox();
  assert.ok(rect && rect.width > 0 && rect.height > 0, 'Target has a visible box');
  assert.ok(rect.x >= -1 && rect.x + rect.width <= viewport.width + 1, 'Target fits horizontally');
  assert.ok(rect.y >= -1 && rect.y + rect.height <= viewport.height + 1, 'Target fits vertically');
  assert.equal(await locator.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return node === hit || node.contains(hit);
  }), true, 'Target center is not covered by an overlay or sticky action');
  if (footer) {
    const bar = await footer.boundingBox();
    assert.ok(rect.y + rect.height <= bar.y + 1, 'Final review row is above the action footer');
  }
  return rect;
}
async function tabTo(page, selector, limit = 350) {
  for (let i = 0; i < limit; i++) {
    if (await page.locator(selector).evaluate(node => node === document.activeElement)) return i;
    await page.keyboard.press('Tab');
  }
  assert.fail(`Keyboard could not reach ${selector}`);
}
try {
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    const decisions = Array.from({ length: 45 }, (_, i) => ({ slot_id: `s${i}`, date: `2026-10-${String(i % 28 + 1).padStart(2, '0')}`, duty: `Main 24-hour duty ${i + 1}`, unit: unitName, action: 'assign', person_id: 'p1', person_name: memberName, reason: `Eligible, rested and below monthly workload target. Review decision ${i + 1}.`, score: 1 }));
    const job = { id: 'j1', month: '2026-10', status: 'completed', engine: 'server', requested_engine: 'server', revision: 7, processed: 45, total: 45, proposed: 45, unresolved: 0, decisions, kind: 'members', metrics: { planning_ms: 2 }, burden: null };
    const fixture = await setup(viewport, path => path.endsWith('/capabilities') ? { enabled: true, browser_gpu: false, template_compute: true } : path.endsWith('/jobs') ? [job] : null);
    const { page, context, errors, calls } = fixture;
    await page.evaluate(async () => (await import('/src/rota-compute.ts')).openRotaCompute('2026-10', true, () => {}));
    const dialog = page.locator('dialog.compute-workspace');
    await dialog.locator('tbody tr').last().waitFor();
    await wheelToEnd(page, dialog.locator('.mw-content'));
    const finalRow = dialog.locator('tbody tr').last();
    // A row may be taller than the short viewport. Its last reason cell must still
    // be reachable above the separate action bar at the actual scroll boundary.
    const lastCell = finalRow.locator('td').last();
    const finalRect = await geometry(lastCell, viewport, dialog.locator('.mw-footer'));
    assert.equal(await finalRow.locator('td').nth(1).textContent(), memberName);
    const textClipping = await finalRow.locator('td').nth(1).evaluate(node => ({ height: node.scrollHeight > node.clientHeight + 1, overflow: getComputedStyle(node).overflowY }));
    assert.ok(!textClipping.height || !['hidden', 'clip'].includes(textClipping.overflow), 'Member name is not vertically clipped');
    await tabTo(page, '[data-review-confirm]');
    await page.keyboard.press('Space');
    await tabTo(page, '[data-apply]');
    const actionRect = await geometry(dialog.locator('[data-apply]'), viewport);
    assert.equal(await dialog.locator('[data-apply]').isEnabled(), true);
    assert.equal(calls.some(call => call.path.endsWith('/apply')), false);
    await dialog.locator('[data-close]').click();
    assert.deepEqual(errors, []);
    evidence.push({ workflow: 'compute-long-review', viewport, passed: true, rows: decisions.length, final_reason_rect: finalRect, keyboard_primary_action_rect: actionRect, mocked_api: true, no_apply: true });
    await context.close();

    const rows = Array.from({ length: 26 }, (_, i) => ({ key: `CSV:${i + 2}`, source: { sheet: 'CSV', row: i + 2 }, original: { member_name: memberName, unit_name: unitName }, values: { member_name: memberName, unit_name: unitName, posting_type: '2ND_CALL', starts_on: '2026-10-01', ends_on: '2026-10-31' }, after: { person_id: 'p1', unit_id: 'u1', posting_type: '2ND_CALL' }, person_match: { state: 'matched', name: memberName, reason: 'Exact', candidates: [] }, unit_match: { state: 'matched', name: unitName, reason: 'Exact', candidates: [] }, issues: [], warnings: [], action: 'create' }));
    const imported = await setup(viewport, path => {
      if (path === '/api/v1/admin/members') return [member];
      if (path === '/api/v1/normalization/units') return [{ id: 'u1', name: unitName, active_status: 'active' }];
      if (path.endsWith('/columns')) return { headers: ['member_name', 'unit_name'], fields: ['member_name', 'unit_name'], suggested: { member_name: 'member_name', unit_name: 'unit_name' } };
      if (path.endsWith('/preview')) return { id: 'import1', kind: 'units', month: '2026-10', mode: 'append', headers: ['member_name', 'unit_name'], fields: ['member_name', 'unit_name'], replacement_scope: [], rows };
    });
    const p = imported.page;
    await p.evaluate(async () => (await import('/src/operational-import.ts')).openOperationalImport('units', '2026-10', () => {}, true));
    await p.locator('input[type=file]').setInputFiles({ name: 'long-review.csv', mimeType: 'text/csv', buffer: Buffer.from('member_name,unit_name\nExample,Unit') });
    await p.getByText('Check column mappings, then preview the records.', { exact: true }).waitFor();
    await p.getByRole('button', { name: 'Preview and normalize', exact: true }).click();
    await p.locator('[data-review-row]').last().waitFor();
    const importDialog = p.locator('dialog.operational-import');
    await wheelToEnd(p, importDialog.locator('.mw-content'));
    await p.getByRole('button', { name: 'Next rows', exact: true }).click();
    const finalImport = p.locator('[data-review-row="CSV:27"]');
    await finalImport.waitFor();
    await finalImport.getByText('Edit row', { exact: true }).click();
    const lastInput = finalImport.locator('[data-field="ends_on"]');
    await tabTo(p, '[data-review-row="CSV:27"] [data-field="ends_on"]');
    const fieldRect = await geometry(lastInput, viewport);
    assert.equal(await lastInput.inputValue(), '2026-10-31');
    await tabTo(p, '[data-apply]');
    const importActionRect = await geometry(p.locator('[data-apply]'), viewport);
    assert.equal(await p.locator('[data-apply]').isEnabled(), true);
    assert.equal(imported.calls.some(call => call.path.endsWith('/apply')), false);
    assert.deepEqual(imported.errors, []);
    evidence.push({ workflow: 'operational-import-final-page-edit', viewport, passed: true, rows: rows.length, final_row: 'CSV:27', keyboard_last_field_rect: fieldRect, keyboard_primary_action_rect: importActionRect, mocked_api: true, no_apply: true });
    await imported.context.close();
  }
  await writeFile('../docs/premium-ui/qa-sticky-review.json', JSON.stringify({ generated_at: new Date().toISOString(), status: 'passed', scope: 'Chromium emulation with mocked APIs; real pointer scroll and keyboard Tab/Space; no writes', limitations: ['Physical device and physical keyboard checks pending', 'Does not prove every dialog or full application action coverage'], workflows: evidence }, null, 2));
  console.log(JSON.stringify({ passed: evidence.length, evidence }));
} finally { await browser.close(); }
