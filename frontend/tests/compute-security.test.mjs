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
  server_ms: 1000, local_ms: 700, parity: true, at: Date.now(), version: 2, measurement_version:2, adapter: "Test GPU", signature: "test-signature",
  browser: "test-browser", month: "2026-05", context_hash: "same" } }; }
test("automatic mode requires live verification, roles, matching context and faster measured time", () => {
  reset(); compute.savePreference(pref()); const context = { month: "2026-05", hash: "same" };
  assert.equal(compute.selectedEngine(true, true, context), "server");
  compute.rememberTest(device()); assert.equal(compute.selectedEngine(true, true, context), "local_gpu");
  assert.equal(compute.selectedEngine(false, true, context), "server");
  assert.equal(compute.selectedEngine(true, false, context), "server");
  assert.equal(compute.selectedEngine(true, true, { ...context, hash: "changed" }), "server");
  for (const patch of [{ at: Date.now() + 10000 }, { at: Date.now() - 8 * 86400000 }, { local_ms: -1 }, { local_ms: 900 },
    { server_ms: 0 }, { parity: false }, { version: 1 }, {measurement_version:undefined}, {measurement_version:1}, { signature: "another" }, { browser: "another-browser" }]) {
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

test("cold GPU setup has a separate bounded budget from numeric scoring", async () => {
  reset();
  const budgets = [];
  globalThis.window.setTimeout = (callback, delay) => { budgets.push(delay); return setTimeout(callback, delay); };
  const w = new compute.ComputeWorker();
  try {
    await w.call("test");
    await w.call("score", valid());
    assert.deepEqual(budgets, [60000, 15000]);
  } finally { w.close(); reset(); }
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

test("signed lexicographic ranking preserves ordered objectives and exact boundaries",()=>{
  const input=protocol.scoreInput({kernel:'lexicographic',version:3,rows:[[-2147483648,2147483647],[-2147483647,-2147483648],[-2147483648,2147483647]],ties:[2,1,0]});
  assert.deepEqual(protocol.numericScores(input),[1,2,0]);
  assert.deepEqual(Object.keys(input),['kernel','version','rows','ties']);
  assert.throws(()=>protocol.scoreInput({...input,rows:[[2147483648]]}));
  assert.throws(()=>protocol.scoreInput({...input,version:2}));
  assert.throws(()=>protocol.scoreInput({...input,rows:[Array(33).fill(0)],ties:[0]}));
});
test("automatic proofs cannot cross workloads, configurations or kernels",()=>{
  reset();const p=pref();p.test.kernel_checks={members:true,template:true,optimizer:true};compute.savePreference(p);compute.rememberTest(p.test);
  const context={month:'2026-05',hash:'same',workload:'template',configuration:'template-options'};
  assert.equal(compute.selectedEngine(true,true,context),'server');
  p.proofs={template:{...p.proof,workload:'template',kernel_version:3,configuration:'template-options'}};compute.savePreference(p);
  assert.equal(compute.selectedEngine(true,true,context),'local_gpu');
  assert.equal(compute.selectedEngine(true,true,{...context,configuration:'changed'}),'server');
  assert.equal(compute.selectedEngine(true,true,{...context,estimatedRows:8}),'server');
  assert.equal(compute.selectedEngine(true,true,{...context,workload:'optimizer'}),'server');
  p.proofs.template.kernel_version=2;compute.savePreference(p);assert.equal(compute.selectedEngine(true,true,context),'server');
});
test('optimizer proof binds mode, time, locks, repairs and preferences to benchmark configuration',()=>{
  reset();const p=pref();p.test.kernel_checks={members:true,template:true,optimizer:true};
  const measured={mode:'balanced',seconds:5};
  const configuration=compute.optimizerConfiguration(measured);
  p.proofs={optimizer:{...p.proof,workload:'optimizer',kernel_version:3,configuration}};
  compute.savePreference(p);compute.rememberTest(p.test);
  const context={month:'2026-05',hash:'same',workload:'optimizer',configuration,estimatedRows:256};
  assert.equal(compute.selectedEngine(true,true,context),'local_gpu');
  for(const patch of [{mode:'repair'},{mode:'preferences'},{seconds:30},{locked_slots:['s1']},{repair_slots:['s1']},{preferences:[{slot_id:'s1',person_id:'p1',penalty:-100}]}]){
    assert.equal(compute.selectedEngine(true,true,{...context,configuration:compute.optimizerConfiguration({...measured,...patch})}),'server');
  }
  assert.equal(compute.selectedEngine(true,true,{...context,configuration:undefined}),'server');
  const unordered={...measured,locked_slots:['b','a'],repair_slots:['d','c'],preferences:[{slot_id:'b',person_id:'p2',penalty:1},{slot_id:'a',person_id:'p1',penalty:-1}]};
  const original=JSON.stringify(unordered);
  assert.equal(compute.optimizerConfiguration(unordered),compute.optimizerConfiguration({...unordered,locked_slots:['a','b'],repair_slots:['c','d'],preferences:[...unordered.preferences].reverse()}));
  assert.equal(JSON.stringify(unordered),original,'Fingerprint must not mutate form options');
  const duplicate=[{slot_id:'s',person_id:'p',penalty:1},{slot_id:'s',person_id:'p',penalty:9}];
  assert.notEqual(compute.optimizerConfiguration({...measured,preferences:duplicate}),compute.optimizerConfiguration({...measured,preferences:[...duplicate].reverse()}));
  assert.equal(compute.optimizerConfiguration({...measured,preferences:duplicate}),compute.optimizerConfiguration({...measured,preferences:[duplicate[1]]}));
});
test('legacy proof cannot impersonate another workload or kernel and adapter labels must agree',()=>{
  reset();const context={month:'2026-05',hash:'same'};
  for(const patch of [{workload:'optimizer',kernel_version:3},{workload:'template',kernel_version:3},{kernel_version:3},{adapter:'Changed GPU'},{configuration:{injected:true}},{context_hash:''}]){
    const p=pref();Object.assign(p.proof,patch);compute.savePreference(p);compute.rememberTest(p.test);
    assert.equal(compute.selectedEngine(true,true,context),'server');
  }
  for(const workload of ['template','optimizer']){
    const p=pref();p.test.kernel_checks={members:true,template:true,optimizer:true};p.proofs={[workload]:{...p.proof,workload,kernel_version:3}};
    compute.savePreference(p);compute.rememberTest(p.test);
    assert.equal(compute.selectedEngine(true,true,{...context,workload}),'server');
  }
});
test('Automatic keeps exact20percent threshold, seven-day expiry and bounded workload estimates',()=>{
  reset();const context={month:'2026-05',hash:'same',estimatedRows:256};
  const now=Date.now, fixed=1800000000000;Date.now=()=>fixed;
  try{
    for(const [patch,expected] of [[{local_ms:800},'local_gpu'],[{local_ms:800.001},'server'],[{at:fixed-7*86400000+1},'local_gpu'],[{at:fixed-7*86400000},'server'],[{at:fixed+1},'server']]){
      const p=pref();Object.assign(p.proof,patch);compute.savePreference(p);compute.rememberTest(p.test);
      assert.equal(compute.selectedEngine(true,true,context),expected);
    }
    const p=pref();compute.savePreference(p);compute.rememberTest(p.test);
    for(const estimatedRows of [0,255,-1,NaN,Infinity,256.5])assert.equal(compute.selectedEngine(true,true,{...context,estimatedRows}),'server');
    assert.equal(compute.selectedEngine(true,true,{...context,estimatedRows:256}),'local_gpu');
  }finally{Date.now=now;}
});
test('unmatched Automatic proof skips worker startup; matching proof still needs live device verification',async()=>{
  reset();const p=pref();compute.savePreference(p);
  assert.equal(await compute.prepareEngine(true,true,{month:'2026-05',hash:'changed'}),'server');
  assert.equal(await compute.prepareEngine(true,true,{month:'2026-05',hash:'same',configuration:'changed'}),'server');
  assert.equal(workers.length,0);
  assert.equal(await compute.prepareEngine(true,true,{month:'2026-05',hash:'same'}),'local_gpu');
  assert.equal(workers.length,1);assert.equal(workers[0].closed,true);
  behavior=(w,m)=>w.respond(m,{...device(),signature:'new-adapter-signature',adapter:'Another GPU'});
  assert.equal(await compute.prepareEngine(true,true,{month:'2026-05',hash:'same'}),'server');
});
test('optimizer whole-workflow comparisons cannot combine different or missing learning contexts',()=>{
  const before={context_hash:'same-data',benchmark_context_hash:'learning-A'};
  assert.equal(compute.sameOptimizerBenchmarkContext(before,{...before}),true);
  for(const after of [{context_hash:'changed-data',benchmark_context_hash:'learning-A'},{context_hash:'same-data',benchmark_context_hash:'learning-B'},{context_hash:'same-data'}])assert.equal(compute.sameOptimizerBenchmarkContext(before,after),false);
  assert.equal(compute.sameOptimizerBenchmarkContext({context_hash:'same-data'},{context_hash:'same-data'}),false);
});
test("frozen cross-language golden fixtures preserve scores and canonical winners",async()=>{
  const cases=JSON.parse(await readFile(new URL('../../backend/tests/fixtures/generation_numeric_goldens.json',import.meta.url),'utf8'));
  for(const fixture of cases){
    const input=protocol.scoreInput({rows:fixture.rows,ties:fixture.ties,...(fixture.kernel==='lexicographic'?{kernel:fixture.kernel,version:3}:{})});
    assert.deepEqual(protocol.numericScores(input),fixture.expected_scores,fixture.name);
    assert.equal(protocol.winnerFor(fixture.expected_scores,fixture.ties),fixture.expected_winner,fixture.name);
  }
});
test("numeric batch envelopes retain order, aggregate timings and reject changed devices",async()=>{
  reset();const input={...valid(),batches:[valid(),valid()]};let calls=0;
  const result=await compute.scoreFrame(input,async()=>({winner:calls++,scores:[36],gpu_ms:2,signature:'same'}));
  assert.deepEqual(result.selections,[0,1]);assert.equal(result.gpu_ms,4);
  await assert.rejects(compute.scoreFrame({...valid(),batches:[]},async()=>{}),/Invalid numeric batch/);
  calls=0;await assert.rejects(compute.scoreFrame(input,async()=>({winner:0,scores:[36],gpu_ms:1,signature:String(calls++)})),/GPU changed/);
});
