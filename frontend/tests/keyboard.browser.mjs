// Keyboard walkthrough: every section is reachable by Tab from the skip link, and each focused
// control shows a visible focus indicator (outline or focus ring). Runs against the real API on
// the UX audit database copy (tools/ux_audit_server.py on 8020) via the Vite dev server.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const api = process.env.UX_AUDIT_API || "http://127.0.0.1:8020";
const STOPS = Number(process.env.KEYBOARD_STOPS || 45);
const views = ["overview", "analysis", "members", "leave", "units", "rota-setup", "rota-template", "rota-review",
  "rota-publish", "user-guide", "rota-rules", "call-clusters", "mappings", "imports", "accounts", "diagnostics",
  "compute-settings", "recycle-bin"];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MEMBER_TEST_BROWSER ? { executablePath: process.env.MEMBER_TEST_BROWSER } : {}),
});
const failures = [];
let checked = 0;
try {
  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("duty_rota_auth_token", "keyboard"));
    const page = await context.newPage();
    page.on("dialog", (d) => d.dismiss());
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      try {
        await route.fulfill({ response: await route.fetch({ url: api + url.pathname + url.search, timeout: 60000 }) });
      } catch {
        await route.abort().catch(() => {});
      }
    });
    await page.goto(base + "/");
    await page.locator("#view-root").waitFor();
    for (const view of views) {
      await page.evaluate((v) => document.querySelector(`[data-view="${v}"]`).click(), view);
      await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector("#view-root [aria-busy='true']"), null, { timeout: 45000 }).catch(() => {});
      // Start at the skip link, the first stop for a keyboard user arriving on the page.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator(".skip-link").focus();
      await page.waitForTimeout(150);
      const skip = await page.evaluate(() => {
        const el = document.activeElement;
        return { cls: el?.className || "", visible: (el?.getBoundingClientRect().top ?? -1) >= 0 };
      });
      assert.match(skip.cls, /skip-link/);
      assert.equal(skip.visible, true, `${view}: the focused skip link is shown on screen`);
      for (let i = 0; i < STOPS; i++) {
        await page.keyboard.press("Tab");
        // Date-type fields apply their focus style a moment after the key press.
        await page.waitForTimeout(40);
        const info = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 1;
          const ring = style.boxShadow && style.boxShadow !== "none";
          return {
            name: `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}"`,
            visibleIndicator: outline || ring,
            onScreen: rect.width > 0 && rect.height > 0,
          };
        });
        if (!info) continue;
        checked++;
        if (!info.visibleIndicator || !info.onScreen) failures.push(`${scheme} ${view}: ${info.name}${info.onScreen ? "" : " (not visible)"}`);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
const unique = [...new Set(failures)];
console.log(`${checked} focus stops checked across ${views.length} sections in light and dark; ${unique.length} without a visible focus indicator`);
unique.slice(0, 30).forEach((line) => console.log("  " + line));
assert.equal(unique.length, 0, "Every focused control shows a visible focus indicator");
