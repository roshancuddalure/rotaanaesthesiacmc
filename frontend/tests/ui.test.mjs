import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/ui.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const ui = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("stored codes become readable labels", () => {
  assert.equal(ui.codeLabel("2ND_CALL"), "2nd call");
  assert.equal(ui.codeLabel("CO_4TH_CALL"), "Co-4th call");
  assert.equal(ui.codeLabel("UNIT_IV"), "Unit IV");
  assert.equal(ui.codeLabel("UNIT_I"), "Unit I");
  assert.equal(ui.codeLabel("DEPT_OF_CARDIAC_ANAESTHESIA"), "Dept of Cardiac Anaesthesia");
  assert.equal(ui.codeLabel("CASUAL_LEAVE"), "Casual leave");
  assert.equal(ui.codeLabel("NEURO_ICU"), "Neuro ICU");
  assert.equal(ui.codeLabel("SICU"), "SICU");
  assert.equal(ui.codeLabel("2ND_CALL_PG_2024"), "2nd call PG 2024");
  assert.equal(ui.codeLabel("Already readable"), "Already readable");
  assert.equal(ui.codeLabel(""), "—");
  assert.equal(ui.codeLabel(null, "Unassigned"), "Unassigned");
});

test("dates and months read naturally and survive bad input", () => {
  assert.equal(ui.formatDate("2026-10-19"), "Mon 19 Oct 2026");
  assert.equal(ui.formatDate("2026-10-19", { weekday: false }), "19 Oct 2026");
  assert.equal(ui.formatDate("2026-05-02T10:00:00Z"), "Sat 2 May 2026");
  assert.equal(ui.formatDate(null), "—");
  assert.equal(ui.formatDate("not a date"), "not a date");
  assert.equal(ui.formatMonth("2026-10"), "October 2026");
  assert.equal(ui.formatDateRange("2026-10-01", "2026-10-31"), "1 Oct 2026 – 31 Oct 2026");
  assert.equal(ui.formatDateRange("2026-10-01", "2026-10-01"), "1 Oct 2026");
});

test("building blocks escape text and expose state to assistive technology", () => {
  assert.match(ui.badge("<b>Ready</b>", "success"), /ds-badge--success">&lt;b&gt;Ready&lt;\/b&gt;</);
  const empty = ui.emptyState({ title: "No leave", body: "Add the first record", actionHtml: "<button>Add</button>" });
  assert.match(empty, /role="status"/);
  assert.match(empty, /<button>Add<\/button>/);
  assert.match(ui.pageSkeleton("members"), /aria-busy="true"[\s\S]*Loading members…/);
  assert.match(ui.nextStep({ tone: "danger", title: "Lock scope" }), /role="alert"/);
});

const pickedIds = html => [...html.matchAll(/data-pick-member="([^"]*)"/g)].map(match => match[1]);
const sameNameCandidates = [
  { id: "same-a", name: "Dr Same Name", call_level: "2ND_CALL", status: "active" },
  { id: "same-b", name: "Dr Same Name", call_level: "2ND_CALL", status: "active" },
];

test("member matches distinguish equal names by returned selected identity", () => {
  for (const [selectedId, alternative] of [["same-a", "same-b"], ["same-b", "same-a"]]) {
    const html = ui.memberMatch("row-2", { raw: "Imported Same", status: "matched", name: "Dr Same Name", selectedId, candidates: sameNameCandidates });
    assert.deepEqual(pickedIds(html), [alternative]);
    assert.match(html, new RegExp(`member-match__identity[\\s\\S]*Member ID: ${selectedId}`));
    assert.match(html, new RegExp(`data-pick-member="${alternative}"[\\s\\S]*Member ID: ${alternative}`));
    assert.match(html, /Existing member/);
  }
});

test("candidate filtering never guesses identity from the displayed name", () => {
  const candidates = [...sameNameCandidates, { id: "same-a", name: "Previous name" }, { person_id: "person-shaped", name: "Dr Same Name" }, { name: "No ID" }];
  assert.deepEqual(pickedIds(ui.memberMatch("2", { raw: "Same", status: "matched", name: "Dr Same Name", selectedId: "same-a", candidates })), ["same-b", "person-shaped"]);
  for (const status of ["matched", "ambiguous", "needs_review"]) {
    assert.deepEqual(pickedIds(ui.memberMatch("2", { raw: "Same", status, name: "Dr Same Name", candidates: sameNameCandidates })), ["same-a", "same-b"]);
  }
});

test("member identity context and choice attributes escape untrusted values", () => {
  const html = ui.memberMatch('row"<', {
    raw: '<script>raw</script>', status: 'matched', name: '<b>Same</b>', selectedId: 'selected"<',
    selectedIdentity: { id: 'selected"<', name: '<b>Same</b>', designation: '<img src=x>', units: ['Unit <one>'] },
    candidates: [{ person_id: 'candidate"<', name: '<b>Same</b>', designation: '<script>designation</script>', units: ['Unit <two>'], reason: '<script>reason</script>' }],
  });
  assert.match(html, /data-pick-row="row&quot;&lt;"/);
  assert.deepEqual(pickedIds(html), ['candidate&quot;&lt;']);
  assert.match(html, /Member ID: selected&quot;&lt;/);
  assert.match(html, /Member ID: candidate&quot;&lt;/);
  assert.match(html, /&lt;b&gt;Same&lt;\/b&gt;/);
  assert.match(html, /&lt;script&gt;reason&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|<img|<b>/);
});

test("member alternatives retain input order and limit after identity filtering", () => {
  const candidates = Array.from({ length: 8 }, (_, index) => ({ id: `member-${index}`, name: "Same name" }));
  assert.deepEqual(pickedIds(ui.memberMatch("2", { raw: "Same", status: "matched", name: "Same name", selectedId: "member-0", candidates })), ["member-1", "member-2", "member-3", "member-4", "member-5"]);
  assert.deepEqual(pickedIds(ui.memberMatch("2", { raw: "Same", status: "ambiguous", candidates })), ["member-0", "member-1", "member-2", "member-3", "member-4"]);
});
