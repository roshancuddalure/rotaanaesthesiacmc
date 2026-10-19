import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const api = process.env.COMPUTE_TEST_API || "http://127.0.0.1:8019";
const report = { date: new Date().toISOString(), hardware: [], injected: [], workflows: [] };
const executablePath = process.env.MEMBER_TEST_BROWSER || chromium.executablePath();
const rawCall = async (page, message) => page.evaluate(async message => {
  const w = new Worker("/src/compute-worker.ts", { type: "module" });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Worker never answered")), 10000);
      w.onmessage = event => { clearTimeout(timer); resolve(event.data); };
      w.onerror = event => { clearTimeout(timer); reject(Error(event.message)); };
      w.postMessage(message);
    });
  } finally { w.terminate(); }
}, message);

function gpuFixture(kind) {
  return `
const trace={created:0,destroyed:0,unmapped:0,popped:0,adapters:0};
const originalPost=self.postMessage.bind(self);
self.postMessage=value=>originalPost({...value,trace:{...trace}});
const kind=${JSON.stringify(kind)};
let written;
const fakeDevice={
 limits:{maxStorageBufferBindingSize:kind==='limits'?4:4000000,maxBufferSize:4000000,maxComputeWorkgroupsPerDimension:65535,maxComputeInvocationsPerWorkgroup:256,maxComputeWorkgroupSizeX:256},
 lost:new Promise(()=>{}),destroy(){},addEventListener(){},pushErrorScope(){},
 async popErrorScope(){trace.popped++;return kind==='scope-error'&&trace.popped===2?{}:null;},
 createShaderModule(){return {};},async createComputePipelineAsync(){if(kind==='pipeline')throw Error('compile failure');return {getBindGroupLayout(){return {};}};},
 createBuffer(){
   if(kind==='allocation'&&trace.created===2)throw Error('out of memory');
   trace.created++;return {destroy(){trace.destroyed++;},unmap(){trace.unmapped++;},
     async mapAsync(){if(kind==='mapping')throw Error('mapping failed');},
     getMappedRange(){const result=[];for(let i=0;i<written.length;i+=9){let sum=0;for(let j=0;j<9;j++)sum+=written[i+j];result.push(kind==='parity'?0:sum);}return new Int32Array(result).buffer;}};
 },
 queue:{writeBuffer(_b,_o,data){written=data;},submit(){if(kind==='submit')throw Error('submission failed');}},
 createBindGroup(){return {};},createCommandEncoder(){return {beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},copyBufferToBuffer(){},finish(){return {};}};}
};
const fakeGPU={async requestAdapter(){trace.adapters++;if(kind==='no-adapter')return null;if(kind==='adapter-error')throw Error('driver failure');if(kind==='busy')await new Promise(resolve=>setTimeout(resolve,50));
 return {info:{vendor:'test',architecture:'test',description:'',device:'',isFallbackAdapter:kind==='software'},async requestDevice(){if(kind==='device-request')throw Error('request failed');return fakeDevice;}};}};
Object.defineProperty(navigator,'gpu',{value:kind==='unavailable'?undefined:fakeGPU});
if(kind==='insecure')Object.defineProperty(self,'isSecureContext',{value:false});
`;
}

