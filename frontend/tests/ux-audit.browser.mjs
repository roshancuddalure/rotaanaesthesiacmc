// UX audit: every section at four widths in light and dark mode.
// Captures screenshots, runs axe (WCAG 2.2 AA), and flags sideways scrolling, clipped
// controls and internal codes shown to users. Needs the Vite dev server (port 5178) and
// tools/ux_audit_server.py (port 8020, a copy of the department database).
//
//   node tests/ux-audit.browser.mjs <label> [--strict] [--views=members,leave] [--widths=1440,390]
//     [--schemes=light,dark] [--month=2026-05]
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith("--")) || "current";
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const strict = args.includes("--strict");
const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const api = process.env.UX_AUDIT_API || "http://127.0.0.1:8020";
const out = new URL(`../../docs/ux-audit/${label}/`, import.meta.url);
const ALL_VIEWS = ["overview", "analysis", "members", "leave", "units", "rota-setup", "rota-template",
  "rota-review", "rota-publish", "user-guide", "rota-rules", "call-clusters", "mappings", "imports",
  "accounts", "diagnostics", "compute-settings", "recycle-bin"];
const views = option("views")?.split(",") ?? ALL_VIEWS;
const widths = (option("widths")?.split(",") ?? ["1440", "1024", "768", "390"]).map(Number);
const schemes = option("schemes")?.split(",") ?? ["light", "dark"];
// Working month for month-based sections; May 2026 has leave, postings and rota slots on record.
const month = option("month");
// Codes such as 2ND_CALL, UNIT_I or DEPT_OF_X, and raw UUIDs, should never reach the screen.
const CODE = /\b[A-Z0-9]+(?:_[A-Z0-9]+)+\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;

await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MEMBER_TEST_BROWSER ? { executablePath: process.env.MEMBER_TEST_BROWSER } : {}),
});
const results = [];

async function openApp(width, scheme) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
  await context.addInitScript((workingMonth) => {
    localStorage.setItem("duty_rota_auth_token", "ux-audit");
    if (workingMonth) localStorage.setItem("duty_rota_working_month", workingMonth);
  }, month);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.dismiss());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    try {
      const response = await route.fetch({ url: api + url.pathname + url.search, timeout: 60000 });
      await route.fulfill({ response });
    } catch {
      await route.abort();
    }
  });
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.locator("#view-root").waitFor({ timeout: 30000 });
  return { context, page, errors };
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  await page.waitForFunction(() => {
    const root = document.querySelector("#view-root");
    return root && !root.querySelector("[aria-busy='true'], .skeleton") && !/^\s*Loading\b/.test(root.textContent || "");
  }, null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function inspect(page) {
  return page.evaluate((codeSource) => {
    const code = new RegExp(codeSource, "g");
    const width = window.innerWidth;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const describe = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
    const scrollsX = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden") return true;
      }
      return false;
    };
    const overflow = [...document.querySelectorAll("#app *")]
      .filter((el) => visible(el) && el.getBoundingClientRect().right > width + 1 && !scrollsX(el))
      .slice(0, 8).map(describe);
    const clipped = [...document.querySelectorAll("#app button, #app a, #app .badge, #app .status")]
      .filter((el) => visible(el) && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== "visible")
      .slice(0, 8).map((el) => `${describe(el)} "${(el.textContent || "").trim().slice(0, 40)}"`);
    const text = document.querySelector("#app")?.innerText || "";
    const codes = [...new Set(text.match(code) || [])].slice(0, 25);
    return {
      pageScrollsSideways: document.documentElement.scrollWidth > width + 1,
      overflow,
      clipped,
      codes,
      title: document.querySelector("#section-title")?.textContent?.trim() || "",
    };
  }, CODE.source);
}

try {
  for (const scheme of schemes) {
    for (const width of widths) {
      const { context, page, errors } = await openApp(width, scheme);
      await settle(page);
      for (const view of views) {
        const started = Date.now();
        await page.evaluate((v) => {
          const button = document.querySelector(`[data-view="${v}"]`);
          if (button) button.click();
        }, view);
        await settle(page);
        const elapsed = Date.now() - started;
        const shot = `${view}-${width}-${scheme}.png`;
        // Dark mode screenshots at the two extreme widths keep the evidence set manageable.
        if (scheme === "light" || width === 1440 || width === 390) {
          await page.screenshot({ path: fileURLToPath(new URL(shot, out)), fullPage: true, timeout: 60000 })
            .catch((e) => console.log(`screenshot failed ${shot}: ${String(e).slice(0, 120)}`));
          // First screen only, for quick review of long pages.
          await page.screenshot({ path: fileURLToPath(new URL(shot.replace(".png", "-top.png"), out)) }).catch(() => {});
        }
        const axe = await new AxeBuilder({ page })
          .include("#app")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze()
          .catch((e) => ({ violations: [{ id: "axe-error", impact: "critical", nodes: [{ target: [String(e).slice(0, 80)] }] }] }));
        const severe = axe.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
        const checks = await inspect(page);
        results.push({ view, width, scheme, elapsed, shot, axe: severe, ...checks, errors: [...errors] });
        errors.length = 0;
        console.log(`${view.padEnd(16)} ${String(width).padStart(4)} ${scheme.padEnd(5)} axe:${severe.reduce((n, v) => n + v.count, 0)} ` +
          `sideways:${checks.pageScrollsSideways ? "YES" : "no"} overflow:${checks.overflow.length} clipped:${checks.clipped.length} codes:${checks.codes.length}`);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const problems = results.filter((r) => r.axe.length || r.pageScrollsSideways || r.overflow.length || r.clipped.length || r.codes.length || r.errors.length);
const summary = [
  `# UX audit: ${label}`,
  "",
  `${results.length} checks (${views.length} sections x ${widths.join("/")}px x ${schemes.join("/")}). ${problems.length} with findings.`,
  "",
  "| Section | Width | Scheme | Axe serious/critical | Sideways scroll | Overflowing | Clipped | Internal codes | JS errors |",
  "|---|---|---|---|---|---|---|---|---|",
  ...results.map((r) => `| ${r.view} | ${r.width} | ${r.scheme} | ${r.axe.map((v) => `${v.id}×${v.count}`).join(", ") || "0"} | ${r.pageScrollsSideways ? "yes" : "no"} | ${r.overflow.length} | ${r.clipped.length} | ${r.codes.slice(0, 6).join(", ") || "-"} | ${r.errors.length} |`),
  "",
].join("\n");
await writeFile(new URL("results.json", out), JSON.stringify(results, null, 2));
await writeFile(new URL("README.md", out), summary);
console.log(`\n${problems.length}/${results.length} checks with findings -> docs/ux-audit/${label}/`);
if (strict && problems.length) process.exitCode = 1;
