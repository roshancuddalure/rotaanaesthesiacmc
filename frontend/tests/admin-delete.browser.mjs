// Admin delete window (docs/admin_delete_contract.md): previews first, lists blocked rows
// with the reason, needs the exact typed phrase for whole-month deletes, sends the preview
// token, and re-previews when the data changed (409). Mocked API, like member-bulk.browser.mjs.
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MEMBER_TEST_BROWSER ? { executablePath: process.env.MEMBER_TEST_BROWSER } : {}),
});
const PHRASE = "DELETE LEAVE 2026-10";
let passed = 0;

async function open(page, request) {
  await page.evaluate(async (req) => {
    const { confirmAdminDelete } = await import("/src/admin-delete.ts");
    window.__result = "pending";
    void confirmAdminDelete(req).then((r) => { window.__result = r; });
  }, request);
  const dialog = page.locator("dialog.admin-delete");
  await dialog.locator(".admin-delete__count").waitFor();
  return dialog;
}
const result = (page) => page.waitForFunction(() => window.__result !== "pending").then(() => page.evaluate(() => window.__result));

try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const deletes = [];
    let previews = 0;
    let staleNext = false;
    await page.route("**/__admin-delete-test", (route) =>
      route.fulfill({ contentType: "text/html", body: '<html lang="en"><head><title>Admin delete test</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body></body></html>' }));
    await page.route("**/api/v1/**", async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const body = req.postDataJSON?.() ?? {};
      if (path.endsWith("/admin/delete/preview")) {
        previews += 1;
        const token = `token-${previews}`;
        if (body.kind === "member") {
          return route.fulfill({ json: { kind: "member", count: 1, items: [{ id: "m1", label: "Asha AJ" }],
            blocked: [{ id: "m2", label: "Bala K", reason: "Has 12 duty assignments and 3 leave records." }],
            effects: { linked_records: 4 }, preview_token: token, confirm_phrase: null } });
        }
        if (body.month) {
          return route.fulfill({ json: { kind: "leave", count: 40 + previews,
            items: Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, label: `Member ${i} · Annual leave · ${i + 1} Oct 2026` })),
            blocked: [], effects: {}, preview_token: token, confirm_phrase: PHRASE } });
        }
        return route.fulfill({ json: { kind: body.kind, count: body.ids.length,
          items: body.ids.map((id) => ({ id, label: `Asha AJ · Annual leave · 3–4 Oct 2026 (${id})` })),
          blocked: [], effects: {}, preview_token: token, confirm_phrase: null } });
      }
      if (path.endsWith("/admin/delete") && req.method() === "POST") {
        deletes.push(body);
        if (staleNext) {
          staleNext = false;
          return route.fulfill({ status: 409, json: { detail: { code: "stale_preview", message: "Data changed since the preview" } } });
        }
        return route.fulfill({ json: { batch_id: `batch-${deletes.length}`, deleted: body.ids ? body.ids.length : 41 } });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto(base + "/__admin-delete-test");

    // 1. One leave record: preview, recycle-bin note, request carries kind, ids and token.
    let dialog = await open(page, { kind: "leave", ids: ["l1"], title: "Delete leave" });
    let text = await dialog.innerText();
    assert.match(text, /1 leave record will be deleted/);
    assert.match(text, /Asha AJ · Annual leave · 3–4 Oct 2026/);
    assert.match(text, /Deleted items can be restored from the Recycle bin for 30 days/);
    assert.equal(await dialog.getByRole("button", { name: "Close Delete leave" }).count(), 1);
    const del = dialog.locator("button.danger-button[data-delete]");
    assert.equal(await del.isDisabled(), false);

    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      const axe = await new AxeBuilder({ page }).include("dialog.admin-delete")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const severe = axe.violations.filter((v) => ["serious", "critical"].includes(v.impact));
      assert.deepEqual(severe.map((v) => `${v.id}: ${v.nodes[0]?.target}`), [], `${scheme} accessibility (${width}px)`);
    }
    await page.emulateMedia({ colorScheme: "light" });
    assert.equal(await dialog.evaluate((d) => d.scrollWidth > d.clientWidth + 1), false, `no sideways scroll at ${width}px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);

    await del.click();
    assert.deepEqual(await result(page), { batch_id: "batch-1", deleted: 1 });
    assert.deepEqual(deletes.at(-1), { kind: "leave", ids: ["l1"], preview_token: `token-${previews}` });
    assert.equal(await page.locator("dialog.admin-delete").count(), 0, "closes on success");

    // 2. Members with history are blocked with the reason and an archive/merge hint.
    dialog = await open(page, { kind: "member", ids: ["m1", "m2"], title: "Delete 2 selected members" });
    text = await dialog.innerText();
    assert.match(text, /1 member will be deleted/);
    assert.match(text, /Not deleted/);
    assert.match(text, /Bala K/);
    assert.match(text, /Has 12 duty assignments/);
    assert.match(text, /Archive or merge instead/);
    // Escape cancels and resolves null; nothing was sent.
    const before = deletes.length;
    await page.keyboard.press("Escape");
    assert.equal(await result(page), null);
    assert.equal(deletes.length, before);

    // 3. Whole month: exact phrase required; then a stale preview is re-shown, not applied.
    dialog = await open(page, { kind: "leave", month: "2026-10", title: "Delete all leave for October 2026" });
    const firstToken = `token-${previews}`;
    const monthDel = dialog.locator("[data-delete]");
    assert.equal(await monthDel.isDisabled(), true, "disabled until the phrase is typed");
    assert.match(await dialog.innerText(), /and \d+ more/);
    await dialog.locator("[data-phrase]").fill(PHRASE.toLowerCase());
    assert.equal(await monthDel.isDisabled(), true, "phrase is case-sensitive");
    await dialog.locator("[data-phrase]").fill(PHRASE);
    assert.equal(await monthDel.isDisabled(), false);
    assert.equal(await dialog.evaluate((d) => d.scrollWidth > d.clientWidth + 1), false, `month view fits at ${width}px`);

    staleNext = true;
    await monthDel.click();
    await dialog.getByText("The records changed since this preview").waitFor();
    assert.deepEqual(deletes.at(-1), { kind: "leave", month: "2026-10", preview_token: firstToken, confirm_phrase: PHRASE });
    assert.equal(await page.evaluate(() => window.__result), "pending", "stale preview keeps the window open");
    const secondToken = `token-${previews}`;
    assert.notEqual(secondToken, firstToken);
    assert.equal(await dialog.locator("[data-delete]").isDisabled(), true, "phrase must be typed again");
    await dialog.locator("[data-phrase]").fill(PHRASE);
    await dialog.locator("[data-delete]").click();
    assert.deepEqual(await result(page), { batch_id: `batch-${deletes.length}`, deleted: 41 });
    assert.deepEqual(deletes.at(-1), { kind: "leave", month: "2026-10", preview_token: secondToken, confirm_phrase: PHRASE });

    assert.deepEqual(errors, []);
    passed++;
    await context.close();
  }
  console.log(`${passed} admin-delete workflows passed`);
} finally {
  await browser.close();
}
