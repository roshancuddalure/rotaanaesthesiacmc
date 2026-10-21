// Rota Rules page (docs/rota_rules_contract.md) against a mocked API: plain-click group chips,
// locked call levels added by a group, visible hints, unsaved bar, blocking errors with
// "Go to duty", warnings "Save anyway" with base_revision, the 409 stale flow, history
// compare/restore, search and filters, axe in light and dark, and no sideways scroll at 390px.
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const artifacts = new URL("./artifacts/", import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MEMBER_TEST_BROWSER ? { executablePath: process.env.MEMBER_TEST_BROWSER } : {}),
});

const HINT = {
  active: "The duty exists in this department. Inactive duties are hidden from templates and never generated.",
  mandatory: "Generated automatically every day when a month's template is built, and the generator must fill it first.",
  adjustable: "Optional: not generated unless you tick it in the template's duty list for that month.",
  sameDay: "Whoever does this duty cannot take another duty that same day. 24-hour duties always do this.",
  nextDay: "Whoever does this duty is rested the next day and gets no duty then. 24-hour duties always do this.",
};

const GROUPS = [
  { key: "pac_sr", name: "PAC SR", call_level: "3RD_CALL", active: true, members: 5 },
  { key: "pac_senior", name: "PAC Senior", call_level: "4TH_CALL", active: true, members: 3 },
  { key: "schell", name: "Schell", call_level: "2ND_CALL", active: true, members: 4 },
  { key: "old_group", name: "Old group", call_level: "1ST_CALL", active: false, members: 0 },
];

function duty(key, label, group, extra = {}) {
  return {
    key, label, group, campus: "Main campus", duration_hours: 8, start_time: "08:00", end_time: "16:00",
    is_24hr: false, counts_in_main_24hr: false, is_mandatory: false, is_adjustable: false,
    blocks_elective_same_day: false, blocks_elective_next_day: false, active: true,
    allowed_call_levels: [], allowed_cluster_keys: [], excluded_cluster_keys: [],
    allowed_designations: [], allowed_units: [], excluded_units: [], ...extra,
  };
}

function initialDuties() {
  return [
    duty("MAIN_3RD_CALL", "Main 3rd call", "main", { duration_hours: 24, is_24hr: true, is_mandatory: true, start_time: "08:00", end_time: "08:00" }),
    duty("RC_2ND_CALL", "RC 2nd call", "rc", { is_mandatory: true }),
    duty("PAC_DUTY", "PAC duty", "pac", { allowed_call_levels: ["3RD_CALL"], is_adjustable: true }),
    duty("CB_1ST_CALL", "CB 1st call", "cb"),
    duty("SHIFT_EVENING", "Evening shift", "shift", { active: false }),
  ];
}

function rulesDoc(revision, duties, extra = {}) {
  return {
    revision, groups: GROUPS,
    rule_version: { id: "rv", name: "Phase one", description: null, effective_from: "2026-01-01", effective_to: null, is_active: true, created_at: "2026-01-01T00:00:00Z" },
    duty_rules: duties,
    duty_count_limits: { max_24hr_per_month: 8, max_weekend_24hr_per_month: null, max_same_group_per_month: null, max_same_campus_per_month: null },
    rest_rules: { minimum_gap_after_24hr_hours: 24, post_24hr_blocks_next_day_elective: true },
    unit_staffing_rules: { minimum_available_count: 1, warning_unavailable_percent: 30, hard_block_unavailable_percent: 25, small_unit_uses_absolute_minimum: true },
    ...extra,
  };
}

const LEVEL_OF = Object.fromEntries(GROUPS.map((g) => [g.key, g.call_level]));
function inferred(key) {
  for (const [needle, level] of [["1ST", "1ST_CALL"], ["2ND", "2ND_CALL"], ["3RD", "3RD_CALL"], ["4TH", "4TH_CALL"]]) if (key.includes(needle)) return [level];
  return [];
}
function checkOf(body) {
  const problems = [];
  const duties = {};
  for (const rule of body.duty_rules) {
    const levels = new Set([...(rule.allowed_call_levels.length ? rule.allowed_call_levels : inferred(rule.key)),
      ...rule.allowed_cluster_keys.filter((k) => GROUPS.find((g) => g.key === k)?.active).map((k) => LEVEL_OF[k])]);
    const eligible = rule.key === "CB_1ST_CALL" ? 0 : 6 + rule.allowed_cluster_keys.length;
    duties[rule.key] = { effective_call_levels: [...levels], eligible_now: eligible, eligible_by_level: Object.fromEntries([...levels].map((l, i) => [l, i ? 2 : eligible - 2 * (levels.size - 1)])) };
    if (rule.duration_hours > 48) problems.push({ duty_key: rule.key, field: "duration_hours", code: "bad_hours", severity: "error", message: "Hours out of range.", fix: "Use 0 to 48 hours." });
    if (rule.active && eligible === 0) problems.push({ duty_key: rule.key, field: "allowed_call_levels", code: "nobody_eligible", severity: "warning", message: "Nobody is eligible for this active duty.", fix: "Add a call level or a group with members." });
  }
  const u = body.unit_staffing_rules;
  if (u.hard_block_unavailable_percent < u.warning_unavailable_percent) {
    problems.push({ duty_key: null, field: "unit_staffing_rules.hard_block_unavailable_percent", code: "guardrail", severity: "warning", message: "Hard block % is below warning %.", fix: "Raise the hard block to at least the warning %." });
  }
  return { problems, duties };
}

