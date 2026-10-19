import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const directory = await mkdtemp(join(tmpdir(), "rota-compute-tests-"));
for (const name of ["compute-protocol", "compute-device"]) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  await writeFile(join(directory, name + ".mjs"), code.replaceAll('"./compute-protocol"', '"./compute-protocol.mjs"'));
}
after(() => rm(directory, { recursive: true, force: true }));
const protocol = await import(pathToFileURL(join(directory, "compute-protocol.mjs")));
const compute = await import(pathToFileURL(join(directory, "compute-device.mjs")));
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "test-browser", gpu: {} } });
globalThis.isSecureContext = true;
globalThis.window = { setTimeout, clearTimeout };
const device = () => ({ supported: true, software: false, adapter: "Test GPU", vendor: "test", architecture: "test",
  device: "", description: "", test_ms: 5, parity: true, signature: "test-signature", preference: "high-performance", version: 2 });
let behavior, workers;
class FakeWorker {
  constructor() { this.closed = false; workers.push(this); }
  postMessage(message) { this.sent = message; behavior(this, message); }
  terminate() { this.closed = true; }
  respond(message, result) { queueMicrotask(() => { if (!this.closed) this.onmessage?.({ data: { id: message.id, result } }); }); }
}
globalThis.Worker = FakeWorker;
function normal(worker, message) {
  worker.respond(message, message.type === "test" ? device() : { scores: protocol.cpuScores(message), winner: protocol.winnerFor(protocol.cpuScores(message), message.ties), gpu_ms: 2, signature: "test-signature" });
}
function reset() { workers = []; behavior = normal; storage.clear(); compute.resetPreference(); globalThis.window = { setTimeout, clearTimeout }; }
const valid = () => ({ rows: [[0, 1, 2, 3, 4, 5, 6, 7, 8]], ties: [0] });

for (const [name, input] of Object.entries({
  null: null, empty: { rows: [], ties: [] }, wrongRows: { rows: "x", ties: [] },
  short: { rows: [[1]], ties: [0] }, fractional: { rows: [[0.1, ...Array(8).fill(0)]], ties: [0] },
  overflow: { rows: [[2147483647, 1, ...Array(7).fill(0)]], ties: [0] }, negative: { rows: [[-1, ...Array(8).fill(0)]], ties: [0] },
  nan: { rows: [[NaN, ...Array(8).fill(0)]], ties: [0] }, infinity: { rows: [[Infinity, ...Array(8).fill(0)]], ties: [0] },
  tiesLength: { rows: [Array(9).fill(0)], ties: [] }, tiesDuplicate: { rows: [Array(9).fill(0), Array(9).fill(0)], ties: [1, 1] },
  tiesHole: { rows: [Array(9).fill(0)], ties: Array(1) }, rowsHole: { rows: [Array(9)], ties: [0] },
  tiesNegative: { rows: [Array(9).fill(0)], ties: [-1] }, tiesFractional: { rows: [Array(9).fill(0)], ties: [0.5] },
  tiesString: { rows: [Array(9).fill(0)], ties: ["0"] }, huge: { rows: Array(100001).fill(Array(9).fill(0)), ties: [] },
})) test(`numeric protocol rejects ${name}`, () => assert.throws(() => protocol.scoreInput(input)));

test("projection strips tokens, names and extra fields; exact limit and ties work", () => {
  const projected = protocol.scoreInput({ ...valid(), token: "secret", person_name: "Someone", type: "injected", id: 100 });
  assert.deepEqual(Object.keys(projected), ["rows", "ties"]);
  assert.deepEqual(protocol.cpuScores(protocol.scoreInput({ rows: [[2147483647, ...Array(8).fill(0)]], ties: [0] })), [2147483647]);
  assert.equal(protocol.winnerFor([10, 10, 11], [2, 1, 0]), 1);
});

