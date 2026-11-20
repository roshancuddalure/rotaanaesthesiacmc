import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
const source = await readFile(new URL('../src/history-filter.ts', import.meta.url), 'utf8');
const compiled = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' });
const { matchesImportHistory } = await import('data:text/javascript;base64,' + Buffer.from(compiled.code).toString('base64'));

test('empty query retains every loaded history row including a row with no fields', () => {
 assert.equal(matchesImportHistory(' \t\n ', []), true);
 assert.equal(matchesImportHistory('', ['Members October.csv']), true);
});

test('terms can match different displayed fields and every term is required', () => {
 const fields = ['Members October.csv', 'Applied', '21 October 2026, 10:30 IST'];
 assert.equal(matchesImportHistory('october APPLIED', fields), true);
 assert.equal(matchesImportHistory('applied november', fields), false);
 assert.equal(matchesImportHistory('  MEMBERS\t21\nIST ', fields), true);
});

test('punctuation is literal and cannot become a regular expression', () => {
 assert.equal(matchesImportHistory('[a].csv', ['Members [a].csv']), true);
 assert.equal(matchesImportHistory('[a].csv', ['Members a.csv']), false);
 assert.equal(matchesImportHistory('.*', ['Members October.csv']), false);
 assert.equal(matchesImportHistory('(', ['Members (reviewed).csv']), true);
 assert.equal(matchesImportHistory('\\', ['archive\\members.csv']), true);
});

test('search sees only fields explicitly supplied by the history owner', () => {
 const row = { id: 'hidden-batch-731', filename: 'Members.csv', status: 'Applied' };
 assert.equal(matchesImportHistory('hidden-batch-731', [row.filename, row.status]), false);
 assert.equal(matchesImportHistory('members applied', [row.filename, row.status]), true);
});

test('literal matching retains accents and displayed local-time labels', () => {
 const fields = ['José.csv', '21 October 2026, 10:30 IST'];
 assert.equal(matchesImportHistory('JOSÉ IST', fields), true);
 assert.equal(matchesImportHistory('jose', fields), false);
 assert.equal(matchesImportHistory('UTC', fields), false);
 assert.equal(matchesImportHistory('10:30', fields), true);
});

test('matching does not mutate returned row identities, dates or CSV filenames', () => {
 const rows = Object.freeze([
  Object.freeze({ id: 'b2', filename: 'Members, October.csv', timestamp: 'Not returned' }),
  Object.freeze({ id: 'b1', filename: 'Members November.csv', timestamp: '21 Oct 2026' }),
 ]);
 const before = JSON.stringify(rows);
 const matches = rows.filter(row => matchesImportHistory('members', Object.freeze([row.filename, row.timestamp])));
 assert.deepEqual(matches.map(row => row.id), ['b2', 'b1']);
 assert.equal(matches[0], rows[0]);
 assert.equal(JSON.stringify(rows), before);
});

test('untrusted markup remains ordinary search text', () => {
 assert.equal(matchesImportHistory('<img', ['<img src=x onerror=alert(1)>.csv']), true);
 assert.equal(matchesImportHistory('<img', ['Members.csv']), false);
});
