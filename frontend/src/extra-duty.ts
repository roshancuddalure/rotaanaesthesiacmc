/**
 * Extra-duty layer (docs/extra_duty_contract.md, sections 4 and 8).
 *
 * - `openExtraDuty` previews the layer for a draft month, applies it after an explicit review,
 *   and can undo an applied batch. Every write is guarded by the preview token and plan hash.
 * - `renderMemberExtraDuties` lists one person's ledger rows (active and void).
 * - `auditReportLinks` returns two download buttons for the month's 360° audit report; the
 *   click handler below fetches with the bearer token and saves the file through a Blob URL.
 * - `renderUnitFallbacks` edits the ordered fallback units per unit.
 * All endpoints are admin-only; callers show these only to admins.
 */
import { request, requestDownload, type OverLimitPerson } from "./services/api";
import { workspaceDialog } from "./member-workspace";
import { conflictsFromError, showProposalConflict, type ProposalConflict } from "./compute-conflict";
import { codeLabel, formatDate, formatMonth } from "./ui";
import { currentRole } from "./session-role";
import { formatAuditTimestamp } from "./audit-time";

const API = "/api/v1/extra-duty";
/** Superadmin allocations are undone through their own endpoint (docs/superadmin_override_contract.md §1). */
const SUPERADMIN_UNDO = (batchId: string) => `/api/v1/superadmin-allocation/${encodeURIComponent(batchId)}/undo`;
const isSuperadminBatch = (b: { summary?: unknown } | null | undefined) =>
  (b?.summary as { mode?: string } | undefined)?.mode === "superadmin_allocation";
/** Balance-duties runs share the batch table and are undone through their own endpoint (docs/call_level_pool_and_balance_contract.md §3). */
const BALANCE_UNDO = (batchId: string) => `/api/v1/balance-duties/batches/${encodeURIComponent(batchId)}/undo`;
const isBalanceBatch = (b: { summary?: unknown } | null | undefined) =>
  (b?.summary as { mode?: string } | undefined)?.mode === "balance";
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const STRICT_RULES_TEXT = "Leave and rest after 24-hour duties are never broken. Unit staffing limits and equal-duty fairness may be exceeded; every such duty is recorded in the ledger, and whoever did one goes down the list next time.";

const RULE_LABELS: Record<string, string> = {
  unit_safety_hard_block: "Unit short-staffed (hard block)",
  unit_safety_review: "Unit staffing warning",
  monthly_24hr_limit: "Over monthly 24-hour limit",
  monthly_weekend_24hr_limit: "Over weekend 24-hour limit",
  monthly_same_group_limit: "Over monthly limit for this duty type",
  monthly_same_campus_limit: "Over monthly limit for this campus",
  fallback_unit: "Covered a duty for another unit",
  any_unit: "Covered from another unit",
  outside_scope_unit: "Covered from a unit outside this month's scope",
  unposted_member: "Member has no posting this month",
  unit_rule: "Duty not allowed for this unit",
  fairness: "Above the equal-duty share",
  equal_duties: "Above the equal-duty share",
  superadmin_allocation: "Superadmin allocation",
  rebalanced_extra_duty: "Extra duty passed on by Balance duties",
};
/** Plain words for a rule code; unknown codes become sentence-case words, never raw codes. */
export function ruleLabel(code: string): string {
  if (RULE_LABELS[code]) return RULE_LABELS[code];
  const words = String(code || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "Rule";
}
const rulesText = (codes: string[] | null | undefined) =>
  codes?.length ? codes.map(ruleLabel).join(" · ") : "None — within every rule";

export interface Justice { ledger_count: number; last_extra_date: string | null; month_duties: number;
  month_24hr: number; rest_hours: number | null }
export interface Alternative { person_id: string; person_name: string; justice?: Justice | null; overridden_rules?: string[] }
export interface Decision {
  slot_id: string; action: "assign" | "assign_fallback" | "unfilled"; person_id: string | null; person_name: string | null;
  home_unit_id: string | null; assigned_unit_id: string | null; overridden_rules: string[]; ledger: boolean;
  justice: Justice | null; reason: string; alternatives: Alternative[];
  // Display fields the backend may add (not in the contract's minimum shape); all optional.
  duty_date?: string; duty_type?: string; duty_label?: string; slot_label?: string; starts_at?: string;
  home_unit_name?: string; assigned_unit_name?: string;
  /** Fill-all: where the person came from (docs/extra_duty_fill_all_contract.md §3). */
  tier?: Tier;
}
export type Mode = "standard" | "all_units";
export type Tier = "home" | "fallback" | "same_campus" | "any_unit" | "outside_scope" | "unposted";
export interface Summary { filled: number; fallback: number; ledger_records: number; unfilled: number; slots_considered: number;
  mode?: Mode; over_limit_people?: number; cross_unit?: number; unposted_used?: number }
export interface UnfilledCause { cause: string; label: string; count: number; fix: string;
  examples: { slot_id: string; duty_date: string; duty_label?: string; unit_name?: string }[] }
export interface Diagnostics { unposted_by_level?: Record<string, number>; unposted_by_group?: Record<string, number> }
/** Fields both preview and apply may carry (empty in standard mode). */
interface Report { over_limit_people?: OverLimitPerson[]; unfilled_causes?: UnfilledCause[]; diagnostics?: Diagnostics }
interface Preview extends Report { month: string; plan_hash: string; context_hash: string; decisions: Decision[]; summary: Summary;
  generated_at: string; token: string }
interface Batch { id: string; status: string; created_at: string; created_by_name: string | null; summary: Partial<Summary> & { mode?: string; moves?: number; swaps?: number; extra_moves?: number } }
interface Status { enabled: boolean; month: string; open_slots: number; batches: Batch[] }
interface ApplyResult extends Report { batch_id: string; summary: Summary; decisions: Decision[] }
interface UndoConflict { slot_id?: string; reason?: string; message?: string; duty_date?: string; person_name?: string; duty_label?: string; duty_type?: string }
interface UndoResult { batch_id: string; restored: number; conflicts: UndoConflict[] }
export interface LedgerRow { id: string; person_id: string; person_name: string; duty_date: string; duty_type: string;
  home_unit: unknown; assigned_unit: unknown; fallback_used: boolean; overridden_rules: string[]; status: string;
  void_reason: string | null; batch_id: string; created_at: string; duty_label?: string;
  /** Ledger transfers by Balance duties (balance_extra_duties_contract §2): display strings or transfer objects. */
  transfers?: (string | LedgerTransfer)[]; rebalanced?: boolean }
export interface LedgerTransfer { text?: string; display?: string; from_person_id?: string; from_person_name?: string;
  to_person_id?: string; to_person_name?: string; balance_batch_id?: string; at?: string }
/** "Passed on from Dr Asha by Balance duties on 22 Oct 2026" for one ledger transfer. */
export function transferText(t: string | LedgerTransfer | null | undefined): string {
  if (!t) return "";
  if (typeof t === "string") return t.trim();
  if (t.text || t.display) return String(t.text || t.display).trim();
  const when = t.at ? ` on ${formatDate(String(t.at).slice(0, 10), { weekday: false })}` : "";
  return `Passed on from ${t.from_person_name || "another member"} by Balance duties${when}`;
}
export interface FallbackRow { unit_id: string; unit_name: string; fallbacks: { unit_id: string; unit_name: string }[] }
type ApiError = Error & { status?: number; detail?: Record<string, unknown> | string | null };

const errorCode = (error: unknown) => {
  const detail = (error as ApiError)?.detail;
  return detail && typeof detail === "object" && typeof detail.code === "string" ? detail.code : "";
};
const errorMessage = (error: unknown, fallback = "That did not work") =>
  error instanceof Error && error.message ? error.message : fallback;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const unitName = (value: unknown): string => value && typeof value === "object"
  ? String((value as { name?: string; unit_name?: string }).name ?? (value as { unit_name?: string }).unit_name ?? "")
  : String(value ?? "");
const dutyText = (d: { duty_label?: string; duty_type?: string; slot_label?: string }) => {
  const base = d.duty_label || (d.duty_type ? codeLabel(d.duty_type) : "Duty");
  // Template slot labels look like "UNIT_VI:primary"; only a non-primary suffix is worth showing.
  const extra = (d.slot_label || "").split(":").pop()!.trim();
  return extra && !/^primary$/i.test(extra) && extra !== base ? `${base} (${extra})` : base;
};

/** Signal that aborts when the window closes or after `ms`. */
function lifetimeSignal(lifetime: AbortController, ms: number): AbortSignal {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (lifetime.signal.aborted) controller.abort();
  lifetime.signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}

/** "0 extra duties in the last 12 months · 3 duties this month · 2 of them 24-hour · 36 h rest before". */
export function justiceText(j: Justice | null | undefined): string {
  if (!j) return "No ranking details";
  const parts = [`${plural(j.ledger_count ?? 0, "extra duty", "extra duties")} in the last 12 months`];
  if (j.last_extra_date) parts.push(`last one ${formatDate(j.last_extra_date, { weekday: false })}`);
  parts.push(`${plural(j.month_duties ?? 0, "duty", "duties")} this month`);
  if (j.month_24hr) parts.push(`${j.month_24hr} of them 24-hour`);
  if (j.rest_hours === null || j.rest_hours === undefined || !Number.isFinite(j.rest_hours)) parts.push("no earlier duty");
  else parts.push(`${Math.round(j.rest_hours)} h rest since the last duty`);
  return parts.join(" · ");
}

function chip(count: number, label: string, tone: string) {
  return `<li class="extra-duty-chip extra-duty-chip--${tone}"><strong>${esc(count)}</strong><span>${esc(label)}</span></li>`;
}

/* ----------------------------------------------------------------------------------------- */
/* Audit report downloads                                                                     */
/* ----------------------------------------------------------------------------------------- */

/** Two download buttons for the month's 360° audit report (HTML and Excel). */
export function auditReportLinks(month: string): string {
  installReportDownloads();
  return `<div class="extra-duty-report-links" role="group" aria-label="Audit report for ${esc(formatMonth(month))}">
    <button type="button" data-audit-report="html" data-audit-month="${esc(month)}">Download audit report (HTML)</button>
    <button type="button" data-audit-report="xlsx" data-audit-month="${esc(month)}">Download audit report (Excel)</button>
    <p class="hint" role="status" aria-live="polite" data-audit-report-status></p></div>`;
}

/** Authenticated download: fetch with the bearer token, then save through an object URL. */
export async function downloadAuditReport(month: string, format: "html" | "xlsx", signal?: AbortSignal): Promise<string> {
  const path = `${API}/report?month=${encodeURIComponent(month)}&format=${format}`;
  let result: Awaited<ReturnType<typeof requestDownload>>;
  try {
    result = await requestDownload(path, signal);
  } catch (error) {
    if (error instanceof TypeError) throw new Error("Cannot reach the server. Check your connection and try again.");
    throw error;
  }
  const {blob} = result;
  const filename = result.filename ?? `rota-audit-report-${month}.${format}`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

let reportDownloadsInstalled = false;
function installReportDownloads() {
  if (reportDownloadsInstalled) return;
  reportDownloadsInstalled = true;
  document.addEventListener("click", async event => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-audit-report]");
    if (!button || button.disabled) return;
    event.preventDefault();
    const group = button.closest(".extra-duty-report-links");
    const status = group?.querySelector<HTMLElement>("[data-audit-report-status]");
    const buttons = [...(group?.querySelectorAll<HTMLButtonElement>("[data-audit-report]") ?? [button])];
    const format = button.dataset.auditReport === "xlsx" ? "xlsx" : "html";
    buttons.forEach(b => { b.disabled = true; });
    button.setAttribute("aria-busy", "true");
    if (status) status.textContent = `Preparing the ${format === "xlsx" ? "Excel" : "HTML"} report…`;
    try {
      const filename = await downloadAuditReport(button.dataset.auditMonth || "", format);
      if (status) status.textContent = `Downloaded ${filename}.`;
    } catch (error) {
      if (status) status.textContent = `${errorMessage(error)} Nothing was downloaded; try again${format === "xlsx" ? ", or download the HTML report" : ""}.`;
    } finally {
      buttons.forEach(b => { b.disabled = false; });
      button.removeAttribute("aria-busy");
    }
  });
}