for (const [name, result] of Object.entries({ wrongScore: { winner: 0, scores: [99], gpu_ms: 1, signature: "x" },
  wrongWinner: { winner: 1, scores: [36], gpu_ms: 1, signature: "x" }, sparse: { winner: 0, scores: Array(1), gpu_ms: 1, signature: "x" },
  badTime: { winner: 0, scores: [36], gpu_ms: -1, signature: "x" }, missingSignature: { winner: 0, scores: [36], gpu_ms: 1 } }))
  test(`response validation rejects ${name}`, () => assert.throws(() => protocol.validateResult("score", result, valid())));

test("malformed storage and old tests cannot enable GPU", () => {
  reset(); const key = "duty_rota_compute_device_v1";
  for (const value of ["{", "null", "[]", '"x"', "x".repeat(13000), JSON.stringify({ enabled: "yes", mode: "local_gpu", test: { supported: true } })]) {
    storage.set(key, value); assert.equal(compute.selectedEngine(true, true), "server");
  }
});
function pref() { return { enabled: true, mode: "auto", power: "high-performance", test: device(), proof: {
  server_ms: 1000, local_ms: 700, parity: true, at: Date.now(), version: 2, adapter: "Test GPU", signature: "test-signature",
  browser: "test-browser", month: "2026-05", context_hash: "same" } }; }
