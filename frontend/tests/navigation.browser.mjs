// App frame behaviour against the real API on the UX audit database copy:
// a slow screen must never paint over the one the user switched to, the working month
// carries across sections and survives a reload, and the account menu works by keyboard.
//
// Needs the Vite dev server (5178) and tools/ux_audit_server.py (8020).
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const api = process.env.UX_AUDIT_API || "http://127.0.0.1:8020";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MEMBER_TEST_BROWSER ? { executablePath: process.env.MEMBER_TEST_BROWSER } : {}),
});
let passed = 0;

async function openApp(width = 1280, { slowAnalysisMs = 0 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript(() => localStorage.setItem("duty_rota_auth_token", "navigation-test"));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.dismiss());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    try {
      if (slowAnalysisMs && url.pathname.includes("/analysis")) await new Promise((r) => setTimeout(r, slowAnalysisMs));
      const response = await route.fetch({ url: api + url.pathname + url.search, timeout: 60000 });
      await route.fulfill({ response });
    } catch {
      // The test closed this page while a deliberately slow request was still pending.
      await route.abort().catch(() => {});
    }
  });
  await page.goto(base + "/");
  await page.locator("#view-root").waitFor();
  return { context, page, errors };
}

const go = (page, view) => page.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), view);

try {
  // 1. A slow screen never overwrites the screen the user moved to.
  {
    const { context, page, errors } = await openApp(1280, { slowAnalysisMs: 2500 });
    await go(page, "analysis");
    const placeholderShown = await page.locator("#view-root [aria-busy='true']").isVisible();
    assert.equal(placeholderShown, true, "A loading placeholder appears immediately");
    await go(page, "leave");
    await page.waitForTimeout(4000);
    assert.match(await page.locator("#section-title").textContent(), /Leave/);
    assert.equal(await page.locator("#view-root .analysis-tabs").count(), 0, "Analysis content must not appear on Leave");
    assert.equal(await page.locator("[data-view='leave'].active").count() > 0, true);
    assert.deepEqual(errors, []);
    await context.close();
    passed++;
  }

  // 2. Rapid switching across several sections settles on the last one.
  {
    const { context, page } = await openApp(1280, { slowAnalysisMs: 1500 });
    for (const view of ["analysis", "members", "analysis", "units", "analysis", "rota-setup"]) await go(page, view);
    await page.waitForTimeout(5000);
    assert.match(await page.locator("#section-title").textContent(), /Choose the units|Rota Setup/i);
    assert.equal(await page.locator("#view-root .analysis-tabs").count(), 0);
    await context.close();
    passed++;
  }

  // 3. The working month is shared by every month-based section and survives a reload.
  {
    const { context, page } = await openApp(1280);
    await go(page, "leave");
    const picker = page.locator("#working-month");
    await picker.waitFor({ state: "visible" });
    await picker.fill("2026-03");
    await picker.dispatchEvent("change");
    await page.waitForTimeout(1500);
    for (const view of ["units", "rota-setup", "rota-template", "rota-review", "rota-publish"]) {
      await go(page, view);
      await page.waitForTimeout(800);
      assert.equal(await picker.inputValue(), "2026-03", `${view} keeps the working month`);
    }
    await go(page, "members");
    assert.equal(await page.locator("#working-month-field").isHidden(), true, "Month picker hides where it does not apply");
    await page.reload();
    await page.locator("#view-root").waitFor();
    await go(page, "units");
    await page.waitForTimeout(800);
    assert.equal(await picker.inputValue(), "2026-03", "Month survives a reload");
    await context.close();
    passed++;
  }

  // 4. The account menu opens, moves and closes with the keyboard.
  {
    const { context, page } = await openApp(1280);
    const button = page.locator("#account-menu-button");
    await button.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(100);
    assert.equal(await page.locator("#account-menu").isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "profile");
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "change-password");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#account-menu").isHidden(), true);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "account-menu-button");
    await context.close();
    passed++;
  }

  // 5. The phone header fits without sideways scrolling.
  {
    const { context, page } = await openApp(390);
    await go(page, "rota-template");
    await page.waitForTimeout(3000);
    const overflow = await page.evaluate(() => document.querySelector(".topbar").scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
    await context.close();
    passed++;
  }

  // 6. Every section paints its layout within 100 ms of the click, Overview shows content within
  //    1 s, and nothing jumps around while data arrives (cumulative layout shift).
  {
    const { context, page } = await openApp(1440);
    await page.evaluate(() => {
      window.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    const timings = {};
    for (const view of ["analysis", "members", "leave", "units", "rota-setup", "rota-template", "rota-review",
      "rota-publish", "user-guide", "rota-rules", "call-clusters", "mappings", "imports", "accounts", "diagnostics", "compute-settings"]) {
      const paint = await page.evaluate((v) => new Promise((resolve) => {
        const root = document.querySelector("#view-root");
        const started = performance.now();
        const before = root.innerHTML;
        document.querySelector(`[data-view="${v}"]`).click();
        // Measured after the next frame: the time until something new is on screen.
        requestAnimationFrame(() => resolve({ ms: performance.now() - started, changed: root.innerHTML !== before }));
      }), view);
      timings[view] = Math.round(paint.ms);
      assert.equal(paint.changed, true, `${view} paints something on the first frame`);
      assert.ok(paint.ms < 100, `${view} layout appears within 100 ms (took ${paint.ms.toFixed(0)} ms)`);
      await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
    }
    const overviewStart = Date.now();
    await go(page, "overview");
    await page.locator(".overview-month").waitFor();
    const overviewMs = Date.now() - overviewStart;
    assert.ok(overviewMs < 1000, `Overview shows content within 1 s (took ${overviewMs} ms)`);
    await page.locator("#view-root .board-hero").waitFor({ timeout: 30000 });
    const cls = await page.evaluate(() => window.__cls);
    console.log(`  first-frame paint per section (ms): ${JSON.stringify(timings)}; Overview content ${overviewMs} ms; layout shift ${cls.toFixed(3)}`);
    assert.ok(cls < 0.1, `Cumulative layout shift stays below 0.1 (was ${cls.toFixed(3)})`);
    await context.close();
    passed++;
  }

  console.log(`${passed} navigation and app-frame workflows passed`);
} finally {
  await browser.close();
}
