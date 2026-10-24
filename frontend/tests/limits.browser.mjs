// Limits page (superadmin only) — docs/limits_callevel_fairness_contract.md §4 — against a mocked API:
// - gating: the "Limits" nav item and #view=limits exist only for a superadmin; a 403 load explains itself;
// - grouping: five cards with headings and intros; each setting shows label, explanation, example,
//   hard / can-be-exceeded / guide badge, unit, "Blank = no limit", the saved value and a changed marker;
// - the equal-duties card shows the per-call-level targets for a chosen month (GET ?month=);
// - inline validation (not a number, out of range, blank where not allowed, warning ≥ refuse);
// - one sticky save bar: unsaved count, Reset (two-step), Save limits… → confirmation with server sentences,
//   problems, impact, optional note and a required "I understand"; PUT body with base_version_id;
// - 409 stale_limits (load their version and keep my edits, with what they changed), 422 invalid_limits
//   (problems on the fields), 403 (nothing saved), success;
// - history drawer with who/when/note/changes and restore after a confirmation;
// - unsaved-changes guard on navigation; axe light and dark; no sideways scroll at 390 px;
// - Publish: "Call level mismatches" blocker and the "Duty totals uneven within a call level" spread table.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5185";
const shots = process.env.LIMITS_SHOTS || "";
const browser = await chromium.launch({ headless: true, executablePath: process.env.MEMBER_TEST_BROWSER || chromium.executablePath() });
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };

const FIELDS = [
  { path: "duty_count_limits.max_24hr_per_month", section: "duty_count_limits", label: "Max 24-hour duties per member per month", help: "The most 24-hour duties one member can be given in a month.", example: "6 means nobody is given a 7th 24-hour duty that month.", kind: "int", min: 0, max: 31, unit: "duties", blank_means: "No limit", hard_or_soft: "hard" },
  { path: "duty_count_limits.max_weekend_24hr_per_month", section: "duty_count_limits", label: "Max weekend 24-hour duties per member per month", help: "Saturday or Sunday 24-hour duties.", example: "2 means at most two weekend 24-hour duties each.", kind: "int", min: 0, max: 10, unit: "duties", blank_means: "No limit", hard_or_soft: "hard" },
  { path: "duty_count_limits.max_same_group_per_month", section: "duty_count_limits", label: "Max duties of the same category per month", help: "Per category.", example: "4 means a fifth PAC duty goes to someone else.", kind: "int", min: 0, max: 31, unit: "duties", blank_means: "No limit", hard_or_soft: "hard" },
  { path: "duty_count_limits.max_same_campus_per_month", section: "duty_count_limits", label: "Max duties on the same campus per month", help: "Per campus.", example: "8 means the ninth duty on that campus goes to someone else.", kind: "int", min: 0, max: 31, unit: "duties", blank_means: "No limit", hard_or_soft: "hard" },
  { path: "rest_rules.minimum_gap_after_24hr_hours", section: "rest_rules", label: "Minimum rest after a 24-hour duty", help: "Hours between the end of a 24-hour duty and the next duty.", example: "24 means a duty ending 8 am Tuesday leaves the member free until 8 am Wednesday.", kind: "hours", min: 0, max: 168, unit: "hours", blank_means: null, hard_or_soft: "hard" },
  { path: "rest_rules.post_24hr_blocks_next_day_elective", section: "rest_rules", label: "No elective work the day after a 24-hour duty", help: "Left off elective lists the next day.", example: "On: not on Tuesday's elective list.", kind: "bool", min: null, max: null, unit: null, blank_means: null, hard_or_soft: "hard" },
  { path: "unit_staffing_rules.minimum_available_count", section: "unit_staffing_rules", label: "Minimum people free in each unit", help: "Fewest free each day.", example: "1 means the last free person is never put on a duty.", kind: "int", min: 0, max: 99, unit: "people", blank_means: null, hard_or_soft: "hard" },
  { path: "unit_staffing_rules.warning_unavailable_percent", section: "unit_staffing_rules", label: "Warn when this share of a unit is away", help: "Review warns.", example: "30% in a unit of 10 warns from the 3rd person away.", kind: "percent", min: 0, max: 100, unit: "%", blank_means: null, hard_or_soft: "soft" },
  { path: "unit_staffing_rules.hard_block_unavailable_percent", section: "unit_staffing_rules", label: "Refuse when this share of a unit is away", help: "No more assignments.", example: "40% in a unit of 10 refuses the 4th person away.", kind: "percent", min: 0, max: 100, unit: "%", blank_means: null, hard_or_soft: "hard" },
  { path: "unit_staffing_rules.small_unit_uses_absolute_minimum", section: "unit_staffing_rules", label: "Small units use the minimum number instead of percentages", help: "Small units.", example: "On: in a unit of 3 …", kind: "bool", hard_or_soft: "hard" },
  { path: "fairness_rules.max_gap_within_call_level", section: "fairness_rules", label: "Largest allowed gap within a call level", help: "Most that totals may differ.", example: "1 means 6 or 7 when the busiest has 7.", kind: "int", min: 0, max: 10, unit: "duties", blank_means: null, hard_or_soft: "soft" },
  { path: "fairness_rules.target_mode", section: "fairness_rules", label: "How the target is worked out", help: "Automatic.", example: "60 ÷ 10 = 6.", kind: "choice", hard_or_soft: "guide", options: [{ value: "auto", label: "Automatic (duties divided by members)" }] },
  { path: "extra_duty_rules.justice_lookback_months", section: "extra_duty_rules", label: "Months counted for extra duties", help: "Ledger look-back.", example: "12 months.", kind: "int", min: 1, max: 36, unit: "months", blank_means: null, hard_or_soft: "guide" },
];
const LIMITS = () => ({
  duty_count_limits: { max_24hr_per_month: 8, max_weekend_24hr_per_month: null, max_same_group_per_month: null, max_same_campus_per_month: null },
  rest_rules: { minimum_gap_after_24hr_hours: 24, post_24hr_blocks_next_day_elective: true },
  unit_staffing_rules: { minimum_available_count: 1, warning_unavailable_percent: 30, hard_block_unavailable_percent: 40, small_unit_uses_absolute_minimum: true },
  fairness_rules: { max_gap_within_call_level: 1, target_mode: "auto" },
  extra_duty_rules: { justice_lookback_months: 12 },
});
const TARGETS = {
  "2026-06": [
    { call_level: "2ND_CALL", label: "2nd call", slots: 120, members: 20, target: 6, min_expected: 6, max_expected: 6 },
    { call_level: "3RD_CALL", label: "3rd call", slots: 64, members: 12, target: 5.33, min_expected: 5, max_expected: 6 },
    { call_level: "4TH_CALL", label: "4th call", slots: 30, members: 9, target: 3.33, min_expected: 3, max_expected: 4 },
  ],
  "2026-07": [{ call_level: "3RD_CALL", label: "3rd call", slots: 62, members: 10, target: 6.2, min_expected: 6, max_expected: 7 }],
};
const get = (o, p) => p.split(".").reduce((v, k) => v?.[k], o);
const fieldOf = p => FIELDS.find(f => f.path === p);
const show = (f, v) => f.kind === "bool" ? (v ? "On" : "Off") : v === null || v === undefined ? "no limit" : f.kind === "percent" ? `${v}%` : `${v} ${f.unit}`;
const diff = (a, b) => FIELDS.filter(f => JSON.stringify(get(a, f.path) ?? null) !== JSON.stringify(get(b, f.path) ?? null))
  .map(f => ({ path: f.path, label: f.label, before: get(a, f.path) ?? null, after: get(b, f.path) ?? null, sentence: `${f.label}: ${show(f, get(a, f.path))} → ${show(f, get(b, f.path))}` }));

