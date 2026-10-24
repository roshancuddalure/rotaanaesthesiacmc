// Fill remaining duties (all units) — docs/extra_duty_fill_all_contract.md — with mocked APIs:
// - opening runs preview with mode "all_units" and shows the report before anything can be applied:
//   "Never broken" box, five summary chips, over-limit table, cross-unit list by tier, causes with
//   fixes and examples, the postings diagnostic, and the per-duty decisions table;
// - Apply needs the review box, posts {month, token, plan_hash, mode: "all_units"} once;
// - 409 stale_preview / proposal_active / other errors handled like the standard window;
// - result state with audit downloads and Undo; the standard window links to fill-all;
// - axe clean in light and dark; no sideways scroll at 390px.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const shots = process.env.FILL_ALL_SHOTS || "";
const browser = await chromium.launch({ headless: true, executablePath: process.env.MEMBER_TEST_BROWSER || chromium.executablePath() });
const context = await browser.newContext({ viewport: { width: 390, height: 860 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };

const U1 = "u-1", U2 = "u-2", U3 = "u-3";
const justice = (ledger, month, h24 = 0, rest = 40) => ({ ledger_count: ledger, last_extra_date: null, month_duties: month, month_24hr: h24, rest_hours: rest });
const overLimit = [
  { person_id: "p1", person_name: "Dr Asha", call_level: "3RD_CALL", home_unit_name: "UNIT I", month_duties: 9, month_24hr: 7,
    limits: [{ code: "monthly_24hr_limit", label: "24-hour duties", limit: 6, actual: 7 }, { code: "monthly_weekend_24hr_limit", label: "Weekend 24-hour duties", limit: 2, actual: 3 }] },
  { person_id: "p5", person_name: "Dr Ezra", call_level: "4TH_CALL", home_unit_name: null, month_duties: 5, month_24hr: 5,
    limits: [{ code: "monthly_24hr_limit", label: "24-hour duties", limit: 4, actual: 5 }] },
];
const decisions = [
  { slot_id: "s1", action: "assign", tier: "home", person_id: "p1", person_name: "Dr Asha", home_unit_id: U1, assigned_unit_id: U1,
    overridden_rules: ["monthly_24hr_limit"], ledger: true, justice: justice(0, 8, 6), reason: "", duty_date: "2026-06-03", duty_label: "Main 3rd call", alternatives: [] },
  { slot_id: "s2", action: "assign_fallback", tier: "any_unit", person_id: "p2", person_name: "Dr Bina", home_unit_id: U1, assigned_unit_id: U2,
    overridden_rules: ["any_unit"], ledger: true, justice: justice(1, 4, 2), reason: "", duty_date: "2026-06-04", duty_label: "Main 3rd call", alternatives: [] },
  { slot_id: "s3", action: "assign_fallback", tier: "outside_scope", person_id: "p3", person_name: "Dr Chitra", home_unit_id: U1, assigned_unit_id: U3,
    overridden_rules: ["outside_scope_unit"], ledger: true, justice: justice(0, 2), reason: "", duty_date: "2026-06-05", duty_label: "Main 3rd call", alternatives: [] },
  { slot_id: "s4", action: "assign", tier: "unposted", person_id: "p5", person_name: "Dr Ezra", home_unit_id: U2, assigned_unit_id: U2,
    overridden_rules: ["unposted_member", "monthly_24hr_limit"], ledger: true, justice: justice(0, 4, 4), reason: "", duty_date: "2026-06-06", duty_label: "Main 4th call", alternatives: [] },
  { slot_id: "s5", action: "unfilled", tier: null, person_id: null, person_name: null, home_unit_id: U2, assigned_unit_id: null, overridden_rules: [], ledger: false,
    justice: null, alternatives: [], duty_date: "2026-06-07", duty_label: "Main 5th call", reason: "No active 5th-call member exists" },
  { slot_id: "s6", action: "unfilled", tier: null, person_id: null, person_name: null, home_unit_id: U1, assigned_unit_id: null, overridden_rules: [], ledger: false,
    justice: null, alternatives: [], duty_date: "2026-06-08", duty_label: "Main 3rd call", reason: "UNIT I: 4 on leave" },
];
const summary = { filled: 4, fallback: 2, ledger_records: 4, unfilled: 2, slots_considered: 6, mode: "all_units", over_limit_people: 2, cross_unit: 2, unposted_used: 1 };
const previewBody = () => ({
  month: "2026-06", plan_hash: "plan-all", context_hash: "ctx-all", token: "tok-all", generated_at: "2026-10-21T08:00:00Z",
  summary, decisions, over_limit_people: overLimit,
  unfilled_causes: [
    { cause: "no_member_at_level", label: "No member at this call level", count: 1, fix: "Add or activate 5th-call members in Member management.",
      examples: [{ slot_id: "s5", duty_date: "2026-06-07", duty_label: "Main 5th call", unit_name: "UNIT II" }] },
    { cause: "all_on_leave", label: "Everyone suitable is on leave", count: 1, fix: "Review leave for these days.",
      examples: [{ slot_id: "s6", duty_date: "2026-06-08", duty_label: "Main 3rd call", unit_name: "UNIT I" }] },
  ],
  diagnostics: { unposted_by_level: { "3RD_CALL": 63, "4TH_CALL": 22, "5TH_CALL": 0 }, unposted_by_group: { "3rd_call_a": 10 } },
});
const state = { status: { enabled: true, month: "2026-06", open_slots: 6, batches: [] }, previewBodies: [], applyBodies: [], applyResponses: [], previewResponses: [], undoResponses: [], undoBodies: [], jobs: [] };
const fallbacks = [{ unit_id: U1, unit_name: "UNIT I", fallbacks: [] }, { unit_id: U2, unit_name: "UNIT II", fallbacks: [] }, { unit_id: U3, unit_name: "UNIT III", fallbacks: [] }];

await page.route("**/__fill", r => r.fulfill({ contentType: "text/html",
  body: '<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fill-all test</title><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host"><h1>Test page</h1><button id="opener">Open</button><div id="slot"></div></main></body></html>' }));
await page.route("**/api/**", async r => {
  const url = new URL(r.request().url());
  const method = r.request().method();
  const path = url.pathname.replace(/^.*\/api\/v1\/extra-duty/, "");
  const json = (body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (path === "/status") return json(state.status);
  if (path === "/unit-fallbacks" && method === "GET") return json(fallbacks);
  if (path === "/preview") {
    state.previewBodies.push(JSON.parse(r.request().postData()));
    const next = state.previewResponses.shift();
    return next ? json(next[0], next[1]) : json(previewBody());
  }
  if (path === "/apply") {
    state.applyBodies.push(JSON.parse(r.request().postData()));
    await new Promise(res => setTimeout(res, 250));
    const [body, status] = state.applyResponses.shift() ?? [{ batch_id: "b-9", summary, decisions, over_limit_people: overLimit }, 200];
    if (status === 200) state.status = { ...state.status, batches: [{ id: "b-9", status: "applied", created_at: "2026-10-21T08:05:00Z", created_by_name: "Admin", summary }] };
    return json(body, status);
  }
  const undo = path.match(/^\/batches\/([^/]+)\/undo$/);
  if (undo) { state.undoBodies.push(JSON.parse(r.request().postData())); const [body, status] = state.undoResponses.shift(); return json(body, status); }
  if (url.pathname.endsWith("/rota-compute/jobs") && method === "GET") return json(state.jobs);
  return json({ detail: `unmocked ${url.pathname}` }, 404);
});
await page.goto(base + "/__fill");
await page.evaluate(() => localStorage.setItem("duty_rota_auth_token", "test-token"));
await page.reload();
const openFill = () => page.evaluate(async () => {
  window.appliedCount = window.appliedCount || 0;
  document.querySelector("#opener").focus();
  const m = await import("/src/extra-duty.ts");
  await m.openFillAll("2026-06", () => { window.appliedCount++; });
});
const dialog = page.locator("dialog[open]");
const axe = async (label) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    const result = await new AxeBuilder({ page }).include("dialog[open]").analyze();
    eq(result.violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => `${v.id}: ${v.nodes[0]?.target}`), [], `axe ${label} ${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const noHorizontalScroll = async label => ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
  && [...document.querySelectorAll("dialog[open] .mw-content")].every(e => e.scrollWidth <= e.clientWidth + 1)), `no horizontal scroll: ${label}`);
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false }); };

// 1. The report shows before anything can be applied.
await openFill();
await dialog.getByRole("heading", { name: "Fill remaining duties (all units)" }).waitFor();
await dialog.locator("[data-decision]").first().waitFor();
eq(state.previewBodies, [{ month: "2026-06", mode: "all_units" }], "preview asks for all units");
const never = await dialog.locator(".fill-all-never").innerText();
for (const rule of ["Leave", "Rest after a 24-hour duty", "Call level", "Eligibility groups", "The duty's unit rules"]) ok(never.includes(rule), `never broken: ${rule}`);
ok(/May be exceeded/.test(never), "what may be exceeded is said");
const chips = (await dialog.locator(".extra-duty-chip").allInnerTexts()).map(c => c.replace(/\s+/g, " ").trim());
eq(chips, ["4 to fill", "2 from other units", "1 members without a posting", "2 over individual limit", "2 cannot be filled"], "summary chips");
// Over-limit table.
const over = dialog.locator(".fill-all-over");
ok(/Members over their individual limit \(2\)/.test(await over.innerText()), "over-limit heading");
const asha = await over.locator('[data-over-limit="p1"]').innerText();
ok(/Dr Asha/.test(asha) && /3rd call/.test(asha) && /UNIT I/.test(asha) && /9 duties/.test(asha), "over-limit row basics");
ok(/24-hour duties\s*7 \/ 6/.test(asha) && /Weekend 24-hour duties\s*3 \/ 2/.test(asha), "each limit actual / limit");
ok(/No posting this month/.test(await over.locator('[data-over-limit="p5"]').innerText()), "unposted member's unit");
// Cross-unit list grouped by tier.
const cross = dialog.locator(".fill-all-cross");
ok(/Covered from other units \/ members without a posting \(3\)/.test(await cross.innerText()), "cross-unit heading");
eq(await cross.locator("[data-tier]").evaluateAll(es => es.map(e => e.dataset.tier)), ["any_unit", "outside_scope", "unposted"], "grouped by tier");
ok(/From another unit/.test(await cross.locator('[data-tier="any_unit"] h4').innerText()), "tier in plain words");
ok(/From a unit outside this month's scope/.test(await cross.locator('[data-tier="outside_scope"] h4').innerText()), "outside scope tier");
ok(/Works in UNIT II · covers UNIT I's duty/.test(await cross.locator('[data-cross="s2"]').innerText()), "moved unit explained");
ok(/no posting this month/.test(await cross.locator('[data-cross="s4"]').innerText()), "unposted explained");
// Causes.
const causes = dialog.locator(".fill-all-causes");
ok(/Cannot be filled \(2\)/.test(await causes.innerText()), "causes heading");
const noLevel = await causes.locator('[data-cause="no_member_at_level"]').innerText();
ok(/No member at this call level/.test(noLevel) && /1 duty/.test(noLevel) && /Add or activate 5th-call members/.test(noLevel) && /7 Jun 2026 · Main 5th call · UNIT II/.test(noLevel), "cause with fix and example");
const diag = await dialog.locator(".fill-all-diagnostics").innerText();
ok(/63 3rd-call members have no posting this month/.test(diag) && /22 4th-call members have no posting this month/.test(diag), "postings diagnostic");
ok(!/5th-call members have/.test(diag), "zero counts are left out");
// Decisions table with plain-words codes.
eq(await dialog.locator("[data-decision]").count(), 4, "four filled rows");
const s2 = await dialog.locator('[data-decision="s2"]').innerText();
ok(/Covered from another unit/.test(s2), "any_unit label");
ok(/Covered from a unit outside this month's scope/.test(await dialog.locator('[data-decision="s3"]').innerText()), "outside_scope_unit label");
const s4 = await dialog.locator('[data-decision="s4"]').innerText();
ok(/Member has no posting this month/.test(s4) && /Member has no posting/.test(s4), "unposted_member label and badge");
ok(!/any_unit|unposted_member|outside_scope|monthly_24hr/.test(await dialog.locator(".mw-content").innerText()), "no raw codes anywhere");
// Apply is locked until the review box is ticked.
const apply = dialog.locator("[data-extra-apply]");
eq((await apply.innerText()).trim(), "Apply", "apply label");
ok(await apply.isDisabled(), "apply disabled before review");
ok(await page.evaluate(() => document.querySelector("dialog[open]").contains(document.activeElement)), "focus is inside the window");
await axe("preview 390");
await noHorizontalScroll("preview at 390px");
await shot("fill-all-preview-390-top");
await dialog.locator(".fill-all-over").scrollIntoViewIfNeeded();
await shot("fill-all-preview-390-overlimit");
await dialog.locator(".fill-all-causes").scrollIntoViewIfNeeded();
await shot("fill-all-preview-390-causes");

// 2. Stale preview: plain message, Preview again re-runs all units.
await dialog.getByLabel("I reviewed these duties and the over-limit list").check();
ok(await apply.isEnabled(), "apply enabled after review");
state.applyResponses.push([{ detail: { code: "stale_preview", message: "The plan changed since your preview." } }, 409]);
await apply.click();
await dialog.getByRole("alert").filter({ hasText: "The plan changed since your preview." }).waitFor();
ok(/Nothing was saved/.test(await dialog.getByRole("alert").innerText()), "stale next step");
eq(state.applyBodies.at(-1), { month: "2026-06", token: "tok-all", plan_hash: "plan-all", mode: "all_units" }, "apply sends the mode");
ok(await page.evaluate(() => document.activeElement?.matches("[data-extra-repreview]")), "focus on Preview again");
await dialog.getByRole("button", { name: "Preview again" }).click();
await dialog.locator("[data-decision]").first().waitFor();
eq(state.previewBodies.at(-1), { month: "2026-06", mode: "all_units" }, "re-preview keeps the mode");
ok(await dialog.locator("[data-extra-apply]").isDisabled(), "review box resets");

// 3. Other error: message, nothing saved.
await dialog.getByLabel("I reviewed these duties and the over-limit list").check();
state.applyResponses.push([{ detail: { code: "not_draft", message: "This month is published." } }, 409]);
await dialog.locator("[data-extra-apply]").click();
await dialog.getByRole("alert").filter({ hasText: "This month is published." }).waitFor();
ok(/Nothing was saved/.test(await dialog.getByRole("alert").innerText()), "other error says nothing saved");

// 4. proposal_active: the shared Resume / Cancel panel names this window.
state.applyResponses.push([{ detail: { code: "proposal_active", message: "Another generation proposal is open for this month.",
  job_id: "job-9", kind: "members", status: "running", processed: 4, total: 20, owned: true, operator_name: "Admin", month: "2026-06" } }, 409]);
await dialog.locator("[data-extra-apply]").click();
await dialog.getByRole("heading", { name: "Another proposal is in progress" }).waitFor();
ok(/fill the remaining duties/.test(await dialog.innerText()), "conflict message names fill-all");
await dialog.locator("[data-close]").click();
await page.locator("dialog").waitFor({ state: "detached" });

// 5. Preview error (scope unlocked) explains the next step and offers no apply.
state.previewResponses.push([{ detail: { code: "scope_unlocked", message: "The month's units are not locked." } }, 409]);
await openFill();
await dialog.getByText(/The month's units are not locked\. Lock the month's units/).waitFor();
eq(await dialog.locator("[data-extra-apply]").count(), 0, "no apply on a blocked month");
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });
ok(await page.evaluate(() => document.activeElement?.id === "opener"), "focus returns to the opener");

// 6. Apply once (double click), result state with report downloads and Undo.
await openFill();
await dialog.locator("[data-decision]").first().waitFor();
await dialog.getByLabel("I reviewed these duties and the over-limit list").check();
state.applyBodies = [];
await dialog.locator("[data-extra-apply]").dblclick();
await dialog.getByText(/Applied\. 4 duties filled; 2 from other units; 1 member without a posting; 2 members over an individual limit\./).waitFor();
eq(state.applyBodies, [{ month: "2026-06", token: "tok-all", plan_hash: "plan-all", mode: "all_units" }], "single apply with mode");
eq(await page.evaluate(() => window.appliedCount), 1, "onApplied once");
ok(/4\s*filled/.test((await dialog.locator(".extra-duty-chip").first().innerText()).replace(/\s+/g, " ")), "applied chips");
ok(await dialog.locator(".fill-all-over [data-over-limit]").count() === 2, "over-limit list kept after apply");
await dialog.getByRole("button", { name: "Download audit report (HTML)" }).waitFor();
await dialog.getByRole("button", { name: "Undo this batch" }).waitFor();
await axe("applied 390");
await noHorizontalScroll("applied at 390px");
await shot("fill-all-applied-390");
state.undoResponses.push([{ batch_id: "b-9", restored: 4, conflicts: [] }, 200]);
await dialog.getByRole("button", { name: "Undo this batch" }).click();
await dialog.getByRole("heading", { name: "Undo this batch?" }).waitFor();
eq(state.undoBodies.at(-1), { dry_run: true }, "undo dry run first");
await dialog.getByRole("button", { name: "Keep it" }).click();
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });
state.status = { enabled: true, month: "2026-06", open_slots: 6, batches: [] };

// 7. The standard window links to fill-all.
state.previewBodies = [];
await page.evaluate(async () => { document.querySelector("#opener").focus(); const m = await import("/src/extra-duty.ts"); await m.openExtraDuty("2026-06", () => {}); });
await dialog.locator("[data-decision]").first().waitFor();
eq(state.previewBodies.at(-1), { month: "2026-06" }, "standard preview sends no mode");
const cta = dialog.getByRole("button", { name: "Fill remaining duties (all units)" });
await cta.waitFor();
ok(await page.evaluate(() => !document.activeElement?.matches("[data-open-fill-all]")), "standard window does not start on the fill-all button");
await cta.click();
await page.locator("dialog[open]").getByRole("heading", { name: "Fill remaining duties (all units)" }).waitFor();
await dialog.locator("[data-decision]").first().waitFor();
eq(await page.locator("dialog").count(), 1, "only the fill-all window is open");
eq(state.previewBodies.at(-1), { month: "2026-06", mode: "all_units" }, "switched to all units");
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });

// 8. Over-limit table helper collapses long lists (used by Publish).
await page.evaluate(async () => {
  const m = await import("/src/extra-duty.ts");
  const people = Array.from({ length: 7 }, (_, i) => ({ person_id: `x${i}`, person_name: `Member ${i}`, call_level: "3RD_CALL", home_unit_name: "UNIT I",
    month_duties: 8, month_24hr: 7, limits: [{ code: "monthly_24hr_limit", label: "24-hour duties", limit: 6, actual: 7 }] }));
  document.querySelector("#slot").innerHTML = m.overLimitTable(people, { caption: "Over limit", collapseOver: 5 }) + m.overLimitTable(people.slice(0, 2), { caption: "Short", collapseOver: 5 });
});
eq(await page.locator("#slot details.over-limit-details").count(), 1, "long list collapsed");
ok(/Show all 7 members over a limit/.test(await page.locator("#slot details summary").innerText()), "collapse summary");
eq(await page.locator("#slot > .table-scroll [data-over-limit]").count(), 2, "short list shown");

// 9. Desktop width.
await page.setViewportSize({ width: 1280, height: 900 });
await openFill();
await dialog.locator("[data-decision]").first().waitFor();
ok(await dialog.locator(".fill-all-over thead").isVisible(), "real table on desktop");
await noHorizontalScroll("preview at 1280px");
await shot("fill-all-preview-1280");
await page.emulateMedia({ colorScheme: "dark" });
await shot("fill-all-preview-1280-dark");
await page.emulateMedia({ colorScheme: "light" });
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });

eq(errors, [], "no page errors");
await browser.close();
console.log(`fill-all UI: all ${checks} checks passed`);
