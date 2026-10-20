// "Possible duplicate members" window: pairs render side by side with counts, the suggested
// survivor is pre-selected, merge sends the kept/other ids after a confirm, "Not the same
// person" dismisses the pair, and server errors are shown. Uses a mocked API.
import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5178";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MEMBER_TEST_BROWSER ? { executablePath: process.env.MEMBER_TEST_BROWSER } : {}),
});
const person = (id, name, extra = {}) => ({
  id, canonical_name: name, active_status: "active", call_level: "1ST_CALL",
  duties: 12, postings: 3, leave: 2, aliases: [], ...extra,
});
const ids = { a: "aaaaaaaa-0000-0000-0000-000000000001", b: "aaaaaaaa-0000-0000-0000-000000000002",
  c: "aaaaaaaa-0000-0000-0000-000000000003", d: "aaaaaaaa-0000-0000-0000-000000000004",
  e: "aaaaaaaa-0000-0000-0000-000000000005", f: "aaaaaaaa-0000-0000-0000-000000000006" };
const pairs = () => [
  { pair_id: "p1", similarity: 0.94, reason: "Same initials and surname", suggested_target_id: ids.a,
    people: [person(ids.a, "Samuel David Chandran", { duties: 40, aliases: ["Sam D", "S. David"] }), person(ids.b, "Samuel D Chandran", { duties: 5, postings: 1, leave: 0, active_status: "inactive", call_level: "4TH_CALL" })] },
  { pair_id: "p2", similarity: 0.88, reason: "Name differs by one letter", suggested_target_id: ids.c,
    people: [person(ids.c, "Priya Raman"), person(ids.d, "Priya Ramen", { duties: 1, postings: 0, leave: 0 })] },
  { pair_id: "p3", similarity: 0.81, reason: "Alias matches another member", suggested_target_id: ids.e,
    people: [person(ids.e, "Arun Kumar"), person(ids.f, "Arun K", { duties: 0 })] },
];

