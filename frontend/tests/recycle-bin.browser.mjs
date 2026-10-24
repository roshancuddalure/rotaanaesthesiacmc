// Recycle bin and "Recorded past duties": batches render with purge dates, Restore reports
// each failed item's reason, Delete forever asks first and then purges, the empty state
// shows, and selected past duties go to the shared delete preview by id. Mocked API.
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MEMBER_TEST_BROWSER ? { executablePath: process.env.MEMBER_TEST_BROWSER } : {}),
});

const BATCHES = [
  { batch_id: "b-leave", kind: "leave", count: 7, labels: ["Asha AJ · Annual leave · 3–4 Oct 2026", "Ravi K · Casual leave · 9 Oct 2026"],
    deleted_at: "2026-10-18T09:30:00Z", deleted_by: "Admin One", purge_after: "2026-11-17T09:30:00Z", restored_at: null, restored_by: null },
  { batch_id: "b-duty", kind: "past_duty", count: 1, labels: ["2 Sep 2026 · 1st call · Meera S"],
    deleted_at: "2026-10-15T04:00:00Z", deleted_by: "Admin One", purge_after: "2026-11-14T04:00:00Z", restored_at: null, restored_by: null },
  { batch_id: "b-member", kind: "member", count: 1, labels: ["Old Doctor"],
    deleted_at: "2026-10-01T04:00:00Z", deleted_by: "Admin Two", purge_after: "2026-10-31T04:00:00Z",
    restored_at: "2026-10-02T04:00:00Z", restored_by: "Admin Two" },
];
const RECORDED = [
  { id: "d1", date: "2026-09-01", duty_type: "1ST_CALL", duty_label: "1st call", member_id: "p1", member_name: "Meera S", source: "past_duty_upload", status: "approved" },
  { id: "d2", date: "2026-09-02", duty_type: "2ND_CALL", duty_label: "2nd call", member_id: "p2", member_name: "Ravi K", source: "past_duty_upload", status: "approved" },
  { id: "d3", date: "2026-09-03", duty_type: "1ST_CALL", duty_label: "1st call", member_id: "p3", member_name: "Asha AJ", source: "historical", status: "approved" },
];