/* ----------------------------------------------------------------------------------------- */
/* Fill-all report pieces (docs/extra_duty_fill_all_contract.md), shared with Publish         */
/* ----------------------------------------------------------------------------------------- */

/** "3RD_CALL" -> "3rd call", "CO_4TH_CALL" -> "Co-4th call"; unknown codes become plain words. */
export function callLevelText(level: string | null | undefined): string {
  const raw = String(level ?? "").toUpperCase();
  if (!raw) return "No call level";
  const n = raw.match(/(\d)(ST|ND|RD|TH)/);
  if (n) return `${raw.startsWith("CO") ? "Co-" : ""}${n[1]}${n[2].toLowerCase()} call`;
  return codeLabel(raw);
}

/** Where a fill-all person came from, in plain words. */
export const TIER_LABELS: Record<Tier, string> = {
  home: "Own unit",
  fallback: "From the unit's fallback list",
  same_campus: "From another unit on the same campus",
  any_unit: "From another unit",
  outside_scope: "From a unit outside this month's scope",
  unposted: "Members without a posting this month",
};
const CROSS_TIERS: Tier[] = ["fallback", "same_campus", "any_unit", "outside_scope", "unposted"];

/**
 * Table of members above an individual duty limit (name, call level, unit, duties, each limit
 * actual / limit). Long lists (more than `collapseOver`) sit in a closed disclosure.
 */
