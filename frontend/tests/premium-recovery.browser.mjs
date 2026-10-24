import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.PREMIUM_TEST_URL || "http://127.0.0.1:5197";
const api = process.env.PREMIUM_TEST_API || "http://127.0.0.1:8031";
assert.equal(new URL(api).port, "8031");
const filteredRun = Boolean(process.env.PREMIUM_RECOVERY_CASE);
const productionRun = process.env.PREMIUM_RECOVERY_PRODUCTION === "1";
const output = new URL(`../../docs/premium-ui/qa-recovery${productionRun ? "-production" : ""}${filteredRun ? "-targeted" : ""}.json`, import.meta.url);
await mkdir(new URL("../../docs/premium-ui/", import.meta.url), { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
async function scenario(name, run) {
  if (process.env.PREMIUM_RECOVERY_CASE && !name.includes(process.env.PREMIUM_RECOVERY_CASE)) return;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try { await run(context); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.message }); }
  finally { await context.close(); }
  console.log(name, results.at(-1).passed ? "passed" : "FAILED");
}
async function fixture(context) {
  await context.addInitScript(() => localStorage.setItem("duty_rota_auth_token", "premium-recovery"));
  await context.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    try { await route.fulfill({ response: await route.fetch({ url: api + url.pathname + url.search }) }); }
    catch (error) { if (!route.request().frame().page().isClosed()) throw error; }
  });
}
async function navigate(page, view) {
  const mobile = page.locator(`.mobile-bottom-nav [data-view="${view}"]`);
  if (await mobile.count()) await mobile.click();
  else {
    await page.locator("#mobile-more").click();
    await page.locator(`[data-mobile-more-view="${view}"]`).click();
  }
}
try {
  await scenario("blocked entry script retains readable startup and genuine reload link", async context => {
    const page = await context.newPage();
    await page.route(/\/src\/main\.ts|\/assets\/index-[^/]+\.js/, route => route.abort());
    await page.goto(base);
    await page.locator("#frontend-startup").waitFor();
    assert.match(await page.locator("#frontend-startup").innerText(), /Starting|connection|reload/i);
    const reload = page.locator("#frontend-startup a");
    await reload.focus();
    await Promise.all([page.waitForEvent("domcontentloaded"), page.keyboard.press("Enter")]);
    await page.locator("#frontend-startup").waitFor();
  });
  await scenario("blocked browser storage keeps login usable without uncaught failure", async context => {
    await context.addInitScript(() => {
      for (const name of ["localStorage", "sessionStorage"]) Object.defineProperty(window, name, { get() { throw new DOMException("Blocked", "SecurityError"); } });
    });
    await context.route("**/api/**", route => route.fulfill({ status: 401, contentType: "application/json", body: '{"detail":"Not authenticated"}' }));
    const page = await context.newPage(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    const field = page.locator("#login-username");
    await field.fill("recovery-user");
    assert.equal(await field.inputValue(), "recovery-user");
    assert.deepEqual(errors, []);
  });
  await scenario("quota failures preserve usable authenticated navigation", async context => {
    await fixture(context);
    await context.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "duty_rota_auth_token") return original.call(this, key, value);
        throw new DOMException("Full", "QuotaExceededError");
      };
    });
    const page = await context.newPage(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base); await page.locator("#view-root").waitFor();
    await navigate(page, "leave");
    await page.locator("#working-month").fill("2026-04");
    await page.locator("#working-month").press("Tab");
    assert.equal(await page.locator("#working-month").inputValue(), "2026-04");
    await navigate(page, "units");
    assert.equal(await page.locator("#working-month").inputValue(), "2026-04", "In-memory storage fallback retains the working month across sections");
    assert.deepEqual(errors, []);
  });
  await scenario("preload failure preserves edited field and declining reload never navigates", async context => {
    await fixture(context);
    const page = await context.newPage();
    await page.goto(base); await page.locator("#view-root").waitFor();
    await navigate(page, "members");
    const input = page.locator("#member-search");
    await input.fill("unsaved-search-probe");
    await page.evaluate(() => {
      window.__recoveryProbe = "original-document";
      window.dispatchEvent(new Event("vite:preloadError"));
      window.dispatchEvent(new Event("vite:preloadError"));
    });
    assert.equal(await page.locator("#frontend-update-recovery").count(), 1);
    assert.equal(await input.inputValue(), "unsaved-search-probe");
    page.on("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: "Reload app", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__recoveryProbe), "original-document");
    await page.getByRole("button", { name: "Keep working", exact: true }).focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#frontend-update-recovery").count(), 0);
    assert.equal(await input.inputValue(), "unsaved-search-probe");
  });
  await scenario("compute settings expose slow loading and recover from 503 through a genuine retry", async context => {
    await fixture(context);
    let attempts = 0;
    await context.route("**/api/v1/rota-compute/capabilities*", async route => {
      attempts++;
      if (attempts === 1) {
        await new Promise(resolve => setTimeout(resolve, 800));
        await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Temporary compute settings outage"}' });
      } else {
        const url = new URL(route.request().url());
        await route.fulfill({ response: await route.fetch({ url: api + url.pathname + url.search }) });
      }
    });
    const page = await context.newPage();
    await page.goto(base); await page.locator("#view-root").waitFor();
    await navigate(page, "compute-settings");
    await page.getByRole("region", { name: "Loading compute settings", exact: true }).waitFor();
    assert.equal(await page.locator('#view-root [aria-busy="true"]').count(), 1);
    await page.locator("#view-root [role=alert]").waitFor();
    assert.match(await page.locator("#view-root [role=alert]").innerText(), /outage/);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.locator("#view-root [data-compute-mode]").waitFor();
    assert.equal(await page.locator('#view-root [aria-busy="true"]').count(), 0);
    assert.equal(attempts, 2, "One initial read and one deliberate retry");
  });
  if (!productionRun) await scenario("typed request client handles HTTP, malformed, empty and cancelled responses without mutation replay", async context => {
    await fixture(context);
    const calls = {};
    await context.route("**/api/__premium/**", async route => {
      const key = new URL(route.request().url()).pathname.split("/").at(-1);
      calls[key] = (calls[key] || 0) + 1;
      const response = {
        unauthorized: { status: 401, contentType: "application/json", body: '{"detail":"Sign in required"}' },
        conflict: { status: 409, contentType: "application/json", body: '{"detail":"The reviewed data changed"}' },
        unavailable: { status: 503, contentType: "text/html", body: "<html>Unavailable</html>" },
        malformed: { status: 200, contentType: "application/json", body: "{broken" },
        empty: { status: 204 },
      }[key];
      if (response) await route.fulfill(response);
      else {
        await new Promise(resolve => setTimeout(resolve, 250));
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" }).catch(() => {});
      }
    });
    const page = await context.newPage();
    await page.goto(base); await page.locator("#view-root").waitFor();
    const evidence = await page.evaluate(async () => {
      const { request } = await import("/src/services/api.ts");
      const output = {};
      // Session expiry correctly blocks subsequent changes. Exercise independent
      // HTTP/parser failures before expiring this fixture's authenticated session.
      for (const key of ["conflict", "unavailable", "malformed", "empty"]) {
        try { output[key] = { value: await request(`/api/__premium/${key}`, { method: "POST", body: "{}" }) ?? "undefined" }; }
        catch (error) { output[key] = { kind: error.kind, status: error.status, message: error.message }; }
      }
      try { await request("/api/__premium/timeout", { readTimeoutMs: 20 }); }
      catch (error) { output.timeout = { kind: error.kind }; }
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 20);
      try { await request("/api/__premium/cancel", { signal: controller.signal }); }
      catch (error) { output.cancel = { name: error.name }; }
      try { await request('/api/__premium/unauthorized', {method:'POST',body:'{}'}); }
      catch (error) { output.unauthorized = {kind:error.kind,status:error.status,message:error.message}; }
      try { await request('/api/__premium/after-expiry', {method:'POST',body:'{}'}); }
      catch (error) { output.afterExpiry = {kind:error.kind,status:error.status,message:error.message}; }
      return output;
    });
    assert.equal(evidence.unauthorized.status, 401);
    assert.equal(evidence.conflict.status, 409);
    assert.match(evidence.conflict.message, /changed/);
    assert.equal(evidence.unavailable.status, 503);
    assert.match(evidence.unavailable.message, /server|request|retry/i);
    assert.equal(evidence.malformed.kind, "invalid-response");
    assert.match(evidence.malformed.message, /Check the current record/);
    assert.equal(evidence.empty.value, "undefined");
    assert.equal(evidence.timeout.kind, "timeout");
    assert.equal(evidence.cancel.name, "AbortError");
    assert.equal(evidence.afterExpiry.status,401);
    assert.match(evidence.afterExpiry.message,/Sign in again/);
    assert.equal(calls['after-expiry'],undefined,'Expired session rejects another change before network submission');
    for (const count of Object.values(calls)) assert.equal(count, 1, "Failed or uncertain mutations must never automatically replay");
  });
} finally {
  await browser.close();
  await writeFile(output, JSON.stringify({ base, results, skipped: productionRun ? ["Typed request-client injection imports a dev module; it is not rerun against production"] : [], limitations: ["Preload event is injected; real missing production chunks covered separately", "Edited field exercises unsaved-input protection, not persistent draft restoration"] }, null, 2));
}
assert.equal(results.filter(r => !r.passed).length, 0, "Inspect qa-recovery.json");
