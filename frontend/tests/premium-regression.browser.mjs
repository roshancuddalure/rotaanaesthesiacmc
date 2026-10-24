// Read-only UI audit. Never targets a working or production API.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const base = process.env.PREMIUM_TEST_URL || "http://127.0.0.1:5197";
const api = process.env.PREMIUM_TEST_API || "http://127.0.0.1:8031";
assert.equal(new URL(api).hostname, "127.0.0.1");
assert.ok(['8031','8033'].includes(new URL(api).port), "Only the isolated premium fixtures are allowed");
const views = ["overview", "analysis", "members", "leave", "units", "rota-setup", "rota-template", "rota-review", "rota-publish", "user-guide", "rota-rules", "call-clusters", "mappings", "imports", "accounts", "diagnostics", "compute-settings", "recycle-bin"];
if(process.env.PREMIUM_TEST_LIMITS==='1')views.splice(views.indexOf('rota-rules')+1,0,'limits');
const widths = (process.env.PREMIUM_TEST_WIDTHS || "320,390,768,1280").split(",").map(Number);
const schemes = (process.env.PREMIUM_TEST_SCHEMES || "light,dark").split(",");
const outputLabel=process.env.PREMIUM_TEST_OUTPUT || (process.env.PREMIUM_TEST_ARTIFACT==='1'?'qa-review-artifact':'qa-responsive');
assert.match(outputLabel,/^[a-zA-Z0-9_-]+$/,'Audit output must be one local folder name');
const output = new URL(`../../docs/premium-ui/${outputLabel}/`, import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function filesUnder(url) {
  const entries = await readdir(url, {withFileTypes:true});
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? filesUnder(new URL(entry.name+'/',url)) : [new URL(entry.name,url)]))).flat();
}
async function snapshot() {
  const files = [...await filesUnder(new URL('../src/',import.meta.url)), ...await filesUnder(new URL('../public/',import.meta.url))];
  return Object.fromEntries(await Promise.all(files.map(async url => [fileURLToPath(url).replaceAll('\\','/').split('/frontend/').at(-1),digest(await readFile(url))])));
}
const initialSources = await snapshot();
const builtFiles = base.includes(':5198') ? await filesUnder(new URL('../dist/',import.meta.url)) : [];
const initialBuilt = Object.fromEntries(await Promise.all(builtFiles.map(async url => [fileURLToPath(url).replaceAll('\\','/').split('/dist/').at(-1),digest(await readFile(url))])));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const sessions = [];
async function navigate(page, view) {
  const candidates = page.locator(`[data-view="${view}"]:visible`);
  let direct;
  for (let i = 0; i < await candidates.count(); i++) {
    const candidate = candidates.nth(i); const box = await candidate.boundingBox();
    if (box && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1) { direct = candidate; break; }
  }
  if (direct) await direct.click();
  else {
    await page.locator("#mobile-more").click();
    await page.locator(`[data-mobile-more-view="${view}"]`).click();
  }
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector("#view-root [aria-busy=true], #view-root .skeleton"), null, { timeout: 20000 });
  await page.waitForFunction(() => (document.querySelector("#view-root")?.textContent?.trim().length || 0) > 20, null, { timeout: 20000 });
  await page.locator("#section-title").waitFor();
  assert.ok(await page.locator(`[data-view="${view}"].active`).count(), "Navigation must update the selected destination");
}
try {
  for (const scheme of schemes) for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      localStorage.setItem("duty_rota_auth_token", "premium-readonly");
      localStorage.setItem("duty_rota_working_month", "2026-05");
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(`Console: ${message.text()}`); });
    await page.route("**/api/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      // This existing rules endpoint performs only validation; its source explicitly never saves.
      const readOnlyRuleCheck = request.method() === "POST" && url.pathname === "/api/v1/admin/rota-rules/phase-one/check";
      if (request.method() !== "GET" && !readOnlyRuleCheck) {
        errors.push(`Blocked unexpected mutation: ${request.method()} ${url.pathname}`);
        await route.fulfill({ status: 599, contentType: "application/json", body: '{"detail":"Audit prohibits mutations"}' });
        return;
      }
      try { await route.fulfill({ response: await route.fetch({ url: api + url.pathname + url.search }) }); }
      catch (error) {
        if (page.isClosed()) return;
        errors.push(`Audit transport failed: ${request.method()} ${url.pathname}: ${error.message}`);
        // Keep transport failures observable in the final report instead of
        // rejecting an unawaited route callback and losing the whole matrix.
        try { await route.fulfill({status:599,json:{detail:'Disposable audit transport failed'}}); }
        catch (deliveryError) { if (!page.isClosed()) errors.push(`Audit error response could not be delivered: ${deliveryError.message}`); }
      }
    });
    await page.goto(base);
    await page.locator("#view-root").waitFor();
    for (const view of views) {
      const beforeErrors = errors.length;
      const row = { view, width, scheme };
      try {
        await navigate(page, view);
        row.layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          title: document.querySelector("#section-title")?.textContent?.trim(),
          rootTextLength: document.querySelector("#view-root")?.textContent?.trim().length || 0,
          visibleActionLabels: [...document.querySelectorAll("#view-root button, #view-root a")]
            .filter(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)
            .map(element => ({ id: element.id || null, label: (element.getAttribute("aria-label") || element.textContent || "").trim(), disabled: element.disabled === true })),
        }));
        assert.ok(row.layout.rootTextLength > 20, "Navigation must produce meaningful view content");
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        row.violations = axe.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) }));
        row.errors = errors.slice(beforeErrors);
        row.screenshot = `${view}-${width}-${scheme}.png`;
        await page.screenshot({ path: fileURLToPath(new URL(row.screenshot, output)), fullPage: true });
        if(['overview','members','limits','rota-template'].includes(view)){
          row.viewport_screenshot=`viewport-${view}-${width}-${scheme}.png`;
          await page.screenshot({path:fileURLToPath(new URL(row.viewport_screenshot,output))});
        }
      } catch (error) { row.failure = error.message; }
      results.push(row);
      console.log(`${view} ${width} ${scheme}: ${row.failure || (row.layout?.overflow ? "OVERFLOW" : "rendered")}`);
    }
    await context.close();
    sessions.push({width,scheme,errors:[...errors]});
  }
} finally {
  await browser.close();
  const finalSources = await snapshot();
  const finalBuilt = Object.fromEntries(await Promise.all(builtFiles.map(async url => [fileURLToPath(url).replaceAll('\\','/').split('/dist/').at(-1),digest(await readFile(url))])));
  const sourcesUnchanged = JSON.stringify(initialSources) === JSON.stringify(finalSources);
  const builtUnchanged = JSON.stringify(initialBuilt) === JSON.stringify(finalBuilt);
  await writeFile(new URL("report.json", output), JSON.stringify({ recorded_at_utc:new Date().toISOString(), base, api, source_hashes_start:initialSources, source_hashes_end:finalSources, source_inputs_unchanged:sourcesUnchanged, built_artifacts_sha256:initialBuilt, built_artifacts_unchanged:builtUnchanged, sessions, results, limitations: ["Read-only navigation and layout audit; does not certify every mutation control", "Desktop Chromium emulation; physical devices and assistive technology not certified", `${views.length} named route snapshots only; every role, data variant and opened dialog is not covered by this matrix`] }, null, 2));
  assert.ok(sourcesUnchanged && builtUnchanged,'Source or built artifact changed during audit; retain historical report and repeat affected checks');
}
assert.equal(results.length,views.length*widths.length*schemes.length,'Every requested route/width/theme must be recorded');
assert.equal(sessions.length,widths.length*schemes.length,'Every requested browser session must finish');
assert.equal(sessions.filter(session=>session.errors.length).length,0,'Startup and between-page session errors must not be lost');
assert.equal(results.filter(r => r.failure || r.layout?.overflow || r.errors?.length || r.violations?.length).length, 0, `Inspect ${outputLabel}/report.json for failures of any tagged severity`);