test("automatic mode requires live verification, roles, matching context and faster measured time", () => {
  reset(); compute.savePreference(pref()); const context = { month: "2026-05", hash: "same" };
  assert.equal(compute.selectedEngine(true, true, context), "server");
  compute.rememberTest(device()); assert.equal(compute.selectedEngine(true, true, context), "local_gpu");
  assert.equal(compute.selectedEngine(false, true, context), "server");
  assert.equal(compute.selectedEngine(true, false, context), "server");
  assert.equal(compute.selectedEngine(true, true, { ...context, hash: "changed" }), "server");
  for (const patch of [{ at: Date.now() + 10000 }, { at: Date.now() - 8 * 86400000 }, { local_ms: -1 }, { local_ms: 900 },
    { server_ms: 0 }, { parity: false }, { version: 1 }, { signature: "another" }, { browser: "another-browser" }]) {
    const p = pref(); Object.assign(p.proof, patch); compute.savePreference(p); assert.equal(compute.selectedEngine(true, true, context), "server");
  }
});
test("GPU errors invalidate stored proof and session verification", async () => {
  reset(); compute.savePreference(pref()); compute.rememberTest(device());
  behavior = (w, m) => queueMicrotask(() => w.onmessage({ data: { id: m.id, error: { code: "device-lost", message: "lost" } } }));
  const worker = new compute.ComputeWorker(); await assert.rejects(worker.call("test"), /lost/);
  assert.equal(compute.preference().proof, undefined); assert.equal(compute.preference().test, undefined); assert.equal(workers[0].closed, true);
});
test("only one request is admitted, payload cannot override protocol, close rejects pending", async () => {
  reset(); behavior = () => {};
  const w = new compute.ComputeWorker(); const pending = w.call("score", { ...valid(), id: 99, type: "test", token: "secret", person_name: "name" });
  assert.equal(workers[0].sent.type, "score"); assert.equal(workers[0].sent.id, 1);
  assert.equal("token" in workers[0].sent, false); assert.equal("person_name" in workers[0].sent, false);
  await assert.rejects(w.call("test"), /already running/); w.close(); w.close();
  await assert.rejects(pending, /stopped/); await assert.rejects(w.call("test"), /stopped/);
});
for (const kind of ["crash", "decode", "unknown-id", "bad-result", "transfer"]) test(`worker ${kind} releases and rejects without hanging`, async () => {
  reset(); behavior = (w, m) => {
    if (kind === "transfer") throw Error("clone failed");
    queueMicrotask(() => {
      if (kind === "crash") w.onerror({ preventDefault() {} });
      else if (kind === "decode") w.onmessageerror();
      else w.onmessage({ data: { id: kind === "unknown-id" ? 99 : m.id, result: {} } });
    });
  };
  const w = new compute.ComputeWorker(); await assert.rejects(w.call("test")); assert.equal(workers[0].closed, true);
});
test("timeout terminates worker and rejects once", async () => {
  reset(); behavior = () => {}; globalThis.window.setTimeout = callback => setTimeout(callback, 5);
  const w = new compute.ComputeWorker(); await assert.rejects(w.call("test"), /timed out/); assert.equal(workers[0].closed, true);
});
test("invalid numeric input never reaches GPU", async () => {
  reset(); const w = new compute.ComputeWorker(); await assert.rejects(w.call("score", { rows: [], ties: [] }));
  assert.equal(workers[0].sent, undefined); w.close();
});
test("one device recovery succeeds and invalidates previous benchmark", async () => {
  reset(); compute.savePreference(pref()); let failed = false;
  behavior = (w, m) => {
    if (m.type === "score" && !failed) { failed = true; queueMicrotask(() => w.onmessage({ data: { id: m.id, error: { code: "device-lost", message: "lost" } } })); }
    else normal(w, m);
  };
  const notices = []; const recovery = new compute.RecoveringCompute(v => notices.push(v));
  assert.equal((await recovery.score(valid())).winner, 0); assert.equal(workers.length, 2); assert.equal(notices.length, 1);
  assert.equal(compute.preference().proof, undefined); recovery.close();
});
test("repeated device loss stops after two workers; close cannot resurrect recovery", async () => {
  reset(); behavior = (w, m) => m.type === "test" ? normal(w, m) : queueMicrotask(() => w.onmessage({ data: { id: m.id, error: { code: "gpu-error", message: "driver" } } }));
  const recovery = new compute.RecoveringCompute(); await assert.rejects(recovery.score(valid()), /driver/); assert.equal(workers.length, 2);
  recovery.close(); await assert.rejects(recovery.score(valid()), /stopped/); assert.equal(workers.length, 2);
});
test("parity failure never retries", async () => {
  reset(); behavior = (w, m) => m.type === "test" ? normal(w, m) : w.respond(m, { scores: [99], winner: 0, gpu_ms: 1, signature: "test-signature" });
  const recovery = new compute.RecoveringCompute(); await assert.rejects(recovery.score(valid()), /disagreed/); assert.equal(workers.length, 1); recovery.close();
});
test("software adapter and unavailable Worker preflight select server", async () => {
  reset(); compute.savePreference({ ...pref(), mode: "local_gpu" });
  behavior = (w, m) => w.respond(m, { ...device(), software: true });
  assert.equal(await compute.prepareEngine(true, true, { month: "2026-05", hash: "same" }), "server");
  globalThis.Worker = class { constructor() { throw Error("blocked"); } };
  assert.equal(await compute.prepareEngine(true, true, { month: "2026-05", hash: "same" }), "server");
  globalThis.Worker = FakeWorker;
});
test("diagnostic export excludes auth, member data and rota context", () => {
  reset(); compute.savePreference(pref()); storage.set("duty_rota_auth_token", "VERY_SECRET");
  const text = JSON.stringify(compute.diagnostics()); assert.ok(!text.includes("VERY_SECRET")); assert.ok(!text.includes("context_hash")); assert.ok(!text.includes("2026-05"));
});
test("closing during device preflight terminates immediately without resurrecting a worker", async () => {
  reset(); compute.savePreference({ ...pref(), mode: "local_gpu" }); behavior = () => {};
  const controller = new AbortController();
  const pending = compute.prepareEngine(true, true, { month: "2026-05", hash: "same" }, controller.signal);
  controller.abort(); assert.equal(await pending, "server"); assert.equal(workers[0].closed, true); assert.equal(workers.length, 1);
});
test("disabled browser storage cannot enable local GPU or cause unhandled errors", async () => {
  reset(); const original = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } };
  try {
    assert.equal(compute.preference().mode, "server"); assert.equal(compute.selectedEngine(true, true), "server");
    assert.throws(() => compute.savePreference(pref()), /could not be saved/);
    compute.invalidateDevice(); compute.resetPreference();
    assert.equal(await compute.prepareEngine(true, true, { month: "2026-05", hash: "same" }), "server");
  } finally { globalThis.localStorage = original; }
});