export function overLimitTable(people: OverLimitPerson[] | null | undefined, options: { caption: string; collapseOver?: number; id?: string }): string {
  const list = [...(people ?? [])];
  if (!list.length) return "";
  const rows = list.map(p => `<tr data-over-limit="${esc(p.person_id)}">
      <td data-label="Member"><strong>${esc(p.person_name)}</strong></td>
      <td data-label="Call level">${esc(callLevelText(p.call_level))}</td>
      <td data-label="Unit">${p.home_unit_name ? esc(p.home_unit_name) : '<span class="hint">No posting this month</span>'}</td>
      <td data-label="Duties this month">${esc(plural(p.month_duties ?? 0, "duty", "duties"))}${p.month_24hr ? `<small class="over-limit-sub">${esc(p.month_24hr)} of them 24-hour</small>` : ""}</td>
      <td data-label="Limits exceeded"><ul class="over-limit-limits">${(p.limits ?? []).map(l => `<li><span>${esc(l.label || ruleLabel(l.code))}</span>
        <strong class="over-limit-figure">${esc(l.actual)} / ${esc(l.limit)}</strong><span class="visually-hidden"> (${esc(l.actual)} done, limit ${esc(l.limit)})</span></li>`).join("")}</ul></td></tr>`).join("");
  const table = `<div class="table-scroll"><table class="extra-duty-table over-limit-table"${options.id ? ` id="${esc(options.id)}"` : ""}>
    <caption>${esc(options.caption)} <span class="over-limit-caption-note">Limits shown as done / allowed.</span></caption>
    <thead><tr><th scope="col">Member</th><th scope="col">Call level</th><th scope="col">Unit</th><th scope="col">Duties this month</th><th scope="col">Limits exceeded</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
  const collapse = options.collapseOver ?? Infinity;
  if (list.length <= collapse) return table;
  return `<details class="over-limit-details"><summary>Show all ${esc(plural(list.length, "member"))} over a limit</summary>${table}</details>`;
}

/** The plain-words list of rules fill-all never breaks. */
function neverBrokenBox(): string {
  const item = (title: string, text: string) => `<li><strong>${esc(title)}</strong><span>${esc(text)}</span></li>`;
  return `<section class="fill-all-never" aria-labelledby="fill-all-never-title">
    <h3 id="fill-all-never-title">Never broken</h3>
    <ul>${[
      item("Leave", "Nobody on leave (approved, requested or waiting for review) is given a duty."),
      item("Rest after a 24-hour duty", "Nobody works the day after a 24-hour duty or before the minimum rest, and nobody has two duties at once."),
      item("Call level", "Only members of the duty's own call level. No crossover between levels."),
      item("Eligibility groups", "Allowed and excluded groups are followed exactly."),
      item("The duty's unit rules", "A duty is never placed in a unit its \u201cOnly these units\u201d or \u201cNever these units\u201d rule leaves out."),
    ].join("")}</ul>
    <p class="fill-all-never__may"><strong>May be exceeded:</strong> a member's individual duty limits, unit staffing and equal-duty fairness. Every member over a limit is listed below, in Publish and in the audit report.</p>
  </section>`;
}

function diagnosticsCallout(diagnostics: Diagnostics | null | undefined, month: string): string {
  const levels = Object.entries(diagnostics?.unposted_by_level ?? {}).filter(([, n]) => Number(n) > 0);
  if (!levels.length) return "";
  const groups = Object.entries(diagnostics?.unposted_by_group ?? {}).filter(([, n]) => Number(n) > 0);
  const monthName = formatMonth(month);
  return `<div class="extra-duty-notice extra-duty-notice--info fill-all-diagnostics" role="note" aria-label="Postings check">
    <p><strong>Postings check for ${esc(monthName)}</strong></p>
    <ul>${levels.map(([level, n]) => `<li data-diagnostic="${esc(level)}">${esc(`${n} ${callLevelText(level).replace(/ call$/, "-call")} ${Number(n) === 1 ? "member has" : "members have"} no posting this month`)}</li>`).join("")}</ul>
    ${groups.length ? `<p class="fill-all-diagnostics__groups">By group: ${esc(groups.map(([g, n]) => `${codeLabel(g.toUpperCase())} ${n}`).join(" · "))}</p>` : ""}
    <p>Fill-all can use them, but each one is flagged and ledgered. To fix this at the source, enter their ${esc(monthName)} postings in Unit Management.</p></div>`;
}

/* ----------------------------------------------------------------------------------------- */
/* Preview / apply / undo window                                                              */
/* ----------------------------------------------------------------------------------------- */

type Notice = { tone: "error" | "success" | "info"; text: string; next?: "preview" | "retry" | ""; list?: string[] };

/** Fill remaining duties from every unit and from members without a posting (mode "all_units"). */
export function openFillAll(month: string, onApplied: () => void): Promise<void> {
  return openExtraDuty(month, onApplied, "all_units");
}

export async function openExtraDuty(month: string, onApplied: () => void, mode: Mode = "standard"): Promise<void> {
  const all = mode === "all_units";
  const title = all ? "Fill remaining duties (all units)" : "Extra-duty layer";
  const dialog = workspaceDialog(title, `compute-workspace extra-duty-workspace${all ? " fill-all-workspace" : ""}`);
  const lifetime = new AbortController();
  let closed = false;
  let busy: "" | "load" | "apply" | "undo-check" | "undo" = "";
  let status: Status | null = null;
  let preview: Preview | null = null;
  let applied: ApplyResult | null = null;
  let units = new Map<string, string>();
  let reviewed = false;
  let notice: Notice | null = null;
  let undo: { batchId: string; phase: "confirm" | "conflict"; restored: number; conflicts: UndoConflict[] } | null = null;
  let blocked = "";   // a reason the layer cannot run for this month (disabled, not draft, ...)

  dialog.addEventListener("close", () => { closed = true; lifetime.abort(); dialog.remove(); });
  // Writes are not abortable on the server: keep the window open until they answer.
  dialog.addEventListener("cancel", event => { if (busy === "apply" || busy === "undo") event.preventDefault(); });

  const post = <T>(path: string, body: object, ms = 60000) => request<T>(path.startsWith("/") ? path : `${API}/${path}`,
    { method: "POST", body: JSON.stringify(body), signal: lifetimeSignal(lifetime, ms) });
  const batchById = (id: string) => status?.batches.find(b => b.id === id) ?? null;
  const undoPath = (id: string) => isSuperadminBatch(batchById(id)) ? SUPERADMIN_UNDO(id)
    : isBalanceBatch(batchById(id)) ? BALANCE_UNDO(id) : `batches/${encodeURIComponent(id)}/undo`;

  const unitLabel = (id: string | null | undefined, name?: string) => name || (id && units.get(id)) || "Unit not named";

  function decisionRow(d: Decision) {
    const fallback = d.action === "assign_fallback" || (d.home_unit_id && d.assigned_unit_id && d.home_unit_id !== d.assigned_unit_id);
    const alternatives = d.alternatives?.length
      ? `<details class="extra-duty-alternatives"><summary>${plural(d.alternatives.length, "other person", "other people")}</summary><ol>${d.alternatives.map(a =>
          `<li><strong>${esc(a.person_name)}</strong><small>${esc(justiceText(a.justice))}</small></li>`).join("")}</ol></details>`
      : '<span class="hint">No one else could take it</span>';
    return `<tr data-decision="${esc(d.slot_id)}">
      <td data-label="Date">${esc(d.duty_date ? formatDate(d.duty_date) : "Date not given")}</td>
      <td data-label="Duty">${esc(dutyText(d))}</td>
      <td data-label="Unit">${esc(unitLabel(d.assigned_unit_id, d.assigned_unit_name))}${fallback
        ? `<span class="extra-duty-badge extra-duty-badge--fallback">Fallback from ${esc(unitLabel(d.home_unit_id, d.home_unit_name))}</span>` : ""}${d.tier === "unposted"
        ? '<span class="extra-duty-badge extra-duty-badge--fallback">Member has no posting</span>' : ""}</td>
      <td data-label="Person"><strong>${esc(d.person_name)}</strong>${d.ledger ? '<span class="extra-duty-badge">Ledger</span>' : ""}</td>
      <td data-label="Rules overridden">${d.overridden_rules?.length
        ? `<ul class="extra-duty-rules">${d.overridden_rules.map(r => `<li>${esc(ruleLabel(r))}</li>`).join("")}</ul>` : '<span class="hint">None — within every rule</span>'}</td>
      <td data-label="Why this person">${esc(justiceText(d.justice))}</td>
      <td data-label="Alternatives">${alternatives}</td></tr>`;
  }

  function decisionsTable(decisions: Decision[], caption: string) {
    const filled = decisions.filter(d => d.action !== "unfilled");
    if (!filled.length) return '<p class="extra-duty-empty">No duty can be filled without breaking leave, rest, call-level or group rules.</p>';
    return `<div class="table-scroll"><table class="extra-duty-table"><caption>${esc(caption)}</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">Duty</th><th scope="col">Unit</th><th scope="col">Person</th>
      <th scope="col">Rules overridden</th><th scope="col">Why this person</th><th scope="col">Alternatives</th></tr></thead>
      <tbody>${filled.map(decisionRow).join("")}</tbody></table></div>`;
  }

  function unfilledList(decisions: Decision[]) {
    const unfilled = decisions.filter(d => d.action === "unfilled");
    if (!unfilled.length) return "";
    return `<section class="extra-duty-unfilled" aria-labelledby="extra-duty-unfilled-title">
      <h3 id="extra-duty-unfilled-title">Cannot be filled (${unfilled.length})</h3>
      <p class="hint">No one can take these without breaking leave, rest, call-level or group rules — the reason is shown for each unit. They stay open; assign them by hand, adjust postings or groups, or add a fallback unit in Unit Management.</p>
      <ul>${unfilled.map(d => `<li data-unfilled="${esc(d.slot_id)}"><strong>${esc(d.duty_date ? formatDate(d.duty_date) : "Date not given")} · ${esc(dutyText(d))} · ${esc(unitLabel(d.home_unit_id, d.home_unit_name))}</strong>
        <span>${esc(d.reason || "No eligible person is free.")}</span></li>`).join("")}</ul></section>`;
  }

  /** Fill-all: who came from another unit or has no posting, grouped by where they came from. */
  function crossUnitList(decisions: Decision[]) {
    const groups = CROSS_TIERS.map(tier => [tier, decisions.filter(d => d.action !== "unfilled" && d.tier === tier)] as const).filter(([, list]) => list.length);
    if (!groups.length) return "";
    const total = groups.reduce((n, [, list]) => n + list.length, 0);
    return `<section class="fill-all-cross" aria-labelledby="fill-all-cross-title">
      <h3 id="fill-all-cross-title">Covered from other units / members without a posting (${total})</h3>
      ${groups.map(([tier, list]) => `<div class="fill-all-tier" data-tier="${esc(tier)}"><h4>${esc(TIER_LABELS[tier])} <span class="fill-all-count">${list.length}</span></h4>
        <ul>${list.map(d => `<li data-cross="${esc(d.slot_id)}"><strong>${esc(d.person_name)}</strong>
          <span>${esc([d.duty_date ? formatDate(d.duty_date) : "", dutyText(d)].filter(Boolean).join(" · "))}</span>
          <span class="hint">${tier === "unposted"
            ? `${esc(unitLabel(d.home_unit_id, d.home_unit_name))}'s duty · no posting this month`
            : `Works in ${esc(unitLabel(d.assigned_unit_id, d.assigned_unit_name))} · covers ${esc(unitLabel(d.home_unit_id, d.home_unit_name))}'s duty`}</span></li>`).join("")}</ul></div>`).join("")}
    </section>`;
  }

  /** Fill-all: open duties grouped by cause, each with a plain fix and a few examples. */
  function causesList(source: Report & { decisions: Decision[] }) {
    const causes = source.unfilled_causes ?? [];
    const open = source.decisions.filter(d => d.action === "unfilled");
    if (!causes.length) return unfilledList(source.decisions) + diagnosticsCallout(source.diagnostics, month);
    const total = causes.reduce((n, c) => n + (c.count ?? 0), 0);
    return `<section class="extra-duty-unfilled fill-all-causes" aria-labelledby="fill-all-causes-title">
      <h3 id="fill-all-causes-title">Cannot be filled (${total})</h3>
      <p class="hint">These stay open: no one can take them without breaking a rule that is never broken.</p>
      <ul>${causes.map(c => `<li class="fill-all-cause" data-cause="${esc(c.cause)}">
        <div class="fill-all-cause__head"><strong>${esc(c.label || codeLabel(c.cause))}</strong><span class="fill-all-count">${esc(plural(c.count ?? 0, "duty", "duties"))}</span></div>
        ${c.fix ? `<p class="fill-all-cause__fix"><span>How to fix:</span> ${esc(c.fix)}</p>` : ""}
        ${c.examples?.length ? `<p class="fill-all-cause__examples">For example: ${esc(c.examples.map(e => [e.duty_date ? formatDate(e.duty_date, { weekday: false }) : "", e.duty_label || "", e.unit_name || ""].filter(Boolean).join(" · ")).join("; "))}${(c.count ?? 0) > c.examples.length ? ` and ${(c.count ?? 0) - c.examples.length} more` : ""}</p>` : ""}</li>`).join("")}</ul>
      ${open.length ? `<details class="fill-all-every"><summary>Every open duty, with the reason (${open.length})</summary><ul>${open.map(d => `<li data-unfilled="${esc(d.slot_id)}"><strong>${esc(d.duty_date ? formatDate(d.duty_date) : "Date not given")} · ${esc(dutyText(d))} · ${esc(unitLabel(d.home_unit_id, d.home_unit_name))}</strong>
        <span>${esc(d.reason || "No eligible person is free.")}</span></li>`).join("")}</ul></details>` : ""}
    </section>${diagnosticsCallout(source.diagnostics, month)}`;
  }

  /** The whole fill-all report (preview or applied result). */
  function fillAllReport(source: Report & { decisions: Decision[]; summary: Summary }, done: boolean) {
    const people = source.over_limit_people ?? [];
    return `${chips(source.summary, done, people.length)}
      ${people.length ? `<section class="fill-all-over" aria-labelledby="fill-all-over-title"><h3 id="fill-all-over-title">Members over their individual limit (${people.length})</h3>
        <p class="hint">Their own duty limits are exceeded ${done ? "after these duties" : "if you apply"}. Every other rule still holds. This list also appears in Publish and in the audit report.</p>
        ${overLimitTable(people, { caption: `Members over an individual limit, ${formatMonth(month)}` })}</section>`
        : '<p class="fill-all-ok">Nobody goes over an individual duty limit.</p>'}
      ${crossUnitList(source.decisions)}
      ${causesList(source)}
      ${decisionsTable(source.decisions, `${done ? "Duties filled" : "Proposed duties"} for ${formatMonth(month)} (all units)`)}`;
  }

  /** The standard window's way into fill-all. */
  function fillAllCta() {
    if (all || busy) return "";
    return `<section class="fill-all-cta" aria-labelledby="fill-all-cta-title"><div>
      <h3 id="fill-all-cta-title">Duties still open?</h3>
      <p>Fill remaining duties from every unit and from members without a posting. Leave, rest, call level, groups and unit rules are still never broken; you see the full report before anything is saved.</p></div>
      <button type="button" class="fill-all-button" data-open-fill-all>Fill remaining duties (all units)</button></section>`;
  }

  function chips(summary: Partial<Summary>, done = false, overLimit?: number) {
    if (all) {
      const over = summary.over_limit_people ?? overLimit ?? 0;
      return `<ul class="extra-duty-chips fill-all-chips" aria-label="Summary">
      ${chip(summary.filled ?? 0, done ? "filled" : "to fill", "info")}
      ${chip(summary.cross_unit ?? 0, "from other units", "neutral")}
      ${chip(summary.unposted_used ?? 0, "members without a posting", (summary.unposted_used ?? 0) ? "warning" : "neutral")}
      ${chip(over, "over individual limit", over ? "warning" : "neutral")}
      ${chip(summary.unfilled ?? 0, "cannot be filled", (summary.unfilled ?? 0) ? "danger" : "neutral")}</ul>`;
    }
    return `<ul class="extra-duty-chips" aria-label="Summary">
      ${chip(summary.filled ?? 0, done ? "filled" : "to fill", "info")}
      ${chip(summary.fallback ?? 0, "with a fallback unit", "neutral")}
      ${chip(summary.ledger_records ?? 0, "ledger records", "warning")}
      ${chip(summary.unfilled ?? 0, "cannot be filled", (summary.unfilled ?? 0) ? "danger" : "neutral")}</ul>`;
  }

  function batchesSection() {
    const batches = status?.batches ?? [];
    if (!batches.length) return "";
    return `<section class="extra-duty-batches" aria-labelledby="extra-duty-batches-title"><h3 id="extra-duty-batches-title">Runs this month</h3>
      <ul>${batches.map(b => { const sa = isSuperadminBatch(b), bal = isBalanceBatch(b); return `<li data-batch="${esc(b.id)}"${sa ? " data-superadmin-batch" : ""}${bal ? " data-balance-batch" : ""}><div><strong>${b.status === "applied" ? "Applied" : b.status === "undone" ? "Undone" : esc(codeLabel(b.status))}${sa ? ` · ${esc(ruleLabel("superadmin_allocation"))}` : ""}${bal ? " · Balance duties" : ""}</strong>
        <span>${esc(formatAuditTimestamp(b.created_at))}${b.created_by_name ? ` · ${esc(b.created_by_name)}` : ""}
        · ${bal ? `${plural(b.summary?.moves ?? 0, "duty", "duties")} moved${b.summary?.swaps ? ` · ${plural(b.summary.swaps, "swap")}` : ""} · ${b.summary?.extra_moves ? `${plural(b.summary.extra_moves, "extra duty", "extra duties")} passed on with their ledger records` : "no ledger records"}`
          : `${plural(b.summary?.filled ?? 0, "duty", "duties")} filled · ${plural(b.summary?.ledger_records ?? 0, "ledger record")}`}</span></div>
        ${b.status === "applied" && (!sa || currentRole() === "superadmin") ? `<button type="button" class="danger-button" data-extra-undo="${esc(b.id)}" ${busy ? "disabled" : ""}>${sa ? "Undo this allocation" : bal ? "Undo this balance run" : "Undo this batch"}</button>` : ""}</li>`; }).join("")}</ul>
      ${batches.some(b => b.status === "applied") ? auditReportLinks(month) : ""}</section>`;
  }

  function undoPanel() {
    if (!undo) return "";
    const conflicts = undo.conflicts.map(c => [c.duty_date ? formatDate(c.duty_date) : "", c.duty_label || (c.duty_type ? codeLabel(c.duty_type) : ""),
      c.person_name || "", c.message || c.reason || ""].filter(Boolean).join(" · ") || "A duty in this batch was changed");
    return `<section class="extra-duty-undo panel" role="region" aria-labelledby="extra-duty-undo-title" tabindex="-1" data-undo-panel>
      <h3 id="extra-duty-undo-title">${undo.phase === "conflict" ? "This batch cannot be undone yet" : isBalanceBatch(batchById(undo.batchId)) ? "Undo this balance run?" : "Undo this batch?"}</h3>
      ${undo.phase === "conflict"
        ? `<p>These duties were changed after the batch was applied, so undoing could remove someone else's work:</p>
           <ul data-undo-conflicts>${conflicts.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
           <p class="hint">Next step: put those duties back as they were, or change them one by one in the day view. Nothing was changed.</p>
           <div class="button-row"><button type="button" data-undo-keep>Close this message</button></div>`
        : isBalanceBatch(batchById(undo.batchId))
          ? `<p>This puts ${plural(undo.restored, "duty", "duties")} back with the person and unit they had before balancing. Other duties are not touched.</p>
           <div class="button-row"><button type="button" class="danger-button" data-undo-confirm ${busy ? "disabled" : ""}>Yes, undo this run</button>
           <button type="button" data-undo-keep ${busy ? "disabled" : ""}>Keep it</button></div>`
        : isSuperadminBatch(batchById(undo.batchId))
          ? `<p>This removes the superadmin allocation, puts back whoever was on the duty before, and marks its ledger record as void. Other duties are not touched.</p>
           <div class="button-row"><button type="button" class="danger-button" data-undo-confirm ${busy ? "disabled" : ""}>Yes, undo this batch</button>
           <button type="button" data-undo-keep ${busy ? "disabled" : ""}>Keep it</button></div>`
        : `<p>This removes ${plural(undo.restored, "extra duty", "extra duties")}, moves borrowed duties back to their own unit, and marks their ledger records as void. Other duties are not touched.</p>
           <div class="button-row"><button type="button" class="danger-button" data-undo-confirm ${busy ? "disabled" : ""}>Yes, undo this batch</button>
           <button type="button" data-undo-keep ${busy ? "disabled" : ""}>Keep it</button></div>`}</section>`;
  }

  // Fill-all shows its notice above the long "Never broken" box, so the outcome is seen first.
  let noticeShown = false;
  function noticeHtml() {
    if (!notice || noticeShown) return "";
    if (all) noticeShown = true;
    return `<div class="extra-duty-notice extra-duty-notice--${notice.tone}" ${notice.tone === "error" ? 'role="alert"' : 'role="status"'}>
      <p>${esc(notice.text)}</p>${notice.list?.length ? `<ul>${notice.list.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
      ${notice.next === "preview" ? `<button type="button" class="primary" data-extra-repreview ${busy ? "disabled" : ""}>Preview again</button>` : ""}
      ${notice.next === "retry" ? `<button type="button" data-extra-repreview ${busy ? "disabled" : ""}>Try again</button>` : ""}</div>`;
  }

  function body() {
    if (busy === "load") return `<p role="status" class="extra-duty-loading">${all ? "Looking in every unit for people who can take the open duties…" : "Working out who can take the open duties…"}</p>`;
    if (blocked) return `${noticeHtml()}${undoPanel()}${batchesSection()}`;
    if (all && applied) return `${noticeHtml()}${undoPanel()}${batchesSection()}${fillAllReport(applied, true)}`;
    if (all) return preview ? `${noticeHtml()}${undoPanel()}${batchesSection()}${fillAllReport(preview, false)}` : `${noticeHtml()}${undoPanel()}${batchesSection()}`;
    if (applied) return `${noticeHtml()}${undoPanel()}${batchesSection()}${chips(applied.summary, true)}
      ${decisionsTable(applied.decisions, `Extra duties applied for ${formatMonth(month)}`)}${unfilledList(applied.decisions)}${fillAllCta()}`;
    if (!preview) return `${noticeHtml()}${undoPanel()}${batchesSection()}${blocked === "undone" ? fillAllCta() : ""}`;
    return `${noticeHtml()}${undoPanel()}${batchesSection()}${chips(preview.summary)}
      ${decisionsTable(preview.decisions, `Proposed extra duties for ${formatMonth(month)}`)}${unfilledList(preview.decisions)}${fillAllCta()}`;
  }

  function footer() {
    if (applied || !preview || blocked) {
      return `<p class="extra-duty-status" role="status" aria-live="polite" data-extra-status>${busy === "undo" ? "Undoing…" : busy === "undo-check" ? "Checking the batch…" : ""}</p>
        <button type="button" data-extra-close ${busy === "undo" ? "disabled" : ""}>Close</button>`;
    }
    const fillable = preview.summary.filled > 0;
    return `<label class="extra-duty-review"><input type="checkbox" data-extra-reviewed ${reviewed ? "checked" : ""} ${!fillable || busy ? "disabled" : ""}> ${all ? "I reviewed these duties and the over-limit list" : "I reviewed these extra duties"}</label>
      <p class="extra-duty-status" role="status" aria-live="polite" data-extra-status>${busy === "apply" ? "Applying… keep this window open."
        : !fillable ? "Nothing can be applied." : reviewed ? "Ready to apply. Nothing is saved until you apply." : "Tick the review box to apply. Nothing is saved yet."}</p>
      <button type="button" data-extra-close ${busy === "apply" ? "disabled" : ""}>Cancel</button>
      <button type="button" class="primary" data-extra-apply ${!fillable || !reviewed || busy ? "disabled" : ""} aria-busy="${busy === "apply"}">${busy === "apply" ? "Applying…" : all ? "Apply" : "Apply extra duties"}</button>`;
  }

  function render(focus?: string) {
    if (closed) return;
    noticeShown = false;
    dialog.innerHTML = `<header class="mw-header"><div><h2>${esc(title)}</h2><p>${esc(formatMonth(month))} · ${all
        ? "Looks in every unit and at members without a posting. Nothing is saved until you apply."
        : "Fills duties that are still open, even when the unit is short-staffed."}</p></div>
      <button type="button" data-close aria-label="Close ${all ? "fill remaining duties" : "extra-duty layer"}" ${busy === "apply" || busy === "undo" ? "disabled" : ""}>Close</button></header>
      <div class="mw-content extra-duty-content"${all ? ' tabindex="-1" role="region" aria-label="Fill-all report"' : ""}>${all ? `${noticeHtml()}${neverBrokenBox()}` : `<p class="extra-duty-rules-note">${esc(STRICT_RULES_TEXT)}</p>`}${body()}</div>
      <footer class="mw-footer extra-duty-footer">${footer()}</footer>`;
    const target = focus ? dialog.querySelector<HTMLElement>(focus) : null;
    // preventScroll keeps the explanation and summary in view on small screens.
    // Fill-all opens on a long report: start at its top (the content region), not on a control far below.
    const start = all && busy !== "apply" ? dialog.querySelector<HTMLElement>(".mw-content") : firstActionable();
    (target ?? start)?.focus({ preventScroll: !target });
  }
  function firstActionable() {
    return dialog.querySelector<HTMLElement>(
      ".mw-content :is(button:not([disabled]):not([data-open-fill-all]), input:not([disabled]), summary, a[href]), .mw-footer :is(input:not([disabled]), button:not([disabled]))");
  }

  function conflictFrom(error: unknown): ProposalConflict[] {
    const listed = conflictsFromError(error);
    if (listed?.length) return listed.map(c => ({ ...c, month: c.month || month }));
    const detail = (error as ApiError).detail as Record<string, unknown> | undefined;
    const summary = detail?.conflict_summary as ProposalConflict | undefined;
    return summary ? [{ ...summary, month: summary.month || month }] : [];
  }
  function showConflict(error: unknown) {
    showProposalConflict(dialog, { month, admin: true, stage: "extra_duty", conflicts: conflictFrom(error), onApplied,
      retry: () => void openExtraDuty(month, onApplied, mode),
      message: `${errorMessage(error)} Finish or cancel it, then ${all ? "fill the remaining duties" : "run the extra-duty layer"}.` });
  }

  async function load() {
    busy = "load"; preview = null; applied = null; reviewed = false; notice = null; blocked = ""; undo = null;
    render();
    try {
      const [s, fallbacks] = await Promise.all([
        request<Status>(`${API}/status?month=${encodeURIComponent(month)}`, { signal: lifetimeSignal(lifetime, 15000) }),
        request<FallbackRow[]>(`${API}/unit-fallbacks`, { signal: lifetimeSignal(lifetime, 15000) }).catch(() => [] as FallbackRow[]),
      ]);
      if (closed) return;
      status = s;
      units = new Map(fallbacks.flatMap(r => [[r.unit_id, r.unit_name] as [string, string], ...r.fallbacks.map(f => [f.unit_id, f.unit_name] as [string, string])]));
      if (!s.enabled) { blocked = "disabled"; notice = { tone: "info", text: "The extra-duty layer is turned off for this deployment. Ask the system administrator to enable it." }; return; }
      if (!s.open_slots) { blocked = "nothing"; notice = { tone: "success", text: "Every duty this month already has a person. There is nothing for the extra-duty layer to fill." }; return; }
      preview = await post<Preview>("preview", all ? { month, mode } : { month }, all ? 120000 : 60000);
    } catch (error) {
      if (closed) return;
      const code = errorCode(error);
      if (code === "proposal_active") { busy = ""; showConflict(error); return; }
      blocked = code || "error";
      const next = code === "not_draft" ? "Undo the publish first, or choose a draft month."
        : code === "scope_unlocked" ? "Lock the month's units in Rota Setup and build the template first."
        : code === "nothing_to_fill" ? "" : code === "disabled" ? "Ask the system administrator to enable it." : "Check the connection, then try again.";
      notice = { tone: code === "nothing_to_fill" ? "success" : "error", text: `${errorMessage(error)}${next ? ` ${next}` : ""}`,
        next: ["not_draft", "scope_unlocked", "nothing_to_fill", "disabled"].includes(code) ? "" : "retry" };
    } finally {
      if (busy === "load") { busy = ""; render(); }
    }
  }

  async function refreshStatus() {
    try { status = await request<Status>(`${API}/status?month=${encodeURIComponent(month)}`, { signal: lifetimeSignal(lifetime, 15000) }); }
    catch { /* keep the last known list */ }
  }

  async function apply() {
    if (!preview || !reviewed || busy) return;
    busy = "apply"; notice = null; render("[data-extra-apply]");
    try {
      const body = { month, token: preview.token, plan_hash: preview.plan_hash, ...(all ? { mode } : {}) };
      const result = await post<ApplyResult>("apply", body, 120000);
      // The apply answer may leave out the report lists; keep the previewed ones then.
      applied = all ? { ...result, over_limit_people: result.over_limit_people ?? preview.over_limit_people,
        unfilled_causes: result.unfilled_causes ?? preview.unfilled_causes, diagnostics: result.diagnostics ?? preview.diagnostics } : result;
      invalidateLedgerCache();
      busy = "";
      await refreshStatus();
      const over = applied.summary.over_limit_people ?? applied.over_limit_people?.length ?? 0;
      notice = { tone: "success", text: all
        ? `Applied. ${plural(applied.summary.filled, "duty", "duties")} filled; ${applied.summary.cross_unit ?? 0} from other units; ${plural(applied.summary.unposted_used ?? 0, "member")} without a posting; ${plural(over, "member")} over an individual limit. Review the draft next, or download the audit report.`
        : `Applied. ${plural(applied.summary.filled, "duty", "duties")} filled; ${plural(applied.summary.ledger_records, "ledger record")} written. Review the draft next, or download the audit report.` };
      onApplied();
    } catch (error) {
      busy = "";
      if (closed) return;
      const code = errorCode(error);
      if (code === "proposal_active") { showConflict(error); return; }
      const violations = (((error as ApiError).detail as Record<string, unknown> | undefined)?.violations as { message?: string; code?: string }[] | undefined) ?? [];
      notice = code === "stale_preview" ? { tone: "error", text: `${errorMessage(error)} Nothing was saved. Preview again to see the current plan.`, next: "preview" }
        : code === "bad_token" ? { tone: "error", text: `${errorMessage(error)} Nothing was saved. Preview again, then apply.`, next: "preview" }
        : code === "verification_failed" ? { tone: "error", text: `${errorMessage(error)} Nothing was saved. Preview again; if this repeats, send these details to the administrator.`,
            next: "preview", list: violations.map(v => v.message || ruleLabel(v.code || "")) }
        : { tone: "error", text: `${errorMessage(error)} Nothing was saved. Try again.`, next: "" };
    }
    render(notice?.next ? "[data-extra-repreview]" : "[data-extra-apply]");
  }

  async function checkUndo(batchId: string) {
    if (busy) return;
    busy = "undo-check"; notice = null; render();
    try {
      const result = await post<UndoResult>(undoPath(batchId), { dry_run: true });
      undo = { batchId, phase: result.conflicts?.length ? "conflict" : "confirm", restored: result.restored ?? 0, conflicts: result.conflicts ?? [] };
    } catch (error) {
      if (closed) return;
      if (errorCode(error) === "undo_conflict") undo = { batchId, phase: "conflict", restored: 0, conflicts: undoConflictsFrom(error) };
      else notice = { tone: "error", text: `${errorMessage(error)} Nothing was changed. Try again.` };
    }
    busy = ""; render(undo ? "[data-undo-panel]" : undefined);
  }
  function undoConflictsFrom(error: unknown): UndoConflict[] {
    const detail = (error as ApiError).detail as Record<string, unknown> | undefined;
    const list = (detail?.conflicts ?? detail?.slots) as UndoConflict[] | undefined;
    return Array.isArray(list) && list.length ? list : [{ message: errorMessage(error) }];
  }
  async function runUndo() {
    if (!undo || busy) return;
    const batchId = undo.batchId;
    const balance = isBalanceBatch(batchById(batchId));
    busy = "undo"; render();
    try {
      const result = await post<UndoResult>(undoPath(batchId), { dry_run: false }, 120000);
      invalidateLedgerCache();
      undo = null; applied = null; busy = "";
      await refreshStatus();
      notice = { tone: "success", text: balance
        ? `Balance run undone. ${plural(result.restored ?? 0, "duty", "duties")} put back with the person and unit they had before balancing.`
        : `Batch undone. ${plural(result.restored ?? 0, "duty", "duties")} put back as they were; their ledger records are now void.`, next: "" };
      preview = null; blocked = "undone";
      onApplied();
      render("[data-extra-close]"); return;
    } catch (error) {
      busy = "";
      if (closed) return;
      if (errorCode(error) === "undo_conflict") undo = { batchId, phase: "conflict", restored: 0, conflicts: undoConflictsFrom(error) };
      else { undo = null; notice = { tone: "error", text: `${errorMessage(error)} Nothing was changed. Try again.` }; }
    }
    render(undo ? "[data-undo-panel]" : undefined);
  }

  dialog.onchange = event => {
    const input = event.target as HTMLInputElement;
    if (input.matches("[data-extra-reviewed]")) { reviewed = input.checked; render("[data-extra-reviewed]"); }
  };
  dialog.onclick = event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    if (button.matches("[data-close], [data-extra-close]")) { if (busy !== "apply" && busy !== "undo") dialog.close(); return; }
    if (button.matches("[data-extra-apply]")) { void apply(); return; }
    if (button.matches("[data-extra-repreview]")) { if (!busy) void load(); return; }
    if (button.dataset.extraUndo) { void checkUndo(button.dataset.extraUndo); return; }
    if (button.matches("[data-undo-confirm]")) { void runUndo(); return; }
    if (button.matches("[data-undo-keep]")) { undo = null; render(); return; }
    if (button.matches("[data-open-fill-all]")) { if (!busy) { dialog.close(); void openFillAll(month, onApplied); } }
  };
  await load();
}

