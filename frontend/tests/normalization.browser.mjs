import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.MEMBER_TEST_BROWSER
    ? { executablePath: process.env.MEMBER_TEST_BROWSER }
    : {}),
});
const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const member = {
  id: "11111111-1111-1111-1111-111111111111",
  canonical_name: "Dr. Asha AJ",
  active_status: "active",
  call_level: "2ND_CALL",
  designations: [],
  aliases: [],
};
const unit = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Unit IV",
  code: "MAIN_UNIT_4",
  campus: "Main",
  active_status: "active",
  minimum_free_people: 1,
  aliases: [],
  notes: "",
  revision: "first",
  usage: { postings: 1, duties: 0, future_postings: 1, future_duties: 0 },
};
const refs = {
  posting_type: [{ key: "2ND_CALL", label: "Second call", active: true }],
  leave_type: [{ key: "ANNUAL_LEAVE", label: "Annual leave", active: true }],
  leave_slot: [{ key: "FULL_DAY", label: "Full day", active: true }],
  leave_status: [
    { key: "requested", label: "Requested", active: true },
    { key: "approved", label: "Approved", active: true },
  ],
};
let workflows = 0;
try {
  for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    let units = [unit],
      savedPayload;
    await page.route("**/__normalization-test", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><button id="opener">Open editor</button></body></html>',
      }),
    );
    await page.route("**/api/v1/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      let json = {};
      if (path === "/api/v1/admin/members") json = [member];
      else if (path === "/api/v1/normalization/units" && req.method() === "GET")
        json = units;
      else if (
        path === "/api/v1/normalization/units" &&
        req.method() === "POST"
      ) {
        const payload = req.postDataJSON();
        json = {
          ...unit,
          ...payload,
          id: "33333333-3333-3333-3333-333333333333",
          call_minimums: (payload.call_minimums || []).map((row) => [
            row.call_level,
            row.minimum_free_people,
          ]),
        };
        units.push(json);
      } else if (path.endsWith("/suggest-code")) json = { code: "MAIN_UNIT_5" };
      else if (path.includes("/catalog/"))
        json = (refs[path.split("/").at(-1)] || []).map((item) => ({
          ...item,
          aliases: [],
          version: 0,
          behavior: { maps_to: item.key },
          usage: { records: 0 },
        }));
      else if (path.endsWith("/preview") && path.includes("/records/")) {
        const payload = req.postDataJSON();
        json = {
          after: payload.values,
          before: null,
          review_token: "reviewed",
          duties: [],
          availability: "Approved leave blocks availability.",
        };
      } else if (path.endsWith("/save")) {
        savedPayload = req.postDataJSON();
        json = { id: "saved", ...savedPayload.values };
      } else if (path.endsWith("/columns"))
        json = {
          headers: ["Employee", "Beginning"],
          fields: ["member_name", "starts_on"],
          suggested: { Employee: "member_name", Beginning: "starts_on" },
        };
      else if (path === "/api/v1/import-review/leave/preview")
        json = {
          id: "batch",
          kind: "leave",
          month: "2026-10",
          mode: "append",
          headers: ["Employee", "Beginning"],
          fields: ["member_name", "starts_on"],
          replacement_scope: [],
          rows: Array.from({ length: 26 }, (_, i) => ({
            key: `CSV:${i + 2}`,
            source: { sheet: "CSV", row: i + 2 },
            original: { Employee: member.canonical_name },
            values: {
              member_name: member.canonical_name,
              starts_on: `2026-10-${String(i + 1).padStart(2, "0")}`,
              leave_type: "ANNUAL_LEAVE",
              leave_slot: "FULL_DAY",
              status: "requested",
            },
            after: { person_id: member.id },
            person_match: { reason: "Exact normalized name", candidates: [] },
            issues: [],
            warnings: [],
            action: "create",
          })),
        };
      else if (path.endsWith("/apply"))
        json = {
          created: 26,
          updated: 0,
          unchanged: 0,
          excluded: 0,
          removed: 0,
          batch_id: "batch",
        };
      else
        return route.fulfill({
          status: 404,
          json: { detail: `Unexpected request ${path}` },
        });
      await route.fulfill({ json });
    });
    await page.goto(`${base}/__normalization-test`);
    await page.evaluate(async (id) => {
      const { openRecordEditor } = await import("/src/record-workspace.ts");
      await openRecordEditor("units", id, undefined, true, () => {});
    }, member.id);
    let editor = page.locator("dialog.record-workspace");
    await editor.locator("[name=unit_id]").selectOption(unit.id);
    await editor.locator("[name=notes]").fill("Preserve this posting draft");
    await editor
      .getByRole("button", { name: "Create unit", exact: true })
      .click();
    const nested = page.locator("dialog.reference-workspace");
    await nested.locator("[name=name]").fill("Unit V");
    await nested.locator("[name=campus]").fill("Main");
    await nested
      .getByRole("button", { name: "Create unit", exact: true })
      .click();
    await nested.waitFor({ state: "detached" });
    assert.equal(
      await editor.locator("[name=notes]").inputValue(),
      "Preserve this posting draft",
    );
    assert.equal(
      await editor.locator("[name=unit_id]").inputValue(),
      "33333333-3333-3333-3333-333333333333",
    );
    await editor
      .getByRole("button", { name: "Review changes", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Save reviewed changes", exact: true })
      .click();
    await editor.waitFor({ state: "detached" });
    assert.equal(savedPayload.values.notes, "Preserve this posting draft");
    workflows++;

    await page.evaluate(async (id) => {
      const { openRecordEditor } = await import("/src/record-workspace.ts");
      await openRecordEditor("leave", id, undefined, true, () => {});
    }, member.id);
    editor = page.locator("dialog.record-workspace");
    await editor.locator("[name=ends_on]").fill("2026-10-31");
    await editor
      .getByRole("button", { name: "Review changes", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Save reviewed changes", exact: true })
      .waitFor();
    assert.equal(await editor.locator("[data-save]").isDisabled(), false);
    await editor.locator("[name=notes]").fill("Changed after review");
    assert.equal(await editor.locator("[data-save]").isDisabled(), true);
    const metrics = await editor.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    assert.ok(metrics.width <= width + 1, JSON.stringify(metrics));
    assert.ok(metrics.scroll <= metrics.client + 1, JSON.stringify(metrics));
    if (width === 390) {
      await mkdir("tests/artifacts", { recursive: true });
      await page.screenshot({
        path: "tests/artifacts/leave-editor-mobile.png",
      });
    }
    await editor.locator("[data-close]").first().click();
    workflows++;

    await page.evaluate(async () => {
      const { openOperationalImport } =
        await import("/src/operational-import.ts");
      await openOperationalImport("leave", "2026-10", () => {}, true);
    });
    const importer = page.locator("dialog.operational-import");
    await importer.locator("input[type=file]").setInputFiles({
      name: "leave.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Employee,Beginning\nAsha AJ,2026-10-03\n"),
    });
    await importer.locator('[data-map="0"]').waitFor({ state: "attached" });
    await importer
      .getByRole("button", { name: "Preview and normalize", exact: true })
      .click();
    await importer.locator("[data-review-row]").first().waitFor();
    await importer.locator("[data-include]").first().uncheck();
    assert.match(
      await importer.locator("[data-review-counts]").innerText(),
      /25 ready.*1 excluded/,
    );
    await importer.locator("[data-include]").first().check();
    await importer
      .locator("[data-row][data-field=starts_on]")
      .first()
      .fill("2026-10-02");
    await importer
      .locator("[data-row][data-field=starts_on]")
      .first()
      .dispatchEvent("change");
    assert.equal(await importer.locator("[data-apply]").isDisabled(), true);
    await importer
      .getByRole("button", { name: "Next rows", exact: true })
      .click();
    assert.equal(
      await importer.locator("[data-apply]").isDisabled(),
      true,
      "Paging must preserve stale-review protection",
    );
    await importer
      .getByRole("button", { name: "Manage labels and mappings", exact: true })
      .click();
    await page
      .locator("dialog.reference-workspace")
      .getByRole("heading", {
        name: "Reference labels and mappings",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("button", { name: "Close reference management", exact: true })
      .click();
    assert.equal(
      await importer.locator("[data-apply]").isDisabled(),
      true,
      "Nested reference management must retain the pending review state",
    );
    await importer
      .getByRole("button", { name: "Refresh normalized preview", exact: true })
      .click();
    await importer.locator("[data-apply]:not([disabled])").waitFor();
    await importer.locator("[data-apply]").click();
    await importer
      .getByRole("heading", { name: "Import complete", exact: true })
      .waitFor();
    const [report] = await Promise.all([
      page.waitForEvent("download"),
      importer.locator("[data-download-completed-report]").click(),
    ]);
    assert.equal(report.suggestedFilename(), "leave-normalization-report.csv");
    assert.deepEqual(errors, []);
    workflows++;
    await page.close();
  }
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      let json = [];
      if (path.endsWith("/auth/me"))
        json = {
          id: "operator",
          username: "test",
          display_name: "Test Operator",
          role: "computer_admin",
          active_status: "active",
        };
      else if (path.endsWith("/analysis/dashboard"))
        return route.fulfill({
          status: 503,
          json: { detail: "Analysis unavailable in navigation fixture" },
        });
      else if (path.endsWith("/health")) json = { status: "ok" };
      else if (path.endsWith("/mappings/options"))
        json = { duty_types: [], mapping_types: [] };
      else if (path.endsWith("/members")) json = [member];
      else if (path.endsWith("/normalization/units")) json = [unit];
      else if (path.includes("/normalization/catalog/"))
        json = (refs[path.split("/").at(-1)] || []).map((i) => ({
          ...i,
          aliases: [],
          version: 0,
          behavior: { maps_to: i.key },
          usage: { records: 0 },
        }));
      else if (path.endsWith("/unit-management/month"))
        json = {
          month: "2026-10",
          starts_on: "2026-10-01",
          ends_on: "2026-10-31",
          units: [unit],
          assignments: [],
          unit_summaries: [],
          unit_call_minimums: [],
          validation_issues: [],
        };
      else if (path.endsWith("/leave/calendar"))
        json = {
          month: "2026-10",
          summary: {
            month: "2026-10",
            starts_on: "2026-10-01",
            ends_on: "2026-10-31",
            total_requests: 0,
            people_on_leave: 0,
            total_leave_days: 0,
            call_level_counts: {},
            unit_counts: {},
          },
          days: {},
        };
      else if (path.endsWith("/leave/pressure"))
        json = { days: [], call_level_totals: {}, unit_totals: {} };
      return route.fulfill({ json });
    });
    await page.goto(base);
    await page
      .locator('[data-view="units"]')
      .first()
      .evaluate((button) => button.click());
    await page.locator("[data-add-department-unit]").click();
    await page.locator("dialog.reference-workspace [name=name]").waitFor();
    await page
      .locator("dialog.reference-workspace [data-close]")
      .first()
      .click();
    await page.locator('[data-open-normalized-import="units"]').click();
    await page
      .getByRole("heading", {
        name: "Import unitwise assignments",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("button", { name: "Close import review", exact: true })
      .click();
    await page.locator('[data-add-operational-record="units"]').click();
    await page
      .getByRole("heading", { name: "Add posting", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Close editor", exact: true })
      .click();
    await page
      .locator('[data-view="leave"]')
      .first()
      .evaluate((button) => button.click());
    await page.locator('[data-add-operational-record="leave"]').click();
    await page
      .getByRole("heading", { name: "Add leave", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Close editor", exact: true })
      .click();
    await page.locator('[data-open-normalized-import="leave"]').click();
    await page
      .locator("dialog")
      .getByRole("heading", { name: "Import leave", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Close import review", exact: true })
      .click();
    await page
      .locator('[data-view="mappings"]')
      .first()
      .evaluate((button) => button.click());
    await page.locator("[data-create-import-mapping]").click();
    await page
      .getByRole("heading", { name: "Add Mapping", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Close mapping creation", exact: true })
      .click();
    await page.locator("[data-manage-reference-catalog]").click();
    await page
      .getByRole("heading", {
        name: "Reference labels and mappings",
        exact: true,
      })
      .waitFor();
    await page.locator("dialog [data-kind]").selectOption("duty_type");
    await page.locator("dialog [name=duration_hours]").waitFor();
    await page
      .getByRole("button", { name: "Close reference management", exact: true })
      .click();
    assert.deepEqual(errors, []);
    workflows++;
    await page.close();
  }
  console.log(`${workflows} desktop/mobile normalization workflows passed`);
} finally {
  await browser.close();
}
