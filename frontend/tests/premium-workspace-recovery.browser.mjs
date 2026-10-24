import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const base = process.env.MEMBER_TEST_URL || "http://127.0.0.1:5197";
const member = { id: "11111111-1111-1111-1111-111111111111", canonical_name: "Dr Long Department Member", active_status: "active", call_level: "2ND_CALL", aliases: [], designations: [], revision: "one" };
let workflows = 0;
try {
  for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 720 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.route("**/__premium-workspace", (route) => route.fulfill({ contentType: "text/html", body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/premium-theme.css"></head><body><button id="open">Open workspace</button></body></html>' }));
    let delayProfile = false;
    let releaseProfile;
    let delayReview = false;
    let releaseReview;
    let previewCount = 0;
    let saveCount = 0;
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === `/api/v1/admin/member-workspace/${member.id}`) {
        if (delayProfile) await new Promise((resolve) => { releaseProfile = resolve; });
        return route.fulfill({ json: { member, impact: {} } });
      }
      if (path.startsWith(`/api/v1/admin/member-workspace/${member.id}/`)) return route.fulfill({ json: { rows: [] } });
      if (path === `/api/v1/members/${member.id}/profile`) return route.fulfill({ json: { member, today: "2026-10-21", current_call_level: "2ND_CALL", can_manage: true, call_history: [], comments: [], postings: [], leaves: [], imports: [], statistics: { official_duties: 0, hours24: 0, weekend_duties: 0 } } });
      if (path.endsWith("/comments")) return route.fulfill({ status: 503, json: { detail: "Comment service temporarily unavailable" } });
      if (path === "/api/v1/admin/members") return route.fulfill({ json: [member] });
      if (path === "/api/v1/normalization/units") return route.fulfill({ json: [] });
      if (path.includes("/catalog/")) {
        const kind = path.split("/").pop();
        return route.fulfill({ json: [{ key: { leave_type: "ANNUAL_LEAVE", leave_slot: "FULL_DAY", leave_status: "requested" }[kind] || "2ND_CALL", label: kind.replace(/_/g, " "), active: true }] });
      }
      if (path.endsWith("/preview")) {
        previewCount++;
        if (delayReview) await new Promise((resolve) => { releaseReview = resolve; });
        return route.fulfill({ json: { review_token: "reviewed", before: null, after: route.request().postDataJSON().values, duties: [], availability: "Pending leave warns." } });
      }
      if (path.endsWith("/save")) { saveCount++; return route.fulfill({ json: {} }); }
      throw new Error(`Unexpected request ${path}`);
    });
    await page.goto(`${base}/__premium-workspace`);
    await page.locator("#open").focus();
    await page.evaluate(async (id) => { const { openMemberWorkspace } = await import("/src/member-workspace.ts"); await openMemberWorkspace(id, true, () => {}); }, member.id);
    const profileDialog = page.getByRole("dialog", { name: "Member profile", exact: true });
    await profileDialog.getByRole("tab", { name: "Activity", exact: true }).click();
    await page.waitForFunction(() => {
      const selected = document.querySelector('.mw-rail [aria-selected="true"]');
      const rail = document.querySelector('.mw-rail');
      if(!selected||!rail)return false;
      const vertical=getComputedStyle(rail).flexDirection==='column',a=selected.getBoundingClientRect(),b=rail.getBoundingClientRect();
      return rail.getAttribute('aria-orientation')===(vertical?'vertical':'horizontal')&&(vertical?a.top>=b.top-1&&a.bottom<=b.bottom+1:a.left>=b.left-1&&a.right<=b.right+1);
    });
    await profileDialog.getByRole("tab", { name: "Activity", exact: true }).focus();
    await page.keyboard.press("Home");
    assert.equal(await profileDialog.getByRole("tab", { name: "Overview", exact: true }).getAttribute("aria-selected"), "true");
    await profileDialog.getByRole("button", { name: "Close member profile" }).click();
    await page.waitForFunction(() => !document.querySelector("dialog"));
    assert.equal(await page.locator("#open").evaluate((node) => document.activeElement === node), true);
    workflows++;

    // A dismissed loading surface must never be recreated by its late response.
    delayProfile = true;
    await page.evaluate((id) => { import("/src/member-workspace.ts").then((m) => m.openMemberWorkspace(id, true, () => {})); }, member.id);
    await page.waitForFunction(() => document.querySelector("dialog[open]"));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog"));
    assert.ok(releaseProfile);
    releaseProfile();
    await page.waitForLoadState("networkidle");
    assert.equal(await page.locator("dialog").count(), 0);
    delayProfile = false;
    workflows++;

    // Failed legacy profile saves preserve every form, open disclosure and submitted values.
    await page.evaluate(async (id) => { const { openMemberProfile } = await import("/src/member-profile.ts"); await openMemberProfile(id, "superadmin", async () => {}); }, member.id);
    const legacy = page.getByRole("dialog", { name: "Department member profile", exact: true });
    const comment = legacy.locator('[data-profile-form="comment"]');
    await comment.locator("textarea").fill("Keep this failed comment draft");
    await legacy.getByText("Edit Member Details", { exact: true }).click();
    await legacy.locator('[data-profile-form="details"] [name="name"]').fill("Keep this separate unsaved name");
    await comment.getByRole("button", { name: "Add Comment", exact: true }).click();
    await legacy.getByRole("status").filter({ hasText: "Comment service temporarily unavailable" }).waitFor();
    assert.equal(await comment.locator("textarea").inputValue(), "Keep this failed comment draft");
    assert.equal(await legacy.locator('[data-profile-form="details"] [name="name"]').inputValue(), "Keep this separate unsaved name");
    assert.equal(await legacy.locator("details").last().getAttribute("open"), "");
    await legacy.getByRole("button", { name: "Close", exact: true }).click();
    workflows++;

    // Editing during review must not enable applying the obsolete reviewed snapshot.
    await page.evaluate(async (id) => { const { openRecordEditor } = await import("/src/record-workspace.ts"); await openRecordEditor("leave", id, undefined, true, () => {}); }, member.id);
    const editor = page.locator("dialog.record-workspace");
    await editor.locator('[name="ends_on"]').fill("2026-10-31");
    delayReview = true;
    await editor.getByRole("button", { name: "Review changes", exact: true }).click();
    await editor.getByRole("button", { name: "Reviewing...", exact: true }).waitFor();
    await editor.locator('[name="notes"]').fill("Changed during review");
    assert.ok(releaseReview);
    releaseReview();
    await editor.getByRole("button", { name: "Review changes", exact: true }).waitFor();
    assert.equal(await editor.locator("[data-save]").isDisabled(), true);
    assert.equal(saveCount, 0);
    delayReview = false;
    await editor.getByRole("button", { name: "Review changes", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-save]")?.disabled === false);
    await editor.getByRole("button", { name: "Save reviewed changes", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    assert.equal(previewCount, 2);
    assert.equal(saveCount, 1);
    assert.deepEqual(errors, []);
    workflows++;
    await page.close();
  }
  console.log(`${workflows} premium workspace recovery workflows passed at desktop, 390px and 320px`);
} finally { await browser.close(); }
