// Extra-duty layer UI (docs/extra_duty_contract.md §8), with mocked APIs:
// - preview: chips, table, fallback badge, overridden rules in plain words, justice text, unfilled reasons;
// - apply is disabled until the review box is ticked, posts {month, token, plan_hash}, never double-submits;
// - 409 stale_preview -> exact message + "Preview again"; 409 proposal_active -> Resume/Cancel panel;
// - undo asks first and lists undo conflicts; audit report downloads carry the bearer token;
// - member ledger (active + void); unit fallback editor reorders and saves the exact order;
// - axe serious/critical = 0, no horizontal scroll at 390px, focus starts on the first control, Escape closes.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const browser = await chromium.launch({ headless: true, executablePath: process.env.MEMBER_TEST_BROWSER || chromium.executablePath() });
const context = await browser.newContext({ viewport: { width: 390, height: 860 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };

const U1 = "u-1", U2 = "u-2", U3 = "u-3", U4 = "u-4";
const justice = (ledger, month, h24 = 0, rest = 40, last = null) => ({ ledger_count: ledger, last_extra_date: last, month_duties: month, month_24hr: h24, rest_hours: rest });
const previewBody = () => ({
  month: "2026-11", plan_hash: "plan-abc", context_hash: "ctx-1", token: "tok-123", generated_at: "2026-10-21T08:00:00Z",
  summary: { filled: 3, fallback: 1, ledger_records: 2, unfilled: 1, slots_considered: 4 },
  decisions: [
    { slot_id: "s1", action: "assign", person_id: "p1", person_name: "Dr Asha", home_unit_id: U1, assigned_unit_id: U1,
      overridden_rules: ["monthly_24hr_limit"], ledger: true, justice: justice(0, 3, 1, 48), reason: "",
      duty_date: "2026-11-03", duty_type: "MAIN_1ST_24HR",
      alternatives: [{ person_id: "p4", person_name: "Dr Dev", justice: justice(1, 2, 0, 30, "2026-08-14") }] },
    { slot_id: "s2", action: "assign_fallback", person_id: "p2", person_name: "Dr Bina", home_unit_id: U1, assigned_unit_id: U2,
      overridden_rules: ["unit_safety_hard_block", "monthly_same_campus_limit"], ledger: true, justice: justice(1, 4, 2, 60, "2026-07-02"), reason: "",
      duty_date: "2026-11-04", duty_label: "Main 1st call 24 hr", alternatives: [] },
    { slot_id: "s3", action: "assign", person_id: "p3", person_name: "Dr Chitra", home_unit_id: U2, assigned_unit_id: U2,
      overridden_rules: [], ledger: false, justice: justice(0, 1, 0, null), reason: "", duty_date: "2026-11-05", duty_type: "DAY_DUTY", alternatives: [] },
    { slot_id: "s4", action: "unfilled", person_id: null, person_name: null, home_unit_id: U3, assigned_unit_id: null,
      overridden_rules: [], ledger: false, justice: null, alternatives: [], duty_date: "2026-11-06", duty_type: "NIGHT_DUTY",
      reason: "UNIT III: 3 on leave, 2 resting after 24h; UNIT II: no one free" },
  ],
});
const state = {
  status: { enabled: true, month: "2026-11", open_slots: 4, batches: [] },
  applyResponses: [], applyBodies: [], previewCalls: 0, undoBodies: [], undoResponses: [], reportRequests: [],
  fallbacks: [
    { unit_id: U1, unit_name: "UNIT I", fallbacks: [{ unit_id: U2, unit_name: "UNIT II" }, { unit_id: U3, unit_name: "UNIT III" }] },
    { unit_id: U2, unit_name: "UNIT II", fallbacks: [] },
    { unit_id: U3, unit_name: "UNIT III", fallbacks: [] },
    { unit_id: U4, unit_name: "UNIT IV", fallbacks: [] },
  ],
  putBodies: [], jobs: [], balanceUndo: [],
};
const applied = { batch_id: "b-1", summary: { filled: 3, fallback: 1, ledger_records: 2, unfilled: 1, slots_considered: 4 }, decisions: previewBody().decisions };
const ledgerRows = [
  { id: "r1", person_id: "p1", person_name: "Dr Asha", duty_date: "2026-11-03", duty_type: "MAIN_1ST_24HR", home_unit: "UNIT I", assigned_unit: "UNIT I",
    fallback_used: false, overridden_rules: ["monthly_24hr_limit"], status: "active", void_reason: null, batch_id: "b-1", created_at: "2026-10-21T08:00:00Z" },
  { id: "r2", person_id: "p1", person_name: "Dr Asha", duty_date: "2026-09-12", duty_type: "NIGHT_DUTY", home_unit: "UNIT I", assigned_unit: "UNIT II",
    fallback_used: true, overridden_rules: ["unit_safety_review"], status: "void", void_reason: "Assignment cleared", batch_id: "b-0", created_at: "2026-09-01T08:00:00Z" },
];
// Ledger rows passed on by Balance duties (docs/balance_extra_duties_contract.md §2): display strings, objects, or only the flag.
const transferRows = [
  { id: "t1", person_id: "p3", person_name: "Dr Chitra", duty_date: "2026-11-03", duty_type: "MAIN_1ST_24HR", home_unit: "UNIT I", assigned_unit: "UNIT II",
    fallback_used: true, overridden_rules: ["rebalanced_extra_duty"], status: "active", void_reason: null, batch_id: "b-1", created_at: "2026-10-21T08:00:00Z",
    rebalanced: true, transfers: [{ from_person_id: "p1", from_person_name: "Dr Asha", to_person_id: "p3", to_person_name: "Dr Chitra", balance_batch_id: "bb-2",
      at: "2026-10-22T10:00:00Z", old_overridden_rules: ["monthly_24hr_limit"], text: "Passed on from Dr Asha by Balance duties on 22 Oct" }] },
  { id: "t2", person_id: "p3", person_name: "Dr Chitra", duty_date: "2026-11-07", duty_type: "NIGHT_DUTY", home_unit: "UNIT I", assigned_unit: "UNIT I",
    fallback_used: false, overridden_rules: ["unposted_member"], status: "active", void_reason: null, batch_id: "b-1", created_at: "2026-10-21T08:00:00Z",
    rebalanced: true, transfers: [{ from_person_id: "p1", from_person_name: "Dr Bina", to_person_id: "p3", to_person_name: "Dr Chitra", balance_batch_id: "bb-2", at: "2026-10-22T10:00:00Z" }] },
  { id: "t3", person_id: "p3", person_name: "Dr Chitra", duty_date: "2026-11-09", duty_type: "NIGHT_DUTY", home_unit: "UNIT I", assigned_unit: "UNIT I",
    fallback_used: false, overridden_rules: ["monthly_24hr_limit"], status: "active", void_reason: null, batch_id: "b-1", created_at: "2026-10-21T08:00:00Z",
    rebalanced: false, transfers: [] },
];

await page.route("**/__extra", r => r.fulfill({ contentType: "text/html",
  body: '<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Extra duty test</title><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main id="host"><h1>Test page</h1><button id="opener">Open</button><div id="slot"></div></main></body></html>' }));
await page.route("**/api/**", async r => {
  const url = new URL(r.request().url());
  const method = r.request().method();
  const path = url.pathname.replace(/^.*\/api\/v1\/extra-duty/, "");
  const json = (body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (path === "/status") return json(state.status);
  if (path === "/unit-fallbacks" && method === "GET") return json(state.fallbacks);
  const put = path.match(/^\/unit-fallbacks\/([^/]+)$/);
  if (put && method === "PUT") {
    const body = JSON.parse(r.request().postData()); state.putBodies.push({ unit: put[1], body });
    const names = Object.fromEntries(state.fallbacks.map(f => [f.unit_id, f.unit_name]));
    return json({ unit_id: put[1], unit_name: names[put[1]], fallbacks: body.fallback_unit_ids.map(id => ({ unit_id: id, unit_name: names[id] })) });
  }
  if (path === "/preview") { state.previewCalls++; return json(previewBody()); }
  if (path === "/apply") {
    state.applyBodies.push(JSON.parse(r.request().postData()));
    await new Promise(res => setTimeout(res, 250));
    const [body, status] = state.applyResponses.shift() ?? [applied, 200];
    if (status === 200) state.status = { ...state.status, batches: [{ id: "b-1", status: "applied", created_at: "2026-10-21T08:05:00Z", created_by_name: "Admin", summary: applied.summary }] };
    return json(body, status);
  }
  if (/\/api\/v1\/balance-duties\/batches\/[^/]+\/undo$/.test(url.pathname)) {
    state.balanceUndo.push({ path: url.pathname, body: JSON.parse(r.request().postData()) });
    return json({ batch_id: "bb-1", restored: 11, conflicts: [] });
  }
  const undo = path.match(/^\/batches\/([^/]+)\/undo$/);
  if (undo) { state.undoBodies.push(JSON.parse(r.request().postData())); const [body, status] = state.undoResponses.shift(); return json(body, status); }
  if (path === "/ledger") return json(url.searchParams.get("person_id") === "p1" ? ledgerRows : url.searchParams.get("person_id") === "p3" ? transferRows : []);
  if (path === "/report") {
    state.reportRequests.push({ auth: r.request().headers()["authorization"], format: url.searchParams.get("format"), month: url.searchParams.get("month") });
    const xlsx = url.searchParams.get("format") === "xlsx";
    return r.fulfill({ status: 200, contentType: xlsx ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/html",
      headers: { "Content-Disposition": `attachment; filename="rota-360-2026-11.${xlsx ? "xlsx" : "html"}"` }, body: xlsx ? "PK-binary" : "<html>report</html>" });
  }
  if (url.pathname.endsWith("/rota-compute/jobs") && method === "GET") return json(state.jobs);
  return json({ detail: `unmocked ${url.pathname}` }, 404);
});
await page.goto(base + "/__extra");
await page.evaluate(() => localStorage.setItem("duty_rota_auth_token", "test-token"));
await page.reload();
const open = () => page.evaluate(async () => {
  window.appliedCount = window.appliedCount || 0;
  document.querySelector("#opener").focus();
  const m = await import("/src/extra-duty.ts");
  await m.openExtraDuty("2026-11", () => { window.appliedCount++; });
});
const dialog = page.locator("dialog[open]");
const axe = async (include = "dialog") => {
  const result = await new AxeBuilder({ page }).include(include).analyze();
  eq(result.violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => `${v.id}: ${v.nodes[0]?.target}`), [], `axe ${include}`);
};
const noHorizontalScroll = async label => ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
  && [...document.querySelectorAll("dialog[open] .mw-content")].every(e => e.scrollWidth <= e.clientWidth + 1)), `no horizontal scroll: ${label}`);

