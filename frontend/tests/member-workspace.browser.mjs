// Run against Vite: MEMBER_TEST_URL=http://127.0.0.1:5178 node tests/member-workspace.browser.mjs
import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.MEMBER_TEST_BROWSER
    ? { executablePath: process.env.MEMBER_TEST_BROWSER }
    : {}),
});
const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const member = {
  id: "11111111-1111-1111-1111-111111111111",
  canonical_name: "Dr. Renée <Member> with a long department name",
  active_status: "active",
  call_level: "2ND_CALL",
  archived_at: null,
  revision: "first",
  aliases: [],
  designations: [],
};
const nextMemberId = "22222222-2222-2222-2222-222222222222";
let passed = 0;
try {
  for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/__member-test", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><button id="opener">Open member</button></body></html>`,
      }),
    );
    let shouldFail = false;
    let shouldConflict = false;
    let dutyFailure = true;
    await page.route("**/api/v1/admin/member-workspace/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/duties") && dutyFailure) {
        dutyFailure = false;
        return route.fulfill({
          status: 503,
          json: { detail: "Duty history temporarily unavailable" },
        });
      }
      if (route.request().method() === "PUT") {
        if (shouldConflict)
          return route.fulfill({
            status: 409,
            json: {
              detail: {
                message: "Another operator changed this profile",
                current: {
                  ...member,
                  canonical_name: "Latest Saved Name",
                  revision: "latest",
                },
              },
            },
          });
        if (shouldFail)
          return route.fulfill({
            status: 422,
            json: { detail: "Designation periods overlap" },
          });
        const payload = route.request().postDataJSON();
        return route.fulfill({
          json: { ...member, ...payload, aliases: [], revision: "saved" },
        });
      }
      if (url.pathname.endsWith(member.id))
        return route.fulfill({
          json: {
            member,
            impact: {
              future_duties: 2,
              current_or_future_postings: 1,
              eligibility_memberships: 1,
            },
          },
        });
      if (url.pathname.endsWith(nextMemberId))
        return route.fulfill({
          json: {
            member: {
              ...member,
              id: nextMemberId,
              canonical_name: "Next Member",
            },
            impact: {
              future_duties: 0,
              current_or_future_postings: 0,
              eligibility_memberships: 0,
            },
          },
        });
      return route.fulfill({ json: { rows: [] } });
    });
    await page.goto(`${base}/__member-test`);
    await page.locator("#opener").focus();
    await page.evaluate(async (id) => {
      const m = await import("/src/member-workspace.ts");
      await m.openMemberWorkspace(id, true, () => {}, [
        id,
        "22222222-2222-2222-2222-222222222222",
      ]);
    }, member.id);
    assert.equal(await page.locator("dialog[open]").count(), 1);
    await page.evaluate(() => document.querySelector("#opener").focus());
    assert.equal(
      await page
        .locator("dialog")
        .evaluate((d) => d.contains(document.activeElement)),
      true,
      "Background must remain inert",
    );
    if (process.env.MEMBER_TEST_SCREENSHOTS)
      await page.screenshot({
        path: join(
          process.env.MEMBER_TEST_SCREENSHOTS,
          `member-overview-${width}.png`,
        ),
      });
    assert.equal(
      await page.locator("dialog h2").textContent(),
      member.canonical_name,
    );
    assert.equal(await page.locator("dialog script").count(), 0);
    await page
      .getByRole("button", { name: "Edit profile", exact: true })
      .click();
    await page.getByLabel("Member name", { exact: true }).fill("Changed Name");
    page.once("dialog", (d) => d.dismiss());
    await page.getByRole("button", { name: "Next", exact: true }).click();
    assert.equal(
      await page.getByLabel("Member name", { exact: true }).inputValue(),
      "Changed Name",
    );
    await page.getByRole("tab", { name: "Duty history", exact: true }).click();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page
      .getByText("No duty history records in this range.", { exact: true })
      .waitFor();
    await page
      .getByRole("tab", { name: "Names & duplicates", exact: true })
      .click();
    await page.getByLabel("Aliases (one per line)").fill("Other spelling");
    await page.getByRole("tab", { name: "Details", exact: true }).click();
    assert.equal(
      await page.getByLabel("Member name", { exact: true }).inputValue(),
      "Changed Name",
    );
    const overflow = await page.locator("dialog").evaluate((d) => ({
      width: d.getBoundingClientRect().width,
      scroll: d.scrollWidth,
      client: d.clientWidth,
    }));
    assert.ok(overflow.width <= width + 1, JSON.stringify(overflow));
    assert.ok(overflow.scroll <= overflow.client + 1, JSON.stringify(overflow));
    shouldFail = true;
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await page
      .locator("#mw-error")
      .filter({ hasText: "Designation periods overlap" })
      .waitFor();
    assert.equal(
      await page.getByLabel("Member name", { exact: true }).inputValue(),
      "Changed Name",
    );
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("dialog[open]").count(),
      1,
      "Escape must protect draft",
    );
    shouldFail = false;
    shouldConflict = true;
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Compare changes", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Keep my draft for review", exact: true })
      .click();
    shouldConflict = false;
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit profile", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Edit profile", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "Roles & eligibility", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add position", exact: true })
      .click();
    await page.getByRole("tab", { name: "Details", exact: true }).click();
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("tab", { name: "Roles & eligibility", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    assert.equal(
      await page
        .getByLabel("Designation", { exact: true })
        .getAttribute("aria-invalid"),
      "true",
    );
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page
      .getByRole("heading", { name: "Next Member", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await page
      .getByRole("button", { name: "Close member profile", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Close member profile", exact: true })
      .click();
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "opener",
    );
    const download = await page.request.get(
      `${base}/templates/department-members.csv`,
    );
    assert.equal(download.status(), 200);
    assert.equal(
      (await download.text()).trim(),
      "member_id,canonical_name,active_status,call_level,designation,designation_effective_from",
    );
    assert.deepEqual(errors, []);
    passed++;
    await page.close();
  }
  for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    await page.route("**/__member-test", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body></body></html>`,
      }),
    );
    let previews = 0;
    let applies = 0;
    await page.route(
      "**/api/v1/admin/member-workspace/csv/**",
      async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/columns"))
          return route.fulfill({ json: { headers: ["canonical_name"] } });
        if (path.endsWith("/preview")) {
          previews++;
          return route.fulfill({
            json: {
              id: "batch-test",
              headers: ["canonical_name"],
              rows: [
                {
                  row_number: 2,
                  values: {
                    canonical_name:
                      previews === 1 ? "CSV Example" : "Corrected CSV Example",
                  },
                  action: "create",
                  errors: [],
                  suggestions: [],
                  before: null,
                  after: {
                    canonical_name: "CSV Example",
                    active_status: "active",
                    call_level: null,
                  },
                  person_id: null,
                  revision: null,
                },
              ],
            },
          });
        }
        applies++;
        assert.deepEqual(route.request().postDataJSON(), { excluded: [], archive_missing: [] });
        if (applies === 1)
          return route.fulfill({
            status: 503,
            json: { detail: "Temporary connection problem. Retry." },
          });
        return route.fulfill({
          json: {
            batch_id: "batch-test",
            created: 1,
            updated: 0,
            unchanged: 0,
            excluded: 0,
            members: [
              { id: member.id, canonical_name: "Corrected CSV Example" },
            ],
          },
        });
      },
    );
    await page.goto(`${base}/__member-test`);
    await page.evaluate(async () => {
      const m = await import("/src/member-workspace.ts");
      m.openMemberCsvImport(() => {});
    });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download blank CSV template" }).click(),
    ]);
    assert.equal(download.suggestedFilename(), "department-members.csv");
    const [exampleDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download example CSV (filled)", exact: true }).click()]);
    assert.equal(exampleDownload.suggestedFilename(), "department-members-example.csv");
    await page.locator("input[type=file]").setInputFiles({
      name: "members.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("canonical_name\r\nCSV Example\r\n"),
    });
    await page.getByText("Map CSV columns", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Preview import", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Review changes", exact: true })
      .waitFor();
    await page.getByText("Edit row", { exact: true }).click();
    await page
      .locator('[data-row="2"][data-key="canonical_name"]')
      .fill("Corrected CSV Example");
    // Apply stays clickable but explains why it cannot run yet.
    await page
      .locator(".import-apply-blocker")
      .filter({ hasText: "Refresh the preview before applying" })
      .waitFor();
    await page
      .getByRole("button", { name: "Refresh preview after corrections" })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-key="canonical_name"]')?.value ===
        "Corrected CSV Example",
    );
    assert.equal(await page.locator(".import-apply-blocker").isHidden(), true);
    const [report] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download row report" }).click(),
    ]);
    assert.equal(
      report.suggestedFilename(),
      "department-member-import-report.csv",
    );
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Apply selected rows" }).click();
    await page
      .locator("#csv-message")
      .filter({ hasText: "Temporary connection problem" })
      .waitFor();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Apply selected rows" }).click();
    await page
      .getByRole("heading", { name: "Import complete", exact: true })
      .waitFor();
    assert.equal(applies, 2);
    assert.equal(previews, 2);
    const overflow = await page
      .locator("dialog")
      .evaluate((d) => d.scrollWidth - d.clientWidth);
    assert.ok(overflow <= 1);
    await page
      .getByRole("button", { name: "Close import", exact: true })
      .click();
    passed++;
    await page.close();
  }
  // A possible duplicate: alternatives are one-click buttons and Apply explains what is missing.
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/__member-test", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body></body></html>`,
      }),
    );
    const sentCorrections = [];
    let applies = 0;
    await page.route("**/api/v1/admin/member-workspace/csv/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/columns"))
        return route.fulfill({ json: { headers: ["canonical_name"] } });
      if (path.endsWith("/preview")) {
        const body = route.request().postDataBuffer()?.toString() ?? "";
        const match = body.match(/name="corrections"\r\n\r\n([^\r]*)/);
        const corrections = JSON.parse(match?.[1] || "{}");
        sentCorrections.push(corrections);
        const chosen = corrections["2"]?.member_id === member.id;
        return route.fulfill({
          json: {
            id: "batch-dup",
            mode: "update_existing",
            headers: ["canonical_name"],
            rows: [
              {
                row_number: 2,
                values: { canonical_name: "Dr Renee Membr", ...(chosen ? { member_id: member.id } : {}) },
                action: chosen ? "update" : "needs_review",
                errors: [],
                suggestions: chosen
                  ? []
                  : [{ id: member.id, name: "Dr Renee Member", status: "active", call_level: "2ND_CALL", designation: null, units: [] }],
                before: chosen ? { canonical_name: "Dr Renee Member", active_status: "active", call_level: "2ND_CALL" } : null,
                after: { canonical_name: "Dr Renee Membr", active_status: "active", call_level: "2ND_CALL" },
                person_id: chosen ? member.id : null,
                revision: null,
              },
            ],
          },
        });
      }
      applies++;
      return route.fulfill({
        json: { batch_id: "batch-dup", created: 0, updated: 1, unchanged: 0, excluded: 0, members: [] },
      });
    });
    await page.goto(`${base}/__member-test`);
    await page.evaluate(async () => {
      const m = await import("/src/member-workspace.ts");
      m.openMemberCsvImport(() => {});
    });
    await page.locator("input[type=file]").setInputFiles({
      name: "members.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("canonical_name\r\nDr Renee Membr\r\n"),
    });
    await page.getByText("Map CSV columns", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Preview import", exact: true }).click();
    await page.getByRole("heading", { name: "Review changes", exact: true }).waitFor();
    const row = page.locator('[data-csv-row="2"]');
    // (a) the needs-review row offers its alternatives as buttons
    const pick = row.locator(`button[data-pick-member="${member.id}"]`);
    assert.equal(await pick.count(), 1);
    assert.match(await pick.textContent(), /Dr Renee Member/);
    assert.equal(await row.getByRole("button", { name: "This is a different person", exact: true }).count(), 1);
    assert.match(await row.locator(".member-match").textContent(), /Possible duplicate of Dr Renee Member/);
    // (b) Apply shows why it is blocked and refuses on click until the row is resolved
    const blocker = page.locator(".import-apply-blocker");
    assert.match(await blocker.textContent(), /Include at least one row/);
    await row.locator("[data-include]").check();
    assert.match(await blocker.textContent(), /1 row needs a decision before applying/);
    await page.getByRole("button", { name: "Apply selected rows" }).click();
    await page
      .locator("[data-apply-status]")
      .filter({ hasText: "1 row needs a decision before applying" })
      .waitFor();
    assert.equal(applies, 0);
    await pick.click();
    await page.locator('[data-csv-row="2"] [data-match-status="matched"]').waitFor();
    assert.equal(sentCorrections.at(-1)["2"].member_id, member.id);
    assert.equal(await page.locator(".import-apply-blocker").isHidden(), true);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Apply selected rows" }).click();
    await page.getByRole("heading", { name: "Import complete", exact: true }).waitFor();
    assert.equal(applies, 1);
    assert.deepEqual(errors, []);
    passed++;
    await page.close();
  }
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/auth/me"))
        return route.fulfill({
          json: {
            id: "operator",
            username: "test",
            display_name: "Test Operator",
            role: "computer_admin",
            role_label: "Computer admin",
            active_status: "active",
          },
        });
      if (path.endsWith("/health"))
        return route.fulfill({ json: { status: "ok" } });
      if (path.endsWith("/analysis/dashboard"))
        return route.fulfill({
          status: 503,
          json: {
            detail: "Analysis intentionally unavailable in integration fixture",
          },
        });
      if (path.endsWith("/mappings/options"))
        return route.fulfill({ json: { duty_types: [], mapping_types: [] } });
      if (path.endsWith("/mappings")) return route.fulfill({ json: [] });
      if (path.endsWith("/members/invalid"))
        return route.fulfill({ json: { count: 0, people: [] } });
      if (path.endsWith("/members/audit"))
        return route.fulfill({
          json: {
            total_members: 1,
            active_members: 1,
            inactive_members: 0,
            aliases: 0,
            designations: 0,
            invalid_members: 0,
            duplicate_groups: 0,
            missing_designations: 1,
            missing_call_levels: 0,
            positions: {},
            call_levels: { "2ND_CALL": 1 },
            sources: {},
            status: "needs_review",
          },
        });
      if (path.endsWith("/members")) return route.fulfill({ json: [member] });
      if (path.endsWith(member.id))
        return route.fulfill({
          json: {
            member,
            impact: {
              future_duties: 2,
              current_or_future_postings: 1,
              eligibility_memberships: 1,
            },
          },
        });
      return route.fulfill({ json: { rows: [] } });
    });
    await page.goto(base);
    await page
      .locator('[data-view="members"]')
      .first()
      .waitFor({ state: "attached" });
    // Exercise the real navigation and delegated list handlers, including the mobile card.
    await page
      .locator('[data-view="members"]')
      .first()
      .evaluate((button) => button.click());
    await page.locator("#member-search").waitFor();
    await page.locator("#member-search").fill("Renée");
    await page.locator("[data-open-member]:visible").first().click();
    await page
      .getByRole("button", { name: "Close member profile", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Close member profile", exact: true })
      .click();
    assert.equal(await page.locator("#member-search").inputValue(), "Renée");
    await page.getByRole("button", { name: "Import CSV", exact: true }).click();
    await page
      .getByRole("heading", { name: "Import department members", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "Download blank CSV template", exact: true })
        .last()
        .isVisible(),
      true,
    );
    await page
      .getByRole("button", { name: "Close import", exact: true })
      .click();
    assert.deepEqual(errors, []);
    passed++;
    await page.close();
  }
  console.log(
    `${passed} desktop/mobile profile, CSV and app integration workflows passed`,
  );
} finally {
  await browser.close();
}
