// Superadmin allocation and publish anyway — docs/superadmin_override_contract.md §3 — with mocked APIs:
// - role gating: the slot action, the publish-anyway control and the full Publish page show nothing to
//   other roles and the controls to a superadmin;
// - allocation: duty summary, Available / Blocked / All chips with counts, search, blocked people disabled
//   with their exact reasons, overrides in amber for the chosen person, reason 5–500 with a counter,
//   confirmation, 409 strict_blocked (reasons + refreshed list), 403, network error, success, published banner;
// - publish anyway: open slots, every blocker and warning, reason, confirmation, POST with the override;
// - Escape and focus return, axe in light and dark, no sideways scroll at 390 px.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5183";
const shots = process.env.SUPERADMIN_SHOTS || "";
const browser = await chromium.launch({ headless: true, executablePath: process.env.MEMBER_TEST_BROWSER || chromium.executablePath() });
const context = await browser.newContext({ viewport: { width: 390, height: 860 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };

const slot = { id: "slot-1", duty_date: "2026-06-12", duty_type: "MAIN_1ST_24HR", duty_label: "Main 1st call", unit_id: "u1", unit_name: "UNIT I",
  call_level: "1ST_CALL", is_24hr: true, starts_at: "2026-06-12T08:00:00", ends_at: "2026-06-13T08:00:00",
  current: [{ assignment_id: "a1", person_id: "p9", person_name: "Dr Current" }] };
const person = (id, name, extra = {}) => ({ person_id: id, person_name: name, call_level: "1ST_CALL", unit_id: "u1", unit_name: "UNIT I",
  status: "available", blocked: [], overrides: [], month_duties: 2, ...extra });
const people = () => [
  person("p1", "Dr Asha", { call_level: "3RD_CALL", unit_name: "UNIT II", month_duties: 5,
    overrides: [{ code: "call_level_mismatch", label: "" }, { code: "not_posted", label: "" }, { code: "monthly_24hr_limit", label: "" }] }),
  person("p2", "Dr Bina", { month_duties: 1 }),
  person("p9", "Dr Current", { note: "Already on this duty" }),
  person("p3", "Dr Chitra", { status: "blocked", blocked: [{ code: "on_leave", label: "On leave", detail: "On approved leave 12 Jun" }] }),
  person("p4", "Dr Dev", { status: "blocked", blocked: [{ code: "rest_after_24hr", label: "Rest", detail: "Resting after 24-hour duty on 11 Jun" }] }),
  person("p5", "Dr Esha", { status: "blocked", unit_name: null, blocked: [{ code: "overlapping_duty", label: "Double duty", detail: "Already on Main 1st Call 08:00–08:00 that day" }] }),
];
const checklist = {
  month: "2026-06", rota_period: { id: "rp", name: "June", starts_on: "2026-06-01", ends_on: "2026-06-30", status: "draft" },
  rule_version: { id: "rv", name: "Rules v3" },
  summary: { total_slots: 120, assigned_slots: 117, open_slots: 3, review_items: 4, hard_blocked_items: 1, override_assignments: 0, pending_exchange_requests: 0 },
  can_publish: false, requires_warning_confirmation: true, can_superadmin_override: true,
  checks: [{ status: "clear", title: "Monthly unit scope", detail: "Units locked." }],
  blockers: [{ status: "blocked", title: "Open slots", detail: "3 slot(s) still need assignment." },
    { status: "blocked", title: "Hard safety blockers", detail: "1 hard-blocked review item(s) must be resolved." }],
  warnings: [{ status: "warning", title: "Unresolved warnings", detail: "2 review item(s) need board confirmation." },
    { status: "warning", title: "Superadmin allocations", detail: "1 superadmin allocation: Dr Bina on 12 Jun." }],
  latest_publish: null,
};
const batchSummary = { filled: 1, ledger_records: 1 };
const edStatus = () => ({ enabled: true, month: "2026-06", open_slots: 2, batches: [
  { id: "b-sa", status: state.saBatchStatus, created_at: "2026-10-21T08:00:00Z", created_by_name: "Super Admin", summary: { ...batchSummary, mode: "superadmin_allocation" } },
  { id: "b-n", status: "applied", created_at: "2026-10-20T08:00:00Z", created_by_name: "Admin", summary: { ...batchSummary, mode: "standard" } }] });
const state = { saBatchStatus: "applied", undoCalls: [], undoQueue: [], optionsCalls: 0, optionsQueue: [], allocBodies: [], allocQueue: [], publishBodies: [], publishQueue: [], role: "superadmin" };

await page.route("**/__superadmin", r => r.fulfill({ contentType: "text/html",
  body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Superadmin test</title><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host"><h1>Test page</h1><button id="opener">Open</button><div id="slot"></div></main></body></html>' }));
await page.route("**/api/**", async r => {
  const url = new URL(r.request().url());
  const method = r.request().method();
  const json = (body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.pathname.endsWith("/superadmin-allocation/options")) {
    state.optionsCalls++;
    eq(url.searchParams.get("slot_id"), "slot-1", "options asks for the slot");
    const next = state.optionsQueue.shift();
    return next ? json(next[0], next[1]) : json({ slot, people: people() });
  }
  if (url.pathname.endsWith("/superadmin-allocation") && method === "POST") {
    state.allocBodies.push(JSON.parse(r.request().postData()));
    await new Promise(res => setTimeout(res, 150));
    const next = state.allocQueue.shift();
    if (next === "abort") return r.abort("connectionfailed");
    const [body, status] = next ?? [{ assignment_id: "a-new", batch_id: "b-1", slot_id: "slot-1", person_id: "p2", person_name: "Dr Bina", overrides: [], post_publish: false }, 200];
    return json(body, status);
  }
  const saUndo = url.pathname.match(/\/superadmin-allocation\/([^/]+)\/undo$/);
  const edUndo = url.pathname.match(/\/extra-duty\/batches\/([^/]+)\/undo$/);
  if (saUndo || edUndo) {
    const body = JSON.parse(r.request().postData());
    state.undoCalls.push({ kind: saUndo ? "superadmin" : "extra-duty", id: (saUndo ?? edUndo)[1], ...body });
    const next = state.undoQueue.shift();
    if (next) return json(next[0], next[1]);
    if (!body.dry_run && saUndo) state.saBatchStatus = "undone";
    return json({ batch_id: (saUndo ?? edUndo)[1], restored: 1, removed: 1, conflicts: [], dry_run: body.dry_run, would_restore: 1 });
  }
  if (url.pathname.endsWith("/extra-duty/status")) return json(edStatus());
  if (url.pathname.endsWith("/extra-duty/unit-fallbacks")) return json([]);
  if (url.pathname.endsWith("/extra-duty/preview")) return json({ month: "2026-06", plan_hash: "h", context_hash: "c", token: "t", generated_at: "2026-10-21T08:00:00Z",
    summary: { filled: 0, fallback: 0, ledger_records: 0, unfilled: 0, slots_considered: 0 }, decisions: [] });
  if (url.pathname.endsWith("/rota-publish/publish") && method === "POST") {
    state.publishBodies.push({ month: url.searchParams.get("month"), ...JSON.parse(r.request().postData()) });
    const next = state.publishQueue.shift();
    const [body, status] = next ?? [{ ...checklist, rota_period: { ...checklist.rota_period, status: "published" },
      latest_publish: { id: "ap", rota_period_id: "rp", approved_by: "Super Admin", status: "published", confirmed_warnings: true,
        approval_note: "x", created_at: "2026-10-21T09:00:00Z", summary: { published_with_override: true, override_reason: "Board meeting cancelled", override_by: "Super Admin", open_slots: 3, blockers: ["Open slots", "Hard safety blockers"] } } }, 200];
    return json(body, status);
  }
  return json({ detail: `unmocked ${url.pathname}` }, 404);
});
await page.goto(base + "/__superadmin");
await page.evaluate(() => localStorage.setItem("duty_rota_auth_token", "test-token"));
await page.reload();

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
  && [...document.querySelectorAll("dialog[open] .mw-content, dialog[open] .mw-footer")].every(e => e.scrollWidth <= e.clientWidth + 1)), `no horizontal scroll: ${label}`);
const shot = async (name, full = false) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: full }); };
const openAllocation = (published = false) => page.evaluate(async published => {
  window.doneCount = window.doneCount || 0;
  document.querySelector("#opener").focus();
  const m = await import("/src/superadmin.ts");
  await m.openSuperadminAllocation("slot-1", r => { window.doneCount++; window.lastDone = r; }, { published });
}, published);
const rows = () => dialog.locator("[data-sa-person]").evaluateAll(es => es.map(e => e.dataset.saPerson));
const chipText = async key => (await dialog.locator(`[data-sa-filter="${key}"]`).innerText()).replace(/\s+/g, " ").trim();