// 1. Preview renders the plan in plain words.
await open();
await dialog.getByRole("heading", { name: "Extra-duty layer" }).waitFor();
await dialog.locator("[data-decision]").first().waitFor();
const text = await dialog.innerText();
ok(text.includes("Leave and rest after 24-hour duties are never broken. Unit staffing limits and equal-duty fairness may be exceeded; every such duty is recorded in the ledger, and whoever did one goes down the list next time."), "strict-rules explanation");
const chips = await dialog.locator(".extra-duty-chip").allInnerTexts();
eq(chips.map(c => c.replace(/\s+/g, " ").trim()), ["3 to fill", "1 with a fallback unit", "2 ledger records", "1 cannot be filled"], "summary chips");
eq(await dialog.locator("[data-decision]").count(), 3, "three filled rows");
ok(/Fallback from UNIT I/.test(await dialog.locator('[data-decision="s2"]').innerText()), "fallback badge");
ok(/UNIT II/.test(await dialog.locator('[data-decision="s2"] td[data-label="Unit"]').innerText()), "assigned unit name from unit list");
ok(/Over monthly 24-hour limit/.test(await dialog.locator('[data-decision="s1"]').innerText()), "rule in plain words");
ok(/Unit short-staffed \(hard block\)/.test(await dialog.locator('[data-decision="s2"]').innerText()), "hard block in plain words");
ok(/Over monthly limit for this campus/.test(await dialog.locator('[data-decision="s2"]').innerText()), "campus limit in plain words");
ok(!/monthly_24hr_limit|unit_safety|_/.test(await dialog.locator("table").innerText()), "no codes in the table");
ok(/0 extra duties in the last 12 months · 3 duties this month/.test(await dialog.locator('[data-decision="s1"]').innerText()), "justice text");
ok(/1 extra duty in the last 12 months · last one 2 Jul 2026/.test(await dialog.locator('[data-decision="s2"]').innerText()), "justice last date");
ok(/None — within every rule/.test(await dialog.locator('[data-decision="s3"]').innerText()), "no override row");
const unfilled = await dialog.locator(".extra-duty-unfilled").innerText();
ok(/Cannot be filled \(1\)/.test(unfilled) && /UNIT III: 3 on leave, 2 resting after 24h/.test(unfilled), "unfilled reasons");
// Keyboard: focus starts on the first actionable control inside the window.
ok(await page.evaluate(() => {
  const d = document.querySelector("dialog[open]");
  const first = d.querySelector(".mw-content :is(button:not([disabled]), input:not([disabled]), summary, a[href]), .mw-footer :is(input:not([disabled]), button:not([disabled]))");
  return Boolean(first) && document.activeElement === first;
}), "focus starts on first actionable control");
await dialog.locator('[data-decision="s1"] summary').click();
ok(/Dr Dev/.test(await dialog.locator('[data-decision="s1"] .extra-duty-alternatives').innerText()), "alternatives listed");
await axe();
await noHorizontalScroll("preview at 390px");
// The window offers fill-all as a separate, secondary step (never the first focus).
const fillAllCta = dialog.locator(".fill-all-cta");
ok(/Duties still open\?/.test(await fillAllCta.innerText()) && await fillAllCta.getByRole("button", { name: "Fill remaining duties (all units)" }).isVisible(), "fill-all entry in the window");
ok(await page.evaluate(() => !document.activeElement?.matches("[data-open-fill-all]")), "fill-all button is not the first focus");
eq(await page.evaluate(async () => { const m = await import("/src/extra-duty.ts");
  return ["any_unit", "outside_scope_unit", "unposted_member", "unit_rule"].map(m.ruleLabel); }),
  ["Covered from another unit", "Covered from a unit outside this month's scope", "Member has no posting this month", "Duty not allowed for this unit"], "fill-all code labels");
