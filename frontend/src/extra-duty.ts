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
import { request } from "./services/api";
import { formatApiError } from "./api-errors";
import { workspaceDialog } from "./member-workspace";
import { conflictsFromError, showProposalConflict, type ProposalConflict } from "./compute-conflict";
import { codeLabel, formatDate, formatMonth } from "./ui";

const API = "/api/v1/extra-duty";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
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
  fairness: "Above the equal-duty share",
  equal_duties: "Above the equal-duty share",
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
}
export interface Summary { filled: number; fallback: number; ledger_records: number; unfilled: number; slots_considered: number }
interface Preview { month: string; plan_hash: string; context_hash: string; decisions: Decision[]; summary: Summary;
  generated_at: string; token: string }
interface Batch { id: string; status: string; created_at: string; created_by_name: string | null; summary: Partial<Summary> }
interface Status { enabled: boolean; month: string; open_slots: number; batches: Batch[] }
interface ApplyResult { batch_id: string; summary: Summary; decisions: Decision[] }
interface UndoConflict { slot_id?: string; reason?: string; message?: string; duty_date?: string; person_name?: string; duty_label?: string; duty_type?: string }
interface UndoResult { batch_id: string; restored: number; conflicts: UndoConflict[] }
export interface LedgerRow { id: string; person_id: string; person_name: string; duty_date: string; duty_type: string;
  home_unit: unknown; assigned_unit: unknown; fallback_used: boolean; overridden_rules: string[]; status: string;
  void_reason: string | null; batch_id: string; created_at: string; duty_label?: string }
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
  return d.slot_label && d.slot_label !== base ? `${base} (${d.slot_label})` : base;
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
  const token = localStorage.getItem("duty_rota_auth_token") ?? "";
  const path = `${API}/report?month=${encodeURIComponent(month)}&format=${format}`;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal });
  } catch {
    throw new Error("Cannot reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    let message = response.status >= 500 ? "The server could not build the report." : `The report could not be downloaded (${response.status}).`;
    try { message = formatApiError((await response.json()).detail, message); } catch { /* not JSON */ }
    throw new Error(message);
  }
  const blob = await response.blob();
  const match = response.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] ?? `rota-audit-report-${month}.${format}`;
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
/* Preview / apply / undo window                                                              */
/* ----------------------------------------------------------------------------------------- */

type Notice = { tone: "error" | "success" | "info"; text: string; next?: "preview" | "retry" | ""; list?: string[] };