// 1. Role gating of the hooks.
const gating = await page.evaluate(async checklist => {
  const m = await import("/src/superadmin.ts");
  const ext = await import("/src/extra-duty.ts");
  return {
    slotOther: ["computer_admin", "rota_board_member", "hod", "", null].map(r => m.superadminSlotAction("slot-1", r)),
    slotSuper: m.superadminSlotAction("slot-1", "superadmin", { context: "Main 1st call", published: true }),
    publishOther: ["computer_admin", "hod", "rota_board_member", null].map(r => m.publishAnywayControl(checklist, r)),
    publishSuper: m.publishAnywayControl(checklist, "superadmin"),
    publishNoBlockers: m.publishAnywayControl({ ...checklist, blockers: [] }, "superadmin"),
    noticeNone: m.publishOverrideNotice(checklist),
    notice: m.publishOverrideNotice({ ...checklist, latest_publish: { approved_by: "Super Admin", created_at: "2026-10-21T09:00:00Z",
      summary: { published_with_override: true, override_reason: "Board meeting cancelled", open_slots: 3, blockers: ["a", "b"] } } }),
    label: ext.ruleLabel("superadmin_allocation"),
  };
}, checklist);
eq(gating.slotOther, ["", "", "", "", ""], "slot action hidden for every other role");
ok(/data-superadmin-allocate="slot-1"/.test(gating.slotSuper) && /data-superadmin-published="1"/.test(gating.slotSuper) && /Superadmin allocation for Main 1st call/.test(gating.slotSuper), "slot action for superadmin");
eq(gating.publishOther, ["", "", "", ""], "publish anyway hidden for every other role");
ok(/Publish anyway \(superadmin\)/.test(gating.publishSuper) && /2 blockers/.test(gating.publishSuper) && /3 open slots/.test(gating.publishSuper), "publish anyway for superadmin with blockers");
eq(gating.publishNoBlockers, "", "no publish anyway without blockers");
eq(gating.noticeNone, "", "no override notice on a normal month");
ok(/Published with superadmin override/.test(gating.notice) && /Board meeting cancelled/.test(gating.notice) && /3 open slots/.test(gating.notice), "override notice");
eq(gating.label, "Superadmin allocation", "extra-duty code label");