// Run actual shader workloads on the browser default and NVIDIA-selected browser.
for (const mode of ["default", "nvidia"]) {
  const browser = await chromium.launch({ executablePath, headless: true, args: mode === "nvidia" ? ["--force-high-performance-gpu"] : [] });
  try {
    const page = await browser.newPage(); await page.goto(base);
    const result = await page.evaluate(async () => {
      const { ComputeWorker } = await import("/src/compute-device.ts");
      const w = new ComputeWorker();
      try {
        const test = await w.call("test"), batches = [];
        for (const length of [1, 63, 64, 65, 513, 10000, 100000]) {
          const rows = Array.from({ length }, (_, i) => Array.from({ length: 9 }, (_, j) => (i * 29 + j * 7) % 1001));
          const ties = rows.map((_, i) => length - i);
          const result = await w.call("score", { rows, ties });
          const expected = rows.map(row => row.reduce((a, b) => a + b, 0));
          if (JSON.stringify(result.scores) !== JSON.stringify(expected)) throw Error("Hardware score mismatch");
          batches.push({ rows: length, gpu_ms: result.gpu_ms, parity: true });
        }
        const boundary = await w.call("score", { rows: [[2147483647, ...Array(8).fill(0)], [2147483647, ...Array(8).fill(0)]], ties: [1, 0] });
        if (boundary.winner !== 1 || boundary.scores.some(n => n !== 2147483647)) throw Error("Integer boundary mismatch");
        const repeated = [];
        for (let i = 0; i < 30; i++) repeated.push((await w.call("score", { rows: [Array(9).fill(i)], ties: [0] })).scores[0]);
        if (repeated.some((n, i) => n !== i * 9)) throw Error("Repeated execution mismatch");
        const preferences = [];
        for (const power of ["default", "high-performance", "low-power"]) {
          const p = new ComputeWorker(power); try { const t = await p.call("test"); preferences.push({ requested: power, actual: t.vendor, parity: t.parity }); } finally { p.close(); }
        }
        return { test, batches, integer_boundary: true, repeated_batches: repeated.length, preferences };
      } finally { w.close(); }
    });
    if (mode === "nvidia") assert.match(result.test.vendor, /nvidia/i);
    assert.equal(result.test.software, false);
    report.hardware.push({ mode, browser: browser.version(), ...result });
  } finally { await browser.close(); }
}