eq(await page.evaluate(async () => (await import("/src/extra-duty.ts")).ruleLabel("rebalanced_extra_duty")), "Extra duty passed on by Balance duties", "rebalanced_extra_duty label");

// 2. Apply is disabled until reviewed; stale preview explains and offers Preview again.
const apply = dialog.locator("[data-extra-apply]");
ok(await apply.isDisabled(), "apply disabled before review");
await dialog.getByLabel("I reviewed these extra duties").check();
ok(await apply.isEnabled(), "apply enabled after review");
state.applyResponses.push([{ detail: { code: "stale_preview", message: "The plan changed since your preview." } }, 409]);
await apply.click();
await dialog.getByRole("alert").filter({ hasText: "The plan changed since your preview." }).waitFor();
ok(/Nothing was saved/.test(await dialog.getByRole("alert").innerText()), "stale preview next step");
const callsBefore = state.previewCalls;
await dialog.getByRole("button", { name: "Preview again" }).click();
await dialog.locator("[data-decision]").first().waitFor();
eq(state.previewCalls, callsBefore + 1, "preview re-run");
ok(await dialog.locator("[data-extra-apply]").isDisabled(), "review box resets after a new preview");

// 3. proposal_active opens the shared Resume / Cancel panel.
state.applyResponses.push([{ detail: { code: "proposal_active", message: "Another generation proposal is open for this month.",
  job_id: "job-9", kind: "members", status: "running", processed: 4, total: 20, owned: true, operator_name: "Admin", month: "2026-11" } }, 409]);