export async function openExtraDuty(month: string, onApplied: () => void): Promise<void> {
  const dialog = workspaceDialog("Extra-duty layer", "compute-workspace extra-duty-workspace");
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

  const post = <T>(path: string, body: object, ms = 60000) => request<T>(`${API}/${path}`,
    { method: "POST", body: JSON.stringify(body), signal: lifetimeSignal(lifetime, ms) });

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
        ? `<span class="extra-duty-badge extra-duty-badge--fallback">Fallback from ${esc(unitLabel(d.home_unit_id, d.home_unit_name))}</span>` : ""}</td>
      <td data-label="Person"><strong>${esc(d.person_name)}</strong>${d.ledger ? '<span class="extra-duty-badge">Ledger</span>' : ""}</td>
      <td data-label="Rules overridden">${d.overridden_rules?.length
        ? `<ul class="extra-duty-rules">${d.overridden_rules.map(r => `<li>${esc(ruleLabel(r))}</li>`).join("")}</ul>` : '<span class="hint">None — within every rule</span>'}</td>
      <td data-label="Why this person">${esc(justiceText(d.justice))}</td>
      <td data-label="Alternatives">${alternatives}</td></tr>`;
  }

  function decisionsTable(decisions: Decision[], caption: string) {
    const filled = decisions.filter(d => d.action !== "unfilled");
    if (!filled.length) return '<p class="extra-duty-empty">No duty can be filled without breaking leave or rest rules.</p>';
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
      <p class="hint">No one can take these without breaking leave or rest rules. They stay open; assign them by hand after checking leave, or add a fallback unit in Unit Management.</p>
      <ul>${unfilled.map(d => `<li data-unfilled="${esc(d.slot_id)}"><strong>${esc(d.duty_date ? formatDate(d.duty_date) : "Date not given")} · ${esc(dutyText(d))} · ${esc(unitLabel(d.home_unit_id, d.home_unit_name))}</strong>
        <span>${esc(d.reason || "No eligible person is free.")}</span></li>`).join("")}</ul></section>`;
  }

  function chips(summary: Partial<Summary>, done = false) {
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
      <ul>${batches.map(b => `<li data-batch="${esc(b.id)}"><div><strong>${b.status === "applied" ? "Applied" : b.status === "undone" ? "Undone" : esc(codeLabel(b.status))}</strong>
        <span>${esc(new Date(b.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))}${b.created_by_name ? ` · ${esc(b.created_by_name)}` : ""}
        · ${plural(b.summary?.filled ?? 0, "duty", "duties")} filled · ${plural(b.summary?.ledger_records ?? 0, "ledger record")}</span></div>
        ${b.status === "applied" ? `<button type="button" class="danger-button" data-extra-undo="${esc(b.id)}" ${busy ? "disabled" : ""}>Undo this batch</button>` : ""}</li>`).join("")}</ul>
      ${batches.some(b => b.status === "applied") ? auditReportLinks(month) : ""}</section>`;
  }

  function undoPanel() {
    if (!undo) return "";
    const conflicts = undo.conflicts.map(c => [c.duty_date ? formatDate(c.duty_date) : "", c.duty_label || (c.duty_type ? codeLabel(c.duty_type) : ""),
      c.person_name || "", c.message || c.reason || ""].filter(Boolean).join(" · ") || "A duty in this batch was changed");
    return `<section class="extra-duty-undo panel" role="region" aria-labelledby="extra-duty-undo-title" tabindex="-1" data-undo-panel>
      <h3 id="extra-duty-undo-title">${undo.phase === "conflict" ? "This batch cannot be undone yet" : "Undo this batch?"}</h3>
      ${undo.phase === "conflict"
        ? `<p>These duties were changed after the batch was applied, so undoing could remove someone else's work:</p>
           <ul data-undo-conflicts>${conflicts.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
           <p class="hint">Next step: put those duties back as they were, or change them one by one in the day view. Nothing was changed.</p>
           <div class="button-row"><button type="button" data-undo-keep>Close this message</button></div>`
        : `<p>This removes ${plural(undo.restored, "extra duty", "extra duties")}, moves borrowed duties back to their own unit, and marks their ledger records as void. Other duties are not touched.</p>
           <div class="button-row"><button type="button" class="danger-button" data-undo-confirm ${busy ? "disabled" : ""}>Yes, undo this batch</button>
           <button type="button" data-undo-keep ${busy ? "disabled" : ""}>Keep it</button></div>`}</section>`;
  }

  function noticeHtml() {
    if (!notice) return "";
    return `<div class="extra-duty-notice extra-duty-notice--${notice.tone}" ${notice.tone === "error" ? 'role="alert"' : 'role="status"'}>
      <p>${esc(notice.text)}</p>${notice.list?.length ? `<ul>${notice.list.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
      ${notice.next === "preview" ? `<button type="button" class="primary" data-extra-repreview ${busy ? "disabled" : ""}>Preview again</button>` : ""}
      ${notice.next === "retry" ? `<button type="button" data-extra-repreview ${busy ? "disabled" : ""}>Try again</button>` : ""}</div>`;
  }

  function body() {
    if (busy === "load") return '<p role="status" class="extra-duty-loading">Working out who can take the open duties…</p>';
    if (blocked) return `${noticeHtml()}${batchesSection()}`;
    if (applied) return `${noticeHtml()}${undoPanel()}${chips(applied.summary, true)}
      ${decisionsTable(applied.decisions, `Extra duties applied for ${formatMonth(month)}`)}${unfilledList(applied.decisions)}${batchesSection()}`;
    if (!preview) return `${noticeHtml()}${undoPanel()}${batchesSection()}`;
    return `${noticeHtml()}${undoPanel()}${chips(preview.summary)}
      ${decisionsTable(preview.decisions, `Proposed extra duties for ${formatMonth(month)}`)}${unfilledList(preview.decisions)}${batchesSection()}`;
  }

  function footer() {
    if (applied || !preview || blocked) {
      return `<p class="extra-duty-status" role="status" aria-live="polite" data-extra-status>${busy === "undo" ? "Undoing…" : busy === "undo-check" ? "Checking the batch…" : ""}</p>
        <button type="button" data-extra-close ${busy === "undo" ? "disabled" : ""}>Close</button>`;
    }
    const fillable = preview.summary.filled > 0;
    return `<label class="extra-duty-review"><input type="checkbox" data-extra-reviewed ${reviewed ? "checked" : ""} ${!fillable || busy ? "disabled" : ""}> I reviewed these extra duties</label>
      <p class="extra-duty-status" role="status" aria-live="polite" data-extra-status>${busy === "apply" ? "Applying… keep this window open."
        : !fillable ? "Nothing can be applied." : reviewed ? "Ready to apply. Nothing is saved until you apply." : "Tick the review box to apply. Nothing is saved yet."}</p>
      <button type="button" data-extra-close ${busy === "apply" ? "disabled" : ""}>Cancel</button>
      <button type="button" class="primary" data-extra-apply ${!fillable || !reviewed || busy ? "disabled" : ""} aria-busy="${busy === "apply"}">${busy === "apply" ? "Applying…" : "Apply extra duties"}</button>`;
  }

  function render(focus?: string) {
    if (closed) return;
    dialog.innerHTML = `<header class="mw-header"><div><h2>Extra-duty layer</h2><p>${esc(formatMonth(month))} · Fills duties that are still open, even when the unit is short-staffed.</p></div>
      <button type="button" data-close aria-label="Close extra-duty layer" ${busy === "apply" || busy === "undo" ? "disabled" : ""}>Close</button></header>
      <div class="mw-content extra-duty-content"><p class="extra-duty-rules-note">${esc(STRICT_RULES_TEXT)}</p>${body()}</div>
      <footer class="mw-footer extra-duty-footer">${footer()}</footer>`;
    const target = focus ? dialog.querySelector<HTMLElement>(focus) : null;
    (target ?? firstActionable())?.focus();
  }
  function firstActionable() {
    return dialog.querySelector<HTMLElement>(
      ".mw-content :is(button:not([disabled]), input:not([disabled]), summary, a[href]), .mw-footer :is(input:not([disabled]), button:not([disabled]))");
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
      retry: () => void openExtraDuty(month, onApplied),
      message: `${errorMessage(error)} Finish or cancel it, then run the extra-duty layer.` });
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
      preview = await post<Preview>("preview", { month });
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
      applied = await post<ApplyResult>("apply", { month, token: preview.token, plan_hash: preview.plan_hash }, 120000);
      invalidateLedgerCache();
      busy = "";
      await refreshStatus();
      notice = { tone: "success", text: `Applied. ${plural(applied.summary.filled, "duty", "duties")} filled; ${plural(applied.summary.ledger_records, "ledger record")} written. Review the draft next, or download the audit report.` };
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
      const result = await post<UndoResult>(`batches/${encodeURIComponent(batchId)}/undo`, { dry_run: true });
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
    busy = "undo"; render();
    try {
      const result = await post<UndoResult>(`batches/${encodeURIComponent(batchId)}/undo`, { dry_run: false }, 120000);
      invalidateLedgerCache();
      undo = null; applied = null; busy = "";
      await refreshStatus();
      notice = { tone: "success", text: `Batch undone. ${plural(result.restored ?? 0, "duty", "duties")} put back as they were; their ledger records are now void.`, next: "" };
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
    if (button.matches("[data-undo-keep]")) { undo = null; render(); }
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
    if (button.dataset.fbUp) { move(button.dataset.fbUp, -1); focus = `[data-fb-up="${CSS.escape(button.dataset.fbUp)}"]`; }
    else if (button.dataset.fbDown) { move(button.dataset.fbDown, 1); focus = `[data-fb-down="${CSS.escape(button.dataset.fbDown)}"]`; }
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
