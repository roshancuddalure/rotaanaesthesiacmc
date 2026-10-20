import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Exercise the UI controllers with a small host and API doubles; no browser dependency.
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const apiModule = dataModule(`
  export const downloadPreviewIssues = (...args) => globalThis.reportApi?.download(...args);
  export const memberWorkbookRequest = (...args) => globalThis.memberApi.request(...args);
  export const downloadMemberImportTemplate = (...args) => globalThis.memberApi.template(...args);
  export const getMemberImportHistory = (...args) => globalThis.memberApi.history(...args);
  export const getMemberImportHistoryDetail = (...args) => globalThis.memberApi.detail(...args);
  export const getMembers = (...args) => globalThis.pastApi.members(...args);
  export const getPastDutyStatus = (...args) => globalThis.pastApi.status(...args);
  export const getPastDutyHistory = (...args) => globalThis.pastApi.history(...args);
  export const pastDutyUpload = (...args) => globalThis.pastApi.upload(...args);
  export const downloadPastDutyTemplate = (...args) => globalThis.pastApi.template(...args);
  export const saveHistoryFairness = (...args) => globalThis.pastApi.policy(...args);
  export const getMemberProfile = (...args) => globalThis.profileApi.get(...args);
  export const addMemberCallChange = (...args) => globalThis.profileApi.call(...args);
  export const addMemberComment = (...args) => globalThis.profileApi.comment(...args);
  export const updateMember = (...args) => globalThis.profileApi.update(...args);
  export const addMemberAlias = (...args) => globalThis.profileApi.alias(...args);
  export const addMemberDesignation = (...args) => globalThis.profileApi.designation(...args);
`);
// Local modules a controller imports are compiled the same way, so data: URLs can load them.
async function compiledModule(filename) {
  const source = await readFile(new URL(`../src/${filename}`, import.meta.url), "utf8");
  let compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText.replace('"./services/api"', JSON.stringify(apiModule));
  for (const local of ["ui", "member-import"]) {
    if (compiled.includes(`"./${local}"`))
      compiled = compiled.replace(`"./${local}"`, JSON.stringify(await compiledModule(`${local}.ts`)));
  }
  return dataModule(compiled);
}
async function controller(filename) {
  return import(await compiledModule(filename));
}
const importUi = await controller("member-import.ts");
const historyUi = await controller("member-import-history.ts");
const pastUi = await controller("past-duties.ts");
const profileUi = await controller("member-profile.ts");
const click = (host, action) => host.onclick({ target: { closest: () => ({ dataset: { mi: action } }) } });
const change = (host, dataset, extra = {}) => host.onchange({ target: { dataset, ...extra } });
// Apply stays clickable; a blocked import shows the reason next to the button instead.
const canApply = host => host.innerHTML.includes('data-mi="apply"') && !host.innerHTML.includes("import-apply-blocker");

test("CSV review requires call approval, stays reviewed on filtering, and refreshes on apply", async () => {
  importUi.resetMemberImport();
  const host = { innerHTML: "" };
  const calls = [];
  let refreshed = 0;
  const preview = {
    preview_hash: "reviewed-hash", counts: { create: 0, update: 1, unchanged: 0, needs_review: 0, skip: 0 },
    sheet: "CSV", rows: [{ row: 2, raw: { name: '<img src=x onerror="bad()">', call_level: "second" },
      normalized: { name: "Existing Doctor", call_level: "2ND_CALL" }, action: "update", target_id: "existing",
      target_name: "Existing Doctor", changes: { call_level: { from: "1ST_CALL", to: "2ND_CALL" } },
      errors: [], candidates: [{ id: "existing", name: "Existing Doctor" }] }],
  };
  globalThis.memberApi = {
    request: async (action, file, options, hash) => {
      calls.push({ action, file, options: structuredClone(options), hash });
      if (action === "inspect") return { sheets: [{ name: "CSV", headers: ["name", "call_level"],
        mapping: { name: 0, call_level: 1 } }], fields: ["name", "call_level"], header_row: 1 };
      if (action === "preview") return preview;
      return { counts: preview.counts };
    },
  };
  importUi.mountMemberImport(host, async () => { refreshed += 1; });
  assert.match(host.innerHTML, /accept=".csv,.xlsx"/);
  change(host, { mi: "file" }, { files: [{ name: "members.csv" }] });
  await click(host, "inspect");
  await click(host, "preview");
  assert.equal(canApply(host), false);
  assert.match(host.innerHTML, /1ST_CALL.*2ND_CALL/s);
  assert.ok(!host.innerHTML.includes('<img src=x onerror="bad()">'));
  change(host, { mi: "confirm-calls" }, { checked: true });
  assert.equal(canApply(host), true);
  change(host, { mi: "filter" }, { value: "update" });
  assert.equal(canApply(host), true);
  change(host, { miRow: "2" }, { value: "existing" });
  assert.equal(canApply(host), false);
  await click(host, "preview");
  assert.equal(canApply(host), false);
  change(host, { mi: "confirm-calls" }, { checked: true });
  await click(host, "apply");
  assert.equal(refreshed, 1);
  assert.equal(calls.at(-1).options.confirm_call_changes, true);
  assert.equal(calls.at(-1).hash, "reviewed-hash");
  assert.match(host.innerHTML, /Master list and counts refreshed/);
  assert.ok(!host.innerHTML.includes('data-mi="apply"'));
  importUi.resetMemberImport();
});