await dialog.getByLabel("I reviewed these extra duties").check();
await dialog.locator("[data-extra-apply]").click();
await dialog.getByRole("heading", { name: "Another proposal is in progress" }).waitFor();
const conflictText = await dialog.innerText();
ok(/You asked for: Extra-duty layer/.test(conflictText), "conflict names this stage");
ok(/Another generation proposal is open for this month\./.test(conflictText), "conflict shows the server message");
ok(/Paused at 4 of 20 duties/.test(conflictText), "conflict progress");
await dialog.getByRole("button", { name: "Resume it" }).waitFor();
await axe();
await dialog.locator("[data-close]").click();
await page.locator("dialog").waitFor({ state: "detached" });
eq(await page.locator("dialog").count(), 0, "conflict window closed and removed");

// 4. Apply posts the token and plan hash once, even on a double click.
await open();
await dialog.locator("[data-decision]").first().waitFor();
await dialog.getByLabel("I reviewed these extra duties").check();
state.applyBodies = [];
await dialog.locator("[data-extra-apply]").dblclick();
await dialog.getByText(/Applied\. 3 duties filled; 2 ledger records written\./).waitFor();
eq(state.applyBodies, [{ month: "2026-11", token: "tok-123", plan_hash: "plan-abc" }], "apply payload, single submit");
eq(await page.evaluate(() => window.appliedCount), 1, "onApplied called once");
ok(/3\s*filled/.test((await dialog.locator(".extra-duty-chip").first().innerText()).replace(/\s+/g, " ")), "applied chips");
await dialog.getByRole("button", { name: "Undo this batch" }).waitFor();
await axe();
await noHorizontalScroll("applied at 390px");

