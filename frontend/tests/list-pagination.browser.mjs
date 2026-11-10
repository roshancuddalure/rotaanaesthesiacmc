import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const bundle = await build({ entryPoints: ['src/list-pagination.ts'], bundle: true, write: false, format: 'iife', globalName: 'pagination' });
const unitBundle = await build({ entryPoints: ['src/unit-member-lists.ts'], bundle: true, write: false, format: 'iife', globalName: 'unitLists' });
const css = await readFile('src/styles.css', 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const rows = Array.from({length: 65}, (_, index) => `<tr><td>${index + 1}</td><td><input value="Member ${index + 1}"></td></tr>`).join('');
  await page.setContent(`<style>${css}</style><section><table aria-label="Members"><thead><tr><th>ID</th><th>Name</th></tr></thead><tbody>${rows}</tbody></table></section><div class="candidate-list">${Array.from({length: 35}, (_, i) => `<article>Candidate ${i + 1}</article>`).join('')}</div>`);
  await page.addScriptTag({content: bundle.outputFiles[0].text});
  await page.evaluate(() => { window.stopPagination = pagination.installListPagination(); });
  const visible = () => page.locator('tbody tr:visible').count();
  const pager = page.locator('.list-paginator').first();
  assert.equal(await visible(), 10);
  assert.match(await pager.innerText(), /1–10 of 65/);
  await page.locator('tbody input').first().fill('Edited value');
  await pager.getByRole('button', {name: 'Next', exact: true}).click();
  assert.equal(await page.locator('tbody tr:visible td').first().innerText(), '11');
  await pager.getByRole('button', {name: 'Previous', exact: true}).click();
  assert.equal(await page.locator('tbody input').first().inputValue(), 'Edited value');
  for (const size of [20, 30, 10]) {
    await pager.getByRole('combobox').selectOption(String(size));
    assert.equal(await visible(), size);
    assert.equal(await pager.getByRole('button', {name: 'Previous', exact: true}).isDisabled(), true);
  }
  await pager.getByRole('combobox').selectOption('30');
  await pager.getByRole('button', {name: 'Next', exact: true}).click();
  await pager.getByRole('button', {name: 'Next', exact: true}).click();
  assert.equal(await visible(), 5);
  assert.equal(await pager.getByRole('button', {name: 'Next', exact: true}).isDisabled(), true);
  assert.equal(await page.locator('.candidate-list article:visible').count(), 10);
  // Existing search filters apply before pagination; the page resets when results change.
  await page.evaluate(() => document.querySelectorAll('tbody tr').forEach((row, i) => { row.hidden = i >= 7; }));
  await page.waitForFunction(() => document.querySelector('tbody tr')?.getAttribute('data-pagination-hidden') === null);
  assert.equal(await visible(), 7);
  assert.match(await pager.innerText(), /1–7 of 7/);
  await page.evaluate(() => document.querySelectorAll('tbody tr').forEach(row => { row.hidden = false; }));
  await page.emulateMedia({media: 'print'});
  assert.equal(await visible(), 65);
  await page.emulateMedia({media: 'screen'});
  assert.equal(await visible(), 30);
  await page.evaluate(() => window.stopPagination());
  assert.equal(await visible(), 65);
  assert.equal(await page.locator('.list-paginator').count(), 0);
  // Unit member chips have their own data-level pager and print materialization.
  await page.addScriptTag({content: unitBundle.outputFiles[0].text});
  await page.evaluate(() => {
    document.body.innerHTML = unitLists.unitMemberList('unit-a', Array.from({length: 34}, (_, i) => ({name: `Member ${i}`, html: `<span class="chip">Member ${i}</span>`})));
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-unit-member-action]');
      if (button) unitLists.activateUnitMemberList(button);
    });
  });
  assert.equal(await page.locator('.chip').count(), 10);
  await page.getByRole('button', {name:'Next', exact:true}).click();
  assert.equal(await page.locator('.chip').first().innerText(), 'Member 10');
  await page.getByRole('combobox').selectOption('30');
  assert.equal(await page.locator('.chip').count(), 30);
  await page.getByRole('button', {name:'Next', exact:true}).click();
  assert.equal(await page.locator('.chip').count(), 4);
  await page.evaluate(() => { window.restorePrint = unitLists.prepareUnitMemberPrint(document.body); });
  assert.equal(await page.locator('.chip').count(), 34);
  await page.evaluate(() => window.restorePrint());
  assert.equal(await page.locator('.chip').count(), 4);
  await page.setViewportSize({width:320,height:800});
  await page.evaluate(() => {
    document.body.innerHTML = `<section class="panel"><table><tbody>${Array.from({length:20},(_,i)=>`<tr><td>${i}</td></tr>`).join('')}</tbody></table><div data-table-paginator="native">Native controls</div></section><section class="member-card-list"><h3>Members</h3>${Array.from({length:15},(_,i)=>`<article>Member ${i}</article>`).join('')}</section>`;
    window.stopPagination = pagination.installListPagination();
  });
  assert.equal(await page.locator('.list-paginator').count(),1,'Existing analysis pagination must not be paginated again');
  assert.equal(await page.locator('tbody tr:visible').count(),20);
  assert.equal(await page.locator('.member-card-list article:visible').count(),10);
  assert.equal(await page.getByRole('heading',{name:'Members'}).isVisible(),true);
  await page.getByRole('button',{name:'Next',exact:true}).click();
  assert.equal(await page.locator('.member-card-list article:visible').count(),5);
  await page.evaluate(() => document.querySelectorAll('.member-card-list article').forEach((row,i)=>{if(i>=2)row.remove();}));
  await page.waitForFunction(() => document.querySelector('.list-paginator').textContent.includes('1–2 of 2'));
  assert.equal(await page.locator('.member-card-list article:visible').count(),2);
  await page.evaluate(() => window.stopPagination());
  assert.deepEqual(errors, []);
  console.log('Pagination browser checks passed: defaults, 20/30 rows, boundaries, independent lists, search, form state, printing and unit postings.');
} finally { await browser.close(); }
