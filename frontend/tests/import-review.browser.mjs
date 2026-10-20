// Import review rows (unit/leave): a name that needs a decision shows the alternatives as
// buttons, one click chooses the member and re-checks the row, and Apply explains in plain
// words what still blocks it. Uses a mocked API, like normalization.browser.mjs.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MEMBER_TEST_BROWSER ? { executablePath: process.env.MEMBER_TEST_BROWSER } : {}),
});
const people = [
  { id: "11111111-1111-1111-1111-111111111111", canonical_name: "Samcharles D", active_status: "active", call_level: "1ST_CALL", designations: [], aliases: [] },
  { id: "22222222-2222-2222-2222-222222222222", canonical_name: "Samuel David Chandran", active_status: "active", call_level: "4TH_CALL", designations: [], aliases: [] },
];
const row = (resolved) => ({
  key: "CSV:2",
  source: { sheet: "CSV", row: 2 },
  original: { Employee: "Sam" },
  values: { member_name: "Sam", starts_on: "2026-10-03", leave_type: "ANNUAL_LEAVE", leave_slot: "FULL_DAY", status: "requested" },
  after: { person_id: resolved ? people[1].id : null },
  person_match: resolved
    ? { raw: "Sam", state: "matched", status: "matched", canonical_name: people[1].canonical_name, method: "member_id", reason: "Chosen by member ID", warnings: [], candidates: [] }
    : {
        raw: "Sam", state: "needs_review", status: "needs_review", canonical_name: null, method: null,
        reason: "'Sam' means different people by call level or date; this row has no call level", warnings: [],
        candidates: people.map((p) => ({ id: p.id, name: p.canonical_name, status: "active", call_level: p.call_level, units: [], reason: "possible by call level / date" })),
      },
  issues: resolved ? [] : ["Choose the department member for 'Sam': 'Sam' means different people by call level or date"],
  warnings: [],
  action: resolved ? "create" : "needs_review",
});

let checks = 0;
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    let previews = 0;
    let sentChoice = null;
    await page.route("**/__import-review-test", (route) =>
      route.fulfill({ contentType: "text/html", body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body></body></html>' }));
    await page.route("**/api/v1/**", async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      let json = {};
      if (path === "/api/v1/admin/members") json = people;
      else if (path === "/api/v1/normalization/units") json = [];
      else if (path.endsWith("/columns")) json = { headers: ["Employee", "Beginning"], fields: ["member_name", "starts_on"], suggested: { Employee: "member_name", Beginning: "starts_on" } };
      else if (path === "/api/v1/import-review/leave/preview") {
        previews += 1;
        const body = req.postData() || "";
        const settings = body.match(/name="settings_json"\r?\n\r?\n([^\r\n]+)/)?.[1];
        if (settings) sentChoice = JSON.parse(settings).corrections?.["CSV:2"]?.person_id ?? sentChoice;
        json = { id: "batch", kind: "leave", month: "2026-10", mode: "append", headers: ["Employee", "Beginning"],
                 fields: ["member_name", "starts_on"], replacement_scope: [], rows: [row(previews > 1)] };
      }
      return route.fulfill({ json });
    });
    await page.goto(base + "/__import-review-test");
    await page.evaluate(async () => {
      const { openOperationalImport } = await import("/src/operational-import.ts");
      await openOperationalImport("leave", "2026-10", () => {}, true);
    });
    const importer = page.locator("dialog.operational-import");
    await importer.locator("input[type=file]").setInputFiles({ name: "leave.csv", mimeType: "text/csv", buffer: Buffer.from("Employee,Beginning\nSam,2026-10-03\n") });
    await importer.locator('[data-map="0"]').waitFor({ state: "attached" });
    await importer.getByRole("button", { name: "Preview and normalize", exact: true }).click();
    await importer.locator("[data-review-row]").first().waitFor();

    // The row shows the written name, that it needs a choice, why, and both people as buttons.
    const match = importer.locator(".member-match").first();
    assert.match(await match.innerText(), /Sam[\s\S]*Needs your choice[\s\S]*different people by call level/);
    const picks = importer.locator("[data-pick-member]");
    assert.equal(await picks.count(), 2);
    assert.match(await picks.nth(1).innerText(), /Samuel David Chandran/);

    // No serious or critical accessibility problems in the review window (WCAG 2.2 AA), light and dark.
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      const axe = await new AxeBuilder({ page }).include("dialog.operational-import")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const severe = axe.violations.filter((v) => ["serious", "critical"].includes(v.impact));
      assert.deepEqual(severe.map((v) => `${v.id}: ${v.nodes[0]?.target}`), [], `${scheme} accessibility`);
    }

    // Apply explains what blocks it, next to the button.
    const blocker = importer.locator("[data-apply-blocker]");
    await mkdir("tests/artifacts", { recursive: true });
    await importer.locator("[data-review-row]").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `tests/artifacts/import-review-${width}.png` });
    assert.match(await blocker.innerText(), /1 row needs a decision[\s\S]*row 2 “Sam”/);
    await importer.locator("[data-apply]").click();
    assert.match(await importer.locator("[data-apply-status]").innerText(), /still need review|needs a decision/);

    // One click chooses the member and re-checks the row; the blocker clears.
    await picks.nth(1).click();
    await importer.locator('.member-match[data-match-status="matched"]').waitFor();
    assert.equal(previews, 2, "choosing a member re-runs the preview");
    if (sentChoice !== null) assert.equal(sentChoice, people[1].id, "the chosen member is sent to the server");
    assert.match(await importer.locator(".member-match").first().innerText(), /Samuel David Chandran[\s\S]*Match: chosen by you/);
    assert.equal((await blocker.innerText()).trim(), "");

    // Row edits live in a collapsed section; nothing overflows on a phone.
    assert.equal(await importer.locator(".import-row__edit").first().evaluate((d) => d.open), false);
    const overflow = await importer.evaluate((d) => d.scrollWidth > d.clientWidth + 1);
    assert.equal(overflow, false, `no sideways scroll at ${width}px`);
    assert.deepEqual(errors, []);
    checks++;
    await context.close();
  }
  console.log(`${checks} import review workflows passed`);
} finally {
  await browser.close();
}
