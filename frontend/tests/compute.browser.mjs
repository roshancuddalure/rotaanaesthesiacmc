import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const api = process.env.COMPUTE_TEST_API || "http://127.0.0.1:8019";
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.MEMBER_TEST_BROWSER || chromium.executablePath() });
let passed = 0;
const report = {};
const reset = () => fetch(`${api}/__fixture/reset`, { method: "POST" });
const fixture = async () => (await fetch(`${api}/__fixture`)).json();
async function pageAt(width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 850 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/__compute-test", route => route.fulfill({ contentType: "text/html",
    body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><button id="opener">Open</button><main id="host"></main></body></html>' }));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: api + url.pathname + url.search });
    await route.fulfill({ response });
  });
  await page.goto(base + "/__compute-test");
  return { page, errors };
}
try {
  await reset();
  const { page } = await pageAt();
  report.gpu = await page.evaluate(async () => {
    const { ComputeWorker } = await import("/src/compute-device.ts");
    const worker = new ComputeWorker();
    try {
      const test = await worker.call("test");
      const batches = [];
      for (const length of [1, 64, 513, 10000]) {
        const rows = Array.from({ length }, (_, i) => Array.from({ length: 9 }, (_, j) => (i * 31 + j * 7) % 1999));
        const expected = rows.map(row => row.reduce((a, b) => a + b, 0));
        const ties = rows.map((_, i) => length - i);
        const result = await worker.call("score", { rows, ties });
        if (JSON.stringify(result.scores) !== JSON.stringify(expected)) throw Error("Exact GPU score parity failed");
        const winner = expected.map((score, index) => ({ score, index })).sort((a, b) => a.score - b.score || ties[a.index] - ties[b.index])[0].index;
        if (result.winner !== winner) throw Error("GPU tie-breaking differed");
        batches.push({ length, gpu_ms: result.gpu_ms });
      }
      let rejected = false;
      try { await worker.call("score", { rows: [[2147483647, 1, 0, 0, 0, 0, 0, 0, 0]], ties: [0] }); }
      catch { rejected = true; }
      if (!rejected) throw Error("Overflow was not rejected");
      return { ...test, batches, overflow_rejected: true };
    } finally { worker.close(); }
  });
  passed++;
  await page.evaluate(async () => {
    const m = await import("/src/compute-device.ts");
    m.resetPreference();
    if (m.selectedEngine(true, true, { month: "2026-05", hash: "same" }) !== "server") throw Error("Must default to server");
    const worker = new m.ComputeWorker(); const test = await worker.call("test"); worker.close();
    const p = { enabled: true, mode: "auto", power: "high-performance", test: { ...test, software: false },
      proof: { server_ms: 1000, local_ms: 700, parity: true, at: Date.now(), version: 2, adapter: test.adapter, signature: test.signature,
        browser: navigator.userAgent, month: "2026-05", context_hash: "same" } };
    m.savePreference(p);
    m.rememberTest(p.test);
    if (m.selectedEngine(true, true, { month: "2026-05", hash: "same" }) !== "local_gpu" || m.selectedEngine(false, true) !== "server") throw Error("Mode gating failed");
    p.proof.at -= 8 * 86400000; m.savePreference(p);
    if (m.selectedEngine(true, true, { month: "2026-05", hash: "same" }) !== "server") throw Error("Expired benchmark accepted");
    p.proof.at = Date.now(); p.proof.parity = false; m.savePreference(p);
    if (m.selectedEngine(true, true, { month: "2026-05", hash: "same" }) !== "server") throw Error("Failed parity accepted");
    p.mode = "local_gpu"; p.test.software = true; m.savePreference(p);
    if (m.selectedEngine(true, true, { month: "2026-05", hash: "same" }) !== "server") throw Error("Software adapter accepted as acceleration");
    m.resetPreference();
  });
  passed++;
  await page.close();
  for (const width of [1280, 390, 320]) {
    await reset();
    const { page, errors } = await pageAt(width);
    await page.evaluate(async () => {
      const { renderComputeSettings } = await import("/src/rota-compute.ts");
      await renderComputeSettings(document.querySelector("#host"));
    });
    await page.getByRole("button", { name: "Test Device", exact: true }).click();
    await page.getByText("Device test passed.", { exact: false }).waitFor();
    await page.locator("[data-compute-enable]").check();
    await page.locator("[data-compute-mode]").selectOption("server");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(async () => {
      const { openRotaCompute } = await import("/src/rota-compute.ts");
      await openRotaCompute("2026-05", true, () => { window.applied = true; });
    });
    await page.getByRole("button", { name: "Generate proposal", exact: true }).click();
    await page.getByText("Draft ready for review.", { exact: false }).waitFor();
    assert.equal((await fixture()).assignments, 0);
    assert.equal(await page.locator("[data-apply]").isDisabled(), true);
    if (width < 700) assert.equal(await page.locator("dialog .table-scroll").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    if (width === 390) {
      const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-download]").click()]);
      assert.equal(download.suggestedFilename(), "rota-compute-2026-05.json");
    }
    await page.locator("[data-review-confirm]").check();
    if (width === 390) await page.screenshot({ path: "tests/artifacts/compute-review-mobile.png" });
    await page.locator("[data-apply]").click();
    await page.getByText("2 assignments applied", { exact: false }).waitFor();
    assert.equal((await fixture()).assignments, 2);
    assert.equal(await page.evaluate(() => window.applied), true);
    assert.deepEqual(errors, []);
    passed++;
    await page.close();
  }
  await reset();
  const local = await pageAt();
  await local.page.evaluate(async () => {
    const m = await import("/src/compute-device.ts"); const w = new m.ComputeWorker();
    const test = await w.call("test"); w.close();
    // Directly exercise the local pilot even when the CI adapter is software.
    m.savePreference({ enabled: true, mode: "local_gpu", test: { ...test, software: false } });
    const { openRotaCompute } = await import("/src/rota-compute.ts");
    await openRotaCompute("2026-05", true, () => {});
  });
  await local.page.getByRole("button", { name: "Generate proposal", exact: true }).click();
  await local.page.getByText("Draft ready for review.", { exact: false }).waitFor();
  assert.equal((await fixture()).assignments, 0);
  await local.page.locator("[data-close]").click();
  await local.page.evaluate(async () => (await import("/src/rota-compute.ts")).openRotaCompute("2026-05", true, () => {}));
  await local.page.locator("[data-cancel]").click();
  await local.page.getByText("Proposal cancelled.", { exact: false }).waitFor();
  assert.equal((await fixture()).assignments, 0);
  assert.deepEqual(local.errors, []); passed++;
  await local.page.close();
  // A GPU failure while a frame is pending must visibly fall back and still produce a review.
  await reset();
  const failure = await pageAt(390);
  await failure.page.evaluate(async () => {
    const m = await import("/src/compute-device.ts");
    m.savePreference({ enabled: true, mode: "local_gpu", test: { supported: true, software: false, adapter: "test", parity: true } });
    m.ComputeWorker.prototype.call = async () => { throw Error("Injected GPU loss"); };
    await (await import("/src/rota-compute.ts")).openRotaCompute("2026-05", true, () => {});
  });
  await failure.page.getByRole("button", { name: "Generate proposal", exact: true }).click();
  await failure.page.getByText("Draft ready for review.", { exact: false }).waitFor();
  const jobs = await fixture();
  assert.equal(jobs.assignments, 0); assert.equal(jobs.jobs[0].status, "completed");
  assert.deepEqual(failure.errors, []); passed++;
  await failure.page.close();
  await reset();
  const comparison = await pageAt(390);
  await comparison.page.evaluate(async () => {
    await (await import("/src/rota-compute.ts")).renderComputeSettings(document.querySelector("#host"));
  });
  await comparison.page.locator("[data-compute-enable]").check();
  await comparison.page.locator("[data-compute-month]").fill("2026-05");
  await comparison.page.getByRole("button", { name: "Test Device", exact: true }).click();
  await comparison.page.getByText("Device test passed.", { exact: false }).waitFor();
  await comparison.page.locator("[data-compute-compare]").click();
  await comparison.page.getByText("Comparison complete.", { exact: false }).waitFor();
  report.end_to_end_comparison = await comparison.page.evaluate(async () => {
    const m = await import("/src/compute-device.ts");
    const proof = m.preference().proof;
    m.savePreference({ ...m.preference(), mode: "auto" });
    const selected = m.selectedEngine(true, true, { month: proof.month, hash: proof.context_hash });
    if (!proof.parity) throw Error("End-to-end decisions differed");
    if (selected === "local_gpu" && proof.local_ms > proof.server_ms * 0.8) throw Error("Slower GPU selected");
    if (m.selectedEngine(true, true, { month: proof.month, hash: "changed" }) !== "server") throw Error("Stale benchmark accepted");
    return { ...proof, selected };
  });
  assert.equal((await fixture()).assignments, 0);
  assert.equal((await fixture()).jobs.filter(j => j.status === "cancelled").length, 6);
  await comparison.page.screenshot({ path: "tests/artifacts/compute-settings-mobile.png" });
  assert.deepEqual(comparison.errors, []); passed++;
  await comparison.page.close();
  await reset();
  const integrated = await pageAt();
  await integrated.page.addInitScript(() => localStorage.setItem("duty_rota_auth_token", "disposable"));
  await integrated.page.goto(base);
  await integrated.page.getByRole("heading", { name: "Duty workload at a glance", exact: true }).waitFor();
  await integrated.page.locator('[data-view="compute-settings"]').first().evaluate(button => button.click());
  await integrated.page.locator(".compute-settings h2").waitFor();
  await integrated.page.locator('[data-view="rota-template"]').first().evaluate(button => button.click());
  await integrated.page.locator("#working-month").fill("2026-05");
  await integrated.page.locator("#working-month").dispatchEvent("change");
  await integrated.page.locator("#run-safe-auto-fill").click();
  await integrated.page.getByRole("heading", { name: "Generate and review rota draft", exact: true }).waitFor();
  assert.deepEqual(integrated.errors, []); passed++;
  await integrated.page.close();
  // Resume a genuinely pending local frame in a fresh page, then cancel without writes.
  await reset();
  const pending = await (await fetch(`${api}/api/v1/rota-compute/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: "2026-05", engine: "local_gpu" }) })).json();
  const prepared = await (await fetch(`${api}/api/v1/rota-compute/jobs/${pending.id}/step`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: 0 }) })).json();
  assert.equal(prepared.status, "running"); assert.ok(prepared.frame.rows.length);
  const resumed = await pageAt(320);
  await resumed.page.evaluate(async () => (await import("/src/rota-compute.ts")).openRotaCompute("2026-05", true, () => {}));
  await resumed.page.getByRole("button", { name: "Continue generation", exact: true }).click();
  await resumed.page.getByText("Draft ready for review.", { exact: false }).waitFor();
  await resumed.page.locator("[data-cancel]").click();
  await resumed.page.getByText("Proposal cancelled.", { exact: false }).waitFor();
  assert.equal((await fixture()).assignments, 0);
  assert.deepEqual(resumed.errors, []); passed++;
  await resumed.page.close();
  // Simulate a missing browser GPU API without changing the production worker.
  await reset();
  const unsupported = await pageAt();
  await unsupported.page.route("**/src/compute-worker.ts*", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: 'Object.defineProperty(navigator,"gpu",{value:undefined});\n' + await response.text() });
  });
  await unsupported.page.evaluate(async () => {
    const m = await import("/src/compute-device.ts");
    m.savePreference({ enabled: true, mode: "local_gpu", test: { supported: true, software: false, adapter: "test", parity: true } });
    await (await import("/src/rota-compute.ts")).openRotaCompute("2026-05", true, () => {});
  });
  await unsupported.page.locator("[data-generate]").click();
  await unsupported.page.getByText("Draft ready for review.", { exact: false }).waitFor();
  assert.equal((await (await fetch(`${api}/api/v1/rota-compute/jobs?month=2026-05`)).json())[0].engine, "server");
  assert.equal((await fixture()).assignments, 0); passed++;
  await unsupported.page.close();
  // A worker that never answers must time out, release its resources and fall back.
  await reset();
  const timeout = await pageAt();
  await timeout.page.route("**/src/compute-worker.ts*", route => route.fulfill({ contentType: "text/javascript", body: "self.onmessage = () => {};" }));
  await timeout.page.evaluate(async () => {
    const m = await import("/src/compute-device.ts");
    m.savePreference({ enabled: true, mode: "local_gpu", test: { supported: true, software: false, adapter: "test", parity: true } });
    await (await import("/src/rota-compute.ts")).openRotaCompute("2026-05", true, () => {});
  });
  await timeout.page.locator("[data-generate]").click();
  await timeout.page.getByText("Draft ready for review.", { exact: false }).waitFor();
  assert.equal((await fixture()).assignments, 0); passed++;
  await timeout.page.close();
  await reset();
  const interrupted = await pageAt();
  let lost = false;
  await interrupted.page.route("**/api/v1/rota-compute/jobs/*/step", async route => {
    if (lost) { const response = await route.fetch({ url: api + new URL(route.request().url()).pathname }); await route.fulfill({ response }); return; }
    lost = true;
    await route.fetch({ url: api + new URL(route.request().url()).pathname });
    await route.abort("failed");
  });
  await interrupted.page.evaluate(async () => (await import("/src/rota-compute.ts")).openRotaCompute("2026-05", true, () => {}));
  await interrupted.page.locator("[data-generate]").click();
  await interrupted.page.getByText("Draft ready for review.", { exact: false }).waitFor();
  assert.equal((await fixture()).assignments, 0);
  await interrupted.page.locator("[data-close]").click();
  await interrupted.page.evaluate(async () => (await import("/src/rota-compute.ts")).openRotaCompute("2026-05", true, () => {}));
  await interrupted.page.locator("[data-review-confirm]").waitFor();
  assert.equal((await fixture()).jobs.length, 1);
  assert.deepEqual(interrupted.errors, []); passed++;
  await interrupted.page.close();
  // Another tab may apply the same reviewed draft before this tab's Cancel arrives.
  await reset();
  const raced = await pageAt();
  await raced.page.evaluate(async () => (await import("/src/rota-compute.ts")).openRotaCompute("2026-05", true, () => {}));
  await raced.page.locator("[data-generate]").click();
  await raced.page.getByText("Draft ready for review.", { exact: false }).waitFor();
  const current = (await (await fetch(`${api}/api/v1/rota-compute/jobs?month=2026-05`)).json())[0];
  const applied = await fetch(`${api}/api/v1/rota-compute/jobs/${current.id}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: current.revision }) });
  assert.equal(applied.status, 200);
  await raced.page.locator("[data-cancel]").click();
  await raced.page.getByText("This draft was already applied.", { exact: false }).waitFor();
  assert.equal((await fixture()).assignments, 2);
  assert.deepEqual(raced.errors, []); passed++;
  await raced.page.close();
  await mkdir("../docs/benchmarks", { recursive: true });
  report.workflows = passed;
  await writeFile("../docs/benchmarks/rota_compute_browser.json", JSON.stringify(report, null, 2) + "\n");
  console.log(`${passed} compute browser workflows passed; GPU adapter: ${report.gpu.adapter}; software: ${report.gpu.software}`);
} finally { await browser.close(); }