// 5. Audit report downloads go through an authenticated fetch.
for (const [label, ext] of [["Download audit report (HTML)", "html"], ["Download audit report (Excel)", "xlsx"]]) {
  const wait = page.waitForEvent("download");
  await dialog.getByRole("button", { name: label }).click();
  const download = await wait;
  eq(download.suggestedFilename(), `rota-360-2026-11.${ext}`, `${ext} filename`);
}
eq(state.reportRequests, [{ auth: "Bearer test-token", format: "html", month: "2026-11" }, { auth: "Bearer test-token", format: "xlsx", month: "2026-11" }], "report fetches carry the token");
await dialog.getByText("Downloaded rota-360-2026-11.xlsx.").waitFor();

// 6. Undo asks first; a refused undo lists the changed duties.
state.undoResponses.push([{ batch_id: "b-1", restored: 3, conflicts: [] }, 200]);
await dialog.getByRole("button", { name: "Undo this batch" }).click();
await dialog.getByRole("heading", { name: "Undo this batch?" }).waitFor();
ok(/removes 3 extra duties/.test(await dialog.locator("[data-undo-panel]").innerText()), "undo explains what happens");
eq(state.undoBodies.at(-1), { dry_run: true }, "undo checks with a dry run first");
ok(await page.evaluate(() => document.activeElement?.matches("[data-undo-panel]")), "focus moves to the undo panel");
await dialog.getByRole("button", { name: "Keep it" }).click();
eq(await dialog.locator("[data-undo-panel]").count(), 0, "keep closes the question");
state.undoResponses.push([{ batch_id: "b-1", restored: 3, conflicts: [] }, 200]);
state.undoResponses.push([{ detail: { code: "undo_conflict", message: "Some duties changed after this batch.",
  conflicts: [{ slot_id: "s1", duty_date: "2026-11-03", duty_type: "MAIN_1ST_24HR", person_name: "Dr Asha", reason: "Assignment was replaced" }] } }, 409]);
await dialog.getByRole("button", { name: "Undo this batch" }).click();
await dialog.getByRole("button", { name: "Yes, undo this batch" }).click();
await dialog.getByRole("heading", { name: "This batch cannot be undone yet" }).waitFor();
ok(/Tue 3 Nov 2026 · Main 1st 24hr · Dr Asha · Assignment was replaced/.test(await dialog.locator("[data-undo-conflicts]").innerText()), "undo conflict listing");
eq(state.undoBodies.at(-1), { dry_run: false }, "real undo request");
await axe();

// 7. Escape closes the window and returns focus.
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });
eq(await page.locator("dialog").count(), 0, "Escape closes the window");
ok(await page.evaluate(() => document.activeElement?.id === "opener"), "focus returns to the opener");

// 8. Disabled deployment: plain message, nothing to apply.
state.status = { enabled: false, month: "2026-11", open_slots: 4, batches: [] };
await open();
await dialog.getByText(/The extra-duty layer is turned off/).waitFor();
eq(await dialog.locator("[data-extra-apply]").count(), 0, "no apply when disabled");
await dialog.locator("[data-extra-close]").click();
state.status = { enabled: true, month: "2026-11", open_slots: 4, batches: [] };

// 9. Verification failure: exact message, the violations, and a next step.
await open();
await dialog.locator("[data-decision]").first().waitFor();
await dialog.getByLabel("I reviewed these extra duties").check();
state.applyResponses.push([{ detail: { code: "verification_failed", message: "A safety check failed after saving; everything was rolled back.",
  violations: [{ slot_id: "s1", person_id: "p1", code: "leave", message: "Dr Asha is on leave on 3 Nov" }] } }, 500]);
await dialog.locator("[data-extra-apply]").click();
await dialog.getByRole("alert").filter({ hasText: "A safety check failed after saving; everything was rolled back." }).waitFor();
ok(/Dr Asha is on leave on 3 Nov/.test(await dialog.getByRole("alert").innerText()), "violations listed");
await page.keyboard.press("Escape");