function makeServer() {
  return {
    version: "lv-3", saved_at: "2026-10-21T10:15:00Z", saved_by: "Dr Asha", limits: LIMITS(),
    history: [
      { version_id: "lv-3", saved_at: "2026-10-21T10:15:00Z", saved_by: "Dr Asha", note: "Board meeting 21 Oct", changes: [{ path: "duty_count_limits.max_24hr_per_month", label: "Max 24-hour duties per member per month", before: null, after: 8, sentence: "Max 24-hour duties per member per month: no limit → 8 duties" }] },
      { version_id: "lv-2", saved_at: "2026-09-01T09:00:00Z", saved_by: "Dr Ben", note: null, changes: [{ path: "rest_rules.minimum_gap_after_24hr_hours", label: "Minimum rest after a 24-hour duty", before: 12, after: 24, sentence: "Minimum rest after a 24-hour duty: 12 hours → 24 hours" }] },
    ],
    versions: { "lv-2": { ...LIMITS(), duty_count_limits: { ...LIMITS().duty_count_limits, max_24hr_per_month: null } } },
    gets: [], previews: [], puts: [], restores: [], putQueue: [], getQueue: [], n: 3,
  };
}

async function appPage({ role = "superadmin", width = 1280, scheme = "light", server = makeServer(), publish = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const p = await ctx.newPage();
  const pageErrors = [];
  p.on("pageerror", e => pageErrors.push(e.message));
  await p.addInitScript(() => { localStorage.setItem("duty_rota_auth_token", "test-token"); localStorage.setItem("duty_rota_working_month", "2026-06"); });
  const read = month => ({ version_id: server.version, saved_at: server.saved_at, saved_by: server.saved_by, limits: JSON.parse(JSON.stringify(server.limits)),
    defaults: LIMITS(), fields: FIELDS, targets: TARGETS[month] ?? [], can_edit: role === "superadmin", month, limits_version_id: server.version,
    sections: [{ key: "duty_count_limits", title: "Per member each month", intro: "How many duties of each kind one member should get in a calendar month. Leave a box blank for no limit." }],
    hard_or_soft_labels: { hard: "Hard rule: never broken", soft: "Can be exceeded, with a reason, and is reported", guide: "Guide only: warns or steers, never stops a duty" } });
  await p.route("**/api/**", async r => {
    const u = new URL(r.request().url());
    const method = r.request().method();
    const json = (body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (u.pathname.endsWith("/auth/me")) return json({ id: "u", username: role, display_name: role, email: null, role, role_label: role, active_status: "active", permissions: ["publish_rota"] });
    if (u.pathname.endsWith("/api/health")) return json({ status: "ok" });
    if (u.pathname.endsWith("/admin/limits") && method === "GET") {
      server.gets.push(u.searchParams.get("month"));
      const next = server.getQueue.shift();
      if (next) return json(next[0], next[1]);
      return json(read(u.searchParams.get("month")));
    }
    if (u.pathname.endsWith("/admin/limits/preview")) {
      const body = r.request().postDataJSON();
      server.previews.push(body);
      const after = body.limits;
      const over = after.duty_count_limits.max_24hr_per_month !== null && after.duty_count_limits.max_24hr_per_month < 7 ? 6 : 0;
      const names = ["Dr Asha", "Dr Bina", "Dr Chitra", "Dr Dev", "Dr Esha", "Dr Farah"].slice(0, over);
      const problems = after.fairness_rules.max_gap_within_call_level >= 3 ? [{ path: "fairness_rules.max_gap_within_call_level", severity: "warning", message: "A gap of 3 or more lets duty totals drift far apart." }] : [];
      return json({ month: body.month, changes: diff(server.limits, after), problems, impact: { month: body.month, over_limit_people: over, over_limit_people_now: 0, newly_over: over, members_over: names, people: [],
        sentence: `With these limits, ${over} members in June 2026 would be over a limit (now 0).` } });
    }
    if (u.pathname.endsWith("/admin/limits") && method === "PUT") {
      const body = r.request().postDataJSON();
      server.puts.push(body);
      await new Promise(res => setTimeout(res, 120));
      const next = server.putQueue.shift();
      if (next) return json(next[0], next[1]);
      if (body.base_version_id !== server.version) return json({ detail: { code: "stale_limits", message: "The limits changed since you loaded them." } }, 409);
      const changes = diff(server.limits, body.limits);
      server.n += 1;
      server.version = `lv-${server.n}`;
      server.saved_at = "2026-10-22T11:00:00Z";
      server.saved_by = "Super Admin";
      server.history.unshift({ version_id: server.version, saved_at: server.saved_at, saved_by: server.saved_by, note: body.note, changes });
      server.limits = body.limits;
      return json(read("2026-06"));
    }
    if (u.pathname.endsWith("/admin/limits/history")) return json(server.history);
    if (u.pathname.endsWith("/admin/limits/restore")) {
      const body = r.request().postDataJSON();
      server.restores.push(body);
      const limits = server.versions[body.version_id];
      server.n += 1; server.version = `lv-${server.n}`; server.saved_by = "Super Admin"; server.saved_at = "2026-10-22T12:00:00Z";
      server.history.unshift({ version_id: server.version, saved_at: server.saved_at, saved_by: "Super Admin", note: body.note, changes: diff(server.limits, limits) });
      server.limits = JSON.parse(JSON.stringify(limits));
      return json(read("2026-06"));
    }
    if (u.pathname.endsWith("/rota-publish/month") && publish) return json(publish);
    if (u.pathname.endsWith("/rota-rules/phase-one") && method === "GET") return json({ revision: "r1", groups: [], units: [], rule_version: { id: "rv", name: "Phase one", description: null, effective_from: "2026-01-01", effective_to: null, is_active: true, created_at: "2026-01-01T00:00:00Z" }, duty_rules: [], ...server.limits, notes: null });
    if (u.pathname.endsWith("/rota-rules/phase-one/check")) return json({ problems: [], duties: {} });
    return json({ detail: "not mocked" }, 404);
  });
  return { ctx, p, pageErrors, server };
}

const axeClean = async (p, label, include = ".limits-page") => {
  for (const scheme of ["light", "dark"]) {
    await p.emulateMedia({ colorScheme: scheme });
    const result = await new AxeBuilder({ page: p }).include(include).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    eq(result.violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target).join(" | ")}`), [], `axe ${label} ${scheme}`);
  }
  await p.emulateMedia({ colorScheme: null });
};
const noSideways = async (p, label) => ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1
  && [...document.querySelectorAll("dialog[open] .mw-content, dialog[open] .mw-footer, .limits-page")].every(e => e.scrollWidth <= e.clientWidth + 1)), `no horizontal scroll: ${label}`);
const shot = async (p, name, full = false) => { if (shots) await p.screenshot({ path: `${shots}/${name}.png`, fullPage: full }); };
const setting = (p, path) => p.locator(`[data-setting="${path}"]`);
const input = (p, path) => p.locator(`[data-setting="${path}"] [data-limit-num]`);

// 1. Gating: no "Limits" for other roles; a direct link falls back to Overview.
for (const role of ["computer_admin", "rota_board_member", "hod"]) {
  const { ctx, p, pageErrors } = await appPage({ role });
  await p.goto(base + "/#view=limits");
  await p.locator("#sidebar").waitFor();
  await p.waitForTimeout(300);
  eq(await p.locator('#sidebar [data-view="limits"]').count(), 0, `no Limits nav item for ${role}`);
  eq(await p.locator(".limits-page").count(), 0, `no Limits page for ${role}`);
  eq(pageErrors, [], `no page errors (${role})`);
  await ctx.close();
}

// 2. Superadmin: nav under Admin tools, cards, settings.
{
  const { ctx, p, pageErrors, server } = await appPage({});
  await p.goto(base + "/");
  await p.locator('#sidebar [data-view="limits"]').waitFor();
  const navOrder = await p.locator("#sidebar button[data-view]").evaluateAll(bs => bs.map(b => b.dataset.view));
  eq(navOrder.indexOf("limits"), navOrder.indexOf("rota-rules") + 1, "Limits sits after Rota Rules in Admin tools");
  await p.locator('#sidebar [data-view="limits"]').click();
  await p.locator(".limits-page").waitFor();
  eq(server.gets[0], "2026-06", "loads limits for the working month");
  ok(/#view=limits/.test(p.url()), "route written");
  const cards = await p.locator(".limits-card h3").allInnerTexts();
  eq(cards, ["Per member each month", "Rest after a 24-hour duty", "Unit staffing", "Equal duties within a call level", "Extra duties (justice)"], "five cards in order");
  for (const card of await p.locator(".limits-card").all()) ok((await card.locator(".limits-card__head p").innerText()).length > 20, "card has a one-line intro");
  ok(/Only a superadmin can change limits/.test(await p.locator(".limits-hero").innerText()), "who can change");
  ok(/Hard rule: never broken/.test(await p.locator(".limits-legend").innerText()), "server badge wording in the legend");
  ok(/How many duties of each kind/.test(await p.locator("#lim-card-member").innerText()), "server section intro wins");
  ok(/Saved .*21 Oct 2026.* by Dr Asha/.test(await p.locator("[data-part=version]").innerText()), "saved version line");
  const max = setting(p, "duty_count_limits.max_24hr_per_month");
  const maxText = (await max.innerText()).replace(/\s+/g, " ");
  for (const t of ["Max 24-hour duties per member per month", "The most 24-hour duties one member can be given in a month.", "EXAMPLE", "6 means nobody is given a 7th", "Hard limit", "Blank = no limit", "Saved: 8 duties"]) ok(maxText.includes(t), `max 24h setting shows: ${t}`);
  eq(await input(p, "duty_count_limits.max_24hr_per_month").inputValue(), "8", "saved value in the box");
  ok(/duties/.test(await max.locator(".limits-input__unit").innerText()), "unit shown");
  eq(await input(p, "duty_count_limits.max_weekend_24hr_per_month").getAttribute("placeholder"), "No limit", "blank shows No limit");
  ok(/Saved: No limit/.test(await setting(p, "duty_count_limits.max_weekend_24hr_per_month").innerText()), "saved blank in words");
  ok(/Can be exceeded/.test(await setting(p, "unit_staffing_rules.warning_unavailable_percent").innerText()), "soft badge");
  ok(/Guide/.test(await setting(p, "extra_duty_rules.justice_lookback_months").innerText()), "guide badge");
  eq(await setting(p, "rest_rules.minimum_gap_after_24hr_hours").locator(".limits-blank").count(), 0, "no blank hint where blank is not allowed");
  const describedBy = await input(p, "duty_count_limits.max_24hr_per_month").getAttribute("aria-describedby");
  for (const part of ["-help", "-ex", "-blank", "-saved"]) ok(describedBy.includes(part), `input described by ${part}`);
  eq(await p.getByLabel("Max 24-hour duties per member per month").count(), 1, "label is wired to the input");
  eq(await p.locator('[data-limit-switch="rest_rules.post_24hr_blocks_next_day_elective"]').getAttribute("aria-checked"), "true", "switch state");

  // Targets.
  const targetRows = await p.locator(".limits-targets tbody tr").allInnerTexts();
  eq(targetRows.length, 3, "three call levels");
  ok(/3rd call\s+64\s+12\s+5\.33\s+5 or 6 duties each/.test(targetRows[1].replace(/\s+/g, " ")), "3rd call target row");
  ok(/2nd call.*6 duties each/.test(targetRows[0].replace(/\s+/g, " ")), "exact target in words");
  ok(/With a gap of 1/.test(await p.locator(".limits-targets__head").innerText()), "gap explained");
  await p.locator("[data-targets-month]").fill("2026-07");
  await p.locator("#lim-targets-title", { hasText: "Targets for July 2026" }).waitFor();
  await p.waitForFunction(() => document.querySelectorAll(".limits-targets tbody tr").length === 1);
  eq(server.gets.at(-1), "2026-07", "targets for the chosen month");
  await p.locator("[data-targets-month]").fill("2026-08");
  await p.locator(".limits-targets__empty").waitFor();
  ok(/No targets for August 2026 yet/.test(await p.locator(".limits-targets__empty").innerText()), "empty targets explained");
  await p.locator("[data-targets-month]").fill("2026-06");
  await p.waitForFunction(() => document.querySelectorAll(".limits-targets tbody tr").length === 3);

  // Save bar at rest.
  ok(/All limits are saved/.test(await p.locator(".limits-savebar").innerText()), "save bar at rest");
  ok(await p.locator("[data-limits-save]").isDisabled(), "save disabled with no changes");
  await axeClean(p, "limits page 1280");
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot(p, "limits-1280-light");
  await shot(p, "limits-1280-light-full", true);

  // 3. Validation.
  const maxIn = input(p, "duty_count_limits.max_24hr_per_month");
  await maxIn.fill("abc");
  eq(await maxIn.getAttribute("aria-invalid"), "true", "not a number flagged");
  ok(/Use a whole number from 0 to 31, or leave it blank for no limit/.test(await max.locator(".limits-error").innerText()), "not-a-number message");
  ok(await p.locator("[data-limits-save]").isDisabled(), "save disabled while invalid");
  ok(/Fix 1 problem above to save/.test(await p.locator(".limits-savebar").innerText()), "save bar says why");
  await maxIn.fill("40");
  ok(/40 is out of range\. Use 0 to 31/.test(await max.locator(".limits-error").innerText()), "out of range message");
  await p.locator("[data-goto-error]").click();
  ok(await p.evaluate(() => document.activeElement?.matches('[data-limit-num="duty_count_limits.max_24hr_per_month"]')), "Fix link focuses the field");
  await maxIn.fill("");
  eq(await maxIn.getAttribute("aria-invalid"), null, "blank is valid (no limit)");
  ok(/Saved: 8 duties → new: No limit/.test(await max.innerText()), "changed marker with new value");
  const rest = input(p, "rest_rules.minimum_gap_after_24hr_hours");
  await rest.fill("");
  ok(/cannot be blank/.test(await setting(p, "rest_rules.minimum_gap_after_24hr_hours").locator(".limits-error").innerText()), "blank not allowed");
  await rest.fill("200");
  ok(/out of range\. Use 0 to 168/.test(await setting(p, "rest_rules.minimum_gap_after_24hr_hours").locator(".limits-error").innerText()), "hours range");
  await rest.fill("24");
  await input(p, "unit_staffing_rules.warning_unavailable_percent").fill("50");
  const hard = setting(p, "unit_staffing_rules.hard_block_unavailable_percent");
  ok(/must be higher than the warning share \(now warn at 50%, refuse at 40%\)/.test(await hard.locator(".limits-error").innerText()), "warning must be below refuse");
  ok(/2 problems|1 problem/.test(await p.locator('[data-card-flags="unit_staffing_rules"]').innerText()), "card flags the problem");
  await input(p, "unit_staffing_rules.warning_unavailable_percent").fill("30");
  eq(await hard.locator(".limits-error").isHidden(), true, "cross-field error clears");
  await axeClean(p, "limits validation");

  // 4. Edits, markers, two-step reset.
  await maxIn.fill("6");
  await p.locator('[data-limit-switch="rest_rules.post_24hr_blocks_next_day_elective"]').click();
  await input(p, "fairness_rules.max_gap_within_call_level").fill("2");
  eq((await p.locator("[data-limits-unsaved]").innerText()).trim(), "3 unsaved changes", "unsaved count");
  ok(/With a gap of 2/.test(await p.locator(".limits-targets__head").innerText()), "targets text follows the new gap");
  eq(await p.locator(".limits-setting.is-changed").count(), 3, "three changed markers");
  ok(/1 change/.test(await p.locator('[data-card-flags="rest_rules"]').innerText()), "card change flag");
  eq(await p.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), true, "unload guard with edits");
  await p.locator("[data-limits-reset]").click();
  ok(/Reset 3 changes\?/.test(await p.locator(".limits-savebar").innerText()), "reset asks first");
  ok(await p.evaluate(() => document.activeElement?.matches("[data-reset-keep]")), "focus on Keep");
  await p.locator("[data-reset-keep]").click();
  eq((await p.locator("[data-limits-unsaved]").innerText()).trim(), "3 unsaved changes", "keep keeps edits");
  await p.locator("[data-limits-reset]").click();
  await p.locator("[data-reset-yes]").click();
  eq(await input(p, "duty_count_limits.max_24hr_per_month").inputValue(), "8", "reset restores saved value");
  ok(/3 changes reset/.test(await p.locator("[data-part=status]").innerText()), "reset status");
  await input(p, "duty_count_limits.max_24hr_per_month").fill("6");
  await p.locator('[data-limit-switch="rest_rules.post_24hr_blocks_next_day_elective"]').click();
  await input(p, "fairness_rules.max_gap_within_call_level").fill("3");
  await p.locator(".limits-savebar").scrollIntoViewIfNeeded();
  await shot(p, "limits-1280-edited");

  // 5. Unsaved guard on navigation.
  let dialogs = [];
  const dismiss = d => { dialogs.push(d.message()); d.dismiss(); };
  p.on("dialog", dismiss);
  await p.locator('#sidebar [data-view="rota-rules"]').click();
  await p.waitForTimeout(150);
  ok(/unsaved limit changes/.test(dialogs[0] ?? ""), "guard asks before leaving");
  eq(await p.locator(".limits-page").count(), 1, "stays on Limits");
  ok(/#view=limits/.test(p.url()), "route stays");
  p.off("dialog", dismiss);

  // 6. Save → confirmation → 409 stale → load theirs (keep mine) → 422 → success.
  // Someone else saves a weekend cap in the meantime.
  server.limits.duty_count_limits.max_weekend_24hr_per_month = 2;
  server.version = "lv-4"; server.n = 4; server.saved_by = "Dr Ben";
  await p.locator("[data-limits-save]").click();
  const dlg = p.locator("dialog[open]");
  await dlg.getByRole("heading", { name: "Save limits" }).waitFor();
  await dlg.locator(".limits-impact").waitFor();
  const sentences = await dlg.locator(".limits-sentences li").allInnerTexts();
  ok(sentences.includes("Max 24-hour duties per member per month: 8 duties → 6 duties"), "server sentence for the cap");
  ok(sentences.includes("No elective work the day after a 24-hour duty: On → Off"), "server sentence for the switch");
  ok(/With these limits, 6 members in June 2026 would be over a limit/.test(await dlg.locator(".limits-impact").innerText()), "impact sentence");
  ok(/Dr Asha, Dr Bina/.test(await dlg.locator(".limits-impact").innerText()), "impact names");
  ok(/A gap of 3 or more/.test(await dlg.innerText()), "preview warning listed");
  eq(server.previews.at(-1).month, "2026-06", "preview month");
  eq(server.previews.at(-1).limits.duty_count_limits.max_24hr_per_month, 6, "preview limits");
  const confirm = dlg.locator("[data-confirm-save]");
  ok(await confirm.isDisabled(), "confirm needs the understanding box");
  ok(/Tick “I understand” to save/.test(await dlg.locator("[data-dialog-status]").innerText()), "footer says what is missing");
  await dlg.locator("[data-limits-note]").fill("Board asked for a lower cap");
  await dlg.getByLabel("I understand this changes how every rota is generated").check();
  ok(await confirm.isEnabled(), "confirm enabled");
  await axeClean(p, "save dialog", "dialog[open]");
  await shot(p, "limits-save-dialog-1280");
  await confirm.click();
  await dlg.getByText("Someone else saved limits after you opened this page.").waitFor();
  eq(server.puts.at(-1).base_version_id, "lv-3", "PUT sends the base version");
  eq(server.puts.at(-1).note, "Board asked for a lower cap", "PUT sends the note");
  ok(await p.evaluate(() => document.activeElement?.matches("[data-dialog-notice]")), "focus on the stale message");
  await shot(p, "limits-stale-1280");
  await dlg.getByRole("button", { name: "Load their version and keep my edits" }).click();
  await dlg.getByText("Their version is loaded.").waitFor();
  await dlg.locator(".limits-impact").waitFor();
  ok(/Max weekend 24-hour duties per member per month: no limit → 2 duties/.test(await p.locator("[data-limits-others]").innerText()), "page lists what they changed");
  ok(/saved by Dr Ben/.test(await p.locator("[data-limits-others]").innerText()), "and who");
  eq(await input(p, "duty_count_limits.max_24hr_per_month").inputValue(), "6", "my edit kept");
  eq(await input(p, "duty_count_limits.max_weekend_24hr_per_month").inputValue(), "2", "their value loaded");
  eq((await dlg.locator(".limits-sentences li").allInnerTexts()).length, 3, "my 3 changes again, against their version");
  ok(!(await dlg.getByLabel("I understand this changes how every rota is generated").isChecked()), "understanding asked again");
  eq(await dlg.locator("[data-limits-note]").inputValue(), "Board asked for a lower cap", "note kept");
  await dlg.getByLabel("I understand this changes how every rota is generated").check();
  server.putQueue.push([{ detail: { code: "invalid_limits", message: "Invalid limits", problems: [{ path: "fairness_rules.max_gap_within_call_level", severity: "error", message: "Gap must be 2 or less while extra duties are on." }] } }, 422]);
  await confirm.click();
  await dlg.getByText("The server refused these limits.").waitFor();
  eq(server.puts.at(-1).base_version_id, "lv-4", "second PUT uses their version");
  ok(/Gap must be 2 or less while extra duties are on\./.test(await dlg.innerText()), "422 problem in the dialog");
  ok(await confirm.isDisabled(), "cannot confirm with a server error");
  await dlg.getByRole("button", { name: /Go to setting: Largest allowed gap/ }).click();
  await p.locator("dialog").waitFor({ state: "detached" });
  await p.waitForFunction(() => document.activeElement?.matches('[data-limit-num="fairness_rules.max_gap_within_call_level"]'));
  ok(/Gap must be 2 or less/.test(await setting(p, "fairness_rules.max_gap_within_call_level").locator(".limits-error").innerText()), "422 problem on the field");
  ok(await p.locator("[data-limits-save]").isDisabled(), "save blocked by the server problem");
  await input(p, "fairness_rules.max_gap_within_call_level").fill("2");
  eq(await setting(p, "fairness_rules.max_gap_within_call_level").locator(".limits-error").isHidden(), true, "server problem clears after an edit");
  await p.locator("[data-limits-save]").click();
  await dlg.locator(".limits-impact").waitFor();
  await dlg.getByLabel("I understand this changes how every rota is generated").check();
  await dlg.locator("[data-confirm-save]").dblclick();
  await p.locator("dialog").waitFor({ state: "detached" });
  await p.locator("[data-part=status]").getByText(/Limits saved: 3 changes/).waitFor();
  eq(server.puts.filter(b => b.base_version_id === "lv-4").length, 2, "one PUT for a double click");
  const put = server.puts.at(-1);
  eq([put.limits.duty_count_limits.max_24hr_per_month, put.limits.rest_rules.post_24hr_blocks_next_day_elective, put.limits.fairness_rules.max_gap_within_call_level, put.limits.duty_count_limits.max_weekend_24hr_per_month], [6, false, 2, 2], "PUT limits");
  eq(Object.keys(put.limits).sort(), ["duty_count_limits", "extra_duty_rules", "fairness_rules", "rest_rules", "unit_staffing_rules"], "exactly the five sections");
  ok(/All limits are saved/.test(await p.locator(".limits-savebar").innerText()), "nothing unsaved after save");
  ok(/Saved: 6 duties/.test(await max.innerText()), "new saved value");
  ok(/by Super Admin/.test(await p.locator("[data-part=version]").innerText()), "version line updated");
  ok(await p.evaluate(() => document.activeElement?.matches("[data-part=status]")), "focus on the saved message");
  await p.locator(".toast.success").filter({ hasText: "Limits saved" }).waitFor();
  eq(await p.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), false, "no unload guard after save");

  // 7. History and restore.
  await p.locator("[data-limits-history]").click();
  const drawer = p.locator("dialog[open]");
  await drawer.getByRole("heading", { name: "History" }).waitFor();
  await drawer.locator(".limits-history__item").first().waitFor();
  const items = await drawer.locator(".limits-history__item").allInnerTexts();
  eq(items.length, 3, "three versions");
  ok(/by Super Admin/.test(items[0]) && /Current limits/.test(items[0]) && /Board asked for a lower cap/.test(items[0]), "newest version with note");
  ok(/12 hours → 24 hours/.test(items[2]) && /by Dr Ben/.test(items[2]), "older version changes");
  eq(await drawer.locator('.limits-history__item.is-current [data-restore]').count(), 0, "no restore for the current version");
  await axeClean(p, "history drawer", "dialog[open]");
  await shot(p, "limits-history-1280");
  await drawer.locator('[data-restore="lv-2"]').click();
  ok(/Restore the limits from 1 Sept 2026|Restore the limits from .*2026/.test(await drawer.locator(".limits-history__confirm").innerText()), "restore asks first");
  ok(await p.evaluate(() => document.activeElement?.matches('[data-restore-yes="lv-2"]')), "focus on Yes, restore");
  await drawer.locator("[data-restore-keep]").click();
  ok(await p.evaluate(() => document.activeElement?.matches('[data-restore="lv-2"]')), "cancel returns focus");
  await drawer.locator('[data-restore="lv-2"]').click();
  await drawer.locator("[data-restore-note]").fill("Back to September");
  await drawer.locator('[data-restore-yes="lv-2"]').click();
  await p.locator("dialog").waitFor({ state: "detached" });
  await p.locator("[data-part=status]").getByText(/Limits restored/).waitFor();
  eq(server.restores.at(-1), { version_id: "lv-2", note: "Back to September", base_version_id: "lv-5", month: "2026-06" }, "restore body");
  eq(await input(p, "duty_count_limits.max_24hr_per_month").inputValue(), "", "restored value shown");

  // 8. 403 on save.
  await input(p, "extra_duty_rules.justice_lookback_months").fill("6");
  await p.locator("[data-limits-save]").click();
  await dlg.locator(".limits-impact").waitFor();
  await dlg.getByLabel("I understand this changes how every rota is generated").check();
  server.putQueue.push([{ detail: "Superadmin role required" }, 403]);
  await dlg.locator("[data-confirm-save]").click();
  await dlg.getByRole("alert").filter({ hasText: "Only a superadmin can change limits." }).waitFor();
  ok(await dlg.locator("[data-confirm-save]").isDisabled(), "no retry after 403");
  await p.keyboard.press("Escape");
  await p.locator("dialog").waitFor({ state: "detached" });
  eq(await input(p, "extra_duty_rules.justice_lookback_months").inputValue(), "6", "edit kept after 403");
  ok(/View only/.test(await p.locator(".limits-savebar").innerText()), "page becomes view only");
  eq(pageErrors, [], "no page errors (superadmin desktop)");
  await ctx.close();
}

// 9. 390 px, dark: layout, focus order, dialog.
{
  const { ctx, p, pageErrors } = await appPage({ width: 390, scheme: "dark" });
  await p.goto(base + "/#view=limits");
  await p.locator(".limits-page").waitFor();
  await noSideways(p, "limits 390");
  await axeClean(p, "limits 390");
  await p.emulateMedia({ colorScheme: "dark" });
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot(p, "limits-390-dark");
  await shot(p, "limits-390-dark-full", true);
  await input(p, "duty_count_limits.max_24hr_per_month").fill("5");
  await input(p, "unit_staffing_rules.hard_block_unavailable_percent").fill("20");
  await setting(p, "unit_staffing_rules.hard_block_unavailable_percent").scrollIntoViewIfNeeded();
  await noSideways(p, "limits 390 with errors");
  await shot(p, "limits-390-dark-errors");
  await input(p, "unit_staffing_rules.hard_block_unavailable_percent").fill("40");
  await p.locator(".limits-targets").scrollIntoViewIfNeeded();
  await shot(p, "limits-390-dark-targets");
  // Keyboard: Tab from the box reaches the next setting's box; Enter does not submit.
  await input(p, "duty_count_limits.max_24hr_per_month").focus();
  await p.keyboard.press("Enter");
  eq(await p.locator("dialog[open]").count(), 0, "Enter does not open anything");
  await p.locator("[data-limits-save]").click();
  const dlg = p.locator("dialog[open]");
  await dlg.locator(".limits-impact").waitFor();
  await noSideways(p, "save dialog 390");
  await axeClean(p, "save dialog 390", "dialog[open]");
  await p.emulateMedia({ colorScheme: "dark" });
  await shot(p, "limits-save-dialog-390-dark");
  await p.keyboard.press("Escape");
  await p.locator("dialog").waitFor({ state: "detached" });
  ok(await p.evaluate(() => document.activeElement?.matches("[data-limits-save]")), "focus returns to Save limits…");
  await p.locator("[data-limits-history]").click();
  await p.locator("dialog[open] .limits-history__item").first().waitFor();
  await noSideways(p, "history 390");
  await shot(p, "limits-history-390-dark");
  await p.keyboard.press("Escape");
  await p.emulateMedia({ colorScheme: "light" });
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot(p, "limits-390-light");
  eq(pageErrors, [], "no page errors (390)");
  await ctx.close();
}

// 10. Load failures: 403 and a server error with retry.
{
  const server = makeServer();
  server.getQueue.push([{ detail: "Superadmin role required" }, 403]);
  const { ctx, p } = await appPage({ server });
  await p.goto(base + "/#view=limits");
  await p.getByText("Only a superadmin can open Limits").waitFor();
  await ctx.close();
  const s2 = makeServer();
  s2.getQueue.push([{ detail: "boom" }, 500]);
  const b = await appPage({ server: s2 });
  await b.p.goto(base + "/#view=limits");
  await b.p.getByText("Limits could not load").waitFor();
  await b.p.locator("[data-limits-retry]").click();
  await b.p.locator(".limits-card").first().waitFor();
  ok(true, "retry after a load error");
  await b.ctx.close();
}

// 11. Publish: call level blocker and the uneven-duties spread table.
{
  const publish = {
    month: "2026-06", rota_period: { id: "rp", name: "June", starts_on: "2026-06-01", ends_on: "2026-06-30", status: "draft" },
    rule_version: { id: "rv", name: "Rules v3" },
    summary: { total_slots: 120, assigned_slots: 120, open_slots: 0, review_items: 2, hard_blocked_items: 0, override_assignments: 0, pending_exchange_requests: 0, call_level_mismatch_items: 2 },
    can_publish: false, requires_warning_confirmation: true,
    checks: [{ status: "clear", title: "Open slots", detail: "Every slot is assigned." }],
    blockers: [{ status: "blocked", title: "Call level mismatches", detail: "2 duties are held by members whose call level no longer matches (for example after a promotion)." }],
    warnings: [{ status: "warning", title: "Duty totals uneven within a call level", detail: "3rd call: 4 to 7 duties (target 5.33, gap 3, allowed 1)." }],
    latest_publish: null,
    call_level_spread: [
      { call_level: "2ND_CALL", label: "2nd call", target: 6, min: 6, max: 6, gap: 0, allowed_gap: 1, ok: true, members: [] },
      { call_level: "3RD_CALL", label: "3rd call", target: 5.33, min: 4, max: 7, gap: 3, allowed_gap: 1, ok: false, reason: "Includes 1 extra duty placed by the extra-duty layer.",
        members: [{ person_id: "a", name: "Dr Asha", duties: 7, extra_duties: 1, diff_from_target: 1.67 }, { person_id: "b", name: "Dr Bina", duties: 4, extra_duties: 0, diff_from_target: -1.33 },
          { person_id: "c", name: "Dr Chitra", duties: 5, extra_duties: 0, diff_from_target: -0.33 }] },
    ],
  };
  for (const width of [1280, 390]) {
    const { ctx, p, pageErrors } = await appPage({ width, publish });
    await p.goto(base + "/#view=rota-publish");
    await p.locator("#publish-checklist-title").waitFor();
    const blocker = p.locator(".publish-check.is-blocked").filter({ hasText: "Call level mismatches" });
    eq(await blocker.count(), 1, "call level blocker");
    ok(/2 duties are held/.test(await blocker.innerText()), "blocker detail");
    eq(await blocker.locator('[data-view-shortcut="rota-review"]').count(), 1, "blocker links to Rota Review");
    const spread = p.locator("[data-call-level-spread]");
    await spread.waitFor();
    eq(await spread.getAttribute("open"), "", "spread open when uneven");
    ok(/1 level uneven/.test(await spread.locator("summary").first().innerText()), "summary counts uneven levels");
    const rows = await spread.locator("tbody tr").allInnerTexts();
    ok(/^3rd call/.test(rows[0].trim()), "uneven level first");
    ok(/5\.33/.test(rows[0]) && /3\s*\/ 1 allowed/.test(rows[0]) && /2 members/.test(rows[0]), "target, gap and off-target count");
    ok(/Even/.test(rows[1]), "even level");
    const members = await spread.locator(".limits-spread__members li").allInnerTexts();
    eq(members.length, 2, "only members outside 5–6 listed");
    ok(/Dr Bina/.test(members[0]) && /-1\.33/.test(members[0]), "below target first");
    ok(/Dr Asha/.test(members[1]) && /1 extra/.test(members[1]) && /\+1\.67/.test(members[1]), "extra duties shown");
    ok(/extra-duty layer/.test(await spread.innerText()), "reason shown");
    await noSideways(p, `publish spread ${width}`);
    await axeClean(p, `publish spread ${width}`, "#view-root");
    await spread.scrollIntoViewIfNeeded();
    await shot(p, `limits-publish-spread-${width}`);
    await spread.locator("summary").first().click();
    eq(await spread.getAttribute("open"), null, "spread collapses");
    eq(pageErrors, [], `no page errors (publish ${width})`);
    await ctx.close();
  }
}

await browser.close();
console.log(`limits UI: all ${checks} checks passed`);