async function openPage({ width, scheme }) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const server = { revision: "rev-1", duties: initialDuties(), puts: [], restores: [], checks: 0 };
  await page.route("**/__rota-rules-test", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rota rules test</title><link rel="stylesheet" href="/src/styles.css"></head><body><main style="padding:16px"><div id="view-root"></div></main></body></html>',
  }));
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    if (path.endsWith("/rota-rules/phase-one") && method === "GET") return route.fulfill({ json: rulesDoc(server.revision, server.duties) });
    if (path.endsWith("/rota-rules/phase-one/check")) { server.checks += 1; return route.fulfill({ json: checkOf(req.postDataJSON()) }); }
    if (path.endsWith("/rota-rules/phase-one") && method === "PUT") {
      const body = req.postDataJSON();
      server.puts.push(body);
      if (body.base_revision !== server.revision) {
        return route.fulfill({ status: 409, json: { detail: { code: "stale_rules", message: "The rules changed since you loaded them.", current_revision: server.revision } } });
      }
      server.revision = `rev-${Number(server.revision.split("-")[1]) + 1}`;
      server.duties = body.duty_rules;
      return route.fulfill({ json: rulesDoc(server.revision, server.duties) });
    }
    if (path.endsWith("/phase-one/versions")) {
      return route.fulfill({ json: [
        { version_id: "v2", saved_at: "2026-10-21T10:15:00Z", saved_by: "Dr Asha", revision: server.revision, changed_duties: ["PAC duty"], note: null },
        { version_id: "v1", saved_at: "2026-10-01T09:00:00Z", saved_by: "Dr Ben", revision: "rev-0", changed_duties: ["Main 3rd call"], note: "Before history" },
      ] });
    }
    if (path.endsWith("/phase-one/versions/v1")) return route.fulfill({ json: { version_id: "v1", saved_at: "2026-10-01T09:00:00Z", saved_by: "Dr Ben", rules: rulesDoc("rev-0", initialDuties()) } });
    if (path.endsWith("/phase-one/versions/v1/restore")) {
      server.restores.push(req.postDataJSON());
      server.revision = "rev-9";
      server.duties = initialDuties();
      return route.fulfill({ json: rulesDoc(server.revision, server.duties) });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(base + "/__rota-rules-test");
  await page.evaluate(async () => {
    const mod = await import("/src/rota-rules.ts");
    window.__nav = [];
    window.__rr = mod;
    await mod.renderRotaRulesPage(document.getElementById("view-root"), { onNavigate: (view) => window.__nav.push(view) });
  });
  await page.locator('[data-duty-row="PAC_DUTY"] .rr-count').waitFor();
  return { context, page, errors, server };
}

const row = (page, key) => page.locator(`[data-duty-row="${key}"]`);
const visibleRows = (page) => page.locator("[data-duty-row]").evaluateAll((rows) => rows.map((r) => r.dataset.dutyRow));
const pressed = (locator) => locator.getAttribute("aria-pressed");