// 9b. Balance-duties runs share the batch list: labelled "Balance duties" and undone through the balance endpoint.
state.status = { enabled: true, month: "2026-11", open_slots: 4, batches: [
  { id: "bb-1", status: "applied", created_at: "2026-10-22T09:00:00Z", created_by_name: "Admin", summary: { mode: "balance", moves: 11, swaps: 1 } },
  { id: "bb-2", status: "undone", created_at: "2026-10-22T10:00:00Z", created_by_name: "Admin", summary: { mode: "balance", moves: 3, extra_moves: 2 } },
  { id: "b-1", status: "applied", created_at: "2026-10-21T08:05:00Z", created_by_name: "Admin", summary: applied.summary }] };
const undoCount = state.undoBodies.length;
await open();
await dialog.locator("[data-decision]").first().waitFor();
const balanceRow = dialog.locator('[data-batch="bb-1"]');
const balanceText = await balanceRow.innerText();
ok(/Applied · Balance duties/.test(balanceText) && /11 duties moved · 1 swap · no ledger records/.test(balanceText), "balance batch labelled in plain words");
ok(!/filled/.test(balanceText), "balance batch does not claim filled duties");
ok(/3 duties moved · 2 extra duties passed on with their ledger records/.test(await dialog.locator('[data-batch="bb-2"]').innerText()), "balance batch names passed-on extra duties");
ok(/3 duties filled/.test(await dialog.locator('[data-batch="b-1"]').innerText()), "extra-duty batch unchanged");
await balanceRow.getByRole("button", { name: "Undo this balance run" }).click();
await dialog.getByRole("heading", { name: "Undo this balance run?" }).waitFor();
eq(state.balanceUndo.at(-1), { path: "/api/v1/balance-duties/batches/bb-1/undo", body: { dry_run: true } }, "balance undo goes to the balance endpoint");
ok(/puts 11 duties back with the person and unit they had before balancing/.test(await dialog.locator("[data-undo-panel]").innerText()), "balance undo explained");
await dialog.getByRole("button", { name: "Yes, undo this run" }).click();
await dialog.getByText(/Balance run undone\. 11 duties put back/).waitFor();
eq(state.balanceUndo.at(-1).body, { dry_run: false }, "real balance undo");
eq(state.undoBodies.length, undoCount, "extra-duty undo endpoint not used for a balance run");
await axe();
await page.keyboard.press("Escape");
await page.locator("dialog").waitFor({ state: "detached" });
state.status = { enabled: true, month: "2026-11", open_slots: 4, batches: [] };

// 10. Member ledger: active and void rows.
await page.evaluate(async () => { const host = document.querySelector("#slot"); await (await import("/src/extra-duty.ts")).renderMemberExtraDuties(host, "p1"); });
const ledger = page.locator("#slot");
await ledger.locator('[data-ledger-row="r2"]').waitFor();
ok(/1 active record · 1 void record/.test(await ledger.innerText()), "ledger counts");
ok(/Active/.test(await ledger.locator('[data-ledger-row="r1"]').innerText()) && /Over monthly 24-hour limit/.test(await ledger.locator('[data-ledger-row="r1"]').innerText()), "active row");
const voidRow = await ledger.locator('[data-ledger-row="r2"]').innerText();
ok(/Void/.test(voidRow) && /No longer counts: Assignment cleared/.test(voidRow) && /Fallback from UNIT I/.test(voidRow), "void row with reason and fallback");
await axe("#slot");
await page.evaluate(async () => { const host = document.querySelector("#slot"); await (await import("/src/extra-duty.ts")).renderMemberExtraDuties(host, "p9"); });
await ledger.getByText("No extra duties recorded for this person.").waitFor();
// 10b. Ledger rows passed on by Balance duties carry a "Passed on from X" note.
await page.evaluate(async () => { const host = document.querySelector("#slot"); await (await import("/src/extra-duty.ts")).renderMemberExtraDuties(host, "p3"); });
await ledger.locator('[data-ledger-row="t3"]').waitFor();
eq(await ledger.locator('[data-ledger-row="t1"] [data-ledger-transfer]').allInnerTexts(), ["Passed on from Dr Asha by Balance duties on 22 Oct"], "transfer note uses the backend text");
eq((await ledger.locator('[data-ledger-row="t2"] [data-ledger-transfer]').allInnerTexts()).map(t => t.trim()), ["Passed on from Dr Bina by Balance duties on 22 Oct 2026"], "transfer note from a transfer object");
eq(await ledger.locator('[data-ledger-row="t3"] [data-ledger-transfer]').count(), 0, "no note without a transfer");
ok(/Rules overridden: Extra duty passed on by Balance duties/.test(await ledger.locator('[data-ledger-row="t1"]').innerText()), "rebalanced code in plain words");
for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await axe("#slot"); }
await page.emulateMedia({ colorScheme: "light" });
await noHorizontalScroll("ledger transfers at 390px");
if (process.env.BALANCE2_SHOTS) {
  await ledger.scrollIntoViewIfNeeded();
  await ledger.screenshot({ path: `${process.env.BALANCE2_SHOTS}/balance2-ledger-390.png` });
  await page.emulateMedia({ colorScheme: "dark" });
  await ledger.screenshot({ path: `${process.env.BALANCE2_SHOTS}/balance2-ledger-390-dark.png` });
  await page.emulateMedia({ colorScheme: "light" });
}