const browser = await chromium.launch({ executablePath, headless: true });
try {
  for (const [kind, expected, destroyed] of [
    ["insecure", "insecure", 0], ["unavailable", "unavailable", 0], ["no-adapter", "no-adapter", 0],
    ["adapter-error", "gpu-error", 0], ["device-request", "gpu-error", 0], ["pipeline", "gpu-error", 0],
    ["limits", "limits", 0], ["allocation", "gpu-error", 2], ["mapping", "gpu-error", 3],
    ["submit", "gpu-error", 3], ["scope-error", "gpu-error", 3], ["parity", "parity", 3],
    ["software", null, 3], ["success", null, 3],
  ]) {
    const page = await browser.newPage();
    await page.route("**/src/compute-worker.ts*", async route => {
      const response = await route.fetch(); await route.fulfill({ response, body: gpuFixture(kind) + await response.text() });
    });
    await page.goto(base);
    const result = await rawCall(page, { id: 1, type: "test", preference: "high-performance" });
    assert.equal(result.error?.code || null, expected, JSON.stringify(result));
    assert.equal(result.trace.destroyed, destroyed, kind);
    if (kind === "success") assert.equal(result.trace.unmapped, 1);
    if (kind === "software") assert.equal(result.result.software, true);
    report.injected.push({ kind, error: result.error?.code || null, ...result.trace }); await page.close();
  }
  // Exercise worker-side validation independently of the main-thread guard.
  for (const invalid of [null, {}, { id: 1, type: "execute", preference: "default" }, { id: 1, type: "test", preference: "nvidia" },
    { id: 1, type: "score", preference: "default", rows: [Array(9).fill(0)], ties: [] }]) {
    const page = await browser.newPage(); await page.goto(base);
    const response = await rawCall(page, invalid); assert.ok(["protocol", "invalid-input"].includes(response.error.code));
    report.injected.push({ kind: "malformed-request", error: response.error.code }); await page.close();
  }
  const busy = await browser.newPage();
  await busy.route("**/src/compute-worker.ts*", async route => {
    const response = await route.fetch(); await route.fulfill({ response, body: gpuFixture("busy") + await response.text() });
  });
  await busy.goto(base);
  const overlap = await busy.evaluate(async () => {
    const w = new Worker("/src/compute-worker.ts", { type: "module" });
    try { return await new Promise((resolve, reject) => {
      const messages = [], timer = setTimeout(() => reject(Error("overlap hung")), 5000);
      w.onmessage = event => { messages.push(event.data); if (messages.length === 2) { clearTimeout(timer); resolve(messages); } };
      w.postMessage({ id: 1, type: "test", preference: "default" }); w.postMessage({ id: 2, type: "test", preference: "default" });
    }); } finally { w.terminate(); }
  });
  assert.equal(overlap.find(m => m.id === 2).error.code, "busy"); assert.equal(overlap.find(m => m.id === 1).result.parity, true);
  report.injected.push({ kind: "overlap", bounded: true }); await busy.close();

  // Integrated proposal recovery. Fixture contains disposable members and no real assignments.
  for (const kind of ["one-loss", "repeated-loss", "malformed-result", "backend-rejection", "network-loss", "rate-limited", "score-timeout", "worker-crash"]) {
    console.log(`Checking recovery workflow: ${kind}`);
    await fetch(`${api}/__fixture/reset`, { method: "POST" });
    const page = await browser.newPage({ viewport: { width: 390, height: 850 } }); const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    let workers = 0, rejected = false;
    await page.route("**/src/compute-worker.ts*", async route => {
      const workerIndex = ++workers, response = await route.fetch(); let code = await response.text();
      if (kind === "repeated-loss" || (kind === "one-loss" && workerIndex === 2)) code += `\nconst original=self.onmessage;self.onmessage=e=>e.data.type==='score'?self.postMessage({id:e.data.id,error:{code:'device-lost',message:'Injected device loss'}}):original(e);`;
      if (kind === "malformed-result") code += `\nconst original=self.onmessage;self.onmessage=e=>e.data.type==='score'?self.postMessage({id:e.data.id,result:{winner:999999,scores:[],gpu_ms:1,signature:'invalid'}}):original(e);`;
      if (kind === "score-timeout") code += `\nconst original=self.onmessage;self.onmessage=e=>{if(e.data.type!=='score')original(e);};`;
      if (kind === "worker-crash") code += `\nconst original=self.onmessage;self.onmessage=e=>{if(e.data.type==='score')throw Error('Injected worker crash');else original(e);};`;
      await route.fulfill({ response, body: code });
    });
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), data = request.postDataJSON();
      if (!rejected && url.pathname.endsWith("/step") && (kind === "backend-rejection" && data?.selection !== undefined || kind === "rate-limited")) {
        rejected = true; return route.fulfill({ status: kind === "rate-limited" ? 429 : 422, json: { detail: kind === "rate-limited" ? "Compute request budget exhausted. Wait briefly, then resume your proposal." : "Injected ranking disagreement" } });
      }
      const response = await route.fetch({ url: api + url.pathname + url.search });
      if (!rejected && kind === "network-loss" && url.pathname.endsWith("/step")) { rejected = true; return route.abort("failed"); }
      await route.fulfill({ response });
    });
    await page.goto(base);
    await page.evaluate(async () => {
      const m = await import("/src/compute-device.ts"); m.resetPreference();
      m.savePreference({ enabled: true, mode: "local_gpu", power: "high-performance" });
      await (await import("/src/rota-compute.ts")).openRotaCompute("2026-05", true, () => {});
    });
    await page.locator("[data-generate]").click();
    if (kind === "rate-limited") {
      await page.getByText("You can retry or resume", { exact: false }).waitFor();
      await page.locator("[data-resume]").click();
    }
    try { await page.getByText("Draft ready for review.", { exact: false }).waitFor({ timeout: 45000 }); }
    catch (error) { console.error(kind, await page.locator('dialog').innerText()); throw error; }
    const jobs = await (await fetch(`${api}/api/v1/rota-compute/jobs?month=2026-05`)).json();
    if (["repeated-loss", "malformed-result", "backend-rejection", "score-timeout", "worker-crash"].includes(kind)) assert.equal(jobs[0].engine, "server");
    else assert.equal(jobs[0].engine, "local_gpu");
    if (kind === "one-loss") assert.equal(workers, 3); if (kind === "repeated-loss") assert.equal(workers, 3);
    const state = await (await fetch(`${api}/__fixture`)).json(); assert.equal(state.assignments, 0);
    assert.equal(await page.locator("[data-apply]").isDisabled(), true); assert.deepEqual(errors, []);
    await page.locator("[data-cancel]").click(); await page.getByText("Proposal cancelled.", { exact: false }).waitFor();
    report.workflows.push({ kind, workers, engine: jobs[0].engine, assignments: state.assignments }); await page.close();
  }
} finally { await browser.close(); }
await mkdir("../docs/benchmarks", { recursive: true });
await writeFile("../docs/benchmarks/webgpu_recovery.json", JSON.stringify(report, null, 2) + "\n");
console.log(`Passed: ${report.hardware.length} hardware runs, ${report.injected.length} worker fault cases, ${report.workflows.length} recovery workflows.`);
