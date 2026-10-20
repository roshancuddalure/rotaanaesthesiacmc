// "Clear all members": counts first, a typed phrase before the danger button works, the
// request carries the preview token, Undo restores the batch, and a stale preview is
// re-counted instead of applied. Mocked API, like import-review.browser.mjs.
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MEMBER_TEST_BROWSER ? { executablePath: process.env.MEMBER_TEST_BROWSER } : {}),
});
const PHRASE = "ARCHIVE ALL MEMBERS";
let passed = 0;
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const calls = [];
    let stale = width === 390; // on the phone run, the first archive attempt is stale
    let previews = 0;
    await page.route("**/__bulk-test", (route) =>
      route.fulfill({ contentType: "text/html", body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body></body></html>' }));
    await page.route("**/api/v1/**", async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (path.endsWith("/archive-all/preview")) {
        previews += 1;
        return route.fulfill({ json: { members: 212 + previews, linked_duties: 9100, future_duties: 37, leave: 410, postings: 260,
                                       preview_token: `token-${previews}`, confirm_phrase: PHRASE } });
      }
      if (path.endsWith("/archive-all/batches")) return route.fulfill({ json: [] });
      if (path.endsWith("/archive-all") && req.method() === "POST") {
        calls.push({ kind: "archive", body: req.postDataJSON() });
        if (stale) {
          stale = false;
          return route.fulfill({ status: 409, json: { detail: { code: "stale_preview", message: "Members changed since the preview" } } });
        }
        return route.fulfill({ json: { batch_id: "batch-1", archived: 214 } });
      }
      if (path.endsWith("/archive-all/batch-1/restore")) {
        calls.push({ kind: "restore" });
        return route.fulfill({ json: { batch_id: "batch-1", restored: 214, skipped: 0 } });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto(base + "/__bulk-test");
    await page.evaluate(async () => {
      const { openArchiveAll } = await import("/src/member-bulk.ts");
      window.__changed = 0;
      void openArchiveAll(() => { window.__changed += 1; });
    });
    const dialog = page.locator("dialog.archive-all");
    await dialog.locator("[data-phrase]").waitFor();

    // Counts and the upcoming-duties warning are shown before anything happens.
    const text = await dialog.innerText();
    assert.match(text, /Active members\s*213/);
    assert.match(text, /37 upcoming duties/);
    assert.match(text, /Nothing is deleted/);

    // The danger button stays off until the phrase matches exactly.
    const archive = dialog.locator("[data-archive]");
    assert.equal(await archive.isDisabled(), true);
    await dialog.locator("[data-phrase]").fill("archive all members");
    assert.equal(await archive.isDisabled(), true, "phrase is case-sensitive");
    await dialog.locator("[data-phrase]").fill(PHRASE);
    assert.equal(await archive.isDisabled(), false);

    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      const axe = await new AxeBuilder({ page }).include("dialog.archive-all")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const severe = axe.violations.filter((v) => ["serious", "critical"].includes(v.impact));
      assert.deepEqual(severe.map((v) => `${v.id}: ${v.nodes[0]?.target}`), [], `${scheme} accessibility`);
    }
    assert.equal(await dialog.evaluate((d) => d.scrollWidth > d.clientWidth + 1), false, `no sideways scroll at ${width}px`);

    await archive.click();
    if (width === 390) {
      // Stale: re-counted, explained, and nothing archived until confirmed again.
      await dialog.getByText("Members changed since these counts were made").waitFor();
      assert.match(await dialog.innerText(), /Active members\s*214/);
      assert.equal(calls[0].body.preview_token, "token-1");
      await dialog.locator("[data-phrase]").fill(PHRASE);
      await dialog.locator("[data-archive]").click();
    }
    await dialog.getByText("214 members archived").waitFor();
    const archiveCall = calls.filter((c) => c.kind === "archive").at(-1);
    assert.equal(archiveCall.body.confirm_phrase, PHRASE);
    assert.equal(archiveCall.body.preview_token, width === 390 ? "token-2" : "token-1");
    assert.equal(await page.evaluate(() => window.__changed), 1, "the member list is refreshed");

    // Undo restores exactly that batch.
    await dialog.getByRole("button", { name: /Undo: restore these 214 members/ }).click();
    await dialog.getByText("214 members restored").waitFor();
    assert.equal(calls.filter((c) => c.kind === "restore").length, 1);
    assert.deepEqual(errors, []);
    passed++;
    await context.close();
  }
  console.log(`${passed} clear-all workflows passed`);
} finally {
  await browser.close();
}
