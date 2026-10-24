// "Possible duplicate members" window: pairs side by side with counts; "Review merge" shows
// the plan (moves, combined duplicates, conflicts with choices, warnings) before anything
// changes; confirm sends the reviewed token; Undo restores; errors and stale plans are handled.
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
    const previews = [];
    const undos = [];
    const dismissals = [];
    let mergeFails = false;
    let staleOnce = false;
    let mergedOnce = false;
    await page.route("**/__duplicates-test", (route) =>
      route.fulfill({ contentType: "text/html", body: '<html lang="en"><head><title>t</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body></body></html>' }));
    await page.route("**/api/v1/**", async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const body = () => JSON.parse(req.postData() || "{}");
      if (path === "/api/v1/admin/members/suspected-duplicates") return route.fulfill({ json: pairs() });
      if (path === "/api/v1/admin/members/merges") {
        return route.fulfill({ json: mergedOnce ? [{ merge_id: "m1", merged_at: "2026-10-21T09:00:00", operator_name: "Admin",
          target_id: ids.a, target_name: "Samuel David Chandran", source_names: ["Samuel D Chandran"], undone_at: null, undone_by_name: null }] : [] });
      }
      if (path === "/api/v1/admin/members/merge/preview") {
        const b = body();
        previews.push(b);
        const chosen = b.choices?.["call_level:2026-01-01"] ?? "keep_target";
        return route.fulfill({ json: {
          preview_token: `token-${previews.length}`, target: { id: b.target_person_id, name: "kept" }, sources: [],
          moves: { "duty assignments": 5, "unit postings": 1 },
          combined: ["Both records were on the same duty (MAIN_4TH_24HR on 2026-02-01); kept one assignment"],
          conflicts: [{ id: "call_level:2026-01-01", description: "From 2026-01-01 the kept record says 4TH_CALL but the other says 3RD_CALL",
                        options: ["keep_target", "keep_source"], chosen }],
          warnings: ["Both were on duty on 2 same days. Merging is right only if one person was recorded twice."],
        } });
      }
      if (path === "/api/v1/admin/members/merge") {
        const b = body();
        merges.push(b);
        if (mergeFails) return route.fulfill({ status: 409, json: { detail: { code: "merge_failed", message: "Merge stopped and nothing was changed: a conflict in name rules" } } });
        if (staleOnce) {
          staleOnce = false;
          return route.fulfill({ status: 409, json: { detail: { code: "stale_preview", message: "The records changed since the merge preview" } } });
        }
        mergedOnce = true;
        return route.fulfill({ json: { id: b.target_person_id, merge_id: "m1" } });
      }
      if (path === "/api/v1/admin/members/merges/m1/undo") {
        undos.push(path);
        return route.fulfill({ json: { merge_id: "m1", restored: ["Samuel D Chandran"] } });
      }
      if (path === "/api/v1/admin/members/suspected-duplicates/dismiss") {
        dismissals.push(body());
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

    // Default "Keep" is the suggested target; reviewing shows the plan before anything changes.
    const keepGroup = first.getByRole("group", { name: "Keep" });
    assert.equal(await keepGroup.getByRole("radio", { name: "Samuel David Chandran" }).isChecked(), true);
    assert.match(await first.locator("[data-merge]").innerText(), /Review merge into Samuel David Chandran/);
    await first.locator("[data-merge]").click();
    const plan = first.locator(".merge-plan");
    await plan.waitFor();
    assert.deepEqual(previews.at(-1), { target_person_id: ids.a, source_person_ids: [ids.b], choices: {} });
    const planText = await plan.innerText();
    assert.match(planText, /5 duty assignments move to Samuel David Chandran/);
    assert.match(planText, /both were on duty on 2 same days/i);
    assert.match(planText, /You can undo this merge afterwards/);
    assert.equal(merges.length, 0, "reviewing never merges");

    // Accessibility (WCAG 2.2 AA) with the plan open, light and dark; no sideways scroll.
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      const axe = await new AxeBuilder({ page }).include("dialog")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const severe = axe.violations.filter((v) => ["serious", "critical"].includes(v.impact));
      assert.deepEqual(severe.map((v) => `${v.id}: ${v.nodes[0]?.target}`), [], `${scheme} accessibility`);
    }
    const overflow = await dialog.evaluate((d) => d.scrollWidth > d.clientWidth + 1 || document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `no sideways scroll at ${width}px`);

    // Choosing the other record's value for a conflict re-checks the plan with that choice.
    await plan.getByRole("radio", { name: /Use Samuel D Chandran's/ }).check();
    await page.waitForFunction(() => document.querySelector("[data-status]")?.textContent?.includes("Review the merge"));
    assert.deepEqual(previews.at(-1).choices, { "call_level:2026-01-01": "keep_source" });

    // Confirm sends the reviewed plan's token and choices; the card offers Undo.
    await first.locator("[data-merge-confirm]").click();
    await dialog.locator(".dup-card--done").waitFor();
    assert.deepEqual(merges.at(-1), { target_person_id: ids.a, source_person_ids: [ids.b],
                                      preview_token: `token-${previews.length}`, choices: { "call_level:2026-01-01": "keep_source" } });
    assert.equal(await page.evaluate(() => window.__changed), 1);
    await dialog.locator(".dup-history").waitFor();

    // Undo restores the records (the list reloads).
    await dialog.locator(".dup-card--done [data-undo-merge]").click();
    await page.waitForFunction(() => /Merge undone: Samuel D Chandran/.test(document.querySelector("[data-status]")?.textContent || ""));
    assert.equal(undos.length, 1);
    assert.equal(await page.evaluate(() => window.__changed), 2);
    await cards.nth(2).waitFor();

    // Changing Keep (keyboard) changes the target; a failed merge says nothing changed.
    const priya = cards.nth(1);
    await priya.getByRole("radio", { name: "Priya Raman" }).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await priya.getByRole("radio", { name: "Priya Ramen" }).isChecked(), true);
    assert.match(await priya.locator("[data-merge]").innerText(), /Review merge into Priya Ramen/);
    await priya.locator("[data-merge]").click();
    await priya.locator(".merge-plan").waitFor();
    mergeFails = true;
    await priya.locator("[data-merge-confirm]").click();
    await page.waitForFunction(() => /Could not merge: Merge stopped and nothing was changed/.test(document.querySelector("[data-status]")?.textContent || ""));
    assert.equal(await priya.locator("[data-merge-confirm]").isEnabled(), true);
    mergeFails = false;

    // A plan that went out of date is re-checked instead of applied.
    const before = previews.length;
    staleOnce = true;
    await priya.locator("[data-merge-confirm]").click();
    await page.waitForFunction(() => /changed since this preview/.test(document.querySelector("[data-status]")?.textContent || "")
      || /Review the merge/.test(document.querySelector("[data-status]")?.textContent || ""));
    assert.ok(previews.length > before, "the plan is re-checked");
    assert.equal(await priya.locator(".dup-card--done").count(), 0);

    // "Not the same person" dismisses a pair.
    await cards.nth(2).getByRole("button", { name: "Not the same person" }).click();
    await page.waitForFunction(() => /different people/.test(document.querySelector("[data-status]")?.textContent || ""));
    assert.deepEqual(dismissals.at(-1)?.person_ids, [ids.e, ids.f]);

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
    route.fulfill({ contentType: "text/html", body: '<html lang="en"><head><title>t</title><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body></body></html>' }));
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
