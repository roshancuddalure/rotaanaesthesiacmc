// Balance duties (docs/call_level_pool_and_balance_contract.md §3) with mocked APIs:
// - stage button + status line ("Duties are balanced" / "3rd call: 3–8 duties (target 5–6)"), disabled states;
// - the window explains what it does, shows before → after per call level (range, gap, fair share, ok badge,
//   reason when still uneven), moves grouped by level (cross-unit badge, swaps, reasons, fold after 8),
//   and a collapsible member table; nothing can be applied before the review box is ticked;
// - Apply posts {month, token, plan_hash} once; result state with Undo and audit report downloads;
// - errors: stale_preview, verification_failed, proposal_active, nothing_to_balance ("Already balanced"),
//   not_draft, disabled, undo_conflict;
// - axe clean light and dark, focus management, keyboard, no sideways scroll at 390 px.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const shots = process.env.BALANCE_SHOTS || "";
const browser = await chromium.launch({ headless: true, executablePath: process.env.MEMBER_TEST_BROWSER || chromium.executablePath() });
const context = await browser.newContext({ viewport: { width: 390, height: 860 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };

const MONTH = "2026-11";
const member = (person_id, name, call_level, unit, before, after, goal, avail_days = 30) => ({ person_id, name, call_level, unit, before, after, goal, avail_days });
const members = [
  member("a1", "Dr Asha", "1ST_CALL", "UNIT I", 9, 7, 7), member("a2", "Dr Bina", "1ST_CALL", "UNIT I", 9, 7, 7),
  member("a3", "Dr Chitra", "1ST_CALL", "UNIT II", 5, 6, 6, 24), member("a4", "Dr Dev", "1ST_CALL", "UNIT II", 5, 7, 7),
  member("a5", "Dr Esha", "1ST_CALL", "UNIT III", 6, 6, 6), member("a6", "Dr Farah", "1ST_CALL", null, 5, 7, 7),
  member("b1", "Dr Gopal", "3RD_CALL", "UNIT I", 8, 6, 6), member("b2", "Dr Hari", "3RD_CALL", "UNIT II", 3, 5, 5, 20),
  member("b3", "Dr Indu", "3RD_CALL", "UNIT III", 5, 5, 5),
  member("c1", "Dr Ira", "4TH_CALL", "UNIT I", 2, 3, 4, 18), member("c2", "Dr Jay", "4TH_CALL", "UNIT II", 6, 5, 4),
];
const mv = (i, date, from, to, extra = {}) => ({ kind: "move", slot_id: `m${i}`, duty_date: date, duty_label: "Main 1st call", from_person: from, from_unit: "UNIT I",
  to_person: to, to_unit: "UNIT I", cross_unit: false, reason: `${from} had the most 1st-call duties; ${to} had the fewest and is free that day.`, ...extra });
const moves = [
  mv(1, "2026-11-02", "Dr Asha", "Dr Chitra", { to_unit: "UNIT II", cross_unit: true }),
  mv(2, "2026-11-04", "Dr Asha", "Dr Dev", { to_unit: "UNIT II", cross_unit: true }),
  mv(3, "2026-11-06", "Dr Bina", "Dr Farah"), mv(4, "2026-11-08", "Dr Bina", "Dr Farah"),
  mv(5, "2026-11-10", "Dr Asha", "Dr Dev"), mv(6, "2026-11-12", "Dr Bina", "Dr Esha"),
  mv(7, "2026-11-14", "Dr Esha", "Dr Dev"), mv(8, "2026-11-16", "Dr Asha", "Dr Farah"), mv(9, "2026-11-18", "Dr Bina", "Dr Chitra"),
  { kind: "move", slot_id: "m10", duty_date: "2026-11-05", duty_label: "PAC SR", from_person: "Dr Gopal", from_unit: "UNIT I", to_person: "Dr Hari", to_unit: "UNIT I",
    cross_unit: false, reason: "Dr Gopal was 2 above the fair share." },
  { kind: "swap", slot_id: "m11", duty_date: "2026-11-09", duty_label: "PAC SR", from_person: "Dr Gopal", from_unit: "UNIT I", to_person: "Dr Hari", to_unit: "UNIT I",
    cross_unit: false, reason: "Frees Dr Hari's 9 Nov so the next move keeps rest.", swap_duty_date: "2026-11-21", swap_duty_label: "Night duty" },
  { kind: "move", slot_id: "m12", duty_date: "2026-11-20", duty_label: "Main 4th call", from_person: "Dr Jay", from_unit: "UNIT II", to_person: "Dr Ira", to_unit: "UNIT I",
    cross_unit: true, reason: "Dr Jay was above the fair share." },
];
const levels = [
  { call_level: "3RD_CALL", goal_range: [5, 6], before: { min: 3, max: 8, gap: 5 }, after: { min: 5, max: 6, gap: 1 }, ok_after: true, reason_if_not: null, allowed_gap: 1 },
  { call_level: "1ST_CALL", goal_range: [6, 7], before: { min: 5, max: 9, gap: 4 }, after: { min: 6, max: 7, gap: 1 }, ok_after: true, reason_if_not: null, allowed_gap: 1 },
  { call_level: "4TH_CALL", goal_range: [4, 4], before: { min: 2, max: 6, gap: 4 }, after: { min: 3, max: 5, gap: 2 }, ok_after: false, allowed_gap: 1,
    reason_if_not: "Dr Ira is on leave for 12 days and Dr Jay already has the maximum 24-hour duties; no other move keeps leave, rest and limits." },
];
const summary = { moves: 11, swaps: 1, cross_unit: 3, levels_balanced_before: 0, levels_balanced_after: 2 };
const previewBody = () => ({ month: MONTH, plan_hash: "plan-bal", context_hash: "ctx-bal", token: "tok-bal", summary, levels, moves, members });
const unevenStatus = () => ({ month: MONTH, enabled: true, balanced: false, batches: [], levels: [
  { call_level: "1ST_CALL", min: 5, max: 9, gap: 4, allowed_gap: 1, ok: false, goal_range: [6, 7] },
  { call_level: "3RD_CALL", min: 3, max: 8, gap: 5, allowed_gap: 1, ok: false, goal_range: [5, 6] },
  { call_level: "4TH_CALL", min: 2, max: 6, gap: 4, allowed_gap: 1, ok: false, goal_range: [4, 4] },
] });
const batch = { id: "bb-1", status: "applied", created_at: "2026-10-22T09:00:00Z", created_by_name: "Admin", summary: { mode: "balance", moves: 11, swaps: 1 } };
const state = { status: unevenStatus(), statusCalls: 0, previewBodies: [], previewResponses: [], applyBodies: [], applyResponses: [], undoBodies: [], undoPaths: [], undoResponses: [], jobs: [] };

await page.route("**/__balance", r => r.fulfill({ contentType: "text/html",
  body: '<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Balance test</title><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host"><h1>Test page</h1><button id="opener">Open</button><ol class="generation-stages" id="stages"></ol></main></body></html>' }));
await page.route("**/api/**", async r => {
  const url = new URL(r.request().url());
  const method = r.request().method();
  const json = (body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const path = url.pathname.replace(/^.*\/api\/v1\/balance-duties/, "");
  if (url.pathname.includes("/balance-duties/")) {
    if (path === "/status") { state.statusCalls++; eq(url.searchParams.get("month"), MONTH, "status month"); return json(state.status); }
    if (path === "/preview") {
      state.previewBodies.push(JSON.parse(r.request().postData()));
      const next = state.previewResponses.shift();
      return next ? json(next[0], next[1]) : json(previewBody());
    }
    if (path === "/apply") {
      state.applyBodies.push(JSON.parse(r.request().postData()));
      await new Promise(res => setTimeout(res, 250));
      const [body, status] = state.applyResponses.shift() ?? [{ ...previewBody(), batch_id: "bb-1" }, 200];
      if (status === 200) state.status = { ...unevenStatus(), balanced: false, batches: [batch] };
      return json(body, status);
    }
    const undo = path.match(/^\/batches\/([^/]+)\/undo$/);
    if (undo && method === "POST") {
      state.undoPaths.push(url.pathname); state.undoBodies.push(JSON.parse(r.request().postData()));
      const [body, status] = state.undoResponses.shift(); return json(body, status);
    }
  }
  if (url.pathname.endsWith("/extra-duty/status") && state.extraStatus) return json(state.extraStatus);
  if (url.pathname.endsWith("/rota-compute/jobs") && method === "GET") return json(state.jobs);
  if (url.pathname.includes("/extra-duty/report")) return r.fulfill({ status: 200, contentType: "text/html", body: "<html>report</html>", headers: { "content-disposition": 'attachment; filename="rota-audit-report-2026-11.html"' } });
  return json({ detail: `unmocked ${url.pathname}` }, 404);
});
await page.goto(base + "/__balance");
await page.evaluate(() => localStorage.setItem("duty_rota_auth_token", "test-token"));
await page.reload();

const dialog = page.locator("dialog[open]");
const openBalance = () => page.evaluate(async (month) => {
  window.appliedCount = window.appliedCount || 0;
  document.querySelector("#opener").focus();
  const m = await import("/src/balance-duties.ts");
  await m.openBalanceDuties(month, () => { window.appliedCount++; });
}, MONTH);
const closeWindow = async () => { await page.keyboard.press("Escape"); await page.locator("dialog").waitFor({ state: "detached" }); };
const axe = async (label) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    const result = await new AxeBuilder({ page }).include("dialog[open]").analyze();
    eq(result.violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => `${v.id}: ${v.nodes[0]?.target}`), [], `axe ${label} ${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const noHorizontalScroll = async label => ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
  && [...document.querySelectorAll("dialog[open] .mw-content, dialog[open] .mw-footer")].every(e => e.scrollWidth <= e.clientWidth + 1)), `no horizontal scroll: ${label}`);
const shot = async (name, full = false) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: full }); };
const stage = (options) => page.evaluate(async ([month, options]) => {
  const m = await import("/src/balance-duties.ts");
  m.invalidateBalanceStatus();
  document.querySelector("#stages").innerHTML = `<li><strong>1 · Build template</strong><span>Allocate duties</span></li><li class="balance-stage"><strong>2 · Autoassign members</strong><span>Prepare safe member proposals, then balance duties within each call level.</span>${m.balanceStageHtml(month, options)}</li><li class="extra-duty-stage"><strong>3 · Extra-duty layer</strong><span>Fills open duties.</span></li><li><strong>4 · Review draft</strong><span>Apply</span></li>`;
}, [MONTH, options]);
const statusLine = page.locator("#stages .balance-stage__status");

// 1. Stage button and status line.
await stage({ draft: true, locked: true, assigned: 40 });
await page.waitForFunction(() => document.querySelector("#stages .balance-stage__status")?.dataset.tone === "uneven");
eq((await statusLine.innerText()).trim(), "3rd call: 3–8 duties (target 5–6) · 2 more levels uneven", "status line names the widest gap");
ok(await page.getByRole("button", { name: "Balance duties" }).isEnabled(), "button enabled on a draft with duties");
eq(await page.getByRole("button", { name: "Balance duties" }).getAttribute("aria-describedby"), await statusLine.getAttribute("id"), "button described by status");
await shot("balance-stage-390");
state.status = { ...unevenStatus(), balanced: true, levels: unevenStatus().levels.map(l => ({ ...l, ok: true })) };
await stage({ draft: true, locked: true, assigned: 40 });
await page.waitForFunction(() => document.querySelector("#stages .balance-stage__status")?.dataset.tone === "ok");
eq((await statusLine.innerText()).trim(), "Duties are balanced.", "balanced status line");
state.status = { ...unevenStatus(), levels: [{ call_level: "1ST_CALL", min: 5, max: 9, gap: 4, allowed_gap: 1, ok: false, goal_range: [6, 7] }] };
await stage({ draft: true, locked: true, assigned: 40 });
await page.waitForFunction(() => document.querySelector("#stages .balance-stage__status")?.dataset.tone === "uneven");
eq((await statusLine.innerText()).trim(), "1st call: 5–9 duties (target 6–7)", "contract example text");
const callsBefore = state.statusCalls;
await stage({ draft: true, locked: true, assigned: 0 });
ok(await page.getByRole("button", { name: "Balance duties" }).isDisabled(), "disabled with nothing assigned");
ok(/Autoassign members first/.test(await statusLine.innerText()), "disabled reason");
await stage({ draft: false, locked: true, assigned: 40 });
ok(/published/.test(await statusLine.innerText()), "published reason");
eq(state.statusCalls, callsBefore, "no status call for a disabled stage");
state.status = { ...unevenStatus(), enabled: false };
await stage({ draft: true, locked: true, assigned: 40 });
await page.waitForFunction(() => document.querySelector("#stages .balance-stage__status")?.dataset.tone === "off");
ok(await page.getByRole("button", { name: "Balance duties" }).isDisabled(), "turned-off deployment disables the button");
state.status = unevenStatus();

// 2. Preview: explanation, before → after per level, moves by level, member table.
await openBalance();
await dialog.getByRole("heading", { name: "Balance duties", level: 2 }).waitFor();
await dialog.locator("[data-balance-move]").first().waitFor();
eq(state.previewBodies, [{ month: MONTH }], "preview posts the month");
const about = await dialog.locator(".balance-about").innerText();
ok(/What this does/.test(about) && /same call level/.test(about), "what-this-does note");
for (const rule of ["Leave", "Rest", "Call level", "Groups", "Unit rules", "Limits"]) ok(about.includes(rule), `never broken: ${rule}`);
ok(/smaller share/.test(about) && /part of the month/.test(about), "pro-rata share explained");
const chips = (await dialog.locator(".extra-duty-chip").allInnerTexts()).map(c => c.replace(/\s+/g, " ").trim());
eq(chips, ["11 duties move", "1 swap", "3 change unit", "0 → 2 of 3 levels balanced"], "summary chips");
eq(await dialog.locator(".balance-levels-section [data-balance-level]").evaluateAll(es => es.map(e => e.dataset.balanceLevel)), ["1ST_CALL", "3RD_CALL", "4TH_CALL"], "levels in call order");
const first = await dialog.locator('.balance-levels-section [data-balance-level="1ST_CALL"]').innerText();
ok(/1st call/.test(first) && /Balanced after/.test(first) && /Fair share\s*6–7\s*duties each/.test(first) && /allowed gap 1/.test(first), "level head, badge and goal");
ok(/Before\s*5–9\s*gap 4/i.test(first) && /After\s*6–7\s*gap 1/i.test(first), `before → after with gaps: ${first}`);
const fourth = await dialog.locator('.balance-levels-section [data-balance-level="4TH_CALL"]').innerText();
ok(/Still uneven/.test(fourth) && /Why:.*Dr Ira is on leave/s.test(fourth) && /Fair share\s*4\s*duties/.test(fourth), "uneven level gives the reason");
// Moves grouped by level.
eq(await dialog.locator("[data-balance-group]").evaluateAll(es => es.map(e => e.dataset.balanceGroup)), ["1ST_CALL", "3RD_CALL", "4TH_CALL"], "moves grouped by level");
const g1 = dialog.locator('[data-balance-group="1ST_CALL"]');
ok(/1st call\s*9 moves · 2 across units/.test(await g1.locator("h4").innerText()), "group meta");
eq(await g1.locator(":scope > ul > [data-balance-move]").count(), 8, "first 8 shown");
ok(/Show 1 more in 1st call/.test(await g1.locator("details summary").innerText()), "rest folded");
const m1 = await dialog.locator('[data-balance-move="m1"]').innerText();
ok(/Mon 2 Nov 2026 · Main 1st call:/.test(m1) && /Dr Asha\s*→\s*to\s*Dr Chitra|Dr Asha\s*→\s*Dr Chitra/.test(m1.replace(/\s+/g, " ")), "Date · Duty: X → Y");
ok(/Changes unit: UNIT I → UNIT II/.test(m1), "cross-unit badge");
ok(/had the most 1st-call duties/.test(m1), "reason shown");
const swap = await dialog.locator('[data-balance-move="m11"]').innerText();
ok(/Swap/.test(swap) && /⇄/.test(swap) && /In return: Sat 21 Nov 2026 · Night duty goes from Dr Hari to Dr Gopal/.test(swap), "swap marked with the return duty");
ok(/3rd call\s*1 move · 1 swap/.test(await dialog.locator('[data-balance-group="3RD_CALL"] h4').innerText()), "swap counted separately");
// Member table, collapsed by default.
const table = dialog.locator("[data-balance-members]");
ok(!(await table.evaluate(d => d.open)), "member table starts closed");
ok(/Every member's share\s*11 members · 9 changed/.test(await table.locator("summary").innerText()), "member summary");
await table.locator("summary").focus();
await page.keyboard.press("Enter");
ok(await table.evaluate(d => d.open), "keyboard opens the member table");
const hari = await dialog.locator('[data-balance-member="b2"]').innerText();
ok(/Dr Hari/.test(hari) && /3rd call/.test(hari) && /\+2/.test(hari) && /20\s*part month/.test(hari), "member row: delta and partial month");
ok(/No posting/.test(await dialog.locator('[data-balance-member="a6"]').innerText()), "unposted member");
ok(!/more than 1 away/.test(await dialog.locator('[data-balance-member="c1"]').innerText()), "within one of share is not flagged");
// Review → Apply.
const apply = dialog.locator("[data-balance-apply]");
eq((await apply.innerText()).trim(), "Apply balance", "apply label");
ok(await apply.isDisabled(), "apply disabled before review");
ok(await page.evaluate(() => document.querySelector("dialog[open]").contains(document.activeElement)), "focus inside the window");
await axe("preview 390");
await noHorizontalScroll("preview at 390px");
await dialog.locator(".mw-content").evaluate(e => { e.scrollTop = 0; });
await shot("balance-preview-390-top");
await dialog.locator(".balance-levels-section").scrollIntoViewIfNeeded();
await shot("balance-preview-390-levels");
await dialog.locator(".balance-moves").scrollIntoViewIfNeeded();
await shot("balance-preview-390-moves");
await table.scrollIntoViewIfNeeded();
await shot("balance-preview-390-members");

// 3. Stale preview → plain message, focus on Preview again, re-preview resets the review.
await dialog.getByLabel("I reviewed these moves").check();
ok(await apply.isEnabled(), "apply enabled after review");
state.applyResponses.push([{ detail: { code: "stale_preview", message: "The rota changed since your preview." } }, 409]);
await apply.click();
await dialog.getByRole("alert").filter({ hasText: "The rota changed since your preview." }).waitFor();
ok(/Nothing was saved\. Preview again/.test(await dialog.getByRole("alert").innerText()), "stale next step");
eq(state.applyBodies.at(-1), { month: MONTH, token: "tok-bal", plan_hash: "plan-bal" }, "apply body");
ok(await page.evaluate(() => document.activeElement?.matches("[data-balance-repreview]")), "focus on Preview again");
await page.keyboard.press("Enter");
await dialog.locator("[data-balance-move]").first().waitFor();
eq(state.previewBodies.length, 2, "re-previewed");
ok(await dialog.locator("[data-balance-apply]").isDisabled(), "review box resets");

// 4. verification_failed lists the violations.
await dialog.getByLabel("I reviewed these moves").check();
state.applyResponses.push([{ detail: { code: "verification_failed", message: "The independent check found a problem.",
  violations: [{ code: "rest", message: "Dr Dev: less than 24 h rest before 5 Nov" }] } }, 500]);
await dialog.locator("[data-balance-apply]").click();
await dialog.getByRole("alert").filter({ hasText: "The independent check found a problem." }).waitFor();
const vf = await dialog.getByRole("alert").innerText();
ok(/The safety check stopped this/.test(vf) && /Dr Dev: less than 24 h rest/.test(vf) && /Nothing was saved/.test(vf), "verification failure explained");
await axe("error 390");
await shot("balance-error-390");

// 5. proposal_active → shared Resume / Cancel panel naming Balance duties.
await dialog.getByRole("button", { name: "Preview again" }).click();
await dialog.locator("[data-balance-move]").first().waitFor();
await dialog.getByLabel("I reviewed these moves").check();
state.applyResponses.push([{ detail: { code: "proposal_active", message: "Another generation proposal is open for this month.",
  job_id: "job-9", kind: "members", status: "running", processed: 4, total: 20, owned: true, operator_name: "Admin", month: MONTH } }, 409]);
await dialog.locator("[data-balance-apply]").click();
await dialog.getByRole("heading", { name: "Another proposal is in progress" }).waitFor();
const conflict = await dialog.innerText();
ok(/You asked for: Balance duties/.test(conflict) && /then balance the duties/.test(conflict), "conflict panel names balance");
await dialog.locator("[data-close]").first().click();
await page.locator("dialog").waitFor({ state: "detached" });

// 6. nothing_to_balance from preview → "Already balanced", nothing to apply.
state.previewResponses.push([{ detail: { code: "nothing_to_balance", message: "No movable duties are left." } }, 409]);
await openBalance();
await dialog.getByText("Already balanced").waitFor();
ok(/No movable duties are left\. Nothing needs to move\./.test(await dialog.locator("[data-balance-notice]").innerText()), "already balanced text");
eq(await dialog.locator("[data-balance-apply]").count(), 0, "no apply when balanced");
ok(await page.evaluate(() => document.activeElement?.matches("[data-balance-notice]")), "focus on the outcome");
await closeWindow();
ok(await page.evaluate(() => document.activeElement?.id === "opener"), "focus returns to the opener");

// 7. Status says balanced → no preview; level list shown.
state.status = { ...unevenStatus(), balanced: true, levels: unevenStatus().levels.map(l => ({ ...l, min: 6, max: 7, gap: 1, ok: true })) };
const previews = state.previewBodies.length;
await openBalance();
await dialog.getByText("Already balanced").waitFor();
eq(state.previewBodies.length, previews, "no preview when the status is balanced");
eq(await dialog.locator(".balance-levels--plain [data-balance-level]").count(), 3, "balanced levels listed");
ok(/6–7 duties · gap 1 · fair share 6–7/.test(await dialog.locator('.balance-levels--plain [data-balance-level="1ST_CALL"]').innerText()), "balanced level line");
await axe("already balanced");
await shot("balance-already-390");
await closeWindow();
state.status = unevenStatus();

// 8. not_draft and disabled explain the next step and offer no apply or retry.
state.previewResponses.push([{ detail: { code: "not_draft", message: "This month is published." } }, 409]);
await openBalance();
await dialog.getByRole("alert").filter({ hasText: "This month is published. Undo the publish first" }).waitFor();
eq(await dialog.locator("[data-balance-apply], [data-balance-repreview]").count(), 0, "no apply or retry on a published month");
await closeWindow();
state.status = { ...unevenStatus(), enabled: false };
await openBalance();
await dialog.getByText("Balance duties is turned off").waitFor();
await closeWindow();
state.status = unevenStatus();
state.previewResponses.push([{ detail: "Server error" }, 500]);
await openBalance();
await dialog.getByRole("button", { name: "Try again" }).waitFor();
await dialog.getByRole("button", { name: "Try again" }).click();
await dialog.locator("[data-balance-move]").first().waitFor();
await closeWindow();

// 9. Apply once (double click) → result with Undo and audit report; undo asks first, then handles a conflict.
await openBalance();
await dialog.locator("[data-balance-move]").first().waitFor();
await dialog.getByLabel("I reviewed these moves").check();
state.applyBodies = [];
await dialog.locator("[data-balance-apply]").dblclick();
await dialog.locator("[data-balance-notice]").filter({ hasText: "Balance applied" }).waitFor();
eq(state.applyBodies, [{ month: MONTH, token: "tok-bal", plan_hash: "plan-bal" }], "single apply");
eq(await page.evaluate(() => window.appliedCount), 1, "onApplied once");
const done = await dialog.locator("[data-balance-notice]").innerText();
ok(/11 duties moved, 1 swap, 3 across units\. 2 of 3 levels are now within the gap; 4th call could not be evened further/.test(done), "result sentence");
ok(await page.evaluate(() => document.activeElement?.matches("[data-balance-notice]")), "focus on the result");
ok(/Before and now/.test(await dialog.locator(".balance-levels-section h3").innerText()), "result shows before and now");
ok(/11\s*duties moved/.test((await dialog.locator(".extra-duty-chip").first().innerText()).replace(/\s+/g, " ")), "result chips");
await dialog.getByRole("button", { name: "Download audit report (HTML)" }).waitFor();
await dialog.getByRole("button", { name: "Download audit report (Excel)" }).waitFor();
ok(/Applied\s*.*11 duties moved · 1 swap/s.test(await dialog.locator('[data-balance-batch="bb-1"]').innerText()), "run listed");
eq(await dialog.locator("[data-balance-reviewed], [data-balance-apply]").count(), 0, "no second apply");
await axe("applied 390");
await noHorizontalScroll("applied at 390px");
await dialog.locator(".mw-content").evaluate(e => { e.scrollTop = 0; });
await shot("balance-applied-390");
await dialog.locator(".balance-batches").scrollIntoViewIfNeeded();
await shot("balance-applied-390-undo");
state.undoResponses.push([{ batch_id: "bb-1", restored: 11, conflicts: [] }, 200]);
await dialog.getByRole("button", { name: "Undo this run" }).click();
await dialog.getByRole("heading", { name: "Undo this balance run?" }).waitFor();
eq(state.undoBodies.at(-1), { dry_run: true }, "undo dry run first");
eq(state.undoPaths.at(-1), "/api/v1/balance-duties/batches/bb-1/undo", "balance undo endpoint");
ok(/puts 11 duties back with the person and unit/.test(await dialog.locator("[data-balance-undo-panel]").innerText()), "undo explains");
ok(await page.evaluate(() => document.activeElement?.matches("[data-balance-undo-panel]")), "focus moves to the undo panel");
await dialog.getByRole("button", { name: "Keep it" }).click();
eq(await dialog.locator("[data-balance-undo-panel]").count(), 0, "keep closes the question");
state.undoResponses.push([{ batch_id: "bb-1", restored: 11, conflicts: [] }, 200]);
state.undoResponses.push([{ detail: { code: "undo_conflict", message: "Some duties changed after balancing.",
  conflicts: [{ slot_id: "m3", duty_date: "2026-11-06", duty_label: "Main 1st call", person_name: "Dr Farah", reason: "Assignment was replaced" }] } }, 409]);
await dialog.getByRole("button", { name: "Undo this run" }).click();
await dialog.getByRole("button", { name: "Yes, undo this run" }).click();
await dialog.getByRole("heading", { name: "This run cannot be undone yet" }).waitFor();
ok(/Fri 6 Nov 2026 · Main 1st call · Dr Farah · Assignment was replaced/.test(await dialog.locator("[data-balance-undo-conflicts]").innerText()), "undo conflict listing");
eq(state.undoBodies.at(-1), { dry_run: false }, "real undo request");
await axe("undo conflict");
await shot("balance-undo-conflict-390");
await dialog.getByRole("button", { name: "Close this message" }).click();
state.undoResponses.push([{ batch_id: "bb-1", restored: 11, conflicts: [] }, 200]);
state.undoResponses.push([{ batch_id: "bb-1", restored: 11, conflicts: [] }, 200]);
state.status = { ...unevenStatus(), batches: [batch] };
await dialog.getByRole("button", { name: "Undo this run" }).click();
await dialog.getByRole("button", { name: "Yes, undo this run" }).click();
state.status = { ...unevenStatus(), batches: [{ ...batch, status: "undone" }] };
await dialog.locator("[data-balance-notice]").filter({ hasText: "Run undone" }).waitFor();
ok(/11 duties put back/.test(await dialog.locator("[data-balance-notice]").innerText()), "undo result");
eq(await page.evaluate(() => window.appliedCount), 2, "onApplied after undo");
await closeWindow();
state.status = unevenStatus();

// 10. Desktop width, light and dark.
await page.setViewportSize({ width: 1280, height: 900 });
await stage({ draft: true, locked: true, assigned: 40 });
await page.waitForFunction(() => document.querySelector("#stages .balance-stage__status")?.dataset.tone === "uneven");
await shot("balance-stage-1280");
await openBalance();
await dialog.locator("[data-balance-move]").first().waitFor();
await noHorizontalScroll("preview at 1280px");
ok(await dialog.locator(".balance-about__never").isVisible(), "explanation visible on desktop");
await shot("balance-preview-1280");
await dialog.locator(".balance-moves").scrollIntoViewIfNeeded();
await shot("balance-preview-1280-moves");
await dialog.locator("[data-balance-members] summary").click();
await dialog.locator("[data-balance-members]").scrollIntoViewIfNeeded();
ok(await dialog.locator(".balance-table thead").isVisible(), "real table on desktop");
await shot("balance-preview-1280-members");
await page.emulateMedia({ colorScheme: "dark" });
await dialog.locator(".mw-content").evaluate(e => { e.scrollTop = 0; });
await shot("balance-preview-1280-dark");
await dialog.locator(".balance-moves").scrollIntoViewIfNeeded();
await shot("balance-preview-1280-dark-moves");
await page.emulateMedia({ colorScheme: "light" });
await closeWindow();

// 11. Option 2 (docs/balance_extra_duties_contract.md §3): extra duties pass on with their ledger credit.
await page.setViewportSize({ width: 390, height: 860 });
const shots2 = process.env.BALANCE2_SHOTS || "";
const shot2 = async (name, full = false) => { if (shots2) await page.screenshot({ path: `${shots2}/balance2-${name}.png`, fullPage: full }); };
const extraMoves = [
  mv(21, "2026-11-03", "Dr Asha", "Dr Chitra", { extra_duty: true, ledger_from: "Dr Asha", ledger_to: "Dr Chitra", new_overridden_rules: ["rebalanced_extra_duty"],
    reason: "Dr Asha took this extra duty when UNIT I was short; Dr Chitra had the fewest and is free that day." }),
  mv(22, "2026-11-07", "Dr Bina", "Dr Farah", { extra_duty: true, ledger_from: "Dr Bina", ledger_to: "Dr Farah", new_overridden_rules: ["unposted_member"],
    to_unit: "UNIT II", cross_unit: true }),
  mv(23, "2026-11-11", "Dr Asha", "Dr Dev"),
];
const extraMembers = members.map(m => ({ ...m, extra_before: { a1: 1, a2: 1 }[m.person_id] ?? 0, extra_after: { a3: 1, a6: 1 }[m.person_id] ?? 0 }));
const extraPreview = () => ({ ...previewBody(), token: "tok-bal2", plan_hash: "plan-bal2", moves: extraMoves, members: extraMembers,
  summary: { moves: 3, swaps: 0, cross_unit: 1, levels_balanced_before: 0, levels_balanced_after: 2, extra_moves: 2 } });
state.previewResponses.push([extraPreview(), 200]);
await openBalance();
await dialog.locator("[data-balance-extra]").first().waitFor();
ok(/Extra duties can be passed on too; the justice-ledger credit moves with the duty\./.test(await dialog.locator(".balance-about").innerText()), "what-this-does names extra duties");
const chips2 = (await dialog.locator(".extra-duty-chip").allInnerTexts()).map(c => c.replace(/\s+/g, " ").trim());
eq(chips2, ["3 duties move", "0 swaps", "1 change unit", "2 extra duties passed on", "0 → 2 of 3 levels balanced"], "extra-duty chip");
eq(await dialog.locator("[data-balance-extra]").evaluateAll(es => es.map(e => e.dataset.balanceMove)), ["m21", "m22"], "only extra-duty moves are flagged");
const e1 = (await dialog.locator('[data-balance-move="m21"]').innerText()).replace(/\s+/g, " ");
ok(/Extra duty/.test(e1) && /Ledger credit moves to Dr Chitra/.test(e1), `extra badge and ledger line: ${e1}`);
ok(/Recorded as: Extra duty passed on by Balance duties/.test(e1), "rebalanced_extra_duty label");
const e2 = (await dialog.locator('[data-balance-move="m22"]').innerText()).replace(/\s+/g, " ");
ok(/Ledger credit moves to Dr Farah/.test(e2) && /Recorded as: Member has no posting this month/.test(e2) && /Changes unit/.test(e2), "second extra move");
ok(!/Ledger credit/.test(await dialog.locator('[data-balance-move="m23"]').innerText()), "ordinary move has no ledger line");
ok(/2 extra duties/.test(await dialog.locator('[data-balance-group="1ST_CALL"] h4').innerText()), "group counts extra duties");
await dialog.locator("[data-balance-members] summary").click();
ok(/Extra duties before → after/.test(await dialog.locator(".balance-table thead").textContent()), "extra column heading");
ok(/1\s*→\s*(to\s*)?0/.test(await dialog.locator('[data-balance-member="a1"] [data-balance-extra-cell]').innerText()), "Asha extra 1 → 0");
ok(/0\s*→\s*(to\s*)?1/.test(await dialog.locator('[data-balance-member="a3"] [data-balance-extra-cell]').innerText()), "Chitra extra 0 → 1");
ok(/none/.test(await dialog.locator('[data-balance-member="b1"] [data-balance-extra-cell]').textContent()), "no extra duties reads as none");
await axe("extra preview 390");
await noHorizontalScroll("extra preview at 390px");
await dialog.locator(".mw-content").evaluate(e => { e.scrollTop = 0; });
await shot2("preview-390-top");
await dialog.locator('[data-balance-move="m21"]').scrollIntoViewIfNeeded();
await shot2("preview-390-moves");
await dialog.locator('[data-balance-member="a1"]').scrollIntoViewIfNeeded();
await shot2("preview-390-members");
await dialog.getByLabel("I reviewed these moves").check();
state.applyResponses.push([{ ...extraPreview(), batch_id: "bb-2" }, 200]);
await dialog.locator("[data-balance-apply]").click();
await dialog.locator("[data-balance-notice]").filter({ hasText: "Balance applied" }).waitFor();
eq(state.applyBodies.at(-1), { month: MONTH, token: "tok-bal2", plan_hash: "plan-bal2" }, "extra apply body");
ok(/2 extra duties passed on; the justice-ledger credit moved with them\./.test(await dialog.locator("[data-balance-notice]").innerText()), "applied notice names the ledger transfer");
await axe("extra applied 390");
await shot2("applied-390");
await closeWindow();
await page.setViewportSize({ width: 1280, height: 900 });
state.previewResponses.push([extraPreview(), 200]);
await openBalance();
await dialog.locator("[data-balance-extra]").first().waitFor();
await dialog.locator(".balance-moves").scrollIntoViewIfNeeded();
await shot2("preview-1280-moves");
await dialog.locator("[data-balance-members] summary").click();
await dialog.locator("[data-balance-members]").scrollIntoViewIfNeeded();
await noHorizontalScroll("extra preview at 1280px");
await shot2("preview-1280-members");
await page.emulateMedia({ colorScheme: "dark" });
await dialog.locator(".balance-moves").scrollIntoViewIfNeeded();
await shot2("preview-1280-dark-moves");
await page.emulateMedia({ colorScheme: "light" });
await closeWindow();

// 12. Stage hint: an extra-duty run after the last balance run asks to balance again.
const balanceRun = { ...batch, created_at: "2026-10-22T09:00:00Z" };
const extraRun = { id: "eb-1", status: "applied", created_at: "2026-10-22T10:00:00Z", created_by_name: "Admin", summary: { filled: 4, mode: "all_units" } };
eq(await page.evaluate(async ([b, e]) => { const m = await import("/src/balance-duties.ts");
  return [m.extraRunSinceBalance([b], [e]), m.extraRunSinceBalance([], [e]), m.extraRunSinceBalance([{ ...b, created_at: "2026-10-22T11:00:00Z" }], [e]),
    m.extraRunSinceBalance([b], [{ ...e, status: "undone" }]), m.extraRunSinceBalance([b], [{ ...e, summary: { mode: "superadmin_allocation" } }]),
    m.extraRunSinceBalance([], [e, { ...b, created_at: "2026-10-22T12:00:00Z" }])]; }, [balanceRun, extraRun]),
  [true, true, false, false, false, false], "extra run since balance");
state.status = { ...unevenStatus(), batches: [balanceRun] };
state.extraStatus = { enabled: true, month: MONTH, open_slots: 0, batches: [extraRun, balanceRun] };
await page.setViewportSize({ width: 390, height: 860 });
await stage({ draft: true, locked: true, assigned: 40 });
await page.waitForFunction(() => document.querySelector("#stages .balance-stage__status")?.dataset.balanceAgain === "1");
eq((await statusLine.innerText()).trim(), "Run Balance duties again to even out the extra duties. 3rd call: 3–8 duties (target 5–6) · 2 more levels uneven", "balance-again hint");
await page.locator("#stages").scrollIntoViewIfNeeded();
await shot2("stage-hint-390");
state.status = { ...unevenStatus(), batches: [{ ...balanceRun, created_at: "2026-10-22T11:00:00Z" }] };
await stage({ draft: true, locked: true, assigned: 40 });
await page.waitForFunction(() => document.querySelector("#stages .balance-stage__status")?.dataset.tone === "uneven");
await page.waitForTimeout(200);
ok(!/Run Balance duties again/.test(await statusLine.innerText()), "no hint once balance ran after the extra duties");
state.status = { ...unevenStatus(), balanced: true, levels: unevenStatus().levels.map(l => ({ ...l, ok: true })) };
await stage({ draft: true, locked: true, assigned: 40 });
await page.waitForFunction(() => document.querySelector("#stages .balance-stage__status")?.dataset.tone === "ok");
await page.waitForTimeout(200);
eq((await statusLine.innerText()).trim(), "Duties are balanced.", "no hint when balanced");
state.extraStatus = null; state.status = unevenStatus();

eq(errors, [], "no page errors");
await browser.close();
console.log(`balance duties UI: all ${checks} checks passed`);