// 2. Allocation: summary, chips, lists, blocked reasons.
await openAllocation();
await dialog.getByRole("heading", { name: "Superadmin allocation" }).waitFor();
await dialog.locator("[data-sa-person]").first().waitFor();
const summary = await dialog.locator(".superadmin-duty").innerText();
for (const text of ["Main 1st call", "Fri 12 Jun 2026", "08:00–08:00 · 24-hour duty", "UNIT I", "1st call", "Dr Current"]) ok(summary.includes(text), `duty summary: ${text}`);
ok(/Allocating replaces Dr Current/.test(summary), "replacement is explained");
eq(await dialog.locator(".superadmin-published-banner").count(), 0, "no published banner on a draft month");
eq([await chipText("available"), await chipText("blocked"), await chipText("all")], ["Available 3", "Blocked 3", "All 6"], "chip counts");
eq(await dialog.locator('[data-sa-filter="available"]').getAttribute("aria-pressed"), "true", "Available is the default");
eq(await rows(), ["p1", "p2", "p9"], "available people first");
ok(/On this duty now/.test(await dialog.locator('[data-sa-person="p9"]').innerText()), "current holder marked");
ok(/3rd call · UNIT II · 5 duties this month/.test(await dialog.locator('[data-sa-person="p1"]').innerText()), "call level, unit, month duties");
ok(await page.evaluate(() => document.activeElement?.matches("[data-sa-search]")), "focus starts on search");
await dialog.locator('[data-sa-filter="blocked"]').click();
eq(await rows(), ["p3", "p4", "p5"], "blocked filter");
for (const [id, reason] of [["p3", "On approved leave 12 Jun"], ["p4", "Resting after 24-hour duty on 11 Jun"], ["p5", "Already on Main 1st Call 08:00–08:00 that day"]]) {
  const row = dialog.locator(`[data-sa-person="${id}"]`);
  ok(await row.locator("input[type=radio]").isDisabled(), `${id} cannot be chosen`);
  eq((await row.locator(".superadmin-person__why").innerText()).trim(), reason, `${id} exact reason`);
}
const red = await dialog.locator('[data-sa-person="p3"] .superadmin-person__why li').evaluate(e => getComputedStyle(e).color);
const errorText = await page.evaluate(() => { const p = document.createElement("span"); p.style.color = "var(--color-error-text)"; document.querySelector("dialog[open]").append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
eq(red, errorText, "blocked reasons are in the error colour");
ok(/No posting/.test(await dialog.locator('[data-sa-person="p5"]').innerText()), "missing unit in words");
await axe("blocked list 390");
await shot("superadmin-blocked-390");
// Search across all.
await dialog.locator('[data-sa-filter="all"]').click();
eq((await rows()).length, 6, "all filter");
await dialog.locator("[data-sa-search]").fill("unit ii");
eq(await rows(), ["p1"], "search by unit");
await dialog.locator("[data-sa-search]").fill("esha");
eq(await rows(), ["p5"], "search by name");
ok(/Showing 1 of 6 people/.test(await dialog.locator("[data-sa-count]").innerText()), "result count");
await dialog.locator("[data-sa-search]").fill("nobody");
ok(/No people match “nobody”/.test(await dialog.locator(".superadmin-empty").innerText()), "empty search");
await dialog.locator("[data-sa-search]").fill("");
await dialog.locator('[data-sa-filter="available"]').click();

// 3. Choosing a person shows the overrides; reason and confirmation gate Allocate.
const allocate = dialog.locator("[data-sa-allocate]");
ok(await allocate.isDisabled(), "allocate disabled before choosing");
await dialog.locator('[data-sa-person="p1"] label').click();
ok(await dialog.locator('[data-sa-person="p1"] input').isChecked(), "Dr Asha chosen");
const overrides = await dialog.locator(".superadmin-selection .superadmin-overrides").innerText();
ok(/This allocation overrides:/.test(overrides), "overrides heading");
for (const text of ["Call level does not match the duty", "Not posted to this unit this month", "Over monthly 24-hour limit"]) ok(overrides.includes(text), `override: ${text}`);
ok(!/call_level_mismatch|not_posted|monthly_24hr/.test(await dialog.locator(".mw-content").innerText()), "no raw codes");
const amber = await dialog.locator(".superadmin-selection .superadmin-overrides").evaluate(e => getComputedStyle(e).borderLeftColor);
ok(amber !== "rgba(0, 0, 0, 0)", "overrides box has its warning edge");
ok(await allocate.isDisabled(), "allocate disabled without a reason");
const reason = dialog.locator("[data-sa-reason]");
await reason.fill("abc");
await dialog.locator("[data-sa-search]").focus();
eq(await reason.getAttribute("aria-invalid"), "true", "short reason flagged");
eq((await dialog.locator("[data-sa-reason-count]").innerText()).trim(), "3 / 500", "counter");
ok(/at least 5 characters \(2 more\)/.test(await dialog.locator("[data-sa-reason-hint]").innerText()), "hint says how many more");
eq(await reason.getAttribute("maxlength"), "500", "max length");
await reason.fill("Unit I short after two sick calls; board agreed by phone.");
eq(await reason.getAttribute("aria-invalid"), "false", "reason accepted");
ok(await allocate.isDisabled(), "allocate disabled without the confirmation");
ok(/tick the confirmation/.test(await dialog.locator("[data-sa-status]").innerText()), "footer says what is missing");
await dialog.getByLabel("I understand this overrides the rota rules").check();
ok(await allocate.isEnabled(), "allocate enabled");
await axe("selection 390");
await noHorizontalScroll("allocation at 390px");
await dialog.locator(".superadmin-selection").scrollIntoViewIfNeeded();
await shot("superadmin-allocate-selected-390");

// 4. 409 strict_blocked: reasons shown, list refreshed, choice cleared, reason kept.
state.allocQueue.push([{ detail: { code: "strict_blocked", message: "Dr Asha cannot take this duty.",
  blocked: [{ code: "on_leave", label: "On leave", detail: "On approved leave 12 Jun (approved a minute ago)" }] } }, 409]);
const refreshed = people().map(p => p.person_id === "p1" ? { ...p, status: "blocked", overrides: [], blocked: [{ code: "on_leave", label: "On leave", detail: "On approved leave 12 Jun (approved a minute ago)" }] } : p);
state.optionsQueue.push([{ slot, people: refreshed }, 200]);
const before = state.optionsCalls;
await allocate.click();
await dialog.getByRole("alert").filter({ hasText: "Dr Asha cannot be allocated." }).waitFor();
const alert = await dialog.getByRole("alert").innerText();
ok(/On approved leave 12 Jun \(approved a minute ago\)/.test(alert) && /Nothing was saved/.test(alert), "409 reasons shown");
eq(state.allocBodies.at(-1), { slot_id: "slot-1", person_id: "p1", reason: "Unit I short after two sick calls; board agreed by phone.", replace_existing: true }, "allocation body");
eq(state.optionsCalls, before + 1, "list refreshed after 409");
eq([await chipText("available"), await chipText("blocked")], ["Available 2", "Blocked 4"], "counts refreshed");
eq(await dialog.locator('input[name="sa-person"]:checked').count(), 0, "choice cleared");
eq(await dialog.locator("[data-sa-reason]").inputValue(), "Unit I short after two sick calls; board agreed by phone.", "reason kept");
ok(await page.evaluate(() => document.activeElement?.matches("[data-sa-notice]")), "focus moves to the message");
ok(await dialog.locator("[data-sa-allocate]").isDisabled(), "allocate disabled again");
await shot("superadmin-409-390");

// 5. 403 and a network failure.
await dialog.locator('[data-sa-person="p2"] label').click();
ok(/Within every rota rule/.test(await dialog.locator(".superadmin-selection .superadmin-overrides").innerText()), "nothing overridden");
if (!(await dialog.getByLabel("I understand this overrides the rota rules").isChecked())) await dialog.getByLabel("I understand this overrides the rota rules").check();
state.allocQueue.push([{ detail: "Superadmin role required" }, 403]);
await dialog.locator("[data-sa-allocate]").click();
await dialog.getByRole("alert").filter({ hasText: "Only a superadmin can make this allocation" }).waitFor();
state.allocQueue.push("abort");
await dialog.locator("[data-sa-allocate]").click();
await dialog.getByRole("alert").filter({ hasText: "No answer from the server." }).waitFor();
await dialog.getByRole("button", { name: "Refresh the list" }).waitFor();

// 6. Success.
state.allocBodies = [];
await dialog.locator("[data-sa-allocate]").dblclick();
await dialog.getByRole("heading", { name: "Allocated" }).waitFor();
eq(state.allocBodies.length, 1, "one POST for a double click");
eq(state.allocBodies[0].person_id, "p2", "Dr Bina allocated");
const success = await dialog.locator("[data-sa-success]").innerText();
ok(/Dr Bina is now on Main 1st call on Fri 12 Jun 2026/.test(success) && /Replaced Dr Current/.test(success) && /justice ledger/.test(success), "success text");
eq(await page.evaluate(() => window.doneCount), 1, "onDone once");
await page.locator(".toast.success").filter({ hasText: "Dr Bina allocated by superadmin override" }).waitFor();
ok(/Undo removes this allocation and puts Dr Current back on the duty/.test(await dialog.locator("[data-sa-undo-panel]").innerText()), "undo offered");
await axe("success 390");
await shot("superadmin-success-390");
// Undo from the success state: conflict first, then dry run, confirm, undo.
state.undoQueue.push([{ detail: { code: "undo_conflict", message: "Changed later", conflicts: [{ slot_id: "slot-1", code: "changed", message: "Main 1st call on 12 Jun was changed after the allocation" }] } }, 409]);
await dialog.getByRole("button", { name: "Undo this allocation" }).click();
await dialog.getByText("This allocation cannot be undone yet.").waitFor();
ok(/was changed after the allocation/.test(await dialog.locator("[data-sa-undo-panel]").innerText()), "undo conflict listed");
eq(state.undoCalls.at(-1), { kind: "superadmin", id: "b-1", dry_run: true }, "dry run goes to the superadmin undo endpoint");
await dialog.getByRole("button", { name: "Close this message" }).click();
await dialog.getByRole("button", { name: "Undo this allocation" }).click();
await dialog.getByRole("button", { name: "Yes, undo it" }).waitFor();
ok(await page.evaluate(() => document.activeElement?.matches("[data-sa-undo-confirm]")), "focus on the confirm button");
await dialog.getByRole("button", { name: "Yes, undo it" }).click();
await dialog.getByText("Allocation undone.").waitFor();
eq(state.undoCalls.at(-1), { kind: "superadmin", id: "b-1", dry_run: false }, "undo body");
eq(await page.evaluate(() => window.doneCount), 2, "page refreshed after undo");
await shot("superadmin-undone-390");
state.saBatchStatus = "applied";
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });
ok(await page.evaluate(() => document.activeElement?.id === "opener"), "focus returns to the opener");