/* ----------------------------------------------------------------------------------------- */
/* Member ledger                                                                              */
/* ----------------------------------------------------------------------------------------- */

const ledgerCache = new Map<string, { at: number; rows: Promise<LedgerRow[]> }>();
function invalidateLedgerCache() { ledgerCache.clear(); }
function memberLedger(personId: string): Promise<LedgerRow[]> {
  const hit = ledgerCache.get(personId);
  if (hit && Date.now() - hit.at < 60000) return hit.rows;
  const rows = request<LedgerRow[]>(`${API}/ledger?person_id=${encodeURIComponent(personId)}`, { signal: AbortSignal.timeout(15000) });
  ledgerCache.set(personId, { at: Date.now(), rows });
  rows.catch(() => ledgerCache.delete(personId));
  return rows;
}

/** The person's extra-duty ledger, active and void, newest first. */
export async function renderMemberExtraDuties(host: HTMLElement, personId: string): Promise<void> {
  host.classList.add("extra-duty-member");
  const heading = '<h3>Extra duties</h3><p class="hint">Duties added by the extra-duty layer when a unit was short. Each active one moves this person down the list for the next extra duty. Void records no longer count.</p>';
  host.innerHTML = `${heading}<p role="status">Loading extra duties…</p>`;
  let rows: LedgerRow[];
  try { rows = await memberLedger(personId); }
  catch (error) {
    if (!host.isConnected) return;
    host.innerHTML = `${heading}<p role="alert">${esc(errorCode(error) === "disabled" ? "The extra-duty layer is turned off." : `${errorMessage(error)} Reopen this tab to try again.`)}</p>`;
    return;
  }
  if (!host.isConnected) return;
  const sorted = [...rows].sort((a, b) => b.duty_date.localeCompare(a.duty_date));
  const active = sorted.filter(r => r.status === "active").length;
  host.innerHTML = `${heading}${sorted.length
    ? `<p class="extra-duty-member__count">${plural(active, "active record")} · ${plural(sorted.length - active, "void record")}</p>
      <ul class="extra-duty-ledger">${sorted.map(r => {
        const assigned = unitName(r.assigned_unit), home = unitName(r.home_unit);
        return `<li data-ledger-row="${esc(r.id)}" class="${r.status === "active" ? "" : "is-void"}">
        <div class="extra-duty-ledger__head"><strong>${esc(formatDate(r.duty_date))} · ${esc(r.duty_label || codeLabel(r.duty_type))}</strong>
          <span class="extra-duty-badge ${r.status === "active" ? "extra-duty-badge--active" : "extra-duty-badge--void"}">${r.status === "active" ? "Active" : "Void"}</span></div>
        <span>${esc(assigned || home || "Unit not named")}${r.fallback_used && home && home !== assigned ? ` <span class="extra-duty-badge extra-duty-badge--fallback">Fallback from ${esc(home)}</span>` : ""}</span>
        <span>Rules overridden: ${esc(rulesText(r.overridden_rules))}</span>
        ${(r.transfers?.length ? r.transfers.map(transferText).filter(Boolean) : r.rebalanced ? ["Passed on by Balance duties"] : [])
          .map(t => `<span class="extra-duty-ledger__transfer" data-ledger-transfer>${esc(t)}</span>`).join("")}
        ${r.status !== "active" ? `<span class="hint">No longer counts${r.void_reason ? `: ${esc(r.void_reason)}` : ""}</span>` : ""}</li>`;
      }).join("")}</ul>`
    : '<p class="extra-duty-empty">No extra duties recorded for this person.</p>'}`;
}