async function axeClean(page, label) {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    const result = await new AxeBuilder({ page }).include(".rr-page")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const severe = result.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    assert.deepEqual(severe.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target).join(" | ")}`), [], `${label} ${scheme} accessibility`);
  }
}

let passed = 0;
const step = (name) => { passed += 1; console.log(`  ok ${passed} - ${name}`); };
try {
  // ---------------------------------------------------------------- desktop, light
  const { context, page, errors, server } = await openPage({ width: 1440, scheme: "light" });

  // Grouped by category, with tiles and an eligible count per duty.
  const cats = await page.locator(".rr-list .rr-cat__name").allInnerTexts();
  assert.deepEqual(cats, ["Main duties", "RC duties", "CB duties", "PAC duties", "Shift duties"]);
  assert.match(await row(page, "PAC_DUTY").locator(".rr-count").innerText(), /6\s*eligible/);
  assert.match(await row(page, "CB_1ST_CALL").locator(".rr-count").innerText(), /Nobody eligible/);
  step("duties grouped by category with eligible counts");

  // Search and filters.
  await page.locator("[data-search]").fill("pac");
  assert.deepEqual(await visibleRows(page), ["PAC_DUTY"]);
  await page.locator("[data-search]").fill("");
  await page.locator('[data-filter-chip="nobody"]').click();
  assert.deepEqual(await visibleRows(page), ["CB_1ST_CALL"]);
  await page.locator('[data-filter-chip="inactive"]').click();
  assert.deepEqual(await visibleRows(page), ["SHIFT_EVENING"]);
  await page.locator('[data-filter-chip="all"]').click();
  assert.equal((await visibleRows(page)).length, 5);
  step("search and filters");

  // Expand PAC duty; two groups by plain clicks.
  await row(page, "PAC_DUTY").locator(".rr-duty__toggle").click();
  const pacRow = row(page, "PAC_DUTY");
  await pacRow.locator(".rr-editor").waitFor();
  const chipSr = () => pacRow.locator('[data-field="allowed_cluster_keys"][data-value="pac_sr"]');
  const chipSenior = () => pacRow.locator('[data-field="allowed_cluster_keys"][data-value="pac_senior"]');
  await chipSr().click();
  await chipSenior().click();
  assert.equal(await pressed(chipSr()), "true");
  assert.equal(await pressed(chipSenior()), "true");
  step("two groups selected by plain clicks");

  // The 4th-call group adds 4th Call as a locked chip.
  const locked = pacRow.locator('[data-locked-level="4TH_CALL"]');
  await locked.waitFor();
  assert.match(await locked.innerText(), /4th Call[\s\S]*added by PAC Senior/);
  assert.equal(await locked.evaluate((el) => el.tagName), "SPAN", "locked chip is not a button");
  step("locked call level added by the 4th-call group");

  // Hints are visible text, not tooltips.
  for (const [name, text] of Object.entries(HINT)) {
    assert.equal(await pacRow.getByText(text, { exact: true }).isVisible(), true, `${name} hint visible`);
  }
  const help = pacRow.locator('[aria-label="More about Groups allowed"]');
  assert.equal(await help.getAttribute("aria-expanded"), "false");
  await help.click();
  assert.equal(await help.getAttribute("aria-expanded"), "true");
  assert.equal(await pacRow.locator(`#${await help.getAttribute("aria-controls")}`).isVisible(), true);
  step("hints visible with expandable details");

  // Live preview updates after the debounce.
  await pacRow.locator(".rr-preview").getByText(/8\s*people are eligible today/).waitFor();
  assert.equal(await page.locator("[data-unsaved-count]").innerText(), "1 unsaved change");
  step("live preview and unsaved bar");

  // Switches are keyboard operable.
  const mandatory = pacRow.locator('[data-flag="is_mandatory"]');
  await mandatory.focus();
  await page.keyboard.press("Space");
  assert.equal(await pacRow.locator('[data-flag="is_mandatory"]').getAttribute("aria-checked"), "true");
  await page.keyboard.press("Space");
  assert.equal(await pacRow.locator('[data-flag="is_mandatory"]').getAttribute("aria-checked"), "false");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.fk), "switch:rr-PAC_DUTY-is_mandatory", "focus stays on the switch");
  step("keyboard switches keep focus");

  // Accessibility with a duty open.
  await axeClean(page, "desktop");
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({ path: fileURLToPath(new URL("rota-rules-1440-light.png", artifacts)), fullPage: true });
  step("axe light and dark (desktop)");

  // Blocking error: hours out of range, Go to duty focuses the field.
  await row(page, "MAIN_3RD_CALL").locator(".rr-duty__toggle").click();
  const hours = row(page, "MAIN_3RD_CALL").locator("[data-num-field]");
  await hours.fill("60");
  assert.equal(await page.locator("[data-unsaved-count]").innerText(), "2 unsaved changes");
  await page.locator("[data-review]").click();
  const dialog = page.locator("dialog.rr-dialog");
  await dialog.getByText("Must be fixed before saving").waitFor();
  assert.equal(await dialog.locator("[data-save]").isDisabled(), true);
  await dialog.getByRole("button", { name: "Go to duty: Main 3rd call" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.dataset.fk === "hours:MAIN_3RD_CALL");
  await page.locator('[data-fk="hours:MAIN_3RD_CALL"]').fill("24");
  assert.equal(await page.locator("[data-unsaved-count]").innerText(), "1 unsaved change");
  step("errors block saving; Go to duty focuses the field");

  // Someone else saves first: 409, then Review again keeps my edit on top of theirs.
  server.revision = "rev-2";
  server.duties = initialDuties().map((d) => (d.key === "RC_2ND_CALL" ? { ...d, label: "RC 2nd call (renamed)" } : d));
  await page.locator("[data-review]").click();
  await dialog.getByText("Worth a look").waitFor();
  const saveAnyway = dialog.getByRole("button", { name: "Save anyway" });
  await saveAnyway.click();
  await dialog.getByText("Another admin changed the rules").waitFor();
  assert.equal(server.puts.at(-1).base_revision, "rev-1");
  await dialog.getByRole("button", { name: "Review again" }).click();
  await dialog.getByText("Your edits were laid over the latest rules").waitFor();
  await dialog.getByRole("button", { name: "Save anyway" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.locator(".rr-status").getByText("Rota rules saved").waitFor();
  const put = server.puts.at(-1);
  assert.equal(put.base_revision, "rev-2");
  const savedPac = put.duty_rules.find((d) => d.key === "PAC_DUTY");
  assert.deepEqual([...savedPac.allowed_cluster_keys].sort(), ["pac_senior", "pac_sr"]);
  assert.equal(put.duty_rules.find((d) => d.key === "RC_2ND_CALL").label, "RC 2nd call (renamed)", "the other admin's change is kept");
  assert.equal("groups" in put || "revision" in put || "rule_version" in put, false, "server-only fields are not sent");
  assert.equal(await page.locator(".rr-savebar").isHidden(), true);
  step("409 stale flow, Save anyway sends base_revision and both groups");

  // History: compare and restore with base_revision.
  await page.getByRole("button", { name: "History" }).click();
  await dialog.getByText("by Dr Ben").waitFor();
  const v1 = dialog.locator(".rr-history__item").nth(1);
  await v1.getByRole("button", { name: "Compare with current" }).click();
  await v1.getByText(/Groups allowed: none → PAC SR, PAC Senior|Groups allowed: none → PAC Senior, PAC SR/).waitFor();
  await v1.getByRole("button", { name: "Restore…" }).click();
  await dialog.getByRole("button", { name: "Restore this version" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.locator(".rr-status").getByText("Restored the rules saved").waitFor();
  assert.deepEqual(server.restores, [{ base_revision: "rev-3" }]);
  assert.equal(await pressed(row(page, "PAC_DUTY").locator('[data-field="allowed_cluster_keys"][data-value="pac_sr"]')), "false", "restored rules are shown");
  step("history compare and restore");

  // Navigation hook and guard.
  await page.getByRole("button", { name: "Manage eligibility groups" }).first().click();
  assert.deepEqual(await page.evaluate(() => window.__nav), ["call-clusters"]);
  assert.equal(await page.evaluate(() => window.__rr.rotaRulesHasUnsavedChanges()), false);
  await row(page, "PAC_DUTY").locator('[data-field="allowed_cluster_keys"][data-value="schell"]').click();
  assert.equal(await page.evaluate(() => window.__rr.rotaRulesHasUnsavedChanges()), true);
  step("unsaved-change guard reports edits");
  assert.deepEqual(errors, []);
  await context.close();

  // ---------------------------------------------------------------- phone, dark
  const phone = await openPage({ width: 390, scheme: "dark" });
  await row(phone.page, "PAC_DUTY").locator(".rr-duty__toggle").click();
  await row(phone.page, "PAC_DUTY").locator('[data-field="allowed_cluster_keys"][data-value="pac_senior"]').click();
  await row(phone.page, "PAC_DUTY").locator(".rr-preview").getByText(/people are eligible today/).waitFor();
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `no sideways scroll at 390px (overflow ${overflow}px)`);
  await axeClean(phone.page, "phone");
  await phone.page.emulateMedia({ colorScheme: "dark" });
  await phone.page.screenshot({ path: fileURLToPath(new URL("rota-rules-390-dark.png", artifacts)), fullPage: true });
  assert.deepEqual(phone.errors, []);
  step("390px dark: no sideways scroll, axe clean");
  await phone.context.close();
  console.log(`${passed} rota rules checks passed`);
} finally {
  await browser.close();
}
