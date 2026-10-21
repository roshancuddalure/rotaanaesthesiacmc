import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.env.COMPUTE_PRODUCTION_URL || "http://127.0.0.1:8021";
const browser = await chromium.launch({ headless: true, executablePath: process.env.MEMBER_TEST_BROWSER || chromium.executablePath() });
const report = { date: new Date().toISOString(), workflows: [] };
try {
  for (const width of [1280, 390, 320]) {
    await fetch(base + "/__fixture/reset", { method: "POST" });
    const page = await browser.newPage({ viewport: { width, height: 850 } }); const errors = [], blocked = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem("duty_rota_auth_token", "disposable"));
    const response = await page.goto(base);
    assert.match(response.headers()["content-security-policy"], /worker-src 'self'/);
    await page.getByRole("heading", { name: "Duty workload at a glance", exact: true }).waitFor();
    await page.locator('[data-view="compute-settings"]').first().evaluate(b => b.click());
    await page.locator(".compute-settings h2").waitFor();
    await page.locator("[data-compute-power]").selectOption("default");
    await page.locator("[data-compute-test]").click();
    await page.getByText("Device test passed.", { exact: false }).waitFor();
    await page.getByText("Browser-selected GPU:", { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const download = page.waitForEvent("download"); await page.locator("[data-compute-diagnostics]").click();
    assert.equal((await download).suggestedFilename(), "rota-gpu-diagnostics.json");
    await page.locator("[data-compute-enable]").check(); await page.locator("[data-compute-mode]").selectOption("local_gpu");
    const templateLoaded = page.waitForResponse(r => r.url().includes('/api/v1/rota-template/month'));
    await page.locator('[data-view="rota-template"]').first().evaluate(b => b.click()); await templateLoaded;
    await page.getByText('Template Generation Settings', { exact: true }).waitFor();
    await page.locator("#working-month").fill("2026-05"); await page.locator("#working-month").dispatchEvent("change");
    await page.locator("#run-safe-auto-fill").click(); await page.locator("[data-quick]").click(); await page.locator("[data-generate]").click();
    await page.getByText("Draft ready for review.", { exact: false }).waitFor();
    assert.equal(await page.locator("[data-apply]").isDisabled(), true);
    const state = await (await fetch(base + "/__fixture")).json(); assert.equal(state.assignments, 0);
    const jobs = await (await fetch(base + "/api/v1/rota-compute/jobs?month=2026-05")).json(); assert.equal(jobs[0].engine, "local_gpu");
    await page.locator("[data-cancel]").click(); await page.getByText("Proposal cancelled.", { exact: false }).waitFor();
    await page.locator('[data-close]').click();
    await fetch(base+'/__fixture/template',{method:'POST'});
    await page.reload();await page.getByRole('heading',{name:'Duty workload at a glance',exact:true}).waitFor();
    await page.locator('[data-view="rota-template"]').first().evaluate(b=>b.click());
    await page.getByText('Template Generation Settings',{exact:true}).waitFor();
    await page.locator('.template-settings-panel > summary').click();
    await page.locator('#template-start').fill('2026-05-01');await page.locator('#template-end').fill('2026-05-04');
    await page.locator('#generate-rota-template').click();
    await page.getByRole('heading',{name:'Preview template allocation',exact:true}).waitFor();
    await page.locator('[data-generate]').click();await page.getByText('Draft ready for review.',{exact:false}).waitFor({timeout:60000});
    const templateJobs=await(await fetch(base+'/api/v1/rota-compute/jobs?month=2026-05')).json();
    assert.equal(templateJobs[0].kind,'template');assert.equal(templateJobs[0].engine,'local_gpu');
    assert.equal((await(await fetch(base+'/__fixture/generation')).json()).slots,0);
    assert.equal(await page.locator('[data-apply]').isDisabled(),true);
    await page.locator('[data-cancel]').click();await page.getByText('Proposal cancelled.',{exact:false}).waitFor();
    const workerPath = await page.evaluate(async () => {
      const html = await (await fetch("/")).text(); const script = html.match(/src="([^"]+\.js)"/)[1];
      const js = await (await fetch(script)).text(); return "/assets/" + js.match(/compute-worker-[\w-]+\.js/)[0];
    });
    const workerHeaders = (await fetch(base + workerPath)).headers;
    assert.match(workerHeaders.get("content-security-policy"), /connect-src 'none'/);
    // A worker fetch to even the same origin is denied by the worker response's CSP.
    await page.route("**/assets/compute-worker-*.js", async route => {
      const original = await route.fetch(); await route.fulfill({ response: original,
        body: "fetch('/api/health').then(()=>self.postMessage({unexpected:true})).catch(()=>self.postMessage({blocked:true}));" });
    });
    const workerDenied = await page.evaluate(async path => {
      const worker = new Worker(path, { type: "module" });
      try { return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("Worker CSP check hung")), 5000);
        worker.onmessage = e => { clearTimeout(timer); resolve(e.data); };
      }); } finally { worker.terminate(); }
    }, workerPath);
    assert.equal(workerDenied.blocked, true);
    const denied = await page.evaluate(async () => {
      try { await fetch("https://untrusted.example/gpu"); return false; } catch { return true; }
    }); assert.equal(denied, true);
    assert.deepEqual(errors, []);
    report.workflows.push({ width, gpu_generation: true,template_gpu_generation:true, review_required: true, assignments: 0,template_slots_before_apply:0, worker_network_blocked: true, external_network_blocked: true });
    await page.close();
  }
  if (process.env.COMPUTE_PREVIEW_URL) {
    const preview = process.env.COMPUTE_PREVIEW_URL;
    const htmlResponse = await fetch(preview); assert.match(htmlResponse.headers.get('content-security-policy'), /worker-src 'self'/);
    const html = await htmlResponse.text(), script = html.match(/src="([^"]+\.js)"/)[1];
    const bundle = await (await fetch(preview + script)).text(), path = '/assets/' + bundle.match(/compute-worker-[\w-]+\.js/)[0];
    assert.match((await fetch(preview + path)).headers.get('content-security-policy'), /connect-src 'none'/);
    const page = await browser.newPage(); await page.goto(preview);
    const response = await page.evaluate(async path => {
      const worker = new Worker(path, {type:'module'});
      try {return await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Preview GPU timed out')),15000);
        worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};
        worker.postMessage({id:1,type:'test',preference:'default'});
      });}finally{worker.terminate();}
    },path);
    assert.equal(response.result.parity,true); report.preview={gpu_parity:true,worker_csp:true}; await page.close();
  }
} finally { await browser.close(); }
await writeFile("../docs/benchmarks/webgpu_production.json", JSON.stringify(report, null, 2) + "\n");
console.log("3 production build/CSP/mobile generation workflows passed.");