// 7. Published month banner; load errors.
await openAllocation(true);
await dialog.locator("[data-sa-person]").first().waitFor();
ok(/This changes a published rota\./.test(await dialog.locator(".superadmin-published-banner").innerText()), "published banner");
state.allocQueue.push([{ assignment_id: "a2", batch_id: "b-2", slot_id: "slot-1", person_id: "p1", person_name: "Dr Asha", overrides: ["call_level_mismatch"], post_publish: true }, 200]);
await dialog.locator('[data-sa-person="p1"] label').click();
await dialog.locator("[data-sa-reason]").fill("Post-publish swap agreed by HOD.");
await dialog.getByLabel("I understand this overrides the rota rules").check();
await shot("superadmin-published-390");
await dialog.locator("[data-sa-allocate]").click();
await dialog.getByText("Recorded as a change to the published rota.").waitFor();
ok(/Call level does not match the duty/.test(await dialog.locator("[data-sa-success]").innerText()), "overrides in the result");
await dialog.locator("[data-sa-done-close]").click();
await page.locator("dialog").waitFor({ state: "detached" });
state.optionsQueue.push([{ detail: "Superadmin role required" }, 403]);
await openAllocation();
await dialog.getByRole("alert").filter({ hasText: "Only a superadmin can make this allocation." }).waitFor();
eq(await dialog.locator("[data-sa-retry]").count(), 0, "no retry for 403");
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });
state.optionsQueue.push([{ detail: "boom" }, 500]);
await openAllocation();
await dialog.locator("[data-sa-retry]").click();
await dialog.locator("[data-sa-person]").first().waitFor();
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });

// 7b. Different call level (docs/limits_callevel_fairness_contract.md §1): own chip, strict warning, separate confirmation.
const crossPeople = () => [
  ...people(),
  person("p6", "Dr Farah", { call_level: "4TH_CALL", status: "cross_level", warning: "Different call level: needs 1st call, Dr Farah is 4th call",
    overrides: [{ code: "superadmin_cross_level", label: "" }] }),
];
state.optionsQueue.push([{ slot, people: crossPeople() }, 200]);
await openAllocation();
await dialog.locator("[data-sa-person]").first().waitFor();
eq([await chipText("available"), await chipText("cross_level"), await chipText("blocked"), await chipText("all")],
  ["Available 3", "Different call level 1", "Blocked 3", "All 7"], "chip counts with a different call level");
eq(await rows(), ["p1", "p2", "p9"], "cross-level people are not under Available");
await dialog.locator('[data-sa-filter="cross_level"]').click();
eq(await rows(), ["p6"], "Different call level filter");
ok(/Showing 1 of 1 different-call-level people/.test(await dialog.locator("[data-sa-count]").innerText()), "count wording");
const crossRow = dialog.locator('[data-sa-person="p6"]');
eq((await crossRow.locator(".superadmin-person__cross").innerText()).trim().replace(/^!\s*/, ""), "Different call level: needs 1st call, Dr Farah is 4th call", "row warning in the server's words");
ok(await crossRow.locator("input[type=radio]").isEnabled(), "a cross-level person can be chosen");
await crossRow.locator("label").click();
const crossPanel = dialog.locator("[data-sa-cross]");
await crossPanel.waitFor();
ok(/This crosses call level/.test(await crossPanel.innerText()) && /Needs 1st call; Dr Farah is 4th call\. This is recorded and shown in Publish and the audit report\./.test(await crossPanel.innerText()), "strict warning panel");
ok(/Call level crossed by superadmin/.test(await dialog.locator(".superadmin-selection .superadmin-overrides").innerText()), "override label");
await dialog.locator("[data-sa-reason]").fill("Only senior free; HOD agreed on the phone.");
await dialog.getByLabel("I understand this overrides the rota rules").check();
ok(await dialog.locator("[data-sa-allocate]").isDisabled(), "allocate needs the call-level confirmation too");
ok(/confirm the call level crossing/.test(await dialog.locator("[data-sa-status]").innerText()), "footer names the missing confirmation");
await dialog.locator("[data-sa-cross-confirm]").check();
ok(await dialog.locator("[data-sa-allocate]").isEnabled(), "allocate enabled after both confirmations");
await axe("cross level 390");
await noHorizontalScroll("cross level at 390px");
await crossPanel.scrollIntoViewIfNeeded();
await shot("superadmin-cross-level-390");
// 409: the server wants the confirmation (for example the level changed meanwhile).
state.allocQueue.push([{ detail: { code: "cross_level_confirmation_required", message: "Dr Farah is 4th call; this duty needs 1st call." } }, 409]);
state.optionsQueue.push([{ slot, people: crossPeople() }, 200]);
await dialog.locator("[data-sa-allocate]").click();
await dialog.getByRole("alert").filter({ hasText: "Call level confirmation needed." }).waitFor();
ok(/Nothing was saved/.test(await dialog.getByRole("alert").innerText()), "409 says nothing was saved");
eq(state.allocBodies.at(-1).confirm_cross_level, true, "POST carries confirm_cross_level");
ok(!(await dialog.locator("[data-sa-cross-confirm]").isChecked()), "call-level confirmation asked again");
ok(await dialog.locator("[data-sa-allocate]").isDisabled(), "allocate disabled until confirmed again");
await dialog.locator("[data-sa-cross-confirm]").check();
state.allocQueue.push([{ assignment_id: "a3", batch_id: "b-3", slot_id: "slot-1", person_id: "p6", person_name: "Dr Farah", overrides: ["superadmin_cross_level"], post_publish: false }, 200]);
await dialog.locator("[data-sa-allocate]").click();
await dialog.getByRole("heading", { name: "Allocated" }).waitFor();
eq(state.allocBodies.at(-1), { slot_id: "slot-1", person_id: "p6", reason: "Only senior free; HOD agreed on the phone.", replace_existing: true, confirm_cross_level: true }, "cross-level POST body");
ok(/Call level crossed by superadmin/.test(await dialog.locator("[data-sa-success]").innerText()), "success names the crossing");
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });

// 8. Publish anyway.
const openPublish = (data = checklist) => page.evaluate(async data => {
  window.publishedCount = window.publishedCount || 0;
  document.querySelector("#opener").focus();
  const m = await import("/src/superadmin.ts");
  await m.openPublishAnyway("2026-06", data, r => { window.publishedCount++; window.lastPublish = r; });
}, data);
await openPublish();
await dialog.getByRole("heading", { name: "Publish anyway (superadmin)" }).waitFor();
const chips = (await dialog.locator(".extra-duty-chip").allInnerTexts()).map(c => c.replace(/\s+/g, " ").trim());
eq(chips, ["3 open slots", "2 blockers", "2 warnings"], "publish chips");
const blockers = await dialog.locator(".superadmin-issues--blockers").innerText();
ok(/Open slots/.test(blockers) && /3 slot\(s\) still need assignment\./.test(blockers) && /Hard safety blockers/.test(blockers), "every blocker listed");
const warnings = await dialog.locator(".superadmin-issues--warnings").innerText();
ok(/Unresolved warnings/.test(warnings) && /Superadmin allocations/.test(warnings), "every warning listed");
const publishBtn = dialog.locator("[data-sa-publish]");
eq((await publishBtn.innerText()).trim(), "Publish anyway", "danger button label");
ok(await publishBtn.isDisabled(), "disabled at first");
ok(await page.evaluate(() => document.activeElement?.matches("[data-sa-reason]")), "focus on the reason");
await dialog.locator("[data-sa-reason]").fill("Rota");
ok(await publishBtn.isDisabled(), "short reason keeps it disabled");
await dialog.locator("[data-sa-reason]").fill("Board meeting cancelled; ward needs the rota today.");
await dialog.getByLabel("I understand this publishes the rota with open slots and unresolved blockers").check();
ok(await publishBtn.isEnabled(), "enabled after reason and confirmation");
const bg = await publishBtn.evaluate(e => getComputedStyle(e).backgroundColor);
eq(bg, "rgb(159, 29, 53)", "danger style");
await axe("publish anyway 390");
await noHorizontalScroll("publish anyway at 390px");
await shot("superadmin-publish-anyway-390");
state.publishQueue.push([{ detail: "Superadmin role required" }, 403]);
await publishBtn.click();
await dialog.getByRole("alert").filter({ hasText: "Only a superadmin can publish with an override" }).waitFor();
await dialog.locator("[data-sa-publish]").click();
await dialog.getByRole("heading", { name: "Published with superadmin override" }).waitFor();
eq(state.publishBodies.at(-1), { month: "2026-06", confirm_warnings: true, approval_note: "Board meeting cancelled; ward needs the rota today.",
  superadmin_override: true, override_reason: "Board meeting cancelled; ward needs the rota today." }, "publish body");