let checks = 0;
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const confirms = [];
    page.on("dialog", (d) => { confirms.push(d.message()); d.accept(); });
    const merges = [];
    const dismissals = [];
    let mergeFails = false;
    await page.route("**/__duplicates-test", (route) =>
      route.fulfill({ contentType: "text/html", body: '<html lang="en"><head><title>t</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body></body></html>' }));
    await page.route("**/api/v1/**", async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (path === "/api/v1/admin/members/suspected-duplicates") return route.fulfill({ json: pairs() });
      if (path === "/api/v1/admin/members/merge") {
        const body = JSON.parse(req.postData() || "{}");
        merges.push(body);
        if (mergeFails) return route.fulfill({ status: 409, json: { detail: "These members are already being merged by another admin" } });
        return route.fulfill({ json: { id: body.target_person_id } });
      }
      if (path === "/api/v1/admin/members/suspected-duplicates/dismiss") {
        const body = JSON.parse(req.postData() || "{}");
        dismissals.push(body);
        return route.fulfill({ json: { pair_id: "p3" } });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto(base + "/__duplicates-test");
    await page.evaluate(async () => {
      window.__changed = 0;
      const { openSuspectedDuplicates } = await import("/src/member-duplicates.ts");
      await openSuspectedDuplicates(() => { window.__changed += 1; });
    });
    const dialog = page.locator("dialog.member-duplicates");
    const cards = dialog.locator(".dup-card");
    await cards.first().waitFor();
    assert.equal(await cards.count(), 3);
    const first = cards.nth(0);
    assert.match(await first.innerText(), /Samuel David Chandran[\s\S]*40 duties · 3 postings · 2 leave[\s\S]*Sam D, S\. David/);
    assert.match(await first.innerText(), /94% similar[\s\S]*Same initials and surname/);
    assert.match(await first.innerText(), /5 duties · 1 posting · 0 leave/);

    // Accessibility (WCAG 2.2 AA), light and dark.
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      const axe = await new AxeBuilder({ page }).include("dialog")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const severe = axe.violations.filter((v) => ["serious", "critical"].includes(v.impact));
      assert.deepEqual(severe.map((v) => `${v.id}: ${v.nodes[0]?.target}`), [], `${scheme} accessibility`);
    }
    const overflow = await dialog.evaluate((d) => d.scrollWidth > d.clientWidth + 1 || document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `no sideways scroll at ${width}px`);

    // Default "Keep" is the suggested target; the button names it.
    const keepGroup = first.getByRole("group", { name: "Keep" });
    assert.equal(await keepGroup.getByRole("radio", { name: "Samuel David Chandran" }).isChecked(), true);
    const mergeBtn = first.locator("[data-merge]");
    assert.match(await mergeBtn.innerText(), /Merge into Samuel David Chandran/);

    // Merge with the default target.
    await mergeBtn.click();
    await cards.first().filter({ hasText: "Priya" }).waitFor();
    assert.equal(await cards.count(), 2);
    assert.deepEqual(merges.at(-1), { target_person_id: ids.a, source_person_ids: [ids.b] });
    assert.match(confirms.at(-1), /^Merge Samuel D Chandran into Samuel David Chandran\? Their 5 duties, 1 posting, 0 leave records and aliases move to Samuel David Chandran, and Samuel D Chandran's separate record is removed\. This cannot be undone\.$/);
    assert.match(await dialog.locator("[data-status]").innerText(), /Merged Samuel D Chandran into Samuel David Chandran/);
    assert.equal(await page.evaluate(() => window.__changed), 1);

    // Changing Keep changes the target (keyboard: focus the radio group and use arrows).
    const priya = cards.nth(0);
    await priya.getByRole("radio", { name: "Priya Raman" }).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await priya.getByRole("radio", { name: "Priya Ramen" }).isChecked(), true);
    assert.match(await priya.locator("[data-merge]").innerText(), /Merge into Priya Ramen/);

    // A server error (409) is shown; the card stays.
    mergeFails = true;
    await priya.locator("[data-merge]").click();
    await page.waitForFunction(() => /already being merged/.test(document.querySelector("[data-status]")?.textContent || ""));
    assert.deepEqual(merges.at(-1), { target_person_id: ids.d, source_person_ids: [ids.c] });
    assert.equal(await cards.count(), 2);
    assert.equal(await priya.locator("[data-merge]").isEnabled(), true);
    mergeFails = false;
    await priya.locator("[data-merge]").click();
    await page.waitForFunction(() => document.querySelectorAll(".dup-card").length === 1);
    assert.deepEqual(merges.at(-1), { target_person_id: ids.d, source_person_ids: [ids.c] });

    // "Not the same person" dismisses the pair; then the window is empty.
    await cards.nth(0).getByRole("button", { name: "Not the same person" }).click();
    await dialog.getByText("No possible duplicates").waitFor();
    assert.deepEqual(dismissals.at(-1)?.person_ids, [ids.e, ids.f]);
    assert.match(await dialog.locator("[data-status]").innerText(), /different people/);
    assert.equal(await page.evaluate(() => window.__changed), 2);

    // Escape closes the window.
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
    checks++;
    await context.close();
  }

  // Error state with retry.
  const context = await browser.newContext({ viewport: { width: 390, height: 850 } });
  const page = await context.newPage();
  let calls = 0;
  await page.route("**/__duplicates-test", (route) =>
    route.fulfill({ contentType: "text/html", body: '<html lang="en"><head><title>t</title><link rel="stylesheet" href="/src/styles.css"></head><body></body></html>' }));
  await page.route("**/api/v1/admin/members/suspected-duplicates", (route) => {
    calls += 1;
    return calls === 1 ? route.fulfill({ status: 500, json: { detail: "Database unavailable" } }) : route.fulfill({ json: [] });
  });
  await page.goto(base + "/__duplicates-test");
  await page.evaluate(async () => {
    const { openSuspectedDuplicates } = await import("/src/member-duplicates.ts");
    await openSuspectedDuplicates(() => {});
  });
  const dialog = page.locator("dialog.member-duplicates");
  await dialog.getByText("Database unavailable").waitFor();
  await dialog.getByRole("button", { name: "Try again" }).click();
  await dialog.getByText("No possible duplicates").waitFor();
  checks++;
  await context.close();
  console.log(`${checks} duplicate review checks passed`);
} finally {
  await browser.close();
}