test("import history displays prior batches and readable source changes", async () => {
  const detail = { innerHTML: "" };
  const status = { textContent: "" };
  const button = { dataset: { memberBatch: "batch-id" }, disabled: false };
  const host = { innerHTML: "", isConnected: true,
    querySelector: selector => selector.includes("-detail") ? detail : status,
    querySelectorAll: () => [button] };
  globalThis.memberApi = {
    history: async () => [{ id: "batch-id", filename: "members.csv", status: "completed",
      completed_at: "2026-10-12T06:00:00Z", actor: "Department Admin", sheet: "CSV",
      counts: { update: 1 }, call_changes_confirmed: true }],
    detail: async () => ({ batch: { filename: "members.csv", call_changes_confirmed: true },
      rows: [{ row: 2, sheet: "CSV", raw: { name: "Existing Doctor", call_level: "second" },
        normalized: { name: "Existing Doctor", call_level: "2ND_CALL" }, action: "update",
        changes: { call_level: { from: "1ST_CALL", to: "2ND_CALL" } }, errors: [] }] }),
  };
  await historyUi.mountMemberImportHistory(host);
  assert.match(host.innerHTML, /members.csv/);
  assert.match(host.innerHTML, /Department Admin/);
  await host.onclick({ target: { closest: () => button } });
  assert.match(detail.innerHTML, /1ST_CALL.*2ND_CALL/s);
  assert.match(detail.innerHTML, /explicitly approved/);
  assert.equal(button.disabled, false);
  assert.equal(status.textContent, "");
});