// 11. Unit fallback editor: reorder, add, save the exact order.
await page.evaluate(async () => { const host = document.querySelector("#slot"); await (await import("/src/extra-duty.ts")).renderUnitFallbacks(host); });
const unit1 = page.locator('[data-fallback-unit="u-1"]');
await unit1.locator("summary").click();
eq(await unit1.locator("[data-fallback-item]").evaluateAll(es => es.map(e => e.dataset.fallbackItem)), ["u-2", "u-3"], "initial order");
ok(await unit1.locator("[data-fb-save]").isDisabled(), "save disabled until changed");
await unit1.getByRole("button", { name: "Move UNIT III up" }).click();
ok(await page.evaluate(() => document.activeElement?.matches('[data-fb-down="u-3"], [data-fb-up="u-3"]')), "focus stays on the moved unit");
await page.locator('[data-fallback-unit="u-1"] [data-fb-select]').selectOption("u-4");
await page.locator('[data-fallback-unit="u-1"]').getByRole("button", { name: "Add to the end" }).click();
await page.locator('[data-fallback-unit="u-1"]').getByRole("button", { name: "Move UNIT II down" }).click();
await page.locator('[data-fallback-unit="u-1"]').getByRole("button", { name: "Move UNIT II up" }).click();
eq(await page.locator('[data-fallback-unit="u-1"] [data-fallback-item]').evaluateAll(es => es.map(e => e.dataset.fallbackItem)), ["u-3", "u-2", "u-4"], "edited order");
ok(/not saved/.test(await page.locator('[data-fallback-unit="u-1"] summary').innerText()), "unsaved marker");
await axe("#slot");
await noHorizontalScroll("fallback editor at 390px");
await page.locator('[data-fallback-unit="u-1"]').getByRole("button", { name: "Save order" }).click();
await page.locator('[data-fallback-unit="u-1"]').getByText("Saved. The next extra-duty run uses this order.").waitFor();
eq(state.putBodies, [{ unit: "u-1", body: { fallback_unit_ids: ["u-3", "u-2", "u-4"] } }], "save payload");
await page.locator('[data-fallback-unit="u-2"] summary').click();
await page.locator('[data-fallback-unit="u-1"]').getByRole("button", { name: "Remove UNIT IV" }).click();
eq(await page.locator('[data-fallback-unit="u-1"] [data-fallback-item]').count(), 2, "remove");
ok(/Automatic order/.test(await page.locator('[data-fallback-unit="u-2"] summary').innerText()), "empty list = automatic order");

// 12. Desktop width: the table is a real table and the window has no horizontal scroll.
await page.setViewportSize({ width: 1280, height: 900 });
await open();
await dialog.locator("[data-decision]").first().waitFor();
ok(await dialog.locator("thead").isVisible(), "table header visible on desktop");
await noHorizontalScroll("preview at 1280px");
await page.screenshot({ path: process.env.EXTRA_DUTY_SHOTS ? `${process.env.EXTRA_DUTY_SHOTS}/extra-duty-desktop.png` : "tests/artifacts/extra-duty-desktop.png" });
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 390, height: 860 });
await open();
await dialog.locator("[data-decision]").first().waitFor();
await page.screenshot({ path: process.env.EXTRA_DUTY_SHOTS ? `${process.env.EXTRA_DUTY_SHOTS}/extra-duty-mobile.png` : "tests/artifacts/extra-duty-mobile.png" });
await page.keyboard.press("Escape");

eq(errors, [], "no page errors");
await browser.close();
console.log(`extra-duty layer UI: all ${checks} checks passed`);
