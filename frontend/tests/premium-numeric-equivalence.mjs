// Offline calculation comparison only: no GPU, server, DB or schedule generation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const [baselineArgument, outputArgument] = process.argv.slice(2);
assert.ok(baselineArgument && outputArgument, 'Supply captured baseline directory and report path');
const baseline = resolve(baselineArgument);
const sourcePath = resolve('src/compute-protocol.ts');
const baselinePath = join(baseline, 'frontend/src/compute-protocol.ts');
const sha = value => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(await readFile(join(baseline, 'manifest.json'), 'utf8'));
const before = await readFile(baselinePath, 'utf8');
const current = await readFile(sourcePath, 'utf8');
assert.equal(sha(before), manifest.files['frontend/src/compute-protocol.ts'], 'Baseline must match captured manifest');
const directory = await mkdtemp(join(tmpdir(), 'rota-numeric-equivalence-'));
try {
  const modules = [];
  for (const [name, source] of [['baseline', before], ['current', current]]) {
    const file = join(directory, `${name}.mjs`);
    await writeFile(file, ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020
    }}).outputText);
    modules.push(await import(pathToFileURL(file)));
  }
  const results = [];
  const exercise = (name, fixture, expectedValid = true) => {
    const outputs = modules.map(module => {
      try {
        const input = module.scoreInput(structuredClone(fixture));
        const scores = module.numericScores(input);
        return { input, scores, winner: module.winnerFor(scores, input.ties) };
      } catch (error) { return { error: error.code, name: error.name }; }
    });
    assert.deepEqual(outputs[1], outputs[0], name);
    assert.equal(!outputs[1].error, expectedValid, `${name}: expected acceptance`);
    if (!outputs[1].error) {
      const { input, scores, winner } = outputs[1];
      // Independent reference ordering and summation catches shared baseline bugs.
      const order = input.rows.map((row, index) => ({ row, index, tie: input.ties[index] }));
      const ranked = input.kernel === 'lexicographic';
      order.sort((a, b) => {
        if (ranked) {
          for (let column = 0; column < a.row.length; column++) {
            if (a.row[column] !== b.row[column]) return a.row[column] - b.row[column];
          }
        } else {
          const sum = row => row.reduce((total, value) => total + BigInt(value), 0n);
          const delta = sum(a.row) - sum(b.row);
          if (delta) return delta < 0n ? -1 : 1;
        }
        return a.tie - b.tie;
      });
      assert.equal(winner, order[0].index, `${name}: reference winner`);
      const expected = ranked ? Array(order.length) : input.rows.map(row => Number(row.reduce((sum, n) => sum + BigInt(n), 0n)));
      if (ranked) order.forEach((entry, rank) => expected[entry.index] = rank);
      assert.deepEqual(scores, expected, `${name}: reference scores`);
    }
    results.push({ name, accepted: !outputs[1].error, equal: true });
  };
  exercise('zero tie order', { rows: [Array(9).fill(0), Array(9).fill(0)], ties: [9, 3] });
  exercise('exact signed maximum', { rows: [[2147483647, ...Array(8).fill(0)]], ties: [0] });
  exercise('negative lexicographic extremes', { kernel: 'lexicographic', version: 3,
    rows: [[-2147483648, 2147483647], [2147483647, -2147483648], [-2147483648, 2147483647]], ties: [2, 1, 0] });
  let seed = 0x260110;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  for (let index = 0; index < 512; index++) {
    const size = 1 + random() % 48;
    const ties = Array.from({length: size}, (_, i) => size - i);
    exercise(`sum-${index}`, { rows: Array.from({length: size}, () => Array.from({length: 9}, () => random() % 1000000)), ties });
    const width = 1 + random() % 32;
    exercise(`rank-${index}`, { kernel: 'lexicographic', version: 3,
      rows: Array.from({length: size}, () => Array.from({length: width}, () => (random() % 21) - 10)), ties });
  }
  const invalid = [null, {}, {rows: [], ties: []},
    { rows: [[2147483647, 1, ...Array(7).fill(0)]], ties: [0] },
    ...[NaN, Infinity, -1, .5].map(value => ({ rows: [[value, ...Array(8).fill(0)]], ties: [0] })),
    { rows: [Array(9).fill(0), Array(9).fill(0)], ties: [0, 0] },
    { kernel: 'lexicographic', version: 3, rows: [[2147483648]], ties: [0] },
    { kernel: 'lexicographic', version: 2, rows: [[0]], ties: [0] }];
  invalid.forEach((fixture, index) => exercise(`invalid-${index}`, fixture, false));
  assert.equal(sha(await readFile(sourcePath, 'utf8')), sha(current), 'Current source held stable');
  assert.equal(sha(await readFile(baselinePath, 'utf8')), sha(before), 'Baseline held stable');
  const report = { recorded_at_utc: new Date().toISOString(),
    scope: 'Captured pre-upgrade/current numeric protocol CPU functions and independent references only. No actual GPU, API, database, assignment, import or export equivalence certification.',
    whole_requirement_completion_proven: false, baseline_created_at: manifest.created_at,
    source_sha256: { 'frontend/src/compute-protocol.ts': sha(current) },
    baseline_sha256: sha(before), baseline_manifest_verified: true,
    fixture_seed: '0x260110', random_batches_per_kernel: 512,
    count: results.length, accepted: results.filter(result => result.accepted).length,
    rejected: results.filter(result => !result.accepted).length, results };
  await writeFile(resolve(outputArgument), JSON.stringify(report, null, 2) + '\n');
  console.log(`${results.length} numeric fixtures agree with baseline; accepted cases checked against independent references.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