test("past-duty corrections need approval and update visible coverage after apply", async () => {
  const host = { innerHTML: "", isConnected: true };
  const calls = [];
  let saved = false;
  const policy = { enabled: true, lookback_months: 6, total_weight: 4, hours24_weight: 6,
    weekend_weight: 8, group_weight: 4 };
  const preview = { preview_hash: "past-hash", month: "2026-09", sheet: "Past Duties",
    counts: { create: 0, correct: 1, unchanged: 0, needs_review: 0, skip: 0 }, warnings: [],
    rows: [{ key: "1", row: 2, column: 2, raw: { name: "Another Member", duty_type: "MAIN_1ST_24HR" },
      normalized: { name: "Another Member", date: "2026-09-01", duty_type: "MAIN_1ST_24HR" },
      action: "correct", errors: [], person_candidates: [],
      conflicts: [{ id: "old-id", name: "History Member", slot: "main", source: "manual" }],
      target_assignment: "old-id" }] };
  globalThis.pastApi = {
    members: async () => [{ id: "member-id", canonical_name: "Another Member", active_status: "active" }],
    status: async () => ({ today: "2026-10-12", policy, duty_types: [{ key: "MAIN_1ST_24HR", label: "Main 1st Call" }],
      coverage: saved ? [{ month: "2026-09", assignments: 1, members: 1, days_with_records: 1, latest_duty_date: "2026-09-01" }] : [],
      history: saved ? [{ id: "batch-id", filename: "duties.xls", month: "2026-09", sheet: "Past Duties",
        actor: "Admin", at: "2026-10-12T06:00:00Z", counts: preview.counts }] : [] }),
    upload: async (action, file, options, hash) => {
      calls.push({ action, options: structuredClone(options), hash });
      if (action === "inspect") return { sheets: [{ name: "Past Duties", headers: ["date", "name", "duty_type"],
        mapping: { date: 0, name: 1, duty_type: 2 } }], fields: ["date", "name", "duty_type"] };
      if (action === "preview") return preview;
      saved = true;
      return { counts: preview.counts };
    },
  };
  const clickPast = action => host.onclick({ target: { closest: () => ({ dataset: { past: action } }) } });
  const canApplyPast = () => host.innerHTML.includes('data-past="apply"') && !host.innerHTML.includes("import-apply-blocker");
  await pastUi.mountPastDuties(host);
  assert.match(host.innerHTML, /accept=".xls,.xlsx"/);
  change(host, { past: "file" }, { files: [{ name: "duties.xls" }] });
  await clickPast("inspect");
  await clickPast("preview");
  assert.equal(canApplyPast(), false);
  const exported=[];
  globalThis.reportApi={download:(rows,filename)=>exported.push({rows,filename})};
  await clickPast("rejected");
  assert.equal(exported.length,1);
  assert.equal(exported[0].filename,"past_duty_rejected_rows.csv");
  assert.deepEqual(exported[0].rows,preview.rows);
  assert.equal(canApplyPast(), false);
  delete globalThis.reportApi;
  change(host, { past: "confirm-corrections" }, { checked: true });
  assert.equal(canApplyPast(), true);
  change(host, { past: "filter" }, { value: "correct" });
  assert.equal(canApplyPast(), true);
  await clickPast("apply");
  assert.equal(calls.at(-1).hash, "past-hash");
  assert.equal(calls.at(-1).options.confirm_corrections, true);
  assert.match(host.innerHTML, /duties.xls/);
  assert.match(host.innerHTML, /future candidate scoring now use/);
});

test("HOD profile shows attributed comments and saves a dated promotion with reason", async () => {
  const dialog = { innerHTML: "", isConnected: true, setAttribute() {}, showModal() {}, addEventListener() {},
    remove() { this.isConnected = false; }, close() {} };
  const previousDocument = globalThis.document;
  const previousFormData = globalThis.FormData;
  globalThis.document = { getElementById: () => null, createElement: () => dialog, body: { append() {} } };
  globalThis.FormData = class { constructor(form) { this.form = form; } get(key) { return this.form.values[key]; } };
  const profile = {
    member: { id: "person", canonical_name: "Profile Doctor", active_status: "active", call_level: "1ST_CALL", aliases: [], designations: [] },
    today: "2026-10-12", current_call_level: "1ST_CALL", can_manage: true,
    call_history: [], comments: [{ id: "note", author: "Department HOD", role: "hod", body: '<script>alert("x")</script>', recorded_at: "2026-10-12T06:00:00Z" }],
    postings: [], leaves: [], statistics: { official_duties: 4, hours24: 3, weekend_duties: 1 }, imports: [],
  };
  let saved;
  let refreshed = 0;
  globalThis.profileApi = {
    get: async () => profile,
    call: async (...args) => { saved = args; profile.current_call_level = "2ND_CALL"; return profile; },
  };
  try {
    await profileUi.openMemberProfile("person", "hod", async () => { refreshed++; });
    assert.match(dialog.innerHTML, /HOD: Department HOD/);
    assert.ok(!dialog.innerHTML.includes('<script>alert("x")</script>'));
    assert.match(dialog.innerHTML, /Effective from/);
    assert.ok(!dialog.innerHTML.includes('data-profile-form="details"'));
    await dialog.onsubmit({ preventDefault() {}, target: { dataset: { profileForm: "call" },
      values: { call_level: "2ND_CALL", effective_from: "2026-11-01", reason: "HOD training approval" } } });
    assert.deepEqual(saved, ["person", "2ND_CALL", "2026-11-01", "HOD training approval"]);
    assert.equal(refreshed, 1);
    assert.match(dialog.innerHTML, /linked data refreshed/);
  } finally { globalThis.document = previousDocument; globalThis.FormData = previousFormData; }
});
