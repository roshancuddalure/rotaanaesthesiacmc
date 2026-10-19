// Drives one UI build through a month's workflow and records every data-changing request.
// Run it once against the previous UI and once against the redesigned UI, each on its own
// fresh copy of the database, then compare the two JSON reports (and the databases).
//
//   node tests/workflow-equivalence.browser.mjs <label> <ui-url> <api-url> <inputs-dir> <out-dir>
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const [label, base, api, inputs, out] = process.argv.slice(2);
const MONTH = "2026-11";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MEMBER_TEST_BROWSER ? { executablePath: process.env.MEMBER_TEST_BROWSER } : {}),
});
const width = Number(process.env.EQ_WIDTH || 1440);
const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
await context.addInitScript((month) => {
  localStorage.setItem("duty_rota_auth_token", "equivalence");
  localStorage.setItem("duty_rota_working_month", month);
}, MONTH);
const page = await context.newPage();
page.setDefaultTimeout(120000);
const errors = [];
const mutations = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
page.on("request", (request) => {
  const url = new URL(request.url());
  if (!url.pathname.startsWith("/api/") || ["GET", "HEAD", "OPTIONS"].includes(request.method())) return;
  const type = request.headers()["content-type"] || "";
  let body = request.postData() || "";
  if (type.includes("multipart/form-data")) {
    // Boundaries are random; keep the field names and plain values, and file sizes.
    body = body.split(/--[-\w]+/).map((part) => {
      const name = part.match(/name="([^"]+)"/)?.[1];
      if (!name) return null;
      const value = part.split(/\r\n\r\n/).slice(1).join("\r\n\r\n").replace(/\r\n$/, "");
      return part.includes("filename=") ? `${name}=<file ${value.length} bytes>` : `${name}=${value}`;
    }).filter(Boolean).sort();
  } else {
    try { body = JSON.parse(body); } catch { /* plain body */ }
  }
  // Review ids are generated per database, so they are replaced before comparing.
  mutations.push({ method: request.method(), path: url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>"), query: url.search, body });
});
// "direct" means the UI's dev server already forwards /api to its database copy. Proxying
// through Playwright is avoided because Chrome hides file-upload bodies from interception.
if (api !== "direct") {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    try {
      await route.fulfill({ response: await route.fetch({ url: api + url.pathname + url.search, timeout: 300000 }) });
    } catch {
      await route.abort().catch(() => {});
    }
  });
}

const go = (view) => page.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), view);
const settle = async () => {
  await page.waitForLoadState("networkidle", { timeout: 300000 }).catch(() => {});
  await page.waitForTimeout(800);
};
async function setMonth(pageMonthInput) {
  // The previous UI has one month field per page; the redesigned UI has one in the header.
  const own = page.locator(pageMonthInput);
  if (await own.count()) {
    await own.fill(MONTH);
    await own.dispatchEvent("change");
    await settle();
  }
}
async function runImport(kind, file) {
  await page.locator(`[data-open-normalized-import="${kind}"]`).first().click();
  const dialog = page.locator("dialog.operational-import");
  // The previous UI attached the file handler only after member and unit lists loaded.
  await settle();
  await dialog.locator("input[type=file]").setInputFiles(join(inputs, file));
  await dialog.locator("[name=month]").fill(MONTH);
  await page.waitForTimeout(1500);
  await dialog.getByRole("button", { name: "Preview and normalize", exact: true }).click();
  await dialog.locator("[data-review-row]").first().waitFor();
  await dialog.locator("[data-apply]").click();
  await dialog.getByRole("heading", { name: "Import complete", exact: true }).waitFor();
  await dialog.locator("[data-close]").first().click();
  await settle();
}

const steps = [];
try {
  await page.goto(base + "/");
  // A cold dev server compiles on first load; wait until the navigation exists.
  await page.locator('[data-view="rota-setup"]').first().waitFor({ state: "attached", timeout: 300000 });
  await settle();

  await go("rota-setup");
  await settle();
  await setMonth("#rota-setup-month");
  for (const select of await page.locator("[data-scope-unit]").all()) await select.selectOption("included");
  await page.locator("#scope-locked").check();
  await page.locator("#scope-lock-reason").fill("Equivalence check");
  await page.locator("#save-rota-setup").click();
  await settle();
  steps.push("setup saved and locked");

  await go("rota-template");
  await settle();
  await setMonth("#rota-template-month");
  await page.locator("#generate-rota-template").click();
  await settle();
  steps.push("template generated");

  await go("leave");
  await settle();
  await setMonth("#leave-month");
  await runImport("leave", "leave.csv");
  steps.push("leave imported");

  await go("units");
  await settle();
  await setMonth("#unit-month");
  await runImport("units", "units.csv");
  steps.push("unit postings imported");

  await go("members");
  await settle();
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  const memberDialog = page.locator("dialog.mw-import");
  await memberDialog.locator("input[type=file]").setInputFiles(join(inputs, "members.csv"));
  await memberDialog.locator("select[name=mode]").selectOption("create_only");
  await page.waitForTimeout(1500);
  await memberDialog.getByRole("button", { name: "Preview import", exact: true }).click();
  await memberDialog.locator("[data-apply]").click();
  await memberDialog.getByRole("heading", { name: "Import complete", exact: true }).waitFor();
  await memberDialog.locator("[data-close]").first().click();
  steps.push("member imported");

  await go("rota-template");
  await settle();
  await setMonth("#rota-template-month");
  const exportButton = page.locator("#download-eagle-eye-export");
  const exportMenu = page.locator('summary[aria-label="Export rota"]');
  if (await exportMenu.count()) await exportMenu.click();
  // In the previous UI this button sits past the right edge of an overflowing toolbar, so it
  // cannot be clicked by pointer; trigger the same click handler directly.
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 300000 }),
    exportButton.evaluate((button) => button.click()),
  ]);
  await download.saveAs(join(out, "eagle-eye.xlsx"));
  steps.push("eagle eye exported");

  await go("rota-publish");
  await settle();
  await setMonth("#rota-publish-month");
  steps.push(`publish button enabled: ${await page.locator("#rota-publish-form button[type=submit]").isEnabled()}`);
} catch (error) {
  await page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
  steps.push(`FAILED: ${String(error).split(/\r?\n/)[0]}`);
  process.exitCode = 1;
} finally {
  await writeFile(join(out, "report.json"), JSON.stringify({ label, steps, errors, mutations }, null, 2));
  console.log(`${label}: ${steps.length} steps, ${mutations.length} data-changing requests, ${errors.length} page errors`);
  await browser.close();
}
