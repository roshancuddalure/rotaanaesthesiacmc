import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import vm from 'node:vm';

async function nativePager() {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const PAGE_SIZE =');
  const end = source.indexOf('function topPeople(', start);
  const {code} = await transform(source.slice(start, end) + '\n globalThis.pager = {paginate, renderPaginator, setPage, getPage, tablePageSizes};', {loader:'ts'});
  const context = vm.createContext({});
  vm.runInContext(code, context);
  return context.pager;
}

test('analysis pagination defaults to ten and exposes only 10/20/30 rows', async () => {
  const pager = await nativePager();
  const items = Array.from({length:65}, (_, i) => i);
  assert.deepEqual(Array.from(pager.paginate(items,'members')), items.slice(0,10));
  const html = pager.renderPaginator('members',65);
  assert.match(html,/1–10 of 65/);
  assert.deepEqual([...html.matchAll(/<option value="(\d+)"/g)].map(match => match[1]), ['10','20','30']);
  for (const size of [20,30]) {
    pager.tablePageSizes.members = size;
    pager.setPage('members',1);
    assert.deepEqual(Array.from(pager.paginate(items,'members')),items.slice(size,size*2));
  }
});

test('analysis pagination clamps changed filters and keeps independent page state', async () => {
  const pager = await nativePager();
  pager.setPage('members',6);
  assert.deepEqual(Array.from(pager.paginate([1,2,3],'members')),[1,2,3]);
  assert.equal(pager.getPage('members'),0);
  pager.setPage('other',2);
  assert.equal(pager.getPage('members'),0);
  assert.deepEqual(Array.from(pager.paginate([],'members')),[]);
  assert.match(pager.renderPaginator('members',0),/0–0 of 0/);
  assert.match(pager.renderPaginator('members',0),/Page 1 of 1/);
});