/* ----------------------------------------------------------------------------------------- */
/* Unit fallback editor                                                                       */
/* ----------------------------------------------------------------------------------------- */

/** Per-unit ordered fallback list editor (GET /unit-fallbacks, PUT /unit-fallbacks/{unit_id}). */
export async function renderUnitFallbacks(host: HTMLElement): Promise<void> {
  const intro = `<h3 id="unit-fallbacks-title">Fallback units</h3>
    <p class="hint">When the extra-duty layer finds no one free in a unit, it tries these units in order and moves the duty there. With no list, it tries the month's other units: same campus first, then the least busy.</p>`;
  host.innerHTML = `<section class="panel extra-duty-fallbacks" aria-labelledby="unit-fallbacks-title">${intro}<p role="status">Loading fallback units…</p></section>`;
  let rows: FallbackRow[];
  try { rows = await request<FallbackRow[]>(`${API}/unit-fallbacks`, { signal: AbortSignal.timeout(15000) }); }
  catch (error) {
    if (!host.isConnected) return;
    host.innerHTML = `<section class="panel extra-duty-fallbacks" aria-labelledby="unit-fallbacks-title">${intro}
      <p role="alert">${esc(errorCode(error) === "disabled" ? "The extra-duty layer is turned off." : `${errorMessage(error)}`)}</p>
      <button type="button" data-fb-reload>Try again</button></section>`;
    host.querySelector("[data-fb-reload]")?.addEventListener("click", () => void renderUnitFallbacks(host));
    return;
  }
  if (!host.isConnected) return;
  const names = new Map(rows.map(r => [r.unit_id, r.unit_name]));
  rows.forEach(r => r.fallbacks.forEach(f => { if (!names.has(f.unit_id)) names.set(f.unit_id, f.unit_name); }));
  const saved = new Map(rows.map(r => [r.unit_id, r.fallbacks.map(f => f.unit_id)]));
  const draft = new Map(rows.map(r => [r.unit_id, r.fallbacks.map(f => f.unit_id)]));
  const notes = new Map<string, { tone: "error" | "success"; text: string }>();
  const saving = new Set<string>();
  const open = new Set<string>();
  const sorted = [...rows].sort((a, b) => a.unit_name.localeCompare(b.unit_name));
  const dirty = (id: string) => JSON.stringify(draft.get(id)) !== JSON.stringify(saved.get(id));

  function unitHtml(row: FallbackRow) {
    const id = row.unit_id, list = draft.get(id) ?? [], busy = saving.has(id), note = notes.get(id);
    const options = [...names].filter(([u]) => u !== id && !list.includes(u)).sort((a, b) => a[1].localeCompare(b[1]));
    const name = (u: string) => names.get(u) || "Unknown unit";
    return `<details class="extra-duty-fallback-unit" data-fallback-unit="${esc(id)}" ${open.has(id) ? "open" : ""}>
      <summary><strong>${esc(row.unit_name)}</strong><span>${list.length ? plural(list.length, "fallback unit") : "Automatic order"}${dirty(id) ? " · not saved" : ""}</span></summary>
      ${list.length ? `<ol class="extra-duty-fallback-list" aria-label="Fallback order for ${esc(row.unit_name)}">${list.map((u, i) => `<li data-fallback-item="${esc(u)}">
        <span><span class="extra-duty-fallback-rank">${i + 1}</span>${esc(name(u))}</span>
        <span class="extra-duty-fallback-actions">
          <button type="button" data-fb-up="${esc(u)}" aria-label="Move ${esc(name(u))} up" ${i === 0 || busy ? "disabled" : ""}>Move up</button>
          <button type="button" data-fb-down="${esc(u)}" aria-label="Move ${esc(name(u))} down" ${i === list.length - 1 || busy ? "disabled" : ""}>Move down</button>
          <button type="button" class="danger-button" data-fb-remove="${esc(u)}" aria-label="Remove ${esc(name(u))}" ${busy ? "disabled" : ""}>Remove</button></span></li>`).join("")}</ol>`
        : '<p class="hint">No list: the layer uses the automatic order.</p>'}
      <div class="extra-duty-fallback-add">
        <label>Add a fallback unit<select data-fb-select ${!options.length || busy ? "disabled" : ""}>
          ${options.length ? options.map(([u, n]) => `<option value="${esc(u)}">${esc(n)}</option>`).join("") : "<option>No other units</option>"}</select></label>
        <button type="button" data-fb-add ${!options.length || busy ? "disabled" : ""}>Add to the end</button></div>
      <div class="extra-duty-fallback-save"><button type="button" class="primary" data-fb-save ${!dirty(id) || busy ? "disabled" : ""}>${busy ? "Saving…" : "Save order"}</button>
        ${dirty(id) && !busy ? '<button type="button" data-fb-reset>Discard changes</button>' : ""}
        <p role="status" aria-live="polite" class="${note?.tone === "error" ? "extra-duty-error-text" : "hint"}">${esc(note?.text ?? "")}</p></div></details>`;
  }
  function paint() {
    host.innerHTML = `<section class="panel extra-duty-fallbacks" aria-labelledby="unit-fallbacks-title">${intro}
      ${sorted.length ? sorted.map(unitHtml).join("") : '<p class="extra-duty-empty">No units yet. Add units first.</p>'}</section>`;
  }
  function repaintUnit(id: string, focus?: string) {
    const row = sorted.find(r => r.unit_id === id);
    const element = host.querySelector<HTMLElement>(`[data-fallback-unit="${CSS.escape(id)}"]`);
    if (!row || !element) return;
    element.outerHTML = unitHtml(row);
    const fresh = host.querySelector<HTMLElement>(`[data-fallback-unit="${CSS.escape(id)}"]`)!;
    const target = focus ? fresh.querySelector<HTMLElement>(focus) : null;
    if (target && !(target as HTMLButtonElement).disabled) target.focus();
    else if (focus) fresh.querySelector<HTMLElement>("summary")?.focus();
  }
  paint();
  host.addEventListener("toggle", event => {
    const details = event.target as HTMLDetailsElement;
    const id = details.dataset?.fallbackUnit;
    if (id) { if (details.open) open.add(id); else open.delete(id); }
  }, true);
  host.onclick = async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    const unit = button?.closest<HTMLElement>("[data-fallback-unit]")?.dataset.fallbackUnit;
    if (!button || !unit || button.disabled || saving.has(unit)) return;
    const list = [...(draft.get(unit) ?? [])];
    const move = (u: string, by: number) => { const i = list.indexOf(u), j = i + by; if (i < 0 || j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; };
    let focus = "";
    // Keep focus on the moved unit: the same button, or the other move button at the top/bottom.
    if (button.dataset.fbUp) { const u = CSS.escape(button.dataset.fbUp); move(button.dataset.fbUp, -1); focus = `[data-fb-up="${u}"]:not(:disabled), [data-fb-down="${u}"]`; }
    else if (button.dataset.fbDown) { const u = CSS.escape(button.dataset.fbDown); move(button.dataset.fbDown, 1); focus = `[data-fb-down="${u}"]:not(:disabled), [data-fb-up="${u}"]`; }
    else if (button.dataset.fbRemove) { list.splice(list.indexOf(button.dataset.fbRemove), 1); focus = "[data-fb-select]"; }
    else if (button.matches("[data-fb-add]")) {
      const value = host.querySelector<HTMLSelectElement>(`[data-fallback-unit="${CSS.escape(unit)}"] [data-fb-select]`)?.value;
      if (value && names.has(value) && !list.includes(value)) list.push(value);
      focus = "[data-fb-add]";
    } else if (button.matches("[data-fb-reset]")) { draft.set(unit, [...(saved.get(unit) ?? [])]); notes.delete(unit); repaintUnit(unit, "summary"); return; }
    else if (button.matches("[data-fb-save]")) {
      saving.add(unit); notes.delete(unit); repaintUnit(unit);
      try {
        const row = await request<FallbackRow>(`${API}/unit-fallbacks/${encodeURIComponent(unit)}`,
          { method: "PUT", body: JSON.stringify({ fallback_unit_ids: list }), signal: AbortSignal.timeout(15000) });
        const ids = (row?.fallbacks ?? []).map(f => f.unit_id);
        row?.fallbacks?.forEach(f => names.set(f.unit_id, f.unit_name));
        saved.set(unit, ids); draft.set(unit, [...ids]);
        notes.set(unit, { tone: "success", text: ids.length ? "Saved. The next extra-duty run uses this order." : "Saved. The automatic order is used." });
      } catch (error) {
        notes.set(unit, { tone: "error", text: `${errorMessage(error)} Nothing was changed; try again.` });
      } finally { saving.delete(unit); }
      if (host.isConnected) repaintUnit(unit, "[data-fb-save]");
      return;
    } else return;
    draft.set(unit, list); notes.delete(unit);
    repaintUnit(unit, focus);
  };
}