eq(await page.evaluate(() => window.publishedCount), 1, "onDone once");
await axe("published 390");
await shot("superadmin-published-with-override-390");
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });

// 9. Extra-duty window: superadmin batches undo through their own endpoint, only for a superadmin.
const openExtra = role => page.evaluate(async role => {
  (await import("/src/session-role.ts")).setRoleSource(() => role);
  document.querySelector("#opener").focus();
  await (await import("/src/extra-duty.ts")).openExtraDuty("2026-06", () => {});
}, role);
await openExtra("computer_admin");
await dialog.locator("[data-superadmin-batch]").waitFor();
ok(/Superadmin allocation/.test(await dialog.locator("[data-superadmin-batch]").innerText()), "superadmin batch labelled");
eq(await dialog.locator("[data-superadmin-batch] [data-extra-undo]").count(), 0, "no superadmin undo for other roles");
eq(await dialog.locator('[data-batch="b-n"] [data-extra-undo]').count(), 1, "normal batch keeps its undo");
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });
await openExtra("superadmin");
await dialog.locator("[data-superadmin-batch] [data-extra-undo]").waitFor();
eq((await dialog.locator("[data-superadmin-batch] [data-extra-undo]").innerText()).trim(), "Undo this allocation", "superadmin undo label");
await dialog.locator('[data-batch="b-n"] [data-extra-undo]').click();
await dialog.getByRole("heading", { name: "Undo this batch?" }).waitFor();
eq(state.undoCalls.at(-1), { kind: "extra-duty", id: "b-n", dry_run: true }, "normal batch uses the planner endpoint");
await dialog.getByRole("button", { name: "Keep it" }).click();
await dialog.locator("[data-superadmin-batch] [data-extra-undo]").click();
await dialog.getByRole("heading", { name: "Undo this batch?" }).waitFor();
eq(state.undoCalls.at(-1), { kind: "superadmin", id: "b-sa", dry_run: true }, "batch dry run uses the superadmin endpoint");
ok(/removes the superadmin allocation/.test(await dialog.locator("[data-undo-panel]").innerText()), "superadmin undo text");
await dialog.getByRole("button", { name: "Yes, undo this batch" }).click();
await dialog.getByText(/Batch undone\./).waitFor();
eq(state.undoCalls.at(-1), { kind: "superadmin", id: "b-sa", dry_run: false }, "batch undo uses the superadmin endpoint");
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });

// 10. Desktop and dark.
await page.setViewportSize({ width: 1280, height: 900 });
await openAllocation(true);
await dialog.locator("[data-sa-person]").first().waitFor();
await dialog.locator('[data-sa-person="p1"] label').click();
await noHorizontalScroll("allocation at 1280px");
await shot("superadmin-allocate-1280");
await page.emulateMedia({ colorScheme: "dark" });
await dialog.locator('[data-sa-filter="all"]').click();
await shot("superadmin-allocate-1280-dark");
await page.emulateMedia({ colorScheme: "light" });
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });
await openPublish();
await shot("superadmin-publish-anyway-1280");
await page.emulateMedia({ colorScheme: "dark" });
await shot("superadmin-publish-anyway-1280-dark");
await page.emulateMedia({ colorScheme: "light" });
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });

