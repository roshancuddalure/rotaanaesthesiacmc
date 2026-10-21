// Generator conflicts and engine choice, with mocked APIs:
// - another stage's proposal blocks this one -> Resume / Cancel offered in the same window;
// - cancel then continues to the requested stage; resume opens the other stage's generator;
// - a 409 from another operator explains who owns it and offers no cancel;
// - "Where to compute" is visible and saves this browser's choice; Compute Settings shows setup steps.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const browser = await chromium.launch({ headless: true, executablePath: process.env.MEMBER_TEST_BROWSER || chromium.executablePath() });
const context = await browser.newContext({ viewport: { width: 390, height: 860 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));

const templateJob = { id: "tpl-1", month: "2026-05", status: "running", engine: "server", revision: 3, processed: 12, total: 40,
  proposed: 10, unresolved: 0, decisions: [], kind: "template", requested_engine: "server", context_hash: "h",
  template: { options: { duty_keys: ["MAIN_1ST_24HR"] }, summary: {} }, metrics: { planning_ms: 10, steps: 1 },
  burden: null, created_at: "2026-10-21T08:00:00Z" };
let jobs = [templateJob];
let cancelled = [];
let startResponse = null;
await page.route("**/__conflict", r => r.fulfill({ contentType: "text/html",
  body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>t</title><link rel="stylesheet" href="/src/styles.css"></head><body><main id="host"><button data-view="compute-settings">Compute Settings</button></main></body></html>' }));
await page.route("**/api/**", async r => {
  const url = new URL(r.request().url());
  const method = r.request().method();
  const json = (body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.pathname.endsWith("/rota-compute/capabilities"))
    return json({ enabled: true, browser_gpu: true, template_compute: true, template_gpu: true, optimizer_gpu: true, context_hash: "h",
      workload_estimates: { members_rows: 500, template_rows: 500, optimizer_rows: 500, units: 3 } });
  if (url.pathname.endsWith("/rota-compute/jobs") && method === "GET") return json(jobs);
  const cancel = url.pathname.match(/\/rota-compute\/jobs\/([^/]+)\/cancel$/);
  if (cancel) { cancelled.push(cancel[1]); jobs = jobs.map(j => j.id === cancel[1] ? { ...j, status: "cancelled" } : j); return json(jobs.find(j => j.id === cancel[1])); }
  if (url.pathname.endsWith("/rota-compute/jobs") && method === "POST") return startResponse ? json(...startResponse) : json({ detail: "unexpected" }, 500);
  const one = url.pathname.match(/\/rota-compute\/jobs\/([^/]+)$/);
  if (one) return json(jobs.find(j => j.id === one[1]));
  if (url.pathname.endsWith("/rota-intelligence/setup")) return json({ people: [], slots: [], holiday_dates: [] });
  return json({ detail: `unmocked ${url.pathname}` }, 404);
});
await page.goto(base + "/__conflict");
const open = (kind) => page.evaluate(async kind => {
  const m = await import("/src/rota-compute.ts");
  if (kind === "template") await m.openRotaCompute("2026-05", true, () => {}, { duty_keys: ["MAIN_1ST_24HR"] });
  else if (kind === "intelligent") await (await import("/src/rota-intelligence.ts")).openIntelligentRota("2026-05", true, () => {});
  else await m.openRotaCompute("2026-05", true, () => {});
}, kind);
const axe = async () => {
  const result = await new AxeBuilder({ page }).include("dialog").analyze();
  assert.deepEqual(result.violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id), []);
};

// 1. Members generator blocked by an active template proposal: options are right there.
await page.evaluate(() => localStorage.clear());
await open("members");
const dialog = page.locator("dialog[open]");
await dialog.getByRole("heading", { name: "Another proposal is in progress" }).waitFor();
assert.match(await dialog.innerText(), /Build template \(unit allocation\)/);
assert.match(await dialog.innerText(), /Paused at 12 of 40 duties/);
await dialog.getByRole("button", { name: "Resume it" }).waitFor();
await axe();
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal scroll at 390px");

// 2. Cancel asks for confirmation, can be kept, then cancels and continues to the requested stage.
await dialog.getByRole("button", { name: "Cancel it" }).click();
await dialog.getByText(/Saved duties and assignments are not changed/).waitFor();
await dialog.getByRole("button", { name: "Keep it" }).click();
assert.deepEqual(cancelled, []);
await dialog.getByRole("button", { name: "Cancel it" }).click();
await dialog.getByRole("button", { name: /Yes, discard it and start Autoassign members/ }).click();
await page.locator("dialog[open]").getByRole("heading", { name: "Autoassign members - quick safe fill" }).waitFor();
assert.deepEqual(cancelled, ["tpl-1"]);

// 3. "Where to compute" is visible in the generator and saves this browser's choice.
const engine = page.locator("dialog[open] fieldset.compute-engine");
await engine.getByText("Where to compute").waitFor();
assert.equal(await engine.locator('input[value="server"]').isChecked(), true, "server is the default");
await engine.getByText("This computer's GPU — pilot").click();
assert.equal(await engine.locator('input[value="local_gpu"]').isChecked(), true);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("duty_rota_compute_device_v1")));
assert.equal(saved.enabled, true); assert.equal(saved.mode, "local_gpu");
await engine.getByText("Server", { exact: true }).click();
assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem("duty_rota_compute_device_v1")))).mode, "server");
await axe();

// 4. A start refused because someone else's proposal exists: owner shown, no cancel offered.
startResponse = [{ detail: { code: "proposal_exists", message: "A proposal already exists for this month. Resume or cancel it.",
  job_id: "other-1", month: "2026-05", status: "completed", kind: "members", processed: 40, total: 40, owned: false, operator_name: "Dr Other" } }, 409];
await page.locator("dialog[open] [data-generate]").click();
await page.locator("dialog[open]").getByText(/started by Dr Other/).waitFor();
assert.match(await page.locator("dialog[open]").innerText(), /Ask Dr Other to cancel it/);
assert.equal(await page.locator("dialog[open] [data-conflict-ask]").count(), 0);
await page.locator("dialog[open] [data-close]").click();

// 5. Resume opens the blocking stage's own generator (template, with its saved options).
jobs = [{ ...templateJob, status: "running" }];
await open("intelligent");
await page.locator("dialog[open]").getByRole("heading", { name: "Another proposal is in progress" }).waitFor();
await page.locator("dialog[open]").getByRole("button", { name: "Resume it" }).click();
await page.locator("dialog[open]").getByRole("heading", { name: "Preview template allocation" }).waitFor();
await page.locator("dialog[open] [data-resume]").waitFor();
await page.locator("dialog[open] [data-close]").click();

// 6. The Compute Settings shortcut in the generator navigates there.
jobs = [];
await open("members");
await page.locator("dialog[open] [data-open-compute-settings]").click();
assert.equal(await page.locator("dialog[open]").count(), 0);

// 7. Compute Settings shows what is in use and the setup steps.
await page.evaluate(async () => { const host = document.querySelector("#host"); await (await import("/src/rota-compute.ts")).renderComputeSettings(host); });
await page.getByText(/Generation on this browser uses: Server/).waitFor();
assert.match(await page.locator(".compute-steps").innerText(), /Allow GPU computation on this browser/);
await page.locator("[data-compute-enable]").check();
await page.locator("[data-compute-mode]").selectOption("local_gpu");
await page.getByText(/uses: This computer's GPU/).waitFor();

assert.deepEqual(errors, []);
await browser.close();
console.log("compute conflict + engine choice: all checks passed");