async function axeClean(page, selector) {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    const axe = await new AxeBuilder({ page }).include(selector)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const severe = axe.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    assert.deepEqual(severe.map((v) => `${v.id}: ${v.nodes[0]?.target}`), [], `${scheme} accessibility (${selector})`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

const noPageScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

let passed = 0;
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const calls = [];
    let bin = structuredClone(BATCHES);
    let recorded = structuredClone(RECORDED);
    await page.route("**/__rb-test", (route) =>
      route.fulfill({ contentType: "text/html", body: '<html lang="en"><head><title>Recycle bin test</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><main><div id="root"></div></main></body></html>' }));
    await page.route("**/api/v1/**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      if (path.endsWith("/admin/recycle-bin") && req.method() === "GET") return route.fulfill({ json: bin });
      if (path.endsWith("/restore")) {
        calls.push({ kind: "restore", path });
        bin = bin.map((b) => (path.includes(b.batch_id) ? { ...b, restored_at: "2026-10-20T05:00:00Z", restored_by: "Admin One" } : b));
        return route.fulfill({ json: { restored: 5, failed: [
          { label: "Asha AJ · Annual leave · 3–4 Oct 2026", reason: "Her member record was deleted or merged." },
          { label: "Ravi K · Casual leave · 9 Oct 2026", reason: "An identical leave record now exists." },
        ] } });
      }
      if (path.includes("/admin/recycle-bin/") && req.method() === "DELETE") {
        calls.push({ kind: "purge", path, body: req.postDataJSON() });
        bin = bin.filter((b) => !path.endsWith(b.batch_id));
        return route.fulfill({ json: { purged: 1 } });
      }
      if (path.endsWith("/admin/past-duties/recorded")) {
        calls.push({ kind: "recorded", month: url.searchParams.get("month") });
        return route.fulfill({ json: { items: recorded, truncated: true } });
      }
      if (path.endsWith("/admin/delete/preview")) {
        const body = req.postDataJSON();
        calls.push({ kind: "preview", body });
        return route.fulfill({ json: { kind: body.kind, count: body.ids.length, items: body.ids.map((id) => ({ id, label: `Duty ${id}` })),
          blocked: [], effects: {}, preview_token: "tok-1", confirm_phrase: null } });
      }
      if (path.endsWith("/admin/delete")) {
        const body = req.postDataJSON();
        calls.push({ kind: "delete", body });
        recorded = recorded.filter((r) => !body.ids.includes(r.id));
        return route.fulfill({ json: { batch_id: "b-new", deleted: body.ids.length } });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto(base + "/__rb-test");

    // --- Recycle bin -----------------------------------------------------------------
    await page.evaluate(async () => {
      const { renderRecycleBin } = await import("/src/recycle-bin.ts");
      await renderRecycleBin(document.getElementById("root"));
    });
    const leave = page.locator('[data-rb-batch="b-leave"]');
    await leave.waitFor();
    const leaveText = await leave.innerText();
    assert.match(leaveText, /7 leave records/);
    assert.match(leaveText, /Asha AJ · Annual leave/);
    assert.match(leaveText, /and 5 more/);
    assert.match(leaveText, /by Admin One/);
    assert.match(leaveText, /Removed for good on 17 Nov 2026/);
    const restoredText = await page.locator('[data-rb-batch="b-member"]').innerText();
    assert.match(restoredText, /Restored/);
    assert.equal(await page.locator('[data-rb-batch="b-member"] [data-rb-restore]').count(), 0, "restored entry has no Restore");
    await axeClean(page, "#root");
    assert.equal(await noPageScroll(page), false, `no sideways scroll at ${width}px (bin)`);

    // Restore: counts plus each failed item's reason.
    await leave.locator("[data-rb-restore]").click();
    const outcome = page.locator('[data-rb-batch="b-leave"] .rb-batch__outcome');
    await outcome.waitFor();
    const outcomeText = await outcome.innerText();
    assert.match(outcomeText, /Restored 5 of 7/);
    assert.match(outcomeText, /deleted or merged/);
    assert.match(outcomeText, /identical leave record now exists/);
    assert.equal(calls.filter((c) => c.kind === "restore").length, 1);

    // Delete forever: a dismissed confirm does nothing; an accepted one purges.
    page.once("dialog", (d) => d.dismiss());
    await page.locator('[data-rb-purge="b-duty"]').click();
    await page.waitForTimeout(100);
    assert.equal(calls.filter((c) => c.kind === "purge").length, 0, "cancelled confirm does not purge");
    page.once("dialog", (d) => { assert.match(d.message(), /cannot be undone/); d.accept(); });
    await page.locator('[data-rb-purge="b-duty"]').click();
    await page.locator('[data-rb-batch="b-duty"]').waitFor({ state: "detached" });
    const purge = calls.find((c) => c.kind === "purge");
    assert.ok(purge.path.endsWith("/admin/recycle-bin/b-duty"));
    assert.deepEqual(purge.body, { confirm: true });

    // Empty state.
    bin = [];
    await page.evaluate(async () => {
      const { renderRecycleBin } = await import("/src/recycle-bin.ts");
      await renderRecycleBin(document.getElementById("root"));
    });
    assert.match(await page.locator("#root").innerText(), /Nothing deleted in the last 30 days/);
    await axeClean(page, "#root");

    // --- Recorded past duties ------------------------------------------------------------
    await page.evaluate(async () => {
      const { mountRecordedPastDuties } = await import("/src/recycle-bin.ts");
      const root = document.getElementById("root");
      root.replaceChildren(document.createElement("div"));
      await mountRecordedPastDuties(root.firstElementChild, "2026-09", "2026-10");
    });
    const section = page.locator(".rec-past");
    await section.locator('[data-rec-id="d1"]').waitFor();
    const sectionText = await section.innerText();
    assert.match(sectionText, /Recorded past duties · September 2026/);
    assert.match(sectionText, /Showing the first 3 duties only/);
    assert.equal(calls.find((c) => c.kind === "recorded").month, "2026-09");
    const delSelected = section.locator('[data-rec="delete-selected"]');
    assert.equal(await delSelected.isDisabled(), true);
    await section.locator('[data-rec-id="d1"]').check();
    await section.locator('[data-rec-id="d3"]').check();
    assert.match(await delSelected.innerText(), /Delete selected \(2\)/);
    await axeClean(page, ".rec-past");
    assert.equal(await noPageScroll(page), false, `no sideways scroll at ${width}px (recorded)`);

    await delSelected.click();
    const dialog = page.locator("dialog.admin-delete");
    await dialog.locator("[data-delete]:not([disabled])").waitFor();
    assert.deepEqual(calls.find((c) => c.kind === "preview").body, { kind: "past_duty", ids: ["d1", "d3"] });
    await dialog.locator("[data-delete]").click();
    await section.locator('[data-rec-id="d1"]').waitFor({ state: "detached" });
    const del = calls.find((c) => c.kind === "delete");
    assert.deepEqual(del.body.ids, ["d1", "d3"]);
    assert.equal(del.body.preview_token, "tok-1");
    assert.match(await section.innerText(), /Deleted 2 past duties/);
    assert.equal(await section.locator('[data-rec-id="d2"]').count(), 1, "table refreshed after delete");
    assert.equal(await section.locator('[data-rec="delete-selected"]').isDisabled(), true, "selection cleared");

    assert.deepEqual(errors, []);
    await context.close();
    passed += 1;
  }
  console.log(`recycle-bin browser test passed (${passed} widths)`);
} finally {
  await browser.close();
}