// 11. Full app: the hooks appear only for a superadmin (Publish and Rota Review), and the
// published-with-override state shows on Publish.
const reviewMonth = {
  month: "2026-06", rota_period: { ...checklist.rota_period }, scope: { id: "sc", is_locked: true },
  summary: { total_slots: 120, assigned_slots: 119, open_slots: 1, review_items: 1, hard_blocked_items: 0, override_assignments: 0, exchange_requests: 0, pending_exchange_requests: 0 },
  review_items: [{ slot: { id: "slot-1", duty_date: "2026-06-12", duty_type: "MAIN_1ST_24HR", unit_id: "u1", unit_name: "UNIT I", unit_code: "UNIT_I", call_level: "1ST_CALL",
    slot_label: "MAIN_1ST_24HR:primary", starts_at: "2026-06-12T08:00:00", ends_at: "2026-06-13T08:00:00", is_24hr: true, max_assignees: 1 },
    severity: "error", issues: [{ code: "open_slot", message: "No one assigned", severity: "error" }], safety: null, assignments: [], candidates: [], recommended_action: "Assign a member" }],
  person_workload: [], call_level_fairness: [], exchange_requests: [], assignment_options: [],
};
async function appPage(role, publish) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const pageErrors = [];
  let current = publish;
  p.on("pageerror", e => pageErrors.push(e.message));
  await p.addInitScript(() => localStorage.setItem("duty_rota_auth_token", "test-token"));
  await p.route("**/api/**", r => {
    const u = new URL(r.request().url());
    if (u.pathname.endsWith("/auth/me")) return r.fulfill({ json: { id: "u", username: role, display_name: role, email: null, role, role_label: role, active_status: "active", permissions: ["publish_rota"] } });
    if (u.pathname.endsWith("/api/health")) return r.fulfill({ json: { status: "ok" } });
    if (u.pathname.endsWith("/rota-publish/month")) return r.fulfill({ json: current });
    if (u.pathname.endsWith("/rota-review/month")) return r.fulfill({ json: reviewMonth });
    if (u.pathname.endsWith("/admin/members")) return r.fulfill({ json: [] });
    if (u.pathname.endsWith("/superadmin-allocation/options")) return r.fulfill({ json: { slot, people: people() } });
    if (u.pathname.endsWith("/rota-publish/publish")) return r.fulfill({ json: current = { ...publish, latest_publish: { id: "ap", rota_period_id: "rp", approved_by: "S", status: "published", confirmed_warnings: true, approval_note: "x", created_at: "2026-10-21T09:00:00Z", summary: { published_with_override: true, override_reason: "Ward needs it today", open_slots: 3, blockers: ["a", "b"] } } } });
    return r.fulfill({ status: 404, json: { detail: "not mocked" } });
  });
  return { ctx, p, pageErrors };
}
for (const role of ["rota_board_member", "computer_admin", "superadmin"]) {
  const { ctx, p, pageErrors } = await appPage(role, checklist);
  await p.goto(base + "/#view=rota-publish");
  await p.locator("#publish-checklist-title").waitFor();
  eq(await p.locator("[data-superadmin-publish-anyway]").count(), role === "superadmin" ? 1 : 0, `publish anyway visible only to superadmin (${role})`);
  await p.goto(base + "/#view=rota-review");
  await p.locator("[data-open-rota-review-slot]").first().waitFor();
  eq(await p.locator("[data-superadmin-allocate]").count(), role === "superadmin" ? 1 : 0, `review slot action only for superadmin (${role})`);
  if (role === "superadmin") {
    await p.locator("[data-superadmin-allocate]").click();
    await p.locator("dialog[open] [data-sa-person]").first().waitFor();
    ok(/Main 1st call/.test(await p.locator("dialog[open] .superadmin-duty").innerText()), "allocation opens from the review row");
    await p.keyboard.press("Escape");
    await p.locator("dialog").waitFor({ state: "detached" });
    await p.goto(base + "/#view=rota-publish");
    await p.locator("[data-superadmin-publish-anyway]").click();
    await p.locator("dialog[open] [data-sa-reason]").fill("Ward needs it today");
    await p.locator("dialog[open] [data-sa-confirm]").check();
    await p.locator("dialog[open] [data-sa-publish]").click();
    await p.locator("dialog[open]").getByRole("heading", { name: "Published with superadmin override" }).waitFor();
    await p.locator("dialog[open] [data-close]").first().click();
    await p.locator("[data-published-with-override]").waitFor();
    ok(/Ward needs it today/.test(await p.locator("[data-published-with-override]").innerText()), "publish page shows the override state");
    await p.locator("[data-published-with-override]").scrollIntoViewIfNeeded();
    if (shots) await p.screenshot({ path: `${shots}/superadmin-publish-page-1280.png` });
  }
  eq(pageErrors, [], `no page errors (${role})`);
  await ctx.close();
}

eq(errors, [], "no page errors");
await browser.close();
console.log(`superadmin UI: all ${checks} checks passed`);
